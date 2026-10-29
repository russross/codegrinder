VM client semantics
=====================

This document defines the VM client's operation flows, ownership rules, persistence boundaries, and VM lifecycle invariants. The [server semantics](../../server/NOTES.md) define authoritative access, sequencing, and grading. The [web client](../web/NOTES.md) has separate reset, save, and local-execution behavior. [UI.md](UI.md) supplies presentation details and [BUILD.md](BUILD.md) supplies build/check procedures.

The protocol is defined in [codegrinder.proto](../../protocol/codegrinder.proto). The browser uses the generated protobuf-ts field names.

The one-time login token is used only by `Hello`. The returned raw session key is stored in tab-scoped session storage, and the token is removed from the URL. All later requests, including `RunAssignmentAction`, carry the session key as `authorization: Bearer SESSION_KEY` metadata to the same-origin server. The browser exchanges no signed runtime bundles or separate daycare requests.


Initial assignment load
-----------------------

1.  Parse the `assignment=user_id:course_id:problem_set_id` and optional `token` URL parameters.

2.  When the URL contains a token, call `Hello` with it. Require a non-empty authenticated user ID and session key, store the session key in `sessionStorage`, and remove the one-time token from the URL.

3.  When the URL does not contain a token, load the session key from `sessionStorage` and validate it by calling `Hello` with an empty token and the key as authorization metadata. A missing or invalid saved session requires the assignment to be relaunched from Canvas.

4.  Call `GetAssignment` with the parsed `AssignmentKey`. Require its user ID to match the authenticated user. The final action result supplies the authoritative LMS-lock decision; loading does not require an assignment-list lookup or a client-clock comparison.

5.  For each `AssignmentProblemProgress`, call `GetWorkspace` with:

    *   the assignment key and problem ID;
    *   step number zero, selecting the student's current step;
    *   `WORKSPACE_FILE_STATE_CURRENT`;
    *   contents included; and
    *   solution files excluded.

    Store the returned `system_owned_files` and `student_owned_files` in a `ProblemWorkspace`. Build its browser-hosted 9p tree from the system files followed by the student files.

    Render `doc/doc.md`, the visible file tree, the first student-owned file, and the problem's actions. Enable the VM tab only when the current problem type has a configured VM image.


Workspace state
---------------

Each problem keeps three related pieces of state:

*   `systemOwnedFiles` is the latest canonical system file set from the TA. The editor displays these files read-only.

*   `studentOwnedFiles` is the current savable student file set. Editor writes and valid guest writes update this map.

*   A riscbox `Filesystem` is the current VM-owned working tree. Selection and step transitions rebuild it from official maps; guest-only namespace entries do not survive. Step-start bytes remain separate for CodeGrinder file Reset.

The UI lists only paths present in the two owned maps. Guest-created paths do not become visible or submit-capable. Guest writes, creates, or renames into an existing student-owned path update `studentOwnedFiles`. Guest removal or rename away from an owned path does not delete the canonical map entry. Guest changes to system-owned paths remain local to the live VM. Instructions and system-file views use canonical bytes even when the guest changes or removes those paths.

Host reads and writes are synchronous and copy their bytes. Notifications from both host and guest update official paths, including hard-link aliases and paths below renamed directories. Identical bytes do not increment submission revisions. A server refresh retains current student bytes on still-owned paths. If the resulting official file set changes, clear and repopulate the live 9p tree, removing stale and guest-only paths without rebooting or recording rebuild notifications as edits. An unchanged official file set leaves the live tree intact. The editor owns its buffered revisions and write failures; the application owns server acknowledgements and retry deadlines.

The workspace maintains a monotonically increasing student revision. A Save or action records the exact submitted revision. If an editor or guest change arrives while a request is in flight, the later revision remains visibly unsaved when the request completes.


Save
----

Save runs when the user clicks Save, leaves the editor, or switches files or problems. These requests, timed saves, and grading/actions enter one serialized queue. Each request captures its problem and step's save state. A request for a replaced step is ignored; a redundant workspace save becomes a no-op when it reaches the front of the queue.

