use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ConnectInfo;
use rusqlite::{Connection, OptionalExtension, params};
use tonic::{Request, Response, Status};

use crate::config::ServerConfig;
use crate::daycare::{DaycareRuntime, DaycareStream};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::ipfilter::IpFilter;
use crate::lti::VersionPayload;
use crate::mutations;
use crate::passback::{
    GradePassbackTarget, PASSBACK_LOCKED, PASSBACK_NO_TARGET, PASSBACK_PENDING,
    build_grade_report_html, spawn_grade_passback,
};
use crate::proto::code_grinder_service_server::CodeGrinderService;
use crate::proto::{
    DaycareRequest, GetAssignmentRequest, GetAssignmentResponse, GetProblemTypeRequest,
    GetProblemTypeResponse, GetProblemTypesRequest, GetProblemTypesResponse, GetWorkspaceRequest,
    GetWorkspaceResponse, HelloRequest, HelloResponse, ListAssignmentsRequest,
    ListAssignmentsResponse, PrepareProblemRequest, PrepareProblemResponse,
    SaveGradedCommitRequest, SaveGradedCommitResponse, SaveProblemRequest, SaveProblemResponse,
    SaveProblemSetRequest, SaveProblemSetResponse, SaveProblemTypeFilesRequest,
    SaveProblemTypeFilesResponse, SaveProblemTypeRequest, SaveProblemTypeResponse,
    SaveUngradedCommitRequest, SaveUngradedCommitResponse, SaveWorkspaceCommitRequest,
    SaveWorkspaceCommitResponse, SearchProblemCatalogRequest, SearchProblemCatalogResponse,
    Version,
};
use crate::registry::DaycareRegistry;
use crate::sessions::{LoginTokens, create_session, load_session_user_id};
use crate::store::{self, UserRow};
use crate::timeutil::now_utc;

#[derive(Clone)]
pub struct CodeGrinderServer {
    db: Db,
    config: Arc<ServerConfig>,
    login_tokens: Arc<LoginTokens>,
    registry: Arc<DaycareRegistry>,
    daycare: Option<DaycareRuntime>,
    ip_filter: IpFilter,
    version: VersionPayload,
    ta_enabled: bool,
    daycare_enabled: bool,
}

pub struct CodeGrinderServerParts {
    pub db: Db,
    pub config: Arc<ServerConfig>,
    pub login_tokens: Arc<LoginTokens>,
    pub registry: Arc<DaycareRegistry>,
    pub daycare: Option<DaycareRuntime>,
    pub ip_filter: IpFilter,
    pub version: VersionPayload,
    pub ta_enabled: bool,
    pub daycare_enabled: bool,
}

impl CodeGrinderServer {
    pub fn new(parts: CodeGrinderServerParts) -> Self {
        Self {
            db: parts.db,
            config: parts.config,
            login_tokens: parts.login_tokens,
            registry: parts.registry,
            daycare: parts.daycare,
            ip_filter: parts.ip_filter,
            version: parts.version,
            ta_enabled: parts.ta_enabled,
            daycare_enabled: parts.daycare_enabled,
        }
    }

    fn require_ta_role(&self) -> AppResult<()> {
        if self.ta_enabled {
            Ok(())
        } else {
            Err(AppError::Forbidden("TA role is not enabled".to_owned()))
        }
    }

    async fn authenticated_user<T>(&self, request: &Request<T>) -> AppResult<UserRow> {
        let session_key = request
            .metadata()
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Unauthorized("missing session key".to_owned()))?
            .to_owned();
        let config = self.config.clone();
        self.db
            .transaction_until(request_deadline(request), move |conn| {
                let user_id =
                    load_session_user_id(conn, &session_key, &config.session_secret, now_utc())?;
                store::load_user_by_id(conn, &user_id)
            })
            .await
    }

    fn require_admin(user: &UserRow) -> AppResult<()> {
        if user.admin {
            Ok(())
        } else {
            Err(AppError::Forbidden("user is not an admin".to_owned()))
        }
    }

    fn require_author(user: &UserRow) -> AppResult<()> {
        if user.admin || user.author {
            Ok(())
        } else {
            Err(AppError::Forbidden("user is not an author".to_owned()))
        }
    }

    fn require_catalog_search(user: &UserRow) -> AppResult<()> {
        if user.admin || user.author || user.instructor {
            Ok(())
        } else {
            Err(AppError::Forbidden(
                "user is not an instructor or author".to_owned(),
            ))
        }
    }

    fn ip_allowed<T>(&self, request: &Request<T>) -> bool {
        if !self.ip_filter.enabled() {
            return true;
        }
        request_client_ip(request).is_some_and(|ip| self.ip_filter.allows(&ip))
    }

    fn select_daycare_host(&self, problem_types: &BTreeSet<String>) -> AppResult<String> {
        self.registry.assign(problem_types)
    }

    fn version(&self) -> Version {
        Version {
            version: self.version.version.clone(),
            grind_version_required: self.version.grind_version_required.clone(),
            grind_version_recommended: self.version.grind_version_recommended.clone(),
        }
    }
}

