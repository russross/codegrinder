# General project rules

For Python server checks:

- The server is its own uv project under `server/`; run server pytest from that directory with `uv run pytest tests`.
- Do not run server tests from the repo root with `uv run --project server pytest`; pytest will collect unrelated repo paths such as `certs/` and CLI tests, and imports will not match the server test layout.

For protocol changes:

- Backware compatibility of the protocol is NOT a goal
- Always clean up/remove fields that are not actually used
- Favor flattening message data types where appropriate
- Client does not know/care about database layout—protocol should minimize leaking relational database structure
- Preserve `session_cookie` request fields where they help future web-gRPC integration, even if the current Python gRPC path authenticates through metadata instead


# CLI Config

- CLI config uses XDG conventions: `$XDG_CONFIG_HOME/codegrinder/config.toml`, defaulting to `~/.config/codegrinder/config.toml`.
- Do not use legacy `~/.codegrinderrc` or `~/.codegrinderinstructor` files.
- The config file is TOML and is created on login.
- Login updates only the auth cookie/token and server URL; preserve user-editable settings such as workspace root and instructor mode when the file already exists.
- The workspace root setting controls where per-course assignment directories are created. Default it to `$HOME` and explicitly write that default to the config file.
- `grind get` has no assignment selector or directory override; it always uses the configured workspace root. Students who want a different root edit the config file by hand.
- Instructor mode is an optional TOML boolean line. Omit it for normal student configs; missing means `false`.

# CLI Command Semantics

- The CLI command surface is the contract. Every command should be described here before its behavior is changed.
- Student-visible commands are `version`, `login`, `list`, `get`, `sync`, `grade`, `action`, and `reset`.
- Instructor-mode commands are additionally `create`, `student`, `solve`, `problem`, and `type`.
- Instructor-only flags `--api` and `--api-dump` report or dump API traffic; they must not change command semantics.
- Commands that operate on a local assignment must discover the assignment by finding `.grind` in the current directory or an ancestor.
- Multi-problem assignments require problem-specific author commands to run from inside a concrete problem directory; single-problem assignments use the assignment root as the problem directory.
- Client-side workspace path handling must normalize paths before reading or writing local files. Server-side validation remains authoritative and must reject invalid submitted paths.
- Non-login commands that load the server session must call `Hello` through `managed_session`, enforce version checks, and use the configured session cookie as the authentication source.

# `grind version`

- `grind version` performs no network calls and reads no config.
- It prints the local CLI version as `grind {version}`.
- It must not depend on login state or server availability.

# `grind login`

- `grind login <hostname> <sessionkey>` exchanges a Canvas-provided one-time login key for a durable session cookie by calling `Hello` against the given host.
- `grind login` with any argument shape other than exactly host and key prints login guidance and fails.
- The server validates the login key, returns the authenticated user, session cookie, and version policy.
- The CLI must reject an empty user response and must run normal version compatibility checks before writing config.
- Login creates or updates the XDG TOML config. It updates only host and cookie/session fields that are part of authentication and preserves user-editable settings such as workspace root and instructor mode.
- A successful login prints the authenticated user's display name.

# `grind list`

- `grind list` takes no arguments.
- It lists assignments visible to the logged-in user by calling `ListAssignments` with no search terms and without student context.
- The server owns assignment visibility, ordering-independent content, availability status, due dates, and user authorization.
- Some assignments may be hidden from the student by the server when their IP address is filtered, but instructors see all assignments for the courses where they are instructors
- The CLI sorts the returned assignment items for presentation only; sorting must not change which assignments exist or which are downloadable.
- If no assignments are returned, the CLI explains that assignments must be launched from Canvas before CLI access.


# Assignment Availability and Locking