The editor debounces its buffered changes for thirty seconds after the latest edit. Blur and timer flushes immediately enqueue server persistence. Each problem separately debounces guest and returned-file changes. Explicit Save and file selection flush the editor before entering the server queue. VM interaction flushes editor bytes independently of network persistence. Submitting a snapshot allows the first subsequent edit to start a new timer. Only a successful persistence response acknowledges the submitted revision. If newer edits exist, their deadline is preserved; otherwise the problem becomes clean and any remaining timer is canceled. Failed saves remain dirty and retry after 30 seconds unless an earlier timer or save request handles them.

The deadline controls when a save is requested. Network latency and an operation already running in the queue can delay persistence.

1.  If the requested problem's current revision is already saved, do nothing.

2.  Refresh the current step through `GetWorkspace`. Replace `systemOwnedFiles`; refresh the official student path set while retaining locally modified bytes for paths still owned by the student. Do not rebuild the live 9p tree during this same-step refresh.

3.  Build a `Commit` containing only `studentOwnedFiles`, with an empty action and note `exam interface: save`.

4.  Call `SaveWorkspaceCommit` and record the submitted workspace revision as saved only when the response is `SAVED`. A newer concurrent revision remains unsaved, even if another problem has since been selected.


Grade and other server actions
------------------------------

The entire server-coordinated action occupies the same queue as ordinary saves. Requesting an action makes the editor read-only and disables file/problem switching, action buttons, and VM input. The VM keeps its current boot state. Returned action files can change the workspace and start an autosave deadline; that save waits for the action to finish.

1.  Refresh the current workspace as described by Save.

2.  Capture the submitted workspace revision and build `RunAssignmentActionRequest` with the assignment key, problem ID, current step, selected action, note `exam interface: ACTION`, and only `studentOwnedFiles`. Actor identity, timestamps, system files, commands, and limits come from the server.

3.  Call `RunAssignmentAction` with bearer metadata and a 120-second deadline. The server performs a files-only save/hydration transaction, runs daycare outside transactions, and for grades performs the result save and eligible LMS passback scheduling. No signed bundles, runtime decoding, hostname selection, or final save request passes through the browser.

4.  For non-grade actions, display streamed terminal events. An `EventMessage` containing files may update only existing student-owned paths. Those bytes update both `studentOwnedFiles` and the corresponding live 9p file when its current shape permits it. A structurally incompatible path reports a write failure while retaining the returned official bytes for persistence. Require an explicit completion result for every action; ordinary stream closure is failure. A non-grade result must not contain a grade.

    For grade, ignore intermediate events and require a grade in the completion result. Acknowledge the captured revision only when the result is `SAVED`; newer editor/guest/returned-file revisions remain dirty. Apply the returned grade's commit files to the local workspace and views without changing VM power state. Failed streams acknowledge no revision, even if the server already persisted the initial snapshot; dirty work remains eligible for the ordinary save retry.

5.  A saved result passes when its commit has `report_card.passed` and score `1.0`. Fetch the next in-scope step with `GetWorkspace`, replace both owned maps, clear and repopulate the 9p tree, and select Instructions. Preserve VM power and disk overlays when the problem type stays the same; a type change force-halts and discards disk overlays. A halted VM waits for a user action to boot, except when instructions are absent and VM becomes the default tab. Mark the problem complete on its last in-scope step without resetting or rebooting the VM. Failed grades likewise leave power state unchanged. When the saved completion has `locked_for_lms`, finish output with the notice that the grade was not posted because the assignment is locked.


Problem switching
-----------------

Selections are serialized and carry a generation check. Flush the editor, disable editing and input, select Instructions. Force halt only when changing problem types. Capture and save the outgoing official student revision before replacing files. A failed outgoing save leaves the outgoing workspace available for retry. Superseded selections do not replace the visible problem.

Same-type selections reuse the runtime and preserve power, terminal state, and disk overlays while clearing/rebuilding 9p from the incoming canonical system and current student maps. Type changes cold-reset and discard disk overlays; different images destroy the old runtime and prepare new VM-owned shares. Select Instructions after replacement. A halted VM remains ready without booting; missing instructions select VM and trigger boot. Step advancement uses the same type-dependent preparation. Problems without a configured image use a synchronous exam file adapter.


VM boot and reboot
------------------

Selecting the VM tab boots a ready VM. Selecting the tab while the VM is loading, stopping, or running leaves the active VM intact. A repeated Reboot VM click during shutdown provides forced recovery. Selecting either terminal tab focuses that terminal. VM input, boot, and reboot explicitly flush the editor into the local filesystem before proceeding; they do not wait for TA persistence.

