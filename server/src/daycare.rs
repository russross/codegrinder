use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use sha2::Digest;
use tokio::io::AsyncReadExt;
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

unsafe extern "C" {
    fn getuid() -> u32;
    fn getgid() -> u32;
}

#[cfg(not(test))]
fn validate_workspace_mount(path: &Path) -> AppResult<()> {
    let target = std::fs::canonicalize(path)?;
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo")?;
    let mut best: Option<(&str, &str)> = None;
    for line in mountinfo.lines() {
        let Some((mount_fields, fs_fields)) = line.split_once(" - ") else {
            continue;
        };
        let fields = mount_fields.split_whitespace().collect::<Vec<_>>();
        let fs = fs_fields.split_whitespace().next().unwrap_or("");
        let Some(mount_point) = fields.get(4) else {
            continue;
        };
        let mount_path = Path::new(mount_point);
        if target.starts_with(mount_path)
            && best
                .map(|(best_mount, _)| mount_point.len() > best_mount.len())
                .unwrap_or(true)
        {
            best = Some((mount_point, fs));
        }
    }
    if best.map(|(_, fs)| fs) == Some("tmpfs") {
        return Ok(());
    }
    Err(AppError::Internal(format!(
        "daycare mount directory {} must be on tmpfs",
        path.display()
    )))
}

