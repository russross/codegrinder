gRPC message sequences
======================

The protocol is defined in `protocol/codegrinder.proto`. The browser uses the
generated protobuf-ts field names.

The one-time login token is used only by `Hello`. The returned raw session key
is stored in tab-scoped session storage, and the token is removed from the URL.
All later TA requests carry the session key as
`authorization: Bearer SESSION_KEY` metadata. Daycare receives its signed
runtime bundle without the TA session key.


Initial assignment load
-----------------------

1.  Parse the `assignment=user_id:course_id:problem_set_id` and optional `token`
    URL parameters.

2.  When the URL contains a token, call `Hello` with it. Require a non-empty
    authenticated user ID and session key, store the session key in
    `sessionStorage`, and remove the one-time token from the URL.

3.  When the URL does not contain a token, load the session key from
    `sessionStorage` and validate it by calling `Hello` with an empty token and
    the key as authorization metadata. A missing or invalid saved session
    requires the assignment to be relaunched from Canvas.

4.  Call `GetAssignment` with the parsed `AssignmentKey`. Require its user ID
    to match the authenticated user.

5.  For each `AssignmentProblemProgress`, call `GetWorkspace` with:

    *   the assignment key and problem ID;
    *   step number zero, selecting the student's current step;
    *   `WORKSPACE_FILE_STATE_CURRENT`;
    *   contents included; and
    *   solution files excluded.

6.  Store the returned `system_owned_files` and `student_owned_files` in a
    `ProblemWorkspace`. Build its browser-hosted 9p tree from the system files
    followed by the student files.

7.  Render `doc/doc.md`, the visible file tree, the first student-owned file,
    and the problem's actions. Enable the VM tab only when the current problem
    type has a configured VM image.


Workspace state
---------------

Each problem keeps three related pieces of state:

*   `systemOwnedFiles` is the latest canonical system file set from the TA.
    The editor displays these files read-only.

*   `studentOwnedFiles` is the current savable student file set. Editor writes
    and valid guest writes update this map.

*   A Riscbox `Filesystem` is the current VM-owned working tree. Selection and
    step transitions rebuild it from official maps; guest-only namespace entries
    do not survive. Step-start bytes remain separate for CodeGrinder file Reset.

The UI lists only paths present in the two owned maps. Guest-created paths do
not become visible or submit-capable. Guest writes, creates, or renames into an
existing student-owned path update `studentOwnedFiles`. Guest removal or rename
away from an owned path does not delete the canonical map entry. Guest changes
to system-owned paths remain local to the live VM. Instructions and system-file
views use canonical bytes even when the guest changes or removes those paths.

Host reads and writes are synchronous and copy their bytes. Notifications from
both host and guest update official paths, including hard-link aliases and
paths below renamed directories. Identical bytes do not increment submission
revisions. The editor owns its buffered revisions and write failures;
the application owns server acknowledgements and retry deadlines.

The workspace maintains a monotonically increasing student revision. A Save or
action records the exact submitted revision. If an editor or guest change
arrives while a request is in flight, the later revision remains visibly
unsaved when the request completes.


Save
----

Save runs when the user clicks Save, leaves the editor, or switches files or
problems. These requests, timed saves, and grading/actions enter one serialized
queue. Each request captures its problem and step's save state. A request for a
replaced step is ignored; a redundant workspace save becomes a no-op when it
reaches the front of the queue.

The editor debounces its buffered changes for thirty seconds after the
latest edit. Blur and timer flushes immediately enqueue server persistence.
Each problem separately debounces guest and returned-file changes. Explicit
Save and file selection flush the editor before entering the server queue.
VM interaction flushes editor bytes independently of network persistence.
Submitting a snapshot allows the first subsequent edit to start a new timer.
Only a successful persistence response acknowledges the submitted revision.
If newer edits exist, their deadline is preserved; otherwise the problem becomes
clean and any remaining timer is canceled. Failed saves remain dirty and retry
after 30 seconds unless an earlier timer or save request handles them.

The deadline controls when a save is requested. Network latency and an operation
already running in the queue can delay persistence.

1.  If the requested problem's current revision is already saved, do nothing.

2.  Refresh the current step through `GetWorkspace`. Replace
    `systemOwnedFiles`; refresh the official student path set while retaining
    locally modified bytes for paths still owned by the student. Do not rebuild
    the live 9p tree during this same-step refresh.

3.  Build a `Commit` containing only `studentOwnedFiles`, with an empty action
    and note `exam interface: save`.

