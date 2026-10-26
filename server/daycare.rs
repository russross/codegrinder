use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::io::{Cursor, Read};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use chrono::Utc;
use serde::Deserialize;
use sha2::Digest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{Mutex, OnceCell, Semaphore, mpsc, watch};
use tokio_stream::{Stream, StreamExt};
use tonic::{Response, Status};

use crate::config::ServerConfig;
use crate::error::{AppError, AppResult};
use crate::files::checked_relative_path;
use crate::logging::record;
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
const STUDENT_DIRECTORY_MODE: u32 = 0o755;
const STUDENT_FILE_MODE: u32 = 0o644;
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const ENGINE_STOP_TIMEOUT: Duration = Duration::from_secs(2);
const ENGINE_REMOVE_TIMEOUT: Duration = Duration::from_secs(5);
const WORKSPACE_ENTRY_LIMIT: usize = 20_000;
const WORKSPACE_PATH_LIMIT: usize = 4096;
const REPORT_FILE_LIMIT: usize = 5_000_000;

struct ActiveRun {
    id: u64,
    stop: watch::Sender<bool>,
}

// A request owns its queue wait, execution, and event delivery until cleanup begins.
struct RequestScope {
    deadline: Instant,
    stop: watch::Receiver<bool>,
    events: mpsc::Sender<Result<ExecutionUpdate, Status>>,
}

impl RequestScope {
    async fn run<T>(&self, work: impl Future<Output = AppResult<T>>) -> AppResult<T> {
        let mut stop = self.stop.clone();
        tokio::select! {
            biased;
            _ = self.events.closed() => Err(AppError::BadRequest("daycare client disconnected".to_owned())),
            _ = stop.wait_for(|cancelled| *cancelled) => Err(AppError::BadRequest("daycare request was superseded by a newer request".to_owned())),
            _ = tokio::time::sleep_until(self.deadline.into()) => Err(AppError::DeadlineExceeded("daycare request timed out".to_owned())),
            result = work => result,
        }
    }
}

#[derive(Clone)]
pub struct DaycareRuntime {
    config: Arc<ServerConfig>,
    container_command: Arc<Vec<String>>,
    container_slots: Arc<Semaphore>,
    active_runs: Arc<Mutex<BTreeMap<String, ActiveRun>>>,
    lifecycles: Arc<Mutex<BTreeMap<String, Weak<Mutex<()>>>>>,
    next_run_id: Arc<AtomicU64>,
    instance: Arc<String>,
}

// Execution stays in process; only the legacy transport adapter signs results.
pub enum ExecutionUpdate {
    Event(Box<EventMessage>),
    Completed(Box<RuntimeBundle>),
}

pub type ExecutionStream =
    Pin<Box<dyn Stream<Item = Result<ExecutionUpdate, Status>> + Send + 'static>>;

impl DaycareRuntime {
    pub fn new(config: Arc<ServerConfig>) -> AppResult<Self> {
        let command = if config.container_engine.trim().is_empty() {
            vec!["docker".to_owned()]
        } else {
            config.container_engine.split_whitespace().map(ToOwned::to_owned).collect::<Vec<_>>()
        };
        Ok(Self {
            container_slots: Arc::new(Semaphore::new(config.capacity)),
            config,
            container_command: Arc::new(command),
            active_runs: Arc::new(Mutex::new(BTreeMap::new())),
            lifecycles: Arc::new(Mutex::new(BTreeMap::new())),
            next_run_id: Arc::new(AtomicU64::new(1)),
            instance: Arc::new(format!("{:032x}", rand::random::<u128>())),
        })
    }

    pub async fn run(
        &self,
        request: DaycareRequest,
        deadline: Option<Instant>,
    ) -> Result<Response<DaycareStream>, Status> {
        let deadline = deadline.unwrap_or_else(|| Instant::now() + DEFAULT_REQUEST_TIMEOUT);
        let (tx, rx) = mpsc::channel(64);
        let runtime = self.clone();
        tokio::spawn(async move {
            let decoded = request
                .bundle
                .ok_or_else(|| AppError::BadRequest("bundle is required".to_owned()))
                .and_then(|signed| {
                    validate_and_decode_action(
                        &signed,
                        &runtime.config.daycare_secret,
                        &runtime.config.hostname,
                    )
                });
            let bundle = match decoded {
                Ok(bundle) => bundle,
                Err(err) => {
                    let _ = tx
                        .send(Ok(DaycareResponse {
                            response: Some(daycare_response::Response::Error(err.to_string())),
                        }))
                        .await;
                    return;
                }
            };
            let grade = bundle.action == "grade";
            let mut execution = runtime.execute(bundle, Some(deadline));
            loop {
                let update = tokio::select! {
                    biased;
                    _ = tx.closed() => break,
                    update = execution.next() => update,
                };
                let Some(update) = update else { break };
                let response = match update {
                    Ok(ExecutionUpdate::Event(event)) => daycare_response::Response::Event(*event),
                    Ok(ExecutionUpdate::Completed(bundle)) if grade => {
                        match encode_signed_runtime_bundle(&bundle, &runtime.config.daycare_secret)
                        {
                            Ok(signed) => daycare_response::Response::Bundle(signed),
                            Err(err) => daycare_response::Response::Error(err.to_string()),
                        }
                    }
                    Ok(ExecutionUpdate::Completed(_)) => continue,
                    Err(status) => daycare_response::Response::Error(status.message().to_owned()),
                };
                if tx.send(Ok(DaycareResponse { response: Some(response) })).await.is_err() {
                    break;
                }
            }
        });
        let stream = ResponseStream {
            receiver: Some(rx),
            deadline: Box::pin(tokio::time::sleep_until(deadline.into())),
        };
        Ok(Response::new(Box::pin(stream) as DaycareStream))
    }

    pub fn execute(&self, bundle: RuntimeBundle, deadline: Option<Instant>) -> ExecutionStream {
        let deadline = deadline.unwrap_or_else(|| Instant::now() + DEFAULT_REQUEST_TIMEOUT);
        let (tx, rx) = mpsc::channel(64);
        let runtime = self.clone();
        tokio::spawn(async move {
            let result = runtime.handle(bundle, tx.clone(), deadline).await;
            if let Err(err) = result {
                record(
                    "WARN",
                    "daycare_request_failed",
                    format_args!("error={:?}", err.to_string()),
                );
                let _ =
                    tokio::time::timeout_at(deadline.into(), tx.send(Err(err.grpc_status()))).await;
            }
        });
        let stream = ResponseStream {
            receiver: Some(rx),
            deadline: Box::pin(tokio::time::sleep_until(deadline.into())),
        };
        Box::pin(stream)
    }

    async fn handle(
        &self,
        mut bundle: RuntimeBundle,
        tx: mpsc::Sender<Result<ExecutionUpdate, Status>>,
        deadline: Instant,
    ) -> AppResult<()> {
        let spec = ExecutionSpec::new(&bundle)?;
        let nanny_name = format!("nanny-{}", safe_user_dir_name(&bundle.user_id));
        let lifecycle = self.user_lifecycle(&nanny_name).await;
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed);
        let context = RunContext::new(run_id, &bundle);
        let started = Instant::now();
        let stop = self.mark_active(&nanny_name, run_id).await;
        let scope = RequestScope { deadline, stop, events: tx.clone() };
        let result = async {
            // Replacement signals immediately, but Docker mutations have one owner per user.
            let _owner = scope.run(async { Ok(lifecycle.lock().await) }).await?;
            let _slot = scope
                .run(async {
                    self.container_slots
                        .acquire()
                        .await
                        .map_err(|_| AppError::Internal("container limiter closed".to_owned()))
                })
                .await?;
            scope.run(async { Ok(()) }).await?;
            reconcile_named_container(&self.container_command, &nanny_name, None, &context).await;
            scope.run(async { Ok(()) }).await?;
            let identity = format!("{}-{run_id}", self.instance);
            scope.run(check_image(&self.container_command, &bundle.container, deadline)).await?;
            // Creation stays owned until its CLI finishes, even after request cancellation.
            let container = match Container::create(
                &self.container_command,
                &identity,
                &nanny_name,
                &bundle,
                &spec.limits,
                deadline,
            )
            .await
            {
                Ok(container) => container,
                Err(err) => {
                    context.log(
                        "ERROR",
                        "daycare_container_create_failed",
                        format_args!("error={:?}", err.to_string()),
                    );
                    let _ = tx.try_send(Err(Status::internal(err.to_string())));
                    reconcile_named_container(
                        &self.container_command,
                        &nanny_name,
                        Some(&identity),
                        &context,
                    )
                    .await;
                    return Err(err);
                }
            };
            let result = scope
                .run(async {
                    container.start(deadline).await?;
                    run_action(&container, &mut bundle, &spec, &context, deadline, tx).await
                })
                .await;
            // Cleanup retains both lifecycle ownership and capacity until absence is confirmed.
            container.reconcile(&context).await;
            result?;
            Ok(())
        }
        .await;
        self.clear_active(&nanny_name, run_id).await;
        context.log(
            if result.is_ok() { "INFO" } else { "WARN" },
            "daycare_finished",
            format_args!(
                "total_ms={} passed={:?} score={:?} reason={:?} error={:?}",
                started.elapsed().as_millis(),
                bundle
                    .commit
                    .as_ref()
                    .and_then(|commit| commit.report_card.as_ref())
                    .map(|report| report.passed),
                bundle.commit.as_ref().map(|commit| commit.score),
                bundle
                    .commit
                    .as_ref()
                    .and_then(|commit| commit.report_card.as_ref())
                    .map(|report| &report.note),
                result.as_ref().err().map(ToString::to_string)
            ),
        );
        result
    }

    async fn user_lifecycle(&self, name: &str) -> Arc<Mutex<()>> {
        let mut lifecycles = self.lifecycles.lock().await;
        lifecycles.retain(|_, owner| owner.strong_count() > 0);
        if let Some(owner) = lifecycles.get(name).and_then(Weak::upgrade) {
            return owner;
        }
        let owner = Arc::new(Mutex::new(()));
        lifecycles.insert(name.to_owned(), Arc::downgrade(&owner));
        owner
    }

    async fn mark_active(&self, name: &str, run_id: u64) -> watch::Receiver<bool> {
        let mut active = self.active_runs.lock().await;
        let (stop, receiver) = watch::channel(false);
        if let Some(previous) = active.insert(name.to_owned(), ActiveRun { id: run_id, stop }) {
            previous.stop.send_replace(true);
            record(
                "INFO",
                "daycare_superseded",
                format_args!("container={name:?} previous_run={} run={run_id}", previous.id),
            );
        }
        receiver
    }

    #[cfg(test)]
    async fn require_active(&self, name: &str, run_id: u64) -> AppResult<()> {
        let active = self.active_runs.lock().await;
        if active.get(name).map(|run| run.id) == Some(run_id) {
            Ok(())
        } else {
            Err(AppError::BadRequest(
                "daycare request was superseded by a newer request".to_owned(),
            ))
        }
    }

    async fn clear_active(&self, name: &str, run_id: u64) {
        let mut active = self.active_runs.lock().await;
        if active.get(name).map(|run| run.id) == Some(run_id) {
            active.remove(name);
        }
    }
}

