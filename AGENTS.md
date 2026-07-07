# General project rules

Core architecture metaphors:

- The main server is the TA: a university course teaching assistant responsible for bookkeeping, grade management, problem sets, assignments, LMS integration, and mediation between students, instructors, and authors. The TA should be a lightweight administrative functionary, not the place for long-running work or broad execution policy. Database transactions must be short-lived and must not block on external network connections.
- Student code is treated like an unruly toddler: usually not malicious, but often reckless and unsafe by default. The system supervising it is a nanny, focused on resource limits, damage prevention, and containment.
- A daycare manages nannies and student-code execution. Daycares are stateless, disposable islands for sandboxing, isolation, cleanup, and crowd control. They should have few policy opinions and should not need detailed knowledge of assignments beyond the signed runtime bundle they are asked to run.
- The TA is the real server. Daycares are add-ons that phone home to register with the TA using a shared secret and lease timeout. We support multiple daycares, and operators should be able to reset or replace them freely.
- In the common deployment, one TA and one daycare often run as a single process on one machine. They remain logically independent: long-running daycare requests must not interfere with quick TA transactions.
- Clients shuttle signed messages and file sets between the TA and daycares. Daycares and the TA do not communicate directly during grading/action execution.
- CORS for browser clients belongs at the daycare boundary, not the TA boundary.
- TA and daycare deployments are easy to update together, so protocol migration between them is not a major concern. Student clients are harder to update and run in the wild, so version requirements matter and clients must not be trusted.

Daycare container concurrency policy:

- A daycare intentionally allows only one active execution container per user.
- Execution container names intentionally include the user id, so Docker refuses to create a second concurrent container for the same user.
- A later session always kills an earlier session for the same user. This is policy, not an accidental implementation detail.
- Do not "fix" race conditions by removing the user id from container names, making names unique per session, or otherwise allowing multiple active containers for one user. This single-container policy has repeatedly exposed real race conditions; preserve it and fix those races at their source.

Daycare container lifecycle policy:

- Student runtime files should be staged into the already-running container with `docker cp` or the equivalent Docker API operation, then executed inside the container.
- Do not bind mount, volume mount, or tmpfs mount student workspace directories into daycare containers unless explicitly directed. The robust deployed model is that the runtime workspace lives inside the container.
- Keep daycare containers disposable and self-contained: create the container, copy in the runtime workspace, run the requested command inside it, copy out only the required results, and remove the container when the session ends.

For Rust server startup and checks:

- The production server lives under `server/` as the Rust `codegrinder-server` crate. The old Python server is kept only for port comparison under `pyserver/`.
- The Rust server is not public-facing. Caddy is the public TLS front end and reverse-proxies to the Rust server over cleartext HTTP/h2c.
- The Rust server binds to `localhost:1400` by default. System startup should rely on that default unless an explicit local override is required.
- The Rust server does not load TLS certificates or manage public HTTPS. Public hostnames and certificates belong to Caddy.
- The server supports `-ta` and `-daycare` roles. Either role may be enabled alone, both may be enabled together, and omitting both role flags means both roles are enabled.
- TA role serves LTI, version/daycare-registration routes, static files, and TA gRPC methods. Daycare role serves the `Daycare` gRPC runtime path and registers the local daycare capacity when configured.
- The secondary test/dev combined TA+daycare instance is reached through Caddy at `https://dev.russross.com`.
- The end-to-end test script expects Caddy to already be running and uses `https://dev.russross.com` for all server traffic; it starts and stops only its own temporary CodeGrinder process.
- Build and check the Rust server with `cargo build -p codegrinder-server`, `cargo test -p codegrinder-server`, `cargo clippy -p codegrinder-server -- -D warnings`, and `cargo fmt --all --check`.
- Stop, start, restart, and check the local CodeGrinder server with `doas rc-service codegrinder-server ...`; do not launch ad hoc background server processes.

For Rust `grind` client checks:

- The Rust client under `grind/` is the default command-line client.
- Build and check it with `cargo build -p grind`, `cargo test -p grind`, `cargo clippy -p grind -- -D warnings`, and `cargo fmt --all --check`.
- The repo-level Rust workspace owns shared dependency versions, the single `Cargo.lock`, and the shared `target/` build cache. The repo-level `make build` and `make test` targets build and check the Rust server and the Rust `grind` client.

For database schema and queries:

