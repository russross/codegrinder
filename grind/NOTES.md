CLI semantics
=============

`grind` is the native client. These workflows define its user-visible effects and the boundaries that refactors must preserve. The [server semantics](../server/NOTES.md) define authoritative access, ownership, sequencing, and grading policy; [codegrinder.proto](../protocol/codegrinder.proto) defines the messages. Command behavior must also remain consistent with [AGENTS.md](../AGENTS.md).


State and command entry
-----------------------

Persistent client state consists of XDG TOML configuration and assignment-local `.grind` TOML metadata. Configuration is `$XDG_CONFIG_HOME/codegrinder/config.toml`, defaulting to `~/.config/codegrinder/config.toml`. It contains the server, raw session key, workspace root, and optional cached role flags. Missing role flags mean false. Legacy dotfiles are not configuration sources.

An assignment key is `(user_id, course_id, problem_set_id)`. `.grind` records that identity and each problem's ID/current step, without exposing the underlying problem's full step count. Workspace commands search the current directory and ancestors for `.grind`. A single-problem assignment uses the assignment root; a multi-problem assignment requires a concrete problem directory. Metadata locates work; it does not authorize access.

Normal help exposes `version`, `login`, `list`, `get`, `sync`, `grade`, `action`, and `reset`. Cached roles additionally expose instructor `student`, author `create`/`type`, instructor-or-author `solve`/`problem`, and admin commands including `problemtype`. Hidden commands remain invokable by name. Hidden `--api` and `--api-dump` affect traffic reporting, not semantics. The server enforces permission on every protected operation.

Normalize workspace paths before filesystem access. Server paths must resolve to relative files in the target workspace, and the server independently validates submitted paths. Binary contents remain bytes; text diagnostics must not rewrite contents.


Version and login
-----------------

`grind version` prints `grind {version}` without config reads or network access.

1. `grind login <hostname> <token>` requires exactly those two arguments; other shapes print login guidance and fail. Exchange the one-time Canvas token through `Hello` at that host.
2. Require an authenticated user and enforce the returned version policy before writing configuration. The session key returned by this exchange becomes the configured authentication source.
3. Create or update XDG TOML. Preserve user-editable settings; initialize and explicitly write the workspace root as `$HOME` when creating the config. Write true cached roles and omit false ones.
4. Print the authenticated user's display name only after successful login/configuration.

Every later command that opens a server session first calls authenticated `Hello` with an empty token and the configured key in `authorization: Bearer SESSION_KEY`. Enforce versions and refresh cached roles if changed; do not replace the key with the empty key normally returned by session validation.

Below the required version, attempt executable `update-grind` from `PATH` when available, then exit and require rerunning the command even after a successful upgrade. Without an updater, fail with upgrade guidance. Below only the recommended version, an updater attempt or warning allows the current command to continue. Updater arguments identify `grind` and the server hostname. Neither path bypasses the required-version gate.


List and download
-----------------

`grind list` takes no arguments and calls `ListAssignments` with no search terms and no student context. Sort for presentation, retain per-course headings, and print Canvas assignment titles, aligned integer completion percentages from server scores, and configured paths abbreviated with `~` where applicable. Do not number assignments. Empty results explain that assignments must first be launched from Canvas.

1. `grind get` takes no arguments and lists assignments through the same endpoint. Select only the authenticated user's available assignments; do not recompute time policy. Warn and skip prerequisite-blocked assignments.
2. Target `$workspace_root/$course_directory/$problem_set_id`. Fetch `GetAssignment` to validate the summary and obtain current per-problem steps. Existing matching `.grind` identity and progress mean the download is already present. An existing mismatched, incomplete, or unmanaged directory is reported and left in place, not overwritten or silently accepted as complete.
3. Create a temporary sibling of the final assignment directory. For every problem fetch `GetWorkspace(CURRENT)` with contents, without solutions, and write both owned file maps into the single-problem root or multi-problem subdirectory.
4. Write complete `.grind` metadata into staging only after gathering the assignment. Rename staging to the final target after all files and metadata succeed. Recheck target existence before publication.
5. On failure, discard staging rather than leave a partial final assignment. Downloads do not save commits, execute daycare, or alter the workspace-root configuration.

The server rechecks availability for workspace reads. `unlock_at` and prerequisites can prevent download; `lock_at` cannot. The client must use server slice bounds and progress instead of inferring completion from directory names or total underlying steps.


Gathering a submission
----------------------

For sync, grade, and action, resolve the current problem and fetch its `CURRENT` workspace at the local metadata step. Refresh system-owned files on disk. Build the commit only from official student paths, reading current local bytes rather than uploading the whole tree. Unknown local artifacts never become submitted student files.

