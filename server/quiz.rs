//! Attended quiz entry keeps the password transient and grants only one assignment.
use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::{IpAddr, SocketAddr};
use std::os::unix::fs::OpenOptionsExt;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use chrono::{Duration, Utc};
use hmac::{Hmac, KeyInit, Mac};
use rand::RngExt;
use rand::distr::{Alphanumeric, SampleString};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::{AppError, AppResult};
use crate::ipfilter::extract_ip;
use crate::lti::{LtiState, escape_xml, form_first, is_instructor_role, validate_oauth_signature};
use crate::proto::AssignmentKey;
use crate::sessions::{create_session, session_key_hash};
use crate::signatures::{escape, hmac_sha256_base64};
use crate::store::UserRow;
use crate::timeutil::db_time;

#[derive(Clone, Debug)]
pub struct QuizScope {
    pub key_hash: String,
    pub station_ip: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Context {
    pub course: String,
    pub problem_set: String,
}

// JSON arrays delimit every input, and purpose labels separate otherwise identical tags.
fn payload(purpose: &str, context: &Context, password: &str) -> AppResult<Vec<u8>> {
    Ok(serde_json::to_vec(&("codegrinder:quiz:v1", purpose, context, password))?)
}
fn tag(secret: &str, purpose: &str, context: &Context, password: &str) -> AppResult<String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|err| AppError::Internal(format!("invalid HMAC key: {err}")))?;
    mac.update(&payload(purpose, context, password)?);
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}
fn verify(secret: &str, purpose: &str, context: &Context, password: &str, signature: &str) -> bool {
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(signature) else { return false };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else { return false };
    let Ok(payload) = payload(purpose, context, password) else { return false };
    mac.update(&payload);
    mac.verify_slice(&bytes).is_ok()
}
fn random_id() -> String {
    Alphanumeric.sample_string(&mut rand::rng(), 32)
}

pub fn router(state: LtiState) -> Router {
    Router::new()
        .route("/lti/picker", post(picker_launch))
        .route("/quiz/configure", post(configure))
        .route("/quiz/connect", get(connector).post(redeem))
        .with_state(state)
}

// The logger preserves repeated and non-UTF8 header values without logging POST bodies.
pub fn log_headers(
    config: &crate::config::ServerConfig,
    stage: &str,
    peer: SocketAddr,
    headers: &HeaderMap,
) -> AppResult<()> {
    let path = std::env::var_os("CODEGRINDER_QUIZ_LOG")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| config.sqlite3_path.with_file_name("quiz-headers.jsonl"));
    let values: Vec<_> = headers
        .iter()
        .map(|(name, value)| (name.as_str(), STANDARD.encode(value.as_bytes())))
        .collect();
    let record = serde_json::json!({"at": Utc::now(), "stage": stage, "peer": peer.to_string(),
        "station_ip": extract_ip(headers, Some(peer)), "headers_base64": values});
    let mut file = OpenOptions::new().create(true).append(true).mode(0o600).open(path)?;
    let mut bytes = serde_json::to_vec(&record)?;
    bytes.push(b'\n');
    file.write_all(&bytes)?;
    Ok(())
}

pub fn station(state: &LtiState, peer: SocketAddr, headers: &HeaderMap) -> AppResult<String> {
    // Only the local reverse proxy may assert forwarded station identities.
    if !peer.ip().is_loopback() {
        return Err(AppError::Forbidden("quiz entry requires the local proxy".into()));
    }
    let raw = extract_ip(headers, Some(peer))
        .ok_or_else(|| AppError::Forbidden("station address is missing".into()))?;
    let ip: IpAddr =
        raw.parse().map_err(|_| AppError::Forbidden("invalid station address".into()))?;
    if !state.ip_filter.enabled() || !state.ip_filter.allows(&ip.to_string()) {
        return Err(AppError::Forbidden(
            "quiz access is restricted to approved testing-center stations".into(),
        ));
    }
    Ok(ip.to_string())
}

fn form(body: &[u8]) -> BTreeMap<String, Vec<String>> {
    form_urlencoded::parse(body).fold(BTreeMap::new(), |mut out, (k, v)| {
        out.entry(k.into_owned()).or_default().push(v.into_owned());
        out
    })
}
fn link_tag(parameters: &BTreeMap<String, Vec<String>>) -> AppResult<String> {
    let values = parameters.get("tag").filter(|values| values.len() == 1).ok_or_else(|| {
        AppError::BadRequest(
            "quiz link requires one tag; recreate older links with the picker".into(),
        )
    })?;
    let value = &values[0];
    if value.len() != 43 || URL_SAFE_NO_PAD.decode(value).is_err() {
        return Err(AppError::BadRequest("invalid quiz link tag".into()));
    }
    Ok(value.clone())
}
fn hidden(name: &str, value: &str) -> String {
    format!("<input type=hidden name=\"{}\" value=\"{}\">", escape_xml(name), escape_xml(value))
}
fn page(title: &str, body: &str) -> Response {
    let html = format!(
        "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>{}</title><style>body{{font:1.2rem system-ui;max-width:48rem;margin:3rem auto;padding:1rem}}label,input,select,button{{display:block;margin:.7rem 0;font:inherit}}input,select{{max-width:100%}}code{{font-size:3rem;letter-spacing:.2em}}textarea{{width:100%;height:6rem}}</style><main>{body}</main></html>",
        escape_xml(title)
    );
    ([(header::CACHE_CONTROL, "no-store"), (header::REFERRER_POLICY, "no-referrer")], Html(html))
        .into_response()
}
fn response(result: AppResult<Response>) -> Response {
    match result {
        Ok(r) => r,
        Err(e) => {
            if e.status_code().is_server_error() {
                crate::logging::record("ERROR", "quiz_failed", format_args!("error={e:?}"));
                return (
                    e.status_code(),
                    "Quiz entry failed. Contact the testing-center attendant.",
                )
                    .into_response();
            }
            (e.status_code(), e.to_string()).into_response()
        }
    }
}

