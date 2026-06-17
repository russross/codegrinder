use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use chrono::Utc;
use sha2::Digest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{Mutex, Semaphore, mpsc};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Response, Status};

use crate::config::ServerConfig;
use crate::error::{AppError, AppResult};
use crate::files::checked_relative_path;
use crate::proto::{
    DaycareRequest, DaycareResponse, EventMessage, ReportCard, ReportCardResult, RuntimeBundle,
    RuntimeLimits, SignedRuntimeBundle, daycare_response,
};
use crate::signatures::{decode_signed_runtime_bundle, encode_signed_runtime_bundle};
use crate::timeutil::{timestamp, timestamp_to_utc};

const COMMAND_OUTPUT_LIMIT: usize = 1_000_000;
const COMMAND_OUTPUT_TRUNCATED: &[u8] = b"\n[... output truncated ...]\n";
const TRANSCRIPT_EVENT_COUNT_LIMIT: usize = 500;
const TRANSCRIPT_DATA_LIMIT: usize = 100_000;
const WORKSPACE_FILE_READ_LIMIT: usize = 100_000_000;
const SIGNED_REQUEST_MAX_AGE: chrono::Duration = chrono::Duration::minutes(15);
const DAYCARE_CONTAINER_LABEL: &str = "codegrinder.daycare=1";
const STUDENT_UID: u64 = 1001;
const STUDENT_GID: u64 = 1001;

#[derive(Clone)]
pub struct DaycareRuntime {
    config: Arc<ServerConfig>,
    container_command: Arc<Vec<String>>,
    container_slots: Arc<Semaphore>,
    active_runs: Arc<Mutex<BTreeMap<String, u64>>>,
    next_run_id: Arc<AtomicU64>,
}

impl DaycareRuntime {
    pub fn new(config: Arc<ServerConfig>) -> AppResult<Self> {
        let command = if config.container_engine.trim().is_empty() {
            vec!["docker".to_owned()]
        } else {
            config
                .container_engine
                .split_whitespace()
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        };
        Ok(Self {
            container_slots: Arc::new(Semaphore::new(config.capacity)),
            config,
            container_command: Arc::new(command),
            active_runs: Arc::new(Mutex::new(BTreeMap::new())),
            next_run_id: Arc::new(AtomicU64::new(1)),
        })
    }

    pub async fn run(&self, request: DaycareRequest) -> Result<Response<DaycareStream>, Status> {
        let (tx, rx) = mpsc::channel(64);
        let runtime = self.clone();
        tokio::spawn(async move {
            let result = runtime.handle(request, tx.clone()).await;
            if let Err(err) = result {
                let _ = tx
                    .send(Ok(DaycareResponse {
                        response: Some(daycare_response::Response::Error(err.to_string())),
                    }))
                    .await;
            }
        });
        Ok(Response::new(
            Box::pin(ReceiverStream::new(rx)) as DaycareStream
        ))
    }

    async fn handle(
        &self,
        request: DaycareRequest,
        tx: mpsc::Sender<Result<DaycareResponse, Status>>,
    ) -> AppResult<()> {
        let signed = request
            .bundle
            .ok_or_else(|| AppError::BadRequest("bundle is required".to_owned()))?;
        let mut bundle = validate_and_decode_action(
            &signed,
            &self.config.daycare_secret,
            &self.config.hostname,
        )?;
        let limits = effective_limits(&bundle)?;
        let nanny_name = format!("nanny-{}", safe_user_dir_name(&bundle.user_id));
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed);
        self.mark_active(&nanny_name, run_id).await;
        preempt_container(&self.container_command, &nanny_name).await;
        let _slot = self
            .container_slots
            .acquire()
            .await
            .map_err(|_| AppError::Internal("container limiter closed".to_owned()))?;
        self.require_active(&nanny_name, run_id).await?;
        let deadline = Instant::now() + action_timeout(&limits);
        let container = match Container::create(
            &self.container_command,
            &self.active_runs,
            run_id,
            &nanny_name,
            &bundle,
            &limits,
            deadline,
        )
        .await
        {
            Ok(container) => container,
            Err(err) => return self.finish_run(&nanny_name, run_id, Err(err)).await,
        };
        if let Err(err) = self.require_active(&nanny_name, run_id).await {
            let _ = container.shutdown().await;
            return Err(err);
        }
        let result = run_action(
            &container,
            &mut bundle,
            &self.config.daycare_secret,
            deadline,
            tx,
        )
        .await;
        let shutdown = container.shutdown().await;
        self.clear_active(&nanny_name, run_id).await;
        result?;
        shutdown?;
        Ok(())
    }

    async fn mark_active(&self, name: &str, run_id: u64) {
        let mut active = self.active_runs.lock().await;
        active.insert(name.to_owned(), run_id);
    }

    async fn require_active(&self, name: &str, run_id: u64) -> AppResult<()> {
        let active = self.active_runs.lock().await;
        if active.get(name) == Some(&run_id) {
            Ok(())
        } else {
            Err(AppError::BadRequest(
                "daycare request was superseded by a newer request".to_owned(),
            ))
        }
    }

    async fn clear_active(&self, name: &str, run_id: u64) {
        let mut active = self.active_runs.lock().await;
        if active.get(name) == Some(&run_id) {
            active.remove(name);
        }
    }

    async fn finish_run<T>(&self, name: &str, run_id: u64, result: AppResult<T>) -> AppResult<T> {
        self.clear_active(name, run_id).await;
        result
    }
}

pub type DaycareStream = std::pin::Pin<
    Box<dyn tokio_stream::Stream<Item = Result<DaycareResponse, Status>> + Send + 'static>,
>;

