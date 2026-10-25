use std::ffi::OsString;
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::process::ExitStatusExt;
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use crate::feedback;
use crate::sys::{self, Signals};
use crate::transcript::{Action, Stream, Transcript};
use crate::{Config, Error};

#[derive(Clone, Copy)]
enum OutputKind {
    Incorrect,
    Missing,
    Early,
    Extra,
}

enum Failure {
    Output(Stream, OutputKind),
    InputClosed,
    Timeout(WaitStage),
    Exit,
}

enum WaitStage {
    Stdout,
    Stderr,
    InputDelivery,
    Termination,
}

impl WaitStage {
    fn name(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::InputDelivery => "input delivery",
            Self::Termination => "program termination",
        }
    }
}

#[derive(Default)]
struct Capture {
    bytes: Vec<u8>,
    scan: usize,
    matched: usize,
    next: usize,
    eof: bool,
}

impl Capture {
    // Bound read work so a continuously writing child cannot monopolize the
    // manager. Complete buffered records are processed before sleeping again.
    fn read(&mut self, reader: &mut impl Read) -> io::Result<()> {
        if self.eof {
            return Ok(());
        }
        let mut buffer = [0; 16_384];
        for _ in 0..4 {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    self.eof = true;
                    break;
                }
                Ok(count) => self.bytes.extend_from_slice(&buffer[..count]),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => break,
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    fn match_records(
        &mut self,
        transcript: &Transcript,
        stream: Stream,
        end: usize,
        progress: &mut Instant,
    ) -> Result<bool, OutputKind> {
        let mut count = 0;
        while self.next < end && count < 64 {
            let newline = self.bytes[self.scan..].iter().position(|&b| b == b'\n');
            let record_end = if let Some(offset) = newline {
                self.scan + offset + 1
            } else {
                self.scan = self.bytes.len();
                if !self.eof {
                    break;
                }
                if self.matched == self.bytes.len() {
                    return Err(OutputKind::Missing);
                }
                self.bytes.len()
            };
            let expected = transcript.expected[stream.index()][self.next];
            if self.bytes[self.matched..record_end] != *transcript.payload(expected) {
                return Err(OutputKind::Incorrect);
            }
            self.matched = record_end;
            self.scan = record_end;
            self.next += 1;
            count += 1;
            *progress = Instant::now();
        }
        Ok(count == 64 && self.next < end)
    }
}

struct PendingInput {
    record: usize,
    written: usize,
}

struct Live {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: ChildStdout,
    stderr: ChildStderr,
    captures: [Capture; 2],
    status: Option<ExitStatus>,
    finished: bool,
}

impl Live {
    fn read(&mut self) -> io::Result<()> {
        self.captures[0].read(&mut self.stdout)?;
        self.captures[1].read(&mut self.stderr)
    }

    fn observe_exit(&mut self) -> io::Result<()> {
        if self.status.is_none() {
            self.status = self.child.try_wait()?;
        }
        Ok(())
    }