First selection loads the release-versioned riscbox adapter and matching WASM. The VM session prepares the configured HTTP-backed disk and named `workspace` share without booting. Same-type selections retain disk writes; type changes discard them. The guest terminal is connected through its virtio console.

Terminal input is UTF-8 encoded and copied into a queue. Each browser task offers at most 1024 bytes through `consoleInput` and retains bytes that the guest FIFO did not accept. Reset and teardown clear queued input and invalidate input waiting for editor writes. Console output is passed to xterm. Changes to its row or column count call `consoleResize`. The VM cursor blinks; grade output hides its cursor. Reset clears the screen, scrollback, and selection by replacing the parser and renderer, which retires queued old output. Orderly reboot also replaces the parser and renderer, clearing terminal history, selection, and modes before new boot output.

Reboot VM flushes the editor and requests orderly guest reboot. The button stays enabled and changes its label to Reset VM while terminal input is blocked. Boot VM, Reboot VM, and Reset VM use the same fixed width. Editing, saves, and 9p synchronization continue. Clicking again before a runtime halt/restart notification invokes forced reset without flushing editor text. After that notification, clicks resume normal Boot/Reboot behavior. A halted VM boots its retained state.

Second-click reset is emergency recovery: force halt outside the selection queue, retire stalled selections and pending input, cold-reset the machine, discard all disk overlays, clear 9p, rebuild it from current official maps, and boot it. It preserves the dirty editor buffer and submission state. It does not flush editor text, restore originals, or send a Reset/save RPC. There is no separate Reset VM button. Boot/Reboot is disabled while loading/resetting. CodeGrinder's file Reset is independent.

The image lookup maps `riscv` to the RISC-V image and `cinout` to the C image. `cunittest` has no configured image. Problems without a configured image do not show the VM tab.


File Reset
----------

CodeGrinder Reset operates on the currently edited student file. It is independent of VM reboot/reset and uses the server's step-start source, which can include work carried from earlier steps or a continuation.

1. Capture the current problem, step, and editor path. Fetch `GetWorkspace(STEP_START)` with contents and without solutions, wait for the save queue, and abandon the operation if the captured selection no longer matches.
2. Flush the editor and refresh canonical workspace metadata/system files while preserving current student edits. Compare official student bytes with the fetched step-start map and show a native dialog listing changed paths.
3. Offer Reset only when the selected path is a changed student-owned file. If the workspace revision changes while the dialog is open, rebuild the confirmation state and require another confirmation rather than discarding unreviewed changes.
4. On confirmation, recheck problem/step identity, write that one path's starter bytes into the official workspace, reload the editor, and request an ordinary queued save. Other modified student files are preserved.
5. Report fetch/write/save failures without claiming a successful reset. Cancellation does not replace the selected student's bytes; canonical refresh or an earlier editor flush can already have occurred.

Unlike a VM emergency reset, this operation intentionally changes the student's official bytes and requests TA persistence. Unlike web Reset, it restores only the selected file. Failure to persist leaves the local change subject to the ordinary dirty/retry rules.


Clipboard and input boundaries
------------------------------

Instructions, editor, action output, and VM terminal share a private in-memory text clipboard. Copy/cut write that buffer; paste reads it rather than the system clipboard. Copying terminal output or instructions never deletes the source. Editor cuts/pastes preserve undo history and cannot modify system-owned read-only files.

System clipboard events carry `[redacted]` when the private buffer contains text and empty text otherwise. Clipboard API marker writes require a focused document and active user interaction; failures do not interrupt editing. The private buffer survives problem/focus changes but disappears on reload. This behavior is an application interaction policy, not a server authorization boundary.

Intercept native clipboard events before terminal handlers, block middle-button paste and HTML drag/drop, and preserve guest interrupt semantics for Ctrl+C when no selected text is copied. Private terminal paste honors bracketed-paste mode and removes embedded escape characters from a bracketed payload. Grade output accepts no terminal input. VM input remains subject to editor flush, action locking, and runtime-generation checks.


Failure and completion boundaries
---------------------------------

The assignment URL identifies one assignment; authentication requires its user to match the logged-in user. The TA independently enforces restricted IP access, availability, ownership, file validation, and in-scope step sequencing. The client cannot make an unavailable assignment accessible by retaining an old workspace or session.

