Shared browser client source
============================

This directory is an application-independent editing environment, compiled into
its consumers. Exam owns the authoritative source in `www/exam/client-core`.
The Risclet demo consumes this directory through an sshfs mount.
It is not a standalone application or a separately published runtime package.

Modules and ownership
---------------------

*   `editor-session.ts` owns CodeMirror, buffered revisions, access control,
    thirty-second debounce, blur synchronization, and filesystem conflicts.
    `editor-text.ts` supplies language, soft-tab, and newline conventions.
*   `workspace.ts` copies and restores complete namespaces, including links and
    metadata, and identifies paths affected by filesystem notifications.
*   `vm-session.ts` owns a prepared VM, its live filesystem handles, terminal,
    lifecycle transitions, and retired input. Application targets own snapshots.
*   `terminal.ts`, `terminal.css`, and `terminal_input.ts` own Wterm rendering,
    selection/paste, and FIFO backpressure. `build/` contains guarded patches.
*   `workspace-view.ts` and its CSS render an accessible file tree.
    `instructions.ts` renders Markdown and resolves workspace image bytes.

Applications own navigation, data loading, server persistence, grading,
clipboard policy, controls, outer layout, and deployment. There are no exam/demo
feature flags. The core has no RPC, authentication, or example-manifest imports.

Dependencies and build
----------------------

Run `npm ci` in this directory. Its package and lock file own the shared
CodeMirror, CommonMark, Wterm, and build-tool versions. Wterm is pinned at 0.5.4;
its two source patches deliberately reject incompatible upstream changes.
Consumers should not install a second CodeMirror/Wterm dependency graph for
shared widgets. Import editor types from the same installation when extending
their configuration.

All Riscbox imports are type-only aliases: `@riscbox/runtime` and
`@riscbox/storage`. Map both to the latest deployed `riscbox.d.ts` in the host
TypeScript configuration. The repository default is `../build/js/riscbox.d.ts`.
An external consumer overrides paths in a configuration outside this subtree.
The JavaScript constructor is supplied by `VmSessionOptions.loadRuntime`.

Webpack consumers import `clientCoreRules()` and `clientCoreModules` from
`build/webpack.mjs`, apply the rules, and put the shared dependency directory in
`resolve.modules`. They also supply TypeScript and CSS loaders. Include
`commonmark.d.ts` in the host TypeScript program. Deploy every generated JS
chunk and WASM asset alongside the main bundle, preserving webpack public-path
behavior. Copying only `bundle.js` is insufficient.

Runtime contract
----------------

Use one matching build of `riscbox.js`, `riscbox.d.ts`, and `riscbox.wasm` with:

*   `prepareResolved`, `boot`, `halt`, `destroy`, `coldReset`, `requestShutdown`,
    `requestReboot`, console callbacks, and `started` lifecycle state.
*   Synchronous VM-owned `filesystem(name)` and `block(index)` facades.
*   Filesystem subscriptions with source, numeric origin, aliases, and old path;
    file/directory/link operations; and `setAttributes` with nanosecond times.
*   Powered-off `clear()` and disk `discardChanges()`.

The old standalone filesystem/source/seed/bind APIs are unsupported. The exam
migration guide describes the required upgrade and integration ordering.
Client VM images use HTTP-backed disks, as both current clients do. Array disks
write through and cannot discard changes; preparation rejects them rather than
allowing Reset to fail after retirement. This is a client-layer constraint,
not a restriction on the Riscbox runtime's array-storage API.

Synchronization and lifecycle
-----------------------------

`EditorSession.flush(trigger)` serializes writes and acknowledges only the
submitted revision after success. Its returned promise covers editor-to-9p
synchronization. `onSynced` is a synchronous notification, including no-op
flushes; it must not throw or start a recursive flush. Server-save completion
belongs to a separate application coordinator. Failed writes retain dirty text
and schedule retry. `clear()` intentionally discards the buffer; call it only
after a successful flush or an explicit reset/discard decision.

Callers serialize `VmSession.setTarget(target, transition, isCurrent)` and disable
editor access and interactive input during transitions. `VmTransition` explicitly
selects `workspace` (`"files"` or `"snapshot"`), `poweroff` (`"force"` or
`"orderly"`), `discardDiskChanges`, and `boot`. Different images always force halt
and replace the runtime. Same images reuse it. No filesystem facade survives
destruction.

After halting, `afterHalt(target)` can capture and persist outgoing official
files. Snapshot mode then copies the complete namespace and awaits
`afterSnapshot(target, snapshot)`. File mode clears the target's snapshot and
rebuilds from `loadFiles()`. Files are loaded after outgoing hooks finish and
before namespace replacement. Failed hooks leave the outgoing share available.

`reset()` uses file mode, force halt, disk discard, and boot. The host chooses
what `loadFiles()` returns: current official work or original demo files. Reset
never flushes an editor or makes server calls itself; outgoing hooks still run,
so hosts must suppress persistence and destructive editor clearing during reset
when their policy requires it. `forceHalt()` can be called outside the selection
queue to release a stalled shutdown; namespace replacement remains serialized.
Ordinary reboot retains namespace and disk state. Its state remains `"stopping"`
until `onVmReset` reports restart; terminal input is blocked during that wait.

Image identity includes absolute configuration, adapter and WASM URLs, memory,
and share name. Keep immutable image descriptors; use versioned URLs when
replacing image contents. Application target identity determines which snapshot
is restored. Do not rebuild target objects on every selection.

Tests
-----

`npm test` runs portable FIFO, subtree-sync, editor/lifecycle, and fractional
pixel rendering tests. The real-WASM snapshot check uses the repository build
or `RISCBOX_CLIENT_RUNTIME` and `RISCBOX_CLIENT_WASM` paths; it reports a skip
when neither matching artifact pair is available. It requires Node with experimental WebSocket support
and `google-chrome`; headed Chrome is used when DISPLAY exists, otherwise
headless Chrome. Profiles and successful test output are temporary. Browser
fixture compilation transpiles TS; run the host type check separately.

`npm run check` needs the default adapter declarations or a host configuration
that overrides both runtime aliases. Consumers must retain their own server and
guest integration tests. The core's portable tests need no surrounding
application source; optional real-WASM tests accept explicit runtime paths.

Shared mount and updates
------------------------

Mount this directory at the consumer's chosen `client-core` path and compile
its TypeScript directly. No distributed library bundle or access to files above
the mount is required. Supply the runtime trio and host alias configuration
locally. The dependency installation is inside the mount; `clientCoreModules`
resolves that installation. Configure host loaders and type paths accordingly.

Exam maintains `package-lock.json` and its dependency installation. Coordinate
dependency updates and `npm ci` with mounted consumers so builds do not race
an installation. A read-only mount is sufficient for application builds;
shared tests write temporary fixtures under `build/` and need a writable copy.

Modify shared code here and record consumer-facing changes in `CHANGELOG.md`.
Consumers review it, adapt their host integrations, then run type checks,
shared tests, application builds, and guest integration tests. `sync.mjs` remains
an optional guarded export tool for disconnected consumers; it is not part of
the mounted workflow. `EXAM-MIGRATION.md` is the historical handoff guide.
