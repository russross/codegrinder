User interface design
=====================

This is a simple, single-page app with minimal dependencies. The
primary external libraries are:

* CodeMirror editor widget
* xterm.js terminal widget, also referred to as @xterm/xterm
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
            unsaved changes, the save action initiates the doAction
            operation with the action parameter set to the empty
            string.
        *   It is only clickable when there are unsaved changes to a
            student-owned file, whether made through the editor, VM,
            or a server action
        *   Leaving the editor automatically saves unsaved changes. This
            includes selecting the VM terminal.
        *   The first editor change after a save starts a 30-second timer.
            Further edits do not reset it. Any save cancels the timer; edits
            made after an in-flight save's submitted revision start a new one.
        *   Closing or refreshing the page sends the current unsaved workspace
            through a page-exit keepalive save.
    *   One button for each of the actions defined for the problem
        type of the current step of the active problem
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
                *   This tab is selected by default when the page
                    first renders or the active problem is changed
            *   Terminal: the xterm.js instance fills the space
                *   The terminal is readonly for the user. It shows
                    output and status info but accepts no user input
                *   There is no visible cursor.
                *   The terminal has default ANSI colors with a dark
                    background
                *   The terminal is writable from various actions in
                    the UI
                *   The contents of the terminal are cleared when
                    the user switches problems
                *   The terminal tab is automatically selected any
                    time there is any output to the terminal
                *   The terminal fits its container and resizes
                    dynamically.
                *   The terminal has a scrollback buffer of 500
                    lines
            *   VM: an interactive xterm.js instance connected to a
                browser-hosted Alpine RISC-V virtual machine
                *   This tab is present only when an image is configured
                    for the active problem type. The current configuration
                    provides one image for the `riscv` problem type.
                *   Selecting the VM tab boots the VM when it is not already
                    active. Selecting the tab again does not reboot an active
                    VM.
                *   Boot VM appears at the right edge of the main action bar.
                    Once booted, the control becomes Reboot VM.
                *   Reboot destroys the current VM and its root-disk delta,
                    reconstructs the shared 9p tree from the system-owned
                    and student-owned file sets, and boots a clean image.
                *   The terminal uses the guest's virtio console. The guest
                    receives terminal-size changes without rebooting. The
                    terminal uses xterm's custom WebGL glyphs so box-drawing
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
