//! Interactive transcript runner and command-line mode for multicall binaries.
//!
//! Call [`main`] from a standalone binary, or use [`invoked_as_stepper`] and
//! [`run`] to dispatch by `argv[0]`. Both entry points return an exit code and
//! report diagnostics themselves. They read `STEPPER_*` configuration from the
//! environment and use the caller's working directory and standard streams.
//!
//! Stepper owns process-wide signal handling and umask for the duration of the
//! call. Dispatch on the main thread before starting other application threads;
//! concurrent invocations are rejected. Original handlers and umask are restored
//! before returning, including after an interrupted or failed run.

mod feedback;
mod report;
mod runner;
mod sys;
mod transcript;

use std::env;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

use report::Report;
use sys::Signals;
use transcript::Transcript;

#[derive(Debug)]
enum Error {
    Message(String),
    Io(io::Error),
    Interrupted(i32),
}

impl Error {
    fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}

impl From<io::Error> for Error {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Message(message) => f.write_str(message),
            Self::Io(error) => write!(f, "I/O error: {error}"),
            Self::Interrupted(signal) => write!(f, "interrupted by signal {signal}"),
        }
    }
}

enum TemplatePart {
    Literal(Vec<u8>),
    Stem,
    Transcript,
}

struct InputTemplate(Vec<TemplatePart>);

impl InputTemplate {
    fn parse(bytes: &[u8]) -> Result<Self, Error> {
        let mut parts = Vec::new();
        let mut literal = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] != b'@' {
                literal.push(bytes[i]);
                i += 1;
                continue;
            }
            if bytes[i..].starts_with(b"@@") {
                literal.push(b'@');
                i += 2;
                continue;
            }
            parts.push(TemplatePart::Literal(std::mem::take(&mut literal)));
            if bytes[i..].starts_with(b"@STEM@") {
                parts.push(TemplatePart::Stem);
                i += 6;
            } else if bytes[i..].starts_with(b"@TRANSCRIPT@") {
                parts.push(TemplatePart::Transcript);
                i += 12;
            } else {
                return Err(Error::message(
                    "STEPPER_INPUT_TRANSFORM contains an unknown or unclosed token",
                ));
            }
        }
        parts.push(TemplatePart::Literal(literal));
        Ok(Self(parts))
    }

    // Expansion is deliberately single-pass: @ signs in a path are literal,
    // and command substitution preserves the original argument boundaries.
    fn expand(&self, transcript: &Path) -> Vec<u8> {
        let path = transcript.as_os_str().as_bytes();
        let stem = path.strip_suffix(b".transcript").unwrap_or(path);
        let mut result = Vec::new();
        for part in &self.0 {
            result.extend_from_slice(match part {
                TemplatePart::Literal(bytes) => bytes,
                TemplatePart::Stem => stem,
                TemplatePart::Transcript => path,
            });
        }
        result
    }
}

struct Config {
    directory: PathBuf,
    timeout: Duration,
    grade: bool,
    template: InputTemplate,
    argv: Vec<OsString>,
}

fn setting(name: &str, default: &str) -> OsString {
    env::var_os(name).filter(|value| !value.is_empty()).unwrap_or_else(|| default.into())
}

impl Config {
    fn read(args: impl IntoIterator<Item = OsString>) -> Result<Self, Error> {
        let seconds = setting("STEPPER_TIMEOUT", "5");
        if !seconds.as_bytes().iter().all(u8::is_ascii_digit) {
            return Err(Error::message("STEPPER_TIMEOUT must be a positive integer"));
        }
        let seconds = seconds
            .to_str()
            .and_then(|s| s.parse::<u64>().ok())
            .ok_or_else(|| Error::message("STEPPER_TIMEOUT is too large"))?;
        if seconds == 0 {
            return Err(Error::message("STEPPER_TIMEOUT must be positive"));
        }
        let grade = match setting("STEPPER_GRADE", "false").as_bytes() {
            b"true" => true,
            b"false" => false,
            _ => return Err(Error::message("STEPPER_GRADE must be true or false")),
        };
        let template =
            InputTemplate::parse(setting("STEPPER_INPUT_TRANSFORM", "@STEM@.input").as_bytes())?;
        let mut argv: Vec<_> = args.into_iter().collect();
        if argv.first().is_some_and(|arg| arg == "--") {
            argv.remove(0);
        }
        Ok(Self {
            directory: setting("STEPPER_DIR", "inputs").into(),
            timeout: Duration::from_secs(seconds),
            grade,
            template,
            argv,
        })
    }

    fn arguments(&self, transcript: &Path) -> Vec<OsString> {
        let input = self.template.expand(transcript);
        self.argv
            .iter()
            .map(|arg| {
                let mut bytes = arg.as_bytes();
                let mut result = Vec::new();
                while let Some(index) = bytes.windows(7).position(|window| window == b"@INPUT@") {
                    result.extend_from_slice(&bytes[..index]);
                    result.extend_from_slice(&input);
                    bytes = &bytes[index + 7..];
                }
                result.extend_from_slice(bytes);
                OsString::from_vec(result)
            })
            .collect()
    }
}