    // Cleanup drains both pipes while giving TERM handlers the same one-second
    // grace as the shell. The caller has already snapshotted reportable status.
    fn cleanup(&mut self) -> io::Result<()> {
        self.stdin.take();
        if self.status.is_some() {
            self.finished = true;
            return Ok(());
        }
        let snapshot = sys::descendants(self.child.id());
        let (descendants, mut error) = match snapshot {
            Ok(pids) => (pids, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        for &pid in descendants.iter().rev() {
            sys::signal(pid, libc::SIGTERM);
        }
        sys::signal(self.child.id(), libc::SIGTERM);
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            if let Err(failure) = self.read() {
                error.get_or_insert(failure);
            }
            if let Err(failure) = self.observe_exit() {
                error.get_or_insert(failure);
            }
            let mut fds = [
                sys::pollfd(
                    if self.captures[0].eof { -1 } else { self.stdout.as_raw_fd() },
                    libc::POLLIN,
                ),
                sys::pollfd(
                    if self.captures[1].eof { -1 } else { self.stderr.as_raw_fd() },
                    libc::POLLIN,
                ),
            ];
            if let Err(failure) = sys::poll(
                &mut fds,
                Duration::from_millis(20).min(deadline.saturating_duration_since(Instant::now())),
            ) {
                error.get_or_insert(failure);
            }
        }
        for &pid in descendants.iter().rev() {
            sys::signal(pid, libc::SIGKILL);
        }
        if self.status.is_none() {
            sys::signal(self.child.id(), libc::SIGKILL);
            match self.child.wait() {
                Ok(status) => self.status = Some(status),
                Err(failure) => {
                    error.get_or_insert(failure);
                }
            }
        }
        if let Err(failure) = self.read() {
            error.get_or_insert(failure);
        }
        self.finished = true;
        error.map_or(Ok(()), Err)
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        if !self.finished
            && let Err(error) = self.cleanup()
        {
            eprintln!("Stepper: cleanup failed: {error}");
        }
    }
}

pub struct CaseResult {
    pub elapsed: Duration,
    pub failure: Option<Vec<u8>>,
}

struct Manager<'a> {
    transcript: &'a Transcript,
    live: Live,
    phase: usize,
    pending: Option<PendingInput>,
    authorized: Option<usize>,
    display: usize,
    displayed: [usize; 2],
    progress: Instant,
}

impl Manager<'_> {
    fn display(&mut self, out: &mut impl Write) -> io::Result<()> {
        while let Some(record) = self.transcript.records.get(self.display) {
            match record.action {
                Action::Input if self.authorized.is_none_or(|index| self.display > index) => break,
                Action::Output(stream) => {
                    let index = stream.index();
                    if self.displayed[index] == self.live.captures[index].next {
                        break;
                    }
                    self.displayed[index] += 1;
                }
                Action::Input => {}
            }
            feedback::render(out, self.transcript.payload(self.display), record.action, false)?;
            self.display += 1;
        }
        out.flush()
    }