- Assignment download availability is server-provided in list responses and should be derived consistently from database views. The CLI should not duplicate open/locked time policy.
- `unlock_at` controls whether an assignment is available for download. If it is present and in the future, the server should mark the assignment unavailable for download and refuse workspace download.
- Problem-set continuation prerequisites also affect download availability. If a sliced problem set continues an earlier sliced problem set and the required previous step is not passed, the server should mark the assignment `ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY` and refuse workspace download.
- LMS launch should still create or update the assignment row for a prerequisite-blocked continuation; readiness is enforced by `ListAssignments`, `GetAssignment`, and `GetWorkspace`, not by rejecting the launch.
- `lock_at` does not hide assignments and does not prevent workspace download or daycare actions, including grade.
- After `lock_at`, student-owned assignment commits must not be persisted and grade passback must not run, but daycare actions should still run so students can see results.
- After a locked `grind grade`, the final line shown to the student must clearly say the results were not saved because the assignment is locked.
- `lock_at` and `unlock_at` do not apply to instructors for the course.


# `grind get`

- `grind get` downloads all currently available assignments owned by the logged-in user into the configured workspace root.
- The CLI must use `ListAssignments` download status to decide which assignments to attempt; it must not reimplement `unlock_at` policy.
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
- Workspace paths returned by the server and written by the CLI must be relative, normalized, and must not contain absolute paths, `.` components, `..` components, or backslashes.
- `lock_at` does not prevent `grind get`; only `unlock_at` controls download availability, and only for students.
- `grind get` skips `ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY` assignments and prints a warning that the prerequisite assignment is not ready.

# `grind sync`

- `grind sync` has no arguments.
- The CLI must resolve the current problem from `.grind`, fetch `GetWorkspace` with `WORKSPACE_FILE_STATE_CURRENT`, refresh system-owned files, and submit only student-owned files.
- `grind sync` must call `SaveWorkspaceCommit`, not `SaveUngradedCommit`; sync is persistence only and must not receive or create a signed daycare runtime bundle.
- The submitted `Commit` must have empty `action` and note `grind sync`.
- `SaveWorkspaceCommit` must reject non-empty `action`.
- `SaveWorkspaceCommit` must ignore transcript, report-card, and score fields. It saves files, note, and timestamps only.
- Commit save policy belongs in SQLite views. Python maps the view result to `CommitSaveStatus` and does not duplicate lock ownership policy.
- After `lock_at`, sync must return `COMMIT_SAVE_STATUS_NOT_SAVED_LOCKED` and persist no files. This does not apply to instructors, who are unaffected by `lock_at` and `unlock_at`.
- Non-owner saves must not persist files and must not silently become owner saves.
- Submitted commit paths must be normalized server-side and must be student-owned paths from the problem-step solution whitelist.
- On saved sync, CLI prints `problem {problem_id} step {step} synced`.
- On locked sync, CLI prints that work was not saved because the assignment is locked.
- After saving, `grind sync` removes local files outside the official workspace path set for the current problem step and prunes empty directories.
- The cleanup phase must preserve current system-owned and student-owned files even when the assignment is locked.

# `grind grade`

- `grind grade` has no arguments.
- The CLI must resolve the current problem from `.grind`, fetch `GetWorkspace` with `WORKSPACE_FILE_STATE_CURRENT`, refresh system-owned files, and submit only student-owned files.
- Client flow is exactly: build `GradingCommit` with action `grade` and note `grind grade`; call `SaveUngradedCommit`; send returned signed runtime bundle to `Daycare`; call `SaveGradedCommit` with the signed daycare result.
- `SaveUngradedCommit` is a pre-daycare save/sign step. It may persist student files when allowed, but it must not persist transcript/report-card/score and must not run LMS grade passback.
- `SaveGradedCommit` is the only grade endpoint that may persist report-card/score or run LMS grade passback.
- Daycare may run after `lock_at`, but both ungraded and graded commit persistence must be disabled for the owner after `lock_at`.
- LMS grade passback must run only when `SaveGradedCommit` persists a saved owner commit.
- Commit save policy belongs in SQLite views. Python maps the view result to protocol status and does not duplicate lock ownership policy.
- Submitted commit paths must be normalized server-side and must be student-owned paths from the problem-step solution whitelist.
- Passing grade means signed daycare commit has `report_card.passed` and `score == 1.0`; the CLI then advances local `.grind` to the next step or reports completion.
- If grade was locked, the final CLI line must say results were not saved because the assignment is locked.

