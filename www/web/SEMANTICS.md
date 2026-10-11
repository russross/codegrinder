Web client semantics
====================

The web client combines server-backed assignment editing with local JavaScript/Python execution and standalone embedded workspaces. This document defines operation flows and invariants across those modes. [Server semantics](../../server/SEMANTICS.md) own authorization and persistence; [exam semantics](../exam/SEMANTICS.md) describe the separate exam client. The wire contract is [codegrinder.proto](../../protocol/codegrinder.proto).


Workspace identity and ownership
--------------------------------

Server mode holds an assignment key `(user_id, course_id, problem_set_id)`, a selected problem/progress record, and a workspace containing step/slice bounds, problem type, actions, and system/student byte maps. The displayed filesystem combines system files followed by student files. Only official student paths are editable/submittable. Assignment mode disables path changes, new-file creation, and embedding controls.

Editor buffers, the browser filesystem, the submitted snapshot, the TA's saved files, and a local runtime's execution state are distinct. Saving tabs flushes buffers locally; it is not a server acknowledgement. A revision counter tracks changes, and acknowledging an earlier snapshot cannot clear edits made after that snapshot. System-file refreshes and local runtime output cannot grant new student ownership.

RPC maps use normalized relative paths; the editor uses leading-slash display paths. Translate explicitly at that boundary and submit only the selected problem's official student paths. Files are byte arrays; text editor decoding does not redefine binary files as text.


Page startup and authentication
-------------------------------

1. Register the release-versioned runtime service worker with cache bypass and wait for that exact worker to control the page. Registration/controller failure is logged and page startup continues; local input capability still depends on the service worker.
2. Load and validate `local-runtimes.json`, mapping problem types to supported runtime names. An unknown mapping cannot silently choose another language.
3. If the URL supplies `token`, exchange it through `Hello`, require an authenticated identity/session, store the raw session key in tab-scoped `sessionStorage`, and remove the one-time token from the URL. Otherwise validate a stored key with an empty-token `Hello`.
4. Send authenticated TA calls with `authorization: Bearer SESSION_KEY`. An empty session key in a restoring `Hello` response retains the stored key. Failed restoration clears authentication. Login can also accept a pasted token through the login prompt; logout clears local session state.
5. If `assignment` is present, require authentication and load that assignment. Startup failure clears the local session and reports the error; assignment launch mode shows Run unavailable rather than presenting an unrelated standalone runtime as ready.

The TA is same-origin. Daycare transport targets the hostname inside the signed runtime envelope and omits credentials and TA authorization. Browser possession of a session or assignment URL never bypasses server access checks. Clearing tab storage/logout does not itself revoke a database session.


Assignment and problem selection
--------------------------------

Assignment discovery uses `ListAssignments` with no search or student context and sorts by course/title for display. Loading a selected assignment requests `GetAssignment` and the list, verifies the returned assignment key, rejects unavailable/prerequisite-blocked/empty assignments, and obtains the matching list item's lock date for presentation.

1. Before a user-driven assignment or problem transition, flush tabs and persist dirty work. If it remains dirty after the response, abort the transition and retain the current workspace.
2. Sort problem summaries by ID. Prefer the requested unfinished problem, otherwise the first unfinished problem, otherwise the first problem.
3. Fetch `GetWorkspace` with step zero, `CURRENT`, contents included, and solutions excluded. Verify the returned problem ID. Use the server's current step and slice bounds.
4. Replace the displayed file tree and tabs from the owned maps, render instructions from workspace files, install the official editable-path set, and derive action buttons from the returned actions. Mark this loaded workspace clean.
5. Activate the configured local runtime for that problem type. A problem with no local runtime can still use server-backed workflows; lack of browser execution must not fabricate a grading result.

Server operations have an in-progress guard and disable tab interaction. They wait for the existing sync chain before proceeding. Concurrent server-operation requests are ignored while the guard is held. This differs from exam's single queue for every action/save/selection and must not be assumed to have identical scheduling semantics.


Autosave and explicit sync
--------------------------

Editor changes schedule a save after 30 seconds of inactivity. Blur requests a save immediately; explicit Sync requests the same persistence flow with status output. Local buffer flushes also occur before execution and transitions. Timer expiry requests work, not a guarantee that network persistence finishes at that instant.

1. Flush all tabs, capture the current problem, file snapshot, and revision, and skip clean or already-queued revisions. Chain sync after earlier sync requests; an earlier rejection must not permanently poison the chain.
2. Refresh that explicit step through `GetWorkspace(CURRENT)`. Update workspace metadata/system files while retaining the captured local student bytes for submission.
3. Call `SaveWorkspaceCommit` with only student files, empty action, and note `web autosave`. Do not call runtime preparation for autosave.
4. Only `SAVED` acknowledges the captured revision, and only against the same still-selected problem. Newer revisions remain dirty. Non-saved outcomes display their reason and permit another submission.
5. On a thrown save failure, retain dirty state and schedule another autosave attempt. A transition that required successful persistence must not replace the unsaved workspace.

The revision is acknowledgement state, not a server-side conflict token. There is no multi-tab merge protocol or local durable recovery journal. Tab memory and editor state must not be described as already stored by the TA.


Grading
-------