fn validate_and_decode_action(
    envelope: &SignedRuntimeBundle,
    secret: &str,
    hostname: &str,
) -> AppResult<RuntimeBundle> {
    let bundle = decode_signed_runtime_bundle(envelope, secret)?;
    if bundle.hostname.is_empty()
        || bundle.user_id.is_empty()
        || bundle.problem_id.is_empty()
        || bundle.action.is_empty()
        || bundle.container.trim().is_empty()
        || bundle.command.trim().is_empty()
    {
        return Err(AppError::BadRequest(
            "runtime bundle is missing required identity fields".to_owned(),
        ));
    }
    if bundle.hostname != hostname {
        return Err(AppError::BadRequest(format!(
            "runtime bundle is signed for host {}, this is {hostname}",
            bundle.hostname
        )));
    }
    let commit = bundle
        .commit
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("runtime bundle must include the commit".to_owned()))?;
    if commit.action != bundle.action {
        return Err(AppError::BadRequest(
            "commit action does not match runtime bundle action".to_owned(),
        ));
    }
    let updated = commit
        .updated_at
        .as_ref()
        .map(timestamp_to_utc)
        .transpose()?
        .ok_or_else(|| AppError::BadRequest("commit updated_at is required".to_owned()))?;
    if (Utc::now() - updated).abs() > SIGNED_REQUEST_MAX_AGE {
        return Err(AppError::BadRequest(
            "runtime bundle signature is too old".to_owned(),
        ));
    }
    Ok(bundle)
}

fn effective_limits(bundle: &RuntimeBundle) -> AppResult<RuntimeLimits> {
    let mut limits = bundle
        .limits
        .ok_or_else(|| AppError::BadRequest("runtime limits are required".to_owned()))?;
    for option in &bundle.problem_options {
        let Some((key, raw_value)) = option.split_once('=') else {
            continue;
        };
        if !matches!(
            key,
            "maxCPU" | "maxFD" | "maxFileSize" | "maxMemory" | "maxThreads"
        ) {
            continue;
        }
        let value = raw_value.parse::<i64>().map_err(|_| {
            AppError::BadRequest(format!("invalid runtime limit option {option:?}"))
        })?;
        match key {
            "maxCPU" => limits.max_cpu = value,
            "maxFD" => limits.max_fd = value,
            "maxFileSize" => limits.max_file_size = value,
            "maxMemory" => limits.max_memory = value,
            "maxThreads" => limits.max_threads = value,
            _ => {}
        }
    }
    validate_runtime_limits(&limits)?;
    Ok(limits)
}

fn validate_runtime_limits(limits: &RuntimeLimits) -> AppResult<()> {
    if limits.max_cpu <= 0
        || limits.max_fd <= 0
        || limits.max_file_size <= 0
        || limits.max_memory <= 0
        || limits.max_threads <= 0
    {
        return Err(AppError::BadRequest(
            "runtime limits must be positive".to_owned(),
        ));
    }
    Ok(())
}

fn action_timeout(limits: &RuntimeLimits) -> Duration {
    let cpu = limits.max_cpu.max(1);
    Duration::from_secs((cpu * 2 + 5) as u64)
}

async fn run_action(
    container: &Container,
    bundle: &mut RuntimeBundle,
    secret: &str,
    deadline: Instant,
    tx: mpsc::Sender<Result<DaycareResponse, Status>>,
) -> AppResult<()> {
    container.put_files(&bundle.files, 0o666, deadline).await?;
    let mut transcript = TranscriptCapture::default();
    let command = bundle
        .command
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut report = ReportCard {
        passed: true,
        note: String::new(),
        duration: None,
        results: Vec::new(),
    };
    emit_event(
        &tx,
        &mut transcript,
        event(
            "exec",
            command.clone(),
            0,
            Vec::new(),
            String::new(),
            BTreeMap::new(),
        ),
    )
    .await?;
    let result = match container.exec(&command, deadline).await {
        Ok(result) => result,
        Err(err) => {
            fail_report_for_exec_error(&mut report, bundle, &command, err);
            finalize_action(bundle, secret, tx, transcript, report).await?;
            return Ok(());
        }
    };
    if !result.stdout.is_empty() {
        emit_event(
            &tx,
            &mut transcript,
            event(
                "stdout",
                Vec::new(),
                0,
                result.stdout.clone(),
                String::new(),
                BTreeMap::new(),
            ),
        )
        .await?;
    }
    if !result.stderr.is_empty() {
        emit_event(
            &tx,
            &mut transcript,
            event(
                "stderr",
                Vec::new(),
                0,
                result.stderr.clone(),
                String::new(),
                BTreeMap::new(),
            ),
        )
        .await?;
    }
    emit_event(
        &tx,
        &mut transcript,
        event(
            "exit",
            Vec::new(),
            result.status,
            Vec::new(),
            String::new(),
            BTreeMap::new(),
        ),
    )
    .await?;
    if bundle.parser == "xunit" {
        if result.status > 127 {
            fail_report(
                &mut report,
                format!(
                    "Crashed with exit status {} while running unit tests",
                    result.status
                ),
            );
        } else {
            parse_xunit(
                &mut report,
                &container
                    .read_regular_file("test_detail.xml", deadline)
                    .await
                    .unwrap_or_default(),
            );
            if result.status != 0 {
                report.passed = false;
            }
        }
    } else if bundle.parser == "check" {
        if result.status > 127 {
            fail_report(
                &mut report,
                format!(
                    "Crashed with exit status {} while running unit tests",
                    result.status
                ),
            );
        } else {
            parse_check(
                &mut report,
                &container
                    .read_regular_file("test_detail.xml", deadline)
                    .await
                    .unwrap_or_default(),
            );
            if result.status != 0 {
                report.passed = false;
            }
        }
    } else if !bundle.parser.is_empty() {
        fail_report(
            &mut report,
            format!(
                "unknown parser {:?} for action {}",
                bundle.parser, bundle.action
            ),
        );
    } else if result.status != 0 {
        fail_report(
            &mut report,
            format!(
                "\"{}\" failed with exit status {}",
                command.join(" "),
                result.status
            ),
        );
    }
    for option in &bundle.problem_options {
        if let Some(paths) = option.strip_prefix("download=") {
            match container.download_files(paths, deadline).await {
                Ok(files) if !files.is_empty() => {
                    emit_event(
                        &tx,
                        &mut transcript,
                        event("files", Vec::new(), 0, Vec::new(), String::new(), files),
                    )
                    .await?;
                }
                Ok(_) => {}
                Err(err) => eprintln!("error trying to download files from container: {err}"),
            }
        }
    }
    finalize_action(bundle, secret, tx, transcript, report).await
}

