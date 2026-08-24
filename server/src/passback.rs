use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::Utc;
use http::header::{AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use http::{HeaderMap, HeaderValue};
use rand::RngExt;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use sha1::{Digest, Sha1};

use crate::config::ServerConfig;
use crate::curl::{CurlError, CurlHttpVersion, CurlPostRequest};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::proto::{AssignmentKey, Commit, EventMessage};
use crate::signatures::{encode_params, escape, hmac_sha1_base64};

pub const PASSBACK_POSTED: &str = "posted";
pub const PASSBACK_PENDING: &str = "post_pending";
pub const PASSBACK_FAILED: &str = "post_failed";
pub const PASSBACK_NO_TARGET: &str = "not_posted_no_target";
pub const PASSBACK_LOCKED: &str = "not_posted_locked";
pub const PASSBACK_USER_NOT_IN_COURSE: &str = "not_posted_user_not_in_course";
const USER_AGENT_VALUE: &str = concat!("CodeGrinder/", env!("CARGO_PKG_VERSION"));
const STARTUP_RECOVERY_JITTER: Duration = Duration::from_secs(10 * 60);
const GRADE_PASSBACK_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
enum GradePassbackError {
    #[error("{0}")]
    Permanent(#[from] AppError),
    #[error("grade passback failed: {0}")]
    Transport(#[from] CurlError),
    #[error("grade passback status {status}: {body}")]
    Http {
        status: http::StatusCode,
        body: String,
    },
}

impl GradePassbackError {
    fn is_transient(&self) -> bool {
        match self {
            Self::Permanent(_) => false,
            Self::Transport(_) => true,
            Self::Http { status, .. } => is_transient_http_status(*status),
        }
    }

    fn is_user_not_in_course(&self) -> bool {
        let Self::Http { status, body } = self else {
            return false;
        };
        if *status != http::StatusCode::UNPROCESSABLE_ENTITY {
            return false;
        }
        let Ok(document) = roxmltree::Document::parse(body) else {
            return false;
        };
        document.descendants().any(|node| {
            node.is_element()
                && node.tag_name().name() == "ext_canvas_error_code"
                && node
                    .text()
                    .is_some_and(|text| text.trim() == "user_not_in_course")
        })
    }
}

fn is_transient_http_status(status: http::StatusCode) -> bool {
    matches!(
        status,
        http::StatusCode::REQUEST_TIMEOUT
            | http::StatusCode::TOO_EARLY
            | http::StatusCode::TOO_MANY_REQUESTS
            | http::StatusCode::INTERNAL_SERVER_ERROR
            | http::StatusCode::BAD_GATEWAY
            | http::StatusCode::SERVICE_UNAVAILABLE
            | http::StatusCode::GATEWAY_TIMEOUT
    )
}

#[derive(Clone, Debug)]
pub struct GradePassbackTarget {
    pub user_id: String,
    pub course_id: String,
    pub problem_set_id: String,
    pub grade_id: String,
    pub outcome_url: String,
    pub outcome_ext_accepted: String,
    pub consumer_key: String,
    pub score: f64,
}

#[derive(Deserialize)]
struct StoredTranscriptEvent {
    #[serde(default)]
    event: String,
    #[serde(default)]
    exec_command: Vec<String>,
    #[serde(default)]
    exit_status: i32,
    #[serde(default)]
    stream_data: String,
    #[serde(default)]
    error: String,
}

pub async fn spawn_startup_grade_passbacks(db: Db, config: Arc<ServerConfig>) -> AppResult<usize> {
    let assignments = db
        .transaction(|conn| {
            let mut statement = conn.prepare(
                "SELECT user_id, course_id, problem_set_id
                 FROM assignments
                 WHERE grade_passback_status IN (?, ?)
                 ORDER BY user_id, course_id, problem_set_id",
            )?;
            let rows = statement.query_map(params![PASSBACK_FAILED, PASSBACK_PENDING], |row| {
                Ok(AssignmentKey {
                    user_id: row.get(0)?,
                    course_id: row.get(1)?,
                    problem_set_id: row.get(2)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
        .await?;
    let count = assignments.len();
    for key in assignments {
        let db = db.clone();
        let config = config.clone();
        let max_jitter_millis = STARTUP_RECOVERY_JITTER.as_millis() as u64;
        let jitter = Duration::from_millis(rand::rng().random_range(0..=max_jitter_millis));
        tokio::spawn(async move {
            tokio::time::sleep(jitter).await;
            match prepare_startup_grade_passback(&db, &key).await {
                Ok(Some((target, html))) => spawn_grade_passback(db, config, target, html),
                Ok(None) => {}
                Err(err) => eprintln!(
                    "error preparing startup LMS grade passback for assignment {}/{}/{}: {err}",
                    key.user_id, key.course_id, key.problem_set_id
                ),
            }
        });
    }
    Ok(count)
}

async fn prepare_startup_grade_passback(
    db: &Db,
    key: &AssignmentKey,
) -> AppResult<Option<(GradePassbackTarget, String)>> {
    let key = key.clone();
    db.transaction(move |conn| prepare_startup_grade_passback_tx(conn, &key, Utc::now()))
        .await
}

fn prepare_startup_grade_passback_tx(
    conn: &Connection,
    key: &AssignmentKey,
    now: chrono::DateTime<Utc>,
) -> AppResult<Option<(GradePassbackTarget, String)>> {
    let assignment = conn
        .query_row(
            "SELECT assignments.grade_passback_status,
                    assignments.grade_id,
                    assignments.outcome_url,
                    assignments.outcome_ext_accepted,
                    assignments.consumer_key,
                    COALESCE(assignment_scores.assignment_score, 0.0),
                    assignments.lock_at IS NOT NULL
                        AND datetime(assignments.lock_at) <= datetime(?)
                        AND NOT user_courses.is_instructor
             FROM assignments
             NATURAL JOIN user_courses
             NATURAL LEFT JOIN assignment_scores
             WHERE assignments.user_id = ?
               AND assignments.course_id = ?
               AND assignments.problem_set_id = ?",
            params![
                crate::timeutil::db_time(now),
                key.user_id,
                key.course_id,
                key.problem_set_id
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, f64>(5)?,
                    row.get::<_, bool>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((status, grade_id, outcome_url, outcome_ext_accepted, consumer_key, score, locked)) =
        assignment
    else {
        return Ok(None);
    };
    if status != PASSBACK_FAILED && status != PASSBACK_PENDING {
        return Ok(None);
    }
    if locked {
        set_passback_status(conn, key, PASSBACK_LOCKED)?;
        return Ok(None);
    }
    if grade_id.is_empty() || outcome_url.is_empty() {
        set_passback_status(conn, key, PASSBACK_NO_TARGET)?;
        return Ok(None);
    }
    let commit_row = conn
        .query_row(
            "SELECT problem_id, step_number, transcript
             FROM commits
             WHERE user_id = ? AND course_id = ? AND problem_set_id = ?
               AND report_card <> 'null'
             ORDER BY commit_updated_at DESC, problem_id, step_number DESC
             LIMIT 1",
            params![key.user_id, key.course_id, key.problem_set_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::Internal("failed passback has no graded commit".to_owned()))?;
    let transcript = serde_json::from_str::<Vec<StoredTranscriptEvent>>(&commit_row.2)?
        .into_iter()
        .map(|event| EventMessage {
            event: event.event,
            exec_command: event.exec_command,
            exit_status: event.exit_status,
            stream_data: event.stream_data.into_bytes(),
            error: event.error,
            ..EventMessage::default()
        })
        .collect();
    let mut file_statement = conn.prepare(
        "SELECT path, content FROM commit_files
         WHERE user_id = ? AND course_id = ? AND problem_set_id = ?
           AND problem_id = ? AND step_number = ?
         ORDER BY path",
    )?;
    let files = file_statement
        .query_map(
            params![
                key.user_id,
                key.course_id,
                key.problem_set_id,
                commit_row.0,
                commit_row.1
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)),
        )?
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let total_steps = conn.query_row(
        "SELECT total_steps FROM grading_step_context
         WHERE problem_set_id = ? AND problem_id = ? AND step_number = ?",
        params![key.problem_set_id, commit_row.0, commit_row.1],
        |row| row.get::<_, i64>(0),
    )?;
    let total_problems = conn.query_row(
        "SELECT COUNT(1) FROM problem_set_problems WHERE problem_set_id = ?",
        params![key.problem_set_id],
        |row| row.get::<_, i64>(0),
    )?;
    let commit = Commit {
        assignment: Some(key.clone()),
        problem_id: commit_row.0,
        step: commit_row.1,
        files,
        transcript,
        ..Commit::default()
    };
    let html = build_grade_report_html(
        &commit,
        &commit.problem_id,
        total_steps,
        total_problems.max(1),
    );
    set_passback_status(conn, key, PASSBACK_PENDING)?;
    Ok(Some((
        GradePassbackTarget {
            user_id: key.user_id.clone(),
            course_id: key.course_id.clone(),
            problem_set_id: key.problem_set_id.clone(),
            grade_id,
            outcome_url,
            outcome_ext_accepted,
            consumer_key,
            score,
        },
        html,
    )))
}

fn set_passback_status(conn: &Connection, key: &AssignmentKey, status: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE assignments SET grade_passback_status = ?
         WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
        params![status, key.user_id, key.course_id, key.problem_set_id],
    )?;
    Ok(())
}

pub fn build_grade_report_html(
    commit: &Commit,
    problem_unique: &str,
    total_steps: i64,
    total_problems: i64,
) -> String {
    let heading = if total_problems > 1 && total_steps > 1 {
        format!(
            "Grading transcript for problem {problem_unique} step {}",
            commit.step
        )
    } else if total_problems > 1 {
        format!("Grading transcript for problem {problem_unique}")
    } else if total_steps > 1 {
        format!("Grading transcript for step {}", commit.step)
    } else {
        "Grading transcript".to_owned()
    };
    let mut body = Vec::with_capacity(commit.files.len() + 2);
    body.push(format!("<h1>{}</h1>", html_escape(&heading)));
    body.push(ansi_to_html_pre(&transcript_text(&commit.transcript)));
    for (path, content) in &commit.files {
        if let Ok(text) = std::str::from_utf8(content) {
            body.push(format!(
                "<h1>File: <code>{}</code></h1>\n<pre><code>{}</code></pre>",
                html_escape(path),
                html_escape(text)
            ));
        } else {
            body.push(format!(
                "<h1>File: <code>{}</code> (binary contents)</h1>",
                html_escape(path)
            ));
        }
    }
    body.join("\n")
}

pub fn spawn_grade_passback(
    db: Db,
    config: Arc<ServerConfig>,
    target: GradePassbackTarget,
    report_html: String,
) {
    tokio::spawn(async move {
        let mut delay = Duration::from_secs(10);
        for attempt in 1..=10 {
            match save_grade(&config, &target, &report_html).await {
                Ok(()) => {
                    update_passback_status(&db, &target, PASSBACK_POSTED).await;
                    return;
                }
                Err(err) if err.is_transient() && attempt < 10 => {
                    eprintln!("error posting grade back to LMS (attempt {attempt}/10): {err}");
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_secs(300));
                }
                Err(err) => {
                    if err.is_user_not_in_course() {
                        update_passback_status(&db, &target, PASSBACK_USER_NOT_IN_COURSE).await;
                        eprintln!(
                            "LMS grade passback permanently failed because the user is no longer in the course for assignment {}/{}/{}: {err}",
                            target.user_id, target.course_id, target.problem_set_id
                        );
                    } else {
                        update_passback_status(&db, &target, PASSBACK_FAILED).await;
                        eprintln!(
                            "giving up posting LMS grade for assignment {}/{}/{}: {err}",
                            target.user_id, target.course_id, target.problem_set_id
                        );
                    }
                    return;
                }
            }
        }
    });
}

async fn update_passback_status(db: &Db, target: &GradePassbackTarget, status: &str) {
    let user_id = target.user_id.clone();
    let course_id = target.course_id.clone();
    let problem_set_id = target.problem_set_id.clone();
    let status = status.to_owned();
    if let Err(err) = db
        .transaction(move |conn| {
            conn.execute(
                "UPDATE assignments SET grade_passback_status = ? WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
                params![status, user_id, course_id, problem_set_id],
            )?;
            Ok(())
        })
        .await
    {
        eprintln!("error updating LMS grade passback status: {err}");
    }
}

async fn save_grade(
    config: &ServerConfig,
    target: &GradePassbackTarget,
    report_html: &str,
) -> Result<(), GradePassbackError> {
    if target.grade_id.is_empty() || target.outcome_url.is_empty() {
        return Ok(());
    }
    let payload = build_grade_xml(target, report_html);
    let auth = oauth_auth_header(
        target,
        "POST",
        &target.outcome_url,
        &payload,
        &config.hostname,
        &config.lti_secret,
    )?;
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&auth)
            .map_err(|err| AppError::Internal(format!("invalid OAuth header: {err}")))?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/xml"));
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));
    let response = crate::curl::post(CurlPostRequest {
        url: &target.outcome_url,
        headers: &headers,
        body: &payload,
        timeout: GRADE_PASSBACK_TIMEOUT,
        http_version: CurlHttpVersion::Http1_1,
    })
    .await?;
    let status = response.status;
    if status != http::StatusCode::OK {
        let body = String::from_utf8_lossy(&response.body).into_owned();
        return Err(GradePassbackError::Http { status, body });
    }
    Ok(())
}

fn build_grade_xml(target: &GradePassbackTarget, text: &str) -> Vec<u8> {
    let grade_text = if target.outcome_ext_accepted.contains("text") {
        text
    } else {
        ""
    };
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><imsx_POXEnvelopeRequest xmlns=\"http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0\"><imsx_POXHeader><imsx_POXRequestHeaderInfo><imsx_version>V1.0</imsx_version><imsx_messageIdentifier>Grade from CodeGrinder</imsx_messageIdentifier></imsx_POXRequestHeaderInfo></imsx_POXHeader><imsx_POXBody><replaceResultRequest><resultRecord><sourcedGUID><sourcedId>{}</sourcedId></sourcedGUID><result><resultScore><language>en</language><textString>{:0.5}</textString></resultScore><resultData><text>{}</text></resultData></result></resultRecord></replaceResultRequest></imsx_POXBody></imsx_POXEnvelopeRequest>",
        html_escape(&target.grade_id),
        target.score,
        html_escape(grade_text)
    )
    .into_bytes()
}

fn oauth_auth_header(
    target: &GradePassbackTarget,
    method: &str,
    target_url: &str,
    content: &[u8],
    hostname: &str,
    secret: &str,
) -> AppResult<String> {
    let body_hash = STANDARD.encode(Sha1::digest(content));
    let now = Utc::now();
    let mut params = BTreeMap::from([
        ("oauth_body_hash".to_owned(), vec![body_hash]),
        ("oauth_token".to_owned(), vec![String::new()]),
        (
            "oauth_consumer_key".to_owned(),
            vec![target.consumer_key.clone()],
        ),
        (
            "oauth_signature_method".to_owned(),
            vec!["HMAC-SHA1".to_owned()],
        ),
        (
            "oauth_timestamp".to_owned(),
            vec![now.timestamp().to_string()],
        ),
        ("oauth_version".to_owned(), vec!["1.0".to_owned()]),
        (
            "oauth_nonce".to_owned(),
            vec![now.timestamp_nanos_opt().unwrap_or_default().to_string()],
        ),
    ]);
    let sig = compute_oauth_signature(method, target_url, &params, secret)?;
    params.insert("oauth_signature".to_owned(), vec![sig]);
    let mut parts = Vec::with_capacity(params.len() + 1);
    parts.push(format!(
        "OAuth realm=\"{}\"",
        escape(&format!("https://{hostname}"))
    ));
    for (key, value) in params {
        let raw = value.first().cloned().unwrap_or_default();
        parts.push(format!("{key}=\"{}\"", escape(&raw)));
    }
    Ok(parts.join(","))
}

pub fn compute_oauth_signature(
    method: &str,
    request_url: &str,
    parameters: &BTreeMap<String, Vec<String>>,
    secret: &str,
) -> AppResult<String> {
    let normalized_url = normalize_oauth_url(request_url)?;
    let copied = parameters
        .iter()
        .filter(|(key, _)| key.as_str() != "oauth_signature")
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<BTreeMap<_, _>>();
    let param_string = String::from_utf8(encode_params(&copied)).unwrap_or_default();
    let base_string = format!(
        "{}&{}&{}",
        escape(&method.to_uppercase()),
        escape(&normalized_url),
        escape(&param_string)
    );
    let key = format!("{}&", escape(secret));
    hmac_sha1_base64(&key, base_string.as_bytes())
}

fn normalize_oauth_url(request_url: &str) -> AppResult<String> {
    let without_fragment = request_url
        .split_once('#')
        .map_or(request_url, |(head, _)| head);
    let without_query = without_fragment
        .split_once('?')
        .map_or(without_fragment, |(head, _)| head);
    let Some((scheme, rest)) = without_query.split_once("://") else {
        return Err(AppError::BadRequest(format!(
            "invalid request url: {request_url}"
        )));
    };
    let (host, path) = rest
        .split_once('/')
        .map_or((rest, ""), |(host, path)| (host, path));
    if scheme.is_empty() || host.is_empty() {
        return Err(AppError::BadRequest(format!(
            "invalid request url: {request_url}"
        )));
    }
    let mut normalized = format!(
        "{}://{}",
        scheme.to_ascii_lowercase(),
        host.to_ascii_lowercase()
    );
    if !path.is_empty() {
        normalized.push('/');
        normalized.push_str(path);
    }
    Ok(normalized)
}

fn transcript_text(events: &[EventMessage]) -> String {
    events.iter().map(transcript_event_text).collect()
}

fn transcript_event_text(event: &EventMessage) -> String {
    match event.event.as_str() {
        "exec" => format!("$ {}\r\n", event.exec_command.join(" ")),
        "exit" => {
            if event.exit_status == 0 {
                String::new()
            } else if let Some(name) = signal_name(event.exit_status - 128) {
                format!("exit status {} (killed by {name})\r\n", event.exit_status)
            } else {
                format!("exit status {}\r\n", event.exit_status)
            }
        }
        "stdin" | "stdout" | "stderr" => String::from_utf8_lossy(&event.stream_data).to_string(),
        "error" => format!("Error: {}\r\n", event.error),
        _ => String::new(),
    }
}

fn signal_name(signal: i32) -> Option<&'static str> {
    match signal {
        1 => Some("SIGHUP"),
        2 => Some("SIGINT"),
        3 => Some("SIGQUIT"),
        4 => Some("SIGILL"),
        5 => Some("SIGTRAP"),
        6 => Some("SIGABRT"),
        7 => Some("SIGBUS"),
        8 => Some("SIGFPE"),
        9 => Some("SIGKILL"),
        10 => Some("SIGUSR1"),
        11 => Some("SIGSEGV"),
        12 => Some("SIGUSR2"),
        13 => Some("SIGPIPE"),
        14 => Some("SIGALRM"),
        15 => Some("SIGTERM"),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rgb {
    r: i32,
    g: i32,
    b: i32,
}

#[derive(Clone, Copy, Debug, Default)]
struct AnsiStyle {
    fg: Option<Rgb>,
    bg: Option<Rgb>,
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    inverse: bool,
}

impl AnsiStyle {
    fn css(self) -> String {
        let mut parts = Vec::new();
        let mut fg = self.fg;
        let mut bg = self.bg;
        if self.inverse {
            std::mem::swap(&mut fg, &mut bg);
        }
        if let Some(color) = fg {
            parts.push(format!("color:rgb({},{},{})", color.r, color.g, color.b));
        }
        if let Some(color) = bg {
            parts.push(format!(
                "background-color:rgb({},{},{})",
                color.r, color.g, color.b
            ));
        }
        if self.bold {
            parts.push("font-weight:bold".to_owned());
        }
        if self.dim {
            parts.push("opacity:0.75".to_owned());
        }
        if self.italic {
            parts.push("font-style:italic".to_owned());
        }
        if self.underline && self.strike {
            parts.push("text-decoration:underline line-through".to_owned());
        } else if self.underline {
            parts.push("text-decoration:underline".to_owned());
        } else if self.strike {
            parts.push("text-decoration:line-through".to_owned());
        }
        parts.join(";")
    }

    fn apply_sgr(&mut self, params: &[i32]) {
        if params.is_empty() {
            *self = Self::default();
            return;
        }
        let mut i = 0;
        while i < params.len() {
            match params[i] {
                0 => *self = Self::default(),
                1 => self.bold = true,
                2 => self.dim = true,
                3 => self.italic = true,
                4 => self.underline = true,
                7 => self.inverse = true,
                9 => self.strike = true,
                22 => {
                    self.bold = false;
                    self.dim = false;
                }
                23 => self.italic = false,
                24 => self.underline = false,
                27 => self.inverse = false,
                29 => self.strike = false,
                30..=37 => self.fg = Some(ansi_basic_color(params[i] - 30)),
                90..=97 => self.fg = Some(ansi_basic_bright_color(params[i] - 90)),
                40..=47 => self.bg = Some(ansi_basic_color(params[i] - 40)),
                100..=107 => self.bg = Some(ansi_basic_bright_color(params[i] - 100)),
                39 => self.fg = None,
                49 => self.bg = None,
                38 | 48 => {
                    let is_fg = params[i] == 38;
                    if i + 1 < params.len() {
                        match params[i + 1] {
                            5 if i + 2 < params.len() => {
                                let color = xterm256(params[i + 2]);
                                if is_fg {
                                    self.fg = Some(color);
                                } else {
                                    self.bg = Some(color);
                                }
                                i += 2;
                            }
                            2 if i + 4 < params.len() => {
                                let color = Rgb {
                                    r: params[i + 2],
                                    g: params[i + 3],
                                    b: params[i + 4],
                                };
                                if is_fg {
                                    self.fg = Some(color);
                                } else {
                                    self.bg = Some(color);
                                }
                                i += 4;
                            }
                            _ => i += 1,
                        }
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }
}

fn ansi_to_html_pre(raw: &str) -> String {
    format!(
        r#"<pre style="color:white;background-color:black;">{}</pre>"#,
        ansi_to_inline_html(raw)
    )
}

fn ansi_to_inline_html(raw: &str) -> String {
    let mut out = String::new();
    let mut style = AnsiStyle::default();
    let mut span_open = false;
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b';') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'm' {
                if span_open {
                    out.push_str("</span>");
                    span_open = false;
                }
                style.apply_sgr(&parse_sgr_params(&raw[i + 2..j]));
                let css = style.css();
                if !css.is_empty() {
                    out.push_str(r#"<span style=""#);
                    out.push_str(&css);
                    out.push_str(r#"">"#);
                    span_open = true;
                }
                i = j + 1;
                continue;
            }
        }
        let Some(ch) = raw[i..].chars().next() else {
            break;
        };
        out.push_str(&html_escape(&ch.to_string()));
        i += ch.len_utf8();
    }
    if span_open {
        out.push_str("</span>");
    }
    out
}

fn parse_sgr_params(raw: &str) -> Vec<i32> {
    if raw.trim().is_empty() {
        return vec![0];
    }
    raw.split(';')
        .filter_map(|part| {
            if part.is_empty() {
                Some(0)
            } else {
                part.parse::<i32>().ok()
            }
        })
        .collect()
}

fn ansi_basic_color(n: i32) -> Rgb {
    match n {
        0 => Rgb { r: 0, g: 0, b: 0 },
        1 => Rgb {
            r: 205,
            g: 49,
            b: 49,
        },
        2 => Rgb {
            r: 13,
            g: 188,
            b: 121,
        },
        3 => Rgb {
            r: 229,
            g: 229,
            b: 16,
        },
        4 => Rgb {
            r: 36,
            g: 114,
            b: 200,
        },
        5 => Rgb {
            r: 188,
            g: 63,
            b: 188,
        },
        6 => Rgb {
            r: 17,
            g: 168,
            b: 205,
        },
        _ => Rgb {
            r: 229,
            g: 229,
            b: 229,
        },
    }
}

fn ansi_basic_bright_color(n: i32) -> Rgb {
    match n {
        0 => Rgb {
            r: 102,
            g: 102,
            b: 102,
        },
        1 => Rgb {
            r: 241,
            g: 76,
            b: 76,
        },
        2 => Rgb {
            r: 35,
            g: 209,
            b: 139,
        },
        3 => Rgb {
            r: 245,
            g: 245,
            b: 67,
        },
        4 => Rgb {
            r: 59,
            g: 142,
            b: 234,
        },
        5 => Rgb {
            r: 214,
            g: 112,
            b: 214,
        },
        6 => Rgb {
            r: 41,
            g: 184,
            b: 219,
        },
        _ => Rgb {
            r: 255,
            g: 255,
            b: 255,
        },
    }
}

fn xterm256(n: i32) -> Rgb {
    let n = n.clamp(0, 255);
    match n {
        0..=15 => {
            if n < 8 {
                ansi_basic_color(n)
            } else {
                ansi_basic_bright_color(n - 8)
            }
        }
        16..=231 => {
            let n = n - 16;
            Rgb {
                r: cube(n / 36),
                g: cube((n % 36) / 6),
                b: cube(n % 6),
            }
        }
        _ => {
            let gray = 8 + (n - 232) * 10;
            Rgb {
                r: gray,
                g: gray,
                b: gray,
            }
        }
    }
}

fn cube(v: i32) -> i32 {
    [0, 95, 135, 175, 215, 255][v.clamp(0, 5) as usize]
}

fn html_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_test_connection;
    use crate::proto::EventMessage;

    #[test]
    fn report_html_uses_ansi_transcript_and_skips_binary_file_contents() {
        let commit = Commit {
            step: 1,
            transcript: vec![
                EventMessage {
                    event: "exec".to_owned(),
                    exec_command: vec!["python".to_owned(), "main.py".to_owned()],
                    ..EventMessage::default()
                },
                EventMessage {
                    event: "stdout".to_owned(),
                    stream_data: b"\x1b[31mred\x1b[0m\n".to_vec(),
                    ..EventMessage::default()
                },
            ],
            files: BTreeMap::from([
                ("answer.txt".to_owned(), b"a < b".to_vec()),
                ("image.bin".to_owned(), vec![0xff, 0x00]),
            ]),
            ..Commit::default()
        };

        let html = build_grade_report_html(&commit, "p1", 1, 1);

        assert!(html.contains(r#"<pre style="color:white;background-color:black;">"#));
        assert!(html.contains(r#"<span style="color:rgb(205,49,49)">red</span>"#));
        assert!(html.contains("<pre><code>a &lt; b</code></pre>"));
        assert!(html.contains("image.bin</code> (binary contents)"));
        assert!(!html.contains(char::REPLACEMENT_CHARACTER));
    }

    #[test]
    fn oauth_header_percent_escapes_values_like_go() {
        let target = GradePassbackTarget {
            user_id: "u1".to_owned(),
            course_id: "c1".to_owned(),
            problem_set_id: "ps1".to_owned(),
            grade_id: "grade".to_owned(),
            outcome_url: "https://lms.example/outcome".to_owned(),
            outcome_ext_accepted: "text".to_owned(),
            consumer_key: "consumer key".to_owned(),
            score: 1.0,
        };

        let header = oauth_auth_header(
            &target,
            "POST",
            &target.outcome_url,
            b"payload",
            "ta.example",
            "secret",
        )
        .unwrap();

        assert!(header.starts_with(r#"OAuth realm="https%3A%2F%2Fta.example""#));
        assert!(header.contains(r#"oauth_consumer_key="consumer%20key""#));
        assert!(header.contains("oauth_body_hash="));
        assert!(header.contains("%3D"));
    }

    #[test]
    fn oauth_url_normalization_strips_query_fragment_and_lowers_authority() {
        assert_eq!(
            normalize_oauth_url("HTTPS://LMS.EXAMPLE:443/path/to?x=1#frag").unwrap(),
            "https://lms.example:443/path/to"
        );
    }

    #[test]
    fn passback_retries_only_statuses_that_can_succeed_later() {
        for status in [
            http::StatusCode::REQUEST_TIMEOUT,
            http::StatusCode::TOO_EARLY,
            http::StatusCode::TOO_MANY_REQUESTS,
            http::StatusCode::INTERNAL_SERVER_ERROR,
            http::StatusCode::BAD_GATEWAY,
            http::StatusCode::SERVICE_UNAVAILABLE,
            http::StatusCode::GATEWAY_TIMEOUT,
        ] {
            assert!(is_transient_http_status(status), "{status}");
        }
        for status in [
            http::StatusCode::BAD_REQUEST,
            http::StatusCode::UNAUTHORIZED,
            http::StatusCode::FORBIDDEN,
            http::StatusCode::NOT_FOUND,
            http::StatusCode::METHOD_NOT_ALLOWED,
            http::StatusCode::UNPROCESSABLE_ENTITY,
            http::StatusCode::NOT_IMPLEMENTED,
        ] {
            assert!(!is_transient_http_status(status), "{status}");
        }
    }

    #[test]
    fn canvas_user_not_in_course_response_is_a_resolved_failure() {
        let response = GradePassbackError::Http {
            status: http::StatusCode::UNPROCESSABLE_ENTITY,
            body: r#"<?xml version="1.0" encoding="UTF-8"?>
                <imsx_POXEnvelopeResponse xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0">
                    <imsx_POXHeader><imsx_POXResponseHeaderInfo><imsx_statusInfo>
                        <imsx_description>User is no longer in course</imsx_description>
                        <ext_canvas_error_code>
                            user_not_in_course
                        </ext_canvas_error_code>
                    </imsx_statusInfo></imsx_POXResponseHeaderInfo></imsx_POXHeader>
                </imsx_POXEnvelopeResponse>"#
                .to_owned(),
        };

        assert!(response.is_user_not_in_course());

        let unrelated_response = GradePassbackError::Http {
            status: http::StatusCode::UNPROCESSABLE_ENTITY,
            body: "<error>User is no longer in course</error>".to_owned(),
        };
        assert!(!unrelated_response.is_user_not_in_course());
    }

    #[test]
    fn startup_recovery_reloads_current_grade_and_latest_commit() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_test_connection(&dir.path().join("db.sqlite")).unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO problem_types(problem_type, container) VALUES ('python', 'python');
            INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at)
                VALUES ('p1', '', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight)
                VALUES ('p1', 1, 'python', '', 1), ('p1', 2, 'python', '', 1);
            INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at)
                VALUES ('ps1', '', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight)
                VALUES ('ps1', 'p1', 1);
            INSERT INTO users(user_id, user_name, user_login) VALUES ('u1', 'User', 'user');
            INSERT INTO courses(course_id, course_name) VALUES ('c1', 'Course');
            INSERT INTO user_courses(user_id, course_id, course_roles) VALUES ('u1', 'c1', 'Learner');
            INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, grade_passback_status)
                VALUES ('u1', 'c1', 'ps1', 'Assignment', 0, 'grade1', 'https://lms.example/outcome', 'text', 'consumer', 'post_failed');
            INSERT INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at)
                VALUES
                    ('u1', 'c1', 'ps1', 'p1', 1, 'grade', '', '[{"event":"stdout","stream_data":"older"}]', '{"passed":false}', 0.5, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                    ('u1', 'c1', 'ps1', 'p1', 2, 'grade', '', '[{"event":"stdout","stream_data":"latest"}]', '{"passed":true}', 1.0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
            INSERT INTO commit_files(user_id, course_id, problem_set_id, problem_id, step_number, path, content)
                VALUES ('u1', 'c1', 'ps1', 'p1', 2, 'answer.txt', x'63757272656e7420616e73776572');
            "#,
        )
        .unwrap();
        let key = AssignmentKey {
            user_id: "u1".to_owned(),
            course_id: "c1".to_owned(),
            problem_set_id: "ps1".to_owned(),
        };

        let (target, html) = prepare_startup_grade_passback_tx(&conn, &key, Utc::now())
            .unwrap()
            .unwrap();

        assert_eq!(target.score, 0.75);
        assert!(html.contains("latest"));
        assert!(!html.contains("older"));
        assert!(html.contains("current answer"));
        assert!(html.contains("Grading transcript for step 2"));
        assert_eq!(
            conn.query_row("SELECT grade_passback_status FROM assignments", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
            PASSBACK_PENDING
        );

        conn.execute(
            "UPDATE assignments SET grade_passback_status = ?",
            params![PASSBACK_POSTED],
        )
        .unwrap();
        assert!(
            prepare_startup_grade_passback_tx(&conn, &key, Utc::now())
                .unwrap()
                .is_none()
        );
    }
}
