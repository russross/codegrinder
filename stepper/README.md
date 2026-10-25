Stepper
=======

Stepper runs a program against interactive transcript files and prints live, colored feedback. Grade mode attempts every case and writes `test_detail.xml` in JUnit format.

The `stepper` crate also provides the same command-line mode as a library for binaries that dispatch by their invocation name. Linux and macOS are supported.

Build and run from the repository root:

    make -C stepper
    stepper/dist/stepper.linux_amd64 -- command argument ...

The component build publishes amd64 Alpine and RISC-V 64 Linux executables under `stepper/dist/`. Both grading containers and exam guests install the matching runner as `/usr/local/stepper`. A grind executable invoked through a symlink named `stepper` also runs this mode before initializing the client. Problem types retain their existing runner configuration.

The executable uses one synchronous thread and one student process per case. It uses `std` and `libc`; normal Linux execution needs no helper utilities. Executable shell text without a shebang falls back to `/bin/sh` on an exec-format error. The macOS development build uses `ps` during failure/interruption cleanup to find descendants. Transcripts and captured output use heap buffers. The process inherits the current directory and environment, with `LC_ALL=C` and umask 077.


Embedding
---------

Add a path dependency to the host binary's Cargo manifest:

    [dependencies]
    stepper = { path = "/path/to/stepper" }

The public API consists of three functions:

| Function                           | Behavior                                                                      |
|------------------------------------|-------------------------------------------------------------------------------|
| `invoked_as_stepper(&OsStr) -> bool` | Tests whether the supplied `argv[0]` basename is exactly `stepper`.              |
| `run(args) -> ExitCode`             | Runs the CLI with `OsString` arguments excluding `argv[0]`.                     |
| `main() -> ExitCode`                | Runs the CLI using `std::env::args_os().skip(1)`.                               |

Dispatch before starting the host's worker threads. Read `argv[0]` directly; resolving the executable or symlink would lose the invocation name. [examples/multicall.rs](examples/multicall.rs) is a complete dispatch example. For a binary at `/usr/local/bin/grader`, a symlink `/usr/local/bin/stepper` can select stepper mode while the original name selects the host's other modes.

The entry points return normally after child cleanup and report their own diagnostics. Return their `ExitCode` from the host's `main`. They use the current environment, directory, and standard streams; they temporarily install signal handlers and umask 077, restoring the host's handlers and umask before returning. A second active stepper invocation is rejected. This is a command-line mode entry point intended for startup dispatch, rather than a background service API.

Build the host with its own Cargo profile and target settings. Stepper does not require size optimization, static linkage, or a particular panic strategy from the embedding binary. Cargo takes profile settings from the consuming workspace's root, as described in the [Cargo profile documentation](https://doc.rust-lang.org/cargo/reference/profiles.html).


Transcripts
-----------

Stepper reads non-hidden `*.transcript` files directly inside `inputs`, sorted by filename bytes. Each record ends with LF and begins with one of these exact prefixes:

    > expected stdout line
    ! expected stderr line
    < input line

Whitespace and bytes after the prefix are significant. NUL bytes and unterminated transcript records are rejected. Output order is independent between stdout and stderr. Both streams must match the current phase before the next input is sent. Stepper closes stdin after the last input, requires output EOF and a zero exit status, and rejects extra output. Empty transcripts are valid.

ANSI feedback is always enabled. Output comparisons preserve raw bytes; displayed control bytes are escaped. Failure context is limited to five lines and 20,000 raw bytes per block. Captured data itself has no quota.


Configuration
-------------

| Environment variable      | Default         | Meaning                                                      |
|---------------------------|-----------------|--------------------------------------------------------------|
| `STEPPER_DIR`             | `inputs`        | Directory containing transcripts.                             |
| `STEPPER_TIMEOUT`         | `5`             | Positive integer inactivity timeout in seconds.               |
| `STEPPER_GRADE`           | `false`         | `true` runs all cases and publishes XML; `false` stops early.  |
| `STEPPER_INPUT_TRANSFORM` | `@STEM@.input`  | Template for the path substituted at each `@INPUT@` in argv.  |

Unset and empty settings use defaults. The timer resets only after a complete expected output record matches or a complete input record is delivered. Durations use three fractional digits. Exit codes are 0 for success, 1 for test failures, 2 for runner errors, and 128 plus the signal number for HUP, INT, or TERM.

The input-path template supports `@STEM@` for the complete transcript path without its `.transcript` suffix, `@TRANSCRIPT@` for the unchanged path, and `@@` for a literal at sign. Other content is literal; unknown or unclosed tokens are errors. Expansion is single-pass. For example, `inputs/easy1.transcript` becomes `inputs/easy1.input` by default. Each argv element remains one argument, and no shell evaluation occurs.

This template syntax replaces the shell runner's sed-program setting. Migrate custom `STEPPER_INPUT_TRANSFORM` values before switching runners. `STEPPER_CMD` belongs to the calling Makefile and is not read by stepper.

JUnit logs preserve valid XML 1.0 Unicode and octal-escape invalid UTF-8 bytes and XML-forbidden characters. Filenames receive the same validation. ANSI formatting is removed from failure logs; successful dialogue is omitted. The report is published through an exclusively created temporary file and a same-directory rename.


Checks and deployment
---------------------

From the repository root:

    make -C stepper check
    make -C stepper test-only

See [tests/README.md](tests/README.md) for process regression tests. [NOTES.md](NOTES.md) specifies the execution flow and compatibility invariants.

`make -C stepper build` produces both standalone deployment binaries. `amd64` and `riscv64` select one architecture. Builds use the shared Cargo.lock and target cache, cargo-zigbuild, Zig, and the installed Rust standard libraries for `x86_64-unknown-linux-musl` and `riscv64gc-unknown-linux-musl`.

The workspace's `standalone-linux` release profile selects size optimization, LTO, one codegen unit, stripped symbols, and aborting panics. Grind embeds the library using its existing release profile and distribution rules. `mostlyclean` preserves published runners; `clean` also removes `stepper/dist/`. Rust and Zig are needed only at build time.