async fn finalize_action(
    bundle: &mut RuntimeBundle,
    secret: &str,
    tx: mpsc::Sender<Result<DaycareResponse, Status>>,
    transcript: TranscriptCapture,
    report: ReportCard,
) -> AppResult<()> {
    if let Some(commit) = &mut bundle.commit {
        commit.transcript = transcript.events;
        commit.report_card = Some(report.clone());
        commit.score = if report.passed {
            1.0
        } else {
            score_from_report(&report)
        };
        commit.updated_at = Some(timestamp(Utc::now()));
    }
    if bundle.action == "grade" {
        let signed = encode_signed_runtime_bundle(bundle, secret)?;
        tx.send(Ok(DaycareResponse {
            response: Some(daycare_response::Response::Bundle(signed)),
        }))
        .await
        .map_err(|_| AppError::Internal("daycare stream closed".to_owned()))?;
    }
    Ok(())
}

fn fail_report_for_exec_error(
    report: &mut ReportCard,
    bundle: &RuntimeBundle,
    command: &[String],
    err: AppError,
) {
    let joined = command.join(" ");
    if bundle.parser == "xunit" || bundle.parser == "check" {
        fail_report(report, format!("Error running unit tests: {err}"));
    } else {
        fail_report(report, format!("\"{joined}\" exec error: {err}"));
    }
}

#[derive(Default)]
struct TranscriptCapture {
    events: Vec<EventMessage>,
    stream_bytes: usize,
}

impl TranscriptCapture {
    fn record(&mut self, event: &EventMessage) {
        if !event.stream_data.is_empty() {
            if self.stream_bytes > TRANSCRIPT_DATA_LIMIT {
                return;
            }
            self.stream_bytes += event.stream_data.len();
        }
        let stream_event = matches!(event.event.as_str(), "stdin" | "stdout" | "stderr");
        if stream_event
            && let Some(last) = self.events.last_mut()
            && last.event == event.event
        {
            last.stream_data.extend_from_slice(&event.stream_data);
            last.time = event.time;
            return;
        }
        if self.events.len() < TRANSCRIPT_EVENT_COUNT_LIMIT {
            self.events.push(event.clone());
        }
    }
}

async fn emit_event(
    tx: &mpsc::Sender<Result<DaycareResponse, Status>>,
    transcript: &mut TranscriptCapture,
    event: EventMessage,
) -> AppResult<()> {
    transcript.record(&event);
    tx.send(Ok(DaycareResponse {
        response: Some(daycare_response::Response::Event(event)),
    }))
    .await
    .map_err(|_| AppError::Internal("daycare stream closed".to_owned()))
}

fn event(
    name: &str,
    exec_command: Vec<String>,
    exit_status: i32,
    stream_data: Vec<u8>,
    error: String,
    files: BTreeMap<String, Vec<u8>>,
) -> EventMessage {
    EventMessage {
        time: Some(timestamp(Utc::now())),
        event: name.to_owned(),
        exec_command,
        exit_status,
        stream_data,
        error,
        report_card: None,
        files,
    }
}

fn fail_report(report: &mut ReportCard, message: String) {
    report.passed = false;
    report.note = message;
}

fn score_from_report(report: &ReportCard) -> f64 {
    if report.results.is_empty() {
        return 0.0;
    }
    let passed = report
        .results
        .iter()
        .filter(|result| result.outcome == "passed")
        .count();
    passed as f64 / report.results.len() as f64
}

fn parse_xunit(report: &mut ReportCard, xml: &[u8]) {
    let Ok(text) = std::str::from_utf8(xml) else {
        fail_report(
            report,
            "error parsing unit test results: not UTF-8".to_owned(),
        );
        return;
    };
    let Ok(doc) = roxmltree::Document::parse(text) else {
        fail_report(report, "error parsing unit test results".to_owned());
        return;
    };
    let cases = doc
        .descendants()
        .filter(|node| node.tag_name().name() == "testcase")
        .collect::<Vec<_>>();
    if cases.is_empty() {
        fail_report(report, "No unit test results found".to_owned());
        return;
    }
    for case in cases {
        let class_name = case.attribute("classname").unwrap_or("");
        let case_name = case.attribute("name").unwrap_or("");
        let name = if class_name.is_empty() {
            case_name.to_owned()
        } else {
            format!("{class_name} {case_name}")
        };
        let failure = case.children().find(|child| {
            matches!(
                child.tag_name().name(),
                "failure" | "error" | "skipped" | "disabled"
            )
        });
        let failed = failure.is_some();
        let details = failure
            .and_then(|node| node.text())
            .unwrap_or("")
            .to_owned();
        let context = failure_context(&details);
        report.results.push(ReportCardResult {
            name,
            outcome: if failed { "failed" } else { "passed" }.to_owned(),
            details,
            context,
        });
    }
    let passed = report
        .results
        .iter()
        .filter(|result| result.outcome == "passed")
        .count();
    report.passed = passed == report.results.len();
    report.note = format!("Passed {passed}/{} tests", report.results.len());
}

fn parse_check(report: &mut ReportCard, xml: &[u8]) {
    let Ok(text) = std::str::from_utf8(xml) else {
        fail_report(
            report,
            "error parsing unit test results: not UTF-8".to_owned(),
        );
        return;
    };
    let Ok(doc) = roxmltree::Document::parse(text) else {
        fail_report(report, "error parsing unit test results".to_owned());
        return;
    };
    let cases = doc
        .descendants()
        .filter(|node| node.tag_name().name() == "test")
        .collect::<Vec<_>>();
    if cases.is_empty() {
        fail_report(report, "No unit test results found".to_owned());
        return;
    }
    for case in cases {
        let result = case.attribute("result").unwrap_or("");
        let name = child_text(case, "id").unwrap_or_default();
        let details = child_text(case, "message").unwrap_or_default();
        let function = child_text(case, "fn").unwrap_or_default();
        let outcome = if result == "success" {
            "passed"
        } else {
            "failed"
        };
        report.results.push(ReportCardResult {
            name,
            outcome: outcome.to_owned(),
            details,
            context: function,
        });
    }
    let passed = report
        .results
        .iter()
        .filter(|result| result.outcome == "passed")
        .count();
    report.passed = passed == report.results.len();
    report.note = format!("Passed {passed}/{} tests", report.results.len());
}