4.  Call `SaveWorkspaceCommit` and record the submitted workspace revision as
    saved only when the response is `SAVED`. A newer concurrent revision remains
    unsaved, even if another problem has since been selected.

Grade and other server actions
------------------------------

The entire action, including both persistence calls and daycare execution,
occupies the same queue as ordinary saves. Requesting an action makes the editor
read-only and disables file/problem switching, action buttons, and VM input.
The VM keeps its current boot state. Returned action files can change the workspace and
start an autosave deadline; that save waits for the action to finish.

1.  Refresh the current workspace as described by Save.

2.  Build a `Commit` containing only `studentOwnedFiles`, the selected action,
    and note `exam interface: ACTION`.

3.  Wrap it in a `GradingCommit` and call `SaveUngradedCommit`.

4.  Send the returned `SignedRuntimeBundle` to the daycare hostname encoded in
    its `RuntimeBundle`.

5.  For non-grade actions, display streamed terminal events. An `EventMessage`
    containing files may update only existing student-owned paths. Those bytes
    update both `studentOwnedFiles` and the corresponding live 9p file when its
    current shape permits it. A structurally incompatible path reports a write
    failure while retaining the returned official bytes for persistence.
    Normal end-of-stream completes
    the action; non-grade actions do not return a signed final bundle.

6.  For grade, ignore intermediate events and call `SaveGradedCommit` with the
    signed final daycare result. Apply its returned official student files to
    the local workspace and views without changing VM power state.

7.  A saved result passes when its commit has `report_card.passed` and score
    `1.0`. Fetch the next in-scope step with `GetWorkspace`, replace both owned
    maps, force halt, discard disk overlays, replace the 9p tree, and select
    Instructions. Boot waits for a user action, except when instructions are
    absent and VM becomes the default tab. Mark the problem complete on its last
    in-scope step without resetting or rebooting the VM. Failed grades likewise
    leave power state unchanged.


Problem switching
-----------------

Selections are serialized and carry a generation check. Flush the editor,
disable editing and input, select Instructions, and force halt. Capture and save
the outgoing official student revision before replacing files. A failed outgoing save leaves
the halted workspace available for retry. Superseded selections do not replace
the visible problem.

Same-image selections reuse the runtime, cold-reset it, discard disk overlays,
and clear/rebuild 9p from the incoming canonical system and current student maps.
Different images destroy the old runtime and prepare new VM-owned shares. Leave
the VM ready without booting and select Instructions. Missing instructions select
VM and trigger boot. Step advancement uses the same clean preparation.
Problems without a configured image use a synchronous exam file adapter.


VM boot and reboot
------------------

Selecting the VM tab boots a ready VM. Selecting the tab while the VM is
loading, stopping, or running leaves the active VM intact. A repeated Reboot VM
click during shutdown provides forced recovery. Selecting either terminal tab focuses
that terminal. VM input, boot, and reboot explicitly flush the editor into the
local filesystem before proceeding; they do not wait for TA persistence.

First selection loads the release-versioned Riscbox adapter and matching WASM.
The VM session prepares the configured HTTP-backed disk and named
`workspace` share without booting. Same-image selections discard disk writes.
The guest terminal is
connected through its virtio console.

Terminal input is UTF-8 encoded and copied into a queue. Each browser task
offers at most 1024 bytes through `consoleInput` and retains bytes that the
guest FIFO did not accept. Reset and teardown clear queued input and invalidate
input waiting for editor writes. Console output is passed to xterm.
Changes to its row or column count call `consoleResize`.
The VM cursor blinks; grade output hides its cursor. Reset clears the screen, scrollback, and
selection by replacing the parser and renderer, which retires queued old output.
Orderly reboot retains the parser and terminal history.

Reboot VM flushes the editor and requests orderly guest reboot. The button stays
enabled and changes its label to Reset VM while terminal input is blocked.
Boot VM, Reboot VM, and Reset VM use the same fixed width. Editing, saves,
and 9p synchronization continue. Clicking again before a runtime halt/restart
notification invokes forced reset without flushing editor text. After that
notification, clicks resume normal Boot/Reboot behavior. A halted VM boots its
retained state.

Second-click reset is emergency recovery: force halt outside the selection queue, retire
stalled selections and pending input, cold-reset the machine, discard all disk
overlays, clear 9p, rebuild it from current official maps, and boot it.
It preserves the dirty editor buffer and submission state. It does not flush editor text, restore originals, or
send a Reset/save RPC. There is no separate Reset VM button. Boot/Reboot is
disabled while loading/resetting. CodeGrinder's file Reset is independent.

The current image lookup contains only `riscv`. Problems without a configured
image do not show the VM tab.