fn discover(directory: &Path) -> Result<Vec<PathBuf>, Error> {
    if !directory.is_dir() {
        return Err(Error::message(format!("not a directory: {}", directory.display())));
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.as_bytes();
        if !name.starts_with(b".") && name.ends_with(b".transcript") && entry.path().is_file() {
            paths.push(entry.path());
        }
    }
    paths.sort_by(|a, b| a.as_os_str().as_bytes().cmp(b.as_os_str().as_bytes()));
    Ok(paths)
}

fn run_cli(args: impl IntoIterator<Item = OsString>, signals: &Signals) -> Result<u8, Error> {
    let config = Config::read(args)?;
    if config.grade {
        match fs::remove_file("test_detail.xml") {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(Error::message(format!("cannot remove old report: {error}"))),
        }
    }
    let paths = discover(&config.directory)?;
    if config.argv.is_empty() {
        return Err(Error::message("usage: stepper -- command [argument ...]"));
    }
    let mut report = Report::new();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    for path in &paths {
        signals.check()?;
        let bytes = fs::read(path)?;
        let result = match Transcript::parse(bytes) {
            Ok(transcript) => {
                runner::run_case(&config, &transcript, &config.arguments(path), signals, &mut out)?
            }
            Err(reason) => {
                let mut log = Vec::new();
                feedback::color(
                    &mut log,
                    "1;31",
                    format!("!!!!! test failed: {reason}").as_bytes(),
                )?;
                out.write_all(&log)?;
                runner::CaseResult { elapsed: Duration::ZERO, failure: Some(log) }
            }
        };
        out.write_all(b"\n")?;
        out.flush()?;
        let failed = result.failure.is_some();
        let name = path.file_name().unwrap_or_else(|| OsStr::new(""));
        report.case(name.as_bytes(), result.elapsed, result.failure.as_deref(), config.grade);
        if failed && !config.grade {
            break;
        }
    }
    signals.check()?;
    feedback::color(
        &mut out,
        if report.failures == 0 { "1;92" } else { "1;91" },
        format!(
            "Passed {}/{} tests in {:.3} seconds ({} total)",
            report.tests - report.failures,
            report.tests,
            report.elapsed.as_secs_f64(),
            paths.len()
        )
        .as_bytes(),
    )?;
    out.flush()?;
    if config.grade {
        report.publish(signals)?;
    }
    if paths.is_empty() {
        eprintln!("Warning: no transcript files found");
    }
    Ok(u8::from(report.failures != 0))
}

/// Whether `argv[0]`'s basename is exactly `stepper`.
///
/// Inspect the invocation name without resolving symlinks to the host binary.
/// This performs no filesystem access and preserves non-UTF-8 path components.
pub fn invoked_as_stepper(argv0: &OsStr) -> bool {
    Path::new(argv0).file_name() == Some(OsStr::new("stepper"))
}

/// Run stepper with the process's arguments after `argv[0]`, returning its status.
///
/// Call from the main thread before starting application worker threads. See
/// the crate documentation for process-wide state owned during this call.
pub fn main() -> ExitCode {
    run(env::args_os().skip(1))
}

/// Run stepper with explicit arguments, excluding the program name.
///
/// An optional leading `--` is accepted. Environment configuration, feedback,
/// report publication, and exit codes match the standalone CLI. This returns
/// normally after cleanup; it never calls `process::exit`.
///
/// Call from the main thread before starting application worker threads.
pub fn run(args: impl IntoIterator<Item = OsString>) -> ExitCode {
    // Keep the invocation guard outside the signal owner so restoration happens
    // in reverse order: handlers first, then umask, then concurrent-call access.
    let result = sys::Invocation::begin().and_then(|_invocation| {
        let signals = Signals::install()?;
        run_cli(args, &signals)
    });
    let code = match result {
        Ok(code) => code,
        Err(Error::Interrupted(signal)) => 128 + signal as u8,
        Err(error) => {
            eprintln!("Stepper: {error}");
            2
        }
    };
    ExitCode::from(code)
}

#[cfg(test)]
mod tests {
    use super::InputTemplate;
    use std::path::Path;

    #[test]
    fn templates_expand_paths_once_and_quote_at_signs() {
        let template = InputTemplate::parse(b"@@:@STEM@.input:@TRANSCRIPT@").unwrap();
        assert_eq!(
            template.expand(Path::new("a @STEM@/x.transcript")),
            b"@:a @STEM@/x.input:a @STEM@/x.transcript"
        );
        assert!(InputTemplate::parse(b"@unknown@").is_err());
        assert!(InputTemplate::parse(b"unclosed@").is_err());
    }
}
