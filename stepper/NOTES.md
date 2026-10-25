Rust stepper design
===================

This document specifies the implemented Rust library and standalone runner. The behavioral reference is the vendored `tests/support/stepper.sh`, copied from `problemtypes/common/stepper.sh`; tests do not depend on the problemtypes copy. `tests/stepper.sh` supplies process-level regression cases. The port preserves the shell protocol and feedback except for finer timing, the explicitly selected replacement of sed transforms with a small built-in syntax, and escaping invalid UTF-8 and XML-forbidden characters in grading reports.


Execution and storage
---------------------

Use one synchronous process, one thread, and a `poll` loop over the child's stdout, stderr, stdin when a write is pending, and a signal-notification pipe. Launch one student process per valid test. There are no reader, writer, clock, logger, or per-record helper processes. Use ordinary Rust collections and byte slices; no async runtime, regular-expression engine, XML parser, terminal library, or general event framework.

Read one transcript into a byte vector. Records refer to ranges in that vector rather than allocating individual strings. Retain each captured stream in a growing byte vector, with offsets for scanning complete lines and committing matched bytes. This makes comparisons and failure-context slicing straightforward. Keep data for only the current case. Ordinary successful dialogue is written and flushed immediately and need not be retained for grading. Retain the substituted command and final failure text, which are the parts needed by XML.

There are no temporary capture files or private working directories. A grading run retains serialized testcase elements until publishing the report through a temporary file in the destination directory. Memory is proportional to the current transcript, its captured output, and accumulated report text. The 20,000-byte failure display limit is not a capture quota. Do not silently introduce a quota or truncate comparison data. Measure real workloads before adding compaction, spooling, or resource-limit configuration.

Use `std` for storage, filesystem operations, monotonic time, and process creation. `libc` is the sole dependency for platform declarations and direct calls such as `poll`, `fcntl`, `sigaction`, `read`, `write`, and `kill`. Unsafe descriptor operations and platform differences live in the private `sys` module. The invocation guard sets umask before creating any files or children and restores it afterward. Use `OwnedFd` for owned signal-pipe descriptors and standard owned child-pipe types for student I/O; keep raw descriptor borrowing local to system calls.

