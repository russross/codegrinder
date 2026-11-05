use std::collections::BTreeMap;
use std::io::Read;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flate2::read::GzDecoder;
use form_urlencoded::parse as parse_form;
use rusqlite::{Connection, OptionalExtension, params};

use crate::config::ServerConfig;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::ipfilter::{IpFilter, extract_ip};
use crate::passback::compute_oauth_signature;
use crate::sessions::LoginTokens;
use crate::signatures::escape;
use crate::timeutil::{db_time, parse_canvas_time};

const BOOTSTRAP_ASSIGNMENT_NAME: &str = "bootstrap-codegrinder";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LaunchUi {
    Cli,
    Web,
    Js,
    Exam,
    Quiz,
}

impl LaunchUi {
    fn parse(raw: &str) -> AppResult<Self> {
        match raw {
            "cli" => Ok(Self::Cli),
            "web" => Ok(Self::Web),
            "js" => Ok(Self::Js),
            "exam" => Ok(Self::Exam),
            "quiz" => Ok(Self::Quiz),
            _ => Err(AppError::BadRequest(format!(
                "UI type must be cli, web, js, exam, or quiz, not {raw:?}"
            ))),
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Cli => "cli",
            Self::Web => "web",
            Self::Js => "js",
            Self::Exam => "exam",
            Self::Quiz => "quiz",
        }
    }

    const fn is_restricted(self) -> bool {
        matches!(self, Self::Exam | Self::Quiz)
    }
}

#[derive(Clone)]
pub struct LtiState {
    pub db: Db,
    pub config: Arc<ServerConfig>,
    pub login_tokens: Arc<LoginTokens>,
    pub ip_filter: IpFilter,
    pub version: VersionPayload,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionPayload {
    pub version: String,
    pub grind_version_required: String,
    pub grind_version_recommended: String,
}

pub(crate) struct LaunchUpdate {
    pub(crate) assignment_key: String,
    course_changed: bool,
    user_changed: bool,
    user_course_changed: bool,
    assignment_changed: bool,
}

impl LaunchUpdate {
    // Changes are reported only after the enclosing transaction commits.
    pub(crate) fn log(&self, form: &BTreeMap<String, Vec<String>>, unique: &str) {
        for (changed, event) in [
            (self.course_changed, "lti_course_saved"),
            (self.user_changed, "lti_user_saved"),
            (self.user_course_changed, "lti_user_course_saved"),
            (self.assignment_changed, "lti_assignment_saved"),
        ] {
            if changed {
                crate::logging::record(
                    "INFO",
                    event,
                    format_args!(
                        "user={:?} user_name={:?} course={:?} course_name={:?} problem_set={unique:?} title={:?} roles={:?}",
                        form_first(form, "user_id"),
                        form_first(form, "lis_person_name_full"),
                        form_first(form, "context_id"),
                        form_first(form, "context_title"),
                        form_first(form, "resource_link_title").trim(),
                        form_first(form, "roles"),
                    ),
                );
            }
        }
    }
}

// Diagnostics deliberately select fields rather than recording signed forms or credentials.
pub(crate) fn log_launch_error(
    err: &AppError,
    peer: SocketAddr,
    ui: &str,
    unique: &str,
    form: &BTreeMap<String, Vec<String>>,
) {
    crate::logging::record(
        if err.status_code().is_server_error() { "ERROR" } else { "WARN" },
        "lti_launch_failed",
        format_args!(
            "peer={peer} ui={ui:?} problem_set={unique:?} user={:?} course={:?} title={:?} custom_canvas_assignment_unlock_at={:?} custom_canvas_assignment_due_at={:?} custom_canvas_assignment_lock_at={:?} status={} error={:?}",
            form_first(form, "user_id"),
            form_first(form, "context_id"),
            form_first(form, "resource_link_title"),
            form.get("custom_canvas_assignment_unlock_at"),
            form.get("custom_canvas_assignment_due_at"),
            form.get("custom_canvas_assignment_lock_at"),
            err.status_code().as_u16(),
            err.to_string(),
        ),
    );
}

pub fn router(state: LtiState) -> Router {
    Router::new()
        .route("/lti/config.xml", get(get_config))
        .route("/lti/problem_sets/{ui}/{unique}", post(launch))
        .route("/version", get(get_version))
        .with_state(state)
}

async fn get_config(State(state): State<LtiState>) -> Response {
    xml_response(StatusCode::OK, get_config_xml(&state.config))
}

async fn get_version(State(state): State<LtiState>) -> impl IntoResponse {
    Json(state.version)
}

async fn launch(
    State(state): State<LtiState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path((ui, unique)): Path<(String, String)>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if ui == "quiz" {
        return crate::quiz::launch(state, peer, headers, body, unique, uri).await;
    }
    let form = match launch_form(&headers, &body) {
        Ok(form) => form,
        Err(err) => {
            log_launch_error(&err, peer, &ui, &unique, &BTreeMap::new());
            return error_response(err);
        }
    };
    match launch_inner(state, peer, headers, &form, &ui, &unique).await {
        Ok(location) => {
            let mut response = StatusCode::SEE_OTHER.into_response();
            response.headers_mut().insert(
                header::LOCATION,
                HeaderValue::from_str(&location).unwrap_or_else(|_| HeaderValue::from_static("/")),
            );
            response
        }
        Err(err) => {
            log_launch_error(&err, peer, &ui, &unique, &form);
            error_response(err)
        }
    }
}

async fn launch_inner(
    state: LtiState,
    peer: SocketAddr,
    headers: HeaderMap,
    form: &BTreeMap<String, Vec<String>>,
    ui: &str,
    unique: &str,
) -> AppResult<String> {
    let ui = LaunchUi::parse(ui)?;
    if unique.is_empty() {
        return Err(AppError::BadRequest(
            "malformed URL: missing unique ID for problem".to_owned(),
        ));
    }
    validate_url_friendly_unique_id(unique)?;
    let scheme = headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()).unwrap_or("https");
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let request_url = format!("{scheme}://{host}/lti/problem_sets/{}/{unique}", ui.as_str());
    validate_oauth_signature("POST", &request_url, form, &state.config.lti_secret)?;
    launch_verified(state, peer, headers, form, ui, unique).await
}