    fn write_input(&mut self) -> io::Result<bool> {
        let Some(pending) = &mut self.pending else {
            return Ok(true);
        };
        let input = self.transcript.payload(pending.record);
        let writer = self.live.stdin.as_mut().expect("pending input owns stdin");
        // A single bounded write per iteration leaves time to consume a child's
        // output even if it produces data while accepting a very large input.
        let end = input.len().min(pending.written.saturating_add(65_536));
        match writer.write(&input[pending.written..end]) {
            Ok(0) => return Ok(false),
            Ok(count) => pending.written += count,
            Err(error) if error.kind() == io::ErrorKind::BrokenPipe => return Ok(false),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) =>
            {
                return Ok(true);
            }
            Err(error) => return Err(error),
        }
        if pending.written == input.len() {
            if Some(pending.record) == self.transcript.last_input {
                self.live.stdin.take();
            }
            self.pending = None;
            self.progress = Instant::now();
        }
        Ok(true)
    }

    fn run(
        &mut self,
        config: &Config,
        signals: &Signals,
        out: &mut impl Write,
    ) -> Result<Option<Failure>, Error> {
        loop {
            signals.drain();
            signals.check()?;
            self.live.observe_exit()?;
            self.live.read()?;
            let input_ok = self.write_input()?;
            let phase = &self.transcript.phases[self.phase];
            let ends = phase.ends;
            let limits = phase.bytes;
            let next_input = phase.input;
            let mut buffered = false;
            for stream in [Stream::Out, Stream::Err] {
                let result = self.live.captures[stream.index()].match_records(
                    self.transcript,
                    stream,
                    ends[stream.index()],
                    &mut self.progress,
                );
                self.display(out)?;
                match result {
                    Ok(more) => buffered |= more,
                    Err(kind) => return Ok(Some(Failure::Output(stream, kind))),
                }
            }
            if !input_ok {
                return Ok(Some(Failure::InputClosed));
            }
            for stream in [Stream::Out, Stream::Err] {
                let index = stream.index();
                let capture = &self.live.captures[index];
                if capture.bytes.len() > limits[index] {
                    let kind = if capture.next < ends[index] {
                        OutputKind::Incorrect
                    } else if next_input.is_some() {
                        OutputKind::Early
                    } else {
                        OutputKind::Extra
                    };
                    return Ok(Some(Failure::Output(stream, kind)));
                }
            }

            // Open the following phase before writing its input. This permits a
            // fast response while retaining one outstanding delivery at a time.
            let matched =
                self.live.captures.iter().zip(ends).all(|(capture, end)| capture.next == end);
            if matched && self.pending.is_none() {
                if let Some(record) = next_input {
                    if self.live.status.is_some() {
                        return Ok(Some(Failure::InputClosed));
                    }
                    self.authorized = Some(record);
                    self.display(out)?;
                    self.phase += 1;
                    self.pending = Some(PendingInput { record, written: 0 });
                    continue;
                }
                if self.live.captures.iter().all(|capture| capture.eof)
                    && self.live.stdin.is_none()
                    && let Some(status) = self.live.status
                {
                    return Ok(if status.success() { None } else { Some(Failure::Exit) });
                }
            }
            let remaining = config.timeout.saturating_sub(self.progress.elapsed());
            if remaining.is_zero() {
                let stage = if self.live.captures[0].next < ends[0] {
                    WaitStage::Stdout
                } else if self.live.captures[1].next < ends[1] {
                    WaitStage::Stderr
                } else if self.pending.is_some() {
                    WaitStage::InputDelivery
                } else {
                    WaitStage::Termination
                };
                return Ok(Some(Failure::Timeout(stage)));
            }
            if buffered {
                continue;
            }
            let mut fds = [
                sys::pollfd(
                    if self.live.captures[0].eof { -1 } else { self.live.stdout.as_raw_fd() },
                    libc::POLLIN,
                ),
                sys::pollfd(
                    if self.live.captures[1].eof { -1 } else { self.live.stderr.as_raw_fd() },
                    libc::POLLIN,
                ),
                sys::pollfd(
                    self.live
                        .stdin
                        .as_ref()
                        .filter(|_| self.pending.is_some())
                        .map_or(-1, AsRawFd::as_raw_fd),
                    libc::POLLOUT,
                ),
                sys::pollfd(signals.fd(), libc::POLLIN),
            ];
            sys::poll(&mut fds, remaining)?;
        }
    }

    fn failure_report(&self, failure: Failure, observed: Option<ExitStatus>) -> Vec<u8> {
        let mut log = Vec::new();
        let mut reason = match failure {
            Failure::Output(stream, kind) => {
                let index = stream.index();
                let capture = &self.live.captures[index];
                feedback::context(&mut log, &capture.bytes[capture.matched..], stream)
                    .expect("vector write");
                let name = stream.name();
                let transition = match kind {
                    OutputKind::Incorrect => {
                        format!("{name} is incorrect—the highlighted lines should have been:")
                    }
                    OutputKind::Missing => {
                        format!("{name} ended early—the following lines were missing:")
                    }
                    OutputKind::Early => {
                        format!("unexpected {name}—input was expected before the highlighted lines")
                    }
                    OutputKind::Extra => {
                        format!("unexpected {name}—the highlighted lines were unexpected")
                    }
                };
                feedback::color(&mut log, "1;31", format!("!!!!! {transition}").as_bytes())
                    .expect("vector write");
                if matches!(kind, OutputKind::Incorrect | OutputKind::Missing) {
                    feedback::expected_context(
                        &mut log,
                        self.transcript,
                        stream,
                        capture.next,
                        self.transcript.phases[self.phase].ends[index],
                    )
                    .expect("vector write");
                }
                format!("incorrect {name}")
            }
            Failure::InputClosed => "stdin closed before all input was sent".into(),
            Failure::Timeout(stage) => format!("timed out waiting for {}", stage.name()),
            Failure::Exit => String::new(),
        };
        if let Some(status) = observed.filter(|status| !status.success()) {
            if !reason.is_empty() {
                reason.push('/');
            }
            let code = status.code().unwrap_or_else(|| 128 + status.signal().unwrap_or(0));
            reason.push_str(&format!("incorrect exit status: {code}"));
        }
        feedback::color(&mut log, "1;31", format!("!!!!! test failed: {reason}").as_bytes())
            .expect("vector write");
        log
    }
}