The alternatives are handwritten ABI declarations, which eliminate one Cargo dependency but require maintaining target-specific layouts and constants, or `rustix`, which provides typed syscall wrappers and feature selection. The recommended `libc` approach fits the requested direct interface without hand-maintaining signal structures. Neither a dependency count nor an API style proves a smaller binary; compare release artifacts before making further size changes. API references: [libc signal declarations](https://docs.rs/libc/latest/libc/struct.sigaction.html), [rustix poll](https://docs.rs/rustix/latest/rustix/event/fn.poll.html), and [standard process creation](https://doc.rust-lang.org/std/process/struct.Command.html).


Library and multicall dispatch
------------------------------

`stepper::main() -> ExitCode` reads process arguments after `argv[0]` and delegates to `stepper::run(args) -> ExitCode`. The latter accepts an iterator of `OsString` arguments excluding the program name. Both are command-line mode entry points: they read `STEPPER_*` from the environment, use the current directory and standard streams, print diagnostics, and return the existing exit statuses. Neither exits the embedding process. Configuration and runner internals stay private.

An embedding binary examines the original invocation name before initializing its other modes. `stepper::invoked_as_stepper(&OsStr) -> bool` compares its basename with `stepper` without canonicalizing, resolving symlinks, or accessing the filesystem. A symlink named `stepper` therefore selects this mode even when the executable has another name. Other names dispatch to the host's own modes. `examples/multicall.rs` is a complete compilable dispatch example; `src/main.rs` is the standalone wrapper.

Call on the main thread before creating application worker threads. At entry, a process-local atomic guard rejects another active stepper call with status 2. It records the current umask and installs 077. Next, `Signals` installs temporary handlers, retaining the host's originals. After case execution and child cleanup, handlers restore first, then the original umask restores, then the guard releases its active flag. Ordinary failures, invalid configuration, signal interruption, and unwinding all follow the same ownership order. Successful and interrupted calls return through the host's own code. The API is not a general background service sharing process-wide signal ownership with other active subsystems.

`tests/embedding.rs` creates a separate Cargo consumer with a path dependency on the library. Its test host source is `tests/support/multicall.rs`. The host establishes a custom SIGTERM handler and umask, runs stepper via a symlink, verifies state restoration, and writes a marker after the call returns. Cases exercise success, test failure, configuration errors, interruption, and consecutive invocations. The consumer's compiled artifacts live under `target/embedding-check` for incremental reuse; its temporary sources and symlinks are removed afterward.


Data model
----------

Use closed enums for actions, streams, and failures. Use byte-oriented Unix arguments and paths (`OsString` and `PathBuf`), not UTF-8 strings for OS interfaces. The concrete types and their responsibilities are:

| Type               | Contents and invariant                                                                                       |
|--------------------|--------------------------------------------------------------------------------------------------------------|
| `Config`           | Directory, validated positive timeout, feedback/grade mode, parsed input-path template, original argv.         |
| `Invocation`       | Previous umask and exclusive ownership of the process-wide stepper invocation.                               |
| `Transcript`       | Byte arena, ordered records, per-stream record indexes, phase vector.                                         |
| `Record`           | Action and payload range including its final LF; record index plus one gives the source line.                 |
| `Phase`            | Cumulative stdout/stderr record ends and byte limits, optional next input record.                             |
| `Capture`          | Captured bytes, next scan offset, next expected record, matched byte offset, EOF flag.                         |
| `PendingInput`     | Input record index and number of bytes successfully written. At most one is active.                           |
| `Manager`          | Transcript, live process, current phase, pending/authorized input, display cursors, last progress instant.     |
| `Live`             | Child, pipe ownership, both captures, observed child exit, cleanup-completion flag.                           |
| `Failure`          | Output kind and stream, timeout stage, premature stdin closure, or nonzero exit.                              |
| `CaseResult`       | Elapsed duration and optional failure log containing command display followed by the failure report.          |

`OutputKind` has `Incorrect`, `Missing`, `Early`, and `Extra`. `WaitStage` has `Stdout`, `Stderr`, `InputDelivery`, and `Termination`. Keep the child's exit code or terminating signal distinct until rendering the shell-compatible status number. Parser errors derive source locations directly from record indexes. Runner I/O failures use `Error` separately from student failures.

Prefer explicit fields for the two stream states over a general channel registry. The display cursor traverses transcript records independently of matching. Input authorization and input completion are separate states: the shell displays input when authorized, before the writer acknowledges delivery.


Invocation through completion
-----------------------------

1. Parse environment settings and argv. Defaults remain `STEPPER_DIR=inputs`, `STEPPER_TIMEOUT=5`, and `STEPPER_GRADE=false`. Unset or empty settings take their defaults, as with shell `:-`. Keep timeout input as positive integer seconds initially; improve clock precision without expanding configuration syntax. Only literal `true` and `false` are valid grading values. Accept one optional leading `--`; require at least one command argument. `STEPPER_CMD` is not an input to stepper. Preserve working directory, inherited environment, `LC_ALL=C`, and umask 077 for the child.
2. In grade mode, remove an old `test_detail.xml` before running tests, as today. Enumerate non-hidden names ending in `.transcript` directly inside the configured directory, follow symlinks when checking for regular files, and sort by filename bytes under C-locale ordering. Preserve the supplied directory spelling for command substitution. Feedback mode stops at the first failure; grade mode attempts every case. An empty directory succeeds with a 0/0 summary and the existing stderr warning; grade mode still publishes an empty report.
3. Validate and compile each transcript before spawning its child. Reject NUL anywhere, any record without the exact `< `, `> `, or `! ` prefix, and a nonempty file without a final LF. Empty transcripts are valid. Preserve CR, tabs, non-UTF-8 bytes, whitespace, and backslashes. An empty payload still represents one LF. Output records build independent ordered stdout/stderr sequences. Each input record terminates a phase; append a final phase without input. Adjacent inputs therefore produce empty output phases.
4. Expand the input-path template, replace every `@INPUT@` occurrence in each original command argument, and print the literal `$` command display. Preserve each argument boundary; never shell-parse or evaluate it. Launch the process with three anonymous pipes, close child-side descriptors in the parent, and make only the parent-side descriptors nonblocking. The student's standard descriptors remain blocking. With no input records, close stdin immediately.
5. Drive the phase machine until pass or failure, snapshot any already-observed exit status, stop and reap the process as necessary, and render the outcome. Print a blank line after each attempted case. Accumulate attempted, failed, total discovered, and elapsed time. Emit the existing colored summary and, in grade mode, publish XML. Exit 0 for all passes, 1 for test failures, 2 for runner setup/report errors, and 128 plus the signal number for HUP, INT, or TERM.

Compilation errors remain failed cases and do not launch a child. Their diagnostics preserve the existing wording. A missing or non-executable command is a failed student launch, with shell-compatible 127/126 classification, rather than terminating the whole grading run. Launch-error feedback says `cannot execute command`, includes the OS error, and reports the classified exit status. Exact launch-error prose differs from shell-generated diagnostics.

Executable shell text without a shebang works through libc automatically on macOS. Musl returns `ENOEXEC`, so that specific launch error retries `/bin/sh -c 'exec "$0" "$@"'` with the original command and arguments supplied separately. The shell command is fixed and never interpolates argv. This rare retry may create an additional failed launch process; ordinary execution still creates one child per case. Tests cover relative and PATH-resolved scripts with literal shell syntax in their arguments.


Input-path template
-------------------

The sed-program interface in `STEPPER_INPUT_TRANSFORM` is replaced with a template. Default: `@STEM@.input`. `@STEM@` expands to the entire transcript path with its final `.transcript` suffix removed; `@TRANSCRIPT@` expands to the unchanged transcript path; `@@` produces a literal `@`. Everything else is literal, and unknown or unclosed tokens are configuration errors. Expansion is one pass: substituted bytes are not scanned for more tokens.

For `inputs/easy1.transcript`, the default produces `inputs/easy1.input`; `@TRANSCRIPT@.data` produces `inputs/easy1.transcript.data`. This preserves directories and spaces without a path-normalization step. The transformed path need not exist: stepper only substitutes it into argv. Existing custom sed settings require migration. The Sudoku Makefile has no custom transform and needs no setting change.


Phase machine and pipe handling
-------------------------------

Read stdout and stderr in bounded chunks, with a bounded amount of work per iteration so one busy stream cannot starve the other stream, input delivery, signals, or timeout checks. Keep scan offsets so partial lines are not rescanned from the beginning on every read. Retry interrupted operations, treat `EAGAIN` as pending work, treat zero-byte reads as EOF, and drain readable bytes on hangup before accepting EOF. A hangup notification alone is not proof that all bytes have been read.

Within each iteration, process input completion, then match up to 64 stdout records, display available progress, match up to 64 stderr records, and display again. Preserve stdout-first failure precedence when both failures are already visible. A complete LF-terminated line compares byte-for-byte with its expected payload. At EOF, an unterminated tail is an actual record and mismatches an expected LF-terminated record. EOF with no remaining actual record while expected records remain is `Missing`.

Do not accept a line until it is complete. In particular, a partial prefix that differs from expected output does not immediately become a mismatch unless the stream exceeds its phase byte allowance. This preserves timeout and partial-line behavior. Binary bytes participate directly in comparison; no secondary raw-file verification is needed.

After matching, check input errors and each captured stream's total byte count against its current cumulative phase allowance. Excess bytes are `Incorrect` if that stream still has expected records in this phase, `Early` if input is the next boundary, or `Extra` in the final phase. This check includes partial lines. An implementation must process already-buffered records without waiting for another kernel readiness notification.

When both output ends are matched and no previous input is pending, authorize the next input unless child exit has already been observed. Advance the phase before the first write, display the input record in transcript order, and write until complete or until the pipe would block. Partial writes do not acknowledge the record or reset the timeout. A fully written record does both. Close stdin immediately after fully writing the final input. Never authorize another input while one is pending. `EPIPE` becomes premature input closure; SIGPIPE must not kill the runner.

Pass requires all expected records matched, no extra captured bytes, all inputs delivered, stdin closed, EOF on both output streams, and a zero child exit status. Child exit alone is insufficient because unread data or inherited pipe descriptors may remain. The byte-exact matching and final byte counts establish complete-stream equality without rereading raw files.

Phase boundaries describe observation, not proof of the student's read ordering. The shell has the same scheduling limitation. Do not promise identical outcomes for programs whose correctness depends on racing the input boundary. Preserve deterministic ordering rules and test boundary behavior with explicit synchronization.


Timing, signals, and cleanup
---------------------------

Use monotonic `Instant` values. Reset the inactivity deadline only when a complete expected output record matches or a complete input record is delivered. Arbitrary arriving bytes, partial writes, child exit, and EOF do not reset it. Derive each `poll` timeout from the remaining duration, rounding upward to milliseconds and rechecking the monotonic deadline after wakeup. Timeout diagnostic priority remains stdout, stderr, input delivery, then termination.

Measure execution from just before spawn until the phase machine decides the result. Exclude parsing and cleanup grace from case time. Render seconds with three fractional digits in testcase attributes and the summary; sum unrounded durations before formatting the total. This is the intended timing change from integer clock ticks.

Install signal handlers for SIGCHLD, HUP, INT, and TERM using a nonblocking self-pipe and signal-safe pending flags. Handlers only record notification and attempt a wakeup; they do not allocate, format, or perform cleanup. Preserve errno and handle a full pipe without losing pending termination state. Install handlers before launching children and call `Child::try_wait` after wakeups, including immediately after spawn, to cover very short-lived children. Keep descriptor inheritance and handler lifetime explicit. Avoid two competing owners calling wait for the same child.

On failure or interruption, record any exit status observed before cleanup. Snapshot the live descendant tree while parents still exist, send TERM to descendants and the direct child, allow the existing one-second grace, then KILL survivors and reap the direct child. Continue draining streams during grace so cleanup handlers do not block on full pipes. Bound this cleanup by time and per-iteration work. The report can include bytes captured during cleanup, but must never present cleanup-induced exit status as a student failure.

For Linux, enumerate PID/PPID relationships directly through `/proc`; parse `/proc/PID/stat` with its parenthesized command field correctly and tolerate processes disappearing during the snapshot. For macOS development, a single `ps` invocation during cleanup is an acceptable portability fallback. No `ps`, `awk`, or sleep subprocess is needed on the Alpine execution path. Best-effort descendant cleanup retains the existing limitation for processes already orphaned or deliberately detached. Process-group isolation would simplify cleanup but change child-visible job-control behavior; it is not required for this compatibility design.


Feedback and XML
----------------

Write ANSI codes directly, including when stdout is redirected. Preserve default stdout foreground, cyan stdin, magenta stderr, inverse actual failure context, dim newline markers, and the existing green success and red failure/summary sequences. Emit each successfully available transcript record in original transcript order and flush it before waiting for further student activity. Console writes retain ordinary downstream backpressure; pipe readiness alone cannot make an arbitrarily blocked console sink safe to write.

Render LF as a visible `⏎` followed by a real newline; render tab and CR as `\t` and `\r`; render other bytes below 32 and DEL as three-digit octal escapes. Preserve other bytes literally. Append the dim ` [no newline]` marker for unfinished fragments. Keep the exact existing punctuation, transition text, status suffixes, and blank-line placement.

For output failure context, start at the failing stream's last matched byte. Take at most 20,000 raw bytes, then at most five rendered lines. Detect omitted bytes or lines and emit the existing truncation notice. Expected context takes at most five expected records from the current phase and then applies the byte limit; it never crosses unsent input. After detailed context, the final failure reason is `incorrect stdout` or `incorrect stderr`. Preserve timeout/input-closure messages and append an observed nonzero status as today.

Serialize the fixed JUnit structure directly with small writer functions and literal templates. Escape `&`, `<`, `>`, double quote, and apostrophe in dynamic values. No XML parser, DOM, schema machinery, or general-purpose template engine is needed. Successful cases have name/time only; failed cases add `status="failed"` and `<failure type="failure">`. Retain testsuites/testsuite counts, errors/skipped/disabled attributes, and the XML declaration. Failure content contains the substituted command and failure report, excluding preceding successful dialogue; compilation failures contain their available failure text.

For compatibility, grading text strips sequences matching ESC followed by `[` followed by zero or more digits/semicolons and `m`, then octal-escapes control bytes except tab/LF, then XML-escapes. This applies to literal command arguments as well as generated formatting. Implement the recognizer directly without regex.

The shell can emit invalid XML for invalid UTF-8 bytes or XML-forbidden Unicode characters because it preserves all high bytes. The Rust port fixes this: decode valid UTF-8 prefixes, preserve characters allowed by XML 1.0, and octal-escape each original byte in invalid UTF-8 sequences or encoded forbidden characters. Apply this to failure content and testcase names. Attribute whitespace uses numeric character references so XML attribute normalization does not alter filenames. Tests independently parse generated reports with `xmllint` when available.

Create the report temporary file with exclusive creation and mode 0600 in the report directory, write and close it successfully, then rename to `test_detail.xml`. Remove the temporary file on failure/interruption. Same-directory rename is the publication boundary; crash durability beyond existing behavior does not require fsync. Report-writing failures are runner errors, not student failures.


Files and interfaces
--------------------

The top-level `stepper/` directory is the permanent source for one Cargo package containing a reusable Rust library and a thin standalone binary. It belongs to the repository workspace, shares its dependency versions, Cargo.lock, release cache, and formatting rules, and has no build script.

| File                | Main interface and responsibility                                                                 |
|---------------------|---------------------------------------------------------------------------------------------------|
| `src/lib.rs`        | Public mode entry points and invocation-name check; private CLI/configuration/orchestration.         |
| `src/main.rs`       | `main() -> ExitCode`, delegating to `stepper::main()`.                                               |
| `src/transcript.rs` | `Transcript::parse(bytes: Vec<u8>) -> Result<Transcript, String>`; validation and phase construction. |
| `src/runner.rs`     | `run_case(config, transcript, argv, signals, out) -> Result<CaseResult, Error>`; child and phase loop. |
| `src/sys.rs`        | Nonblocking descriptor setup, polling, signal wakeups, process-tree cleanup; localized unsafe code. |
| `src/feedback.rs`   | Byte rendering, ordered live feedback, context selection, diagnostic text.                          |
| `src/report.rs`     | `Report::case`, `Report::publish`, byte escaping, fixed XML serialization, temporary-file guard.      |

`run_case` returns `Result<CaseResult, Error>` so runner infrastructure failures are distinguished from an ordinary failed test. Configuration and the small input template parser live beside orchestration. Rendering accepts byte slices and explicit stream/style arguments; tests can target an in-memory writer without a terminal.

Deployment builds
-----------------

`make -C stepper` and `make -C stepper build` publish `dist/stepper.linux_amd64` and `dist/stepper.linux_riscv64`. The root `make build` includes both. Cargo tracks source, dependency, and compiler setting changes on every invocation; publication preserves output timestamps when bytes are unchanged. `amd64` and `riscv64` select individual artifacts. Builds require cargo-zigbuild, Zig, and Rust standard libraries for `x86_64-unknown-linux-musl` and `riscv64gc-unknown-linux-musl`.

The workspace's explicit `standalone-linux` release profile uses size optimization (`z`), whole-program LTO, one codegen unit, and stripped symbols. Standalone panics abort to omit unwind machinery; ordinary errors and interruption still return through ownership guards. These settings are selected only by standalone deployment builds. Grind embeds the library under its existing build profiles and rules; the runner dispatch occurs before Tokio or client configuration. Original invocation basename `stepper`, including a symlink, selects the runner; other names select grind.

The amd64 artifact explicitly links the C runtime statically and has no interpreter or shared-library dependencies. The RISC-V artifact explicitly disables `crt-static` and passes `-dynamic` to Zig: disabling Rust's flag alone still produces a static Zig/musl executable. The dynamic runner uses `/lib/ld-musl-riscv64.so.1` and requires only musl (`libc.so`), already supplied by both Alpine guests, with no additional runtime packages. On Rust 1.99.1/Zig 0.16.0, matching abort-profile RISC-V builds measured 378,944 bytes dynamic versus 394,976 bytes static. The dynamic choice saves 16,032 guest bytes. Inspect artifacts again when changing toolchains or profiles.

The c and riscv grading-container Make rules build the amd64 runner, copy it into each Docker context, and install it as `/usr/local/stepper`. Both exam guest images depend on the RISC-V artifact and copy it to the same path during fakeroot staging. Rebuilding an unchanged runner does not rebuild containers or guests. Problem types do not yet invoke the Rust runner.

`mostlyclean` removes shared Cargo intermediates while preserving native grind/server executables and published standalone runners. `clean` also removes the stepper dist directory. Configuration, databases, and already deployed container/guest assets are outside stepper cleanup.


Validation
----------

1. Run `make -C stepper check` for workspace formatting and release Clippy across all targets, then `make -C stepper test-only` for library, process, and embedding tests. Select tests with `TEST_ARGS`. The downstream-consumer fixture builds in release mode, offline, with cached artifacts under the repository `target/embedding-check` directory.
2. Run `STEPPER_RUNNER="$PWD/stepper/dist/stepper.linux_amd64" sh stepper/tests/stepper.sh "$PWD/stepper/tests/run-binary.sh"` from the repository root for the original 31-case process suite. The adapter discards the reference script argument and directly executes the runner. `sh stepper/tests/stepper.sh sh` selects the vendored shell reference.
3. Inspect deployment ELF machine types, interpreters, and shared-library requirements. Execute the amd64 artifact on Alpine and the RISC-V artifact in an exam guest. Validate the grind executable through a symlink named stepper as well as its ordinary version command.

Tests cover byte-exact output, simultaneous streams, input phases, blocking child descriptors, partial-output timeouts, inherited pipes, literal arguments, report publication, executable launch failures, and descendant signal cleanup. XML tests cover invalid UTF-8, forbidden Unicode, controls, markup, arguments, and filenames. The embedding fixture checks repeated calls, symlink dispatch, restored umask and signals, and returned statuses after success, failure, invalid settings, and interruption. The shell reference is test data and may remain after the production shell runner is removed.