# `grind action`

- `grind action [action]` runs an interactive non-grade daycare action for the current problem step.
- `grind action grade` must fail and tell the user to use `grind grade`; grade is not an interactive action alias.
- With no action, or with an action not present in the current workspace action map, the CLI lists available non-grade actions and fails.
- The CLI must resolve the current problem, fetch `GetWorkspace` with `WORKSPACE_FILE_STATE_CURRENT`, refresh system-owned files, and submit only student-owned files.
- Client flow is: build `GradingCommit` with the requested action and note `grind action {action}`; call `SaveUngradedCommit`; send the returned signed runtime bundle to `Daycare` in interactive mode.
- `SaveUngradedCommit` may save current student files before action execution when policy allows, but action output is not finalized through `SaveGradedCommit`.
- If the assignment is locked, the CLI warns that action results will not be saved, but still runs daycare so students can inspect behavior.
- The server must reject unknown, unavailable, or mismatched runtime actions through signed runtime bundle validation; the client-side action check is presentation and early feedback only.

# `grind reset`

- `grind reset [file ...]` restores student-owned files for the current problem step from the step-start workspace state.
- It fetches `GetWorkspace` with `WORKSPACE_FILE_STATE_STEP_START` and uses the returned system-owned and student-owned files as the reset source.
- With no file arguments, it restores missing student-owned files, refreshes system-owned files, and reports modified student-owned files without overwriting them.
- With file arguments, each argument must match at least one student-owned path for the current step, either by exact normalized path or by basename. Unknown files fail the command.
- Modified student files that were not requested are left untouched, and the CLI reports that they have been modified.
- If no student-owned files differ from the beginning of the step, the CLI reports that no student files have been modified.
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
- The CLI uploads only:
  - problem/problem-set metadata from `.cfg`
  - ordered steps
  - per-step authored files from the main tree
  - per-step starter files from `_starter/`
  - explicit create/update intent
- The CLI does not attempt to identify solution files, system files, or cumulative student-owned files.
- The CLI does not attempt to stitch together step-to-step continuity.
- The server does all `.gitignore` processing.
- The CLI reports whitespace issues but must not normalize file contents.
- Whitespace normalization is removed completely. What the author supplies is what gets stored in the problem.
- The CLI should report one log line per affected text file for whitespace issues such as non-Unix line endings and trailing spaces, but continue processing.
- `.gitignore` handling is hierarchical and based on the effective overlaid step tree, not just the uploaded problem files.
- Problem type files are authoritative and trump uploaded author files.
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
  - CLI builds an `AuthorProblemDraft` from `problem.cfg`, authored files, and `_starter/`.
  - CLI sends `PrepareProblem`; the server validates author material, overlays problem type files, applies `.gitignore`, infers solution files, builds one signed validation runtime bundle per step, and persists nothing.
  - CLI runs every signed validation bundle through daycare before `SaveProblem`.
  - CLI sends `SaveProblem` only after every validation returns a signed runtime bundle with a passing `grade` report card and score `1.0`.
  - The server must verify those signed validation bundles during `SaveProblem`; client-side validation is never trusted as the persistence authority.
  - `SaveProblem` must reject missing, extra, unsigned, failed, mismatched, or tampered validation bundles before writing any problem rows.
  - Persisted solution files must come from the server-verified validation result, and must match the solution files originally prepared for that step.
  - Persisted regular files must match the runtime files that were validated; persisted starter files must match the starter files carried in the signed validation bundle.
  - `SaveProblem` requires exactly one problem step, one solution commit, and one signed validation bundle per step.
  - `grind create --action ACTION` is validation-only/interactive; it must not persist problem data.
