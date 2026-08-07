JavaScript web interface
========================

This directory contains the CodeGrinder browser interface for JavaScript
problems. It is served as static content by the CodeGrinder server and uses the
current gRPC-Web API.

Runtime data flow
-----------------

The launch URL has the form:

    /js/?assignment=USER_ID:COURSE_ID:PROBLEM_SET_ID&token=LOGIN_TOKEN

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

The frontend treats signed runtime-bundle bytes as opaque. It decodes a copy to
find the daycare hostname and inspect the final report, but forwards the
original bytes unchanged.

Source layout
-------------

*   `scripts/app.js` owns browser state and connects the editor UI to the API
    client.
*   `scripts/codeGrinder.js` is the source API client.
*   `scripts/codeGrinderApi.js` is the generated browser bundle imported by the
    application.
*   `scripts/directoryTree.js` and `scripts/editorTabs.js` implement the local
    text workspace and editor tabs.
*   `scripts/jsHandler.js` and `scripts/jsWorker.js` run JavaScript in a worker.
*   `scripts/atomicQueue.js` carries terminal input and output between the page
    and the worker.
*   `sw.js` supplies the SharedArrayBuffer iframe fallback. It intercepts only
    the fallback's `ponyfill/` requests and does not cache application assets.

Student files run only in the worker. System-owned files are visible but
read-only in the editor. The local runner supports workspace CommonJS modules,
including relative paths and circular imports. Server-side grading still runs
in a daycare container and is authoritative.

Building
--------

The protobuf sources live at `../../protocol/codegrinder.proto`. Build the API
bundle whenever the protocol or `scripts/codeGrinder.js` changes:

    npm ci
    npm run build
    npm test

`npm run build` generates temporary TypeScript sources under `generated/` and
bundles them with the API client into `scripts/codeGrinderApi.js`. The generated
TypeScript directory and `node_modules/` are not deployed.

Hosting
-------

CodeGrinder serves this directory and its gRPC-Web endpoint from the same
origin. Daycare calls may use another registered host; CORS is therefore
required at the daycare boundary.

The server sends cross-origin isolation headers for the application document so
a top-level tab can use SharedArrayBuffer directly. In an LMS iframe the page
falls back to the service-worker implementation in
`iframeSharedArrayBufferWorkaround.js`. All ordinary application and API
requests use the browser's normal HTTP behavior; offline operation is not
supported.

Ace and markdown-it are loaded from jsDelivr by `index.html`. A deployment must
allow those resources in its content-security policy and must have network
access to load them.
