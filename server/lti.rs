use std::collections::BTreeMap;
use std::io::Read;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use flate2::read::GzDecoder;
use form_urlencoded::parse as parse_form;
use rusqlite::{Connection, OptionalExtension, params};

use crate::config::ServerConfig;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::ipfilter::{IpFilter, extract_ip};
use crate::passback::compute_oauth_signature;
use crate::registry::{DaycareRegistration, DaycareRegistry};
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
}

impl LaunchUi {
    fn parse(raw: &str) -> AppResult<Self> {
        match raw {
            "cli" => Ok(Self::Cli),
            "web" => Ok(Self::Web),
            "js" => Ok(Self::Js),
            "exam" => Ok(Self::Exam),
            _ => Err(AppError::BadRequest(format!(
                "UI type must be cli, web, js, or exam, not {raw:?}"
            ))),
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Cli => "cli",
            Self::Web => "web",
            Self::Js => "js",
            Self::Exam => "exam",
        }
    }

    const fn is_restricted(self) -> bool {
        matches!(self, Self::Exam)
    }
}

#[derive(Clone)]
pub struct LtiState {
    pub db: Db,
    pub config: Arc<ServerConfig>,
    pub login_tokens: Arc<LoginTokens>,
    pub ip_filter: IpFilter,
    pub registry: Arc<DaycareRegistry>,
    pub version: VersionPayload,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionPayload {
    pub version: String,
    pub grind_version_required: String,
    pub grind_version_recommended: String,
}

pub fn router(state: LtiState) -> Router {
    Router::new()
        .route("/lti/config.xml", get(get_config))
        .route("/lti/problem_sets/{ui}/{unique}", post(launch))
        .route(
            "/daycare_registrations",
            get(get_daycare_registrations).post(post_daycare_registration),
        )
        .route("/version", get(get_version))
        .route("/v2/version", get(get_version))
        .with_state(state)
}

async fn get_config(State(state): State<LtiState>) -> Response {
    xml_response(StatusCode::OK, get_config_xml(&state.config))
}

async fn get_version(State(state): State<LtiState>) -> impl IntoResponse {
    Json(state.version)
}

async fn get_daycare_registrations(State(state): State<LtiState>) -> Response {
    match state.registry.snapshot() {
        Ok(snapshot) => Json(snapshot).into_response(),
        Err(err) => error_response(err),
    }
}

async fn post_daycare_registration(
    State(state): State<LtiState>,
    Json(reg): Json<DaycareRegistration>,
) -> Response {
    match state.registry.insert(reg) {
        Ok(()) => (StatusCode::OK, "").into_response(),
        Err(err) => error_response(err),
    }
}

async fn launch(
    State(state): State<LtiState>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    Path((ui, unique)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    match launch_inner(state, peer, headers, body, ui, unique).await {
        Ok(location) => {
            let mut response = StatusCode::SEE_OTHER.into_response();
            response.headers_mut().insert(
                header::LOCATION,
                HeaderValue::from_str(&location).unwrap_or_else(|_| HeaderValue::from_static("/")),
            );
            response
        }
        Err(err) => error_response(err),
    }
}

async fn launch_inner(
    state: LtiState,
    peer: std::net::SocketAddr,
    headers: HeaderMap,
    body: Bytes,
    ui: String,
    unique: String,
) -> AppResult<String> {
    let ui = LaunchUi::parse(&ui)?;
    if unique.is_empty() {
        return Err(AppError::BadRequest(
            "malformed URL: missing unique ID for problem".to_owned(),
        ));
    }
    validate_url_friendly_unique_id(&unique)?;
    let raw = if headers
        .get(header::CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("gzip"))
    {
        let mut decoder = GzDecoder::new(body.as_ref());
        let mut out = Vec::new();
        decoder.read_to_end(&mut out)?;
        out
    } else {
        body.to_vec()
    };
    let form = parse_form(&raw).into_owned().fold(
        BTreeMap::<String, Vec<String>>::new(),
        |mut acc, (key, value)| {
            acc.entry(key).or_default().push(value);
            acc
        },
    );
    let scheme = headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()).unwrap_or("https");
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let request_url = format!("{scheme}://{host}/lti/problem_sets/{}/{unique}", ui.as_str());
    validate_oauth_signature("POST", &request_url, &form, &state.config.lti_secret)?;
    let roles = form_first(&form, "roles");
    let client_ip = extract_ip(&headers, Some(peer));
    let restricted = ui.is_restricted();
    let ip_allowed = !state.ip_filter.enabled()
        || client_ip.as_deref().is_some_and(|ip| state.ip_filter.allows(ip));
    if restricted && !ip_allowed && !is_instructor_role(&roles) {
        return Err(AppError::Forbidden(
            "exam access is restricted to approved IP ranges".to_owned(),
        ));
    }
    let now = Utc::now();
    let user_id = form_first(&form, "user_id");
    let course_label = form_first(&form, "context_label");
    let form_for_db = form.clone();
    let assignment_key = state
        .db
        .transaction(move |conn| update_launch(conn, &form_for_db, &unique, restricted, now))
        .await?;
    let token = state.login_tokens.insert(&user_id, now)?;
    Ok(launch_location(ui, &assignment_key, &token, &course_label))
}

fn launch_location(ui: LaunchUi, assignment_key: &str, token: &str, course_label: &str) -> String {
    format!(
        "/{}/?assignment={}&token={}&course={}",
        ui.as_str(),
        escape(assignment_key),
        escape(token),
        escape(course_label)
    )
}

fn update_launch(
    conn: &Connection,
    form: &BTreeMap<String, Vec<String>>,
    unique: &str,
    restricted: bool,
    now: chrono::DateTime<Utc>,
) -> AppResult<String> {
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
    let course_id = form_first(form, "context_id");
    let course_name = form_first(form, "context_title");
    let user_id = form_first(form, "user_id");
    let user_name = form_first(form, "lis_person_name_full");
    let user_login = form_first(form, "custom_canvas_user_login_id");
    let roles = form_first(form, "roles");
    conn.execute(
        "INSERT INTO courses(course_id, course_name) VALUES (?, ?) ON CONFLICT(course_id) DO UPDATE SET course_name = excluded.course_name",
        params![course_id, course_name],
    )?;
    conn.execute(
        "INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET user_name = excluded.user_name, user_login = excluded.user_login",
        params![user_id, user_name, user_login],
    )?;
    conn.execute(
        "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES (?, ?, ?) ON CONFLICT(user_id, course_id) DO UPDATE SET course_roles = excluded.course_roles",
        params![user_id, course_id, roles],
    )?;
    if unique == BOOTSTRAP_ASSIGNMENT_NAME {
        return Ok(String::new());
    }
    let assignment_title = {
        let value = form_first(form, "resource_link_title");
        if value.is_empty() { problem_set_id.clone() } else { value }
    };
    let grade_id = form_first(form, "lis_result_sourcedid");
    let unlock_at =
        parse_canvas_time(&form_first(form, "custom_canvas_assignment_unlock_at")).map(db_time);
    let due_at =
        parse_canvas_time(&form_first(form, "custom_canvas_assignment_due_at")).map(db_time);
    let lock_at =
        parse_canvas_time(&form_first(form, "custom_canvas_assignment_lock_at")).map(db_time);
    conn.execute(
        "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at)
         VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, course_id, problem_set_id) DO UPDATE SET assignment_title = excluded.assignment_title, restricted = excluded.restricted, grade_id = COALESCE(excluded.grade_id, assignments.grade_id), outcome_url = excluded.outcome_url, outcome_ext_accepted = excluded.outcome_ext_accepted, consumer_key = excluded.consumer_key, unlock_at = excluded.unlock_at, due_at = excluded.due_at, lock_at = excluded.lock_at",
        params![
            user_id,
            course_id,
            problem_set_id,
            assignment_title,
            if restricted { 1 } else { 0 },
            grade_id,
            form_first(form, "lis_outcome_service_url"),
            form_first(form, "ext_outcome_data_values_accepted"),
            form_first(form, "oauth_consumer_key"),
            unlock_at,
            due_at,
            lock_at,
        ],
    )?;
    let _ = now;
    Ok(format!("{user_id}:{course_id}:{problem_set_id}"))
}