pub type DaycareStream =
    Pin<Box<dyn Stream<Item = Result<DaycareResponse, Status>> + Send + 'static>>;

// Transport deadlines close the receiver even while its worker owns unresolved Docker work.
struct ResponseStream<T> {
    receiver: Option<mpsc::Receiver<Result<T, Status>>>,
    deadline: Pin<Box<tokio::time::Sleep>>,
}

impl<T> Stream for ResponseStream<T> {
    type Item = Result<T, Status>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        let Some(receiver) = &mut this.receiver else {
            return Poll::Ready(None);
        };
        if this.deadline.as_mut().poll(cx).is_ready() {
            this.receiver = None;
            return Poll::Ready(Some(Err(Status::deadline_exceeded("daycare request timed out"))));
        }
        receiver.poll_recv(cx)
    }
}

// Identity comes from authenticated preparation and follows the run across awaits.
struct RunContext {
    fields: String,
}

impl RunContext {
    fn new(run_id: u64, bundle: &RuntimeBundle) -> Self {
        Self {
            fields: format!(
                "run={run_id} host={:?} user={:?} assignment={:?} problem={:?} step={} action={:?}",
                bundle.hostname,
                bundle.user_id,
                bundle.assignment,
                bundle.problem_id,
                bundle.step_number,
                bundle.action
            ),
        }
    }

    fn log(&self, level: &str, event: &str, fields: std::fmt::Arguments<'_>) {
        record(level, event, format_args!("{} {fields}", self.fields));
    }
}

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
        return Err(AppError::BadRequest("runtime bundle signature is too old".to_owned()));
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
        if !matches!(key, "maxCPU" | "maxFD" | "maxFileSize" | "maxMemory" | "maxThreads") {
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
        return Err(AppError::BadRequest("runtime limits must be positive".to_owned()));
    }
    if limits.max_file_size.checked_mul(1024 * 1024).is_none() {
        return Err(AppError::BadRequest("runtime file size limit is too large".to_owned()));
    }
    Ok(())
}

fn action_timeout(limits: &RuntimeLimits) -> Duration {
    let cpu = limits.max_cpu.max(1) as u64;
    Duration::from_secs(cpu.saturating_mul(2).saturating_add(5))
}

// Resolve signed execution settings once, before admission or container allocation.
struct ExecutionSpec {
    command: Vec<String>,
    limits: RuntimeLimits,
}

impl ExecutionSpec {
    fn new(bundle: &RuntimeBundle) -> AppResult<Self> {
        Ok(Self {
            command: bundle.command.split_whitespace().map(ToOwned::to_owned).collect(),
            limits: effective_limits(bundle)?,
        })
    }
}

enum ExecutionOutcome {
    Exited(CommandResult),
    TimedOut,
    Failed(AppError),
}

async fn run_action(
    container: &Container,
    bundle: &mut RuntimeBundle,
    spec: &ExecutionSpec,
    context: &RunContext,
    deadline: Instant,
    tx: mpsc::Sender<Result<ExecutionUpdate, Status>>,
) -> AppResult<()> {
    container.put_files(&bundle.files, deadline).await.inspect_err(|err| {
        record(
            "ERROR",
            "daycare_upload_failed",
            format_args!(
                "container={:?} user={:?} error={:?}",
                container.id,
                bundle.user_id,
                err.to_string()
            ),
        );
    })?;
    let mut transcript = TranscriptCapture::default();
    let command = &spec.command;
    let mut report =
        ReportCard { passed: true, note: String::new(), duration: None, results: Vec::new() };
    emit_event(
        &tx,
        &mut transcript,
        event("exec", command.clone(), 0, Vec::new(), String::new(), BTreeMap::new()),
    )
    .await?;
    // Only student execution consumes the CPU-derived wall-clock allowance.
    let execution_started = Instant::now();
    let allowance =
        action_timeout(&spec.limits).min(deadline.saturating_duration_since(execution_started));
    let execution_deadline = execution_started + allowance;
    let (execution_result, duration) =
        execute_with_output(container, command, context, execution_deadline, &tx, &mut transcript)
            .await?;
    report.duration = Some(
        prost_types::Duration::try_from(duration)
            .map_err(|err| AppError::Internal(err.to_string()))?,
    );
    let result = match execution_result {
        ExecutionOutcome::Exited(result) => result,
        ExecutionOutcome::TimedOut => {
            let err = AppError::DeadlineExceeded("command timed out".to_owned());
            record(
                "WARN",
                "daycare_command_failed",
                format_args!(
                    "container={:?} user={:?} error={:?}",
                    container.id,
                    bundle.user_id,
                    err.to_string()
                ),
            );
            emit_event(
                &tx,
                &mut transcript,
                event("error", Vec::new(), 0, Vec::new(), err.to_string(), BTreeMap::new()),
            )
            .await?;
            fail_report_for_exec_error(&mut report, bundle, command, err);
            finalize_action(bundle, tx, transcript, report).await?;
            return Ok(());
        }
        ExecutionOutcome::Failed(err) => return Err(err),
    };
    emit_event(
        &tx,
        &mut transcript,
        event("exit", Vec::new(), result.status, Vec::new(), String::new(), BTreeMap::new()),
    )
    .await?;
    if bundle.parser == "xunit" {
        if result.status > 127 {
            fail_report(
                &mut report,
                format!("Crashed with exit status {} while running unit tests", result.status),
            );
        } else {
            parse_xunit(&mut report, &read_report(container, bundle, deadline).await);
            if result.status != 0 {
                report.passed = false;
            }
        }
    } else if bundle.parser == "check" {
        if result.status > 127 {
            fail_report(
                &mut report,
                format!("Crashed with exit status {} while running unit tests", result.status),
            );
        } else {
            parse_check(&mut report, &read_report(container, bundle, deadline).await);
            if result.status != 0 {
                report.passed = false;
            }
        }
    } else if !bundle.parser.is_empty() {
        fail_report(
            &mut report,
            format!("unknown parser {:?} for action {}", bundle.parser, bundle.action),
        );
    } else if result.status != 0 {
        fail_report(
            &mut report,
            format!("\"{}\" failed with exit status {}", command.join(" "), result.status),
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
                Err(err) => record(
                    "WARN",
                    "daycare_download_failed",
                    format_args!(
                        "container={:?} user={:?} error={:?}",
                        container.id,
                        bundle.user_id,
                        err.to_string()
                    ),
                ),
            }
        }
    }
    finalize_action(bundle, tx, transcript, report).await
}

// Both futures remain owned here; a blocked event send cannot suspend execution supervision.
async fn execute_with_output(
    container: &Container,
    command: &[String],
    context: &RunContext,
    deadline: Instant,
    tx: &mpsc::Sender<Result<ExecutionUpdate, Status>>,
    transcript: &mut TranscriptCapture,
) -> AppResult<(ExecutionOutcome, Duration)> {
    let started = Instant::now();
    let (output_tx, mut output_rx) = mpsc::channel(16);
    let execution = async {
        let result = container.exec(command, deadline, output_tx).await;
        let duration = started.elapsed();
        if let ExecutionOutcome::Exited(output) = &result {
            container.log_usage(context, output.status).await;
        }
        container.quiesce().await?;
        Ok::<_, AppError>((result, duration))
    };
    let forwarding = async {
        while let Some(output) = output_rx.recv().await {
            emit_event(tx, transcript, output).await?;
        }
        Ok::<_, AppError>(())
    };
    let (result, ()) = tokio::try_join!(execution, forwarding)?;
    Ok(result)
}

// Preserve the retrieval error separately from the parser's invalid-input report.
async fn read_report(container: &Container, bundle: &RuntimeBundle, deadline: Instant) -> Vec<u8> {
    match container.read_regular_file("test_detail.xml", deadline).await {
        Ok(bytes) if bytes.len() <= REPORT_FILE_LIMIT => bytes,
        Ok(_) => {
            record(
                "WARN",
                "daycare_report_unavailable",
                format_args!("container={:?} reason=report_size_limit", container.id),
            );
            Vec::new()
        }
        Err(err) => {
            record(
                "WARN",
                "daycare_report_unavailable",
                format_args!(
                    "container={:?} user={:?} problem={:?} step={} error={:?}",
                    container.id,
                    bundle.user_id,
                    bundle.problem_id,
                    bundle.step_number,
                    err.to_string()
                ),
            );
            Vec::new()
        }
    }
}

