User interface design
=====================

This is a simple, single-page app with minimal dependencies. The
primary external libraries are:

* CodeMirror editor widget
* Wterm terminal widget, using its Ghostty backend
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
@RPC.md) to get basic info. That sequence identifies one or more
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
Wterm's clipboard events are intercepted by the document policy before its
own handlers. Private terminal paste respects bracketed-paste mode and removes
escape characters inside a bracketed payload. Grade output rejects input.
Application clipboard requests do not access the system clipboard.

Both terminals use separate Ghostty cores with 64 KiB history budgets.
Wterm renders text and backgrounds in the DOM, with geometric CSS drawing for
supported box characters. Painting is scheduled when output changes rather
than continuously polling the terminal. Fractional display scaling and browser
zoom are covered by browser rendering checks. Straight box strokes overlap
only at connected cell edges and stop at their junction boundaries. A build
integration supplies each box character's arm directions to CSS and requires
review if Wterm changes that renderer. The terminal grid fills partial-row
space below the live screen so bottom alignment does not expose scrollback
above the screen after clearing. Padding belongs to the outer host, while a
separate inner surface owns scrolling and clips history at the viewport edge.
Its height uses whole CSS pixels to match browser scroll-height measurements.
The viewport integration uses the live-screen boundary when following output
and omits off-screen history overscan at the bottom. This prevents history
paint from bleeding across fractional physical-pixel edges. Scrolling up
retains the usual history window and overscan.
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
        *   Each problem has its own 30-second timer. Every editor, VM,
            or returned-file change restarts that timer, postponing autosave
            indefinitely while editing continues. Immediate save requests
            cancel the timer. Edits after a submitted snapshot start a new
            deadline, and its response only acknowledges the submitted edits.
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
        *   Student-owned files (or folders that contain them) are
            sorted first. Within each group, files are listed before
            directories, and then all items are sorted alphabetically.
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
        *   Clicking on a file opens it in the editor
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
            *   `*.s` or `*.S`: assembly language syntax (using GAS mode)
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
            *   Grade output: the Ghostty instance fills the space
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
                *   The terminal has a 64 KiB scrollback budget.
            *   VM: an interactive Ghostty instance connected to a
                browser-hosted Alpine RISC-V virtual machine
                *   This tab is present only when an image is configured
                    for the active problem type. The current configuration
                    provides one image for the `riscv` problem type.
                *   Selecting the VM tab boots the VM when it is not already
                    active. Selecting the tab again does not reboot an active
                    VM and focuses the terminal.
                *   Both terminals use 18px Latin Modern Mono with a
                    monospace fallback. The VM uses a black background and
                    the demo's ANSI palette. The VM cursor blinks; grade
                    output hides its cursor and rejects input.
                *   Boot VM appears at the right edge of the main action bar.
                    Once booted, the control becomes Reboot VM.
                *   Reboot resets the guest in place and retains the VM's
                    session-local root-disk changes and shared 9p tree.
                    It clears terminal output, scrollback, selection, and
                    pending input.
                *   The terminal uses the guest's virtio console. The guest
                    receives terminal-size changes without rebooting. The
                    terminal uses Wterm's DOM renderer so box-drawing
                    lines remain connected. The guest mounts the shared tree
                    at `/home/student`.
                *   Guest writes to student-owned paths are reflected in
                    the editor and submission state. Guest changes to
                    system-owned files remain temporary inside the VM.
                *   Guest-created files and build artifacts remain usable
                    in the VM but do not appear in the file tree and are not
                    submitted to the server.
                *   Switching problems or advancing steps destroys the VM,
                    rebuilds the shared tree, and leaves the new context
                    ready to Boot.
        *   The information pane defaults to 45% of the window
            width, but can be resized freely by the user