Grade and action require every expected student file to exist and report missing paths before submission. Sync instead uses the current server bytes for missing student files, then restores those files locally after a successful save. This distinction prevents sync from silently deleting missing official work while keeping execution inputs explicit.

The commit carries the assignment key, problem, step, files, note, and timestamps. `GradingCommit.user_id` identifies the authenticated actor even when the assignment belongs to someone being inspected. Preserve the assignment owner; never turn instructor inspection into an owner save.


Sync
----

1. `grind sync` takes no arguments, gathers the current official student snapshot, and calls `SaveWorkspaceCommit` with empty action and note `grind sync`.
2. Receive the save status; do not route sync through runtime preparation. The TA saves owner files and metadata without accepting grading fields or creating a signed bundle.
3. After saving, restore missing student files from the gathered fallback and remove files outside the official system/student path set. Prune empty directories while preserving `.git` directories and their contents.
4. Print `problem {problem_id} step {step} synced` after the local update/cleanup succeeds. A local cleanup failure after server persistence does not undo that persistence.

Locked owner assignments still save and retain both system/student files during cleanup. All owner saves remain subject to server step sequencing.

Audit caveat: the current command does not inspect `save_status` before cleanup and its `synced` message. An authorized non-owner can therefore receive that message even though the server correctly refused persistence. Treat the response status as the persistence authority, not that message.


Grade
-----

1. `grind grade` takes no arguments. Gather student work and send `SaveUngradedCommit` with action `grade` and note `grind grade`. Require a usable signed runtime bundle and named daycare.
2. Send the envelope to that daycare without forwarding the TA session key. Consume the grade stream without applying intermediate file events. Missing final signed results and daycare error messages fail the operation.
3. Call `SaveGradedCommit` with the exact signed result. Only this RPC can persist grading output or initiate LMS passback. The earlier files-only save remains durable if execution or final persistence fails.
4. Interpret pass as both `report_card.passed` and score `1.0`. On pass, report completion at the last in-scope step; otherwise fetch the next scoped workspace, update its official local files, and then write the new `.grind` step. On failure, retain the step and display the report note and transcript.
5. Check the assignment's LMS lock date for presentation. When locked and the final save status is `SAVED`, the final output line states that the grade was not posted to the LMS because the assignment is locked. A deadline lookup failure is reported; the server still owns passback eligibility.

The CLI currently follows a passing signed result for local advancement even for a non-owner inspection; the server's non-owner save result still prevents changes to the student's assignment. Local progress and server persistence must not be conflated. A failed local next-step update does not roll back a grade already saved at the TA.


Other daycare actions
---------------------

`grind action [action]` accepts at most one action. Reject `grade` with guidance to use `grind grade`. A missing or unavailable name lists the workspace's non-grade actions and fails.

Gather the same official submission, send `SaveUngradedCommit` with the selected action and note `grind action {action}`, and run the signed daycare request in event-processing mode. Print terminal events and write normalized returned file events under the action directory. These artifacts can include paths beyond the student whitelist; a later submission still sends only official student paths. Normal stream closure completes a non-grade action without a signed final grade bundle.

There is no `SaveGradedCommit` call for this flow. Pre-action files may already have been saved, including after the lock date. Action output does not advance `.grind`, post a grade, or become saved simply because it was downloaded locally.


Reset
-----

Fetch the current problem's `STEP_START` workspace with contents and without solutions. Refresh system files from that response. With no arguments, restore missing student files and report modified student files without overwriting them. With file arguments, require each argument to match at least one student path by normalized exact path or basename; reject unknown names, and restore the matching files. A basename can match multiple paths.

Unrequested modified student files remain unchanged and are reported. If no student files differ, report that none are modified. Reset does not save a commit, call daycare, advance metadata, or change server state. Step-start bytes come from server continuation/previous-step rules, not necessarily the original first-step starter tree.


Instructor inspection and solutions
-----------------------------------

`grind student SEARCH...` requires terms and calls `ListAssignments` with student context enabled. Print sorted results grouped by student. Fail when results cover more than one user; for exactly one user choose the most recent matching assignment, download into a private temporary directory under `/tmp`, start an interactive shell there, and remove the directory when the shell exits. Use normal server download checks. The command itself performs no saves or daycare execution and never uses the configured workspace root for the checkout. Commands subsequently invoked inside the shell retain their own semantics and server authorization.

`grind solve` takes no arguments, resolves a local assignment problem, and requests `CURRENT` workspace contents with solutions included. The server authorizes authors or instructors of the assignment's course. Fail if no solutions are returned; otherwise write only those solution files locally. Do not persist, execute, or advance the assignment.

`grind problem SEARCH...` requires terms, calls `SearchProblemCatalog`, and prints returned problem-set URLs using the configured server. Search policy and visibility remain server-owned.