- The database should be natural-join friendly. Avoid reusing a column name across tables unless it represents the same value, usually as part of a primary key or foreign key relationship.
- Prefer schema and view definitions that make policy explicit in the data model. Server queries should usually be simple reads from tables or views instead of reimplementing relationship or policy logic in Python.
- Prefer `WITHOUT ROWID` for tables with primary keys.
- Prefer `NATURAL JOIN` where the schema makes the join relationship clear. Use explicit `ON` or `USING` only when names intentionally differ, extra predicates are needed, or a natural join would obscure the relationship.
- File tables use `path` and `content` consistently because those columns represent the same logical workspace-file data across file sets.
- Treat file `content` values as potentially large. When gathering file sets, favor simple direct queries with selective predicates on keys and file metadata; avoid clever joins or broad views whose query plans might load file contents before filtering them out.

For protocol changes:

- Backware compatibility of the protocol is NOT a goal
- Always clean up/remove fields that are not actually used
- Favor flattening message data types where appropriate
- Client does not know/care about database layout—protocol should minimize leaking relational database structure
- Session authentication uses explicit raw session keys in gRPC metadata. Do not use HTTP cookies or `session_cookie` request fields for session auth.

For the exam interface under `www/exam`:

- Use the project-local Node toolchain under `www/exam/.toolchain/node/bin` for npm/proto-generation/build commands when the system `node` is unavailable or mismatched.


# `grind` Config

- `grind` config uses XDG conventions: `$XDG_CONFIG_HOME/codegrinder/config.toml`, defaulting to `~/.config/codegrinder/config.toml`.
- Do not use legacy `~/.codegrinderrc` or `~/.codegrinderinstructor` files.
- The config file is TOML and is created on login.
- Login updates the session key, server URL, and cached role flags returned by `Hello`; preserve user-editable settings such as workspace root when the file already exists.
- The workspace root setting controls where per-course assignment directories are created. Default it to `$HOME` and explicitly write that default to the config file.
- `grind get` has no assignment selector or directory override; it always uses the configured workspace root. Students who want a different root edit the config file by hand.
- Cached role flags are optional TOML boolean lines. Omit `is_instructor`, `is_author`, and `is_admin` when false; missing means `false`.

# `grind` Command Semantics

- The `grind` command surface is the contract. Every command should be described here before its behavior is changed.
- Student-visible commands are `version`, `login`, `list`, `get`, `sync`, `grade`, `action`, and `reset`.
- Cached instructor visibility additionally shows `student` in help.
- Cached author visibility additionally shows `create` and `type` in help.
- Cached admin visibility additionally shows admin-only commands, including `problemtype`, in help. The server must enforce admin permissions for every admin RPC.
- Cached instructor or author visibility additionally shows `solve` and `problem` in help.
- `--api` and `--api-dump` report or dump API traffic. They are hidden from normal student help output but remain accepted for every role and must not change command semantics.
- Hidden commands remain invokable by name. Local cached role flags are presentation only; server authorization is authoritative.
- Commands that operate on a local assignment must discover the assignment by finding `.grind` in the current directory or an ancestor.
- Multi-problem assignments require problem-specific author commands to run from inside a concrete problem directory; single-problem assignments use the assignment root as the problem directory.
- Client-side workspace path handling must normalize paths before reading or writing local files. Server-side validation remains authoritative and must reject invalid submitted paths.
- Non-login commands that load the server session must call `Hello` through the Rust session setup, enforce version checks, and use the configured session key as the authentication source.
- After a successful authenticated `Hello`, `grind` updates cached `is_instructor`, `is_author`, and `is_admin` config flags when they differ from the server response.

# `grind version`

- `grind version` performs no network calls and reads no config.
- It prints the local `grind` version as `grind {version}`.
- It must not depend on login state or server availability.

# `grind login`

- `grind login <hostname> <token>` exchanges a Canvas-provided one-time login token for a durable session key by calling `Hello` against the given host.
- `grind login` with any argument shape other than exactly host and token prints login guidance and fails.
- The server validates the login token, creates a database-backed session, returns the authenticated user, session key, and version policy.
- `grind` must reject an empty user response and must run normal version compatibility checks before writing config.
- Login creates or updates the XDG TOML config. It updates host, session key, and cached role flags from `Hello`, and preserves user-editable settings such as workspace root.
- A successful login prints the authenticated user's display name.

# `grind list`