async fn finalize_action(
    bundle: &mut RuntimeBundle,
    tx: mpsc::Sender<Result<ExecutionUpdate, Status>>,
    transcript: TranscriptCapture,
    report: ReportCard,
) -> AppResult<()> {
    if transcript.discarded_events > 0 {
        record(
            "WARN",
            "daycare_transcript_truncated",
            format_args!(
                "user={:?} problem={:?} step={} action={:?} discarded_events={} discarded_bytes={}",
                bundle.user_id,
                bundle.problem_id,
                bundle.step_number,
                bundle.action,
                transcript.discarded_events,
                transcript.discarded_bytes
            ),
        );
    }
    if let Some(commit) = &mut bundle.commit {
        let mut report = report;
        if let Some(duration) = report.duration {
            report.note.push_str(&format!(
                " in {:.3}s",
                duration.seconds as f64 + f64::from(duration.nanos) / 1_000_000_000.0
            ));
        }
        commit.transcript = transcript.events;
        commit.report_card = Some(report.clone());
        commit.score = if report.passed { 1.0 } else { score_from_report(&report) };
        commit.updated_at = Some(timestamp(Utc::now()));
    }
    tx.send(Ok(ExecutionUpdate::Completed(Box::new(bundle.clone()))))
        .await
        .map_err(|_| AppError::Internal("daycare stream closed".to_owned()))?;
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
    discarded_events: usize,
    discarded_bytes: usize,
}

impl TranscriptCapture {
    fn record(&mut self, event: &EventMessage) {
        let mut event = event.clone();
        if !event.stream_data.is_empty() {
            let remaining = TRANSCRIPT_DATA_LIMIT.saturating_sub(self.stream_bytes);
            self.discarded_bytes += event.stream_data.len().saturating_sub(remaining);
            if remaining == 0 {
                self.discarded_events += 1;
                return;
            }
            event.stream_data.truncate(remaining);
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
            self.events.push(event);
        } else {
            self.discarded_events += 1;
            self.discarded_bytes += event.stream_data.len();
        }
    }
}

async fn emit_event(
    tx: &mpsc::Sender<Result<ExecutionUpdate, Status>>,
    transcript: &mut TranscriptCapture,
    event: EventMessage,
) -> AppResult<()> {
    transcript.record(&event);
    tx.send(Ok(ExecutionUpdate::Event(Box::new(event))))
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
    let passed = report.results.iter().filter(|result| result.outcome == "passed").count();
    passed as f64 / report.results.len() as f64
}

fn parse_xunit(report: &mut ReportCard, xml: &[u8]) {
    let Ok(text) = std::str::from_utf8(xml) else {
        fail_report(report, "error parsing unit test results: not UTF-8".to_owned());
        return;
    };
    let Ok(doc) = roxmltree::Document::parse(text) else {
        fail_report(report, "error parsing unit test results".to_owned());
        return;
    };
    let cases =
        doc.descendants().filter(|node| node.tag_name().name() == "testcase").collect::<Vec<_>>();
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
            matches!(child.tag_name().name(), "failure" | "error" | "skipped" | "disabled")
        });
        let failed =
            failure.is_some() || !matches!(case.attribute("status"), None | Some("" | "run"));
        let details = failure.and_then(|node| node.text()).unwrap_or("").to_owned();
        let context = failure_context(&details);
        report.results.push(ReportCardResult {
            name,
            outcome: if failed { "failed" } else { "passed" }.to_owned(),
            details,
            context,
        });
    }
    let passed = report.results.iter().filter(|result| result.outcome == "passed").count();
    report.passed = passed == report.results.len();
    report.note = format!("Passed {passed}/{} tests", report.results.len());
}

