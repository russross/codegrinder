Server semantics
================

This document defines the operation boundaries and invariants to preserve when changing the Rust TA and daycare server. The wire contract is [codegrinder.proto](../protocol/codegrinder.proto); database policy is defined in [schema.sql](../setup/schema.sql). Client obligations are documented for [grind](../grind/NOTES.md), [web](../www/web/NOTES.md), and [exam](../www/exam/NOTES.md). Protocol changes require explicit approval.


Identity, state, and authority
------------------------------

An assignment is identified by `(user_id, course_id, problem_set_id)`. A saved problem step adds `(problem_id, step_number)`. There is one current commit per assignment problem step; saves replace its complete file set rather than append an immutable history. Creation time is retained on update; persistence timestamps come from the server.

Problem sets define the scope of scoring and progression. A set contains complete problems with weights, or an inclusive step slice of exactly one problem. A slice beginning after step one must continue a slice of the same problem ending immediately before it. Commits remain under their original assignment keys; continuation never migrates them.

The TA owns identity, authorization, canonical files, ownership, sequencing, persistence, and LMS bookkeeping. The daycare executes signed requests without querying assignment state. Clients transport signed bundles between the two. Browser execution and client-reported scores are never grading authority.

File maps contain normalized relative paths and byte contents. Reject invalid paths and normalization collisions before persistence or packaging. Submitted student paths must belong to the step's solution whitelist. System files and arbitrary extra files cannot become student-owned through a save. Contents are opaque bytes; author whitespace is not normalized.


Startup and request transactions
--------------------------------

1. Load configuration and open the existing SQLite database. Run full `ANALYZE` with no analysis limit on every startup, refreshing persisted planner statistics including STAT4 before accepting requests; failure aborts startup. Enable TA, daycare, or both; omitting both role flags enables both. The production database/schema must already be provisioned.
2. Bind cleartext HTTP/h2c on `localhost:1400` by default. Caddy terminates public TLS, serves static assets, and supplies trusted forwarding information. Public HTTPS and certificates do not belong to the Rust process.
3. Enable only the selected role's operations. TA requests perform authentication and short database work; daycare requests can run for the duration of student execution without occupying a TA transaction.
4. Start daycare registration when configured and recover eligible pending/failed LMS passbacks when the TA starts. These activities must not block normal request handling on external services.

Each database job opens its own connection on a blocking worker. Reads use `BEGIN`; potential writers use `BEGIN IMMEDIATE` before reading their mutation snapshot. A successful operation commits, and an error rolls back. Foreign keys, WAL, and full synchronous writes are enabled. gRPC deadlines cover connection setup, lock waits, SQL progress, and awaiting the worker.

Authentication can have a separate transaction from the requested operation. A multi-RPC workflow is not one transaction: a pre-execution save can succeed even if daycare or final persistence later fails. No transaction may span Docker execution, an LMS HTTP request, a client round trip, or a retry delay. A lost response is not proof that its transaction did not commit.


LMS launch and session establishment
------------------------------------

1. Parse the launch UI and problem-set identifier, reconstruct the public launch URL using proxy headers, and verify the LTI OAuth signature. Restricted launches additionally enforce approved IP ranges, with the instructor launch exception.
2. In one write transaction, resolve the problem set and upsert the course, user, course roles, and assignment. Refresh the LMS title, outcome target, restriction flag, and unlock/due/lock times. The bootstrap launch updates course/user membership without creating an assignment.
3. Commit before issuing the short-lived, one-use login token and redirecting to the selected UI with the assignment key and token. A continuation whose prerequisite is unfinished still gets its assignment row.
4. `Hello(token)` consumes the token and creates a database-backed session, returning the raw session key, authenticated identity, role flags, and client version policy. Subsequent `Hello` calls use an empty token and `authorization: Bearer SESSION_KEY`; they validate the session and need not return a replacement key.
5. Authenticate subsequent protected TA requests from that metadata. Cached client roles, request user IDs, cookies, and possession of an assignment key are not authorization. Problem-type reads are public TA operations; problem-type mutations require admin access.

Tokens are in-memory launch credentials; durable sessions are database-backed. A restart may invalidate an unused launch token without invalidating all durable sessions. Session secrets and daycare signing secrets have distinct responsibilities.


