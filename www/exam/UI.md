User interface design
=====================

This is a simple, single-page app with minimal dependencies. The
primary external libraries are:

* CodeMirror editor widget
* xterm.js terminal widget, also referred to as @xterm/xterm
* split.js split window panes with draggable gutters

The app is launched on the same server and port as a gRPC server
that the app interacts with. At start time it is given:

* A cookie `codegrinder=` used in all gRPC requests for
  authentication/session linking
* A URL parameter `assignment=` with an integer ID to indentify the
  assignment that is the context of this session

At startup the cookie and the assignment ID are used to drive the
"loadAssignment" operation (see @RPC.md) to get basic info. That
sequence identifies one or more problems that are part of this
assignment, which leads to one or more "loadProblem" operations to
load them. We choose one of these problems as the "active problem".

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
    *   There is a divider between the problem selection buttons and
        the rest of the buttons
    *   A "Save" button.
        *   Triggers the "save" action, referenced numerous times in
            this document. The save action is a no-op if there are
            no unsaved changes in the active problem. If there are
            unsaved changes, the save action initiates the doAction
            operation with the action parameter set to the empty
            string.
        *   It is only clickable when there are unsaved changes to a
            file in the active problem made through the editor
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
        *   The items are files from the file set in the active
            problem
        *   File names are paths like "start.s" and
            "inputs/test.transcript", so they are parsed and
            organized into a hierarchy like a unix file tree
        *   Files named in the ProblemStep `whitelist` map (or
            folders that contain such files) are sorted first in the
            list. The `whitelist` map maps file path names to a
            boolean that is always true.
        *   It is rendered as a simple unordered list, but with
            suitable icons instead of bullet points.
        *   No dynamic motion: folders do not collapse or anything,
            the list is just there
        *   File names are highlighted when the mouse hovers over
            them, but folders are not
        *   The file currently being edited has a permanent
            highlight. This highlight is clear and prominent as it
            is the only indication in the UI of which file is
            currently being edited
        *   Clicking on a file opens it in the editor
        *   Files not in the problem step whitelist are opened
            read-only in the editor, those in the whitelist can be
            modified
        *   The `doc` directory and its files are filtered out of
            the file list for display and selection purposes.
        *   The file selection tree starts out only 10% of the width
            of the window, but can be resized freely
    *   The middle pane is the editor (a CodeMirror instance)
        *   When the page first loads/active problem is first set,
            a file from the whitelist is automatically selected and
            loaded into the editor
        *   When the user switches to a different file, an automatic
            "save" action happens (see "Save" button spec).
        *   Files named in the problem step whitelist can be
            modified, those not in the list are readonly
        *   Any edit marks the active problem as modified, which
            also activates the "Save" button
        *   Changes made in the editor are reflected in the active
            file set
        *   Syntax highlighting is based on the file name extension
        *   Important special case: `*.s` and `*.S` extensions
            indicate RISC-V assembly language. If RISC-V syntax
            definitions are not available, use Aarch64 or MIPS
            assembly as fallbacks if they are available
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
        *   It has two tabs
            *   Instructions: the `instructions` field of the
                problem step is an HTML fragment that is simply
                dropped in place when this tab is active.
                *   The instructions HTML is generated on the server
                    from markdown, so suitable styling for common
                    HTML elements generated by markdown should be
                    included in the CSS.
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
        *   The information pane defaults to 45% of the window
            width, but can be resized freely by the user
