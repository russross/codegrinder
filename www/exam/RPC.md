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

*   A Riscbox `Filesystem` is the VM's live working tree. It is created lazily
    in the page's shared WASM instance, initially contains both owned file
    sets, and may accumulate guest changes and build artifacts.

The UI lists only paths present in the two owned maps. Guest-created paths do
not become visible or submit-capable. Guest writes, creates, or renames into an
existing student-owned path update `studentOwnedFiles`. Guest removal or rename
away from an owned path does not delete the canonical map entry. Guest changes
to system-owned paths remain local to the live VM.

Host writes are serialized and copy their submitted bytes. Guest notifications
start asynchronous reads of affected official paths, including hard-link
aliases and paths below renamed directories. Per-path revisions and read
generations prevent late reads from overwriting newer editor or guest work.
Save snapshots wait for pending writes and guest reads to settle.

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

Each problem has its own save state and timer. Every editor, VM, or returned
file change restarts its 30-second timer. Continuous editing postpones autosave
indefinitely. A save request cancels that timer because the queued save will
include those changes.
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
read-only, disables file/problem switching and action buttons, and stops the
local VM with its student-owned files retained. The VM remains ready to Boot
afterward. This prevents edits from racing the submitted grading snapshot or
step advancement. Returned action files can still change the workspace and
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
    current shape permits it. If a guest has made the path structurally
    incompatible, preserve the returned student bytes and ask the user to
    reboot the VM to restore its working tree. Normal end-of-stream completes
    the action; non-grade actions do not return a signed final bundle.

6.  For grade, ignore intermediate events and call `SaveGradedCommit` with the
    signed final daycare result.

7.  A saved result passes when its commit has `report_card.passed` and score
    `1.0`. Fetch the next in-scope step with `GetWorkspace`, replace both owned
    maps, rebuild the 9p tree, destroy the current VM, and leave the next step
    ready to Boot. Mark the problem complete when the current step is its last
    in-scope step.


Problem switching
-----------------

Before switching, stop the active VM and rebuild its 9p tree so no guest writes
can race the automatic Save. Save the current student revision if needed, then
select the new problem. Rebuild the selected problem's 9p tree, expose or hide
the VM tab based on its problem type, and leave its VM ready to Boot.


VM boot and reboot
------------------

Selecting the VM tab boots a ready VM. Selecting the tab while the VM is
loading, booting, or running leaves the active VM intact. Selecting it after a
runtime failure performs a clean reboot. Selecting either terminal tab focuses
that terminal. VM input, boot, and reboot explicitly flush the editor into the
local filesystem before proceeding; they do not wait for TA persistence.

The first boot loads `vm/runtime/riscbox.js` and `riscbox.wasm` in the page.
The browser loads the VM configuration with `no-store`. Riscbox opens the
existing split drive and retains session-local disk writes. The active
problem's `Filesystem` is bound under the `workspace` key before boot.
The guest terminal is
connected through its virtio console.

Terminal input is UTF-8 encoded and copied into a queue. Each browser task
offers at most 1024 bytes through `consoleInput` and retains bytes that the
guest FIFO did not accept. Reset and teardown clear queued input and invalidate
input waiting for editor writes. Console output is passed to Ghostty. Changes
to its row or column count call `consoleResize`. The VM cursor blinks; grade
output disables cursor blinking. Reset clears the screen, scrollback, and
selection without replacing the parser used by Ghostty's renderer and input
components.

The Reboot VM button resets the guest in place. The runtime resets the VM and
its device interfaces while retaining the session-local block overlay and
the current 9p filesystem. A problem switch or step advancement performs this
sequence:

1.  Halt and destroy the VM and its in-memory root-disk delta. Retain the
    WASM instance and its per-problem filesystem handles.

2.  Rebuild the 9p tree exactly from `systemOwnedFiles` and
    `studentOwnedFiles`, removing guest-only artifacts and restoring canonical
    paths.

3.  Leave the selected problem ready to boot. Its next boot binds its
    filesystem and starts the configured image in the retained runtime.

The current image lookup contains only `riscv`. Problems without a configured
image do not show the VM tab.