- `grind list` takes no arguments.
- It lists assignments visible to the logged-in user by calling `ListAssignments` with no search terms and without student context.
- The server owns assignment visibility, ordering-independent content, availability status, due dates, and user authorization.
- Some assignments may be hidden from the student by the server when their IP address is filtered, but instructors see all assignments for the courses where they are instructors
- `grind` sorts the returned assignment items for presentation only; sorting must not change which assignments exist or which are downloadable.
- `grind` keeps per-course headers, then displays each assignment with the Canvas assignment title, aligned integer completion percentage from the server assignment score, and the configured workspace path using `~` for the home directory when applicable.
- Per-assignment `grind list` output must not include numbered list prefixes.
- If no assignments are returned, `grind` explains that assignments must be launched from Canvas before command-line access.


# Assignment Availability and Locking

- Assignment download availability is server-provided in list responses and should be derived consistently from database views. `grind` should not duplicate open/locked time policy.
- `unlock_at` controls whether an assignment is available for download. If it is present and in the future, the server should mark the assignment unavailable for download and refuse workspace download.
- Problem-set continuation prerequisites also affect download availability. If a sliced problem set continues an earlier sliced problem set and the required previous step is not passed, the server should mark the assignment `ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY` and refuse workspace download.
- LMS launch should still create or update the assignment row for a prerequisite-blocked continuation; readiness is enforced by `ListAssignments`, `GetAssignment`, and `GetWorkspace`, not by rejecting the launch.
- `lock_at` does not hide assignments and does not prevent workspace download, persistence, step advancement, continuation prerequisites, or daycare actions, including grade.
- After `lock_at`, student-owned assignment commits must still be persisted so students can continue making progress through steps and across continued problem sets.
- After `lock_at`, LMS grade passback must not run for students. A later extension can be picked up by relaunching the assignment from the LMS and then rerunning the latest grade action.
- The database records grade passback state for admin inspection. At minimum it distinguishes posted, post pending, not posted because no LMS postback target is available, and not posted because the assignment lock date has passed.
- After a locked `grind grade`, the final line shown to the student must clearly say the grade was not posted to the LMS because the assignment is locked.
- `lock_at` and `unlock_at` do not apply to instructors for the course.


# `grind get`

- `grind get` downloads all currently available assignments owned by the logged-in user into the configured workspace root.
- `grind` must use `ListAssignments` download status to decide which assignments to attempt; it must not reimplement `unlock_at` policy.
- `GetAssignment` must also report assignment download status so assignment summaries and workspace download use one server-owned availability concept.
- The server must enforce download availability again in `GetWorkspace`; list filtering is not a security boundary.
- Assignment directories are `$workspace_root/$course_directory/$problem_set_id`.
- Downloads must stage into a temporary sibling directory and rename into place only after all files and `.grind` metadata are written.
- A partially downloaded assignment directory without valid `.grind` metadata must not be treated as a completed assignment.
- `.grind` is TOML. It records assignment identity and per-problem `problem_id` and current `step`; assignment progress does not expose full problem `total_steps`.
- Existing assignment directories are skipped only when `.grind` assignment identity and problem metadata match the server's current assignment summary.
- Workspace file state has three current meanings: unspecified/missing request state, current saved/student state, and step-start reset state.
- `WORKSPACE_FILE_STATE_UNSPECIFIED` means the caller omitted a required choice and `GetWorkspace` must reject it.
- `GetWorkspace` must reject unspecified and unknown file-state enum values.
- Workspace paths returned by the server and written by `grind` must be relative, normalized, and must not contain absolute paths, `.` components, `..` components, or backslashes.
- `lock_at` does not prevent `grind get`; only `unlock_at` controls download availability, and only for students.
- `grind get` skips `ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY` assignments and prints a warning that the prerequisite assignment is not ready.

# `grind sync`

