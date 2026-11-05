User interface design
=====================

This is a simple, single-page app with minimal dependencies. The
primary external libraries are:

* CodeMirror editor widget
* xterm 6 terminal widget with Fit and WebGL addons, bundled locally
* split.js split window panes with draggable gutters

The app is launched on the same server and port as a gRPC server
that the app interacts with. At start time it is given:

* A URL parameter `token=` used once to obtain a session key from
  `Hello`; the key is retained in tab-scoped session storage and the
  token is then removed from the URL
* A URL parameter `assignment=` containing the assignment key as
  `user_id:course_id:problem_set_id`

At startup a new Canvas launch exchanges the token for a session key.
A refresh validates and reuses the session key stored for that browser
tab. Closing the tab ends the client-side exam session, and opening a
fresh session requires relaunching the assignment from Canvas. The
session and assignment key drive the "loadAssignment" operation (see
[NOTES.md](NOTES.md)) to get basic info. That sequence identifies one or more
problems that are part of this assignment, which leads to one or more
"loadProblem" operations to load them. We choose one of these problems
as the "active problem".

Important: The "active problem" is the context of most UI
interactions. Any other problems are completely ignored until the
user changes the active problem.


Clipboard behavior
------------------

Copy, cut, and paste use one private text buffer shared by instructions,
the editor, action output, and the VM terminal. The buffer lives only in
memory and survives focus changes and problem switching; reloading the
page clears it. Editor cuts and pastes preserve undo history and cannot
modify read-only files. Cutting selected terminal output or instructions
copies it without deleting it.

The system clipboard receives `[redacted]` when the private buffer contains
text and empty text otherwise. Copy and cut events replace their outgoing
payload with this marker. Copy, cut, paste, window focus and blur, and tab
visibility changes also attempt to write the marker through the browser
clipboard API while the document is focused and has active user interaction.
Writes without that interaction are skipped to avoid Chrome's clipboard
permission prompt. Failed writes do not interrupt editing. Paste never reads
the system clipboard.

Keyboard shortcuts and native clipboard events use the same private buffer.
The VM supports Ctrl+Shift+C/V; Ctrl+C without selected terminal text remains
a guest interrupt. Standard Ctrl/Cmd+C/X/V and Insert-based clipboard
shortcuts are also supported. Native context-menu Paste availability depends
on whether the browser permitted the system marker to be written.

Middle-button copying/pasting and HTML drag/drop are blocked inside the app.
xterm's clipboard events are intercepted by the document policy before its
own handlers. Private terminal paste respects bracketed-paste mode and removes
escape characters inside a bracketed payload. Grade output rejects input.
Application clipboard requests do not access the system clipboard.

Both terminals use separate xterm parsers with 1,000 scrollback lines.
WebGL draws connected box characters at device-pixel cell boundaries; the DOM
renderer remains available when WebGL is unavailable. Painting follows output
changes. Fractional scaling, scrolling, and repeated resets have browser tests.
Padding belongs to the outer host, and the screen remains top-aligned with
unused fractional rows below it. Forced reset replaces the entire parser and
renderer, retiring queued output, protocol replies, and incomplete UTF-8.
Orderly reboot also clears the parser and history. Guest OSC 52 requests are
consumed without accessing the system clipboard.
Pane resizing remains available. Browser restrictions can prevent system
clipboard writes, and the page cannot control Linux PRIMARY selection
export or clipboard operations performed outside the page.


UI layout
---------

Here is the complete layout of the UI:

*   At the top there is a bar of buttons:
    *   Each problem gets a button whose text is the `note` field of
        the `Problem` object.
        *   The active problem is not clickable
        *   Clicking on a different problem button does the
            following:
            *   Force an automatic "save" action (see "Save" button
                spec)
            *   Switch the active problem to the one that was
                clicked
            *   Refresh the UI so everything is based around the new
                active problem

    *   A "Save" button.
        *   Triggers the "save" action, referenced numerous times in
            this document. The save action is a no-op if there are
            no unsaved changes in the active problem. If there are
            unsaved changes, it requests a workspace save through the
            same serialized queue used by timers and server actions.
        *   It is only clickable when there are unsaved changes to a
            student-owned file, whether made through the editor, VM,
            or a server action
        *   Leaving the editor automatically saves unsaved changes. This
            includes selecting the VM terminal.
        *   The editor flushes thirty seconds after the latest edit or on blur,
            then immediately requests server persistence. Each problem has a
            separate thirty-second debounce for guest and returned-file changes.
            A response acknowledges only the submitted revision; newer edits
            remain unsaved.
        *   Failed saves remain dirty and retry after 30 seconds unless an
            earlier timer or save request handles them.
    *   A "Reset" button immediately after "Save".
        *   Fetch the starting workspace for the current problem step and
            refresh system-owned files without replacing student work.
        *   Compare all student-owned files with their starting contents.
        *   Always open a modal dialog. If nothing changed, show only the
            explanation and "Cancel". Otherwise show a "Changed files" list.
        *   Only offer confirmation when the currently edited student file
            differs from its starting contents. Reset affects only that file.
        *   Focus "Cancel" by default and require a button click to dismiss.
            If student files changed while the dialog was open, update it and
            require confirmation again.
        *   Preserve editor undo history. After resetting, save the workspace
            and synchronize the restored file with the VM filesystem.
    *   One button for each of the actions defined for the problem
        type of the current step of the active problem
        *   Requesting an action makes the editor read-only, disables file
            and problem switching and action buttons, and stops the local VM
            while retaining student-owned files. The full action shares the
            save queue; the controls are restored when it finishes, and the
            VM is ready to Boot.
        *   The problem type has a map called `actions` in the gRPC
            protocol def that maps action names to ProblemTypeAction
            objects.
        *   The text of each button is the `name` field of the
            problem type action, with its first letter capitalized
        *   The action buttons are in sorted order
        *   Clicking an action button triggers the doAction
            operation with the `name` field of the problem set
            action as the paramter.