A successful editor flush means bytes reached the local workspace, not the TA. Only a successful `SAVED` response acknowledges a submitted revision. `RunAssignmentAction` can persist the initial snapshot before daycare runs, but the browser acknowledges it only after explicit successful completion. A later execution/final-save failure does not erase the TA's saved files and leaves the browser revision eligible for retry. Returned files and later guest edits are separate revisions requiring their own acknowledgement.

An error, missing completion, or missing grade prevents local advancement; a lost response does not prove the server failed to persist. Passing requires both the report's pass flag and score `1.0`, plus a saved result for advancement. The last in-scope step completes the problem without requesting a nonexistent next step. A failed next-step fetch leaves a grade that may already be persisted; reloading consults server progress.

The lock date does not disable editing, saves, daycare, or progression. The server decides whether an LMS post is allowed and performs eligible passback asynchronously. A saved grade is not confirmation that the LMS has received it. `RunAssignmentAction` reports the lock decision, not an LMS delivery acknowledgement.

Ordinary RPCs send a ten-second gRPC deadline; action streams send a 120-second deadline covering server preparation, queueing, execution, and result persistence. The action's abort signal combines a native 120-second browser timeout with its explicit cancellation controller. Starting another action aborts the preceding fetch, leaving the page aborts the active call, and completion or error retires its fetch and page listener. Grading ignores live output and replays the returned transcript only on failure; non-grade actions render output chunks as they arrive. These are output streams, without TTY input or argument negotiation. The server retains responsibility for container cleanup even after the browser receives completion and closes the stream.

Tab-scoped session storage retains only the client authentication key, not a durable journal of all unsaved editor/guest state. Closing or reloading the tab can lose edits that have not reached the TA; it does not revoke the database session. Guest disk overlays and guest-only paths are disposable and never a substitute for the official student map.


Asset publication and runtime assumptions
-----------------------------------------

1. Build using the Alpine system Node 24/npm and locked dependencies. Generate protobuf-ts bindings from the shared protocol, check types, and bundle editor, terminal, Markdown, and UI libraries locally. The page does not depend on a CDN for these libraries.
2. Prepare the configured VM image and matching release-versioned riscbox JavaScript/WASM. The guest expects the named `workspace` share and virtio console. Image preparation depends on QEMU for RISC-V, fakeroot, cpio, and e2fsprogs; ordinary UI changes must not rebuild unchanged disk-image inputs.
3. Publish the directly linked bundle, stylesheet, and favicon as `dist/app.js`, `dist/style.css`, and `dist/favicon.svg`. Keep content names for lazy chunks and fetched VM assets. Generate `index.html` from `index.template.html`, replacing it only when the page contents change. Deploy the entry page with the complete `dist/`, `vm/runtime/`, and `vm/image/` trees.
4. Retain previously published immutable assets during ordinary builds. Revalidate HTML and its stable direct dependencies; content-named assets may use long-lived immutable caching. Publication records the current UI files, content-named VM configurations, disk directories, and runtime releases in `.published-assets.json` beside the page.
5. `mostlyclean` removes build caches and all published assets outside that inventory. It keeps only the current page's assets, so older cached pages are no longer supported after the sweep. The inventory survives cleanup and remains authoritative even if newer VM assets were built without publishing a page. Standalone VM cleanup uses the same inventory but sweeps only VM assets. A page published before inventory support must be rebuilt before `mostlyclean`; an unpublished tree has no active assets. `clean` removes deployment outputs and the inventory without requiring publication metadata. Neither operation touches server data or configuration.

VM builds share one Alpine 3.24.3 minirootfs download, a matched Riscbox release, and extracted Linux/OpenSBI preparation payloads. `vm/guest/` contains common startup and account setup; sibling `vm/riscv/` and `vm/c/` trees overlay image-specific files. `build-image.sh NAME SIZE_MIB MINIROOTFS TOOL_ARCHIVE PACKAGES...` merges these inputs under fakeroot, boots a preparation initramfs with QEMU networking to install packages, exports the prepared root, and populates ext4 without a journal or host mount. Preparation logs, initramfs files, ext4 images, input inventories, and split manifests are named per image under `vm/build/`. Both images depend on `stepper/dist/stepper.linux_riscv64`, built through its component Makefile, and install it as `/usr/local/bin/stepper` during common staging. Cargo is consulted on each build; unchanged runner bytes preserve timestamps and do not rebuild images. Guest preparation never contacts the TA.