fn launch_form(headers: &HeaderMap, body: &[u8]) -> AppResult<BTreeMap<String, Vec<String>>> {
    let raw = if headers
        .get(header::CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("gzip"))
    {
        let mut decoder = GzDecoder::new(body);
        let mut out = Vec::new();
        decoder.read_to_end(&mut out)?;
        out
    } else {
        body.to_vec()
    };
    Ok(parse_form(&raw).into_owned().fold(
        BTreeMap::<String, Vec<String>>::new(),
        |mut acc, (key, value)| {
            acc.entry(key).or_default().push(value);
            acc
        },
    ))
}

async fn launch_verified(
    state: LtiState,
    peer: SocketAddr,
    headers: HeaderMap,
    form: &BTreeMap<String, Vec<String>>,
    ui: LaunchUi,
    unique: &str,
) -> AppResult<String> {
    let roles = form_first(form, "roles");
    let client_ip = extract_ip(&headers, Some(peer));
    let restricted = ui.is_restricted();
    let ip_allowed = !state.ip_filter.enabled()
        || client_ip.as_deref().is_some_and(|ip| state.ip_filter.allows(ip));
    if restricted && !ip_allowed && !is_instructor_role(&roles)? {
        eprintln!(
            "exam launch denied: user={:?} user_name={:?} course={:?} course_name={:?} assignment_title={:?} problem_set={:?} ip={:?}",
            form_first(form, "user_id"),
            form_first(form, "lis_person_name_full"),
            form_first(form, "context_id"),
            form_first(form, "context_title"),
            form_first(form, "resource_link_title"),
            unique,
            client_ip
        );
        return Err(AppError::Forbidden(
            "exam access is restricted to approved IP ranges".to_owned(),
        ));
    }
    let now = Utc::now();
    let user_id = form_first(form, "user_id");
    let course_label = form_first(form, "context_label");
    let form_for_db = form.clone();
    let unique_for_db = unique.to_owned();
    let update = state
        .db
        .transaction(true, move |conn| {
            let update = update_launch(conn, &form_for_db, &unique_for_db, restricted, now)?;
            conn.execute(
                "DELETE FROM quiz_assignments WHERE user_id=? AND course_id=? AND problem_set_id=?",
                params![
                    form_first(&form_for_db, "user_id"),
                    form_first(&form_for_db, "context_id"),
                    unique_for_db
                ],
            )?;
            Ok(update)
        })
        .await?;
    update.log(form, unique);
    let token = state.login_tokens.insert(&user_id, now)?;
    Ok(launch_location(ui, &update.assignment_key, &token, &course_label))
}