#[tonic::async_trait]
impl CodeGrinderService for CodeGrinderServer {
    type DaycareStream = DaycareStream;

    async fn hello(
        &self,
        request: Request<HelloRequest>,
    ) -> Result<Response<HelloResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let config = self.config.clone();
        let version = self.version();
        let deadline = request_deadline(&request);
        let token = request.get_ref().token.clone();
        if !token.is_empty() {
            let user_id = self
                .login_tokens
                .take(&token, now_utc())
                .map_err(AppError::grpc_status)?;
            let response = self
                .db
                .transaction_until(deadline, move |conn| {
                    let user = store::load_user_by_id(conn, &user_id)?;
                    let session = create_session(
                        conn,
                        &user_id,
                        now_utc(),
                        &config.sessions_expire,
                        &config.session_secret,
                    )?;
                    Ok(hello_response(user, version, session.session_key))
                })
                .await
                .map_err(AppError::grpc_status)?;
            return Ok(Response::new(response));
        }
        let user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(hello_response(user, version, String::new())))
    }

    async fn list_assignments(
        &self,
        request: Request<ListAssignmentsRequest>,
    ) -> Result<Response<ListAssignmentsResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let items = self
            .db
            .transaction_until(deadline, move |conn| {
                store::list_assignments(
                    conn,
                    &current_user,
                    &req.search,
                    req.include_student_context,
                    ip_allowed,
                )
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(ListAssignmentsResponse { items }))
    }

    async fn search_problem_catalog(
        &self,
        request: Request<SearchProblemCatalogRequest>,
    ) -> Result<Response<SearchProblemCatalogResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        Self::require_catalog_search(&current_user).map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let problem_sets = self
            .db
            .transaction_until(deadline, move |conn| {
                store::search_problem_catalog(conn, &current_user, &req.search)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(SearchProblemCatalogResponse { problem_sets }))
    }

    async fn get_problem_types(
        &self,
        request: Request<GetProblemTypesRequest>,
    ) -> Result<Response<GetProblemTypesResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let problem_types = self
            .db
            .transaction_until(deadline, store::list_problem_types)
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(GetProblemTypesResponse { problem_types }))
    }

    async fn get_problem_type(
        &self,
        request: Request<GetProblemTypeRequest>,
    ) -> Result<Response<GetProblemTypeResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let problem_type_name = request.into_inner().problem_type;
        let problem_type = self
            .db
            .transaction_until(deadline, move |conn| {
                store::load_problem_type(conn, &problem_type_name)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(GetProblemTypeResponse {
            problem_type: Some(problem_type),
        }))
    }

    async fn save_problem_type_files(
        &self,
        request: Request<SaveProblemTypeFilesRequest>,
    ) -> Result<Response<SaveProblemTypeFilesResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        Self::require_admin(&current_user).map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let problem_type = self
            .db
            .transaction_until(deadline, move |conn| {
                mutations::save_problem_type_files(conn, &req.problem_type, &req.files)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(SaveProblemTypeFilesResponse {
            problem_type: Some(problem_type),
        }))
    }

    async fn save_problem_type(
        &self,
        request: Request<SaveProblemTypeRequest>,
    ) -> Result<Response<SaveProblemTypeResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        Self::require_admin(&current_user).map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let problem_types = self
            .db
            .transaction_until(deadline, move |conn| {
                mutations::save_problem_type(conn, &req.problem_type, &req.container, &req.actions)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(SaveProblemTypeResponse { problem_types }))
    }

    async fn get_assignment(
        &self,
        request: Request<GetAssignmentRequest>,
    ) -> Result<Response<GetAssignmentResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        let key = request
            .into_inner()
            .assignment
            .ok_or_else(|| Status::invalid_argument("assignment is required"))?;
        let response = self
            .db
            .transaction_until(deadline, move |conn| {
                store::get_assignment(conn, &current_user, &key, ip_allowed)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(response))
    }

    async fn get_workspace(
        &self,
        request: Request<GetWorkspaceRequest>,
    ) -> Result<Response<GetWorkspaceResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let key = req
            .assignment
            .ok_or_else(|| Status::invalid_argument("assignment is required"))?;
        let response = self
            .db
            .transaction_until(deadline, move |conn| {
                store::get_workspace(
                    conn,
                    &current_user,
                    store::WorkspaceQuery {
                        key,
                        problem_id: req.problem_id,
                        requested_step: req.step_number,
                        file_state: req.file_state,
                        include_contents: req.include_contents,
                        include_solution_files: req.include_solution_files,
                        ip_allowed,
                    },
                )
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(response))
    }

    async fn prepare_problem(
        &self,
        request: Request<PrepareProblemRequest>,
    ) -> Result<Response<PrepareProblemResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        Self::require_author(&current_user).map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let draft = req
            .draft
            .ok_or_else(|| Status::invalid_argument("draft is required"))?;
        let config = self.config.clone();
        let this = self.clone();
        let bundle = self
            .db
            .transaction_until(deadline, move |conn| {
                mutations::prepare_problem(
                    conn,
                    &current_user,
                    &draft,
                    &req.action,
                    &config,
                    |types| this.select_daycare_host(types),
                )
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(PrepareProblemResponse {
            bundle: Some(bundle),
        }))
    }

    async fn save_problem(
        &self,
        request: Request<SaveProblemRequest>,
    ) -> Result<Response<SaveProblemResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        Self::require_author(&current_user).map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let bundle = req
            .bundle
            .ok_or_else(|| Status::invalid_argument("bundle is required"))?;
        let config = self.config.clone();
        let saved = self
            .db
            .transaction_until(deadline, move |conn| {
                mutations::save_problem(conn, &current_user, req.mode, &bundle, &config)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(SaveProblemResponse {
            bundle: Some(saved),
        }))
    }

    async fn save_problem_set(
        &self,
        request: Request<SaveProblemSetRequest>,
    ) -> Result<Response<SaveProblemSetResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        Self::require_author(&current_user).map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let bundle = req
            .bundle
            .ok_or_else(|| Status::invalid_argument("bundle is required"))?;
        let saved = self
            .db
            .transaction_until(deadline, move |conn| {
                mutations::save_problem_set(conn, req.mode, &bundle)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(SaveProblemSetResponse {
            bundle: Some(saved),
        }))
    }

    async fn save_workspace_commit(
        &self,
        request: Request<SaveWorkspaceCommitRequest>,
    ) -> Result<Response<SaveWorkspaceCommitResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        let commit = request
            .into_inner()
            .commit
            .ok_or_else(|| Status::invalid_argument("commit is required"))?;
        let (save_status, _) = self
            .db
            .transaction_until(deadline, move |conn| {
                mutations::save_workspace_commit(conn, &current_user, &commit, ip_allowed)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(SaveWorkspaceCommitResponse { save_status }))
    }

    async fn save_ungraded_commit(
        &self,
        request: Request<SaveUngradedCommitRequest>,
    ) -> Result<Response<SaveUngradedCommitResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let commit = req
            .commit
            .ok_or_else(|| Status::invalid_argument("commit is required"))?;
        let config = self.config.clone();
        let this = self.clone();
        let result = self
            .db
            .transaction_until(deadline, move |conn| {
                mutations::save_ungraded_commit(conn, &current_user, &commit, ip_allowed, |types| {
                    this.select_daycare_host(types)
                })
            })
            .await
            .map_err(AppError::grpc_status)?;
        let signed =
            crate::signatures::encode_signed_runtime_bundle(&result.bundle, &config.daycare_secret)
                .map_err(AppError::grpc_status)?;
        Ok(Response::new(SaveUngradedCommitResponse {
            bundle: Some(signed),
            save_status: result.save_status,
        }))
    }

    async fn save_graded_commit(
        &self,
        request: Request<SaveGradedCommitRequest>,
    ) -> Result<Response<SaveGradedCommitResponse>, Status> {
        self.require_ta_role().map_err(AppError::grpc_status)?;
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user = self
            .authenticated_user(&request)
            .await
            .map_err(AppError::grpc_status)?;
        let signed = request
            .into_inner()
            .bundle
            .ok_or_else(|| Status::invalid_argument("bundle is required"))?;
        let config = self.config.clone();
        let result = self
            .db
            .transaction_until(deadline, move |conn| {
                mutations::save_graded_commit(conn, &current_user, &signed, &config, ip_allowed)
            })
            .await
            .map_err(AppError::grpc_status)?;
        if result.save_status == crate::proto::CommitSaveStatus::Saved as i32
            && let Some((target, html)) =
                passback_work(&self.db, &result.bundle, result.locked, deadline)
                    .await
                    .map_err(AppError::grpc_status)?
        {
            spawn_grade_passback(self.db.clone(), self.config.clone(), target, html);
        }
        Ok(Response::new(SaveGradedCommitResponse {
            save_status: result.save_status,
        }))
    }

    async fn daycare(
        &self,
        request: Request<DaycareRequest>,
    ) -> Result<Response<Self::DaycareStream>, Status> {
        if !self.daycare_enabled {
            return Err(Status::unavailable("daycare role is not enabled"));
        }
        let daycare = self
            .daycare
            .as_ref()
            .ok_or_else(|| Status::unavailable("daycare runtime is not configured"))?;
        daycare.run(request.into_inner()).await
    }
}