The RISC-V root is 12 MiB and adds Risclet. The C root is 16 MiB and installs make, tzdata, tcc, tcc-libs-static, and musl-dev without a tool archive. Alpine resolves TCC's supporting package dependencies. Neither image has an updater stub. Both accounts use America/Denver and the same host workspace share, with `workspace` as the browser share name and `shared` as the guest 9p tag. The C image does not install Risclet.

The C guest uses TCC and has no Clang or sanitizer runtime. Preparation removes `/usr/lib/libc.a` from musl-dev to fit the image; headers, startup objects, and shared libc remain for dynamic linking. Static libc linking is unavailable. Browser checks compile a C program with TCC and run it through the installed stepper; server grading retains its canonical problem-type compiler rules.

Disk chunks publish as sibling `riscv-drive-HASH/` and `c-drive-HASH/` directories. `vm/image/riscv.cfg` and `c.cfg` are current root configurations. Content-named copies of those configurations supply immutable URLs in the per-image `build/assets.json` map used by the UI. Both configurations reference the same release-versioned runtime, kernel, and firmware. Overlay inventories include deletions, and image preparation depends on its specific tool archive plus common inputs. UI changes do not rebuild roots. `mostlyclean` preserves only configurations, disk directories, and runtime releases recorded by page publication; it removes the unreferenced root-configuration aliases too. `clean` removes all generated VM assets, preserving the source `runtime/package.json`.

The browser needs same-origin authenticated gRPC-Web access for bookkeeping and execution. VM disk fetching and WASM availability are local-execution dependencies, not reasons to relax ownership or authorization checks. Problems without VM images retain editing and server workflows through the synchronous file adapter.

Tools are supplied by the exam image. Browser image checks verify that the updater stub is absent and run a transcript through stepper in both guests, waiting for a completion marker that cannot match the terminal's echo of the submitted command.


Audit boundaries
----------------

Preserve behavior checks for session restore/token removal; owned versus guest-only paths and hard-link/rename notifications; editor/guest changes during in-flight persistence; stale queued saves after step replacement; retry deadlines; outgoing-save failure during selection; explicit action completion, stream errors, saved grade progression and slice boundaries, and server lock decisions; selected-file reset with concurrent edits; action locking without VM reboot; and second-click emergency reset retaining dirty editor state.

Use real runtime/guest checks for VM lifecycle, share population, input backpressure, disk-overlay disposal, and same-image/different-image switching. Use browser checks for clipboard interception, read-only editing, terminal reset/history, and instructions/default-tab boot behavior. Pixel/renderer checks belong to the widget suite rather than duplicating full-page RPC tests.

Trace operations through [index.ts](index.ts), [saving.ts](saving.ts), [problem-workspace.ts](problem-workspace.ts), [editor-session.ts](editor-session.ts), and [vm-session.ts](vm-session.ts); filenames are trace points, not a required future decomposition. Run the affected Make targets described in [BUILD.md](BUILD.md), with disposable Chrome profiles and test browsers closed afterward.


Quiz entry into the VM client
-----------------------------

The VM client is shared by the existing `/exam/` LTI workflow and the attended `/quiz/` connector. Server admission is described in [server notes](../../server/NOTES.md#attended-respondus-quiz-entry). The client is stored under `www/vm` and served at `/vm/`.

A successful connector handoff opens `/vm/?assignment=...#quiz=...`. `quiz-entry.ts` immediately removes the fragment, places its raw bearer key into the existing tab-scoped session storage, and renders the supplied student/course/assignment identity using text nodes in a modal dialog. Continue is required; Escape does not dismiss it. Assignment authentication and workspace requests begin after confirmation. Ordinary `/vm/` entry and reload have no fragment and use their existing login-token/session restoration path. All grading, saving, and VM behavior stays shared. Session scope, exact station-IP checks, expiry, and revocation are enforced by the server rather than by the dialog or client URL.

Run the focused browser check with `node --test tests/quiz-entry.test.mjs` from this directory. It uses Chromium with a disposable profile and covers credential removal, tab storage, safe identity rendering, required confirmation, ordinary reload, and invalid handoffs.