- `grind sync` has no arguments.
- `grind` must resolve the current problem from `.grind`, fetch `GetWorkspace` with `WORKSPACE_FILE_STATE_CURRENT`, refresh system-owned files, and submit only student-owned files.
- `grind sync` must call `SaveWorkspaceCommit`, not `SaveUngradedCommit`; sync is persistence only and must not receive or create a signed daycare runtime bundle.
- The submitted `Commit` must have empty `action` and note `grind sync`.
- `SaveWorkspaceCommit` must reject non-empty `action`.
- `SaveWorkspaceCommit` must ignore transcript, report-card, and score fields. It saves files, note, and timestamps only.
- Commit save policy belongs in SQLite views. Server code maps the view result to `CommitSaveStatus` and does not duplicate ownership policy.
- After `lock_at`, sync still persists owner files. This does not apply to instructors, who are unaffected by `lock_at` and `unlock_at`.
- Non-owner saves must not persist files and must not silently become owner saves.
- Submitted commit paths must be normalized server-side and must be student-owned paths from the problem-step solution whitelist.
- On saved sync, `grind` prints `problem {problem_id} step {step} synced`.
- After saving, `grind sync` removes local files outside the official workspace path set for the current problem step and prunes empty directories.
- Sync cleanup must preserve `.git` directories and their contents.
- The cleanup phase must preserve current system-owned and student-owned files even when the assignment is locked.

# Commit Step Sequencing

- `SaveWorkspaceCommit`, `SaveUngradedCommit`, and `SaveGradedCommit` must enforce problem-set-scoped step sequencing for owner saves.
- Owner commits for a later step require every earlier step in the same problem-set scope to have a passing saved commit.
- Owner commits for an earlier step must be rejected once any later in-scope step has saved work.
- Sliced problem sets sequence only inside their own `first_step`/`last_step` scope; continuation prerequisites are enforced by assignment download/workspace availability.
- Non-owner instructor inspection must remain non-mutating and must not silently become an owner save.

# `grind grade`

- `grind grade` has no arguments.
- `grind` must resolve the current problem from `.grind`, fetch `GetWorkspace` with `WORKSPACE_FILE_STATE_CURRENT`, refresh system-owned files, and submit only student-owned files.
- Client flow is exactly: build `GradingCommit` with action `grade` and note `grind grade`; call `SaveUngradedCommit`; send returned signed runtime bundle to `Daycare`; call `SaveGradedCommit` with the signed daycare result.
- `SaveUngradedCommit` is a pre-daycare save/sign step. It may persist student files when allowed, but it must not persist transcript/report-card/score and must not run LMS grade passback.
- `SaveGradedCommit` is the only grade endpoint that may persist report-card/score or run LMS grade passback.
- Daycare may run after `lock_at`, and both ungraded and graded owner commits must still be persisted after `lock_at`.
- LMS grade passback must run only when `SaveGradedCommit` persists a saved owner commit and the assignment is not locked.
- Commit save policy belongs in SQLite views. Server code maps the view result to protocol status and does not duplicate ownership policy.
- Submitted commit paths must be normalized server-side and must be student-owned paths from the problem-step solution whitelist.
- Passing grade means signed daycare commit has `report_card.passed` and `score == 1.0`; `grind` then advances local `.grind` to the next step or reports completion.
- If grade was locked, the final `grind` line must say the grade was not posted to the LMS because the assignment is locked.

# `grind action`

- `grind action [action]` runs an interactive non-grade daycare action for the current problem step.
- `grind action grade` must fail and tell the user to use `grind grade`; grade is not an interactive action alias.
- With no action, or with an action not present in the current workspace action map, `grind` lists available non-grade actions and fails.
- `grind` must resolve the current problem, fetch `GetWorkspace` with `WORKSPACE_FILE_STATE_CURRENT`, refresh system-owned files, and submit only student-owned files.
- Client flow is: build `GradingCommit` with the requested action and note `grind action {action}`; call `SaveUngradedCommit`; send the returned signed runtime bundle to `Daycare` in interactive mode.
- `SaveUngradedCommit` may save current student files before action execution when policy allows, but action output is not finalized through `SaveGradedCommit`.
- If the assignment is locked, `grind action` still persists pre-action student files when policy allows and still runs daycare so students can inspect behavior.
- The server must reject unknown, unavailable, or mismatched runtime actions through signed runtime bundle validation; the client-side action check is presentation and early feedback only.

# `grind reset`

- `grind reset [file ...]` restores student-owned files for the current problem step from the step-start workspace state.
- It fetches `GetWorkspace` with `WORKSPACE_FILE_STATE_STEP_START` and uses the returned system-owned and student-owned files as the reset source.
- With no file arguments, it restores missing student-owned files, refreshes system-owned files, and reports modified student-owned files without overwriting them.
- With file arguments, each argument must match at least one student-owned path for the current step, either by exact normalized path or by basename. Unknown files fail the command.
- Modified student files that were not requested are left untouched, and `grind` reports that they have been modified.
- If no student-owned files differ from the beginning of the step, `grind` reports that no student files have been modified.
- Reset is a local workspace operation. It must not persist a commit, call daycare, advance `.grind`, or change server state.