fn launch_location(ui: LaunchUi, assignment_key: &str, token: &str, course_label: &str) -> String {
    format!(
        "/{}/?assignment={}&token={}&course={}",
        match ui {
            LaunchUi::Cli => "grind",
            LaunchUi::Exam => "client",
            _ => ui.as_str(),
        },
        escape(assignment_key),
        escape(token),
        escape(course_label)
    )
}

pub(crate) fn update_launch(
    conn: &Connection,
    form: &BTreeMap<String, Vec<String>>,
    unique: &str,
    restricted: bool,
    now: chrono::DateTime<Utc>,
) -> AppResult<LaunchUpdate> {
    let problem_set_id = if unique == BOOTSTRAP_ASSIGNMENT_NAME {
        String::new()
    } else {
        conn.query_row(
            "SELECT problem_set_id FROM problem_sets WHERE problem_set_id = ?",
            params![unique],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("problem set not found".to_owned()))?
    };
    // Validate identities without rewriting them; display fields can safely lose padding.
    let course_id = launch_identifier(form, "context_id", false)?;
    let course_name = launch_text(form, "context_title")?;
    let user_id = launch_identifier(form, "user_id", false)?;
    let user_name = launch_text(form, "lis_person_name_full")?;
    let user_login = launch_identifier(form, "custom_canvas_user_login_id", false)?;
    let roles = launch_roles(&form_first(form, "roles"))?;
    let assignment = if unique == BOOTSTRAP_ASSIGNMENT_NAME {
        None
    } else {
        Some(AssignmentLaunch::parse(form, &problem_set_id)?)
    };
    // Conditional upserts distinguish real changes from repeated Canvas launches.
    let course_changed = conn.execute(
        "INSERT INTO courses(course_id, course_name) VALUES (?, ?) ON CONFLICT(course_id) DO UPDATE SET course_name = excluded.course_name WHERE course_name IS NOT excluded.course_name",
        params![course_id, course_name],
    )? != 0;
    let user_changed = conn.execute(
        "INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET user_name = excluded.user_name, user_login = excluded.user_login WHERE user_name IS NOT excluded.user_name OR user_login IS NOT excluded.user_login",
        params![user_id, user_name, user_login],
    )? != 0;
    let user_course_changed = conn.execute(
        "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES (?, ?, ?) ON CONFLICT(user_id, course_id) DO UPDATE SET course_roles = excluded.course_roles WHERE course_roles IS NOT excluded.course_roles",
        params![user_id, course_id, roles],
    )? != 0;
    let Some(assignment) = assignment else {
        return Ok(LaunchUpdate {
            assignment_key: String::new(),
            course_changed,
            user_changed,
            user_course_changed,
            assignment_changed: false,
        });
    };
    // A missing sourced ID preserves the existing target and is not itself a change.
    let assignment_changed = conn.execute(
        "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at)
         VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, course_id, problem_set_id) DO UPDATE SET assignment_title = excluded.assignment_title, restricted = excluded.restricted, grade_id = COALESCE(excluded.grade_id, assignments.grade_id), outcome_url = excluded.outcome_url, outcome_ext_accepted = excluded.outcome_ext_accepted, consumer_key = excluded.consumer_key, unlock_at = excluded.unlock_at, due_at = excluded.due_at, lock_at = excluded.lock_at
         WHERE assignment_title IS NOT excluded.assignment_title OR restricted IS NOT excluded.restricted
            OR assignments.grade_id IS NOT COALESCE(excluded.grade_id, assignments.grade_id)
            OR outcome_url IS NOT excluded.outcome_url OR outcome_ext_accepted IS NOT excluded.outcome_ext_accepted
            OR consumer_key IS NOT excluded.consumer_key OR unlock_at IS NOT excluded.unlock_at
            OR due_at IS NOT excluded.due_at OR lock_at IS NOT excluded.lock_at",
        params![
            user_id,
            course_id,
            problem_set_id,
            assignment.title,
            if restricted { 1 } else { 0 },
            assignment.grade_id,
            assignment.outcome_url,
            assignment.outcome_ext_accepted,
            assignment.consumer_key,
            assignment.unlock_at.map(db_time),
            assignment.due_at.map(db_time),
            assignment.lock_at.map(db_time),
        ],
    )? != 0;
    let _ = now;
    Ok(LaunchUpdate {
        assignment_key: format!("{user_id}:{course_id}:{problem_set_id}"),
        course_changed,
        user_changed,
        user_course_changed,
        assignment_changed,
    })
}