// Picker state is signed, short-lived, and contains only the trusted course/return URL.
#[derive(Serialize, Deserialize)]
struct PickerState {
    course: String,
    return_url: String,
    consumer_key: String,
    data: String,
    expires: i64,
}
async fn picker_launch(State(state): State<LtiState>, body: Bytes) -> Response {
    let result = async {
        let f = form(&body);
        validate_oauth_signature("POST", &format!("https://{}/lti/picker",state.config.hostname), &f, &state.config.lti_secret)?;
        if !is_instructor_role(&form_first(&f,"roles")) { return Err(AppError::Forbidden("the picker requires a course instructor".into())); }
        let return_url = form_first(&f,"content_item_return_url");
        if !return_url.starts_with("https://") { return Err(AppError::BadRequest("missing secure Canvas content-item return URL".into())); }
        let course = form_first(&f,"context_id");
        if course.is_empty() { return Err(AppError::BadRequest("missing Canvas course identity".into())); }
        // The signed launch supplies the return destination; submitted picker forms cannot replace it.
        let picker = PickerState { course, return_url, consumer_key: form_first(&f,"oauth_consumer_key"), data: form_first(&f,"data"), expires: Utc::now().timestamp()+1800 };
        let ticket = STANDARD.encode(serde_json::to_vec(&picker)?);
        let signature = hmac_sha256_base64(&state.config.session_secret, format!("quiz-picker:v1:{ticket}").as_bytes())?;
        let options = state.db.transaction(false, |conn| {
            let mut stmt=conn.prepare("SELECT problem_set_id, problem_set_note FROM problem_sets ORDER BY problem_set_id")?;
            let rows=stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?;
            let mut out=String::new();
            for row in rows { let (id,note)=row?; out.push_str(&format!("<option value=\"{}\">{} — {}</option>",escape_xml(&id),escape_xml(&id),escape_xml(&note))); }
            Ok(out)
        }).await?;
        Ok(page("Choose a problem set", &format!("<h1>Choose a problem set</h1><form method=post action=/quiz/configure>{}{}<label>Problem set<select name=problem_set required>{options}</select></label><label>Entry mode<select name=mode><option value=cli>CLI</option><option value=web>Web</option><option value=exam>Testing-center VM</option><option value=quiz>Respondus quiz</option></select></label><label>Quiz password (quiz mode only)<input type=password name=password autocomplete=new-password maxlength=256></label><p>Use the same password in the Canvas quiz’s Respondus settings.</p><button>Create assignment link</button></form>", hidden("ticket",&ticket),hidden("signature",&signature))))
    }.await;
    response(result)
}

async fn configure(State(state): State<LtiState>, body: Bytes) -> Response {
    let result = async {
        let f=form(&body); let ticket=form_first(&f,"ticket");
        let expected=hmac_sha256_base64(&state.config.session_secret,format!("quiz-picker:v1:{ticket}").as_bytes())?;
        // Verify signed state using a MAC over the supplied tag to avoid timing-sensitive string comparison.
        if !constant_equal(&expected,&form_first(&f,"signature")) { return Err(AppError::Forbidden("invalid picker session".into())); }
        let picker: PickerState=serde_json::from_slice(&STANDARD.decode(&ticket).map_err(|_|AppError::BadRequest("invalid picker session".into()))?)?;
        if picker.expires <= Utc::now().timestamp() { return Err(AppError::Forbidden("picker session expired; reopen it from Canvas".into())); }
        let set=form_first(&f,"problem_set");
        let set_db=set.clone();
        state.db.transaction(false,move |conn| {
            if !conn.query_row("SELECT EXISTS(SELECT 1 FROM problem_sets WHERE problem_set_id=?)",[set_db],|r|r.get::<_,bool>(0))? { return Err(AppError::BadRequest("unknown problem set".into())); } Ok(())
        }).await?;
        let mode=form_first(&f,"mode");
        if !matches!(mode.as_str(),"cli"|"web"|"exam"|"quiz") { return Err(AppError::BadRequest("invalid entry mode".into())); }
        let mut url=format!("https://{}/lti/problem_sets/{}/{}",state.config.hostname,mode,escape(&set));
        let mut instructions=String::new();
        if mode=="quiz" {
            let password=form_first(&f,"password");
            if password.is_empty() || password.len()>256 { return Err(AppError::BadRequest("enter the Canvas quiz password (up to 256 bytes)".into())); }
            let c=Context{course:picker.course.clone(),problem_set:set.clone()};
            url.push_str(&format!("?tag={}",tag(&state.config.session_secret,"assignment",&c,&password)?));
            let connector=format!("https://{}/quiz/connect?tag={}",state.config.hostname,tag(&state.config.session_secret,"connector",&c,&password)?);
            instructions=format!("<h2>Canvas quiz setup</h2><p>Require Respondus, configure the matching password, and allow the CodeGrinder domain. Put this link in a quiz question, opening in a new tab:</p><textarea readonly aria-label='Quiz connector link'>{}</textarea><p>Copy this link before returning to Canvas. Regenerate both links when changing the password or copying to another course.</p>",escape_xml(&connector));
        }
        let items=serde_json::json!({"@context":"http://purl.imsglobal.org/ctx/lti/v1/ContentItem", "@graph":[{"@type":"LtiLinkItem","mediaType":"application/vnd.ims.lti.v1.ltilink","title":set,"url":url,"placementAdvice":{"presentationDocumentTarget":"window"}}]}).to_string();
        let mut fields=BTreeMap::from([("lti_message_type".into(),vec!["ContentItemSelection".into()]),("lti_version".into(),vec!["LTI-1p0".into()]),("content_items".into(),vec![items]),("oauth_consumer_key".into(),vec![picker.consumer_key]),("oauth_nonce".into(),vec![random_id()]),("oauth_timestamp".into(),vec![Utc::now().timestamp().to_string()]),("oauth_signature_method".into(),vec!["HMAC-SHA1".into()]),("oauth_version".into(),vec!["1.0".into()])]);
        if !picker.data.is_empty() { fields.insert("data".into(),vec![picker.data]); }
        let mut signed_fields = fields.clone();
        if let Some((_,query)) = picker.return_url.split_once('?') {
            for (name, values) in form(query.as_bytes()) { signed_fields.entry(name).or_default().extend(values); }
        }
        let signature=crate::passback::compute_oauth_signature("POST",&picker.return_url,&signed_fields,&state.config.lti_secret)?;
        fields.insert("oauth_signature".into(),vec![signature]);
        let inputs=fields.iter().map(|(k,v)|hidden(k,&v[0])).collect::<String>();
        Ok(page("Assignment link",&format!("<h1>Assignment link ready</h1>{instructions}<form method=post action=\"{}\">{inputs}<button>Use this assignment in Canvas</button></form>",escape_xml(&picker.return_url))))
    }.await;
    response(result)
}
fn constant_equal(a: &str, b: &str) -> bool {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(a.as_bytes()) else { return false };
    mac.update(b"compare");
    let value = mac.finalize().into_bytes();
    let Ok(mut other) = Hmac::<Sha256>::new_from_slice(b.as_bytes()) else { return false };
    other.update(b"compare");
    other.verify_slice(&value).is_ok()
}