# Protocol Naming

- Use `Get` for single-item reads, `List` for plural reads, and `Search` for query-style discovery.
- Use `Prepare...` for TA requests that validate/package/sign artifacts without persisting anything.
- Use `Save...` for final persistence when create/update share one endpoint.


# Authoring Semantics

- Authoring requests are shaped around uploaded author source material, not around stored database rows or daycare package internals.
- Problem sets are the LMS-visible work unit. A problem set may either bundle one or more complete problems, or represent a step slice of exactly one problem.
- Sliced problem sets define inclusive `first_step` and `last_step` bounds on their single problem. Later slices explicitly link to the previous slice with `continues_problem_set_id`.
- A sliced problem set with `first_step > 1` must continue a sliced problem set for the same problem whose `last_step` is exactly `first_step - 1`.
- Multi-problem problem sets must not use step slicing. This keeps continuation semantics unary.
- Assignment scoring, progress, workspace reads, and grading context must use the problem-set step scope, not all steps of the underlying problem.
- Continuation slices do not migrate commits. The first step of a continuation slice uses the previous slice's passed final-step commit files as the current starting student-owned files until the new slice has its own commit.
- `grind` uploads only:
  - problem/problem-set metadata from `.cfg`
  - ordered steps
  - per-step authored files from the main tree
  - per-step starter files from `_starter/`
  - explicit create/update intent
- Before gathering each step for `grind create`, `grind` refreshes canonical problem type files for that step and runs `make clean` in the step directory.
- `grind` does not attempt to identify solution files, system files, or cumulative student-owned files.
- `grind` does not attempt to stitch together step-to-step continuity.
- The server remains canonical for `.gitignore` processing, but `grind` pre-filters files that local `.gitignore` rules would ignore before upload.
- The Rust client and server Git-style `.gitignore` handling must stay behaviorally aligned for uploaded author file trees. If one side changes ignore semantics, update the other in the same change.
- `grind` reports whitespace issues but must not normalize file contents.
- Whitespace normalization is removed completely. What the author supplies is what gets stored in the problem.
- `grind` should report one log line per affected text file for whitespace issues such as non-Unix line endings and trailing spaces, but continue processing.
- `.gitignore` handling is hierarchical and based on the effective overlaid step tree, not just the uploaded problem files.
- Problem type files are authoritative and trump uploaded author files.
- `grind` must not upload `.git` contents or canonical problem type files gathered from the refreshed step tree.
- Server-side file processing order is:
  - start with the uploaded file set
  - overlay canonical problem type files on top
  - process hierarchical `.gitignore` rules on the resulting effective tree
- Uploaded files that collide with canonical problem type files must not be stored as problem step files.
- Instructions are a convention, not protocol schema. There is no special instructions field, no markdown rendering rule, and no required documentation path.
- Authoring layout is standardized:
  - authored files live in the main step directory tree
  - starter files live in `_starter/`
  - old alternate starter/solution layouts are not supported
- The server derives the cumulative student-owned file set as the union of starter-file paths introduced in the current and prior steps.
- The server infers solution files from the effective authored file set using that cumulative student-owned file set.
- The server validates continuity between steps: every cumulative student-owned file must have a solution file in each step.
- The server strips problem type files from persisted problem step files.
- Daycare-facing blobs for author validation use the same grading-commit shape as the student grading flow.
- End-to-end `grind create` problem flow:
  - `grind` builds an `AuthorProblemDraft` from `problem.cfg`, authored files, and `_starter/`.
  - `grind` sends `PrepareProblem`; the server validates author material, overlays problem type files, applies `.gitignore`, infers solution files, builds one signed validation runtime bundle per step, and persists nothing.
  - `grind` runs every signed validation bundle through daycare before `SaveProblem`.
  - `grind` sends `SaveProblem` only after every validation returns a signed runtime bundle with a passing `grade` report card and score `1.0`.
  - The server must verify those signed validation bundles during `SaveProblem`; client-side validation is never trusted as the persistence authority.
  - `SaveProblem` must reject missing, extra, unsigned, failed, mismatched, or tampered validation bundles before writing any problem rows.
  - Persisted solution files must come from the server-verified validation result, and must match the solution files originally prepared for that step.
  - Persisted regular files must match the runtime files that were validated; persisted starter files must match the starter files carried in the signed validation bundle.
  - `SaveProblem` requires exactly one problem step, one solution commit, and one signed validation bundle per step.
  - A `SAVE_MODE_CREATE` problem save also creates a same-id problem set containing exactly that problem with weight 1 and no step slicing.
  - `grind create --action ACTION` is validation-only/interactive; it must not persist problem data.