Create or update authored work
------------------------------

1. Without a positional config, locate the nearest `problem.cfg` and resolve its ordered step directories. For each step fetch and write canonical problem-type files, then run `make clean` in that step. A clean failure stops preparation. This is part of author validation, distinct from routine incremental client builds.
2. Gather metadata, authored main-tree files, and `_starter/` files into `AuthorProblemDraft`. Exclude `.git`, canonical type files, and files ignored by the effective hierarchical Git-style ignore rules. Client and server ignore semantics must remain aligned. Report each affected text file's whitespace problems without normalizing bytes.
3. Call `PrepareProblem`. The server classifies solution/system files, derives cumulative ownership, validates continuity, and signs validation runtimes; the CLI must not reconstruct those policies.
4. Run every step's validation bundle through daycare. Require a signed passing grade with score `1.0` for every step, attach the results, and only then call `SaveProblem` with explicit create/update intent. Client validation is preliminary; server verification authorizes persistence.
5. Report success only after the final save. A validation failure leaves no newly saved problem. A final save failure can occur after all validations have passed, including an existence or assigned-shape conflict.

`--update` requires an existing problem and preserves the shape of assigned problems. Default create requires absence and also creates the same-ID default problem set. Do not add a separate existence preflight to predict the final save outcome.

`grind create --action ACTION` prepares source but runs the active step with live output and does not call `SaveProblem`. Multi-step use requires a concrete step directory. `--update` and `--action` cannot be combined.

`grind create PSET.cfg` uploads only problem-set metadata and membership/weights to `SaveProblemSet` with explicit create/update intent. It rejects `--action` and multiple-problem slicing. It does not refresh step source or run daycare. Assigned sets retain membership, bounds, and continuation shape.


Canonical problem types
-----------------------

`grind type --list` reads types/actions without writing files; extra names or `--remove` are ignored with a warning. `grind type TYPE` writes the returned canonical files into the current directory. Without a name, resolve the nearest author config and active step's type/directory; multi-step layouts require a step directory. `--remove` removes exactly that type's returned canonical paths.

Admin `problemtype list` and `show --problem-type TYPE` display canonical metadata. `problemtype action set` sends the complete action set and container to the server. Each `ACTION_SPEC` is `ACTION|COMMAND|PARSER|MAX_CPU|MAX_FD|MAX_FILE_SIZE|MAX_MEMORY|MAX_THREADS`; parsers are `none`, `xunit`, or `check`. `none` means no parser. The server transactionally replaces actions without deleting/recreating the type row.

`problemtype files [--type TYPE]` compares every server canonical path and reports unchanged, changed, or missing; extra local files are not status entries. Without `--type`, resolve the active author step. `--set` replaces the server file set with the complete regular-file tree under the target, skipping `.git` and following symlinked files as bytes stored under their symlink paths. Server normalization rejects duplicate canonical paths.

Installation-specific problem-type sources live under ignored `problemtypes/`, with deployment scripts handling canonical metadata/files and container builds. Running the CLI is not a substitute for installing the images on daycares.


Failure boundaries and audit dependencies
-----------------------------------------

Expected argument, configuration, path, authorization, and transport errors produce readable diagnostics and a failing exit, not stack traces. RPC deadlines bound calls and connection establishment. Ordinary calls default to ten seconds (`--timeout SECONDS`); daycare calls have an independent fixed 120-second default (`--daycare-timeout SECONDS`). The signed runtime is not decoded to compute a client deadline. Daycare stream consumption also enforces the same absolute local deadline, and action output is flushed as it arrives. Grade output remains suppressed until a failing signed report can be replayed. There are no TTY input or daycare argument fields. A failed command can have completed an earlier durable step, such as pre-action persistence or final grading before local file updates. Do not promise cross-RPC rollback or automatically replay arbitrary mutations.

Audit session/version gating, role-only help filtering, atomic download publication, stale metadata, missing files, cleanup preserving `.git`, reset basename matches, continuation advancement, passing non-owner inspection, interrupted daycare streams, and validation-before-author-save. Trace these through [client.rs](client.rs), [assignment.rs](assignment.rs), [student.rs](student.rs), [author.rs](author.rs), [admin.rs](admin.rs), and [daycare.rs](daycare.rs).

Build with `make -C grind`; check formatting/Clippy with `make -C grind check`, then use `make -C grind test TEST_ARGS=...` for affected behavior. The shared Rust workspace supplies dependency versions, protobuf generation, lockfile, and release cache. Runtime dependencies include the TA, selected daycare, TLS trust, writable configured directories, and author-step Makefiles for creation. `mostlyclean` preserves native executables and deployed assets; no cleanup target removes configuration or user work.