Assignment discovery and workspace reads
----------------------------------------

`ListAssignments` and `GetAssignment` use the same server-owned visibility and download policy. Owners see their assignments; course instructors can inspect assignments in their courses. Restricted student assignments are filtered or denied when the request IP is not allowed. Global cached instructor visibility does not grant access to every course.

Download status distinguishes available, not open, and prerequisite not ready. Future `unlock_at` prevents student workspace downloads. A continuation requires a passing saved final step in the preceding slice for the same student and course. Course instructors bypass download timing and prerequisite restrictions. `lock_at` does not hide an assignment or block downloads, student saves, execution, or progression; it governs student LMS passback. Due dates are presentation data, not a separate execution gate.

1. `GetWorkspace` requires an explicit `CURRENT` or `STEP_START` file state; reject omitted and unknown enum values. Recheck assignment access and download availability even when the client previously listed the assignment.
2. Resolve step zero to the assignment's current in-scope step. Explicit steps must exist in the problem-set scope. Progress selects the first unpassed scoped step, or the final scoped step when all have passed.
3. For `CURRENT`, use the saved commit's file map when a commit exists, including an empty saved map. Otherwise construct step-start files. `STEP_START` always constructs the reset source rather than using the current step's saved work.
4. Construct step-start student files from the previous step's saved files, or the linked continuation's previous files, or the preceding authored solution when neither applies; overlay the current step's starter files. Step one begins with its starter files. Refresh canonical problem-type files over authored regular files and return separate system/student maps, action names, and slice bounds.
5. Return solution files only when explicitly requested and authorized for an author or instructor of the assignment's course. `include_contents=false` retains file names with empty contents; it is not a different ownership model.

Read access to an explicit step is distinct from permission to save it. Every owner save independently requires all earlier in-scope steps to have passing saved commits and rejects an earlier step once later in-scope saved work exists. A passing step requires both `report_card.passed` and score `1.0`.

Assignment scores are weighted averages: step scores within each scoped problem, then problem scores within the set. Missing scores count as zero. Out-of-scope steps cannot affect a slice's score or completion.


Workspace persistence
---------------------

1. Authenticate `SaveWorkspaceCommit`, require an assignment and empty action, and load the assignment commit policy and scoped grading context in one write transaction.
2. Enforce restricted access and validate every submitted path against the student whitelist. Ownership comes from the database view, not a rewritten request assignment key.
3. For an owner, enforce step sequencing, upsert the commit metadata, and replace its entire file set. Ignore submitted score, transcript, and report card. On an existing graded commit, a files-only save preserves the previous grading fields; it does not certify the new bytes as freshly graded.
4. Return `SAVED` only after persistence commits. An authorized non-owner inspection returns `NOT_SAVED_NOT_OWNER` without changing student state. The current policy does not return `NOT_SAVED_LOCKED` for owner saves.

This operation neither allocates a daycare bundle nor posts an LMS grade. A whitelist permits paths; it is not a requirement that the request include every permitted path.


Grade and action submission
---------------------------

1. `SaveUngradedCommit` requires the authenticated actor to match the outer `GradingCommit.user_id`. Clear caller-provided grading output and perform the same files-only owner save and sequencing checks as workspace persistence. Non-owner inspection stays non-mutating.
2. In that transaction, resolve the canonical action, container, command, parser, limits, problem options, and step context. Combine authored regular files, canonical type files, and submitted student files into a runtime snapshot. Select an eligible daycare unless a host was explicitly supplied. Failure to resolve the action or host rolls back the pre-execution save.
3. After the transaction, sign the runtime snapshot and return it with the save status. The client sends this exact envelope to its named daycare. TA session credentials are not needed by daycare, and TA/daycare do not contact each other during execution.
4. For a non-grade action, daycare events and normal stream completion are the result. There is no final grade persistence RPC. For `grade`, daycare returns a signed final bundle; the client must submit it to `SaveGradedCommit`.
5. `SaveGradedCommit` verifies the signature and authenticated actor, rechecks current access, ownership, file validation, and sequencing, then persists the signed commit's files, transcript, report card, and score in one transaction. Only a saved owner result can trigger passback. Runtime success alone is not database persistence or an LMS acknowledgement.