fn parse_check(report: &mut ReportCard, xml: &[u8]) {
    let Ok(text) = std::str::from_utf8(xml) else {
        fail_report(report, "error parsing unit test results: not UTF-8".to_owned());
        return;
    };
    let Ok(doc) = roxmltree::Document::parse(text) else {
        fail_report(report, "error parsing unit test results".to_owned());
        return;
    };
    let cases =
        doc.descendants().filter(|node| node.tag_name().name() == "test").collect::<Vec<_>>();
    if cases.is_empty() {
        fail_report(report, "No unit test results found".to_owned());
        return;
    }
    for case in cases {
        let result = case.attribute("result").unwrap_or("");
        let name = child_text(case, "id").unwrap_or_default();
        let details = child_text(case, "message").unwrap_or_default();
        let function = child_text(case, "fn").unwrap_or_default();
        let outcome = if result == "success" { "passed" } else { "failed" };
        report.results.push(ReportCardResult {
            name,
            outcome: outcome.to_owned(),
            details,
            context: function,
        });
    }
    let passed = report.results.iter().filter(|result| result.outcome == "passed").count();
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
        let line = line.chars().take_while(|ch| ch.is_ascii_digit()).collect::<String>();
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
            let pattern = GlobPattern::new(path.as_bytes());
            for (candidate, content) in all_files {
                if pattern.matches(candidate.as_bytes()) && !files.contains_key(candidate) {
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
    path.as_bytes().iter().any(|byte| matches!(byte, b'*' | b'?' | b'['))
}

enum GlobToken<'a> {
    Literal(u8),
    Any,
    Star,
    Class(&'a [u8]),
}

struct GlobPattern<'a>(Vec<GlobToken<'a>>);

impl<'a> GlobPattern<'a> {
    fn new(mut pattern: &'a [u8]) -> Self {
        let mut tokens = Vec::new();
        let mut closing = pattern.iter().position(|byte| *byte == b']');
        while let Some((&byte, rest)) = pattern.split_first() {
            let token = match byte {
                b'*' => GlobToken::Star,
                b'?' => GlobToken::Any,
                b'[' => {
                    if let Some(end) = closing {
                        tokens.push(GlobToken::Class(&pattern[1..end]));
                        pattern = &pattern[end + 1..];
                        closing = pattern.iter().position(|byte| *byte == b']');
                        continue;
                    }
                    GlobToken::Literal(byte)
                }
                _ => GlobToken::Literal(byte),
            };
            tokens.push(token);
            pattern = rest;
            closing = if byte == b']' {
                pattern.iter().position(|byte| *byte == b']')
            } else {
                closing.and_then(|index| index.checked_sub(1))
            };
        }
        Self(tokens)
    }

    // Two rows bound matching work without recursive backtracking or stack growth.
    fn matches(&self, text: &[u8]) -> bool {
        let mut previous = vec![false; self.0.len() + 1];
        let mut current = previous.clone();
        previous[0] = true;
        for (index, token) in self.0.iter().enumerate() {
            previous[index + 1] = matches!(token, GlobToken::Star) && previous[index];
        }
        for byte in text {
            current[0] = false;
            for (index, token) in self.0.iter().enumerate() {
                current[index + 1] = match token {
                    GlobToken::Star => current[index] || previous[index + 1],
                    GlobToken::Any => previous[index],
                    GlobToken::Literal(value) => previous[index] && value == byte,
                    GlobToken::Class(class) => previous[index] && char_class_matches(class, *byte),
                };
            }
            std::mem::swap(&mut previous, &mut current);
        }
        previous[self.0.len()]
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

fn build_input_tar(files: &BTreeMap<String, Vec<u8>>) -> AppResult<Vec<u8>> {
    let mut archive = tar::Builder::new(Vec::new());
    let mut directories = BTreeSet::new();
    for path in files.keys() {
        let path = checked_relative_path(path)?;
        for directory in path.ancestors().skip(1) {
            if directory.as_os_str().is_empty() {
                break;
            }
            directories.insert(directory.to_owned());
        }
    }
    let mut directories = directories.into_iter().collect::<Vec<_>>();
    directories.sort_by_key(|path| path.components().count());
    for directory in directories {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Directory);
        header.set_mode(STUDENT_DIRECTORY_MODE);
        header.set_uid(STUDENT_UID);
        header.set_gid(STUDENT_GID);
        header.set_size(0);
        header.set_mtime(0);
        header.set_cksum();
        archive.append_data(&mut header, directory, Cursor::new([]))?;
    }
    for (path, content) in files {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Regular);
        header.set_mode(STUDENT_FILE_MODE);
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
    for (index, entry) in archive.entries()?.enumerate() {
        if index >= WORKSPACE_ENTRY_LIMIT {
            return Err(AppError::BadRequest(
                "downloaded workspace has too many entries".to_owned(),
            ));
        }
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
            return Err(AppError::BadRequest("downloaded file data exceeds limit".to_owned()));
        }
        let mut content = Vec::with_capacity(size);
        entry.read_to_end(&mut content)?;
        files.insert(path, content);
    }
    Ok(files)
}

fn normalized_tar_path<R: std::io::Read>(entry: &tar::Entry<'_, R>) -> AppResult<String> {
    let path = entry.path()?;
    if path.as_os_str().len() > WORKSPACE_PATH_LIMIT {
        return Err(AppError::BadRequest("downloaded workspace path is too long".to_owned()));
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err(AppError::BadRequest(format!("bad output path {:?}", path.display())));
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
    files: OnceCell<BTreeMap<String, Vec<u8>>>,
    stopped: OnceCell<()>,
}

// Docker's state document is decoded without retaining unrelated inspection data.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ContainerState {
    status: String,
    exit_code: i32,
    #[serde(rename = "OOMKilled")]
    oom_killed: bool,
    error: String,
    pid: u64,
}

impl Container {
    fn new(command: Arc<Vec<String>>, id: String) -> Self {
        Self { command, id, files: OnceCell::new(), stopped: OnceCell::new() }
    }

    // Inspect only selected state fields; environment and workspace contents stay private.
    async fn log_usage(&self, context: &RunContext, command_exit: i32) {
        let args = vec![
            "inspect".to_owned(),
            "--format".to_owned(),
            "{{json .State}}".to_owned(),
            self.id.clone(),
        ];
        let result =
            run_command(&self.command, &args, Instant::now() + Duration::from_secs(2)).await;
        match result {
            Ok(result) if result.status == 0 => {
                match serde_json::from_slice::<ContainerState>(&result.stdout) {
                    Ok(state) => {
                        let state_fields = format!(
                            "container={:?} command_exit={command_exit} status={:?} container_exit={} oom_killed={} error={:?}",
                            self.id, state.status, state.exit_code, state.oom_killed, state.error
                        );
                        let pid = state.pid;
                        let usage = tokio::task::spawn_blocking(move || collect_usage(pid)).await;
                        match usage {
                            Ok(Ok(usage)) => context.log(
                                "INFO",
                                "daycare_usage",
                                format_args!("{state_fields} {usage}"),
                            ),
                            other => context.log(
                                "WARN",
                                "daycare_usage_unavailable",
                                format_args!("{state_fields} error={other:?}"),
                            ),
                        }
                    }
                    Err(err) => {
                        context.log("WARN", "daycare_inspect_failed", format_args!("error={err:?}"))
                    }
                }
            }
            Ok(result) => context.log(
                "WARN",
                "daycare_inspect_failed",
                format_args!("exit={}", result.status),
            ),
            Err(err) => context.log(
                "WARN",
                "daycare_inspect_failed",
                format_args!("error={:?}", err.to_string()),
            ),
        }
    }

    async fn create(
        command: &Arc<Vec<String>>,
        identity: &str,
        name: &str,
        bundle: &RuntimeBundle,
        limits: &RuntimeLimits,
        deadline: Instant,
    ) -> AppResult<Self> {
        let memory = format!("{}m", limits.max_memory);
        let disk_bytes = limits.max_file_size.checked_mul(1024 * 1024).ok_or_else(|| {
            AppError::BadRequest("runtime file size limit is too large".to_owned())
        })?;
        let docker_args = vec![
            "create".to_owned(),
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
            format!("codegrinder.run={identity}"),
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
            "--ulimit".to_owned(),
            "nproc=-1:-1".to_owned(),
            bundle.container.clone(),
            "/bin/sleep".to_owned(),
            format!(
                "{}s",
                deadline.saturating_duration_since(Instant::now()).as_secs().saturating_add(5)
            ),
        ];
        let creation =
            run_command_inner(command, &docker_args, None, None, COMMAND_OUTPUT_LIMIT, None);
        tokio::pin!(creation);
        let result = tokio::select! {
            result = &mut creation => result,
            _ = tokio::time::sleep_until(deadline.into()) => {
                record("ERROR", "daycare_creation_quarantined", format_args!("container={name:?} run={identity:?}"));
                creation.await
            }
        }?;
        if result.status != 0 {
            return Err(AppError::Internal(format!(
                "container create failed: exit={}; output={}",
                result.status,
                String::from_utf8_lossy(&[result.stdout, result.stderr].concat())
            )));
        }
        let id = String::from_utf8_lossy(&result.stdout).trim().to_owned();
        if id.is_empty() {
            return Err(AppError::Internal(
                "container create failed: empty container ID".to_owned(),
            ));
        }
        Ok(Self::new(command.clone(), id))
    }

    async fn start(&self, deadline: Instant) -> AppResult<()> {
        let result =
            run_command(&self.command, &["start".to_owned(), self.id.clone()], deadline).await?;
        if result.status != 0 {
            return Err(AppError::Internal(format!(
                "container start failed: container={} exit={}",
                self.id, result.status
            )));
        }
        Ok(())
    }

    async fn put_files(
        &self,
        files: &BTreeMap<String, Vec<u8>>,
        deadline: Instant,
    ) -> AppResult<()> {
        if files.is_empty() {
            return Ok(());
        }
        let tar = build_input_tar(files)?;
        let args = vec![
            "cp".to_owned(),
            "--archive".to_owned(),
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
            AppError::BadRequest(format!("output file {path} was not produced by the container"))
        })
    }

    async fn download_files(
        &self,
        raw_paths: &str,
        deadline: Instant,
    ) -> AppResult<BTreeMap<String, Vec<u8>>> {
        let files = self.copy_student_files(deadline).await?;
        Ok(select_download_files(files, raw_paths))
    }

    async fn copy_student_files(&self, deadline: Instant) -> AppResult<&BTreeMap<String, Vec<u8>>> {
        // Reports and downloads share one immutable post-execution workspace snapshot.
        self.files.get_or_try_init(|| self.fetch_student_files(deadline)).await
    }

    async fn fetch_student_files(&self, deadline: Instant) -> AppResult<BTreeMap<String, Vec<u8>>> {
        let args = vec!["cp".to_owned(), format!("{}:/home/student/.", self.id), "-".to_owned()];
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

    async fn exec(
        &self,
        cmd: &[String],
        deadline: Instant,
        output: mpsc::Sender<EventMessage>,
    ) -> ExecutionOutcome {
        let mut args =
            vec!["exec".to_owned(), "--user".to_owned(), container_user(), self.id.clone()];
        args.extend(cmd.iter().cloned());
        match run_command_inner(
            &self.command,
            &args,
            None,
            Some(deadline),
            COMMAND_OUTPUT_LIMIT,
            Some(output),
        )
        .await
        {
            Ok(result) => ExecutionOutcome::Exited(result),
            Err(AppError::DeadlineExceeded(_)) => ExecutionOutcome::TimedOut,
            Err(err) => ExecutionOutcome::Failed(err),
        }
    }

    async fn quiesce(&self) -> AppResult<()> {
        self.stopped.get_or_try_init(|| self.confirm_stopped()).await.map(|_| ())
    }

    async fn confirm_stopped(&self) -> AppResult<()> {
        self.stop().await?;
        let result = run_command(
            &self.command,
            &[
                "inspect".to_owned(),
                "--format".to_owned(),
                "{{.State.Running}}".to_owned(),
                self.id.clone(),
            ],
            Instant::now() + ENGINE_STOP_TIMEOUT,
        )
        .await?;
        if result.status != 0 || result.stdout != b"false\n" {
            return Err(AppError::Internal(format!(
                "could not confirm container {} stopped",
                self.id
            )));
        }
        Ok(())
    }

    async fn shutdown(&self) -> AppResult<()> {
        let stop = if self.stopped.get().is_some() { Ok(()) } else { self.stop().await };
        // Forced removal always receives its own budget, including after a stalled stop.
        let removal = run_command(
            &self.command,
            &["rm".to_owned(), "-f".to_owned(), self.id.clone()],
            Instant::now() + ENGINE_REMOVE_TIMEOUT,
        )
        .await?;
        if removal.status != 0 {
            let absence = container_absent(&self.command, &self.id).await;
            if !matches!(absence, Ok(true)) {
                return Err(AppError::Internal(format!(
                    "container removal failed: container={} exit={} absence={absence:?}",
                    self.id, removal.status
                )));
            }
        }
        if let Err(err) = stop {
            record(
                "WARN",
                "daycare_stop_failed",
                format_args!("container={:?} error={:?}", self.id, err.to_string()),
            );
        }
        Ok(())
    }

    async fn stop(&self) -> AppResult<()> {
        let result = run_command(
            &self.command,
            &["stop".to_owned(), "--time".to_owned(), "1".to_owned(), self.id.clone()],
            Instant::now() + ENGINE_STOP_TIMEOUT,
        )
        .await?;
        if result.status != 0 {
            return Err(AppError::Internal(format!(
                "container stop failed: container={} exit={}",
                self.id, result.status
            )));
        }
        Ok(())
    }

    async fn reconcile(&self, context: &RunContext) {
        let mut delay = Duration::from_secs(1);
        loop {
            match self.shutdown().await {
                Ok(()) => {
                    return;
                }
                Err(err) => context.log(
                    "ERROR",
                    "daycare_cleanup_quarantined",
                    format_args!("container={:?} error={:?}", self.id, err.to_string()),
                ),
            }
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(Duration::from_secs(30));
        }
    }
}

// Cgroup v2 counters belong to the container and must be sampled before removal.
fn collect_usage(pid: u64) -> Result<String, std::io::Error> {
    let membership = std::fs::read_to_string(format!("/proc/{pid}/cgroup"))?;
    let relative = membership
        .lines()
        .find_map(|line| line.strip_prefix("0::"))
        .ok_or_else(|| std::io::Error::other("cgroup v2 membership unavailable"))?;
    let root = std::path::Path::new("/sys/fs/cgroup").join(relative.trim_start_matches('/'));
    Ok(read_usage(&root))
}

fn read_usage(root: &std::path::Path) -> String {
    let mut fields = Vec::new();
    for name in ["cpu.stat", "memory.peak", "pids.peak", "memory.events"] {
        match std::fs::read_to_string(root.join(name)) {
            Ok(value) => fields.push(format!(
                "{}={:?}",
                name.replace('.', "_"),
                value.split_whitespace().collect::<Vec<_>>().join(" ")
            )),
            Err(err) => fields.push(format!(
                "{}=unavailable error={:?}",
                name.replace('.', "_"),
                err.to_string()
            )),
        }
    }
    fields.join(" ")
}

fn container_user() -> String {
    format!("{STUDENT_UID}:{STUDENT_GID}")
}

async fn check_image(command: &Arc<Vec<String>>, image: &str, deadline: Instant) -> AppResult<()> {
    let result = run_command(
        command,
        &[
            "image".to_owned(),
            "inspect".to_owned(),
            "--format".to_owned(),
            "{{.Id}}".to_owned(),
            image.to_owned(),
        ],
        deadline,
    )
    .await?;
    if result.status != 0 {
        return Err(AppError::Internal(format!("container image is unavailable: {image}")));
    }
    Ok(())
}

struct ListedContainer {
    id: String,
    name: String,
}

async fn list_containers(
    command: &Arc<Vec<String>>,
    filter: &str,
) -> AppResult<Vec<ListedContainer>> {
    let result = run_command(
        command,
        &[
            "ps".to_owned(),
            "--all".to_owned(),
            "--no-trunc".to_owned(),
            "--filter".to_owned(),
            filter.to_owned(),
            "--format".to_owned(),
            "{{.ID}} {{.Names}}".to_owned(),
        ],
        Instant::now() + ENGINE_REMOVE_TIMEOUT,
    )
    .await?;
    if result.status != 0 {
        return Err(AppError::Internal(format!(
            "container listing failed: exit={}",
            result.status
        )));
    }
    let text =
        String::from_utf8(result.stdout).map_err(|err| AppError::Internal(err.to_string()))?;
    text.lines()
        .map(|line| {
            let mut fields = line.split_whitespace();
            match (fields.next(), fields.next(), fields.next()) {
                (Some(id), Some(name), None) => {
                    Ok(ListedContainer { id: id.to_owned(), name: name.to_owned() })
                }
                _ => Err(AppError::Internal("invalid container listing".to_owned())),
            }
        })
        .collect()
}

async fn container_absent(command: &Arc<Vec<String>>, id: &str) -> AppResult<bool> {
    let listing = list_containers(command, &format!("id={id}")).await?;
    Ok(!listing.iter().any(|container| container.id == id))
}

// A failed create may still finish in Docker. Absence alone cannot resolve that case.
async fn reconcile_named_container(
    command: &Arc<Vec<String>>,
    name: &str,
    unresolved: Option<&str>,
    context: &RunContext,
) {
    let filter = unresolved.map_or_else(
        || format!("label={DAYCARE_CONTAINER_LABEL}"),
        |identity| format!("label=codegrinder.run={identity}"),
    );
    let mut delay = Duration::from_secs(1);
    loop {
        match list_containers(command, &filter).await {
            Ok(listing) => {
                if let Some(found) = listing.into_iter().find(|container| container.name == name) {
                    let container = Container::new(command.clone(), found.id);
                    container.reconcile(context).await;
                    return;
                }
                if unresolved.is_none() {
                    return;
                }
                context.log(
                    "ERROR",
                    "daycare_creation_quarantined",
                    format_args!("container={name:?} reason=creation_outcome_unknown"),
                );
            }
            Err(err) => context.log(
                "ERROR",
                "daycare_recovery_quarantined",
                format_args!("container={name:?} error={:?}", err.to_string()),
            ),
        }
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(Duration::from_secs(30));
    }
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
    run_command_inner(command, args, None, Some(deadline), output_limit, None).await
}

async fn run_command_with_input(
    command: &Arc<Vec<String>>,
    args: &[String],
    input: Vec<u8>,
    deadline: Instant,
) -> AppResult<CommandResult> {
    run_command_inner(command, args, Some(input), Some(deadline), COMMAND_OUTPUT_LIMIT, None).await
}

async fn run_command_inner(
    command: &Arc<Vec<String>>,
    args: &[String],
    input: Option<Vec<u8>>,
    deadline: Option<Instant>,
    output_limit: usize,
    events: Option<mpsc::Sender<EventMessage>>,
) -> AppResult<CommandResult> {
    let mut cmd = Command::new(&command[0]);
    cmd.args(command.iter().skip(1))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn()?;
    let stdin = child.stdin.take();
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");
    // Own all pipe work in this future so cancellation leaves no detached readers.
    let work = async {
        let write_input = async {
            if let (Some(mut stdin), Some(input)) = (stdin, input) {
                stdin.write_all(&input).await?;
                stdin.shutdown().await?;
            }
            Ok::<_, AppError>(())
        };
        let (status, stdout, stderr, ()) = tokio::try_join!(
            async { child.wait().await.map_err(AppError::from) },
            read_output(&mut stdout, output_limit, "stdout", events.clone()),
            read_output(&mut stderr, COMMAND_OUTPUT_LIMIT, "stderr", events),
            write_input,
        )?;
        Ok(CommandResult { status: status.code().unwrap_or(128), stdout, stderr })
    };
    let Some(deadline) = deadline else {
        return work.await;
    };
    match tokio::time::timeout_at(deadline.into(), work).await {
        Ok(result) => result,
        Err(_) => {
            let _ = tokio::time::timeout(Duration::from_secs(1), child.kill()).await;
            Err(AppError::DeadlineExceeded("command timed out".to_owned()))
        }
    }
}

async fn read_output<R: AsyncReadExt + Unpin>(
    reader: &mut R,
    limit: usize,
    stream: &str,
    events: Option<mpsc::Sender<EventMessage>>,
) -> AppResult<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = [0_u8; 8192];
    let mut truncated = false;
    let mut discarded = 0usize;
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            if truncated {
                out.extend_from_slice(COMMAND_OUTPUT_TRUNCATED);
                record(
                    "WARN",
                    "daycare_output_truncated",
                    format_args!("limit_bytes={limit} discarded_bytes={discarded}"),
                );
            }
            return Ok(out);
        }
        // Live output is independent of the bounded command and transcript buffers.
        if let Some(events) = &events {
            events
                .send(event(
                    stream,
                    Vec::new(),
                    0,
                    buf[..n].to_vec(),
                    String::new(),
                    BTreeMap::new(),
                ))
                .await
                .map_err(|_| AppError::Internal("output stream closed".to_owned()))?;
        }
        let remaining = limit.saturating_sub(out.len());
        out.extend_from_slice(&buf[..n.min(remaining)]);
        if n > remaining {
            truncated = true;
            discarded += n - remaining;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use chrono::{Duration as ChronoDuration, Utc};
    use tokio_stream::StreamExt;

    use super::*;
    use crate::config::{IpFilterConfig, ServerConfig};
    use crate::proto::{AssignmentKey, Commit, RuntimeLimits};
    use crate::signatures::{decode_signed_runtime_bundle, encode_signed_runtime_bundle};

    #[test]
    fn download_globs_preserve_byte_and_class_semantics_without_backtracking() {
        for (pattern, text, expected) in [
            ("*", "nested/file", true),
            ("a?c", "abc", true),
            ("a?c", "ac", false),
            ("[a-c][!0-9]", "bX", true),
            ("[^a]", "a", false),
            ("[", "[", true),
            ("[]", "a", false),
            ("[!]", "a", true),
            ("?", "é", false),
            ("??", "é", true),
            ("**", "", true),
            ("*a*b", "ab/ab", true),
        ] {
            assert_eq!(
                GlobPattern::new(pattern.as_bytes()).matches(text.as_bytes()),
                expected,
                "{pattern:?} {text:?}"
            );
        }
        let pattern = format!("{}b", "*a".repeat(80));
        assert!(!GlobPattern::new(pattern.as_bytes()).matches(&vec![b'a'; 4096]));
    }

    #[test]
    fn workspace_snapshot_bounds_entry_count_and_path_length() {
        let entries = vec![("empty", b"".as_slice()); WORKSPACE_ENTRY_LIMIT + 1];
        assert!(
            read_output_tar(&output_tar(&entries))
                .unwrap_err()
                .to_string()
                .contains("too many entries")
        );
        let long_path = "a/".repeat(WORKSPACE_PATH_LIMIT / 2 + 1);
        assert!(
            read_output_tar(&output_tar(&[(&long_path, b"")]))
                .unwrap_err()
                .to_string()
                .contains("too long")
        );
    }

    #[tokio::test]
    async fn stalled_stop_leaves_a_fresh_opportunity_for_forced_removal() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
case "$1" in
  stop) exec sleep 30 ;;
  rm) touch removed ;;
