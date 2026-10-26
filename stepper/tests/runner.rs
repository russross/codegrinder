use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Fixture(PathBuf);

impl Fixture {
    fn new(transcript: &[u8]) -> Self {
        let path = std::env::temp_dir().join(format!(
            "stepper-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::create_dir(path.join("inputs")).unwrap();
        fs::write(path.join("inputs/test.transcript"), transcript).unwrap();
        Self(path)
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_stepper"));
        command
            .current_dir(&self.0)
            .env("STEPPER_DIR", "inputs")
            .env("STEPPER_TIMEOUT", "1")
            .env("STEPPER_GRADE", "false")
            .env_remove("STEPPER_INPUT_TRANSFORM");
        command
    }

    fn shell(&self, program: &str) -> Output {
        self.command().args(["--", "sh", "-c", program]).output().unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn log(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn assert_result(output: &Output, code: i32, diagnostic: &str) {
    assert_eq!(
        output.status.code(),
        Some(code),
        "stdout: {}\nstderr: {}",
        log(output),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(log(output).contains(diagnostic), "{}", log(output));
}

// Inspect XML using the platform parser when available, in addition to checking
// the literal escaping. The runner has no dependency on this test-only tool.
fn validate_xml(path: &Path) {
    match Command::new("xmllint").args(["--noout"]).arg(path).output() {
        Ok(output) => {
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => panic!("cannot validate XML: {error}"),
    }
}

#[test]
fn reports_are_valid_xml_for_binary_output_arguments_and_filenames() {
    let fixture = Fixture::new(b"> expected\n");
    // APFS rejects invalid UTF-8 filenames; Linux exercises the raw-byte path.
    #[cfg(target_os = "linux")]
    let name = OsString::from_vec(b"inputs/<&\"'\n\xff\xef\xbf\xbf.transcript".to_vec());
    #[cfg(not(target_os = "linux"))]
    let name = OsString::from("inputs/<&\"'\nvalid.transcript");
    fs::rename(fixture.0.join("inputs/test.transcript"), fixture.0.join(name)).unwrap();
    fs::write(
        fixture.0.join("actual"),
        b"\xff\xc0\x80\xef\xbf\xbe\xef\xbf\xbf<&\"'\0\x1b\r\x7f\n\xc3\xa9\xf0\x9f\x99\x82\xe2\x82",
    )
    .unwrap();
    let output = fixture
        .command()
        .env("STEPPER_GRADE", "true")
        .args(["--", "sh", "-c", "cat actual", "student"])
        .arg(OsString::from_vec(b"bad\xff\xef\xbf\xbf\x01<&".to_vec()))
        .output()
        .unwrap();
    assert_result(&output, 1, "incorrect stdout");
    let xml_path = fixture.0.join("test_detail.xml");
    let xml = fs::read_to_string(&xml_path).unwrap();
    assert!(xml.contains("\\377\\300\\200\\357\\277\\276\\357\\277\\277"), "{xml}");
    assert!(xml.contains("é🙂\\342\\202"), "{xml}");
    #[cfg(target_os = "linux")]
    assert!(
        xml.contains("name=\"&lt;&amp;&quot;&apos;&#10;\\377\\357\\277\\277.transcript\""),
        "{xml}"
    );
    #[cfg(not(target_os = "linux"))]
    assert!(xml.contains("name=\"&lt;&amp;&quot;&apos;&#10;valid.transcript\""), "{xml}");
    assert!(!xml.contains('\x1b'));
    validate_xml(&xml_path);
}

#[test]
fn templates_and_argument_substitution_are_literal_and_single_pass() {
    let fixture = Fixture::new(b"> okay\n");
    let output = fixture.command()
        .env("STEPPER_INPUT_TRANSFORM", "@@/@STEM@:@TRANSCRIPT@")
        .args(["--", "sh", "-c", "test \"$1\" = '@/inputs/test:inputs/test.transcript' && test \"$2\" = \"pre$1:$1\" && test \"$3\" = '$(touch unexpected)' && printf 'okay\\n'", "student", "@INPUT@", "pre@INPUT@:@INPUT@", "$(touch unexpected)"])
        .output().unwrap();
    assert_result(&output, 0, "✔");
    assert!(!fixture.0.join("unexpected").exists());
    let output = fixture
        .command()
        .env("STEPPER_INPUT_TRANSFORM", "@BOGUS@")
        .args(["sh", "-c", "touch launched"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(!fixture.0.join("launched").exists());
}

#[test]
fn consecutive_inputs_and_blocking_child_descriptors() {
    let fixture = Fixture::new(b"< first\n< second\n> first/second\n> eof\n");
    let output = fixture.shell("IFS= read -r first; IFS= read -r second; printf '%s/%s\\n' \"$first\" \"$second\"; cat >/dev/null; printf 'eof\\n'");
    assert_result(&output, 0, "✔");
}

#[test]
fn both_busy_streams_are_drained_and_all_buffered_records_are_matched() {
    let mut transcript = Vec::new();
    for _ in 0..4096 {
        transcript.extend_from_slice(b"> out\n! err\n");
    }
    let fixture = Fixture::new(&transcript);
    let output = fixture.shell("i=0; while [ \"$i\" -lt 4096 ]; do printf 'err\\n' >&2; printf 'out\\n'; i=$((i + 1)); done");
    assert_result(&output, 0, "✔");
}

#[test]
fn partial_lines_do_not_reset_the_inactivity_timeout() {
    let fixture = Fixture::new(b"> abcdefghij\n");
    let output = fixture.shell("trap 'exit 0' TERM; while :; do printf a; sleep 0.2; done");
    assert_result(&output, 1, "timed out waiting for stdout");
    assert!(!log(&output).contains("incorrect exit status"));
}

#[test]
fn child_exit_does_not_substitute_for_output_pipe_eof() {
    let fixture = Fixture::new(b"> delayed\n");
    let output = fixture.shell("(sleep 0.1; printf 'delayed\\n') & exit 0");
    assert_result(&output, 0, "✔");
}

#[test]
fn matching_binary_and_carriage_return_bytes_remain_exact() {
    let fixture = Fixture::new(b"> \xff\r\t\n");
    fs::write(fixture.0.join("actual"), b"\xff\r\t\n").unwrap();
    assert_result(&fixture.shell("cat actual"), 0, "✔");
    fs::write(fixture.0.join("actual"), b"\xff\t\n").unwrap();
    assert_result(&fixture.shell("cat actual"), 1, "incorrect stdout");
}

#[test]
fn report_publication_failure_is_a_runner_error_without_temporary_files() {
    let fixture = Fixture::new(b"> okay\n");
    let output = fixture
        .command()
        .env("STEPPER_GRADE", "true")
        .args(["sh", "-c", "mkdir test_detail.xml; printf 'okay\\n'"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("cannot publish test_detail.xml"));
    assert!(
        !fs::read_dir(&fixture.0)
            .unwrap()
            .any(|entry| { entry.unwrap().file_name().to_string_lossy().contains(".tmp.") })
    );
}

#[test]
fn empty_grade_run_replaces_stale_report_and_ignores_hidden_cases() {
    let fixture = Fixture::new(b"bad\n");
    fs::rename(
        fixture.0.join("inputs/test.transcript"),
        fixture.0.join("inputs/.hidden.transcript"),
    )
    .unwrap();
    fs::write(fixture.0.join("test_detail.xml"), b"stale").unwrap();
    let output = fixture.command().env("STEPPER_GRADE", "true").arg("true").output().unwrap();
    assert_result(&output, 0, "Passed 0/0 tests");
    assert!(String::from_utf8_lossy(&output.stderr).contains("no transcript files found"));
    let xml = fs::read_to_string(fixture.0.join("test_detail.xml")).unwrap();
    assert!(xml.contains("tests=\"0\" failures=\"0\""));
    validate_xml(&fixture.0.join("test_detail.xml"));
}

#[test]
fn missing_and_nonexecutable_commands_fail_cases_and_grading_continues() {
    let fixture = Fixture::new(b"");
    fs::write(fixture.0.join("inputs/2.transcript"), b"").unwrap();
    let output = fixture.command().env("STEPPER_GRADE", "true").arg("./absent").output().unwrap();
    assert_result(&output, 1, "incorrect exit status: 127");
    assert!(log(&output).contains("Passed 0/2 tests"));
    fs::write(fixture.0.join("not-executable"), b"#!/bin/sh\nexit 0\n").unwrap();
    fs::set_permissions(fixture.0.join("not-executable"), fs::Permissions::from_mode(0o600))
        .unwrap();
    assert_result(
        &fixture.command().arg("./not-executable").output().unwrap(),
        1,
        "incorrect exit status: 126",
    );
}

#[test]
fn executable_shell_text_without_a_shebang_retains_shell_execution() {
    let fixture = Fixture::new(b"> works\n");
    let script = fixture.0.join("student");
    fs::write(
        &script,
        b"test \"$1\" = 'literal $(touch unexpected)' || exit 4\nprintf 'works\\n'\n",
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    assert_result(
        &fixture.command().args(["./student", "literal $(touch unexpected)"]).output().unwrap(),
        0,
        "✔",
    );
    assert_result(
        &fixture
            .command()
            .env("PATH", &fixture.0)
            .args(["student", "literal $(touch unexpected)"])
            .output()
            .unwrap(),
        0,
        "✔",
    );
    assert!(!fixture.0.join("unexpected").exists());
}

#[test]
fn interrupt_kills_a_term_resistant_descendant() {
    let fixture = Fixture::new(b"> waiting\n");
    fs::write(
        fixture.0.join("descendant.sh"),
        b"trap '' TERM\necho $$ > descendant.pid\nwhile :; do :; done\n",
    )
    .unwrap();
    let mut manager = fixture
        .command()
        .env("STEPPER_TIMEOUT", "10")
        .args(["sh", "-c", "sh descendant.sh & wait"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !fixture.0.join("descendant.pid").exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    let pid = fs::read_to_string(fixture.0.join("descendant.pid"))
        .unwrap()
        .trim()
        .parse::<i32>()
        .unwrap();
    unsafe {
        libc::kill(manager.id() as i32, libc::SIGTERM);
    }
    let status = manager.wait().unwrap();
    assert_eq!(status.code(), Some(143));
    // An orphan may briefly be a zombie while the host's init reaps it. A
    // successful signal probe alone therefore does not prove it is still alive.
    let output = Command::new("ps").args(["-o", "stat=", "-p", &pid.to_string()]).output().unwrap();
    let state = String::from_utf8_lossy(&output.stdout);
    assert!(
        state.trim().is_empty() || state.trim().starts_with('Z'),
        "descendant still running: {state}"
    );
}

#[test]
fn deterministic_console_feedback_matches_the_shell_reference_byte_for_byte() {
    let cases: &[(&[u8], &str)] = &[
        (
            b"> prompt\n< a\\b\t\n! err\n> done\n",
            "printf 'prompt\\n'; IFS= read -r value; printf 'err\\n' >&2; cat >/dev/null; printf 'done\\n'",
        ),
        (b"> right\n> more\n< unsent\n", "printf 'wrong\\nalso wrong\\n'; cat >/dev/null"),
        (b"! missing\n", "exit 0"),
        (b"> partial\n", "printf partial"),
    ];
    for &(transcript, program) in cases {
        let fixture = Fixture::new(transcript);
        fs::write(fixture.0.join("student.sh"), program).unwrap();
        let actual = fixture.command().args(["--", "sh", "student.sh"]).output().unwrap();
        let reference = Command::new("sh")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/support/stepper.sh"))
            .args(["--", "sh", "student.sh"])
            .current_dir(&fixture.0)
            .env("STEPPER_DIR", "inputs")
            .env("STEPPER_TIMEOUT", "1")
            .env("STEPPER_GRADE", "false")
            .env_remove("STEPPER_INPUT_TRANSFORM")
            .output()
            .unwrap();
        assert_eq!(actual.status.code(), reference.status.code());
        // Only the summary's elapsed time intentionally differs. Keep every
        // byte before that final line, including ANSI styles and blank lines.
        let body = |bytes: &[u8]| -> Vec<u8> {
            let prefix = b"\x1b[1;9";
            let end = bytes.windows(prefix.len()).rposition(|s| s == prefix).unwrap_or(bytes.len());
            bytes[..end].to_vec()
        };
        assert_eq!(body(&actual.stdout), body(&reference.stdout));
    }
}