An execution failure can produce a signed failing report; a transport or setup failure can prevent a final bundle altogether. Neither erases a successful pre-execution save. Retrying execution is a new request subject to the daycare's single-container policy.


Daycare admission, execution, and cleanup
-----------------------------------------

Remote daycares register hostname, supported problem types, capacity, timestamp, version, and a shared-secret signature. Reject invalid signatures, zero capacity, version mismatches, and excessive clock drift. Remote leases expire after 20 seconds without renewal; local combined-process capacity is included directly. Selection requires support for every requested type and weights eligible hosts by capacity. Registration is discovery, not a reservation of an execution slot.

1. Verify the runtime envelope, host binding, required identity fields, matching commit/action, and timestamp freshness before execution. Current admission accepts at most 15 minutes of absolute timestamp drift. Validate effective resource limits.
2. Mark the new run active for its user-derived container name and preempt the preceding container before waiting for capacity. Recheck run identity after waiting and around container creation. There is intentionally at most one active container per user on a daycare; a newer request supersedes an older one.
3. Create the disposable container from an already-installed image with networking disabled, capabilities dropped, no new privileges, an unprivileged user, and memory/process/CPU/file/descriptor limits. Copy a validated tar of runtime files into the already-running container's `/home/student/`. Student workspace directories are never host mounts.
4. Execute the signed command inside the container within the action deadline. The command is split into arguments, not implicitly evaluated by a host shell. Capture bounded output and exit status, interpret the configured `xunit` or `check` report, and emit requested download-file events. Copy-out accepts regular validated files and does not follow arbitrary guest links onto the host.
5. Fill the report, transcript, score, and result timestamp. Only `grade` produces a signed final bundle. Stop/remove the container and release capacity on completion or failure. Cleanup uses the created container ID so an old request cannot remove a newer container through a reused name; clear active-run bookkeeping only for the matching run.

Output events are not a bidirectional terminal protocol. Downloaded artifacts are events, not automatic replacements for the signed commit's submitted files. Browser CORS support belongs at this execution boundary. Container image availability, matching secrets/hostnames, sufficient disk space, and a functioning container command are deployment dependencies.


LMS passback and recovery
-------------------------

After graded persistence commits, a separate short transaction determines passback work and records its state. A locked assignment records the lock reason; a missing outcome target records the no-target reason. Otherwise record pending, calculate the assignment score, and prepare the report before scheduling network work.

The background task signs the LMS request and retries transient failures up to ten attempts, starting at ten seconds and doubling to a five-minute cap. Permanent failures stop immediately and are recorded separately from exhausted transient failures. Success records posted in a new transaction. Startup recovery selects pending and transient-failed assignments, waits a randomized delay, and rechecks status and target availability before preparing another attempt. Permanent failures are not automatically retried at startup. Current recovery and already-scheduled retries do not recheck lock dates before each HTTP attempt; the lock decision belongs to the original submission path, not a guarantee that delivery occurs before the deadline.

The grade RPC can succeed before the LMS responds. A failure after commit cannot roll back the saved student grade. Passback state is assignment-level bookkeeping, not a guarantee of exactly-once external delivery. Relaunching from Canvas refreshes an extension; rerunning grade can then initiate passback under the updated dates.

The intended course-instructor exemption includes lock dates. Audit caveat: `accessible_assignment_commit_policy.locked` currently derives directly from `lock_at` without an instructor exception. An instructor-owned locked assignment can therefore reach the passback lock branch; this discrepancy must not be treated as the desired exemption contract.


Author preparation, validation, and save
----------------------------------------

1. Authenticate author access and accept an ordered `AuthorProblemDraft` of metadata, authored files, and `_starter/` files. `PrepareProblem` persists nothing.
2. Overlay canonical problem-type files, process hierarchical Git-style ignore rules on the effective tree, and exclude canonical collisions from authored persistence. Derive cumulative student paths from starter paths introduced so far. Every cumulative path must have an authored solution at every subsequent step. Preserve supplied bytes.
3. Build and sign a validation runtime for each step using the same runtime/commit shape as student grading. The client runs every grade validation through daycare and attaches its signed results before `SaveProblem`.
4. In one save transaction, enforce explicit create/update intent and verify exactly one step, solution commit, and signed passing validation per step. Reject missing, extra, mismatched, tampered, unsigned, or failed results before any problem rows are written. Persist solution bytes matching the prepared solution, regular bytes matching the validated runtime, and starters matching the signed bundle.
5. Create mode also creates the same-ID, one-problem default problem set with weight one and no slice. Assigned problems may change metadata and files but not step count or per-step problem type. An interactive preparation action never authorizes persistence by itself.

