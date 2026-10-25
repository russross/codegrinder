use std::env;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

struct Consumer(PathBuf);

impl Consumer {
    fn new() -> Self {
        let root = env::temp_dir().join(format!("stepper-consumer-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("src")).unwrap();
        Self(root)
    }

    fn command(&self, name: &str) -> Command {
        let mut command = Command::new(self.0.join(name));
        command
            .current_dir(&self.0)
            .env("STEPPER_DIR", "inputs")
            .env("STEPPER_TIMEOUT", "1")
            .env("STEPPER_GRADE", "false")
            .env_remove("STEPPER_INPUT_TRANSFORM");
        command
    }

    fn check_return(&self, output: Output, status: i32) {
        assert_eq!(
            output.status.code(),
            Some(status),
            "stdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read(self.0.join("returned")).unwrap(), b"restored\n");
        fs::remove_file(self.0.join("returned")).unwrap();
    }
}

impl Drop for Consumer {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn downstream_binary_dispatches_by_symlink_and_regains_its_process_state() {
    let fixture = Consumer::new();
    let project = Path::new(env!("CARGO_MANIFEST_DIR"));
    fs::write(fixture.0.join("Cargo.toml"), format!(
        "[package]\nname = \"stepper-host\"\nversion = \"0.0.0\"\nedition = \"2024\"\n\n[dependencies]\nstepper = {{ path = {:?} }}\nlibc = \"0.2\"\n",
        project
    )).unwrap();
    fs::write(fixture.0.join("src/main.rs"), include_str!("support/multicall.rs")).unwrap();

    // Compile a separate package with stepper as an ordinary path dependency.
    // Its build directory stays under target so repeated checks remain incremental.
    let target = project.join("../target/embedding-check");
    let built = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
        .current_dir(&fixture.0)
        .args(["build", "--release", "--offline", "--target-dir"])
        .arg(&target)
        .output()
        .unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    symlink(target.join("release/stepper-host"), fixture.0.join("host")).unwrap();
    symlink("host", fixture.0.join("stepper")).unwrap();

    // The host basename bypasses stepper even with invalid stepper settings.
    // Conversely, resolving the stepper symlink first would select the host.
    let host = fixture.command("host").env("STEPPER_GRADE", "invalid").output().unwrap();
    assert!(host.status.success());
    assert_eq!(host.stdout, b"host mode\n");
    assert!(!fixture.0.join("returned").exists());
    fs::create_dir(fixture.0.join("inputs")).unwrap();
    fs::write(fixture.0.join("inputs/test.transcript"), b"> done\n").unwrap();
    let output = fixture
        .command("stepper")
        .env("STEPPER_TEST_REPEAT", "true")
        .args(["--", "sh", "-c", "printf 'done\\n'"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&output.stdout).matches('✔').count(), 2);
    fixture.check_return(output, 0);

    // Ordinary failure and invalid configuration must also return rather than
    // terminate the embedding binary or leave process-wide state changed.
    fixture.check_return(
        fixture.command("stepper").args(["sh", "-c", "printf 'wrong\\n'"]).output().unwrap(),
        1,
    );
    fixture.check_return(
        fixture.command("stepper").env("STEPPER_GRADE", "invalid").arg("true").output().unwrap(),
        2,
    );

    // Interrupt while the library owns SIGTERM. The host's handler must become
    // active again after child cleanup, before the library's status is returned.
    let mut host = fixture
        .command("stepper")
        .env("STEPPER_TIMEOUT", "10")
        .args(["sh", "-c", "echo $$ > child.pid; exec sleep 30"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !fixture.0.join("child.pid").exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    if !fixture.0.join("child.pid").exists() {
        host.kill().unwrap();
        let output = host.wait_with_output().unwrap();
        panic!("student did not start: {}", String::from_utf8_lossy(&output.stderr));
    }
    unsafe { libc::kill(host.id() as i32, libc::SIGTERM) };
    fixture.check_return(host.wait_with_output().unwrap(), 143);
}