pub(crate) fn validate_oauth_signature(
    method: &str,
    request_url: &str,
    form: &BTreeMap<String, Vec<String>>,
    secret: &str,
) -> AppResult<()> {
    let expected = form_first(form, "oauth_signature");
    if expected.is_empty() {
        return Err(AppError::Unauthorized("Missing oauth_signature form field".to_owned()));
    }
    let got = compute_oauth_signature(method, request_url, form, secret)?;
    if got != expected {
        return Err(AppError::Unauthorized("Signature mismatch".to_owned()));
    }
    Ok(())
}

pub(crate) fn form_first(form: &BTreeMap<String, Vec<String>>, key: &str) -> String {
    form.get(key).and_then(|values| values.first()).cloned().unwrap_or_default()
}

pub(crate) fn is_instructor_role(roles: &str) -> AppResult<bool> {
    Ok(launch_roles(roles)?
        .split(',')
        .any(|role| matches!(role, "Instructor" | "urn:lti:role:ims/lis/TeachingAssistant")))
}

// Identity and opaque values are never included in validation errors or rewritten.
pub(crate) fn launch_identifier(
    form: &BTreeMap<String, Vec<String>>,
    field: &str,
    optional: bool,
) -> AppResult<String> {
    let value = form_first(form, field);
    if value != value.trim() || (!optional && value.is_empty()) {
        return Err(AppError::BadRequest(format!(
            "LTI field {field} must {}have no surrounding whitespace",
            if optional { "" } else { "be nonempty and " }
        )));
    }
    Ok(value)
}

fn launch_text(form: &BTreeMap<String, Vec<String>>, field: &str) -> AppResult<String> {
    let value = form_first(form, field).trim().to_owned();
    if value.is_empty() {
        return Err(AppError::BadRequest(format!("LTI field {field} must be nonempty")));
    }
    Ok(value)
}

// Authorization and storage share the same comma-separated role normalization.
fn launch_roles(raw: &str) -> AppResult<String> {
    let roles: Vec<&str> = raw.split(',').map(str::trim).collect();
    if roles.iter().any(|role| role.is_empty() || role.chars().any(char::is_whitespace)) {
        return Err(AppError::BadRequest(
            "LTI field roles must contain nonempty comma-separated roles without internal whitespace".to_owned(),
        ));
    }
    Ok(roles.join(","))
}

struct AssignmentLaunch {
    title: String,
    grade_id: String,
    outcome_url: String,
    outcome_ext_accepted: String,
    consumer_key: String,
    unlock_at: Option<DateTime<Utc>>,
    due_at: Option<DateTime<Utc>>,
    lock_at: Option<DateTime<Utc>>,
}