`SaveProblemSet` saves metadata and memberships/weights with explicit create/update intent; it does not execute validation. Enforce unary slices, adjacent continuation bounds, and existing problem references. Once assigned, membership, slice bounds, and continuation shape are immutable; metadata and weights remain editable.

Admin problem-type saves transactionally upsert retained metadata/actions/files and delete only omitted entries in the submitted complete replacement set. Do not delete/recreate the parent row. Canonical-file changes affect future workspace refreshes and runtime preparations; they are not student uploads.


Operational logging
-------------------

Operational records use stderr. New lifecycle records carry a UTC timestamp, severity, stable event name, and named fields on one line. Daycare identity is attached only after signature validation; host, actor user, assignment owner/course/problem set, problem, step, action, and a process-local run number identify each accepted run. The run number is not a protocol field or a durable identifier across restarts. TA submission records include the selected daycare host. Logs never intentionally include session keys, signed envelopes, workspace contents, or routine student stdout/stderr; output is summarized with byte counts.

An accepted daycare run logs admission, capacity acquisition with queue duration, container creation, execution outcome, cleanup outcome, and total duration. Execution duration includes container setup and workspace staging, and excludes queue wait and cleanup. Replacement of an active same-user run records both run numbers. Container creation, workspace upload, command execution, report retrieval, artifact download, stream closure, and cleanup failures retain their causes. A failed student report is an ordinary execution outcome, not by itself an infrastructure error. Output/transcript truncation records discarded counts while preserving existing capture limits.

Before container removal, bounded Docker inspection records container state, container exit code, and OOM status separately from the student command exit code. Cgroup v2 sampling reads CPU counters in microseconds, peak memory in bytes, peak process count, and memory event counters. Sampling happens while the container still exists; unavailable counters and inspection failures are explicit and cannot prevent cleanup. Container engine removal failures are reported even when the engine exits normally with a nonzero status. Diagnostic collection does not change the one-container-per-user policy or introduce workspace mounts.

The registry logs first registration, capacity/type changes, and expiry when stale entries are pruned. Unchanged renewals remain quiet. Selection failure includes requested problem types. Workspace persistence logs its returned save status; LMS bookkeeping logs locked/no-target/pending decisions and successful HTTP delivery separately from grade persistence. A decision recorded inside a transaction is provisional until commit. Unexpected gRPC errors are logged at status conversion, with operation/actor context for grade submission and persistence. Database transactions taking at least 500 milliseconds log the operation closure name, time acquiring the initial transaction lock, and subsequent transaction time; failed begin and rollback operations are explicit. Deferred read transactions can acquire later locks during SQL execution, so the initial lock duration does not measure all possible SQLite waiting.


Audit boundaries and dependencies
---------------------------------

Preserve end-to-end checks at these boundaries: unauthorized or restricted access; missing/unknown file state and invalid paths; continuation download and step sequencing; files-only saves retaining grading fields; signed validation tampering; non-owner execution without persistence; post-lock student progress without passback; overlapping same-user runs with cleanup; and passback failure/restart recovery.

The implementation trace begins in [service.rs](service.rs), [lti.rs](lti.rs), [store.rs](store.rs), [mutations.rs](mutations.rs), [daycare.rs](daycare.rs), and [passback.rs](passback.rs). These are audit entry points, not a required module arrangement. SQLite schema/views, protobuf generation, the shared Rust workspace, Caddy, installed problem types/images, and configured LMS/signing secrets are operational dependencies.

Use `make -C server check` for formatting and Clippy, then `make -C server test TEST_ARGS=...` for affected behavior. All Cargo checks/builds/tests use the release cache. Manage the local service through `doas rc-service codegrinder ...`. `make end2end` exercises deployed configuration and does not build or restart services. Cleanup must preserve persistent data; `mostlyclean` also preserves deployed executables/assets.