#[derive(Clone)]
pub struct DaycareRuntime {
    config: Arc<ServerConfig>,
    container_command: Arc<Vec<String>>,
    workspace_base: PathBuf,
    container_slots: Arc<Semaphore>,
    user_locks: Arc<Mutex<BTreeMap<String, Arc<Mutex<()>>>>>,
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
        std::fs::create_dir_all(&config.daycare_mount_dir)?;
        #[cfg(not(test))]
        validate_workspace_mount(&config.daycare_mount_dir)?;
        Ok(Self {
            workspace_base: config.daycare_mount_dir.clone(),
            container_slots: Arc::new(Semaphore::new(config.capacity.max(1))),
            config,
            container_command: Arc::new(command),
            user_locks: Arc::new(Mutex::new(BTreeMap::new())),
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
        let user_lock = {
            let mut locks = self.user_locks.lock().await;
            locks
                .entry(nanny_name.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        preempt_container(&self.container_command, &nanny_name).await;
        let _user_guard = user_lock.lock().await;
        let _slot = self
            .container_slots
            .acquire()
            .await
            .map_err(|_| AppError::Internal("container limiter closed".to_owned()))?;
        let workspace = WorkspaceMount::create(&self.workspace_base, &bundle.user_id).await?;
        let deadline = Instant::now() + action_timeout(&limits);
        let container = match Container::create(
            &self.container_command,
            &workspace,
            &nanny_name,
            &bundle,
            &limits,
            deadline,
        )
        .await
        {
            Ok(container) => container,
            Err(err) => {
                workspace.cleanup().await;
                return Err(err);
            }
        };
        let result = run_action(
            &container,
            &workspace,
            &mut bundle,
            &self.config.daycare_secret,
            deadline,
            tx,
        )
        .await;
        let shutdown = container.shutdown().await;
        workspace.cleanup().await;
        result?;
        shutdown?;
        Ok(())
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
    Ok(limits)
}

fn action_timeout(limits: &RuntimeLimits) -> Duration {
    let cpu = limits.max_cpu.max(1);
    Duration::from_secs((cpu * 2 + 5) as u64)
}

async fn run_action(
    container: &Container,
    workspace: &WorkspaceMount,
    bundle: &mut RuntimeBundle,
    secret: &str,
    deadline: Instant,
    tx: mpsc::Sender<Result<DaycareResponse, Status>>,
) -> AppResult<()> {
    workspace.write_files(&bundle.files, 0o666).await?;
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
                &workspace
                    .read_regular_file("test_detail.xml")
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
                &workspace
                    .read_regular_file("test_detail.xml")
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
            match read_download_files(workspace, paths).await {
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

async fn read_download_files(
    workspace: &WorkspaceMount,
    raw_paths: &str,
) -> AppResult<BTreeMap<String, Vec<u8>>> {
    let mut files = BTreeMap::new();
    let mut total_bytes = 0usize;
    for path in raw_paths.split(',').filter(|path| !path.is_empty()) {
        if has_glob_meta(path) {
            for candidate in workspace.regular_file_paths().await? {
                if glob_matches(path, &candidate) && !files.contains_key(&candidate) {
                    let content = workspace.read_regular_file(&candidate).await?;
                    total_bytes += content.len();
                    if total_bytes > WORKSPACE_FILE_READ_LIMIT {
                        return Err(AppError::BadRequest(
                            "downloaded file data exceeds limit".to_owned(),
                        ));
                    }
                    files.insert(candidate, content);
                }
            }
        } else if workspace.path_exists(path).await? {
            let content = workspace.read_regular_file(path).await?;
            total_bytes += content.len();
            if total_bytes > WORKSPACE_FILE_READ_LIMIT {
                return Err(AppError::BadRequest(
                    "downloaded file data exceeds limit".to_owned(),
                ));
            }
            files.insert(path.to_owned(), content);
        }
    }
    Ok(files)
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

struct WorkspaceMount {
    root: PathBuf,
}

impl WorkspaceMount {
    async fn create(base: &Path, user_id: &str) -> AppResult<Self> {
        let root = base.join(safe_user_dir_name(user_id));
        let _ = tokio::fs::remove_dir_all(&root).await;
        tokio::fs::create_dir_all(&root).await?;
        Ok(Self { root })
    }

    async fn write_files(&self, files: &BTreeMap<String, Vec<u8>>, mode: u32) -> AppResult<()> {
        for (path, content) in files {
            let relative = checked_relative_path(path)?;
            let target = self.root.join(relative);
            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&target, content).await?;
            set_mode(&target, mode).await?;
        }
        Ok(())
    }

    async fn path_exists(&self, path: &str) -> AppResult<bool> {
        let target = self.root.join(checked_relative_path(path)?);
        match tokio::fs::try_exists(target).await {
            Ok(exists) => Ok(exists),
            Err(err) => Err(err.into()),
        }
    }

    async fn read_regular_file(&self, path: &str) -> AppResult<Vec<u8>> {
        let target = self.root.join(checked_relative_path(path)?);
        let meta = tokio::fs::symlink_metadata(&target).await?;
        if !meta.is_file() {
            return Err(AppError::BadRequest(format!(
                "refusing non-regular output path {path}"
            )));
        }
        if meta.len() as usize > WORKSPACE_FILE_READ_LIMIT {
            return Err(AppError::BadRequest(format!(
                "output file {path} exceeds read limit"
            )));
        }
        let file = tokio::fs::File::open(&target).await?;
        let opened = file.metadata().await?;
        if !opened.is_file() {
            return Err(AppError::BadRequest(format!(
                "refusing non-regular output path {path}"
            )));
        }
        Ok(tokio::fs::read(target).await?)
    }

    async fn regular_file_paths(&self) -> AppResult<Vec<String>> {
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || regular_file_paths_blocking(&root))
            .await
            .map_err(|err| AppError::Internal(err.to_string()))?
    }

    async fn cleanup(&self) {
        let _ = tokio::fs::remove_dir_all(&self.root).await;
    }
}

fn regular_file_paths_blocking(root: &Path) -> AppResult<Vec<String>> {
    let mut paths = Vec::new();
    let mut stack = vec![root.to_owned()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current)? {
            let entry = entry?;
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path)?;
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                stack.push(path);
            } else if meta.is_file() {
                let rel = path
                    .strip_prefix(root)
                    .map_err(|err| AppError::Internal(err.to_string()))?
                    .to_string_lossy()
                    .replace('\\', "/");
                paths.push(rel);
            }
        }
    }
    paths.sort();
    Ok(paths)
}

async fn set_mode(path: &Path, mode: u32) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(path).await?.permissions();
        perms.set_mode(mode);
        tokio::fs::set_permissions(path, perms).await?;
    }
    Ok(())
}

struct Container {
    command: Arc<Vec<String>>,
    id: String,
}