fn validate_oauth_signature(
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
        return Err(AppError::Unauthorized(format!(
            "Signature mismatch. Got {got} but expected {expected}"
        )));
    }
    Ok(())
}

fn form_first(form: &BTreeMap<String, Vec<String>>, key: &str) -> String {
    form.get(key).and_then(|values| values.first()).cloned().unwrap_or_default()
}

fn is_instructor_role(roles: &str) -> bool {
    roles
        .split(',')
        .any(|role| matches!(role, "Instructor" | "urn:lti:role:ims/lis/TeachingAssistant"))
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
        escape_xml(&config.hostname)
    )
}

fn xml_response(status: StatusCode, body: String) -> Response {
    (status, [(header::CONTENT_TYPE, "application/xml")], body).into_response()
}

fn error_response(err: AppError) -> Response {
    (err.status_code(), err.to_string()).into_response()
}

fn escape_xml(raw: &str) -> String {
    raw.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use chrono::Utc;

    use super::*;
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
        for (raw, expected_path) in [("web", "/web/"), ("js", "/js/")] {
            let ui = LaunchUi::parse(raw).unwrap();
            let location = launch_location(ui, "u1:c1:ps1", "one time", "CS 101");

            assert!(location.starts_with(expected_path));
            assert!(location.contains("assignment=u1%3Ac1%3Aps1"));
            assert!(location.contains("token=one%20time"));
            assert!(location.contains("course=CS%20101"));
            assert!(!ui.is_restricted());
        }

        assert!(LaunchUi::parse("exam").unwrap().is_restricted());
        let error = LaunchUi::parse("javascript").unwrap_err();
        assert!(error.to_string().contains("cli, web, js, or exam"));
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
            ("context_title", "Course"),
            ("user_id", "u1"),
            ("lis_person_name_full", "Student"),
            ("custom_canvas_user_login_id", "student"),
            ("roles", "Learner"),
            ("resource_link_title", "Assignment"),
            ("lis_result_sourcedid", "grade1"),
            ("lis_outcome_service_url", "https://lms.example/outcome"),
            ("ext_outcome_data_values_accepted", "text"),
            ("oauth_consumer_key", "consumer"),
            ("custom_canvas_assignment_unlock_at", "2026-01-02T03:04:05Z"),
            ("custom_canvas_assignment_due_at", "2026-01-03T03:04:05Z"),
            ("custom_canvas_assignment_lock_at", "2026-01-04T03:04:05Z"),
        ] {
            form.insert(key.to_owned(), vec![value.to_owned()]);
        }

        let assignment_key = update_launch(&conn, &form, "ps1", false, Utc::now()).unwrap();

        assert_eq!(assignment_key, "u1:c1:ps1");
        let times = conn
            .query_row(
                "SELECT unlock_at, due_at, lock_at FROM assignments WHERE user_id = 'u1' AND course_id = 'c1' AND problem_set_id = 'ps1'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            )
            .unwrap();
        assert!(times.0.contains("2026-01-02T03:04:05"));
        assert!(times.1.contains("2026-01-03T03:04:05"));
        assert!(times.2.contains("2026-01-04T03:04:05"));
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
            ta_hostname: String::new(),
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
