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
Pyodide for immediate feedback. JavaScript tests use the canonical `make test`
daycare action. Other advertised actions are appended to the toolbar as direct
buttons; there is no general Action menu.

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
*   `scripts/protocol.ts` contains the typed file-decoding and daycare-response
    boundary used by the API client.
*   `scripts/embed.ts` builds standalone embed URLs and selects their local
    problem type.
*   `scripts/directoryTree.ts` defines and validates the canonical local
    text-workspace tree; `scripts/editorTabs.ts` implements the editor tabs.
    Their corresponding JavaScript files are deployable bundles.
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

Student files run only in a worker. System-owned files are visible but read-only
in the editor. The JavaScript runner supports workspace CommonJS modules,
including relative paths and circular imports. The Python runner uses Pyodide,
loads root `requirements.txt` packages when present, and renders Matplotlib
images in the output area. Server-side grading still runs in a daycare
container and is authoritative.

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

The version in `package.json` is compiled into the application. It versions the
service-worker registration, lazy runtime modules, and execution workers so a
deployment does not combine browser-cached files from different builds.

Hosting
-------

CodeGrinder serves this directory and its gRPC-Web endpoint from the same
origin. Daycare calls may use another registered host; CORS is therefore
required at the daycare boundary.

The local runtimes require the service worker so a worker can wait synchronously
for terminal input without blocking the page. The service worker intercepts
only same-scope `worker-input/` requests. All ordinary application and API
requests use the browser's normal HTTP behavior; offline operation is not
supported.

Ace and markdown-it are loaded from jsDelivr by `index.html`. A deployment must
allow those resources in its content-security policy and must have network
access to load them.
