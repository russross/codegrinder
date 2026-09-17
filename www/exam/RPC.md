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

*   `Memory9PServer` is the VM's live working tree. It initially contains both
    owned file sets and may accumulate guest changes and build artifacts.

The UI lists only paths present in the two owned maps. Guest-created paths do
not become visible or submit-capable. Guest writes, creates, or renames into an
existing student-owned path update `studentOwnedFiles`. Guest removal or rename
away from an owned path does not delete the canonical map entry. Guest changes
to system-owned paths remain local to the live VM.

The workspace maintains a monotonically increasing student revision. A Save or
action records the exact submitted revision. If an editor or guest change
arrives while a request is in flight, the later revision remains visibly
unsaved when the request completes.


Save
----

Save runs when the user clicks Save, leaves the editor, switches files or
problems, or starts an action. The first editor edit after a save also starts a
30-second timer that is not extended by later edits. Starting any save cancels
that timer. Concurrent ordinary save triggers share the in-flight save and
then save again only if a newer workspace revision remains.

1.  If the active problem's current revision is already saved, do nothing.

2.  Refresh the current step through `GetWorkspace`. Replace
    `systemOwnedFiles`; refresh the official student path set while retaining
    locally modified bytes for paths still owned by the student. Do not rebuild
    the live 9p tree during this same-step refresh.

3.  Build a `Commit` containing only `studentOwnedFiles`, with an empty action
    and note `exam interface: save`.

4.  Call `SaveWorkspaceCommit` and record the submitted workspace revision as
    saved. A newer concurrent revision remains unsaved.

Page close and refresh use a separate last-chance path because the browser
cannot await the normal refresh-then-save sequence during unload. On
`pagehide`, send the current in-memory student file set directly to
`SaveWorkspaceCommit` using a fetch keepalive request.


Grade and other server actions
------------------------------

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
    reboot the VM to restore its working tree.

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
runtime failure performs a clean reboot.

Boot creates a same-origin hidden iframe, configures the Riscbox globals, and
loads `vm/runtime/riscbox-wasm.js`. The guest terminal is connected through its
virtio console. The runtime's synchronous 9p endpoint delegates to the active
`Memory9PServer`. Request and response arrays are copied across the iframe
boundary because typed-array identity is realm-specific.

Terminal input is UTF-8 encoded and paced into `_console_queue_char` so pasted
commands do not overflow the emulated serial input queue. Console output is
passed to xterm as bytes for streaming UTF-8 decoding. Changes to xterm's row
or column count call `_console_resize`, which notifies the guest through its
virtio console.

Reboot performs this sequence:

1.  Destroy the iframe, its WASM runtime, and the in-memory root-disk delta.

2.  Rebuild the 9p tree exactly from `systemOwnedFiles` and
    `studentOwnedFiles`, removing guest-only artifacts and restoring canonical
    paths.

3.  Create a new iframe and boot the configured image.

The current image lookup contains only `riscv`. Problems without a configured
image do not show the VM tab.