*   Below the button bar, the rest of the page is divided using
    split.js into three panes with vertical dividers between them.
    There are no size limits on the panes: the user can drag the
    sizers to make them as large or as small as they want.
    *   The leftmost pane has the file selection tree
        *   The items are the system-owned and student-owned files
            returned by `GetWorkspace` for the active problem
        *   File names are paths like "start.s" and
            "inputs/test.transcript", so they are parsed and
            organized into a hierarchy like a unix file tree
        *   Student-owned files (or folders that contain them) are sorted first. Within each group, files precede directories, and names are sorted alphabetically. This ordering applies in every directory, including the root.
        *   It is rendered as a simple unordered list, with placeholder
            icons instead of bullet points. Specific icons are not
            defined in the JavaScript, but can be added via CSS.
        *   No dynamic motion: folders do not collapse or anything,
            the list is just there
        *   File names are highlighted when the mouse hovers over
            them, but folders are not
        *   The file currently being edited has a permanent
            highlight. This highlight is clear and prominent as it
            is the only indication in the UI of which file is
            currently being edited
        *   Clicking a file opens it in the editor. File buttons also support
            Tab navigation and Enter/Space activation.
        *   System-owned files are opened read-only; student-owned
            files can be modified
        *   The `doc` directory and its files are filtered out of
            the file list for display and selection purposes.
        *   The file selection tree starts out only 10% of the width
            of the window, but can be resized freely
    *   The middle pane is the editor (a CodeMirror instance)
        *   When the page first loads/active problem is first set,
            a student-owned file is automatically selected and
            loaded into the editor
        *   When the user switches to a different file, an automatic
            "save" action happens (see "Save" button spec).
        *   Student-owned files can be modified; system-owned files
            are read-only
        *   Any edit marks the active problem as modified, which
            also activates the "Save" button
        *   Changes made in the editor update the active problem's
            student-owned file set and its VM workspace
        *   Syntax highlighting is based on the file name extension
            *   `*.s` or `*.S`: the teaching assembly dialect, including exact
                directives, register aliases, and invalid-token highlighting
        *   Syntax highlighting should be implemented for:
            *   `*.c` or `*.h`: C syntax
            *   `*.s` or `*.S`: assembly language syntax
            *   `*.md`: markdown syntax
            *   `*.py`: python syntax
            *   `Makefile`: makefile syntax
            *   Everything else is plain with no highlighting
        *   The editor pane starts at 45% of the window width but
            can be resized freely
    *   The right pane is the information pane
        *   It has Instructions and Terminal tabs and, for RISC-V
            problem steps, a VM tab
            *   Instructions renders `doc/doc.md` from the current
                workspace and embeds referenced workspace images.
                *   Changes to the canonical document or its referenced
                    images refresh the rendered instructions.
                *   This tab is selected by default when the page
                    first renders or the active problem is changed
            *   Grade output: the xterm instance fills the space
                *   The terminal is readonly for the user. It shows
                    output and status info but accepts no user input
                *   The cursor does not blink.
                *   The terminal uses a light background and a readable
                    ANSI palette.
                *   The terminal is writable from various actions in
                    the UI
                *   The contents of the terminal are cleared when
                    the user switches problems
                *   The terminal tab is automatically selected any
                    time there is any output to the terminal
                *   The terminal fits its container and resizes
                    dynamically.
                *   The terminal retains 1,000 scrollback lines.
            *   VM: an interactive xterm instance connected to a
                browser-hosted Alpine RISC-V virtual machine
                *   This tab is present only when an image is configured
                    for the active problem type. The current configuration
                    provides images for the `riscv` and `cinout` problem types.
                *   Loading a problem or changing its type prepares a clean VM and selects
                    Instructions without booting. Same-type changes preserve VM power. Selecting VM or Boot VM boots
                    it. Without instructions, VM is the default tab and boots.
                    Selecting the VM tab again does not reboot an active VM.
                *   Both terminals and the editor use Latin Modern Mono with a
                    monospace fallback and the browser's initial preferred font size.
                    The VM uses a black background and
                    the demo's ANSI palette. The VM cursor blinks; grade
                    output hides its cursor and rejects input.
                *   Boot VM appears at the right edge of the main action bar.
                    Once booted, the control becomes Reboot VM.
                *   Reboot requests orderly guest restart and retains the VM's
                    session-local root-disk changes and shared 9p tree.
                    It clears terminal output, scrollback, parser state, and pending input.
                    During shutdown the button stays enabled, changes its label
                    to Reset VM, and keeps the same width across Boot VM,
                    Reboot VM, and Reset VM labels. After restart it
                    returns to Reboot VM. During the wait,
                    terminal input is blocked. Editing, saves, and filesystem
                    synchronization continue. Clicking Reset VM before
                    the halt/restart notification forces a clean VM reset.
                    After that event, the button resumes normal behavior.
                *   The second-click recovery force-halts and
                    discards disk overlays, clears 9p, rebuilds canonical system
                    files and current official student files, and boots.
                    It preserves editor text, including unsynchronized edits.
                    Guest-only files, links, and metadata are discarded.
                    It sends no Reset/save RPC. There is no separate Reset VM
                    control. Boot/Reboot is disabled while loading or resetting.
                *   The terminal uses the guest's virtio console. The guest
                    receives terminal-size changes without rebooting. The
                    terminal uses xterm's WebGL renderer so box-drawing
                    lines remain connected. The guest mounts the shared tree
                    at `/home/student`.
                *   Guest writes to student-owned paths are reflected in
                    the editor and submission state. Guest changes to
                    system-owned files remain temporary inside the VM and do
                    not affect instructions or system-file views.
                *   Guest-created files and build artifacts remain usable
                    in the VM but do not appear in the file tree and are not
                    submitted to the server.
                *   Problem type changes force halt, discard
                    disk overlays, and rebuild 9p from the official workspace.
                    Same images reuse the runtime; different images replace it.
                    Instructions are selected and boot waits for a user action,
                    except when missing instructions make VM the default tab.
                *   Same-type problem switches clear and recopy official files
                    into the mounted 9p tree, preserving power and disk overlays.
                    Changed server file sets use the same live replacement.
                *   Save, Grade, and other actions preserve VM power state.
                    Returned files update 9p and views. Advancement to a
                    new step rebuilds 9p and preserves VM power when its type is unchanged. Failed and final-step grades
                    preserve the running session.
        *   The information pane defaults to 45% of the window
            width, but can be resized freely by the user