- `grind create PSET.cfg` saves only the problem set membership/weights; it does not prepare or validate problem source material.
- `grind create PSET.cfg` may save either a complete-problem bundle or a unary step-sliced problem set. It must reject configs that mix multiple problems with slicing.
- Author save requests must carry explicit intent:
  - create request => error if problem/problem set already exists
  - update request => error if problem/problem set does not exist
- Once a problem is assigned, `SaveProblem` may update metadata, weights, and authored file sets, but must reject changes to the number of steps or any step's problem type.
- Once a problem set is assigned, `SaveProblemSet` may update metadata and problem weights, but must reject changes to problem membership, first/last step slice bounds, or continuation shape.
- Do not add separate preflight existence checks purely to distinguish create from update. Catch that error at save time.

# `grind create`

- `grind create` is hidden from normal help unless cached author mode is enabled locally. Hidden commands remain invokable; the server must enforce author permissions.
- `grind create` with no positional argument operates on the author problem rooted at the nearest `problem.cfg`.
- `grind create --update` changes the save mode from create to update for a problem; update mode is invalid with `--action`.
- `grind create --action ACTION` prepares the problem and runs one interactive validation action for the active step only. It must not persist problem data.
- `grind create PSET.cfg` saves only problem set metadata and membership/weights. It must reject `--action` because problem-set saves do not have daycare actions.
- Problem-set create/update calls `SaveProblemSet` with explicit `SAVE_MODE_CREATE` or `SAVE_MODE_UPDATE`; the server enforces existence semantics at save time.
- Problem-set update must preserve membership and slice bounds when the problem set is already assigned; metadata and weights may still change.
- Problem create/update uses the end-to-end authoring flow described above: for each step refresh canonical type files, run `make clean`, gather author material with client-side pre-filtering for `.git`, `.gitignore`, and canonical type files, call `PrepareProblem`, run every signed validation bundle through daycare, require passing validation, attach the signed validation results, then call `SaveProblem`. Create mode also creates the default same-id single-problem problem set.
- Problem update must preserve step count and per-step problem type when the problem is already assigned; metadata, weights, and authored file sets may still change.
- The client must not trust its own validation as persistence authority; `SaveProblem` verifies signed validation bundles before writing any problem rows.

# `grind student`

- `grind student SEARCH...` is hidden from normal help unless cached instructor mode is enabled locally. Hidden commands remain invokable; the server must enforce instructor visibility. The command inspects a student's assignment in a temporary local checkout.
- It requires search terms; without terms it fails with guidance.
- `grind` calls `ListAssignments` with the provided search terms and `include_student_context=True`.
- The server owns which student assignments are visible to the instructor and returns the student context needed for presentation.
- `grind` prints sorted matching assignments grouped by student. If matches cover more than one user, it must fail and ask for narrower terms.
- If matches cover exactly one user, `grind` downloads the most recent matching assignment into a private temporary directory under `/tmp`, opens an interactive shell in that workspace, and deletes the temporary directory after the shell exits.
- Student downloads use the same `GetAssignment` and `GetWorkspace` download semantics as `grind get`, including server-side availability enforcement.
- `grind student` must not save commits, run daycare, mutate the student's server state, or write into the instructor's configured workspace root.

# `grind solve`

- `grind solve` is an instructor-or-author command for writing authoritative solution files into the current local problem step.
- It takes no arguments.
- `grind solve` is hidden from normal help unless cached `Hello` roles include `is_author` or `is_instructor`. Hidden commands remain invokable; the server decides whether solution files may be returned.
- It resolves the current assignment/problem from `.grind` and fetches `GetWorkspace` with `WORKSPACE_FILE_STATE_CURRENT`, contents included, and solution files included.
- The server decides whether solution files may be returned. Authors retain current `solve` semantics. Instructors may also fetch solution files, but only for assignments in courses where they are instructors. `grind` must fail if no solution files are present.
- `grind` writes only the returned solution files into the local problem directory. It must not save a commit, run daycare, advance `.grind`, or modify server state.