fn request_client_ip<T>(request: &Request<T>) -> Option<String> {
    request
        .metadata()
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_owned())
        .or_else(|| {
            request
                .metadata()
                .get("x-forwarded-for")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(',').next())
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.trim().to_owned())
        })
        .or_else(|| {
            request
                .extensions()
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ConnectInfo(addr)| addr.ip().to_string())
        })
}

fn request_deadline<T>(request: &Request<T>) -> Option<Instant> {
    let timeout = request
        .metadata()
        .get("grpc-timeout")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_grpc_timeout)?;
    Instant::now().checked_add(timeout)
}

fn parse_grpc_timeout(raw: &str) -> Option<Duration> {
    if raw.len() < 2 || raw.len() > 9 {
        return None;
    }
    let (digits, unit) = raw.split_at(raw.len() - 1);
    if digits.len() > 8 {
        return None;
    }
    let value = digits.parse::<u64>().ok()?;
    match unit {
        "H" => value.checked_mul(60 * 60).map(Duration::from_secs),
        "M" => value.checked_mul(60).map(Duration::from_secs),
        "S" => Some(Duration::from_secs(value)),
        "m" => Some(Duration::from_millis(value)),
        "u" => Some(Duration::from_micros(value)),
        "n" => Some(Duration::from_nanos(value)),
        _ => None,
    }
}