// A launch never supplies a login token. Its displayed code is useful only with attended redemption.
pub fn prepare(
    conn: &Connection,
    key: &AssignmentKey,
    assignment_tag: &str,
    ip: &str,
) -> AppResult<String> {
    let now = Utc::now();
    conn.execute("INSERT INTO quiz_assignments VALUES (?,?,?,?) ON CONFLICT(user_id,course_id,problem_set_id) DO UPDATE SET assignment_tag=excluded.assignment_tag",params![key.user_id,key.course_id,key.problem_set_id,assignment_tag])?;
    let code = format!("{:06}", rand::rng().random_range(0..1_000_000));
    conn.execute("INSERT INTO quiz_entries(station_ip,quiz_code,user_id,course_id,problem_set_id,assignment_tag,entry_created_at,entry_expires_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(station_ip) DO UPDATE SET quiz_code=excluded.quiz_code,user_id=excluded.user_id,course_id=excluded.course_id,problem_set_id=excluded.problem_set_id,assignment_tag=excluded.assignment_tag,entry_created_at=excluded.entry_created_at,entry_expires_at=excluded.entry_expires_at,entry_attempts=0,entry_consumed_at=NULL",params![ip,code,key.user_id,key.course_id,key.problem_set_id,assignment_tag,db_time(now),db_time(now+Duration::minutes(10))])?;
    let identity = identity(conn, key)?;
    Ok(format!(
        "<h1>Testing-center quiz check-in</h1><pre>{}</pre><p>Student and attendant: write down this code:</p><code>{code}</code><p>The code expires in ten minutes. Exit Canvas in this browser and open the quiz in Respondus LockDown Browser. The attendant will enter the quiz password, then enter this code and password at the CodeGrinder link.</p>",
        escape_xml(&identity)
    ))
}
fn identity(conn: &Connection, key: &AssignmentKey) -> AppResult<String> {
    conn.query_row("SELECT user_name,course_name,assignment_title FROM assignments NATURAL JOIN users NATURAL JOIN courses WHERE user_id=? AND course_id=? AND problem_set_id=?",params![key.user_id,key.course_id,key.problem_set_id],|r|Ok(format!("{}\n{}\n{}",r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(Into::into)
}
pub fn preparation_page(body: &str) -> Response {
    page("Quiz check-in", body)
}

async fn connector(
    State(state): State<LtiState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    uri: axum::http::Uri,
) -> Response {
    response(async {
        log_headers(&state.config, "connector",peer,&headers)?; station(&state,peer,&headers)?;
        let f=form(uri.query().unwrap_or_default().as_bytes());
        let fields=hidden("tag", &link_tag(&f)?);
        Ok(page("Enter quiz",&format!("<h1>Enter quiz</h1><p>Testing-center attendant: verify that Respondus LockDown Browser is running, then enter the student’s code and quiz password.</p><form method=post action=/quiz/connect>{fields}<label>Six-digit code<input name=code inputmode=numeric pattern='[0-9]{{6}}' maxlength=6 required autocomplete=off></label><label>Quiz password<input name=password type=password required maxlength=256 autocomplete=off></label><button>Open assignment</button></form>")))
    }.await)
}

async fn redeem(
    State(state): State<LtiState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    response(async {
        log_headers(&state.config, "redemption",peer,&headers)?; let ip=station(&state,peer,&headers)?;
        let f=form(&body); link_tag(&f)?; let config=state.config.clone();
        // Return validation failures as values so the transaction commits the attempt count.
        let result=state.db.transaction(true,move |conn| redeem_entry(conn,&config,&ip,&f)).await?;
        let Some((key,session,identity))=result else { return Err(AppError::Forbidden("Invalid or expired entry. Check the code and password; relaunch from Canvas if necessary.".into())); };
        // A fragment avoids forwarding the bearer key in HTTP requests or referrers.
        let handoff=serde_json::json!({"session":session,"identity":identity}).to_string();
        let location=format!("/vm/?assignment={}#quiz={}",escape(&format!("{}:{}:{}",key.user_id,key.course_id,key.problem_set_id)),escape(&handoff));
        Ok((axum::http::StatusCode::SEE_OTHER,[(header::LOCATION,location),(header::CACHE_CONTROL,"no-store".into()),(header::REFERRER_POLICY,"no-referrer".into())]).into_response())
    }.await)
}
fn redeem_entry(
    conn: &Connection,
    config: &crate::config::ServerConfig,
    ip: &str,
    f: &BTreeMap<String, Vec<String>>,
) -> AppResult<Option<(AssignmentKey, String, String)>> {
    let now = Utc::now();
    let time = db_time(now);
    conn.execute(
        "DELETE FROM quiz_station_attempts WHERE datetime(attempt_window_end)<=datetime(?)",
        [&time],
    )?;
    conn.execute(
        "INSERT INTO quiz_station_attempts VALUES (?,?,0) ON CONFLICT(station_ip) DO NOTHING",
        params![ip, db_time(now + Duration::minutes(10))],
    )?;
    let attempts = conn.query_row(
        "SELECT station_attempts FROM quiz_station_attempts WHERE station_ip=?",
        [ip],
        |r| r.get::<_, i64>(0),
    )?;
    if attempts >= 20 {
        return Ok(None);
    }
    conn.execute(
        "UPDATE quiz_station_attempts SET station_attempts=station_attempts+1 WHERE station_ip=?",
        [ip],
    )?;
    let pending=conn.query_row("SELECT user_id,course_id,problem_set_id,quiz_code,assignment_tag FROM quiz_entries WHERE station_ip=? AND entry_consumed_at IS NULL AND datetime(entry_expires_at)>datetime(?) AND entry_attempts<5",params![ip,time],|r|Ok((AssignmentKey{user_id:r.get(0)?,course_id:r.get(1)?,problem_set_id:r.get(2)?},r.get::<_,String>(3)?,r.get::<_,String>(4)?))).optional()?;
    let Some((key, code, assignment_tag)) = pending else { return Ok(None) };
    let c = Context { course: key.course_id.clone(), problem_set: key.problem_set_id.clone() };
    conn.execute(
        "UPDATE quiz_entries SET entry_attempts=entry_attempts+1 WHERE station_ip=?",
        [ip],
    )?;
    let password = form_first(f, "password");
    if code != form_first(f, "code")
        || !verify(&config.session_secret, "assignment", &c, &password, &assignment_tag)
        || !verify(&config.session_secret, "connector", &c, &password, &form_first(f, "tag"))
    {
        return Ok(None);
    }
    // Availability uses the same authoritative policy view as workspace download.
    let ready=conn.query_row("SELECT download_available FROM accessible_assignment_policy WHERE viewer_user_id=? AND assignment_user_id=? AND course_id=? AND problem_set_id=?",params![key.user_id,key.user_id,key.course_id,key.problem_set_id],|r|r.get::<_,bool>(0))?;
    if !ready {
        return Ok(None);
    }
    conn.execute("UPDATE user_sessions SET session_revoked_at=? WHERE session_key_hash IN (SELECT session_key_hash FROM quiz_sessions WHERE station_ip=? OR (user_id=? AND course_id=? AND problem_set_id=?)) AND session_revoked_at IS NULL",params![time,ip,key.user_id,key.course_id,key.problem_set_id])?;
    let session =
        create_session(conn, &key.user_id, now, &config.sessions_expire, &config.session_secret)?;
    let hash = session_key_hash(&session.session_key, &config.session_secret)?;
    conn.execute(
        "INSERT INTO quiz_sessions VALUES (?,?,?,?,?,?)",
        params![hash, key.user_id, key.course_id, key.problem_set_id, assignment_tag, ip],
    )?;
    conn.execute(
        "UPDATE quiz_entries SET entry_consumed_at=? WHERE station_ip=?",
        params![time, ip],
    )?;
    Ok(Some((key.clone(), session.session_key, identity(conn, &key)?)))
}

// Session checks repeat inside each workspace/save transaction, including final grade persistence.
pub fn require_access(conn: &Connection, actor: &UserRow, key: &AssignmentKey) -> AppResult<()> {
    if let Some(scope) = &actor.quiz_scope {
        let allowed=conn.query_row("SELECT EXISTS(SELECT 1 FROM quiz_sessions NATURAL JOIN user_sessions NATURAL JOIN quiz_assignments WHERE session_key_hash=? AND station_ip=? AND user_id=? AND course_id=? AND problem_set_id=? AND session_revoked_at IS NULL AND datetime(session_expires_at)>=datetime(?))",params![scope.key_hash,scope.station_ip,key.user_id,key.course_id,key.problem_set_id,db_time(Utc::now())],|r|r.get::<_,bool>(0))?;
        if !allowed {
            return Err(AppError::Forbidden(
                "quiz session does not authorize this assignment".into(),
            ));
        }
        return Ok(());
    }
    let blocked=conn.query_row("SELECT EXISTS(SELECT 1 FROM quiz_assignments WHERE user_id=? AND course_id=? AND problem_set_id=?) AND NOT EXISTS(SELECT 1 FROM user_courses WHERE user_id=? AND course_id=? AND is_instructor)",params![key.user_id,key.course_id,key.problem_set_id,actor.user_id,key.course_id],|r|r.get::<_,bool>(0))?;
    if blocked {
        return Err(AppError::Forbidden("this assignment requires attended quiz entry".into()));
    }
    Ok(())
}

pub fn load_scope(conn: &Connection, hash: &str, ip: Option<&str>) -> AppResult<Option<QuizScope>> {
    let station = conn
        .query_row("SELECT station_ip FROM quiz_sessions WHERE session_key_hash=?", [hash], |r| {
            r.get::<_, String>(0)
        })
        .optional()?;
    match station {
        Some(station) if Some(station.as_str()) == ip => {
            Ok(Some(QuizScope { key_hash: hash.into(), station_ip: station }))
        }
        Some(_) => {
            Err(AppError::Forbidden("quiz session is bound to its testing-center station".into()))
        }
        None => Ok(None),
    }
}

pub async fn launch(
    state: LtiState,
    peer: SocketAddr,
    headers: HeaderMap,
    body: Bytes,
    set: String,
    uri: axum::http::Uri,
) -> Response {
    response(
        async {
            log_headers(&state.config, "lti_launch", peer, &headers)?;
            let ip = station(&state, peer, &headers)?;
            let f = form(&body);
            let query = form(uri.query().unwrap_or_default().as_bytes());
            let assignment_tag = link_tag(&query)?;
            let c = Context { course: form_first(&f, "context_id"), problem_set: set.clone() };
            if c.course.is_empty() {
                return Err(AppError::BadRequest("missing Canvas course identity".into()));
            }
            validate_launch_signature(
                &state.config.lti_secret,
                &format!("https://{}{}", state.config.hostname, uri.path()),
                &f,
                &query,
            )?;
            let body = state
                .db
                .transaction(true, move |conn| {
                    crate::lti::update_launch(conn, &f, &set, true, Utc::now())?;
                    let key = AssignmentKey {
                        user_id: form_first(&f, "user_id"),
                        course_id: c.course,
                        problem_set_id: set,
                    };
                    prepare(conn, &key, &assignment_tag, &ip)
                })
                .await?;
            Ok(preparation_page(&body))
        }
        .await,
    )
}

// Canvas's default LTI signer copies URL parameters into the body and signs each
// copied value once. Standards-compliant signers include both occurrences.
fn validate_launch_signature(
    secret: &str,
    url: &str,
    body: &BTreeMap<String, Vec<String>>,
    query: &BTreeMap<String, Vec<String>>,
) -> AppResult<()> {
    let mut standard = body.clone();
    let mut canvas = body.clone();
    let mut copied = false;
    for (name, values) in query {
        if name.starts_with("oauth_") {
            return Err(AppError::BadRequest("OAuth fields must be in the launch body".into()));
        }
        if let Some(posted) = body.get(name) {
            if posted != values {
                return Err(AppError::BadRequest(
                    "conflicting launch query and body values".into(),
                ));
            }
            copied = true;
        } else {
            canvas.insert(name.clone(), values.clone());
        }
        standard.entry(name.clone()).or_default().extend(values.clone());
    }
    match validate_oauth_signature("POST", url, &standard, secret) {
        Ok(()) => Ok(()),
        Err(_) if copied => validate_oauth_signature("POST", url, &canvas, secret),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{IpFilterConfig, ServerConfig};
    use crate::sessions::load_session_user_id;
    use crate::store;
    use std::path::PathBuf;

    fn config() -> ServerConfig {
        ServerConfig {
            hostname: "ta.example".into(),
            daycare_secret: "daycare".into(),
            lti_secret: "lti".into(),
            session_secret: "server-only".into(),
            capacity: 1,
            problem_types: vec![],
            tool_name: "CodeGrinder".into(),
            tool_id: "codegrinder".into(),
            tool_description: "Exercises".into(),
            container_engine: "docker".into(),
            sqlite3_path: PathBuf::new(),
            sessions_expire: vec![],
            ip_filter: IpFilterConfig::default(),
        }
    }
    fn fixture() -> (Connection, AssignmentKey, Context, BTreeMap<String, Vec<String>>) {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(include_str!("../setup/schema.sql")).unwrap();
        conn.execute("INSERT INTO problem_sets(problem_set_id,problem_set_note,problem_set_tags,problem_set_created_at,problem_set_updated_at) VALUES ('set','Quiz','[]','2026-01-01','2026-01-01')",[]).unwrap();
        let form = BTreeMap::from_iter(
            [
                ("context_id", "course"),
                ("context_title", "Course"),
                ("context_label", "CS"),
                ("user_id", "student"),
                ("lis_person_name_full", "Student"),
                ("custom_canvas_user_login_id", "student"),
                ("roles", "Learner"),
                ("resource_link_title", "Quiz"),
                ("lis_result_sourcedid", "grade"),
                ("lis_outcome_service_url", "https://canvas.example/outcomes"),
                ("ext_outcome_data_values_accepted", "text"),
                ("oauth_consumer_key", "consumer"),
            ]
            .map(|(k, v)| (k.to_string(), vec![v.to_string()])),
        );
        crate::lti::update_launch(&conn, &form, "set", true, Utc::now()).unwrap();
        let key = AssignmentKey {
            user_id: "student".into(),
            course_id: "course".into(),
            problem_set_id: "set".into(),
        };
        let c = Context { course: "course".into(), problem_set: "set".into() };
        let f = entry(&conn, &key, &c);
        (conn, key, c, f)
    }
    fn entry(conn: &Connection, key: &AssignmentKey, c: &Context) -> BTreeMap<String, Vec<String>> {
        prepare(
            conn,
            key,
            &tag(&config().session_secret, "assignment", c, "secret password").unwrap(),
            "192.0.2.10",
        )
        .unwrap();
        let code: String =
            conn.query_row("SELECT quiz_code FROM quiz_entries", [], |r| r.get(0)).unwrap();
        BTreeMap::from([
            ("code".into(), vec![code]),
            ("password".into(), vec!["secret password".into()]),
            (
                "tag".into(),
                vec![tag(&config().session_secret, "connector", c, "secret password").unwrap()],
            ),
        ])
    }
    #[test]
    fn ordinary_sessions_cannot_read_or_save_quiz_workspaces_even_from_allowed_ips() {
        let (conn, key, _, _) = fixture();
        let actor = store::load_user_by_id(&conn, "student").unwrap();
        assert!(matches!(
            store::get_assignment(&conn, &actor, &key, true),
            Err(AppError::Forbidden(_))
        ));
        assert!(store::list_assignments(&conn, &actor, &[], false, true).unwrap().is_empty());
        let commit = crate::proto::Commit {
            assignment: Some(key),
            problem_id: "problem".into(),
            step: 1,
            ..Default::default()
        };
        assert!(matches!(
            crate::mutations::save_workspace_commit(&conn, &actor, &commit, true),
            Err(AppError::Forbidden(_))
        ));
        let grading = crate::proto::GradingCommit {
            user_id: "student".into(),
            commit: Some(commit),
            ..Default::default()
        };
        assert!(matches!(
            crate::mutations::save_ungraded_commit(&conn, &actor, &grading, true, |_| Ok(
                "ta.example".into()
            )),
            Err(AppError::Forbidden(_))
        ));
    }
    #[test]
    fn oauth_supports_canvas_copies_and_standard_query_parameters_without_accepting_conflicts() {
        let url = "https://ta.example/lti/problem_sets/quiz/set";
        let query: BTreeMap<String, Vec<String>> =
            BTreeMap::from([("tag".into(), vec!["signed-value".into()])]);
        let original = BTreeMap::from([
            ("context_id".into(), vec!["course".into()]),
            ("oauth_nonce".into(), vec!["nonce".into()]),
        ]);
        for copied in [false, true] {
            let mut body = original.clone();
            if copied {
                body.extend(query.clone());
            }
            let mut standard = body.clone();
            for (name, values) in &query {
                standard.entry(name.clone()).or_default().extend(values.clone());
            }
            let signature =
                crate::passback::compute_oauth_signature("POST", url, &standard, "secret").unwrap();
            body.insert("oauth_signature".into(), vec![signature]);
            validate_launch_signature("secret", url, &body, &query).unwrap();
        }
        let mut canvas = original;
        canvas.extend(query.clone());
        let signature =
            crate::passback::compute_oauth_signature("POST", url, &canvas, "secret").unwrap();
        canvas.insert("oauth_signature".into(), vec![signature]);
        validate_launch_signature("secret", url, &canvas, &query).unwrap();
        let altered = BTreeMap::from([("tag".into(), vec!["tampered".into()])]);
        assert!(validate_launch_signature("secret", url, &canvas, &altered).is_err());
        assert!(validate_launch_signature("wrong", url, &canvas, &query).is_err());
        assert!(
            validate_launch_signature("secret", "https://ta.example/other", &canvas, &query)
                .is_err()
        );
    }
    #[test]
    fn tags_are_url_safe_and_reject_padding_and_duplicate_parameters() {
        let (_, _, c, _) = fixture();
        let value = tag(&config().session_secret, "assignment", &c, "password").unwrap();
        assert_eq!(value.len(), 43);
        assert!(value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_eq!(escape(&value), value);
        assert!(link_tag(&BTreeMap::from([("tag".into(), vec![value.clone()])])).is_ok());
        assert!(
            link_tag(&BTreeMap::from([("tag".into(), vec![value.clone(), value.clone()])]))
                .is_err()
        );
        assert!(link_tag(&BTreeMap::from([("tag".into(), vec![format!("{value}=")])])).is_err());
    }
    #[test]
    fn tags_bind_password_purpose_course_and_set() {
        let (_, _, c, _) = fixture();
        let secret = &config().session_secret;
        let signed = tag(secret, "assignment", &c, "password").unwrap();
        assert!(verify(secret, "assignment", &c, "password", &signed));
        assert!(!verify(secret, "connector", &c, "password", &signed));
        assert!(!verify(secret, "assignment", &c, "wrong", &signed));
        assert!(!verify("other server", "assignment", &c, "password", &signed));
        for altered in [
            Context { course: "other".into(), ..c.clone() },
            Context { problem_set: "other".into(), ..c.clone() },
        ] {
            assert!(!verify(secret, "assignment", &altered, "password", &signed));
        }
    }
    #[test]
    fn redemption_is_single_use_scoped_and_replacement_revokes_old_session() {
        let (conn, key, c, f) = fixture();
        let config = config();
        let ordinary = store::load_user_by_id(&conn, "student").unwrap();
        assert!(require_access(&conn, &ordinary, &key).is_err());
        let (_, session, _) = redeem_entry(&conn, &config, "192.0.2.10", &f).unwrap().unwrap();
        assert!(redeem_entry(&conn, &config, "192.0.2.10", &f).unwrap().is_none());
        assert!(load_session_user_id(&conn, &session, &config.session_secret, Utc::now()).is_ok());
        let hash = session_key_hash(&session, &config.session_secret).unwrap();
        assert!(load_scope(&conn, &hash, Some("192.0.2.11")).is_err());
        let mut actor = ordinary.clone();
        actor.quiz_scope = load_scope(&conn, &hash, Some("192.0.2.10")).unwrap();
        require_access(&conn, &actor, &key).unwrap();
        let other = AssignmentKey { problem_set_id: "other".into(), ..key.clone() };
        assert!(require_access(&conn, &actor, &other).is_err());
        let f = entry(&conn, &key, &c);
        require_access(&conn, &actor, &key).unwrap();
        redeem_entry(&conn, &config, "192.0.2.10", &f).unwrap().unwrap();
        assert!(load_session_user_id(&conn, &session, &config.session_secret, Utc::now()).is_err());
        assert!(require_access(&conn, &actor, &key).is_err());
    }
    #[test]
    fn rejects_wrong_ip_code_password_connector_context_expiry_and_exhausted_attempts() {
        let (conn, _, c, f) = fixture();
        let config = config();
        assert!(redeem_entry(&conn, &config, "192.0.2.11", &f).unwrap().is_none());
        for name in ["code", "password", "tag"] {
            let mut wrong = f.clone();
            wrong.insert(name.into(), vec!["wrong".into()]);
            assert!(redeem_entry(&conn, &config, "192.0.2.10", &wrong).unwrap().is_none());
        }
        let other = Context { course: "different".into(), ..c.clone() };
        let mut wrong = f.clone();
        wrong.insert(
            "tag".into(),
            vec![tag(&config.session_secret, "connector", &other, "secret password").unwrap()],
        );
        assert!(redeem_entry(&conn, &config, "192.0.2.10", &wrong).unwrap().is_none());
        conn.execute("UPDATE quiz_entries SET entry_expires_at='2000-01-01'", []).unwrap();
        assert!(redeem_entry(&conn, &config, "192.0.2.10", &f).unwrap().is_none());
        conn.execute("UPDATE quiz_entries SET entry_expires_at='2999-01-01',entry_attempts=5", [])
            .unwrap();
        assert!(redeem_entry(&conn, &config, "192.0.2.10", &f).unwrap().is_none());
    }
    #[test]
    fn reopening_preparation_does_not_reset_station_attempt_budget() {
        let (conn, key, c, mut f) = fixture();
        f.insert("password".into(), vec!["wrong".into()]);
        for _ in 0..20 {
            entry(&conn, &key, &c);
            assert!(redeem_entry(&conn, &config(), "192.0.2.10", &f).unwrap().is_none());
        }
        let valid = entry(&conn, &key, &c);
        assert!(redeem_entry(&conn, &config(), "192.0.2.10", &valid).unwrap().is_none());
    }
    #[test]
    fn removing_quiz_gate_never_promotes_a_quiz_session_to_ordinary() {
        let (conn, key, _, f) = fixture();
        let cfg = config();
        let (_, session, _) = redeem_entry(&conn, &cfg, "192.0.2.10", &f).unwrap().unwrap();
        conn.execute("DELETE FROM quiz_assignments", []).unwrap();
        let hash = session_key_hash(&session, &cfg.session_secret).unwrap();
        let mut actor = store::load_user_by_id(&conn, "student").unwrap();
        actor.quiz_scope = load_scope(&conn, &hash, Some("192.0.2.10")).unwrap();
        assert!(actor.quiz_scope.is_some());
        assert!(require_access(&conn, &actor, &key).is_err());
    }
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use crate::config::{IpFilterConfig, ServerConfig};
    use crate::db::Db;
    use crate::ipfilter::IpFilter;
    use crate::lti::VersionPayload;
    use crate::sessions::LoginTokens;
    use crate::signatures::encode_params;
    use std::sync::Arc;

    async fn state() -> (tempfile::TempDir, LtiState) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("quiz.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(include_str!("../setup/schema.sql")).unwrap();
        conn.execute("INSERT INTO problem_sets(problem_set_id,problem_set_note,problem_set_tags,problem_set_created_at,problem_set_updated_at) VALUES ('set','Quiz','[]','2026-01-01','2026-01-01')",[]).unwrap();
        let config = ServerConfig {
            hostname: "ta.example".into(),
            daycare_secret: "daycare".into(),
            lti_secret: "lti".into(),
            session_secret: "server-only".into(),
            capacity: 1,
            problem_types: vec![],
            tool_name: "CodeGrinder".into(),
            tool_id: "codegrinder".into(),
            tool_description: "Exercises".into(),
            container_engine: "docker".into(),
            sqlite3_path: path.clone(),
            sessions_expire: vec![],
            ip_filter: IpFilterConfig { whitelist: vec!["192.0.2.0/24".into()] },
        };
        let state = LtiState {
            db: Db::open(&path).unwrap(),
            ip_filter: IpFilter::from_entries(&config.ip_filter.whitelist).unwrap(),
            config: Arc::new(config),
            login_tokens: Arc::new(LoginTokens::default()),
            version: VersionPayload {
                version: "3.1.0".into(),
                grind_version_required: "3.1.0".into(),
                grind_version_recommended: "3.1.0".into(),
            },
        };
        (directory, state)
    }
    async fn text(response: Response) -> String {
        String::from_utf8(
            axum::body::to_bytes(response.into_body(), 1_000_000).await.unwrap().to_vec(),
        )
        .unwrap()
    }
    #[tokio::test]
    async fn picker_authenticates_instructor_and_returns_two_links_without_password() {
        let (_directory, state) = state().await;
        let mut f = BTreeMap::from_iter(
            [
                ("context_id", "course"),
                ("roles", "Instructor"),
                ("content_item_return_url", "https://canvas.example/return"),
                ("oauth_consumer_key", "consumer"),
            ]
            .map(|(k, v)| (k.into(), vec![v.into()])),
        );
        let signature = crate::passback::compute_oauth_signature(
            "POST",
            "https://ta.example/lti/picker",
            &f,
            &state.config.lti_secret,
        )
        .unwrap();
        f.insert("oauth_signature".into(), vec![signature]);
        let r = picker_launch(State(state.clone()), Bytes::from(encode_params(&f))).await;
        assert_eq!(r.status(), 200);
        assert!(text(r).await.contains("Choose a problem set"));
        f.insert("roles".into(), vec!["Learner".into()]);
        f.remove("oauth_signature");
        let signature = crate::passback::compute_oauth_signature(
            "POST",
            "https://ta.example/lti/picker",
            &f,
            &state.config.lti_secret,
        )
        .unwrap();
        f.insert("oauth_signature".into(), vec![signature]);
        assert_eq!(
            picker_launch(State(state.clone()), Bytes::from(encode_params(&f))).await.status(),
            403
        );
        let picker = PickerState {
            course: "course".into(),
            return_url: "https://canvas.example/return?context=1".into(),
            consumer_key: "consumer".into(),
            data: "opaque-canvas-data".into(),
            expires: Utc::now().timestamp() + 600,
        };
        let ticket = STANDARD.encode(serde_json::to_vec(&picker).unwrap());
        let signature = hmac_sha256_base64(
            &state.config.session_secret,
            format!("quiz-picker:v1:{ticket}").as_bytes(),
        )
        .unwrap();
        let mut f = BTreeMap::from([
            ("ticket".into(), vec![ticket]),
            ("signature".into(), vec![signature]),
            ("problem_set".into(), vec!["set".into()]),
            ("mode".into(), vec!["quiz".into()]),
            ("password".into(), vec!["never-store-this-password".into()]),
        ]);
        let r = configure(State(state.clone()), Bytes::from(encode_params(&f))).await;
        assert_eq!(r.status(), 200);
        let html = text(r).await;
        assert!(html.contains("/quiz/set?tag="));
        assert!(html.contains("/quiz/connect?tag="));
        assert!(!html.contains("configuration="));
        assert!(!html.contains("problem_set="));
        assert!(html.contains("opaque-canvas-data"));
        assert!(!html.contains("never-store-this-password"));
        f.insert("signature".into(), vec!["forged".into()]);
        assert_eq!(
            configure(State(state.clone()), Bytes::from(encode_params(&f))).await.status(),
            403
        );
        let tables: Vec<String> = state
            .db
            .transaction(false, |conn| {
                let mut s = conn.prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'quiz_%'",
                )?;
                Ok(s.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?)
            })
            .await
            .unwrap();
        assert_eq!(tables.len(), 4);
    }
    #[tokio::test]
    async fn signed_quiz_launch_creates_assignment_without_ordinary_login_and_records_headers() {
        let (_directory, state) = state().await;
        let c = Context { course: "course".into(), problem_set: "set".into() };
        let query = BTreeMap::from([(
            "tag".into(),
            vec![tag(&state.config.session_secret, "assignment", &c, "password").unwrap()],
        )]);
        let mut f = BTreeMap::from_iter(
            [
                ("context_id", "course"),
                ("context_title", "Course"),
                ("context_label", "CS"),
                ("user_id", "student"),
                ("lis_person_name_full", "Student"),
                ("custom_canvas_user_login_id", "student"),
                ("roles", "Learner"),
                ("resource_link_title", "Quiz"),
                ("lis_result_sourcedid", "grade"),
                ("lis_outcome_service_url", "https://canvas.example/outcomes"),
                ("ext_outcome_data_values_accepted", "text"),
                ("oauth_consumer_key", "consumer"),
            ]
            .map(|(k, v)| (k.into(), vec![v.into()])),
        );
        let mut signed = f.clone();
        signed.extend(query.clone());
        let signature = crate::passback::compute_oauth_signature(
            "POST",
            "https://ta.example/lti/problem_sets/quiz/set",
            &signed,
            &state.config.lti_secret,
        )
        .unwrap();
        f.insert("oauth_signature".into(), vec![signature]);
        // Canvas copies URL fields into the POST body but signs each value once.
        f.extend(query.clone());
        let uri: axum::http::Uri = format!(
            "/lti/problem_sets/quiz/set?{}",
            String::from_utf8(encode_params(&query)).unwrap()
        )
        .parse()
        .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "192.0.2.10".parse().unwrap());
        headers.append("x-probe", "first".parse().unwrap());
        headers.append("x-probe", "second".parse().unwrap());
        let peer = "127.0.0.1:1400".parse().unwrap();
        let r = launch(
            state.clone(),
            peer,
            headers.clone(),
            Bytes::from(encode_params(&f)),
            "set".into(),
            uri.clone(),
        )
        .await;
        assert_eq!(r.status(), 200);
        let html = text(r).await;
        assert!(html.contains("Student"));
        assert!(html.contains("Course"));
        assert!(html.contains("write down"));
        assert!(!html.contains("token="));
        let sessions: i64 = state
            .db
            .transaction(false, |conn| {
                Ok(conn.query_row("SELECT count(*) FROM user_sessions", [], |r| r.get(0))?)
            })
            .await
            .unwrap();
        assert_eq!(sessions, 0);
        let log =
            std::fs::read_to_string(state.config.sqlite3_path.with_file_name("quiz-headers.jsonl"))
                .unwrap();
        let record: serde_json::Value = serde_json::from_str(log.trim()).unwrap();
        let probes: Vec<_> = record["headers_base64"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|v| v[0] == "x-probe")
            .collect();
        assert_eq!(probes.len(), 2);
        // Concurrent HTTP redemptions contend for the same database write transaction.
        let code: String = state
            .db
            .transaction(false, |conn| {
                Ok(conn.query_row("SELECT quiz_code FROM quiz_entries", [], |r| r.get(0))?)
            })
            .await
            .unwrap();
        let mut redemption = query.clone();
        redemption.insert(
            "tag".into(),
            vec![tag(&state.config.session_secret, "connector", &c, "password").unwrap()],
        );
        redemption.insert("code".into(), vec![code]);
        redemption.insert("password".into(), vec!["password".into()]);
        let (first, second) = tokio::join!(
            redeem(
                State(state.clone()),
                ConnectInfo(peer),
                headers.clone(),
                Bytes::from(encode_params(&redemption))
            ),
            redeem(
                State(state.clone()),
                ConnectInfo(peer),
                headers.clone(),
                Bytes::from(encode_params(&redemption))
            )
        );
        let mut statuses = vec![first.status().as_u16(), second.status().as_u16()];
        statuses.sort();
        assert_eq!(statuses, vec![303, 403]);
        let success = if first.status().as_u16() == 303 { first } else { second };
        let location = success.headers()[header::LOCATION].to_str().unwrap();
        assert!(location.starts_with("/vm/?assignment=student%3Acourse%3Aset#quiz="));
        assert!(!location.split('#').next().unwrap().contains("session"));
        headers.insert("x-real-ip", "198.51.100.10".parse().unwrap());
        assert_eq!(
            launch(state, peer, headers, Bytes::from(encode_params(&f)), "set".into(), uri)
                .await
                .status(),
            403
        );
    }
}