- `grind create PSET.cfg` saves only the problem set membership/weights; it does not prepare or validate problem source material.
- `grind create PSET.cfg` may save either a complete-problem bundle or a unary step-sliced problem set. It must reject configs that mix multiple problems with slicing.
- Author save requests must carry explicit intent:
  - create request => error if problem/problem set already exists
  - update request => error if problem/problem set does not exist
- Do not add separate preflight existence checks purely to distinguish create from update. Catch that error at save time.

# `grind create`

- `grind create` is available only when instructor mode is enabled locally. The server must enforce author permissions.
- `grind create` with no positional argument operates on the author problem rooted at the nearest `problem.cfg`.
- `grind create --update` changes the save mode from create to update for a problem; update mode is invalid with `--action`.
- `grind create --action ACTION` prepares the problem and runs one interactive validation action for the active step only. It must not persist problem data.
- `grind create PSET.cfg` saves only problem set metadata and membership/weights. It must reject `--action` because problem-set saves do not have daycare actions.
- Problem-set create/update calls `SaveProblemSet` with explicit `SAVE_MODE_CREATE` or `SAVE_MODE_UPDATE`; the server enforces existence semantics at save time.
- Problem create/update uses the end-to-end authoring flow described above: gather author material, call `PrepareProblem`, run every signed validation bundle through daycare, require passing validation, attach the signed validation results, then call `SaveProblem`.
- The client must not trust its own validation as persistence authority; `SaveProblem` verifies signed validation bundles before writing any problem rows.

# `grind student`

- `grind student SEARCH...` is an instructor-mode command for inspecting a student's assignment in a temporary local checkout.
- It requires search terms; without terms it fails with guidance.
- The CLI calls `ListAssignments` with the provided search terms and `include_student_context=True`.
- The server owns which student assignments are visible to the instructor and returns the student context needed for presentation.
- The CLI prints sorted matching assignments grouped by student. If matches cover more than one user, it must fail and ask for narrower terms.
- If matches cover exactly one user, the CLI downloads the most recent matching assignment into a private temporary directory under `/tmp`, opens an interactive shell in that workspace, and deletes the temporary directory after the shell exits.
- Student downloads use the same `GetAssignment` and `GetWorkspace` download semantics as `grind get`, including server-side availability enforcement.
- `grind student` must not save commits, run daycare, mutate the student's server state, or write into the instructor's configured workspace root.

# `grind solve`

- `grind solve` is an instructor-mode author command for writing authoritative solution files into the current local problem step.
- It takes no arguments.
- The CLI must require an authenticated author user.
- It resolves the current assignment/problem from `.grind` and fetches `GetWorkspace` with `WORKSPACE_FILE_STATE_CURRENT`, contents included, and solution files included.
- The server decides whether solution files may be returned. The CLI must fail if no solution files are present.
- The CLI writes only the returned solution files into the local problem directory. It must not save a commit, run daycare, advance `.grind`, or modify server state.

# `grind problem`

- `grind problem SEARCH...` is an instructor-mode catalog search command.
- It requires one or more search terms. Terms search server-owned problem set and problem metadata such as names, notes, and tags.
- The CLI calls `SearchProblemCatalog` and prints problem set URLs using the configured server host.
- The server owns catalog visibility, search semantics, and returned metadata.
- The CLI may sort results for presentation only; it must not infer hidden catalog state or perform local database lookups.

# `grind type`

- `grind type --list` lists problem types and their actions by calling `GetProblemTypes`.
- For `--list`, extra type names or `--remove` are ignored with a warning; listing must not write local files.
- `grind type TYPE` downloads canonical files for one problem type by calling `GetProblemType(TYPE)` and writing those files into the current directory.
- `grind type` without a type name must resolve the nearest author `problem.cfg`, determine the active step's configured problem type, and write canonical type files into that step directory. In multi-step layouts it must be run from a step directory.
- `grind type --remove TYPE` or `grind type --remove` removes the canonical files for the resolved problem type from the target directory.
- The server owns problem type definitions, canonical files, and action lists. The CLI only writes or removes exactly the returned canonical file paths.
