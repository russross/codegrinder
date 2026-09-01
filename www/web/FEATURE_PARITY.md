Web client feature parity
=========================

This file records behavior from the standalone predecessor web client that is
not currently present, or is not yet known to be equivalent, in `www/web`.
It is a starting point for a later feature-parity pass after the TypeScript
conversion and worker protocol are complete.

The reference implementation is the `master` branch of:

    https://github.com/6oranges/codegrinder-python-web

Compatibility target
--------------------

The target is behavior the predecessor actually supported. It is not the full
set of libraries or interfaces used by assignments that can be graded by a
daycare. In particular, the predecessor did not provide pygame or Tkinter
display and event integration. Raw keyboard and mouse event forwarding are out
of scope unless a separate requirement is established later.

The predecessor's terminal input was line-oriented. The page submitted input
only when Enter was pressed, including for the Skulpt Turtle path. The worker
blocked while waiting for that line. See `scripts/app.js`, lines 95-176, and
`scripts/pythonWorker.js`, lines 18-31, in the predecessor repository.

Known gaps
----------

Turtle through Skulpt
~~~~~~~~~~~~~~~~~~~~~

The predecessor ran a file through Skulpt when its source contained the exact
text `import turtle`. Skulpt ran on the main thread, received line-oriented
terminal input, rendered into the `#turtle` element, and could not be stopped
safely. It operated on the selected file rather than the complete virtual file
tree.

The current client has no Skulpt runtime or Turtle dispatch. The display
element remains, but is currently used for Matplotlib images.

Old implementation:

*   `scripts/app.js`, lines 153-199
*   `index.html`, lines 74-79
*   `skulpt/skulpt.min.js`
*   `skulpt/skulpt-stdlib.js`

SQL execution
~~~~~~~~~~~~~

The predecessor recognized selected `.sql` files. Running a file executed its
contents with SQLite and stored the database at `bin/data.db`. Entering a line
while a SQL tab was selected executed that line and printed returned rows with
pandas.

The current Python runtime treats `.sql` files as Python source and has no SQL
line mode.

Old implementation:

*   `scripts/app.js`, lines 130-138 and 217-239
*   `scripts/pythonWorker.js`, lines 71-107

Requirements discovery
~~~~~~~~~~~~~~~~~~~~~~

The predecessor found every file whose path contained `requirements.txt` and
loaded its non-comment lines. Existing assignments include requirements files
below `bin/` and `doc/`, not only at the workspace root.

The current `scripts/pythonRuntime.ts` reads only the root
`requirements.txt`. A parity pass should first determine which nested files
were intentional runtime requirements, then preserve the predecessor behavior
that existing assignments rely on.

Old implementation:

*   `scripts/app.js`, lines 252-302
*   `scripts/pythonWorker.js`, lines 139-183

Problem setup script
~~~~~~~~~~~~~~~~~~~~

When `bin/setup.py` existed, the predecessor ran it automatically after loading
a problem and before normal interaction. This was used to prepare runtime data
such as `bin/data.db`.

The current client does not run `bin/setup.py` automatically.

Old implementation:

*   `scripts/app.js`, lines 303-317

Pyodide `asttest.py` compatibility
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The predecessor rewrote a specific coverage section in files whose path
contained `asttest`. The replacement avoided `trace` coverage-file behavior
that did not work correctly in its Pyodide environment. Many extracted
assignments contain this helper.

The current client copies these files without that rewrite. Before restoring
the old patch, verify whether it remains necessary with the supported Pyodide
version. If it is necessary, implement the behavior at an explicit runtime
boundary rather than as an untyped mutation in application glue.

Old implementation:

*   `scripts/app.js`, lines 261-294

Behavior to preserve during worker cleanup
------------------------------------------

The worker protocol may be simplified without preserving the predecessor's
generic SharedArrayBuffer queues. Preserve these observable behaviors instead:

*   Python and JavaScript execution can block waiting for a submitted input
    line.
*   stdout and stderr appear incrementally, including output made visible by
    an explicit flush.
*   remaining output is delivered before an execution-complete message.
*   stopping execution terminates the worker and unblocks outstanding input.
*   Python dependency loading reports completion or failure.
*   Matplotlib `show()` sends a PNG to the page.

The old queue and service-worker implementations are useful for understanding
the earlier mechanism, but are not themselves compatibility requirements:

*   `scripts/atomicQueue.js`
*   `scripts/iframeSharedArrayBufferWorkaround.js`
*   `scripts/pythonHandler.js`
*   `scripts/pythonWorker.js`
*   `sw.js`

