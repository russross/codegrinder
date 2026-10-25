#[cfg(target_os = "linux")]
use std::fs;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::time::Duration;

use crate::Error;

static WAKE_FD: AtomicI32 = AtomicI32::new(-1);
static TERMINATED: AtomicI32 = AtomicI32::new(0);
static INVOCATION_ACTIVE: AtomicBool = AtomicBool::new(false);

pub struct Invocation {
    previous_mask: libc::mode_t,
}

impl Invocation {
    pub fn begin() -> Result<Self, Error> {
        if INVOCATION_ACTIVE
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            return Err(Error::message("a stepper invocation is already running"));
        }
        // Apply the shell runner's mask only while stepper owns process state.
        // Signal setup and every later error unwind through this same guard.
        let previous_mask = unsafe { libc::umask(0o077) };
        Ok(Self { previous_mask })
    }
}

impl Drop for Invocation {
    fn drop(&mut self) {
        unsafe { libc::umask(self.previous_mask) };
        INVOCATION_ACTIVE.store(false, Ordering::Release);
    }
}

// The handler only accesses lock-free atomics and async-signal-safe functions.
// A full pipe already guarantees a wakeup; the pending signal stays recorded.
extern "C" fn handler(signal: libc::c_int) {
    unsafe {
        #[cfg(target_os = "linux")]
        let errno = libc::__errno_location();
        #[cfg(target_os = "macos")]
        let errno = libc::__error();
        let saved = *errno;
        if signal != libc::SIGCHLD {
            let _ = TERMINATED.compare_exchange(0, signal, Ordering::Relaxed, Ordering::Relaxed);
        }
        let byte = 0_u8;
        libc::write(WAKE_FD.load(Ordering::Relaxed), (&byte as *const u8).cast(), 1);
        *errno = saved;
    }
}

pub fn nonblocking(fd: RawFd) -> io::Result<()> {
    // Flags are changed only on the parent's end of each anonymous pipe.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);
        if flags == -1 || libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) == -1 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

pub fn poll(fds: &mut [libc::pollfd], duration: Duration) -> io::Result<()> {
    let milliseconds =
        duration.as_millis() + u128::from(!duration.subsec_nanos().is_multiple_of(1_000_000));
    let timeout = milliseconds.min(i32::MAX as u128) as i32;
    // EINTR is a wakeup, not a reason to restart the original timeout.
    if unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, timeout) } == -1 {
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
    Ok(())
}

pub fn pollfd(fd: RawFd, events: i16) -> libc::pollfd {
    libc::pollfd { fd, events, revents: 0 }
}

pub struct Signals {
    reader: OwnedFd,
    _writer: OwnedFd,
    previous: Vec<(i32, libc::sigaction)>,
}

impl Signals {
    pub fn install() -> io::Result<Self> {
        let mut descriptors = [-1; 2];
        if unsafe { libc::pipe(descriptors.as_mut_ptr()) } == -1 {
            return Err(io::Error::last_os_error());
        }
        // Both descriptors are owned immediately so partial setup failures close
        // them. CLOEXEC keeps the wakeup pipe out of all student descendants.
        let mut signals = Self {
            reader: unsafe { OwnedFd::from_raw_fd(descriptors[0]) },
            _writer: unsafe { OwnedFd::from_raw_fd(descriptors[1]) },
            previous: Vec::new(),
        };
        for fd in descriptors {
            nonblocking(fd)?;
            if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } == -1 {
                return Err(io::Error::last_os_error());
            }
        }
        TERMINATED.store(0, Ordering::Relaxed);
        WAKE_FD.store(descriptors[1], Ordering::Relaxed);
        for signal in [libc::SIGCHLD, libc::SIGHUP, libc::SIGINT, libc::SIGTERM, libc::SIGPIPE] {
            unsafe {
                let mut action: libc::sigaction = std::mem::zeroed();
                let mut previous = std::mem::zeroed();
                action.sa_sigaction = if signal == libc::SIGPIPE {
                    libc::SIG_IGN
                } else {
                    handler as *const () as usize
                };
                libc::sigemptyset(&mut action.sa_mask);
                if libc::sigaction(signal, &action, &mut previous) == -1 {
                    return Err(io::Error::last_os_error());
                }
                signals.previous.push((signal, previous));
            }
        }
        Ok(signals)
    }

    pub fn fd(&self) -> RawFd {
        self.reader.as_raw_fd()
    }

    pub fn drain(&self) {
        let mut bytes = [0_u8; 256];
        loop {
            let count = unsafe { libc::read(self.fd(), bytes.as_mut_ptr().cast(), bytes.len()) };
            if count <= 0 {
                if count == -1 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                break;
            }
        }
    }

    pub fn check(&self) -> Result<(), Error> {
        match TERMINATED.load(Ordering::Relaxed) {
            0 => Ok(()),
            signal => Err(Error::Interrupted(signal)),
        }
    }
}

impl Drop for Signals {
    fn drop(&mut self) {
        // Restore handlers before closing their descriptors. Each invocation has
        // one signal owner, installed before the first child and kept through cleanup.
        for (signal, previous) in self.previous.iter().rev() {
            unsafe { libc::sigaction(*signal, previous, std::ptr::null_mut()) };
        }
        WAKE_FD.store(-1, Ordering::Relaxed);
    }
}

pub fn signal(pid: u32, signal: i32) {
    // A process disappearing between snapshot and kill is expected during cleanup.
    unsafe { libc::kill(pid as libc::pid_t, signal) };
}

#[cfg(target_os = "linux")]
fn process_parents() -> io::Result<Vec<(u32, u32)>> {
    let mut parents = Vec::new();
    for entry in fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Ok(stat) = fs::read(entry.path().join("stat")) else {
            continue;
        };
        // comm may contain spaces and closing parentheses. Its final ')' is the
        // delimiter before the state and PPID fields, which contain no parentheses.
        let Some(close) = stat.iter().rposition(|&byte| byte == b')') else {
            continue;
        };
        let Some(ppid) = stat[close + 1..]
            .split(|b| b.is_ascii_whitespace())
            .filter(|s| !s.is_empty())
            .nth(1)
            .and_then(|s| std::str::from_utf8(s).ok())
            .and_then(|s| s.parse().ok())
        else {
            continue;
        };
        parents.push((pid, ppid));
    }
    Ok(parents)
}

#[cfg(target_os = "macos")]
fn process_parents() -> io::Result<Vec<(u32, u32)>> {
    let output = Command::new("/bin/ps").args(["-e", "-o", "pid=", "-o", "ppid="]).output()?;
    if !output.status.success() {
        return Err(io::Error::other("cannot enumerate descendants with ps"));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            Some((fields.next()?.parse().ok()?, fields.next()?.parse().ok()?))
        })
        .collect())
}

pub fn descendants(root: u32) -> io::Result<Vec<u32>> {
    let parents = process_parents()?;
    let mut result = vec![root];
    let mut i = 0;
    while i < result.len() {
        let parent = result[i];
        for &(pid, ppid) in &parents {
            if ppid == parent && !result.contains(&pid) {
                result.push(pid);
            }
        }
        i += 1;
    }
    result.remove(0);
    Ok(result)
}