fn hello_response(user: UserRow, version: Version, session_key: String) -> HelloResponse {
    HelloResponse {
        session_key,
        user_id: user.user_id,
        user_name: user.user_name,
        user_login: user.user_login,
        is_author: user.author,
        is_instructor: user.instructor,
        is_admin: user.admin,
        version: Some(version),
    }
}

async fn passback_work(
    db: &Db,
    bundle: &crate::proto::RuntimeBundle,
    locked: bool,
    deadline: Option<Instant>,
) -> AppResult<Option<(GradePassbackTarget, String)>> {
    let Some(commit) = &bundle.commit else {
        return Ok(None);
    };
    let Some(key) = &commit.assignment else {
        return Ok(None);
    };
    let key = key.clone();
    let problem_id = bundle.problem_id.clone();
    let total_steps = bundle.total_steps;
    let commit = commit.clone();
    db.transaction_until(deadline, move |conn| {
        if locked {
            update_passback_status(conn, &key, PASSBACK_LOCKED)?;
            return Ok(None);
        }
        let Some(target) = load_passback_target(conn, &key)? else {
            return Ok(None);
        };
        if target.grade_id.is_empty() || target.outcome_url.is_empty() {
            update_passback_status(conn, &key, PASSBACK_NO_TARGET)?;
            return Ok(None);
        }
        update_passback_status(conn, &key, PASSBACK_PENDING)?;
        let total_problems = conn
            .query_row(
                "SELECT COUNT(1) FROM problem_set_problems WHERE problem_set_id = ?",
                params![key.problem_set_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(1);
        let html =
            build_grade_report_html(&commit, &problem_id, total_steps, total_problems.max(1));
        Ok(Some((target, html)))
    })
    .await
}

fn update_passback_status(
    conn: &Connection,
    key: &crate::proto::AssignmentKey,
    status: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE assignments SET grade_passback_status = ? WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
        params![status, key.user_id, key.course_id, key.problem_set_id],
    )?;
    Ok(())
}

fn load_passback_target(
    conn: &Connection,
    key: &crate::proto::AssignmentKey,
) -> AppResult<Option<GradePassbackTarget>> {
    conn.query_row(
        "SELECT assignments.grade_id, assignments.outcome_url, assignments.outcome_ext_accepted, assignments.consumer_key, COALESCE(assignment_scores.assignment_score, 0.0)
         FROM assignments
         NATURAL LEFT JOIN assignment_scores
         WHERE assignments.user_id = ? AND assignments.course_id = ? AND assignments.problem_set_id = ?",
        params![key.user_id, key.course_id, key.problem_set_id],
        |row| {
            Ok(GradePassbackTarget {
                user_id: key.user_id.clone(),
                course_id: key.course_id.clone(),
                problem_set_id: key.problem_set_id.clone(),
                grade_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                outcome_url: row.get(1)?,
                outcome_ext_accepted: row.get(2)?,
                consumer_key: row.get(3)?,
                score: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use chrono::Utc;
    use tonic::Code;

    use super::*;
    use crate::config::{IpFilterConfig, ServerConfig};
    use crate::db::open_test_connection;
    use crate::proto::{
        AssignmentKey, AuthorFile, AuthorProblemDraft, AuthorProblemStepDraft, Commit,
        GetProblemTypesRequest, ListAssignmentsRequest, ProblemTypeAction, RuntimeBundle,
        SaveProblemTypeRequest, SearchProblemCatalogRequest,
    };
    use crate::sessions::create_session;
    use crate::timeutil::db_time;

    #[tokio::test]
    async fn authenticated_rpcs_reject_missing_bearer_metadata() {
        let service = test_service().await;

        let err = service
            .list_assignments(Request::new(ListAssignmentsRequest::default()))
            .await
            .unwrap_err();

        assert_eq!(err.code(), Code::Unauthenticated);
    }

    #[test]
    fn parses_grpc_timeout_metadata_units() {
        assert_eq!(parse_grpc_timeout("10S"), Some(Duration::from_secs(10)));
        assert_eq!(parse_grpc_timeout("250m"), Some(Duration::from_millis(250)));
        assert_eq!(
            parse_grpc_timeout("500000u"),
            Some(Duration::from_millis(500))
        );
        assert_eq!(parse_grpc_timeout("123456789S"), None);
        assert_eq!(parse_grpc_timeout("10x"), None);
    }

    #[tokio::test]
    async fn problem_type_reads_are_public_but_mutations_are_admin_only() {
        let service = test_service().await;
        let student_session = seed_service_users(&service.db, false, false).await.student;
        let admin_session = seed_service_users(&service.db, true, false).await.admin;

        service
            .get_problem_types(Request::new(GetProblemTypesRequest::default()))
            .await
            .unwrap();

        let err = service
            .save_problem_type(auth_request(
                SaveProblemTypeRequest {
                    problem_type: "python".to_owned(),
                    container: "python:latest".to_owned(),
                    actions: BTreeMap::from([("grade".to_owned(), action())]),
                },
                &student_session,
            ))
            .await
            .unwrap_err();
        assert_eq!(err.code(), Code::PermissionDenied);

        service
            .save_problem_type(auth_request(
                SaveProblemTypeRequest {
                    problem_type: "python".to_owned(),
                    container: "python:latest".to_owned(),
                    actions: BTreeMap::from([("grade".to_owned(), action())]),
                },
                &admin_session,
            ))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn admin_counts_as_author_but_student_cannot_prepare_problem() {
        let service = test_service().await;
        let sessions = seed_service_users(&service.db, true, false).await;
        service
            .save_problem_type(auth_request(
                SaveProblemTypeRequest {
                    problem_type: "python".to_owned(),
                    container: "python:latest".to_owned(),
                    actions: BTreeMap::from([("grade".to_owned(), action())]),
                },
                &sessions.admin,
            ))
            .await
            .unwrap();

        let err = service
            .prepare_problem(auth_request(prepare_request(), &sessions.student))
            .await
            .unwrap_err();
        assert_eq!(err.code(), Code::PermissionDenied);

        service
            .prepare_problem(auth_request(prepare_request(), &sessions.admin))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn student_context_flag_does_not_expand_student_visibility() {
        let service = test_service().await;
        let sessions = seed_service_users(&service.db, false, true).await;
        seed_service_assignments(&service.db).await;

        let student_items = service
            .list_assignments(auth_request(
                ListAssignmentsRequest {
                    include_student_context: true,
                    ..ListAssignmentsRequest::default()
                },
                &sessions.student,
            ))
            .await
            .unwrap()
            .into_inner()
            .items;
        assert_eq!(student_items.len(), 1);
        assert_eq!(
            student_items[0].assignment.as_ref().unwrap().user_id,
            "student"
        );

        let instructor_items = service
            .list_assignments(auth_request(
                ListAssignmentsRequest {
                    include_student_context: true,
                    ..ListAssignmentsRequest::default()
                },
                &sessions.instructor,
            ))
            .await
            .unwrap()
            .into_inner()
            .items;
        assert_eq!(instructor_items.len(), 2);
    }

    #[tokio::test]
    async fn problem_catalog_search_requires_instructor_or_author() {
        let service = test_service().await;
        let sessions = seed_service_users(&service.db, true, true).await;

        let err = service
            .search_problem_catalog(auth_request(
                SearchProblemCatalogRequest::default(),
                &sessions.student,
            ))
            .await
            .unwrap_err();
        assert_eq!(err.code(), Code::PermissionDenied);

        service
            .search_problem_catalog(auth_request(
                SearchProblemCatalogRequest::default(),
                &sessions.instructor,
            ))
            .await
            .unwrap();
        service
            .search_problem_catalog(auth_request(
                SearchProblemCatalogRequest::default(),
                &sessions.admin,
            ))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn restricted_assignment_ip_filter_uses_direct_peer_and_proxy_headers() {
        let mut service = test_service().await;
        service.ip_filter = IpFilter::from_entries(&["203.0.113.0/24".to_owned()]);
        let sessions = seed_service_users(&service.db, false, false).await;
        seed_service_assignments(&service.db).await;
        service
            .db
            .transaction(|conn| {
                conn.execute(
                    "UPDATE assignments SET restricted = 1 WHERE user_id = 'student'",
                    [],
                )?;
                Ok(())
            })
            .await
            .unwrap();

        let mut direct = auth_request(ListAssignmentsRequest::default(), &sessions.student);
        direct.extensions_mut().insert(ConnectInfo(
            "203.0.113.9:12345".parse::<SocketAddr>().unwrap(),
        ));
        let direct_items = service
            .list_assignments(direct)
            .await
            .unwrap()
            .into_inner()
            .items;
        assert_eq!(direct_items.len(), 1);

        let mut proxied = auth_request(ListAssignmentsRequest::default(), &sessions.student);
        proxied.metadata_mut().insert(
            "x-forwarded-for",
            "203.0.113.10, 198.51.100.7".parse().unwrap(),
        );
        proxied.extensions_mut().insert(ConnectInfo(
            "198.51.100.7:12345".parse::<SocketAddr>().unwrap(),
        ));
        let proxied_items = service
            .list_assignments(proxied)
            .await
            .unwrap()
            .into_inner()
            .items;
        assert_eq!(proxied_items.len(), 1);

        let mut denied = auth_request(ListAssignmentsRequest::default(), &sessions.student);
        denied.extensions_mut().insert(ConnectInfo(
            "198.51.100.7:12345".parse::<SocketAddr>().unwrap(),
        ));
        let denied_items = service
            .list_assignments(denied)
            .await
            .unwrap()
            .into_inner()
            .items;
        assert!(denied_items.is_empty());
    }

    #[tokio::test]
    async fn passback_work_uses_assignment_score_and_marks_pending() {
        let service = test_service().await;
        seed_service_users(&service.db, false, false).await;
        seed_service_assignments(&service.db).await;
        seed_second_step_and_scores(&service.db).await;
        let bundle = runtime_bundle_for_passback(2);

        let (target, _) = passback_work(&service.db, &bundle, false, None)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(target.score, 0.5);
        assert_eq!(
            assignment_passback_status(&service.db).await,
            PASSBACK_PENDING
        );
    }

    #[tokio::test]
    async fn locked_passback_work_marks_deadline_skip_without_target() {
        let service = test_service().await;
        seed_service_users(&service.db, false, false).await;
        seed_service_assignments(&service.db).await;
        let bundle = runtime_bundle_for_passback(1);

        let work = passback_work(&service.db, &bundle, true, None)
            .await
            .unwrap();

        assert!(work.is_none());
        assert_eq!(
            assignment_passback_status(&service.db).await,
            PASSBACK_LOCKED
        );
    }

    struct Sessions {
        student: String,
        admin: String,
        instructor: String,
    }

    async fn test_service() -> CodeGrinderServer {
        let dir = tempfile::tempdir().unwrap().keep();
        let config = Arc::new(ServerConfig {
            hostname: "ta.example".to_owned(),
            ta_hostname: String::new(),
            daycare_secret: "daycare-secret".to_owned(),
            lti_secret: "lti-secret".to_owned(),
            session_secret: "session-secret".to_owned(),
            capacity: 1,
            problem_types: vec!["python".to_owned()],
            tool_name: "CodeGrinder".to_owned(),
            tool_id: "codegrinder".to_owned(),
            tool_description: "Programming exercises".to_owned(),
            container_engine: "sh".to_owned(),
            sqlite3_path: dir.join("db.sqlite"),
            sessions_expire: Vec::new(),
            ip_filter: IpFilterConfig::default(),
        });
        open_test_connection(&config.sqlite3_path).unwrap();
        let db = Db::open(&config.sqlite3_path).unwrap();
        let daycare = DaycareRuntime::new(config.clone()).unwrap();
        CodeGrinderServer::new(CodeGrinderServerParts {
            db,
            config: config.clone(),
            login_tokens: Arc::new(LoginTokens::default()),
            registry: Arc::new(
                DaycareRegistry::new("daycare-secret".to_owned(), "test".to_owned()).with_local(
                    "ta.example",
                    &["python".to_owned()],
                    1,
                ),
            ),
            daycare: Some(daycare),
            ip_filter: IpFilter::default(),
            version: VersionPayload {
                version: "test".to_owned(),
                grind_version_required: String::new(),
                grind_version_recommended: String::new(),
            },
            ta_enabled: true,
            daycare_enabled: true,
        })
    }

    async fn seed_service_users(db: &Db, admin: bool, instructor: bool) -> Sessions {
        db.transaction(move |conn| {
            conn.execute(
                "INSERT INTO users(user_id, user_name, user_login, admin) VALUES ('student', 'Student', 'student', 0)
                 ON CONFLICT(user_id) DO NOTHING",
                [],
            )?;
            conn.execute(
                "INSERT INTO users(user_id, user_name, user_login, admin) VALUES ('admin', 'Admin', 'admin', ?)
                 ON CONFLICT(user_id) DO UPDATE SET admin = excluded.admin",
                params![if admin { 1 } else { 0 }],
            )?;
            conn.execute(
                "INSERT INTO users(user_id, user_name, user_login, admin) VALUES ('instructor', 'Instructor', 'instructor', 0)
                 ON CONFLICT(user_id) DO NOTHING",
                [],
            )?;
            conn.execute(
                "INSERT INTO courses(course_id, course_name) VALUES ('c1', 'Course')
                 ON CONFLICT(course_id) DO NOTHING",
                [],
            )?;
            for (user_id, roles) in [
                ("student", "Learner"),
                ("admin", "Learner"),
                (
                    "instructor",
                    if instructor { "Instructor" } else { "Learner" },
                ),
            ] {
                conn.execute(
                    "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES (?, 'c1', ?)
                     ON CONFLICT(user_id, course_id) DO UPDATE SET course_roles = excluded.course_roles",
                    params![user_id, roles],
                )?;
            }
            let student = create_session(conn, "student", Utc::now(), &[], "session-secret")?;
            let admin = create_session(conn, "admin", Utc::now(), &[], "session-secret")?;
            let instructor = create_session(conn, "instructor", Utc::now(), &[], "session-secret")?;
            Ok(Sessions {
                student: student.session_key,
                admin: admin.session_key,
                instructor: instructor.session_key,
            })
        })
        .await
        .unwrap()
    }

    async fn seed_service_assignments(db: &Db) {
        db.transaction(|conn| {
            crate::mutations::save_problem_type(
                conn,
                "python",
                "python:latest",
                &BTreeMap::from([("grade".to_owned(), action())]),
            )?;
            conn.execute(
                "INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at)
                 VALUES ('p1', 'Problem', '[]', '[]', ?, ?)",
                params![db_time(Utc::now()), db_time(Utc::now())],
            )?;
            conn.execute(
                "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight)
                 VALUES ('p1', 1, 'python', 'Step', 1)",
                [],
            )?;
            conn.execute(
                "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content)
                 VALUES ('p1', 1, 'solution', 'answer.txt', x'6f6b')",
                [],
            )?;
            conn.execute(
                "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at)
                 VALUES ('ps1', 'Set', '[]', ?, ?)",
                params![db_time(Utc::now()), db_time(Utc::now())],
            )?;
            conn.execute(
                "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight)
                 VALUES ('ps1', 'p1', 1)",
                [],
            )?;
            conn.execute(
                "INSERT INTO users(user_id, user_name, user_login) VALUES ('other', 'Other', 'other')",
                [],
            )?;
            conn.execute(
                "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES ('other', 'c1', 'Learner')",
                [],
            )?;
            for user_id in ["student", "other"] {
                conn.execute(
                    "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key)
                     VALUES (?, 'c1', 'ps1', 'Assignment', 0, ?, 'https://lms.example/outcome', 'text', 'consumer')",
                    params![user_id, format!("{user_id}-grade")],
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();
    }

    async fn seed_second_step_and_scores(db: &Db) {
        db.transaction(|conn| {
            conn.execute(
                "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight)
                 VALUES ('p1', 2, 'python', 'Step 2', 1)",
                [],
            )?;
            conn.execute(
                "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content)
                 VALUES ('p1', 2, 'solution', 'answer.txt', x'6f6b')",
                [],
            )?;
            for (step, score) in [(1, 1.0), (2, 0.0)] {
                conn.execute(
                    "INSERT INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at)
                     VALUES ('student', 'c1', 'ps1', 'p1', ?, 'grade', 'test', '[]', '{\"passed\": true, \"note\": \"\", \"duration\": 0, \"results\": []}', ?, ?, ?)",
                    params![step, score, db_time(Utc::now()), db_time(Utc::now())],
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();
    }

    async fn assignment_passback_status(db: &Db) -> String {
        db.transaction(|conn| {
            Ok(conn.query_row(
                "SELECT grade_passback_status FROM assignments WHERE user_id = 'student' AND course_id = 'c1' AND problem_set_id = 'ps1'",
                [],
                |row| row.get::<_, String>(0),
            )?)
        })
        .await
        .unwrap()
    }

    fn runtime_bundle_for_passback(step: i64) -> RuntimeBundle {
        RuntimeBundle {
            assignment: Some(AssignmentKey {
                user_id: "student".to_owned(),
                course_id: "c1".to_owned(),
                problem_set_id: "ps1".to_owned(),
            }),
            problem_id: "p1".to_owned(),
            total_steps: 2,
            commit: Some(Commit {
                assignment: Some(AssignmentKey {
                    user_id: "student".to_owned(),
                    course_id: "c1".to_owned(),
                    problem_set_id: "ps1".to_owned(),
                }),
                problem_id: "p1".to_owned(),
                step,
                score: 0.0,
                ..Commit::default()
            }),
            ..RuntimeBundle::default()
        }
    }

    fn auth_request<T>(message: T, session: &str) -> Request<T> {
        let mut request = Request::new(message);
        request.metadata_mut().insert(
            "authorization",
            format!("Bearer {session}").parse().unwrap(),
        );
        request
    }

    fn prepare_request() -> PrepareProblemRequest {
        PrepareProblemRequest {
            draft: Some(AuthorProblemDraft {
                problem_id: "new-problem".to_owned(),
                problem_note: "New problem".to_owned(),
                steps: vec![AuthorProblemStepDraft {
                    step_number: 1,
                    problem_type: "python".to_owned(),
                    note: "step".to_owned(),
                    weight: 1.0,
                    files: vec![AuthorFile {
                        path: "answer.txt".to_owned(),
                        content: b"solution".to_vec(),
                    }],
                    starter_files: vec![AuthorFile {
                        path: "answer.txt".to_owned(),
                        content: b"starter".to_vec(),
                    }],
                }],
                ..AuthorProblemDraft::default()
            }),
            action: String::new(),
        }
    }

    fn action() -> ProblemTypeAction {
        ProblemTypeAction {
            command: "pytest".to_owned(),
            parser: "xunit".to_owned(),
            max_cpu: 10,
            max_fd: 20,
            max_file_size: 30,
            max_memory: 40,
            max_threads: 2,
        }
    }
}