fn child_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    node.children()
        .find(|child| child.tag_name().name() == name)
        .and_then(|child| child.text())
        .map(ToOwned::to_owned)
}

fn failure_context(details: &str) -> String {
    if let Some(rest) = details.split("File \"").nth(1)
        && let Some((path, rest)) = rest.split_once('"')
        && let Some(line) = rest.split("line ").nth(1)
    {
        let line = line
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect::<String>();
        if !line.is_empty() {
            return format!("{}:{line}", path.rsplit('/').next().unwrap_or(path));
        }
    }
    if let Some(index) = details.find("tests/") {
        return details[index..]
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches(':')
            .to_owned();
    }
    String::new()
}

fn select_download_files(
    all_files: &BTreeMap<String, Vec<u8>>,
    raw_paths: &str,
) -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::new();
    for path in raw_paths.split(',').filter(|path| !path.is_empty()) {
        if has_glob_meta(path) {
            for (candidate, content) in all_files {
                if glob_matches(path, candidate) && !files.contains_key(candidate) {
                    files.insert(candidate.clone(), content.clone());
                }
            }
        } else if let Some(content) = all_files.get(path) {
            files.insert(path.to_owned(), content.clone());
        }
    }
    files
}

fn has_glob_meta(path: &str) -> bool {
    path.as_bytes()
        .iter()
        .any(|byte| matches!(byte, b'*' | b'?' | b'['))
}

fn glob_matches(pattern: &str, text: &str) -> bool {
    glob_match(pattern.as_bytes(), text.as_bytes())
}

fn glob_match(pattern: &[u8], text: &[u8]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }
    match pattern[0] {
        b'*' => {
            glob_match(&pattern[1..], text) || (!text.is_empty() && glob_match(pattern, &text[1..]))
        }
        b'?' => !text.is_empty() && glob_match(&pattern[1..], &text[1..]),
        b'[' => {
            if text.is_empty() {
                return false;
            }
            let Some(end) = pattern.iter().position(|byte| *byte == b']') else {
                return pattern[0] == text[0] && glob_match(&pattern[1..], &text[1..]);
            };
            char_class_matches(&pattern[1..end], text[0])
                && glob_match(&pattern[end + 1..], &text[1..])
        }
        byte => !text.is_empty() && byte == text[0] && glob_match(&pattern[1..], &text[1..]),
    }
}

fn char_class_matches(class: &[u8], value: u8) -> bool {
    let (negated, class) = match class.first() {
        Some(b'!') | Some(b'^') => (true, &class[1..]),
        _ => (false, class),
    };
    let mut matched = false;
    let mut index = 0;
    while index < class.len() {
        if index + 2 < class.len() && class[index + 1] == b'-' {
            matched |= class[index] <= value && value <= class[index + 2];
            index += 3;
        } else {
            matched |= class[index] == value;
            index += 1;
        }
    }
    if negated { !matched } else { matched }
}

fn build_input_tar(files: &BTreeMap<String, Vec<u8>>, mode: u32) -> AppResult<Vec<u8>> {
    let mut archive = tar::Builder::new(Vec::new());
    for (path, content) in files {
        checked_relative_path(path)?;
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Regular);
        header.set_mode(mode);
        header.set_uid(STUDENT_UID);
        header.set_gid(STUDENT_GID);
        header.set_size(content.len() as u64);
        header.set_mtime(0);
        header.set_cksum();
        archive.append_data(&mut header, path, Cursor::new(content))?;
    }
    archive.finish()?;
    archive.into_inner().map_err(Into::into)
}

fn read_output_tar(raw: &[u8]) -> AppResult<BTreeMap<String, Vec<u8>>> {
    let mut archive = tar::Archive::new(Cursor::new(raw));
    let mut files = BTreeMap::new();
    let mut total_bytes = 0usize;
    for entry in archive.entries()? {
        let mut entry = entry?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = normalized_tar_path(&entry)?;
        let size = entry.header().size()? as usize;
        total_bytes = total_bytes
            .checked_add(size)
            .ok_or_else(|| AppError::BadRequest("downloaded file data exceeds limit".to_owned()))?;
        if total_bytes > WORKSPACE_FILE_READ_LIMIT {
            return Err(AppError::BadRequest(
                "downloaded file data exceeds limit".to_owned(),
            ));
        }
        let mut content = Vec::with_capacity(size);
        entry.read_to_end(&mut content)?;
        files.insert(path, content);
    }
    Ok(files)
}

fn normalized_tar_path<R: std::io::Read>(entry: &tar::Entry<'_, R>) -> AppResult<String> {
    let path = entry.path()?;
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err(AppError::BadRequest(format!(
                    "bad output path {:?}",
                    path.display()
                )));
            }
        }
    }
    let normalized = parts.join("/");
    checked_relative_path(&normalized)?;
    Ok(normalized)
}

struct Container {
    command: Arc<Vec<String>>,
    id: String,
}

