Web interface
=============

This directory contains the canonical CodeGrinder browser interface. It is
served as static content by the CodeGrinder server and uses the current
gRPC-Web API. Local execution initially supports the `javascriptunittest` and
`python3unittest` problem types.

Runtime data flow
-----------------

The launch URL has the form:

    /web/?assignment=USER_ID:COURSE_ID:PROBLEM_SET_ID&token=LOGIN_TOKEN

The login token is exchanged through `Hello` for a raw session key. The token
is then removed from the browser URL. Authenticated TA requests send the session
key in gRPC metadata. The browser keeps the session key in local storage so a
reload can call `Hello` and restore the session.

Assignment work uses server-owned workspace state:

1.  `GetAssignment` returns the problems and current steps.
2.  `GetWorkspace` returns canonical system-owned files, student-owned files,
    and the actions available for a step.
3.  Sync refreshes the workspace and sends only student-owned files to
    `SaveWorkspaceCommit`.
4.  Grade calls `SaveUngradedCommit`, streams the signed bundle through
    `Daycare`, and sends the returned signed bundle to `SaveGradedCommit`.
5.  Interactive actions stop after Daycare and do not call
    `SaveGradedCommit`.
6.  Reset reloads `WORKSPACE_FILE_STATE_STEP_START` and changes only the local
    browser workspace.

The Test control appears when the workspace advertises a `test` action. It is a
shortcut for that ordinary non-grade daycare action unless the selected local
runtime supplies a test runner. `python3unittest` runs unittest discovery in
Pyodide for immediate feedback. Starting local tests while a program is still
running terminates that worker and waits for its replacement before test
discovery begins. JavaScript tests use the canonical `make test` daycare
action. Other advertised actions are appended to the toolbar as direct buttons;
there is no general Action menu.

`GetWorkspace` also returns the current problem type. `local-runtimes.json`
maps exact problem types to browser runtimes. Selecting a supported workspace
dynamically imports its runtime; unsupported problem types retain editing,
sync, grade, reset, and daycare actions without a local Run command. Python
code and Pyodide are never requested by a JavaScript-only session.

Standalone and Canvas quiz embeds use `dummy=true`, carry their complete file
tree in `files`, and carry an exact `problemType`. Dummy mode does not initialize
the CodeGrinder API client or make daycare calls. Legacy `/web/` embeds without
`problemType` continue to use `python3unittest`, matching the former Python web
client. The standalone editor accepts the same `problemType` parameter and
presents the supported types as buttons when generating embed HTML.

The frontend treats signed runtime-bundle bytes as opaque. It decodes a copy to
find the daycare hostname and inspect the final report, but forwards the
original bytes unchanged.

Source layout
-------------

*   `scripts/app.ts` owns browser state and connects the editor UI to the API
    client. `scripts/app.js` is its deployable bundle.
*   `scripts/codeGrinder.ts` is the typed source API client and protocol-facing
    application boundary.
*   `scripts/protocol.ts` validates paths and consumes the streamed daycare
    responses used by the API client.
*   `scripts/embed.ts` builds standalone embed URLs and selects their local
    problem type.
*   `scripts/directoryTree.ts` validates the flat byte workspace and derives
    the directory view used by the UI; `scripts/editorTabs.ts` implements the
    editor tabs. Their corresponding JavaScript files are deployable bundles.
*   `local-runtimes.json` maps supported problem types to local runtimes.
*   `scripts/localRuntime.ts` validates that map and selects and owns the one
    active local runtime.
*   `scripts/jsRuntime.ts` and `scripts/jsHandler.ts` manage the JavaScript
    runtime and its worker; `scripts/jsWorker.ts` executes student JavaScript.
*   `scripts/pythonRuntime.ts` and `scripts/pythonHandler.ts` manage the Python
    runtime and its worker; `scripts/pythonWorker.ts` lazily loads Pyodide and
    executes student Python.
*   `scripts/workerProtocol.ts` defines the commands and events shared by both
    sides of the worker boundary. Output, images, status, and completion use
    ordinary worker messages.
*   `scripts/workerInput.ts` owns a line-input channel for each worker. `sw.ts`
    is the typed source for the generated `sw.js`; it brokers only the blocking
    read side required by synchronous student `input()`, `prompt()`, and
    `readline()` calls.
*   `FEATURE_PARITY.md` records behavior from the predecessor client that will
    be restored after the TypeScript and worker-protocol work is complete.

Student JavaScript and ordinary Python run only in workers. System-owned files
are visible but read-only in the editor. The JavaScript runner supports
workspace CommonJS modules, including relative paths and circular imports. The
Python runner uses Pyodide, loads packages from nested `requirements.txt`
files, runs `bin/setup.py`, supports persistent `bin/data.db` SQL sessions, and
renders Matplotlib images in the output area. Selected Python files containing
`import turtle` use the lazily loaded Skulpt compatibility runtime because
Turtle requires page-owned canvas rendering. Server-side grading still runs in
a daycare container and is authoritative.

Building
--------

The protobuf sources live at `../../protocol/codegrinder.proto`. Build the API
bundle whenever the protocol or a TypeScript entry point changes:

    npm ci
    npm run build
    npm test