impl Container {
    async fn create(
        command: &Arc<Vec<String>>,
        workspace: &WorkspaceMount,
        name: &str,
        bundle: &RuntimeBundle,
        limits: &RuntimeLimits,
        deadline: Instant,
    ) -> AppResult<Self> {
        let memory = format!("{}m", limits.max_memory);
        let disk_bytes = limits.max_file_size.max(0) * 1024 * 1024;
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
            "--mount".to_owned(),
            format!(
                "type=bind,source={},target=/home/student",
                workspace.root.display()
            ),
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
        let result = run_command(command, &docker_args, deadline).await?;
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
        Ok(Self {
            command: command.clone(),
            id,
        })
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

fn container_user() -> String {
    let uid = unsafe { getuid() };
    let gid = unsafe { getgid() };
    format!("{uid}:{gid}")
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
    let mut cmd = Command::new(&command[0]);
    cmd.args(command.iter().skip(1))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");
    let stdout_task = tokio::spawn(async move { read_limited(&mut stdout).await });
    let stderr_task = tokio::spawn(async move { read_limited(&mut stderr).await });
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

async fn read_limited<R: AsyncReadExt + Unpin>(reader: &mut R) -> AppResult<Vec<u8>> {
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
        let remaining = COMMAND_OUTPUT_LIMIT.saturating_sub(out.len());
        out.extend_from_slice(&buf[..n.min(remaining)]);
        if n > remaining {
            truncated = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
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

    #[tokio::test]
    async fn workspace_mount_rejects_escaping_paths_and_large_result_files() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = WorkspaceMount::create(dir.path(), "student").await.unwrap();

        assert!(
            workspace
                .write_files(
                    &BTreeMap::from([("../x".to_owned(), b"bad".to_vec())]),
                    0o666
                )
                .await
                .is_err()
        );

        let large = workspace.root.join("test_detail.xml");
        fs::write(&large, vec![b'x'; WORKSPACE_FILE_READ_LIMIT + 1]).unwrap();
        assert!(
            workspace
                .read_regular_file("test_detail.xml")
                .await
                .is_err()
        );
        workspace.cleanup().await;
    }

    #[tokio::test]
    async fn downloaded_artifacts_support_globs_and_reject_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = WorkspaceMount::create(dir.path(), "student").await.unwrap();
        fs::write(workspace.root.join("artifact-one.txt"), b"one").unwrap();
        fs::create_dir(workspace.root.join("sub")).unwrap();
        fs::write(workspace.root.join("sub").join("artifact-two.txt"), b"two").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/passwd", workspace.root.join("artifact-link.txt"))
            .unwrap();

        let files = read_download_files(&workspace, "artifact-*.txt,sub/artifact-*.txt")
            .await
            .unwrap();

        assert_eq!(files.get("artifact-one.txt"), Some(&b"one".to_vec()));
        assert_eq!(files.get("sub/artifact-two.txt"), Some(&b"two".to_vec()));
        assert!(!files.contains_key("artifact-link.txt"));
        #[cfg(unix)]
        assert!(
            workspace
                .read_regular_file("artifact-link.txt")
                .await
                .is_err()
        );
        workspace.cleanup().await;
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
        assert!(!config.daycare_mount_dir.join("student").exists());
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
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  run) echo fake-container ;;\n  exec) exit 0 ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
                base.display()
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
        let workspace = base.join("mounts").join("student");
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  run) echo fake-container ;;\n  exec) printf 'student stdout\\n'; printf 'student stderr\\n' >&2; cat > {}/test_detail.xml <<'XML'\n<suite><test result=\"success\"><id>ok</id></test><test result=\"failure\"><id>bad</id><message>nope</message><fn>test_bad</fn></test></suite>\nXML\nprintf artifact > {}/artifact.txt; exit 0 ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
                base.display(),
                workspace.display(),
                workspace.display(),
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
        let workspace = base.join("mounts").join("student");
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  run) echo fake-container ;;\n  exec) cat > {}/test_detail.xml <<'XML'\n<suite><test result=\"success\"><id>ok</id></test></suite>\nXML\nexit {} ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
                base.display(),
                workspace.display(),
                exit_status,
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
            daycare_secret: "daycare-secret".to_owned(),
            lti_secret: "lti-secret".to_owned(),
            session_secret: "session-secret".to_owned(),
            capacity: 1,
            problem_types: Vec::new(),
            tool_name: "CodeGrinder".to_owned(),
            tool_id: "codegrinder".to_owned(),
            tool_description: "Programming exercises".to_owned(),
            container_engine: "docker".to_owned(),
            daycare_mount_dir: base.join("mounts"),
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