1. Flush editor buffers and capture the selected workspace files. Under the server-operation guard, refresh the step, check that `grade` is an available action, and build a student-only commit with note `web grade`.
2. Call `SaveUngradedCommit`, require its signed bundle, and send it to the named daycare. Consume output/file events; returned files can update only existing student-owned paths. A grade stream requires a signed final result.
3. Submit that final envelope to `SaveGradedCommit`. A passing result requires both `report_card.passed` and score `1.0`. Only a `SAVED` passing result advances to the next in-scope workspace or marks the problem complete.
4. Display the report and save outcome. When the locally cached lock date has passed and the final result was saved, display the LMS-lock notice. This is presentation based on the cached date; actual passback eligibility and completion are server-owned.
5. Reload the assignment summary and selected unfinished problem from the TA. The displayed workspace after grading comes from authoritative server progress; it must not rely solely on an incremented local counter.

Grading can fail after pre-execution student files have persisted. A failing report does not advance progress; a local test result cannot replace the signed daycare/final-save sequence. Server persistence success does not mean the asynchronous LMS post has completed.


Other actions and file reset
----------------------------

Non-grade server actions refresh the workspace, validate the selected action, send `SaveUngradedCommit` with note `web ACTION`, and consume the daycare event stream. Normal end-of-stream completes the action without requiring a final bundle. Returned files update only known student paths; then the UI rebuilds the selected problem view. Do not call `SaveGradedCommit` or advance progress for these actions. Returned event bytes are local state and do not themselves acknowledge a TA save.

Reset asks for confirmation to restore all student files to the beginning of the step. Under the server-operation guard, fetch `GetWorkspace(STEP_START)` at the current explicit step and rebuild the workspace/tabs/runtime from the returned maps. This discards current local edits across the problem. Reset itself makes no save RPC and marks the newly displayed workspace loaded; the old server commit remains until a subsequent submission. This is intentionally distinct from CLI selective reset and exam's selected-file reset with persistence.


Local execution and tests
-------------------------

1. Select a runtime through the validated problem-type mapping. Runtime selection has a generation counter: destroy replaced runtimes, and destroy/discard an obsolete asynchronous load rather than installing it after a newer selection. Reuse is allowed only under the explicit reuse policy for the same runtime kind.
2. Load the versioned adapter and await its worker readiness before enabling execution. Report loading stages and bounded readiness failures. Configure the runtime with the current file snapshot.
3. Flush tabs and request server sync before local execution in assignment mode. Run the selected file or line in the worker and display stdout/stderr/images through typed events. Local execution does not create a signed score or advance a step.
4. Route input through a unique service-worker channel. Writes enqueue text or satisfy the oldest pending read; reads wait when empty. Closing a channel drops queued input and resolves pending reads with a closed response. This lets blocking worker input coexist with the responsive page.
5. Stop/destroy the active worker and retire its input channel when required by replacement or cancellation. A finished/failed worker event resolves execution state; it is not a TA persistence event.

Test is visible only when the workspace offers `test`. If the selected runtime supports local tests, execute them locally after stopping active execution; otherwise use the server `test` action. Neither path substitutes for Grade. JavaScript/Python runtime modules, worker protocol validation, Python module loading, and image/turtle output are dependencies of local execution only.

The service worker handles only its scoped POST input-channel routes; it is not an offline assignment cache. Activation removes legacy caches and claims clients. Incorrect worker/version selection or unavailable channel transport can break stdin even if the editor and TA RPCs still work.


Standalone and embedded workspaces
----------------------------------

Without a selected server assignment, local workspaces can be edited and run without login. Embedded data encodes a validated directory tree of text files; reject malformed nodes and invalid paths before loading. `problemType` selects a configured runtime, with the defined legacy default when omitted. Generated embeds preserve the runtime choice rather than guessing a different language when reopened.

The `dummy` presentation hides editing/navigation controls and presents a compact run interface. If it has no files, supply the appropriate default main-file editor state for its configured language. Standalone tab saves flush local buffers; they are not assignment commits. Embedded snapshots carry source text, not TA credentials or grading authority.


Publication and audit boundaries
--------------------------------

Build with `make -C www/web`; use Alpine system Node 24/npm, the lockfile, generated protobuf-ts bindings, TypeScript checks, and webpack. Versioned URLs must keep page modules, runtime adapters, workers, and service-worker selection consistent. Runtime configuration and generated/deployed scripts are required alongside the page; no server request can compensate for missing browser assets.

`make -C www/web check`, `test`, and `test-browser` cover types, behavior, and live browser integration respectively. Audit token removal/restoration, wrong assignment/problem responses, path ownership, newer edits during a save, failed outgoing persistence, reset without implicit save, stream errors/missing grade bundles, local-vs-server Test selection, stale runtime loads, and blocked/closed stdin channels. Browser validation uses a disposable Chrome profile and closes its test processes.

Implementation trace points are [codeGrinder.ts](scripts/codeGrinder.ts), [app.ts](scripts/app.ts), [protocol.ts](scripts/protocol.ts), [workspaceRevision.ts](scripts/workspaceRevision.ts), [localRuntime.ts](scripts/localRuntime.ts), and [sw.ts](sw.ts). `mostlyclean` preserves deployed scripts/assets; `clean` also removes generated deployment outputs. Neither target is a workspace-data reset.