impl Container {
    async fn create(
        command: &Arc<Vec<String>>,
        active_runs: &Arc<Mutex<BTreeMap<String, u64>>>,
        run_id: u64,
        name: &str,
        bundle: &RuntimeBundle,
        limits: &RuntimeLimits,
        deadline: Instant,
    ) -> AppResult<Self> {
        let memory = format!("{}m", limits.max_memory);
        let disk_bytes = limits
            .max_file_size
            .checked_mul(1024 * 1024)
            .ok_or_else(|| {
                AppError::BadRequest("runtime file size limit is too large".to_owned())
            })?;
        let docker_args = vec![
            "run".to_owned(),
            "-d".to_owned(),
            "--pull=never".to_owned(),
            "--name".to_owned(),
            name.to_owned(),
            "--hostname".to_owned(),
            name.to_owned(),
            "--user".to_owned(),
            container_user(),
            "--net=none".to_owned(),
            "--label".to_owned(),
            DAYCARE_CONTAINER_LABEL.to_owned(),
            "--label".to_owned(),
            format!("codegrinder.user_id={}", bundle.user_id),
            "--memory".to_owned(),
            memory.clone(),
            "--memory-swap".to_owned(),
            memory,
            "--pids-limit".to_owned(),
            limits.max_threads.to_string(),
            "--cap-drop".to_owned(),
            "ALL".to_owned(),
            "--security-opt".to_owned(),
            "no-new-privileges".to_owned(),
            "--ulimit".to_owned(),
            "core=0:0".to_owned(),
            "--ulimit".to_owned(),
            format!("cpu={}", limits.max_cpu),
            "--ulimit".to_owned(),
            format!("fsize={disk_bytes}"),
            "--ulimit".to_owned(),
            format!("nofile={0}:{0}", limits.max_fd),
            bundle.container.clone(),
            "/bin/sleep".to_owned(),
            format!("{}s", (limits.max_cpu * 2).max(1)),
        ];
        let mut result = run_command(command, &docker_args, deadline).await?;
        if result.status != 0 && command_output_contains(&result, "already in use") {
            let active = active_runs.lock().await;
            if active.get(name) != Some(&run_id) {
                return Err(AppError::BadRequest(
                    "daycare request was superseded by a newer request".to_owned(),
                ));
            }
            drop(active);
            preempt_container(command, name).await;
            ensure_active(active_runs, name, run_id).await?;
            result = run_command(command, &docker_args, deadline).await?;
        }
        if result.status != 0 {
            return Err(AppError::Internal(format!(
                "container run failed: exit={}; output={}",
                result.status,
                String::from_utf8_lossy(&[result.stdout, result.stderr].concat())
            )));
        }
        let id = String::from_utf8_lossy(&result.stdout).trim().to_owned();
        if id.is_empty() {
            return Err(AppError::Internal(
                "container run failed: empty container ID".to_owned(),
            ));
        }
        if let Err(err) = ensure_active(active_runs, name, run_id).await {
            let _ = run_command(
                command,
                &["rm".to_owned(), "-f".to_owned(), id.clone()],
                Instant::now() + Duration::from_secs(5),
            )
            .await;
            return Err(err);
        }
        Ok(Self {
            command: command.clone(),
            id,
        })
    }

    async fn put_files(
        &self,
        files: &BTreeMap<String, Vec<u8>>,
        mode: u32,
        deadline: Instant,
    ) -> AppResult<()> {
        if files.is_empty() {
            return Ok(());
        }
        let tar = build_input_tar(files, mode)?;
        let args = vec![
            "cp".to_owned(),
            "-".to_owned(),
            format!("{}:/home/student/", self.id),
        ];
        let result = run_command_with_input(&self.command, &args, tar, deadline).await?;
        if result.status != 0 {
            return Err(AppError::Internal(format!(
                "container cp failed: exit={}; output={}",
                result.status,
                String::from_utf8_lossy(&[result.stdout, result.stderr].concat())
            )));
        }
        Ok(())
    }

    async fn read_regular_file(&self, path: &str, deadline: Instant) -> AppResult<Vec<u8>> {
        let files = self.copy_student_files(deadline).await?;
        files.get(path).cloned().ok_or_else(|| {
            AppError::BadRequest(format!(
                "output file {path} was not produced by the container"
            ))
        })
    }

    async fn download_files(
        &self,
        raw_paths: &str,
        deadline: Instant,
    ) -> AppResult<BTreeMap<String, Vec<u8>>> {
        let files = self.copy_student_files(deadline).await?;
        Ok(select_download_files(&files, raw_paths))
    }

    async fn copy_student_files(&self, deadline: Instant) -> AppResult<BTreeMap<String, Vec<u8>>> {
        let args = vec![
            "cp".to_owned(),
            format!("{}:/home/student/.", self.id),
            "-".to_owned(),
        ];
        let result = run_command_with_output_limit(
            &self.command,
            &args,
            deadline,
            WORKSPACE_FILE_READ_LIMIT + 1_000_000,
        )
        .await?;
        if result.status != 0 {
            return Err(AppError::Internal(format!(
                "container cp from container failed: exit={}; output={}",
                result.status,
                String::from_utf8_lossy(&[result.stdout, result.stderr].concat())
            )));
        }
        read_output_tar(&result.stdout)
    }

    async fn exec(&self, cmd: &[String], deadline: Instant) -> AppResult<CommandResult> {
        let mut args = vec![
            "exec".to_owned(),
            "--user".to_owned(),
            container_user(),
            self.id.clone(),
        ];
        args.extend(cmd.iter().cloned());
        run_command(&self.command, &args, deadline).await
    }

    async fn shutdown(&self) -> AppResult<()> {
        let deadline = Instant::now() + Duration::from_secs(5);
        let _ = run_command(
            &self.command,
            &[
                "stop".to_owned(),
                "--time".to_owned(),
                "1".to_owned(),
                self.id.clone(),
            ],
            deadline,
        )
        .await;
        let _ = run_command(
            &self.command,
            &["rm".to_owned(), "-f".to_owned(), self.id.clone()],
            deadline,
        )
        .await?;
        Ok(())
    }
}

async fn ensure_active(
    active_runs: &Arc<Mutex<BTreeMap<String, u64>>>,
    name: &str,
    run_id: u64,
) -> AppResult<()> {
    let active = active_runs.lock().await;
    if active.get(name) == Some(&run_id) {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "daycare request was superseded by a newer request".to_owned(),
        ))
    }
}

fn command_output_contains(result: &CommandResult, needle: &str) -> bool {
    String::from_utf8_lossy(&result.stdout).contains(needle)
        || String::from_utf8_lossy(&result.stderr).contains(needle)
}

fn container_user() -> String {
    format!("{STUDENT_UID}:{STUDENT_GID}")
}

async fn preempt_container(command: &Arc<Vec<String>>, name: &str) {
    let _ = run_command(
        command,
        &["rm".to_owned(), "-f".to_owned(), name.to_owned()],
        Instant::now() + Duration::from_secs(5),
    )
    .await;
}