# `grind problem`

- `grind problem SEARCH...` is an instructor-or-author catalog search command.
- It requires one or more search terms. Terms search server-owned problem set and problem metadata such as names, notes, and tags.
- `grind` calls `SearchProblemCatalog` and prints problem set URLs using the configured server host.
- The server owns catalog visibility, search semantics, and returned metadata.
- `grind` may sort results for presentation only; it must not infer hidden catalog state or perform local database lookups.

# `grind type`

- `grind type --list` lists problem types and their actions by calling `GetProblemTypes`.
- For `--list`, extra type names or `--remove` are ignored with a warning; listing must not write local files.
- `grind type TYPE` downloads canonical files for one problem type by calling `GetProblemType(TYPE)` and writing those files into the current directory.
- `grind type` without a type name must resolve the nearest author `problem.cfg`, determine the active step's configured problem type, and write canonical type files into that step directory. In multi-step layouts it must be run from a step directory.
- `grind type --remove TYPE` or `grind type --remove` removes the canonical files for the resolved problem type from the target directory.
- The server owns problem type definitions, canonical files, and action lists. `grind` only writes or removes exactly the returned canonical file paths.

# `grind problemtype`

- `grind problemtype` is hidden from normal help unless cached admin mode is enabled locally. Hidden commands remain invokable; the server must enforce admin permissions for every problem type mutation RPC.
- Problem type source material lives outside the tracked main repo under ignored `problemtypes/`, which is intended to be its own installation-specific git checkout.
- The problem type source layout is `problemtypes/types/TYPE/type.conf` for metadata/actions, `problemtypes/types/TYPE/files/` for canonical files, `problemtypes/common/` for shared symlink targets, `problemtypes/containers/NAME/Dockerfile` for container builds, and `problemtypes/bin/` for deployment scripts.
- `problemtypes/bin/sync-actions [TYPE...]` reads `type.conf` files and calls `grind problemtype action set`; `problemtypes/bin/sync-files [TYPE...]` replaces canonical file sets from `files/`; `problemtypes/bin/build-containers [NAME...]` builds container images.
- `grind problemtype list` lists all problem types, containers, and actions by calling `GetProblemTypes`.
- `grind problemtype show --problem-type TYPE` prints one problem type's container, actions, and canonical file paths by calling `GetProblemType`.
- `grind problemtype action set --problem-type TYPE --container CONTAINER --action ACTION_SPEC ...` creates or updates a problem type row and replaces its complete action list with the supplied actions. It must not delete and recreate the problem type row.
- `ACTION_SPEC` is `ACTION|COMMAND|PARSER|MAX_CPU|MAX_FD|MAX_FILE_SIZE|MAX_MEMORY|MAX_THREADS`. Parser values are `none`, `xunit`, and `check`; `none` stores no parser.
- Problem type metadata and action replacement must use SQLite upsert clauses for rows that remain present, then delete only action rows that are absent from the submitted complete action set.
- Problem type and action mutations are admin-only server operations and must be applied transactionally.

# `grind problemtype files`

- `grind problemtype files` is hidden from normal help unless cached admin mode is enabled locally. Hidden commands remain invokable; the server must enforce admin permissions.
- `grind problemtype files [--type TYPE]` reports the status of the canonical server-owned file set for a problem type compared to local files. It must not detect or report local files that are not in the server-owned file set.
- Without `--type`, `grind problemtype files` resolves the nearest author `problem.cfg`, determines the active step's configured problem type, and compares against that step directory. In multi-step layouts it must be run from a step directory.
- `--type TYPE` explicitly selects a problem type and compares against the current directory. There is no shortcut for `--type`.
- Status output covers every canonical server file path and reports each as unchanged, changed, or missing.
- `grind problemtype files --set [--type TYPE]` replaces the server canonical file set for the resolved problem type with the complete regular-file tree under the resolved target directory. Symlinked files are followed and stored as bytes at the symlink path.
- Problem type file replacement must use SQLite upsert clauses for rows that remain present, then delete only file rows that are absent from the submitted complete file set.
- `grind problemtype files --set` skips `.git` directories and their contents.
- The server must reject multiple submitted file paths that normalize to the same canonical path.
