use std::env;
use std::fs;
use std::mem::zeroed;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};

static TERM_SEEN: AtomicBool = AtomicBool::new(false);

extern "C" fn host_handler(_: i32) {
    TERM_SEEN.store(true, Ordering::Relaxed);
}

fn verify_restoration() {
    let mask = unsafe { libc::umask(0o022) };
    assert_eq!(mask, 0o022, "stepper changed the host umask");
    TERM_SEEN.store(false, Ordering::Relaxed);
    unsafe { libc::raise(libc::SIGTERM) };
    assert!(TERM_SEEN.load(Ordering::Relaxed), "host signal handler was not restored");
}

fn main() -> ExitCode {
    let mut args = env::args_os();
    let program = args.next().unwrap();
    if !stepper::invoked_as_stepper(&program) {
        println!("host mode");
        return ExitCode::SUCCESS;
    }
    let args: Vec<_> = args.collect();

    // Establish host state before calling the dependent library. A return marker
    // proves that library error and signal paths also return through the caller.
    let previous_mask = unsafe { libc::umask(0o022) };
    let mut previous: libc::sigaction = unsafe { zeroed() };
    let mut action: libc::sigaction = unsafe { zeroed() };
    action.sa_sigaction = host_handler as *const () as usize;
    unsafe {
        libc::sigemptyset(&mut action.sa_mask);
        assert_eq!(libc::sigaction(libc::SIGTERM, &action, &mut previous), 0);
    }
    let code = stepper::run(args.clone());
    verify_restoration();
    if env::var_os("STEPPER_TEST_REPEAT").is_some() {
        assert_eq!(stepper::run(args), code);
        verify_restoration();
    }
    fs::write("returned", b"restored\n").unwrap();
    unsafe {
        libc::sigaction(libc::SIGTERM, &previous, std::ptr::null_mut());
        libc::umask(previous_mask);
    }
    code
}