fn launch(argv: &[OsString]) -> io::Result<Child> {
    let spawn = |command: &mut Command| {
        command
            .env("LC_ALL", "C")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    };
    let result = spawn(Command::new(&argv[0]).args(&argv[1..]));
    if result.as_ref().is_err_and(|error| error.raw_os_error() == Some(libc::ENOEXEC)) {
        // Musl execvp does not retry executable shell text as a script. The
        // fixed shell command preserves argv without evaluating its contents.
        spawn(Command::new("/bin/sh").args(["-c", "exec \"$0\" \"$@\""]).args(argv))
    } else {
        result
    }
}

pub fn run_case(
    config: &Config,
    transcript: &Transcript,
    argv: &[OsString],
    signals: &Signals,
    out: &mut impl Write,
) -> Result<CaseResult, Error> {
    let command_log = feedback::command(argv);
    out.write_all(&command_log)?;
    out.flush()?;
    signals.check()?;
    let start = Instant::now();
    let child = launch(argv);
    let mut child = match child {
        Ok(child) => child,
        Err(error)
            if matches!(
                error.raw_os_error(),
                Some(libc::ENOENT | libc::ENOTDIR | libc::EACCES | libc::ENOEXEC)
            ) =>
        {
            let code = if matches!(error.raw_os_error(), Some(libc::ENOENT | libc::ENOTDIR)) {
                127
            } else {
                126
            };
            let mut log = command_log;
            let mut failure = Vec::new();
            feedback::color(&mut failure, "1;31", format!("!!!!! test failed: cannot execute command: {error}/incorrect exit status: {code}").as_bytes())?;
            out.write_all(&failure)?;
            log.extend(failure);
            return Ok(CaseResult { elapsed: start.elapsed(), failure: Some(log) });
        }
        Err(error) => return Err(error.into()),
    };
    // Ownership is established before fallible pipe setup so every later error
    // terminates and reaps the child through the same cleanup path.
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let live = Live {
        child,
        stdin,
        stdout,
        stderr,
        captures: [Capture::default(), Capture::default()],
        status: None,
        finished: false,
    };
    let mut manager = Manager {
        transcript,
        live,
        phase: 0,
        pending: None,
        authorized: None,
        display: 0,
        displayed: [0; 2],
        progress: start,
    };
    sys::nonblocking(manager.live.stdout.as_raw_fd())?;
    sys::nonblocking(manager.live.stderr.as_raw_fd())?;
    if let Some(stdin) = &manager.live.stdin {
        sys::nonblocking(stdin.as_raw_fd())?;
    }
    if transcript.last_input.is_none() {
        manager.live.stdin.take();
    }
    let failure = manager.run(config, signals, out)?;
    let elapsed = start.elapsed();
    manager.live.observe_exit()?;
    let observed = manager.live.status;
    manager.live.cleanup()?;
    signals.check()?;
    let failure = if let Some(failure) = failure {
        let rendered = manager.failure_report(failure, observed);
        out.write_all(&rendered)?;
        let mut log = command_log;
        log.extend(rendered);
        Some(log)
    } else {
        feedback::color(out, "32", "✔".as_bytes())?;
        None
    };
    Ok(CaseResult { elapsed, failure })
}