esac
"#,
        );
        let container =
            Container::new(Arc::new(vec![engine.display().to_string()]), "known-id".to_owned());
        tokio::time::timeout(Duration::from_secs(4), container.shutdown()).await.unwrap().unwrap();
        assert!(dir.path().join("removed").exists());
    }

    #[tokio::test]
    async fn slow_output_receiver_does_not_suspend_execution_timeout_or_stop() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
case "$1" in
  exec) exec yes output ;;
  stop) touch stopped ;;
  inspect) echo false ;;
esac
"#,
        );
        let container =
            Container::new(Arc::new(vec![engine.display().to_string()]), "known-id".to_owned());
        let config = test_config(dir.path());
        let bundle =
            decode_signed_runtime_bundle(&signed_runtime(&config, |_| {}), &config.daycare_secret)
                .unwrap();
        let context = RunContext::new(1, &bundle);
        let (tx, mut rx) = mpsc::channel(1);
        let worker = tokio::spawn(async move {
            let mut transcript = TranscriptCapture::default();
            execute_with_output(
                &container,
                &["command".to_owned()],
                &context,
                Instant::now() + Duration::from_millis(100),
                &tx,
                &mut transcript,
            )
            .await
        });
        wait_for_file(&dir.path().join("stopped")).await;
        assert!(!worker.is_finished(), "the connected client is still blocking event delivery");
        while rx.recv().await.is_some() {}
        assert!(matches!(worker.await.unwrap().unwrap().0, ExecutionOutcome::TimedOut));
    }

    #[tokio::test]
    async fn replacements_wait_for_creation_and_cleanup_even_if_pending_request_disconnects() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
