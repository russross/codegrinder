Stepper regression checks
=========================

Run formatting and lint checks before tests, from the repository root:

    make -C stepper check
    make -C stepper test-only

Unit tests exercise the input-path template and XML byte/character escaping. Integration tests launch real processes to exercise simultaneous output streams, consecutive input records, partial-output timeouts, inherited output descriptors, literal argv substitution, report publication, executable launch failures, and signal cleanup. XML cases cover invalid UTF-8, forbidden Unicode, controls, markup, arguments, and filenames. Invalid-byte filename tests run on Linux because APFS rejects those names. When available, `xmllint` independently parses the resulting reports.

The integration suite also compares deterministic successful and failed console feedback byte-for-byte with the vendored `tests/support/stepper.sh` shell reference, excluding the summary containing elapsed time.

`tests/embedding.rs` compiles a separate temporary Cargo package with stepper as a path dependency. Its host binary selects stepper through a symlink's name, runs successful and failed cases, handles invalid settings and interruption, and checks that library calls return with the original umask and signal handler restored. Two consecutive invocations check that process ownership is released between calls. This consumer build uses cached dependencies in offline mode and stores compiler outputs under the repository `target/embedding-check` for incremental reuse. Its test-only host source is in `tests/support/multicall.rs` and is included as text rather than as a module.


Original process suite
----------------------

Run the original 31-case suite against the compiled executable:

    make -C stepper amd64
    STEPPER_RUNNER="$PWD/stepper/dist/stepper.linux_amd64" sh stepper/tests/stepper.sh "$PWD/stepper/tests/run-binary.sh"

The adapter discards the reference script argument and executes the selected binary. It preserves process ownership for the interruption tests. Use an absolute `STEPPER_RUNNER` path because fixtures change the working directory.

Run the same cases against the shell reference:

    sh stepper/tests/stepper.sh sh

The optional argument selects the interpreter for `stepper.sh`. On Alpine, the normal `sh` is BusyBox ash. The suite uses standard Unix utilities and validates XML with `xmllint` when installed.

The cases cover EOF without input and after final input, empty transcripts, live feedback in both modes, stream interleaving and display order, mismatches, partial lines, extra/binary/early output, bounded failure context, nonzero exits, missing output, inactivity timeouts, blocked or closed stdin, long lines, malformed transcripts, argument substitution, XML continuation, feedback counts, and interruption cleanup.


Compatibility boundaries
------------------------

Stream matching is byte-exact and ordered within each stream. Input separates phases; output beyond a phase's byte allowance fails even without a complete line. The next phase opens before its input is written. Scheduling still affects the observation of output near an input boundary; this protocol does not prove when the child consumed stdin.

Rust keeps transcripts and captured output on the heap. Context limits affect display only. Timeouts reset on complete matched output records or completed input delivery, and cover blocked writes and final termination. Descendant cleanup remains best effort for already orphaned or detached processes. Only exit status observed before cleanup appears in failure reports.

Intentional changes from the shell reference are fractional execution times, built-in input-path templates replacing sed programs, and XML-safe escaping of invalid UTF-8 and forbidden characters. A musl `ENOEXEC` launch retries through `/bin/sh` to retain executable shell-text behavior supplied by libc automatically on macOS.
