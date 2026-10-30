use std::collections::BTreeSet;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ConnectInfo;
use rusqlite::{Connection, OptionalExtension, params};
use tokio::sync::mpsc;
use tokio_stream::{StreamExt, wrappers::ReceiverStream};
use tonic::{Code, Request, Response, Status};

use crate::config::ServerConfig;
use crate::daycare::{DaycareRuntime, DaycareStream, ExecutionUpdate};
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
    AssignmentActionResult, AuthorProblemProgress, AuthorProblemResult, DaycareRequest,
    GetAssignmentRequest, GetAssignmentResponse, GetProblemTypeRequest, GetProblemTypeResponse,
    GetProblemTypesRequest, GetProblemTypesResponse, GetWorkspaceRequest, GetWorkspaceResponse,
    HelloRequest, HelloResponse, ListAssignmentsRequest, ListAssignmentsResponse,
    PrepareProblemRequest, PrepareProblemResponse, RunAssignmentActionRequest,
    RunAssignmentActionResponse, RunAuthorProblemRequest, RunAuthorProblemResponse,
    SaveGradedCommitRequest, SaveGradedCommitResponse, SaveMode, SaveProblemRequest,
    SaveProblemResponse, SaveProblemSetRequest, SaveProblemSetResponse,
    SaveProblemTypeFilesRequest, SaveProblemTypeFilesResponse, SaveProblemTypeRequest,
    SaveProblemTypeResponse, SaveUngradedCommitRequest, SaveUngradedCommitResponse,
    SaveWorkspaceCommitRequest, SaveWorkspaceCommitResponse, SearchProblemCatalogRequest,
    SearchProblemCatalogResponse, Version, author_problem_progress, run_assignment_action_response,
    run_author_problem_request, run_author_problem_response,
};
use crate::sessions::{LoginTokens, create_session, load_session_user_id};
use crate::store::{self, UserRow};
use crate::timeutil::now_utc;

#[derive(Clone)]
pub struct CodeGrinderServer {
    db: Db,
    config: Arc<ServerConfig>,
    login_tokens: Arc<LoginTokens>,
    daycare: DaycareRuntime,
    ip_filter: IpFilter,
    version: VersionPayload,
}

pub struct CodeGrinderServerParts {
    pub db: Db,
    pub config: Arc<ServerConfig>,
    pub login_tokens: Arc<LoginTokens>,
    pub daycare: DaycareRuntime,
    pub ip_filter: IpFilter,
    pub version: VersionPayload,
}