`npm run build` generates temporary TypeScript sources under `generated/`, type
checks the handwritten TypeScript, and bundles the TypeScript entry points with
webpack. The tracked JavaScript files corresponding to those entry points are
deployable build output. Page modules and worker modules are checked with
separate DOM and worker global environments. Existing JavaScript is accepted
without being checked. The generated TypeScript directory and `node_modules/`
are not deployed.

The human-facing version in `package.json` is combined with a hash of the web
runtime sources. This build identity is compiled into the application and
written into every deployable JavaScript artifact. It versions the
service-worker registration, lazy runtime modules, and execution workers, so
cache safety does not depend on remembering a manual version bump. A semantic
version bump still records a release, but it is not the cache invalidation
mechanism.

Testing
-------

The tests are intentionally split by boundary:

*   `npm test` runs deterministic tests for domain transformations, byte-file
    handling, concurrency state, worker-message validation, service-worker
    controller selection, and deployable bundle shape. These tests must remain
    useful at runtime boundaries; TypeScript alone cannot validate JSON,
    structured-clone messages, generated artifacts, or asynchronous ordering.
*   `npm run typecheck` checks the page and worker environments separately.
*   `npm run test:browser` launches the Alpine system Chromium against
    `https://codegrinder.russross.com/web/` by default. It first rejects a
    partial deployment whose application, runtime, worker, and service-worker
    build identities disagree. It exercises JavaScript modules and the full
    worker/service-worker input bridge, then exercises canonical `asttest`,
    nested requirements, setup, persistent SQL, Turtle drawing/input, and
    stopping a blocked Turtle program in the deployed Python runtime.

Set `CODEGRINDER_BROWSER_TEST_URL` to exercise another deployed `/web/` root.
Set `CODEGRINDER_CHROMIUM` when Chromium is not installed at
`/usr/bin/chromium` or `/usr/bin/chromium-browser`. A Basic-authenticated target
also requires both `CODEGRINDER_BROWSER_USERNAME` and
`CODEGRINDER_BROWSER_PASSWORD`. The browser test is separate from `npm test`
because it depends on a deployed HTTPS site, external CDN assets, and a real
browser. It is suitable for a post-deployment or scheduled check.

Browser execution contract
--------------------------

The local runtime is not a Node-compatible abstraction. It relies on a narrow
set of browser behaviors that deployment and browser tests must preserve:

*   The editor must run in a secure context. Service workers are unavailable on
    ordinary HTTP origins other than the browser's localhost exception, so the
    deployed test must use HTTPS.
*   `sw.js` must be served from the `/web/` root. Its default service-worker
    scope must cover `/web/worker-input/`, the only request path it intercepts.
    Moving it under `scripts/` would narrow its scope and break terminal input.
*   Student code runs in dedicated classic workers. The Python worker calls
    `importScripts()` to bootstrap Pyodide, so worker bundles must not contain
    `import`, `export`, or `import.meta` syntax. Runtime modules loaded by the
    page remain normal ES modules.
*   Blocking `prompt()`, `readline()`, and Python `input()` use synchronous
    `XMLHttpRequest` inside the execution worker. Synchronous requests are not
    permitted on the page. The service worker holds the corresponding POST
    until the page writes a line; stopping a runtime closes the channel and
    terminates the worker.
*   `postMessage()` crosses a structured-clone boundary. Workspaces therefore
    cross as plain `Record<string, Uint8Array>` values, and both sides validate
    unknown messages at runtime. TypeScript interfaces and class prototypes do
    not survive or validate that boundary.
*   The page waits for the controller whose script URL contains the exact
    content-derived build identity. An older controller taking control is not
    sufficient. Workers and lazy runtime modules carry that same identity in
    their URLs.
*   Production uses `Cross-Origin-Opener-Policy: same-origin` and
    `Cross-Origin-Embedder-Policy: require-corp`; the smoke test requires
    `crossOriginIsolated`. Every cross-origin runtime dependency must therefore
    opt into CORS or cross-origin resource policy. Ace, markdown-it, Pyodide,
    packages fetched by Pyodide, and the pinned Skulpt compatibility assets are
    part of the browser test environment, not vendored application files.
*   The editor may be embedded, but its runtime still belongs to its own HTTPS
    origin and service-worker scope. Parent-page DOM, cookies, and storage are
    not worker interfaces. Authentication uses explicit gRPC metadata; local
    storage is only persistence for the session key and may be unavailable in
    a restricted embedding context.

Hosting
-------

CodeGrinder serves this directory and its gRPC-Web endpoint from the same
origin. Daycare calls may use another registered host; CORS is therefore
required at the daycare boundary. Deploy all generated JavaScript artifacts as
one generation. The build-identity preflight in `npm run test:browser` detects
a partial copy before it exercises the page.

The local runtimes require the service worker so a worker can wait synchronously
for terminal input without blocking the page. The service worker intercepts
only same-scope `worker-input/` requests. All ordinary application and API
requests use the browser's normal HTTP behavior; offline operation is not
supported.

Ace and markdown-it are loaded from jsDelivr by `index.html`. A deployment must
allow those resources in its content-security policy and must have network
access to load them.