impl AssignmentLaunch {
    fn parse(form: &BTreeMap<String, Vec<String>>, problem_set_id: &str) -> AppResult<Self> {
        let title = form_first(form, "resource_link_title").trim().to_owned();
        let outcome_url = launch_text(form, "lis_outcome_service_url")?;
        let uri = outcome_url.parse::<axum::http::Uri>().map_err(|_| {
            AppError::BadRequest(
                "LTI field lis_outcome_service_url must be an absolute HTTP or HTTPS URL"
                    .to_owned(),
            )
        })?;
        if !matches!(uri.scheme_str(), Some("http" | "https"))
            || uri.host().is_none_or(str::is_empty)
        {
            return Err(AppError::BadRequest(
                "LTI field lis_outcome_service_url must be an absolute HTTP or HTTPS URL"
                    .to_owned(),
            ));
        }

        // Parse dates before writing any rows and compare instants rather than input strings.
        // Canvas leaves the substitution literal when an assignment date is unset.
        let date = |field: &str, placeholder: &str| {
            let raw = form_first(form, field);
            if raw == placeholder {
                return Ok(None);
            }
            parse_canvas_time(&raw)
                .map_err(|err| AppError::BadRequest(format!("LTI field {field} {err}")))
        };
        let unlock_at =
            date("custom_canvas_assignment_unlock_at", "$Canvas.assignment.unlockAt.iso8601")?;
        let due_at = date("custom_canvas_assignment_due_at", "$Canvas.assignment.dueAt.iso8601")?;
        let lock_at =
            date("custom_canvas_assignment_lock_at", "$Canvas.assignment.lockAt.iso8601")?;
        for (earlier, later, message) in [
            (unlock_at, due_at, "unlock_at must not be after due_at"),
            (due_at, lock_at, "due_at must not be after lock_at"),
            (unlock_at, lock_at, "unlock_at must not be after lock_at"),
        ] {
            if earlier.zip(later).is_some_and(|(a, b)| a > b) {
                return Err(AppError::BadRequest(format!("LTI assignment dates: {message}")));
            }
        }
        Ok(Self {
            title: if title.is_empty() { problem_set_id.to_owned() } else { title },
            grade_id: launch_identifier(form, "lis_result_sourcedid", true)?,
            outcome_url,
            outcome_ext_accepted: launch_text(form, "ext_outcome_data_values_accepted")?,
            consumer_key: launch_identifier(form, "oauth_consumer_key", false)?,
            unlock_at,
            due_at,
            lock_at,
        })
    }
}

fn validate_url_friendly_unique_id(unique: &str) -> AppResult<()> {
    let escaped = go_query_escape(unique);
    if unique != escaped {
        return Err(AppError::BadRequest(format!(
            "unique ID must be URL friendly: {unique} is escaped as {escaped}"
        )));
    }
    Ok(())
}

fn go_query_escape(raw: &str) -> String {
    let mut out = String::new();
    for byte in raw.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn get_config_xml(config: &ServerConfig) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link
  xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
  xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0"
  xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0"
  xmlns:lticp="http://www.imsglobal.org/xsd/imslticp_v1p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imslticc_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticc_v1p0.xsd http://www.imsglobal.org/xsd/imsbasiclti_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imsbasiclti_v1p0.xsd http://www.imsglobal.org/xsd/imslticm_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticm_v1p0.xsd http://www.imsglobal.org/xsd/imslticp_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticp_v1p0.xsd">
  <blti:title>{}</blti:title>
  <blti:description>{}</blti:description>
  <blti:icon></blti:icon>
  <blti:extensions platform="canvas.instructure.com">
    <lticm:property name="tool_id">{}</lticm:property>
    <lticm:property name="privacy_level">public</lticm:property>
    <lticm:property name="domain">{}</lticm:property>
    <lticm:options name="assignment_selection">
      <lticm:property name="url">https://{}/lti/picker</lticm:property>
      <lticm:property name="text">Choose a CodeGrinder problem set</lticm:property>
      <lticm:property name="message_type">ContentItemSelectionRequest</lticm:property>
      <lticm:property name="enabled">true</lticm:property>
    </lticm:options>
    <lticm:options name="custom_fields">
      <lticm:property name="canvas_assignment_unlock_at">$Canvas.assignment.unlockAt.iso8601</lticm:property>
      <lticm:property name="canvas_assignment_due_at">$Canvas.assignment.dueAt.iso8601</lticm:property>
      <lticm:property name="canvas_assignment_lock_at">$Canvas.assignment.lockAt.iso8601</lticm:property>
    </lticm:options>
  </blti:extensions>
  <cartridge_bundle identifierref="BLTI001_Bundle"></cartridge_bundle>
  <cartridge_icon identifierref="BLTI001_Icon"></cartridge_icon>
</cartridge_basiclti_link>
"#,
        escape_xml(&config.tool_name),
        escape_xml(&config.tool_description),
        escape_xml(&config.tool_id),
        escape_xml(&config.hostname),
        escape_xml(&config.hostname)
    )
}