case "$1" in
  create)
    touch creating
    while [ ! -e release-create ] && [ -e fake-engine.sh ]; do sleep 0.01; done
    echo known-id ;;
  inspect) echo false ;;
  cp) cat >/dev/null ;;
esac
"#,
        );
        let mut config = test_config(dir.path());
        config.capacity = 2;
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let request = DaycareRequest { bundle: Some(signed_runtime(&config, |_| {})) };
        let mut old = runtime
            .run(request.clone(), Some(Instant::now() + Duration::from_millis(100)))
            .await
            .unwrap()
            .into_inner();
        wait_for_file(&dir.path().join("creating")).await;
        let status = tokio::time::timeout(Duration::from_secs(1), old.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert_eq!(status.code(), tonic::Code::DeadlineExceeded);
        assert!(old.next().await.is_none());
        drop(old);
        let pending = runtime.run(request.clone(), None).await.unwrap();
        tokio::task::yield_now().await;
        drop(pending);
        wait_for_idle(&runtime).await;
        let mut newest = runtime.run(request, None).await.unwrap().into_inner();
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert_eq!(runtime.container_slots.available_permits(), 1);
        assert_eq!(
            fs::read_to_string(dir.path().join("engine.log"))
                .unwrap()
                .lines()
                .filter(|line| line.starts_with("create "))
                .count(),
            1
        );
        fs::write(dir.path().join("release-create"), b"").unwrap();
        expect_grade(&mut newest).await;
        wait_for_idle(&runtime).await;
        let log = fs::read_to_string(dir.path().join("engine.log")).unwrap();
        assert!(log.find("rm -f known-id").unwrap() < log.rfind("create ").unwrap());
        assert!(!log.contains("rm -f nanny-"));
        assert_eq!(runtime.container_slots.available_permits(), 2);
    }

    #[tokio::test]
    async fn failed_cli_with_late_daemon_creation_remains_owned_until_removed() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
case "$1" in
  create)
    if [ ! -e attempted ]; then
      touch attempted
      (while [ ! -e release-daemon ] && [ -e fake-engine.sh ]; do sleep 0.01; done; touch late-created) </dev/null >/dev/null 2>&1 &
      exit 1
    fi
    echo newest-id ;;
  ps) if [ -e late-created ]; then echo 'late-id nanny-student'; fi ;;
  rm) if [ "$3" = late-id ]; then rm -f late-created; touch late-removed; fi ;;
  inspect) echo false ;;
  cp) cat >/dev/null ;;
esac
"#,
        );
        let mut config = test_config(dir.path());
        config.capacity = 2;
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let request = DaycareRequest { bundle: Some(signed_runtime(&config, |_| {})) };
        let old = runtime.run(request.clone(), None).await.unwrap();
        wait_for_file(&dir.path().join("attempted")).await;
        drop(old);
        let mut newest = runtime.run(request, None).await.unwrap().into_inner();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(runtime.container_slots.available_permits(), 1);
        assert_eq!(
            fs::read_to_string(dir.path().join("engine.log"))
                .unwrap()
                .lines()
                .filter(|line| line.starts_with("create "))
                .count(),
            1
        );
        fs::write(dir.path().join("release-daemon"), b"").unwrap();
        expect_grade(&mut newest).await;
        wait_for_idle(&runtime).await;
        let log = fs::read_to_string(dir.path().join("engine.log")).unwrap();
        assert!(log.find("rm -f late-id").unwrap() < log.rfind("create ").unwrap());
        assert!(dir.path().join("late-removed").exists());
    }

    #[tokio::test]
    async fn removal_failure_retains_capacity_after_the_grade_is_delivered() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
case "$1" in
  create) touch created; echo known-id ;;
  inspect) echo false ;;
  cp) cat >/dev/null ;;
  ps) if [ -e created ]; then echo 'known-id nanny-student'; fi ;;
  rm)
    touch removal-attempted
    if [ ! -e allow-removal ]; then exit 1; fi
    rm -f created ;;
esac
"#,
        );
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let mut stream = runtime
            .run(DaycareRequest { bundle: Some(signed_runtime(&config, |_| {})) }, None)
            .await
            .unwrap()
            .into_inner();
        expect_grade(&mut stream).await;
        drop(stream);
        wait_for_file(&dir.path().join("removal-attempted")).await;
        assert_eq!(runtime.container_slots.available_permits(), 0);
        let mut queued = runtime
            .run(
                DaycareRequest {
                    bundle: Some(signed_runtime(&config, |bundle| {
                        bundle.user_id = "another-student".to_owned()
                    })),
                },
                None,
            )
            .await
            .unwrap()
            .into_inner();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            fs::read_to_string(dir.path().join("engine.log"))
                .unwrap()
                .lines()
                .filter(|line| line.starts_with("create "))
                .count(),
            1
        );
        fs::write(dir.path().join("allow-removal"), b"").unwrap();
        expect_grade(&mut queued).await;
        wait_for_idle(&runtime).await;
        assert_eq!(runtime.container_slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn unconfirmed_stop_prevents_report_extraction_and_signing() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
case "$1" in
  create) echo known-id ;;
  inspect) echo true ;;
  cp) cat >/dev/null ;;
esac
"#,
        );
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let mut stream = runtime
            .run(
                DaycareRequest {
                    bundle: Some(signed_runtime(&config, |bundle| {
                        bundle.parser = "xunit".to_owned()
                    })),
                },
                None,
            )
            .await
            .unwrap()
            .into_inner();
        let mut error = false;
        while let Some(response) = stream.next().await {
            match response.unwrap().response.unwrap() {
                daycare_response::Response::Error(message) => {
                    assert!(message.contains("could not confirm"));
                    error = true;
                }
                daycare_response::Response::Bundle(_) => {
                    panic!("signed a result from a live workspace")
                }
                _ => {}
            }
        }
        assert!(error);
        let log = fs::read_to_string(dir.path().join("engine.log")).unwrap();
        assert!(!log.contains("cp known-id:/home/student/."));
        assert!(log.contains("rm -f known-id"));
    }

    #[tokio::test]
    async fn missing_image_fails_before_creation_without_quarantining_capacity() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
case "$1" in
  image) exit 1 ;;
esac
"#,
        );
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let mut stream = runtime
            .run(DaycareRequest { bundle: Some(signed_runtime(&config, |_| {})) }, None)
            .await
            .unwrap()
            .into_inner();
        let message = stream.next().await.unwrap().unwrap();
        assert!(
            matches!(message.response, Some(daycare_response::Response::Error(error)) if error.contains("image is unavailable"))
        );
        assert!(stream.next().await.is_none());
        assert_eq!(runtime.container_slots.available_permits(), 1);
        assert!(!fs::read_to_string(dir.path().join("engine.log")).unwrap().contains("create "));
    }

    #[tokio::test]
    async fn failed_removal_of_an_already_absent_container_is_confirmed_by_listing() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
case "$1" in
  stop|rm) exit 1 ;;