struct CommandResult {
    status: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

async fn run_command(
    command: &Arc<Vec<String>>,
    args: &[String],
    deadline: Instant,
) -> AppResult<CommandResult> {
    run_command_with_output_limit(command, args, deadline, COMMAND_OUTPUT_LIMIT).await
}

async fn run_command_with_output_limit(
    command: &Arc<Vec<String>>,
    args: &[String],
    deadline: Instant,
    output_limit: usize,
) -> AppResult<CommandResult> {
    run_command_inner(command, args, None, deadline, output_limit).await
}

async fn run_command_with_input(
    command: &Arc<Vec<String>>,
    args: &[String],
    input: Vec<u8>,
    deadline: Instant,
) -> AppResult<CommandResult> {
    run_command_inner(command, args, Some(input), deadline, COMMAND_OUTPUT_LIMIT).await
}

async fn run_command_inner(
    command: &Arc<Vec<String>>,
    args: &[String],
    input: Option<Vec<u8>>,
    deadline: Instant,
    output_limit: usize,
) -> AppResult<CommandResult> {
    let mut cmd = Command::new(&command[0]);
    cmd.args(command.iter().skip(1))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn()?;
    if let Some(input) = input {
        let mut stdin = child.stdin.take().expect("stdin piped");
        stdin.write_all(&input).await?;
        stdin.shutdown().await?;
    }
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");
    let stdout_task = tokio::spawn(async move { read_limited(&mut stdout, output_limit).await });
    let stderr_task =
        tokio::spawn(async move { read_limited(&mut stderr, COMMAND_OUTPUT_LIMIT).await });
    let wait = child.wait();
    let status = match tokio::time::timeout_at(tokio::time::Instant::from_std(deadline), wait).await
    {
        Ok(result) => result?,
        Err(_) => {
            let _ = child.kill().await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return Err(AppError::Internal("command timed out".to_owned()));
        }
    };
    Ok(CommandResult {
        status: status.code().unwrap_or(128),
        stdout: stdout_task
            .await
            .map_err(|err| AppError::Internal(err.to_string()))??,
        stderr: stderr_task
            .await
            .map_err(|err| AppError::Internal(err.to_string()))??,
    })
}

async fn read_limited<R: AsyncReadExt + Unpin>(reader: &mut R, limit: usize) -> AppResult<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            if truncated {
                out.extend_from_slice(COMMAND_OUTPUT_TRUNCATED);
            }
            return Ok(out);
        }
        let remaining = limit.saturating_sub(out.len());
        out.extend_from_slice(&buf[..n.min(remaining)]);
        if n > remaining {
            truncated = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use chrono::{Duration, Utc};
    use tokio_stream::StreamExt;

    use super::*;
    use crate::config::{IpFilterConfig, ServerConfig};
    use crate::proto::{AssignmentKey, Commit, RuntimeLimits};
    use crate::signatures::{decode_signed_runtime_bundle, encode_signed_runtime_bundle};

    #[test]
    fn runtime_validation_rejects_wrong_host_stale_time_and_action_mismatch() {
        let config = test_config(tempfile::tempdir().unwrap().path());

        let wrong_host = signed_runtime(&config, |bundle| {
            bundle.hostname = "other.example".to_owned();
        });
        assert!(
            validate_and_decode_action(&wrong_host, &config.daycare_secret, &config.hostname)
                .is_err()
        );

        let stale = signed_runtime(&config, |bundle| {
            bundle.commit.as_mut().unwrap().updated_at =
                Some(crate::timeutil::timestamp(Utc::now() - Duration::hours(1)));
        });
        assert!(
            validate_and_decode_action(&stale, &config.daycare_secret, &config.hostname).is_err()
        );

        let mismatch = signed_runtime(&config, |bundle| {
            bundle.commit.as_mut().unwrap().action = "demo".to_owned();
        });
        assert!(
            validate_and_decode_action(&mismatch, &config.daycare_secret, &config.hostname)
                .is_err()
        );
    }

    #[test]
    fn xunit_parser_fails_invalid_xml_and_counts_skipped_as_failed() {
        let mut report = ReportCard {
            passed: true,
            note: String::new(),
            duration: None,
            results: Vec::new(),
        };
        parse_xunit(&mut report, b"<not-closed");
        assert!(!report.passed);
        assert_eq!(report.note, "error parsing unit test results");

        let mut report = ReportCard {
            passed: true,
            note: String::new(),
            duration: None,
            results: Vec::new(),
        };
        parse_xunit(
            &mut report,
            br#"<testsuite><testcase name="ok"/><testcase name="skip"><skipped/></testcase></testsuite>"#,
        );
        assert!(!report.passed);
        assert_eq!(report.note, "Passed 1/2 tests");
        assert_eq!(score_from_report(&report), 0.5);
    }

    #[test]
    fn runtime_limit_overrides_cannot_disable_resource_controls() {
        let config = test_config(tempfile::tempdir().unwrap().path());
        let signed = signed_runtime(&config, |bundle| {
            bundle.problem_options = vec!["maxMemory=0".to_owned()];
        });
        let bundle =
            validate_and_decode_action(&signed, &config.daycare_secret, &config.hostname).unwrap();

        assert!(effective_limits(&bundle).is_err());
    }

    #[tokio::test]
    async fn workspace_mount_rejects_escaping_paths_and_large_result_files() {
        assert!(
            build_input_tar(
                &BTreeMap::from([("../x".to_owned(), b"bad".to_vec())]),
                0o666
            )
            .is_err()
        );

        let tar = output_tar(&[(
            "test_detail.xml",
            &vec![b'x'; WORKSPACE_FILE_READ_LIMIT + 1],
        )]);
        assert!(read_output_tar(&tar).is_err());
    }

    #[tokio::test]
    async fn downloaded_artifacts_support_globs_and_reject_symlinks() {
        let tar = output_tar_with_symlink(
            &[
                ("./artifact-one.txt", b"one".as_slice()),
                ("./sub/artifact-two.txt", b"two".as_slice()),
            ],
            "artifact-link.txt",
            "/etc/passwd",
        );
        let all_files = read_output_tar(&tar).unwrap();
        let files = select_download_files(&all_files, "artifact-*.txt,sub/artifact-*.txt");

        assert_eq!(files.get("artifact-one.txt"), Some(&b"one".to_vec()));
        assert_eq!(files.get("sub/artifact-two.txt"), Some(&b"two".to_vec()));
        assert!(!files.contains_key("artifact-link.txt"));
    }

    #[tokio::test]
    async fn daycare_run_preempts_named_user_container_and_emits_grade_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_engine(dir.path());
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let signed = signed_runtime(&config, |_| {});

        let mut stream = runtime
            .run(DaycareRequest {
                bundle: Some(signed),
                args: Vec::new(),
            })
            .await
            .unwrap()
            .into_inner();
        let mut saw_bundle = false;
        while let Some(response) = stream.next().await {
            if matches!(
                response.unwrap().response,
                Some(daycare_response::Response::Bundle(_))
            ) {
                saw_bundle = true;
            }
        }

        assert!(saw_bundle);
        let log = fs::read_to_string(dir.path().join("engine.log")).unwrap();
        assert!(log.contains("rm -f nanny-student"));
        assert!(log.contains("run -d"));
        assert!(log.contains("--user "));
        assert!(log.contains("--label codegrinder.daycare=1"));
        assert!(log.contains("--label codegrinder.user_id=student"));
        assert!(log.contains("--ulimit core=0:0"));
        assert!(log.contains("--ulimit cpu=1"));
        assert!(log.contains("--ulimit fsize=10485760"));
        assert!(log.contains("--ulimit nofile=10:10"));
        assert!(log.contains("fake-container true"));
    }

    #[tokio::test]
    async fn non_grade_action_streams_events_without_final_signed_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_engine(dir.path());
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let signed = signed_runtime(&config, |bundle| {
            bundle.action = "demo".to_owned();
            bundle.commit.as_mut().unwrap().action = "demo".to_owned();
        });

        let mut stream = runtime
            .run(DaycareRequest {
                bundle: Some(signed),
                args: Vec::new(),
            })
            .await
            .unwrap()
            .into_inner();
        let mut saw_event = false;
        let mut saw_bundle = false;
        while let Some(response) = stream.next().await {
            match response.unwrap().response {
                Some(daycare_response::Response::Event(_)) => saw_event = true,
                Some(daycare_response::Response::Bundle(_)) => saw_bundle = true,
                _ => {}
            }
        }

        assert!(saw_event);
        assert!(!saw_bundle);
    }

    #[tokio::test]
    async fn daycare_run_returns_signed_commit_with_transcript_report_downloads_and_limits() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_check_engine(dir.path());
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let signed = signed_runtime(&config, |bundle| {
            bundle.parser = "check".to_owned();
            bundle.problem_options = vec![
                "maxCPU=7".to_owned(),
                "maxFD=77".to_owned(),
                "maxFileSize=5".to_owned(),
                "maxMemory=64".to_owned(),
                "maxThreads=9".to_owned(),
                "download=artifact.txt".to_owned(),
            ];
        });

        let mut stream = runtime
            .run(DaycareRequest {
                bundle: Some(signed),
                args: vec!["ignored-container-arg".to_owned()],
            })
            .await
            .unwrap()
            .into_inner();
        let mut events = Vec::new();
        let mut final_bundle = None;
        while let Some(response) = stream.next().await {
            match response.unwrap().response {
                Some(daycare_response::Response::Event(event)) => events.push(event),
                Some(daycare_response::Response::Bundle(bundle)) => final_bundle = Some(bundle),
                Some(daycare_response::Response::Error(error)) => panic!("{error}"),
                _ => {}
            }
        }

        assert!(events.iter().any(|event| event.event == "stdout"));
        assert!(events.iter().any(|event| event.event == "stderr"));
        assert!(
            events
                .iter()
                .any(|event| event.files.get("artifact.txt") == Some(&b"artifact".to_vec()))
        );
        let signed = final_bundle.expect("grade action returns signed bundle");
        let bundle = decode_signed_runtime_bundle(&signed, &config.daycare_secret).unwrap();
        let commit = bundle.commit.unwrap();
        let report = commit.report_card.unwrap();
        assert!(!report.passed);
        assert_eq!(report.note, "Passed 1/2 tests");
        assert_eq!(commit.score, 0.5);
        assert!(commit.transcript.iter().any(|event| {
            event.event == "stdout" && event.stream_data == b"student stdout\n".to_vec()
        }));
        assert!(commit.transcript.iter().any(|event| {
            event.event == "stderr" && event.stream_data == b"student stderr\n".to_vec()
        }));
        assert!(
            commit
                .transcript
                .iter()
                .any(|event| event.files.get("artifact.txt") == Some(&b"artifact".to_vec()))
        );

        let log = fs::read_to_string(dir.path().join("engine.log")).unwrap();
        assert!(log.contains("--ulimit cpu=7"));
        assert!(log.contains("--ulimit fsize=5242880"));
        assert!(log.contains("--ulimit nofile=77:77"));
        assert!(log.contains("--memory 64m"));
        assert!(log.contains("--pids-limit 9"));
        assert!(!log.contains("ignored-container-arg"));
    }

    #[tokio::test]
    async fn parsed_grade_keeps_nonzero_test_command_status_failed() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_passing_check_exit_engine(dir.path(), 1);
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let signed = signed_runtime(&config, |bundle| {
            bundle.parser = "check".to_owned();
        });

        let mut stream = runtime
            .run(DaycareRequest {
                bundle: Some(signed),
                args: Vec::new(),
            })
            .await
            .unwrap()
            .into_inner();
        let mut final_bundle = None;
        while let Some(response) = stream.next().await {
            match response.unwrap().response {
                Some(daycare_response::Response::Bundle(bundle)) => final_bundle = Some(bundle),
                Some(daycare_response::Response::Error(error)) => panic!("{error}"),
                _ => {}
            }
        }

        let signed = final_bundle.expect("grade action returns signed bundle");
        let bundle = decode_signed_runtime_bundle(&signed, &config.daycare_secret).unwrap();
        let report = bundle.commit.unwrap().report_card.unwrap();
        assert!(!report.passed);
        assert_eq!(report.note, "Passed 1/1 tests");
    }

    fn output_tar(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut archive = tar::Builder::new(Vec::new());
        for (path, content) in files {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Regular);
            header.set_mode(0o666);
            header.set_uid(STUDENT_UID);
            header.set_gid(STUDENT_GID);
            header.set_size(content.len() as u64);
            header.set_mtime(0);
            header.set_cksum();
            archive
                .append_data(&mut header, *path, Cursor::new(*content))
                .unwrap();
        }
        archive.finish().unwrap();
        archive.into_inner().unwrap()
    }

    fn output_tar_with_symlink(
        files: &[(&str, &[u8])],
        link_path: &str,
        link_target: &str,
    ) -> Vec<u8> {
        let mut archive = tar::Builder::new(Vec::new());
        for (path, content) in files {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Regular);
            header.set_mode(0o666);
            header.set_uid(STUDENT_UID);
            header.set_gid(STUDENT_GID);
            header.set_size(content.len() as u64);
            header.set_mtime(0);
            header.set_cksum();
            archive
                .append_data(&mut header, *path, Cursor::new(*content))
                .unwrap();
        }
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_mode(0o777);
        header.set_uid(STUDENT_UID);
        header.set_gid(STUDENT_GID);
        header.set_size(0);
        header.set_mtime(0);
        header.set_link_name(link_target).unwrap();
        header.set_cksum();
        archive
            .append_data(&mut header, link_path, Cursor::new([]))
            .unwrap();
        archive.finish().unwrap();
        archive.into_inner().unwrap()
    }

    fn signed_runtime(
        config: &ServerConfig,
        mutate: impl FnOnce(&mut RuntimeBundle),
    ) -> SignedRuntimeBundle {
        let now = Utc::now();
        let mut bundle = RuntimeBundle {
            hostname: config.hostname.clone(),
            user_id: "student".to_owned(),
            assignment: Some(AssignmentKey {
                user_id: "student".to_owned(),
                course_id: "c1".to_owned(),
                problem_set_id: "ps1".to_owned(),
            }),
            problem_id: "p1".to_owned(),
            problem_note: "Problem".to_owned(),
            step_number: 1,
            total_steps: 1,
            action: "grade".to_owned(),
            container: "container:latest".to_owned(),
            command: "true".to_owned(),
            limits: Some(RuntimeLimits {
                max_cpu: 1,
                max_fd: 10,
                max_file_size: 10,
                max_memory: 32,
                max_threads: 2,
            }),
            files: BTreeMap::from([("answer.txt".to_owned(), b"ok".to_vec())]),
            commit: Some(Commit {
                assignment: Some(AssignmentKey {
                    user_id: "student".to_owned(),
                    course_id: "c1".to_owned(),
                    problem_set_id: "ps1".to_owned(),
                }),
                problem_id: "p1".to_owned(),
                step: 1,
                action: "grade".to_owned(),
                note: "grade".to_owned(),
                files: BTreeMap::from([("answer.txt".to_owned(), b"ok".to_vec())]),
                updated_at: Some(crate::timeutil::timestamp(now)),
                ..Commit::default()
            }),
            ..RuntimeBundle::default()
        };
        mutate(&mut bundle);
        encode_signed_runtime_bundle(&bundle, &config.daycare_secret).unwrap()
    }

    fn fake_engine(base: &Path) -> PathBuf {
        let script = base.join("fake-engine.sh");
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  run) echo fake-container ;;\n  exec) exit 0 ;;\n  cp) if [ \"$2\" = \"-\" ]; then cat >/dev/null; else cat >/dev/null; fi ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
                base.display(),
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script, perms).unwrap();
        }
        script
    }

    fn fake_check_engine(base: &Path) -> PathBuf {
        let script = base.join("fake-check-engine.sh");
        let output = base.join("check-output.tar");
        fs::write(
            &output,
            output_tar(&[
                (
                    "test_detail.xml",
                    b"<suite><test result=\"success\"><id>ok</id></test><test result=\"failure\"><id>bad</id><message>nope</message><fn>test_bad</fn></test></suite>",
                ),
                ("artifact.txt", b"artifact"),
            ]),
        )
        .unwrap();
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  run) echo fake-container ;;\n  exec) printf 'student stdout\\n'; printf 'student stderr\\n' >&2; exit 0 ;;\n  cp) if [ \"$2\" = \"-\" ]; then cat >/dev/null; else cat {}; fi ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
                base.display(),
                output.display(),
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script, perms).unwrap();
        }
        script
    }

    fn fake_passing_check_exit_engine(base: &Path, exit_status: i32) -> PathBuf {
        let script = base.join("fake-passing-check-exit-engine.sh");
        let output = base.join("passing-check-output.tar");
        fs::write(
            &output,
            output_tar(&[(
                "test_detail.xml",
                b"<suite><test result=\"success\"><id>ok</id></test></suite>",
            )]),
        )
        .unwrap();
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  run) echo fake-container ;;\n  exec) exit {} ;;\n  cp) if [ \"$2\" = \"-\" ]; then cat >/dev/null; else cat {}; fi ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
                base.display(),
                exit_status,
                output.display(),
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script, perms).unwrap();
        }
        script
    }

    fn test_config(base: &Path) -> ServerConfig {
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
            sqlite3_path: base.join("db.sqlite"),
            sessions_expire: Vec::new(),
            ip_filter: IpFilterConfig::default(),
            tls_cert: None,
            tls_key: None,
            www_root: base.join("www"),
        }
    }
}

fn safe_user_dir_name(user_id: &str) -> String {
    let trimmed = user_id.trim();
    if !trimmed.is_empty()
        && trimmed != "."
        && trimmed != ".."
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
    {
        trimmed.to_owned()
    } else {
        format!(
            "user-{}",
            hex::encode(sha2::Sha256::digest(user_id.as_bytes()))[..24].to_owned()
        )
    }
}