fn xml_response(status: StatusCode, body: String) -> Response {
    (status, [(header::CONTENT_TYPE, "application/xml")], body).into_response()
}

fn error_response(err: AppError) -> Response {
    (err.status_code(), err.to_string()).into_response()
}

pub(crate) fn escape_xml(raw: &str) -> String {
    raw.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use chrono::Utc;

    use super::*;

    #[test]
    fn invalid_signature_response_does_not_disclose_a_valid_signature() {
        let url = "https://ta.example/lti/picker";
        let form = BTreeMap::from([
            ("oauth_signature".into(), vec!["submitted-signature".into()]),
            ("roles".into(), vec!["Instructor".into()]),
        ]);
        let computed = compute_oauth_signature("POST", url, &form, "secret").unwrap();
        let error = validate_oauth_signature("POST", url, &form, "secret").unwrap_err();
        assert_eq!(error.status_code(), StatusCode::UNAUTHORIZED);
        assert!(!error.to_string().contains(&computed));
        assert!(!error.to_string().contains("submitted-signature"));
    }
    use crate::config::IpFilterConfig;
    use crate::db::open_test_connection;

    #[test]
    fn config_xml_includes_canvas_assignment_time_custom_fields() {
        let xml = get_config_xml(&test_config());

        assert!(xml.contains("privacy_level"));
        assert!(xml.contains("canvas_assignment_unlock_at"));
        assert!(xml.contains("$Canvas.assignment.unlockAt.iso8601"));
        assert!(xml.contains("canvas_assignment_due_at"));
        assert!(xml.contains("$Canvas.assignment.dueAt.iso8601"));
        assert!(xml.contains("canvas_assignment_lock_at"));
        assert!(xml.contains("$Canvas.assignment.lockAt.iso8601"));
    }

    #[test]
    fn launch_ui_paths_preserve_web_and_add_javascript() {
        for (raw, expected_path) in [("cli", "/grind/"), ("web", "/web/"), ("js", "/js/")] {
            let ui = LaunchUi::parse(raw).unwrap();
            let location = launch_location(ui, "u1:c1:ps1", "one time", "CS 101");

            assert!(location.starts_with(expected_path));
            assert!(location.contains("assignment=u1%3Ac1%3Aps1"));
            assert!(location.contains("token=one%20time"));
            assert!(location.contains("course=CS%20101"));
            assert!(!ui.is_restricted());
        }

        let exam = LaunchUi::parse("exam").unwrap();
        assert!(exam.is_restricted());
        assert_eq!(
            launch_location(exam, "u:c:p", "token", "course"),
            "/client/?assignment=u%3Ac%3Ap&token=token&course=course"
        );
        let error = LaunchUi::parse("javascript").unwrap_err();
        assert!(error.to_string().contains("cli, web, js, exam, or quiz"));
    }

    #[test]
    fn launch_location_uses_oauth_percent_encoding() {
        let location = launch_location(LaunchUi::Web, "a+b &/é~", "t=1", "CS+101");

        assert_eq!(location, "/web/?assignment=a%2Bb%20%26%2F%C3%A9~&token=t%3D1&course=CS%2B101");
    }

    #[test]
    fn launch_update_stores_assignment_time_fields() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_test_connection(&dir.path().join("db.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at)
             VALUES ('ps1', 'Set', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let mut form = BTreeMap::<String, Vec<String>>::new();
        for (key, value) in [
            ("context_id", "c1"),
            ("context_title", " \tCourse\u{2003}"),
            ("user_id", "u1"),
            ("lis_person_name_full", " Student\t"),
            ("custom_canvas_user_login_id", "student"),
            ("roles", " Learner "),
            ("resource_link_title", " \tAssignment\u{2003} "),
            ("lis_result_sourcedid", "grade1"),
            ("lis_outcome_service_url", " https://lms.example/outcome\t"),
            ("ext_outcome_data_values_accepted", " text "),
            ("oauth_consumer_key", "consumer"),
            ("custom_canvas_assignment_unlock_at", "2026-01-02T03:04:05Z"),
            ("custom_canvas_assignment_due_at", "2026-01-03T03:04:05Z"),
            ("custom_canvas_assignment_lock_at", "2026-01-04T03:04:05Z"),
        ] {
            form.insert(key.to_owned(), vec![value.to_owned()]);
        }

        let update = update_launch(&conn, &form, "ps1", false, Utc::now()).unwrap();

        assert_eq!(update.assignment_key, "u1:c1:ps1");
        assert!(
            update.course_changed
                && update.user_changed
                && update.user_course_changed
                && update.assignment_changed
        );
        let repeated = update_launch(&conn, &form, "ps1", false, Utc::now()).unwrap();
        assert!(
            !repeated.course_changed
                && !repeated.user_changed
                && !repeated.user_course_changed
                && !repeated.assignment_changed
        );
        let title: String =
            conn.query_row("SELECT assignment_title FROM assignments", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "Assignment");
        let stored: (String, String, String, String, String) = conn.query_row(
            "SELECT course_name,user_name,course_roles,outcome_url,outcome_ext_accepted FROM assignments NATURAL JOIN users NATURAL JOIN courses NATURAL JOIN user_courses", [],
            |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
        ).unwrap();
        assert_eq!(
            stored,
            (
                "Course".into(),
                "Student".into(),
                "Learner".into(),
                "https://lms.example/outcome".into(),
                "text".into()
            )
        );

        // Each independently changed record is identified without reporting its neighbors.
        for (field, value, expected) in [
            ("context_title", "Renamed course", (true, false, false, false)),
            ("lis_person_name_full", "Renamed student", (false, true, false, false)),
            ("custom_canvas_user_login_id", "renamed-login", (false, true, false, false)),
            ("roles", "Instructor", (false, false, true, false)),
            ("resource_link_title", "Renamed assignment", (false, false, false, true)),
            (
                "custom_canvas_assignment_due_at",
                "2026-01-03T04:00:00Z",
                (false, false, false, true),
            ),
            ("lis_result_sourcedid", "", (false, false, false, false)),
        ] {
            form.insert(field.to_owned(), vec![value.to_owned()]);
            let changed = update_launch(&conn, &form, "ps1", false, Utc::now()).unwrap();
            assert_eq!(
                (
                    changed.course_changed,
                    changed.user_changed,
                    changed.user_course_changed,
                    changed.assignment_changed
                ),
                expected,
                "{field}"
            );
        }
        form.insert("resource_link_title".to_owned(), vec![" \t ".to_owned()]);
        update_launch(&conn, &form, "ps1", false, Utc::now()).unwrap();
        let title: String =
            conn.query_row("SELECT assignment_title FROM assignments", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "ps1");
        let times = conn
            .query_row(
                "SELECT unlock_at, due_at, lock_at FROM assignments WHERE user_id = 'u1' AND course_id = 'c1' AND problem_set_id = 'ps1'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            )
            .unwrap();
        assert!(times.0.contains("2026-01-02T03:04:05"));
        assert!(times.1.contains("2026-01-03T04:00:00"));
        assert!(times.2.contains("2026-01-04T03:04:05"));

        // Invalid launches fail before updating even the earlier course/user rows.
        for (field, value) in [
            ("context_id", ""),
            ("user_id", ""),
            ("custom_canvas_user_login_id", ""),
            ("oauth_consumer_key", ""),
            ("context_id", " c1"),
            ("user_id", "u1 "),
            ("custom_canvas_user_login_id", "renamed-login "),
            ("oauth_consumer_key", " consumer"),
            ("lis_result_sourcedid", "grade "),
            ("context_title", "\u{2003}\t"),
            ("lis_person_name_full", " "),
            ("roles", "Instructor,,Learner"),
            ("roles", ""),
            ("lis_outcome_service_url", " "),
            ("lis_outcome_service_url", "/relative"),
            ("lis_outcome_service_url", "ftp://lms.example/outcome"),
            ("ext_outcome_data_values_accepted", "\t"),
            ("custom_canvas_assignment_due_at", "not a date"),
            ("custom_canvas_assignment_unlock_at", "2026-01-05T00:00:00Z"),
            ("custom_canvas_assignment_lock_at", "2026-01-01T00:00:00Z"),
        ] {
            let mut invalid = form.clone();
            invalid.insert("context_title".into(), vec!["Must not be stored".into()]);
            invalid.insert(field.into(), vec![value.into()]);
            let err = update_launch(&conn, &invalid, "ps1", false, Utc::now()).err().unwrap();
            assert_eq!(err.status_code(), StatusCode::BAD_REQUEST, "{field}");
            assert!(
                err.to_string().contains(field) || field.starts_with("custom_canvas_assignment_"),
                "{field}: {err}"
            );
            let course: String =
                conn.query_row("SELECT course_name FROM courses", [], |r| r.get(0)).unwrap();
            assert_eq!(course, "Renamed course");
        }

        // Missing due dates still require unlock/lock ordering; offsets compare in UTC.
        form.insert("custom_canvas_assignment_due_at".into(), vec![" \t".into()]);
        form.insert(
            "custom_canvas_assignment_unlock_at".into(),
            vec!["2026-01-05T00:00:00Z".into()],
        );
        assert!(AssignmentLaunch::parse(&form, "ps1").is_err());
        form.insert(
            "custom_canvas_assignment_unlock_at".into(),
            vec!["2026-01-04T04:00:00+01:00".into()],
        );
        assert!(AssignmentLaunch::parse(&form, "ps1").is_ok());

        // Unset Canvas dates clear stored dates when the assignment is relaunched.
        for (field, placeholder) in [
            ("custom_canvas_assignment_unlock_at", "$Canvas.assignment.unlockAt.iso8601"),
            ("custom_canvas_assignment_due_at", "$Canvas.assignment.dueAt.iso8601"),
            ("custom_canvas_assignment_lock_at", "$Canvas.assignment.lockAt.iso8601"),
        ] {
            form.insert(field.into(), vec![placeholder.into()]);
        }
        update_launch(&conn, &form, "ps1", false, Utc::now()).unwrap();
        let dates: (Option<String>, Option<String>, Option<String>) = conn
            .query_row("SELECT unlock_at, due_at, lock_at FROM assignments", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap();
        assert_eq!(dates, (None, None, None));

        // Only the matching literal is absent; other malformed values remain errors.
        for invalid in ["$Canvas.assignment.dueAt.iso8601", "not a date"] {
            form.insert("custom_canvas_assignment_unlock_at".into(), vec![invalid.into()]);
            assert!(AssignmentLaunch::parse(&form, "ps1").is_err());
        }
    }

    #[test]
    fn roles_and_optional_dates_share_launch_normalization() {
        assert!(is_instructor_role(" Learner , Instructor\t ").unwrap());
        assert!(is_instructor_role(" urn:lti:role:ims/lis/TeachingAssistant ").unwrap());
        assert!(!is_instructor_role(" Learner ").unwrap());
        assert!(is_instructor_role("Instructor, ").is_err());
        assert!(is_instructor_role("In structor").is_err());
        assert_eq!(launch_roles(" Learner , Instructor ").unwrap(), "Learner,Instructor");
        assert_eq!(parse_canvas_time(" \t").unwrap(), None);
        assert_eq!(
            parse_canvas_time("2026-01-01T01:00:00+01:00").unwrap(),
            parse_canvas_time(" 2026-01-01T00:00:00Z ").unwrap()
        );
        assert!(parse_canvas_time("2026-99-99").is_err());
    }

    #[test]
    fn unique_id_validation_matches_go_query_escape() {
        validate_url_friendly_unique_id("ps-1_ok.~").unwrap();

        let err = validate_url_friendly_unique_id("bad id").unwrap_err();
        assert!(err.to_string().contains("bad+id"));

        let err = validate_url_friendly_unique_id("bad/id").unwrap_err();
        assert!(err.to_string().contains("bad%2Fid"));
    }

    fn test_config() -> ServerConfig {
        ServerConfig {
            hostname: "ta.example".to_owned(),
            daycare_secret: "daycare-secret".to_owned(),
            lti_secret: "lti-secret".to_owned(),
            session_secret: "session-secret".to_owned(),
            capacity: 1,
            problem_types: Vec::new(),
            tool_name: "CodeGrinder".to_owned(),
            tool_id: "codegrinder".to_owned(),
            tool_description: "Programming exercises".to_owned(),
            container_engine: "docker".to_owned(),
            sqlite3_path: PathBuf::new(),
            sessions_expire: Vec::new(),
            ip_filter: IpFilterConfig::default(),
        }
    }
}