impl CodeGrinderServer {
    pub fn new(parts: CodeGrinderServerParts) -> Self {
        Self {
            db: parts.db,
            config: parts.config,
            login_tokens: parts.login_tokens,
            daycare: parts.daycare,
            ip_filter: parts.ip_filter,
            version: parts.version,
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
        let quiz_ip_allowed = self.ip_filter.enabled() && self.ip_allowed(request);
        let station_ip = request_client_ip(request)
            .and_then(|ip| ip.parse::<IpAddr>().ok())
            .map(|ip| ip.to_string());
        self.db
            .transaction_until(true, request_deadline(request), move |conn| {
                let user_id =
                    load_session_user_id(conn, &session_key, &config.session_secret, now_utc())?;
                let hash = crate::sessions::session_key_hash(&session_key, &config.session_secret)?;
                let mut user = store::load_user_by_id(conn, &user_id)?;
                user.quiz_scope = crate::quiz::load_scope(conn, &hash, station_ip.as_deref())?;
                if user.quiz_scope.is_some() {
                    if !quiz_ip_allowed {
                        return Err(AppError::Forbidden(
                            "quiz access requires an approved testing-center station".into(),
                        ));
                    }
                    user.admin = false;
                    user.author = false;
                    user.instructor = false;
                }
                Ok(user)
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
            Err(AppError::Forbidden("user is not an instructor or author".to_owned()))
        }
    }

    fn ip_allowed<T>(&self, request: &Request<T>) -> bool {
        if !self.ip_filter.enabled() {
            return true;
        }
        request_client_ip(request).is_some_and(|ip| self.ip_filter.allows(&ip))
    }

    fn select_daycare_host(&self, problem_types: &BTreeSet<String>) -> AppResult<String> {
        // All requested types must be installed on the local execution host.
        if !problem_types.iter().all(|name| self.config.problem_types.contains(name)) {
            crate::logging::record(
                "ERROR",
                "daycare_selection_failed",
                format_args!("problem_types={problem_types:?}"),
            );
            return Err(AppError::Internal(
                "local daycare does not support the requested problem types".to_owned(),
            ));
        }
        Ok(self.config.hostname.clone())
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
    type RunAssignmentActionStream = ReceiverStream<Result<RunAssignmentActionResponse, Status>>;
    type RunAuthorProblemStream = ReceiverStream<Result<RunAuthorProblemResponse, Status>>;

    async fn run_assignment_action(
        &self,
        request: Request<RunAssignmentActionRequest>,
    ) -> Result<Response<Self::RunAssignmentActionStream>, Status> {
        let deadline = execution_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let actor = self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        let actor_log = actor.user_id.clone();
        let actor_for_save = actor.clone();
        let types = self.config.problem_types.clone();
        let req = request.into_inner();
        let prepared = self
            .db
            .transaction_until(true, Some(deadline), move |conn| {
                mutations::prepare_assignment_action(conn, &actor, req, ip_allowed, &types)
            })
            .await
            .map_err(|err| err.grpc_status_for("RunAssignmentAction", Some(&actor_log)))?;
        let server = self.clone();
        Ok(Response::new(operation_stream(
            deadline,
            "RunAssignmentAction",
            actor_log,
            move |tx| async move {
                let grade = prepared.bundle.action == "grade";
                let mut execution = server.daycare.execute(prepared.bundle, Some(deadline));
                while let Some(update) = execution.next().await {
                    match update.map_err(execution_failure)? {
                        ExecutionUpdate::Event(event) => {
                            send_update(
                                &tx,
                                RunAssignmentActionResponse {
                                    response: Some(
                                        run_assignment_action_response::Response::Event(*event),
                                    ),
                                },
                            )
                            .await?;
                        }
                        ExecutionUpdate::Completed(runtime) => {
                            // The engine has stopped student processes and captured a stable
                            // result. Container removal may finish independently of persistence.
                            let result = if grade {
                                let saved = server
                                    .db
                                    .transaction_until(true, Some(deadline), move |conn| {
                                        mutations::save_local_grade(
                                            conn,
                                            &actor_for_save,
                                            *runtime,
                                            ip_allowed,
                                        )
                                    })
                                    .await?;
                                if saved.save_status == crate::proto::CommitSaveStatus::Saved as i32
                                    && let Some((target, html)) = passback_work(
                                        &server.db,
                                        &saved.bundle,
                                        saved.locked,
                                        Some(deadline),
                                    )
                                    .await?
                                {
                                    spawn_grade_passback(
                                        server.db.clone(),
                                        server.config.clone(),
                                        target,
                                        html,
                                    );
                                }
                                AssignmentActionResult {
                                    save_status: saved.save_status,
                                    grade: saved.bundle.commit,
                                    locked_for_lms: saved.locked,
                                }
                            } else {
                                AssignmentActionResult {
                                    save_status: prepared.save_status,
                                    grade: None,
                                    locked_for_lms: false,
                                }
                            };
                            send_update(
                                &tx,
                                RunAssignmentActionResponse {
                                    response: Some(
                                        run_assignment_action_response::Response::Result(result),
                                    ),
                                },
                            )
                            .await?;
                            return Ok(());
                        }
                    }
                }
                Err(AppError::Internal("execution ended without a result".to_owned()))
            },
        )))
    }

    async fn run_author_problem(
        &self,
        request: Request<RunAuthorProblemRequest>,
    ) -> Result<Response<Self::RunAuthorProblemStream>, Status> {
        let deadline = execution_deadline(&request);
        let actor = self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        Self::require_author(&actor).map_err(AppError::grpc_status)?;
        let actor_log = actor.user_id.clone();
        let actor_for_save = actor.user_id.clone();
        let req = request.into_inner();
        let (mode, selected_step, action) = match req.operation {
            Some(run_author_problem_request::Operation::Save(mode)) => {
                match SaveMode::try_from(mode) {
                    Ok(mode @ (SaveMode::Create | SaveMode::Update)) => {
                        (Some(mode), None, "grade".to_owned())
                    }
                    _ => return Err(Status::invalid_argument("choose create or update")),
                }
            }
            Some(run_author_problem_request::Operation::Action(action))
                if action.step > 0 && !action.action.is_empty() =>
            {
                (None, Some(action.step), action.action)
            }
            _ => return Err(Status::invalid_argument("choose create/update or a step action")),
        };
        let draft = req.draft.ok_or_else(|| Status::invalid_argument("draft is required"))?;
        if selected_step.is_some_and(|step| step > draft.steps.len() as i64) {
            return Err(Status::invalid_argument("action step is outside the problem"));
        }
        let types = self.config.problem_types.clone();
        let prepared = self
            .db
            .transaction_until(false, Some(deadline), move |conn| {
                mutations::prepare_local_problem(
                    conn,
                    &actor,
                    &draft,
                    &action,
                    selected_step,
                    &types,
                )
            })
            .await
            .map_err(|err| err.grpc_status_for("RunAuthorProblem", Some(&actor_log)))?;
        let server = self.clone();
        Ok(Response::new(operation_stream(
            deadline,
            "RunAuthorProblem",
            actor_log,
            move |tx| async move {
                let mut validated = Vec::new();
                for runtime in &prepared.runtimes {
                    let step = runtime.step_number;
                    let mut execution = server.daycare.execute(runtime.clone(), Some(deadline));
                    let mut completed = false;
                    while let Some(update) = execution.next().await {
                        let progress = match update.map_err(execution_failure)? {
                            ExecutionUpdate::Event(event) => {
                                author_problem_progress::Response::Event(*event)
                            }
                            ExecutionUpdate::Completed(runtime) => {
                                let commit = runtime.commit.ok_or_else(|| {
                                    AppError::Internal("execution returned no commit".to_owned())
                                })?;
                                completed = true;
                                validated.push(commit.clone());
                                author_problem_progress::Response::Validation(commit)
                            }
                        };
                        send_update(
                            &tx,
                            RunAuthorProblemResponse {
                                response: Some(run_author_problem_response::Response::Progress(
                                    Box::new(AuthorProblemProgress {
                                        step,
                                        response: Some(progress),
                                    }),
                                )),
                            },
                        )
                        .await?;
                        if completed {
                            break;
                        }
                    }
                    if !completed {
                        return Err(AppError::Internal(
                            "execution ended without a result".to_owned(),
                        ));
                    }
                    if mode.is_some()
                        && validated.last().is_none_or(|commit| {
                            !commit.report_card.as_ref().is_some_and(|report| report.passed)
                                || commit.score != 1.0
                        })
                    {
                        return Err(AppError::BadRequest(
                            "solution did not pass validation; please fix it and try again"
                                .to_owned(),
                        ));
                    }
                }
                let problem_id = prepared.problem.problem_id.clone();
                if let Some(mode) = mode {
                    server
                        .db
                        .transaction_until(true, Some(deadline), move |conn| {
                            let actor = store::load_user_by_id(conn, &actor_for_save)?;
                            Self::require_author(&actor)?;
                            mutations::save_local_problem(conn, mode, &prepared, &validated)
                        })
                        .await?;
                }
                send_update(
                    &tx,
                    RunAuthorProblemResponse {
                        response: Some(run_author_problem_response::Response::Result(
                            AuthorProblemResult { problem_id, saved: mode.is_some() },
                        )),
                    },
                )
                .await
            },
        )))
    }

    async fn hello(
        &self,
        request: Request<HelloRequest>,
    ) -> Result<Response<HelloResponse>, Status> {
        let config = self.config.clone();
        let version = self.version();
        let deadline = request_deadline(&request);
        let token = request.get_ref().token.clone();
        if !token.is_empty() {
            let user_id =
                self.login_tokens.take(&token, now_utc()).map_err(AppError::grpc_status)?;
            let response = self
                .db
                .transaction_until(true, deadline, move |conn| {
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
        let user = self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        Ok(Response::new(hello_response(user, version, String::new())))
    }

    async fn list_assignments(
        &self,
        request: Request<ListAssignmentsRequest>,
    ) -> Result<Response<ListAssignmentsResponse>, Status> {
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let items = self
            .db
            .transaction_until(false, deadline, move |conn| {
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
        let deadline = request_deadline(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        Self::require_catalog_search(&current_user).map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let problem_sets = self
            .db
            .transaction_until(false, deadline, move |conn| {
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
        let deadline = request_deadline(&request);
        let problem_types = self
            .db
            .transaction_until(false, deadline, store::list_problem_types)
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(GetProblemTypesResponse { problem_types }))
    }

    async fn get_problem_type(
        &self,
        request: Request<GetProblemTypeRequest>,
    ) -> Result<Response<GetProblemTypeResponse>, Status> {
        let deadline = request_deadline(&request);
        let problem_type_name = request.into_inner().problem_type;
        let problem_type = self
            .db
            .transaction_until(false, deadline, move |conn| {
                store::load_problem_type(conn, &problem_type_name)
            })
            .await
            .map_err(AppError::grpc_status)?;
        Ok(Response::new(GetProblemTypeResponse { problem_type: Some(problem_type) }))
    }

    async fn save_problem_type_files(
        &self,
        request: Request<SaveProblemTypeFilesRequest>,
    ) -> Result<Response<SaveProblemTypeFilesResponse>, Status> {
        let deadline = request_deadline(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        Self::require_admin(&current_user).map_err(AppError::grpc_status)?;
        let actor = format!("{} ({})", current_user.user_name, current_user.user_id);
        let req = request.into_inner();
        let problem_type = self
            .db
            .transaction_until(true, deadline, move |conn| {
                mutations::save_problem_type_files(conn, &req.problem_type, &req.files)
            })
            .await
            .map_err(AppError::grpc_status)?;
        eprintln!(
            "problem type files saved: actor={actor:?} problem_type={:?}",
            problem_type.problem_type
        );
        Ok(Response::new(SaveProblemTypeFilesResponse { problem_type: Some(problem_type) }))
    }

    async fn save_problem_type(
        &self,
        request: Request<SaveProblemTypeRequest>,
    ) -> Result<Response<SaveProblemTypeResponse>, Status> {
        let deadline = request_deadline(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        Self::require_admin(&current_user).map_err(AppError::grpc_status)?;
        let actor = format!("{} ({})", current_user.user_name, current_user.user_id);
        let req = request.into_inner();
        let problem_type_name = req.problem_type.clone();
        let problem_types = self
            .db
            .transaction_until(true, deadline, move |conn| {
                mutations::save_problem_type(conn, &req.problem_type, &req.container, &req.actions)
            })
            .await
            .map_err(AppError::grpc_status)?;
        eprintln!("problem type saved: actor={actor:?} problem_type={problem_type_name:?}");
        Ok(Response::new(SaveProblemTypeResponse { problem_types }))
    }

    async fn get_assignment(
        &self,
        request: Request<GetAssignmentRequest>,
    ) -> Result<Response<GetAssignmentResponse>, Status> {
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        let key = request
            .into_inner()
            .assignment
            .ok_or_else(|| Status::invalid_argument("assignment is required"))?;
        let response = self
            .db
            .transaction_until(false, deadline, move |conn| {
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
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let key =
            req.assignment.ok_or_else(|| Status::invalid_argument("assignment is required"))?;
        let response = self
            .db
            .transaction_until(false, deadline, move |conn| {
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
        eprintln!("warning: legacy RPC PrepareProblem invoked");
        let deadline = request_deadline(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        Self::require_author(&current_user).map_err(AppError::grpc_status)?;
        let req = request.into_inner();
        let draft = req.draft.ok_or_else(|| Status::invalid_argument("draft is required"))?;
        let config = self.config.clone();
        let this = self.clone();
        let bundle = self
            .db
            .transaction_until(false, deadline, move |conn| {
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
        Ok(Response::new(PrepareProblemResponse { bundle: Some(bundle) }))
    }

    async fn save_problem(
        &self,
        request: Request<SaveProblemRequest>,
    ) -> Result<Response<SaveProblemResponse>, Status> {
        eprintln!("warning: legacy RPC SaveProblem invoked");
        let deadline = request_deadline(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        Self::require_author(&current_user).map_err(AppError::grpc_status)?;
        let actor = format!("{} ({})", current_user.user_name, current_user.user_id);
        let req = request.into_inner();
        let mode = req.mode;
        let bundle = req.bundle.ok_or_else(|| Status::invalid_argument("bundle is required"))?;
        let config = self.config.clone();
        let saved = self
            .db
            .transaction_until(true, deadline, move |conn| {
                mutations::save_problem(conn, &current_user, req.mode, &bundle, &config)
            })
            .await
            .map_err(AppError::grpc_status)?;
        eprintln!(
            "problem saved: actor={actor:?} mode={mode} problem={:?}",
            saved.problem.as_ref().map(|problem| &problem.problem_id)
        );
        Ok(Response::new(SaveProblemResponse { bundle: Some(saved) }))
    }

    async fn save_problem_set(
        &self,
        request: Request<SaveProblemSetRequest>,
    ) -> Result<Response<SaveProblemSetResponse>, Status> {
        let deadline = request_deadline(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        Self::require_author(&current_user).map_err(AppError::grpc_status)?;
        let actor = format!("{} ({})", current_user.user_name, current_user.user_id);
        let req = request.into_inner();
        let mode = req.mode;
        let bundle = req.bundle.ok_or_else(|| Status::invalid_argument("bundle is required"))?;
        let saved = self
            .db
            .transaction_until(true, deadline, move |conn| {
                mutations::save_problem_set(conn, req.mode, &bundle)
            })
            .await
            .map_err(AppError::grpc_status)?;
        eprintln!(
            "problem set saved: actor={actor:?} mode={mode} problem_set={:?}",
            saved.problem_set.as_ref().map(|set| &set.problem_set_id)
        );
        Ok(Response::new(SaveProblemSetResponse { bundle: Some(saved) }))
    }

    async fn save_workspace_commit(
        &self,
        request: Request<SaveWorkspaceCommitRequest>,
    ) -> Result<Response<SaveWorkspaceCommitResponse>, Status> {
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        let commit = request
            .into_inner()
            .commit
            .ok_or_else(|| Status::invalid_argument("commit is required"))?;
        let (save_status, _) = self
            .db
            .transaction_until(true, deadline, move |conn| {
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
        eprintln!("warning: legacy RPC SaveUngradedCommit invoked");
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        let actor = format!("{} ({})", current_user.user_name, current_user.user_id);
        let req = request.into_inner();
        let commit = req.commit.ok_or_else(|| Status::invalid_argument("commit is required"))?;
        let config = self.config.clone();
        let this = self.clone();
        let result = self
            .db
            .transaction_until(true, deadline, move |conn| {
                mutations::save_ungraded_commit(conn, &current_user, &commit, ip_allowed, |types| {
                    this.select_daycare_host(types)
                })
            })
            .await
            .map_err(|err| err.grpc_status_for("SaveUngradedCommit", Some(&actor)))?;
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
        eprintln!("warning: legacy RPC SaveGradedCommit invoked");
        let deadline = request_deadline(&request);
        let ip_allowed = self.ip_allowed(&request);
        let current_user =
            self.authenticated_user(&request).await.map_err(AppError::grpc_status)?;
        let actor = format!("{} ({})", current_user.user_name, current_user.user_id);
        let signed = request
            .into_inner()
            .bundle
            .ok_or_else(|| Status::invalid_argument("bundle is required"))?;
        let config = self.config.clone();
        let result = self
            .db
            .transaction_until(true, deadline, move |conn| {
                mutations::save_graded_commit(conn, &current_user, &signed, &config, ip_allowed)
            })
            .await
            .map_err(|err| err.grpc_status_for("SaveGradedCommit", Some(&actor)))?;
        if result.save_status == crate::proto::CommitSaveStatus::Saved as i32
            && let Some((target, html)) =
                passback_work(&self.db, &result.bundle, result.locked, deadline)
                    .await
                    .map_err(AppError::grpc_status)?
        {
            spawn_grade_passback(self.db.clone(), self.config.clone(), target, html);
        }
        Ok(Response::new(SaveGradedCommitResponse { save_status: result.save_status }))
    }

    async fn daycare(
        &self,
        request: Request<DaycareRequest>,
    ) -> Result<Response<Self::DaycareStream>, Status> {
        eprintln!("warning: legacy RPC Daycare invoked");
        let deadline = request_deadline(&request);
        self.daycare.run(request.into_inner(), deadline).await
    }
}

fn execution_deadline<T>(request: &Request<T>) -> Instant {
    request_deadline(request).unwrap_or_else(|| Instant::now() + Duration::from_secs(120))
}

fn execution_failure(status: Status) -> AppError {
    match status.code() {
        Code::DeadlineExceeded => AppError::DeadlineExceeded(status.message().to_owned()),
        Code::InvalidArgument | Code::Cancelled => {
            AppError::BadRequest(status.message().to_owned())
        }
        _ => AppError::Internal(status.message().to_owned()),
    }
}

// The coordinator owns the execution stream. Dropping it cancels daycare work;
// the daycare worker retains ownership of container cleanup until it finishes.
fn operation_stream<T, F, W>(
    deadline: Instant,
    operation: &'static str,
    actor: String,
    work: F,
) -> ReceiverStream<Result<T, Status>>
where
    T: Send + 'static,
    F: FnOnce(mpsc::Sender<Result<T, Status>>) -> W + Send + 'static,
    W: Future<Output = AppResult<()>> + Send + 'static,
{
    let (tx, rx) = mpsc::channel(64);
    tokio::spawn(async move {
        let result = tokio::select! {
            biased;
            _ = tx.closed() => return,
            result = tokio::time::timeout_at(deadline.into(), work(tx.clone())) => {
                result.unwrap_or_else(|_| Err(AppError::DeadlineExceeded("execution request timed out".to_owned())))
            }
        };
        if let Err(err) = result {
            let _ = tx.send(Err(err.grpc_status_for(operation, Some(&actor)))).await;
        }
    });
    ReceiverStream::new(rx)
}

async fn send_update<T>(tx: &mpsc::Sender<Result<T, Status>>, update: T) -> AppResult<()> {
    tx.send(Ok(update))
        .await
        .map_err(|_| AppError::BadRequest("execution client disconnected".to_owned()))
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
    db.transaction_until(true, deadline, move |conn| {
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
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use chrono::Utc;
    use tonic::Code;

    use super::*;
    use crate::config::{IpFilterConfig, ServerConfig};
    use crate::db::open_test_connection;
    use crate::proto::{
        AssignmentKey, AuthorFile, AuthorProblemDraft, AuthorProblemStepDraft, Commit,
        GetProblemTypesRequest, GradingCommit, ListAssignmentsRequest, ProblemTypeAction,
        RuntimeBundle, SaveProblemTypeRequest, SearchProblemCatalogRequest,
    };
    use crate::sessions::create_session;
    use crate::signatures::decode_signed_runtime_bundle;
    use crate::timeutil::db_time;

    // The real runtime drives this engine through creation, staging, streaming,
    // stop, and removal. No Docker daemon or live database participates.
    async fn execution_service(exec: &str) -> (CodeGrinderServer, Sessions) {
        let mut service = test_service().await;
        let sessions = seed_service_users(&service.db, true, true).await;
        seed_service_assignments(&service.db).await;
        service.db.transaction(true, |conn| {
                conn.execute("UPDATE problem_type_actions SET parser = NULL", [])?;
                conn.execute("UPDATE assignments SET grade_id = NULL", [])?;
            conn.execute(
                "INSERT INTO problem_type_actions SELECT problem_type, 'demo', command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads FROM problem_type_actions WHERE action = 'grade'", []
            )?;
            Ok(())
        }).await.unwrap();
        let script = service.config.sqlite3_path.with_file_name("engine.sh");
        fs::write(&script, format!(
            "#!/bin/sh\ncase \"$1\" in\ncreate) echo fake-container ;;\ninspect) echo false ;;\nexec) {exec} ;;\ncp) cat >/dev/null ;;\n*) exit 0 ;;\nesac\n"
        )).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let config = Arc::make_mut(&mut service.config);
        config.container_engine = script.display().to_string();
        config.daycare_secret.clear();
        service.daycare = DaycareRuntime::new(service.config.clone()).unwrap();
        (service, sessions)
    }

    fn assignment_action(action: &str) -> RunAssignmentActionRequest {
        RunAssignmentActionRequest {
            assignment: Some(AssignmentKey {
                user_id: "student".to_owned(),
                course_id: "c1".to_owned(),
                problem_set_id: "ps1".to_owned(),
            }),
            problem_id: "p1".to_owned(),
            step: 1,
            action: action.to_owned(),
            note: "test action".to_owned(),
            files: BTreeMap::from([("answer.txt".to_owned(), b"submitted".to_vec())]),
        }
    }

    async fn commit_count(db: &Db) -> i64 {
        db.transaction(false, |conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM commits", [], |row| row.get(0))?)
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn quiz_scope_is_preserved_through_rpc_authentication_and_rechecks_station_and_assignment()
     {
        let mut service = test_service().await;
        let sessions = seed_service_users(&service.db, false, true).await;
        seed_service_assignments(&service.db).await;
        service.ip_filter = IpFilter::from_entries(&["192.0.2.0/24".into()]).unwrap();
        service
            .db
            .transaction(true, |conn| {
                conn.execute(
                    "INSERT INTO quiz_assignments VALUES ('student','c1','ps1','configuration')",
                    [],
                )?;
                Ok(())
            })
            .await
            .unwrap();
        let key = AssignmentKey {
            user_id: "student".into(),
            course_id: "c1".into(),
            problem_set_id: "ps1".into(),
        };
        let mut ordinary =
            auth_request(GetAssignmentRequest { assignment: Some(key.clone()) }, &sessions.student);
        ordinary.metadata_mut().insert("x-real-ip", "192.0.2.10".parse().unwrap());
        assert_eq!(
            service.get_assignment(ordinary).await.unwrap_err().code(),
            Code::PermissionDenied
        );
        let hash =
            crate::sessions::session_key_hash(&sessions.student, &service.config.session_secret)
                .unwrap();
        service.db.transaction(true,move |conn| {
            conn.execute("INSERT INTO quiz_sessions VALUES (?,'student','c1','ps1','configuration','192.0.2.10')",[hash])?;
            Ok(())
        }).await.unwrap();
        let mut allowed =
            auth_request(GetAssignmentRequest { assignment: Some(key.clone()) }, &sessions.student);
        allowed.metadata_mut().insert("x-real-ip", "192.0.2.10".parse().unwrap());
        assert!(service.get_assignment(allowed).await.is_ok());
        let mut wrong_ip = auth_request(HelloRequest::default(), &sessions.student);
        wrong_ip.metadata_mut().insert("x-real-ip", "192.0.2.11".parse().unwrap());
        assert_eq!(service.hello(wrong_ip).await.unwrap_err().code(), Code::PermissionDenied);
        let mut other = auth_request(
            GetAssignmentRequest {
                assignment: Some(AssignmentKey { user_id: "other".into(), ..key }),
            },
            &sessions.student,
        );
        other.metadata_mut().insert("x-real-ip", "192.0.2.10".parse().unwrap());
        assert_eq!(service.get_assignment(other).await.unwrap_err().code(), Code::PermissionDenied);
    }

    #[tokio::test]
    async fn combined_grade_streams_output_saves_result_and_reports_server_lock() {
        let (service, sessions) = execution_service("printf 'live output\\n'").await;
        service
            .db
            .transaction(true, |conn| {
                conn.execute("UPDATE assignments SET lock_at = '2000-01-01T00:00:00Z'", [])?;
                Ok(())
            })
            .await
            .unwrap();
        let mut stream = service
            .run_assignment_action(auth_request(assignment_action("grade"), &sessions.student))
            .await
            .unwrap()
            .into_inner();
        let mut output = Vec::new();
        let mut completed = None;
        while let Some(reply) = stream.next().await {
            match reply.unwrap().response.unwrap() {
                run_assignment_action_response::Response::Event(event) => {
                    output.extend(event.stream_data)
                }
                run_assignment_action_response::Response::Result(result) => {
                    completed = Some(result)
                }
            }
        }
        assert_eq!(output, b"live output\n");
        let result = completed.unwrap();
        assert_eq!(result.save_status, crate::proto::CommitSaveStatus::Saved as i32);
        assert!(result.locked_for_lms);
        let grade = result.grade.unwrap();
        assert_eq!(grade.score, 1.0);
        assert!(grade.report_card.unwrap().passed);
        assert_eq!(grade.files, assignment_action("grade").files);
        assert_eq!(assignment_passback_status(&service.db).await, PASSBACK_LOCKED);
        service
            .db
            .transaction(false, |conn| {
                let (action, score, report): (String, f64, String) =
                    conn.query_row("SELECT action, score, report_card FROM commits", [], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })?;
                assert_eq!(action, "grade");
                assert_eq!(score, 1.0);
                assert!(report.contains("passed"));
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn combined_action_saves_files_without_grading_and_inspection_never_saves() {
        let (service, sessions) = execution_service("printf 'action output\\n'").await;
        // A passing instructor grade inspects the original assignment without
        // creating a commit or attempting passback on the student's behalf.
        let mut inspection = service
            .run_assignment_action(auth_request(assignment_action("grade"), &sessions.instructor))
            .await
            .unwrap()
            .into_inner();
        let mut inspected = false;
        while let Some(reply) = inspection.next().await {
            if let Some(run_assignment_action_response::Response::Result(result)) =
                reply.unwrap().response
            {
                assert_eq!(
                    result.save_status,
                    crate::proto::CommitSaveStatus::NotSavedNotOwner as i32
                );
                assert_eq!(result.grade.unwrap().score, 1.0);
                inspected = true;
            }
        }
        assert!(inspected);
        assert_eq!(commit_count(&service.db).await, 0);
        let mut stream = service
            .run_assignment_action(auth_request(assignment_action("demo"), &sessions.student))
            .await
            .unwrap()
            .into_inner();
        let mut completed = false;
        while let Some(reply) = stream.next().await {
            if let Some(run_assignment_action_response::Response::Result(result)) =
                reply.unwrap().response
            {
                assert!(result.grade.is_none());
                completed = true;
            }
        }
        assert!(completed);
        service
            .db
            .transaction(false, |conn| {
                let (action, report): (Option<String>, Option<String>) =
                    conn.query_row("SELECT action, report_card FROM commits", [], |row| {
                        Ok((row.get(0)?, row.get(1)?))
                    })?;
                assert!(action.as_deref().unwrap_or_default().is_empty());
                assert_eq!(report.as_deref(), Some("null"));
                let contents: Vec<u8> =
                    conn.query_row("SELECT content FROM commit_files", [], |row| row.get(0))?;
                assert_eq!(contents, b"submitted");
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn combined_action_rejects_invalid_input_atomically() {
        let (service, sessions) = execution_service("exit 0").await;
        for mut request in [assignment_action("missing"), assignment_action("grade")] {
            if request.action == "grade" {
                request.files.insert("../escape".to_owned(), Vec::new());
            }
            assert!(
                service
                    .run_assignment_action(auth_request(request, &sessions.student))
                    .await
                    .is_err()
            );
            assert_eq!(commit_count(&service.db).await, 0);
        }
        assert!(
            service.run_assignment_action(Request::new(assignment_action("grade"))).await.is_err()
        );
        let mut request = assignment_action("grade");
        request.step = 2;
        assert!(
            service.run_assignment_action(auth_request(request, &sessions.student)).await.is_err()
        );
        assert_eq!(commit_count(&service.db).await, 0);
    }

    async fn wait_for_marker(path: &Path) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while !path.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }

    struct ExecutionGate {
        running: PathBuf,
        release: PathBuf,
        removed: PathBuf,
    }

    fn gate_execution(service: &CodeGrinderServer) -> ExecutionGate {
        let base = service.config.sqlite3_path.parent().unwrap();
        let gate = ExecutionGate {
            running: base.join("running"),
            release: base.join("release"),
            removed: base.join("removed"),
        };
        fs::write(base.join("engine.sh"), format!(
            "#!/bin/sh\ncase \"$1\" in\ncreate) echo fake-container ;;\ninspect) echo false ;;\nexec) touch '{}'; printf 'started\\n'; while [ ! -e '{}' ]; do sleep 0.01; done ;;\ncp) cat >/dev/null ;;\nrm) touch '{}' ;;\n*) exit 0 ;;\nesac\n", gate.running.display(), gate.release.display(), gate.removed.display()
        )).unwrap();
        gate
    }

    #[tokio::test]
    async fn combined_execution_releases_database_and_disconnect_keeps_initial_save() {
        let (service, sessions) = execution_service("exit 0").await;
        let gate = gate_execution(&service);
        let mut stream = service
            .run_assignment_action(auth_request(assignment_action("grade"), &sessions.student))
            .await
            .unwrap()
            .into_inner();
        wait_for_marker(&gate.running).await;
        tokio::time::timeout(Duration::from_secs(1), service.db.transaction(true, |conn| {
            conn.execute("UPDATE problems SET problem_note = 'concurrent bookkeeping' WHERE problem_id = 'p1'", [])?;
            Ok(())
        })).await.unwrap().unwrap();
        let mut live = false;
        while let Some(reply) = stream.next().await {
            if let Some(run_assignment_action_response::Response::Event(event)) =
                reply.unwrap().response
                && event.stream_data == b"started\n"
            {
                live = true;
                break;
            }
        }
        assert!(live);
        drop(stream);
        wait_for_marker(&gate.removed).await;
        assert_eq!(commit_count(&service.db).await, 1);
        service
            .db
            .transaction(false, |conn| {
                let report: Option<String> =
                    conn.query_row("SELECT report_card FROM commits", [], |row| row.get(0))?;
                assert_eq!(report.as_deref(), Some("null"));
                Ok(())
            })
            .await
            .unwrap();
    }

    fn author_request(steps: usize) -> RunAuthorProblemRequest {
        let mut draft = prepare_request().draft.unwrap();
        draft.steps = (1..=steps)
            .map(|number| {
                let mut step = draft.steps[0].clone();
                step.step_number = number as i64;
                step
            })
            .collect();
        RunAuthorProblemRequest {
            draft: Some(draft),
            operation: Some(run_author_problem_request::Operation::Save(SaveMode::Create as i32)),
        }
    }

    #[tokio::test]
    async fn combined_deadline_cancels_execution_without_saving_a_grade() {
        let (service, sessions) = execution_service("exit 0").await;
        let gate = gate_execution(&service);
        let mut request = auth_request(assignment_action("grade"), &sessions.student);
        request.metadata_mut().insert("grpc-timeout", "500m".parse().unwrap());
        let mut stream = service.run_assignment_action(request).await.unwrap().into_inner();
        wait_for_marker(&gate.running).await;
        let mut error = None;
        tokio::time::timeout(Duration::from_secs(5), async {
            while let Some(reply) = stream.next().await {
                match reply {
                    Ok(reply) => assert!(matches!(
                        reply.response,
                        Some(run_assignment_action_response::Response::Event(_))
                    )),
                    Err(status) => error = Some(status),
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(error.unwrap().code(), Code::DeadlineExceeded);
        wait_for_marker(&gate.removed).await;
        assert_eq!(commit_count(&service.db).await, 1);
    }

    #[tokio::test]
    async fn combined_grade_rechecks_step_sequence_after_execution() {
        let (service, sessions) = execution_service("exit 0").await;
        let gate = gate_execution(&service);
        let mut stream = service
            .run_assignment_action(auth_request(assignment_action("grade"), &sessions.student))
            .await
            .unwrap()
            .into_inner();
        wait_for_marker(&gate.running).await;
        // Later saved work can appear while this runtime snapshot executes.
        // The final save must enforce sequencing against current database state.
        service.db.transaction(true, |conn| {
            conn.execute("INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight) VALUES ('p1', 2, 'python', 'Later step', 1)", [])?;
            conn.execute("INSERT INTO commits SELECT user_id, course_id, problem_set_id, problem_id, 2, action, note, transcript, report_card, score, commit_created_at, commit_updated_at FROM commits WHERE step_number = 1", [])?;
            Ok(())
        }).await.unwrap();
        fs::write(&gate.release, []).unwrap();
        let mut error = None;
        while let Some(reply) = stream.next().await {
            if let Err(status) = reply {
                error = Some(status);
            }
        }
        let error = error.unwrap();
        assert_eq!(error.code(), Code::InvalidArgument);
        assert!(error.message().contains("after saved work exists for step 2"));
        service
            .db
            .transaction(false, |conn| {
                let report: String = conn.query_row(
                    "SELECT report_card FROM commits WHERE step_number = 1",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(report, "null");
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn combined_author_uses_prepared_snapshot_and_stays_unpublished_during_execution() {
        let (service, sessions) = execution_service("exit 0").await;
        let gate = gate_execution(&service);
        let mut request = author_request(1);
        request.draft.as_mut().unwrap().steps[0].files.push(AuthorFile {
            path: "harness.txt".to_owned(),
            content: b"validated harness".to_vec(),
        });
        let mut stream = service
            .run_author_problem(auth_request(request, &sessions.admin))
            .await
            .unwrap()
            .into_inner();
        wait_for_marker(&gate.running).await;
        service.db.transaction(true, |conn| {
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM problems WHERE problem_id = 'new-problem'", [], |row| row.get(0))?;
            assert_eq!(count, 0);
            conn.execute("INSERT INTO problem_type_files(problem_type, path, content) VALUES ('python', 'harness.txt', ?)", params![b"new canonical harness".as_slice()])?;
            Ok(())
        }).await.unwrap();
        fs::write(&gate.release, []).unwrap();
        let mut saved = false;
        while let Some(reply) = stream.next().await {
            if let Some(run_author_problem_response::Response::Result(result)) =
                reply.unwrap().response
            {
                saved = result.saved;
            }
        }
        assert!(saved);
        service.db.transaction(false, |conn| {
            let content: Vec<u8> = conn.query_row("SELECT content FROM problem_step_files WHERE problem_id = 'new-problem' AND file_type = 'regular' AND path = 'harness.txt'", [], |row| row.get(0))?;
            assert_eq!(content, b"validated harness");
            Ok(())
        }).await.unwrap();
    }

    #[tokio::test]
    async fn combined_author_action_checks_availability_only_for_the_selected_step() {
        let (mut service, sessions) = execution_service("exit 0").await;
        service
            .db
            .transaction(true, |conn| {
                let mut grade = action();
                grade.parser.clear();
                mutations::save_problem_type(
                    conn,
                    "grade-only",
                    "python:latest",
                    &BTreeMap::from([("grade".to_owned(), grade)]),
                )?;
                Ok(())
            })
            .await
            .unwrap();
        Arc::make_mut(&mut service.config).problem_types.push("grade-only".to_owned());
        let mut request = author_request(2);
        request.draft.as_mut().unwrap().steps[0].problem_type = "grade-only".to_owned();
        request.operation = Some(run_author_problem_request::Operation::Action(
            crate::proto::AuthorProblemAction { step: 2, action: "demo".to_owned() },
        ));
        let mut stream = service
            .run_author_problem(auth_request(request, &sessions.admin))
            .await
            .unwrap()
            .into_inner();
        let mut completed = false;
        while let Some(reply) = stream.next().await {
            match reply.unwrap().response.unwrap() {
                run_author_problem_response::Response::Progress(progress) => {
                    assert_eq!(progress.step, 2)
                }
                run_author_problem_response::Response::Result(result) => {
                    assert!(!result.saved);
                    completed = true;
                }
            }
        }
        assert!(completed);
    }

    #[tokio::test]
    async fn combined_author_saves_only_after_every_step_passes_and_preserves_intent() {
        let (service, sessions) = execution_service("printf 'validation output\\n'").await;
        let mut stream = service
            .run_author_problem(auth_request(author_request(2), &sessions.admin))
            .await
            .unwrap()
            .into_inner();
        let mut steps = Vec::new();
        let mut saved = false;
        while let Some(reply) = stream.next().await {
            match reply.unwrap().response.unwrap() {
                run_author_problem_response::Response::Progress(progress) => {
                    if let Some(author_problem_progress::Response::Validation(commit)) =
                        progress.response
                    {
                        assert_eq!(commit.score, 1.0);
                        steps.push(progress.step);
                    }
                }
                run_author_problem_response::Response::Result(result) => {
                    assert!(result.saved);
                    saved = true;
                }
            }
        }
        assert!(saved);
        assert_eq!(steps, [1, 2]);
        service.db.transaction(false, |conn| {
            let members: i64 = conn.query_row("SELECT COUNT(*) FROM problem_set_problems WHERE problem_set_id = 'new-problem' AND problem_id = 'new-problem'", [], |row| row.get(0))?;
            assert_eq!(members, 1);
            let solutions: i64 = conn.query_row("SELECT COUNT(*) FROM problem_step_files WHERE problem_id = 'new-problem' AND file_type = 'solution' AND content = ?", params![b"solution".as_slice()], |row| row.get(0))?;
            assert_eq!(solutions, 2);
            Ok(())
        }).await.unwrap();
        let mut duplicate = service
            .run_author_problem(auth_request(author_request(2), &sessions.admin))
            .await
            .unwrap()
            .into_inner();
        let mut error = None;
        while let Some(reply) = duplicate.next().await {
            if let Err(status) = reply {
                error = Some(status);
            }
        }
        assert_eq!(error.unwrap().code(), Code::AlreadyExists);
    }

    #[tokio::test]
    async fn combined_author_failed_later_validation_and_action_never_publish() {
        let (service, sessions) = execution_service("exit 0").await;
        let marker = service.config.sqlite3_path.with_file_name("first-validation");
        let script = service.config.sqlite3_path.with_file_name("engine.sh");
        let original = fs::read_to_string(&script).unwrap();
        fs::write(
            &script,
            original.replace(
                "exec) exit 0",
                &format!(
                    "exec) if [ -e '{}' ]; then exit 1; fi; touch '{}'",
                    marker.display(),
                    marker.display()
                ),
            ),
        )
        .unwrap();
        let mut stream = service
            .run_author_problem(auth_request(author_request(2), &sessions.admin))
            .await
            .unwrap()
            .into_inner();
        let mut scores = Vec::new();
        let mut error = None;
        while let Some(reply) = stream.next().await {
            match reply {
                Ok(reply) => {
                    if let Some(run_author_problem_response::Response::Progress(progress)) =
                        reply.response
                        && let Some(author_problem_progress::Response::Validation(commit)) =
                            progress.response
                    {
                        scores.push(commit.score);
                    }
                }
                Err(status) => error = Some(status),
            }
        }
        assert_eq!(scores, [1.0, 0.0]);
        assert_eq!(error.unwrap().code(), Code::InvalidArgument);
        let mut request = author_request(2);
        request.operation = Some(run_author_problem_request::Operation::Action(
            crate::proto::AuthorProblemAction { step: 2, action: "demo".to_owned() },
        ));
        let mut stream = service
            .run_author_problem(auth_request(request, &sessions.admin))
            .await
            .unwrap()
            .into_inner();
        let mut completed = false;
        while let Some(reply) = stream.next().await {
            match reply.unwrap().response.unwrap() {
                run_author_problem_response::Response::Progress(progress) => {
                    assert_eq!(progress.step, 2)
                }
                run_author_problem_response::Response::Result(result) => {
                    assert!(!result.saved);
                    completed = true;
                }
            }
        }
        assert!(completed);
        service
            .db
            .transaction(false, |conn| {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM problems WHERE problem_id = 'new-problem'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(count, 0);
                Ok(())
            })
            .await
            .unwrap();
        assert!(
            service
                .run_author_problem(auth_request(author_request(1), &sessions.student))
                .await
                .is_err()
        );
    }

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
        assert_eq!(parse_grpc_timeout("500000u"), Some(Duration::from_millis(500)));
        assert_eq!(parse_grpc_timeout("123456789S"), None);
        assert_eq!(parse_grpc_timeout("10x"), None);
    }

    #[tokio::test]
    async fn problem_type_reads_are_public_but_mutations_are_admin_only() {
        let service = test_service().await;
        let student_session = seed_service_users(&service.db, false, false).await.student;
        let admin_session = seed_service_users(&service.db, true, false).await.admin;

        service.get_problem_types(Request::new(GetProblemTypesRequest::default())).await.unwrap();

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

        let bundle = service
            .prepare_problem(auth_request(prepare_request(), &sessions.admin))
            .await
            .unwrap()
            .into_inner()
            .bundle
            .unwrap();
        assert_eq!(bundle.hostname, service.config.hostname);
        let runtime = decode_signed_runtime_bundle(
            &bundle.signed_validation_bundles[0],
            &service.config.daycare_secret,
        )
        .unwrap();
        assert_eq!(runtime.hostname, service.config.hostname);
    }

    #[tokio::test]
    async fn ungraded_submission_uses_local_host_and_rolls_back_unsupported_types() {
        let mut service = test_service().await;
        let sessions = seed_service_users(&service.db, false, false).await;
        seed_service_assignments(&service.db).await;
        let submission = SaveUngradedCommitRequest {
            commit: Some(GradingCommit {
                user_id: "student".to_owned(),
                commit: Some(Commit {
                    assignment: Some(AssignmentKey {
                        user_id: "student".to_owned(),
                        course_id: "c1".to_owned(),
                        problem_set_id: "ps1".to_owned(),
                    }),
                    problem_id: "p1".to_owned(),
                    step: 1,
                    action: "grade".to_owned(),
                    files: BTreeMap::from([("answer.txt".to_owned(), b"submitted".to_vec())]),
                    ..Commit::default()
                }),
                ..GradingCommit::default()
            }),
        };

        // An unsupported local type fails after the provisional save and rolls it back.
        Arc::make_mut(&mut service.config).problem_types = vec!["other-type".to_owned()];
        let error = service
            .save_ungraded_commit(auth_request(submission.clone(), &sessions.student))
            .await
            .unwrap_err();
        assert!(error.message().contains("does not support"));
        let count = service
            .db
            .transaction(false, |conn| {
                Ok(conn.query_row("SELECT COUNT(*) FROM commits", [], |row| row.get::<_, i64>(0))?)
            })
            .await
            .unwrap();
        assert_eq!(count, 0);

        // Supported submissions still return the envelope consumed by the legacy daycare RPC.
        Arc::make_mut(&mut service.config).problem_types = vec!["python".to_owned()];
        let response = service
            .save_ungraded_commit(auth_request(submission, &sessions.student))
            .await
            .unwrap()
            .into_inner();
        assert_eq!(response.save_status, crate::proto::CommitSaveStatus::Saved as i32);
        let runtime =
            decode_signed_runtime_bundle(&response.bundle.unwrap(), &service.config.daycare_secret)
                .unwrap();
        assert_eq!(runtime.hostname, service.config.hostname);
        assert_eq!(runtime.files["answer.txt"], b"submitted");
        assert_eq!(runtime.action, "grade");
        assert!(runtime.commit.unwrap().report_card.is_none());
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
        assert_eq!(student_items[0].assignment.as_ref().unwrap().user_id, "student");

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
        service.ip_filter = IpFilter::from_entries(&["203.0.113.0/24".to_owned()]).unwrap();
        let sessions = seed_service_users(&service.db, false, false).await;
        seed_service_assignments(&service.db).await;
        service
            .db
            .transaction(true, |conn| {
                conn.execute(
                    "UPDATE assignments SET restricted = 1 WHERE user_id = 'student'",
                    [],
                )?;
                Ok(())
            })
            .await
            .unwrap();

        let mut direct = auth_request(ListAssignmentsRequest::default(), &sessions.student);
        direct
            .extensions_mut()
            .insert(ConnectInfo("203.0.113.9:12345".parse::<SocketAddr>().unwrap()));
        let direct_items = service.list_assignments(direct).await.unwrap().into_inner().items;
        assert_eq!(direct_items.len(), 1);

        let mut proxied = auth_request(ListAssignmentsRequest::default(), &sessions.student);
        proxied
            .metadata_mut()
            .insert("x-forwarded-for", "203.0.113.10, 198.51.100.7".parse().unwrap());
        proxied
            .extensions_mut()
            .insert(ConnectInfo("198.51.100.7:12345".parse::<SocketAddr>().unwrap()));
        let proxied_items = service.list_assignments(proxied).await.unwrap().into_inner().items;
        assert_eq!(proxied_items.len(), 1);

        let mut denied = auth_request(ListAssignmentsRequest::default(), &sessions.student);
        denied
            .extensions_mut()
            .insert(ConnectInfo("198.51.100.7:12345".parse::<SocketAddr>().unwrap()));
        let denied_items = service.list_assignments(denied).await.unwrap().into_inner().items;
        assert!(denied_items.is_empty());
    }

    #[tokio::test]
    async fn passback_work_uses_assignment_score_and_marks_pending() {
        let service = test_service().await;
        seed_service_users(&service.db, false, false).await;
        seed_service_assignments(&service.db).await;
        seed_second_step_and_scores(&service.db).await;
        let bundle = runtime_bundle_for_passback(2);

        let (target, _) = passback_work(&service.db, &bundle, false, None).await.unwrap().unwrap();

        assert_eq!(target.score, 0.5);
        assert_eq!(assignment_passback_status(&service.db).await, PASSBACK_PENDING);
    }

    #[tokio::test]
    async fn locked_passback_work_marks_deadline_skip_without_target() {
        let service = test_service().await;
        seed_service_users(&service.db, false, false).await;
        seed_service_assignments(&service.db).await;
        let bundle = runtime_bundle_for_passback(1);

        let work = passback_work(&service.db, &bundle, true, None).await.unwrap();

        assert!(work.is_none());
        assert_eq!(assignment_passback_status(&service.db).await, PASSBACK_LOCKED);
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
            daycare,
            ip_filter: IpFilter::default(),
            version: VersionPayload {
                version: "test".to_owned(),
                grind_version_required: String::new(),
                grind_version_recommended: String::new(),
            },
        })
    }

    async fn seed_service_users(db: &Db, admin: bool, instructor: bool) -> Sessions {
        db.transaction(true, move |conn| {
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
        db.transaction(true, |conn| {
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
        db.transaction(true, |conn| {
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
        db.transaction(false, |conn| {
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
        request
            .metadata_mut()
            .insert("authorization", format!("Bearer {session}").parse().unwrap());
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