esac
"#,
        );
        let container =
            Container::new(Arc::new(vec![engine.display().to_string()]), "missing-id".to_owned());
        container.shutdown().await.unwrap();
        assert!(
            fs::read_to_string(dir.path().join("engine.log"))
                .unwrap()
                .contains("ps --all --no-trunc --filter id=missing-id")
        );
    }

    // Engine fixtures coordinate CLI completion separately from daemon-visible state.
    fn scripted_engine(base: &Path, body: &str) -> PathBuf {
        let engine = fake_engine(base);
        fs::write(&engine, format!("#!/bin/sh\ncd \"$(dirname \"$0\")\" || exit 1\nprintf '%s\\n' \"$*\" >> engine.log\n{body}\nexit 0\n")).unwrap();
        engine
    }

    async fn wait_for_file(path: &Path) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !path.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }

    async fn expect_grade(stream: &mut DaycareStream) {
        tokio::time::timeout(Duration::from_secs(4), async {
            while let Some(response) = stream.next().await {
                match response.unwrap().response.unwrap() {
                    daycare_response::Response::Bundle(_) => return,
                    daycare_response::Response::Error(message) => panic!("{message}"),
                    _ => {}
                }
            }
            panic!("grade stream ended without a bundle");
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    #[ignore = "requires Docker and an installed Python daycare image"]
    async fn docker_background_writer_is_stopped_before_snapshot_and_container_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let engine = scripted_engine(
            dir.path(),
            r#"
if [ "$1" = cp ] && [ "$2" != --archive ]; then
  id=${2%%:*}
  running=$(docker inspect --format '{{.State.Running}}' "$id") || exit 1
  printf 'snapshot-running=%s\n' "$running" >> engine.log
fi
exec docker "$@"
"#,
        );
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let user = format!("daycare-test-{:032x}", rand::random::<u128>());
        let signed = signed_runtime(&config, |bundle| {
            bundle.user_id = user.clone();
            bundle.container = std::env::var("CODEGRINDER_TEST_IMAGE")
                .unwrap_or_else(|_| "codegrinder/python:latest".to_owned());
            bundle.command = "python3 run.py".to_owned();
            bundle.parser = "check".to_owned();
            bundle.problem_options = vec!["download=artifact.txt".to_owned()];
            bundle.limits = Some(RuntimeLimits {
                max_cpu: 2,
                max_fd: 64,
                max_file_size: 10,
                max_memory: 128,
                max_threads: 16,
            });
            bundle.files = BTreeMap::from([("run.py".to_owned(), br#"import os
import subprocess
import sys
import time

# The detached writer closes execution pipes and outlives the command process.
writer = "import time\nf = open('artifact.txt', 'a')\nwhile True:\n f.write('x'); f.flush(); time.sleep(0.01)\n"
subprocess.Popen([sys.executable, '-c', writer], stdin=subprocess.DEVNULL,
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
for attempt in range(100):
    if os.path.exists('artifact.txt') and os.path.getsize('artifact.txt'):
        break
    time.sleep(0.01)
else:
    sys.exit(1)
with open('test_detail.xml', 'w') as report:
    report.write('<suite><test result="success"><id>writer started</id></test></suite>')
print('writer started')
"#.to_vec())]);
        });
        let mut stream = runtime
            .run(
                DaycareRequest { bundle: Some(signed) },
                Some(Instant::now() + Duration::from_secs(30)),
            )
            .await
            .unwrap()
            .into_inner();
        let mut final_bundle = None;
        let mut errors = Vec::new();
        let mut artifact = None;
        while let Some(response) = stream.next().await {
            match response.unwrap().response.unwrap() {
                daycare_response::Response::Bundle(bundle) => final_bundle = Some(bundle),
                daycare_response::Response::Error(error) => errors.push(error),
                daycare_response::Response::Event(event) => {
                    if let Some(content) = event.files.get("artifact.txt") {
                        artifact = Some(content.clone());
                    }
                }
            }
        }
        // Stream exhaustion follows cleanup, so assertions cannot strand a running writer.
        assert!(errors.is_empty(), "{errors:?}");
        let bundle =
            decode_signed_runtime_bundle(&final_bundle.unwrap(), &config.daycare_secret).unwrap();
        assert!(bundle.commit.unwrap().report_card.unwrap().passed);
        assert!(artifact.is_some_and(|content| !content.is_empty()));
        let log = fs::read_to_string(dir.path().join("engine.log")).unwrap();
        assert!(log.contains("snapshot-running=false"));
        assert!(!log.contains("snapshot-running=true"));
        assert!(
            list_containers(
                &Arc::new(vec!["docker".to_owned()]),
                &format!("label=codegrinder.user_id={user}")
            )
            .await
            .unwrap()
            .is_empty()
        );
    }

    #[test]
    fn usage_preserves_counters_and_reports_unavailable_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("cpu.stat"), "usage_usec 123\nuser_usec 100\nsystem_usec 23\n")
            .unwrap();
        fs::write(dir.path().join("memory.peak"), "4096\n").unwrap();
        let usage = read_usage(dir.path());
        assert!(usage.contains("usage_usec 123 user_usec 100 system_usec 23"));
        assert!(usage.contains("memory_peak=\"4096\""));
        assert!(usage.contains("pids_peak=unavailable"));
        assert!(usage.contains("memory_events=unavailable"));
    }

    #[tokio::test]
    async fn cleanup_reports_nonzero_container_engine_status() {
        let container =
            Container::new(Arc::new(vec!["false".to_owned()]), "test-container".to_owned());
        let error = container.shutdown().await.unwrap_err();
        assert!(error.to_string().contains("container removal failed"));
    }

    #[tokio::test]
    async fn superseded_cleanup_preserves_new_run_identity() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = DaycareRuntime::new(Arc::new(test_config(dir.path()))).unwrap();
        runtime.mark_active("nanny-student", 1).await;
        runtime.mark_active("nanny-student", 2).await;
        runtime.clear_active("nanny-student", 1).await;
        assert!(runtime.require_active("nanny-student", 1).await.is_err());
        assert!(runtime.require_active("nanny-student", 2).await.is_ok());
    }

    #[tokio::test]
    async fn expired_command_deadline_reports_timeout() {
        let command = Arc::new(vec!["sleep".to_owned()]);
        let result = run_command(&command, &["2".to_owned()], Instant::now()).await;
        assert!(result.err().unwrap().to_string().contains("timed out"));
    }

    #[tokio::test]
    async fn command_deadline_covers_a_blocked_stdin_writer() {
        let command = Arc::new(vec!["sleep".to_owned()]);
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            run_command_with_input(
                &command,
                &["30".to_owned()],
                vec![0; 1_000_000],
                Instant::now() + Duration::from_millis(50),
            ),
        )
        .await
        .unwrap();
        assert!(result.err().unwrap().to_string().contains("timed out"));
    }

    #[tokio::test]
    async fn command_timeout_keeps_streamed_diagnostics_in_the_failing_grade() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_engine(dir.path());
        fs::write(
            &engine,
            fs::read_to_string(&engine)
                .unwrap()
                .replace("exec) exit 0 ;;", "exec) printf 'before timeout\\n'; exec sleep 30 ;;"),
        )
        .unwrap();
        let config = test_config(dir.path());
        let mut bundle =
            decode_signed_runtime_bundle(&signed_runtime(&config, |_| {}), &config.daycare_secret)
                .unwrap();
        let container = Container::new(
            Arc::new(vec![engine.display().to_string()]),
            "test-container".to_owned(),
        );
        let (events, mut receiver) = mpsc::channel(64);
        let spec = ExecutionSpec::new(&bundle).unwrap();
        let context = RunContext::new(1, &bundle);
        run_action(
            &container,
            &mut bundle,
            &spec,
            &context,
            Instant::now() + Duration::from_millis(100),
            events,
        )
        .await
        .unwrap();
        assert!(
            bundle
                .commit
                .as_ref()
                .unwrap()
                .transcript
                .iter()
                .any(|event| event.stream_data == b"before timeout\n")
        );
        let report = bundle.commit.as_ref().unwrap().report_card.as_ref().unwrap();
        assert!(!report.passed);
        assert!(report.note.contains("timed out"));
        assert!(
            bundle
                .commit
                .as_ref()
                .unwrap()
                .transcript
                .iter()
                .any(|event| { event.event == "error" && event.error.contains("timed out") })
        );
        let mut completed = false;
        while let Some(response) = receiver.recv().await {
            if matches!(response.unwrap(), ExecutionUpdate::Completed(_)) {
                completed = true;
            }
        }
        assert!(completed);
    }

    #[tokio::test]
    async fn queued_disconnect_and_deadline_release_request_state_without_starting_a_container() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.container_engine = fake_engine(dir.path()).display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let slot = runtime.container_slots.acquire().await.unwrap();

        // A disconnected queued request must disappear while capacity remains occupied.
        let signed = signed_runtime(&config, |_| {});
        let stream = runtime.run(DaycareRequest { bundle: Some(signed) }, None).await.unwrap();
        wait_for_active(&runtime).await;
        drop(stream);
        wait_for_idle(&runtime).await;

        // The same queue observes the client's absolute deadline without needing output.
        let signed = signed_runtime(&config, |_| {});
        let mut stream = runtime
            .run(
                DaycareRequest { bundle: Some(signed) },
                Some(Instant::now() + Duration::from_millis(50)),
            )
            .await
            .unwrap()
            .into_inner();
        tokio::time::timeout(Duration::from_secs(2), async {
            while stream.next().await.is_some() {}
        })
        .await
        .unwrap();
        wait_for_idle(&runtime).await;
        drop(slot);
        assert!(!dir.path().join("engine.log").exists());
    }

    #[tokio::test]
    async fn live_output_precedes_command_completion_and_disconnect_releases_capacity() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_engine(dir.path());
        let script = fs::read_to_string(&engine)
            .unwrap()
            .replace("exec) exit 0 ;;", "exec) printf 'working\\n'; exec sleep 30 ;;");
        fs::write(&engine, script).unwrap();
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let signed = signed_runtime(&config, |_| {});
        let mut stream =
            runtime.run(DaycareRequest { bundle: Some(signed) }, None).await.unwrap().into_inner();

        // This output must arrive while the fake student command is still sleeping.
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Some(daycare_response::Response::Event(event)) =
                    stream.next().await.unwrap().unwrap().response
                    && event.event == "stdout"
                {
                    assert_eq!(event.stream_data, b"working\n");
                    break;
                }
            }
        })
        .await
        .unwrap();
        drop(stream);
        wait_for_idle(&runtime).await;
        assert_eq!(runtime.container_slots.available_permits(), 1);
        assert!(
            fs::read_to_string(dir.path().join("engine.log"))
                .unwrap()
                .contains("rm -f fake-container")
        );
    }

    #[tokio::test]
    async fn replacement_cancels_a_waiting_request_before_capacity_is_available() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = DaycareRuntime::new(Arc::new(test_config(dir.path()))).unwrap();
        let (events, _receiver) = mpsc::channel(1);
        let stop = runtime.mark_active("nanny-student", 1).await;
        let scope =
            RequestScope { deadline: Instant::now() + Duration::from_secs(30), stop, events };
        let _replacement = runtime.mark_active("nanny-student", 2).await;
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            scope.run(std::future::pending::<AppResult<()>>()),
        )
        .await
        .unwrap();
        assert!(result.unwrap_err().to_string().contains("superseded"));
    }

    #[tokio::test]
    async fn replacement_releases_the_running_container_slot_for_the_new_request() {
        let dir = tempfile::tempdir().unwrap();
        let engine = fake_engine(dir.path());
        let script = fs::read_to_string(&engine).unwrap().replace(
            "exec) exit 0 ;;",
            &format!("exec) if [ ! -e {0}/started ]; then touch {0}/started; printf 'working\\n'; exec sleep 30; fi ;;", dir.path().display()),
        );
        fs::write(&engine, script).unwrap();
        let mut config = test_config(dir.path());
        config.container_engine = engine.display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let request = DaycareRequest { bundle: Some(signed_runtime(&config, |_| {})) };
        let mut old = runtime.run(request.clone(), None).await.unwrap().into_inner();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Some(daycare_response::Response::Event(event)) =
                    old.next().await.unwrap().unwrap().response
                    && event.event == "stdout"
                {
                    break;
                }
            }
        })
        .await
        .unwrap();

        // The replacement must finish well before the old command's CPU-derived timeout.
        let mut replacement = runtime.run(request, None).await.unwrap().into_inner();
        tokio::time::timeout(Duration::from_secs(2), async {
            let mut graded = false;
            while let Some(response) = replacement.next().await {
                if let Some(daycare_response::Response::Bundle(_)) = response.unwrap().response {
                    graded = true;
                }
            }
            assert!(graded);
        })
        .await
        .unwrap();
        assert_eq!(runtime.container_slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn output_capture_limits_do_not_truncate_live_delivery() {
        let (events, mut receiver) = mpsc::channel(2);
        let bytes = b"all student output";
        let captured = read_output(&mut bytes.as_slice(), 4, "stdout", Some(events)).await.unwrap();
        assert_eq!(receiver.recv().await.unwrap().stream_data, bytes);
        assert_eq!(&captured[..4], &bytes[..4]);
        let mut transcript = TranscriptCapture::default();
        transcript.record(&event(
            "stdout",
            Vec::new(),
            0,
            vec![b'x'; TRANSCRIPT_DATA_LIMIT + 100],
            String::new(),
            BTreeMap::new(),
        ));
        assert_eq!(transcript.events[0].stream_data.len(), TRANSCRIPT_DATA_LIMIT);
        assert_eq!(transcript.discarded_bytes, 100);
    }

    async fn wait_for_active(runtime: &DaycareRuntime) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while runtime.active_runs.lock().await.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    async fn wait_for_idle(runtime: &DaycareRuntime) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while !runtime.active_runs.lock().await.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn unavailable_report_still_produces_failing_grade() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.container_engine = fake_engine(dir.path()).display().to_string();
        let runtime = DaycareRuntime::new(Arc::new(config.clone())).unwrap();
        let signed = signed_runtime(&config, |bundle| bundle.parser = "check".to_owned());
        let mut stream =
            runtime.run(DaycareRequest { bundle: Some(signed) }, None).await.unwrap().into_inner();
        let mut report = None;
        while let Some(response) = stream.next().await {
            if let Some(daycare_response::Response::Bundle(signed)) = response.unwrap().response {
                report = decode_signed_runtime_bundle(&signed, &config.daycare_secret)
                    .unwrap()
                    .commit
                    .unwrap()
                    .report_card;
            }
        }
        let report = report.unwrap();
        assert!(!report.passed);
        assert!(report.note.contains("parsing unit test results"));
    }

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
                Some(crate::timeutil::timestamp(Utc::now() - ChronoDuration::hours(1)));
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
        let mut report =
            ReportCard { passed: true, note: String::new(), duration: None, results: Vec::new() };
        parse_xunit(&mut report, b"<not-closed");
        assert!(!report.passed);
        assert_eq!(report.note, "error parsing unit test results");

        let mut report =
            ReportCard { passed: true, note: String::new(), duration: None, results: Vec::new() };
        parse_xunit(
            &mut report,
            br#"<testsuite><testcase name="ok"/><testcase name="skip"><skipped/></testcase></testsuite>"#,
        );
        assert!(!report.passed);
        assert_eq!(report.note, "Passed 1/2 tests");
        assert_eq!(score_from_report(&report), 0.5);

        let mut report = ReportCard { passed: true, ..ReportCard::default() };
        parse_xunit(
            &mut report,
            br#"<testsuite><testcase name="not executed" status="notrun"/></testsuite>"#,
        );
        assert!(!report.passed);
        assert_eq!(score_from_report(&report), 0.0);
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

    #[test]
    fn input_tar_includes_owned_parent_directories() {
        let raw = build_input_tar(&BTreeMap::from([
            ("nested/a.txt".to_owned(), b"a".to_vec()),
            ("nested/deeper/b.txt".to_owned(), b"b".to_vec()),
            ("root.txt".to_owned(), b"root".to_vec()),
        ]))
        .unwrap();
        let mut archive = tar::Archive::new(Cursor::new(raw));
        let entries = archive
            .entries()
            .unwrap()
            .map(|entry| {
                let entry = entry.unwrap();
                (
                    entry.path().unwrap().to_string_lossy().to_string(),
                    entry.header().entry_type(),
                    entry.header().mode().unwrap(),
                    entry.header().uid().unwrap(),
                    entry.header().gid().unwrap(),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            entries,
            vec![
                (
                    "nested".to_owned(),
                    tar::EntryType::Directory,
                    STUDENT_DIRECTORY_MODE,
                    STUDENT_UID,
                    STUDENT_GID,
                ),
                (
                    "nested/deeper".to_owned(),
                    tar::EntryType::Directory,
                    STUDENT_DIRECTORY_MODE,
                    STUDENT_UID,
                    STUDENT_GID,
                ),
                (
                    "nested/a.txt".to_owned(),
                    tar::EntryType::Regular,
                    STUDENT_FILE_MODE,
                    STUDENT_UID,
                    STUDENT_GID,
                ),
                (
                    "nested/deeper/b.txt".to_owned(),
                    tar::EntryType::Regular,
                    STUDENT_FILE_MODE,
                    STUDENT_UID,
                    STUDENT_GID,
                ),
                (
                    "root.txt".to_owned(),
                    tar::EntryType::Regular,
                    STUDENT_FILE_MODE,
                    STUDENT_UID,
                    STUDENT_GID,
                ),
            ]
        );
    }

    #[tokio::test]
    async fn workspace_archives_reject_escaping_paths_and_large_result_files() {
        assert!(build_input_tar(&BTreeMap::from([("../x".to_owned(), b"bad".to_vec())])).is_err());

        let tar = output_tar(&[("test_detail.xml", &vec![b'x'; WORKSPACE_FILE_READ_LIMIT + 1])]);
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

        let mut stream =
            runtime.run(DaycareRequest { bundle: Some(signed) }, None).await.unwrap().into_inner();
        let mut saw_bundle = false;
        while let Some(response) = stream.next().await {
            if matches!(response.unwrap().response, Some(daycare_response::Response::Bundle(_))) {
                saw_bundle = true;
            }
        }

        assert!(saw_bundle);
        let log = fs::read_to_string(dir.path().join("engine.log")).unwrap();
        assert!(!log.contains("rm -f nanny-student"));
        assert!(log.contains("rm -f fake-container"));
        assert!(log.contains("create --pull=never"));
        assert!(log.contains("--user "));
        assert!(log.contains("--label codegrinder.daycare=1"));
        assert!(log.contains("--label codegrinder.user_id=student"));
        assert!(log.contains("--ulimit core=0:0"));
        assert!(log.contains("--ulimit cpu=1"));
        assert!(log.contains("--ulimit fsize=10485760"));
        assert!(log.contains("--ulimit nofile=10:10"));
        assert!(log.contains("--ulimit nproc=-1:-1"));
        assert!(log.contains("cp --archive - fake-container:/home/student/"));
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

        let mut stream =
            runtime.run(DaycareRequest { bundle: Some(signed) }, None).await.unwrap().into_inner();
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

        let mut stream =
            runtime.run(DaycareRequest { bundle: Some(signed) }, None).await.unwrap().into_inner();
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
        assert!(report.note.starts_with("Passed 1/2 tests in "));
        assert!(report.duration.is_some());
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
        assert_eq!(
            log.lines().filter(|line| *line == "cp fake-container:/home/student/. -").count(),
            1
        );
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

        let mut stream =
            runtime.run(DaycareRequest { bundle: Some(signed) }, None).await.unwrap().into_inner();
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
        assert!(report.note.starts_with("Passed 1/1 tests in "));
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
            archive.append_data(&mut header, *path, Cursor::new(*content)).unwrap();
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
            archive.append_data(&mut header, *path, Cursor::new(*content)).unwrap();
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
        archive.append_data(&mut header, link_path, Cursor::new([])).unwrap();
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
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  create) echo fake-container ;;\n  inspect) echo false ;;\n  exec) exit 0 ;;\n  cp) if [ \"$2\" = \"--archive\" ]; then cat >/dev/null; else cat >/dev/null; fi ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
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
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  create) echo fake-container ;;\n  inspect) echo false ;;\n  exec) printf 'student stdout\\n'; printf 'student stderr\\n' >&2; exit 0 ;;\n  cp) if [ \"$2\" = \"--archive\" ]; then cat >/dev/null; else cat {}; fi ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
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
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}/engine.log\ncase \"$1\" in\n  create) echo fake-container ;;\n  inspect) echo false ;;\n  exec) exit {} ;;\n  cp) if [ \"$2\" = \"--archive\" ]; then cat >/dev/null; else cat {}; fi ;;\n  stop) exit 0 ;;\n  rm) exit 0 ;;\n  *) exit 0 ;;\nesac\n",
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
        }
    }
}

fn safe_user_dir_name(user_id: &str) -> String {
    let trimmed = user_id.trim();
    if !trimmed.is_empty()
        && trimmed != "."
        && trimmed != ".."
        && trimmed.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
    {
        trimmed.to_owned()
    } else {
        format!("user-{}", hex::encode(sha2::Sha256::digest(user_id.as_bytes()))[..24].to_owned())
    }
}
