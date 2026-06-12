use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::Utc;
use http::header::{AUTHORIZATION, CONTENT_TYPE};
use rusqlite::params;
use sha1::{Digest, Sha1};

use crate::config::ServerConfig;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::proto::{Commit, EventMessage};
use crate::signatures::{encode_params, escape, hmac_sha1_base64};

pub const PASSBACK_POSTED: &str = "posted";
pub const PASSBACK_PENDING: &str = "post_pending";
pub const PASSBACK_FAILED: &str = "post_failed";
pub const PASSBACK_NO_TARGET: &str = "not_posted_no_target";
pub const PASSBACK_LOCKED: &str = "not_posted_locked";

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
                Err(err) if attempt < 10 => {
                    eprintln!("error posting grade back to LMS (attempt {attempt}/10): {err}");
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_secs(300));
                }
                Err(err) => {
                    update_passback_status(&db, &target, PASSBACK_FAILED).await;
                    eprintln!(
                        "giving up posting LMS grade for assignment {}/{}/{}: {err}",
                        target.user_id, target.course_id, target.problem_set_id
                    );
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
) -> AppResult<()> {
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
    let client = reqwest::Client::new();
    let response = client
        .post(&target.outcome_url)
        .header(AUTHORIZATION, auth)
        .header(CONTENT_TYPE, "application/xml")
        .body(payload)
        .send()
        .await
        .map_err(|err| AppError::Internal(format!("grade passback failed: {err}")))?;
    if response.status() != http::StatusCode::OK {
        return Err(AppError::Internal(format!(
            "grade passback status {}",
            response.status()
        )));
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
}
