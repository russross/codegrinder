Exam migration to the shared browser client
==========================================

This historical handoff predates Exam's ownership of the core. Its vendoring
paths, boolean `setTarget` API, snapshot defaults, and reset policy are superseded
by `README.md` and `CHANGELOG.md`. Use those for the current mounted contract.

Purpose and handoff
-------------------

This guide is sufficient to migrate Codegrinder's exam client without the
Risclet client present. Copy the complete `client-core/` source directory and a
matching current Riscbox build to the development machine. This document lives
inside the subtree so that future updates carry the integration contract.

The intended result is two independent applications using the same editing
environment. Exam keeps authentication, quiz/problem progression, RPCs,
grading, submission policy, private clipboard rules, and its page controls.
The shared source owns terminal rendering, editor-to-9p synchronization, file
views, namespace snapshots, and VM lifecycle. Do not add exam/demo feature flags
or application imports to shared modules. Adapt exam outside this subtree.

The reference exam inspected for this migration has `index.ts`, `workspace.ts`,
`saving.ts`, `vm.ts`, `terminal.ts`, `terminal_input.ts`, `clipboard.ts`, two Wterm
loaders, and frontend package/webpack configuration. Function names below refer
to that deployment; trace their current equivalents before changing them.

Copy and build prerequisites
----------------------------

1. Copy `client-core/` including package/lock files, CSS, `build/` source patches,
   tests, and documentation. Exclude `node_modules/` and `build/test-*` output.
   Keep the directory outside exam-specific source. Add those generated paths
   to the receiving repository's ignore rules.
2. Copy `riscbox.js`, `riscbox.d.ts`, and `riscbox.wasm` from the same current build.
   Riscbox's generated adapter declarations combine runtime and storage types.
   Keep the existing guest-image deployment, or copy the rebuilt guest assets
   and configuration together if updating the image. The guest needs BusyBox
   acpid handlers for orderly shutdown and reboot input events.
3. Run `npm ci` in `client-core/`. Use its pinned Wterm 0.5.4 installation and
   CodeMirror installation for shared widgets and exam editor extensions.
   Remove duplicated terminal/editor dependencies and patches from exam once
   no application imports need them. Keep RPC/protobuf, Split, and other exam
   dependencies in exam's package.
4. Add an application-owned TypeScript config extending the shared config,
   overriding the two Riscbox aliases and including shared declarations.
5. Add the shared webpack rules and dependency-resolution path. Copy every
   emitted JS chunk and WASM asset into the deployed client, not just its entry
   bundle. Inspect the resulting asset requests in Chrome.

For example, if the receiving repository has `client-core/`, `exam/`, and
`vendor/riscbox/riscbox.d.ts`, an `exam/tsconfig.json` can use:

```json
{
  "extends": "../client-core/tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@riscbox/runtime": ["../vendor/riscbox/riscbox.d.ts"],
      "@riscbox/storage": ["../vendor/riscbox/riscbox.d.ts"],
      "@codemirror/*": ["../client-core/node_modules/@codemirror/*"]
    }
  },
  "include": ["*.ts", "*.d.ts", "../client-core/*.ts", "../client-core/*.d.ts"]
}
```

Adjust the include list for generated RPC files and application subdirectories.
Do not edit the shared config to encode receiving-project paths. For checking
the subtree separately, use a second host-owned config with the same aliases
and only shared sources in its include list. Check with the shared installation
of `tsc`, for example `client-core/node_modules/.bin/tsc -p exam/tsconfig.json
--noEmit`.

The webpack integration is:

```js
import { clientCoreModules, clientCoreRules } from "../client-core/build/webpack.mjs";
// Merge into the application's existing webpack configuration:
// module.rules: [...clientCoreRules(), existing TS/CSS/etc. rules]
// resolve.modules: [clientCoreModules, applicationNodeModules, "node_modules"]
```

Compile shared TypeScript through the application's TS loader/config. Include
CSS loaders for shared CSS. Resolve application CodeMirror imports to the same
installation used by `EditorSession`; two CodeMirror state installations can
produce incompatible extensions even when their versions look identical.
The shared aliases are type-only and need no runtime webpack alias.

Upgrade the filesystem boundary first
------------------------------------

Remove exam's handwritten legacy runtime declaration after importing current
types from `@riscbox/runtime` and `@riscbox/storage`. Do not maintain a second,
partial declaration of the current adapter API.

The old `Filesystem.create(runtime)`, loaders, seed installation, binding, and
independent filesystem lifetime are gone. Preparing the VM constructs named
shares from configuration. `VmSession.filesystem` is the current VM-owned share;
`VmSession.runtime` exposes the current runtime for necessary host integration.
Do not cache a facade on a long-lived problem record. A different-image switch
destroys those handles and replaces them.

Host file reads/writes, listings, attributes, links, and subscriptions are
synchronous. Remove promise-based guest-read queues and their ordering fences
when replacing them with direct reads. Keep network/submission queues and
acknowledgement revisions: those remain asynchronous. Whole-tree `clear()`
requires poweroff; individual editor file writes are allowed while running.

Use the supplied snapshot functions for complete namespaces. They preserve
binary data, empty directories, symlink targets including broken links, hard
links, modes, ownership, and access/modification times with nanoseconds.
Restoration creates new inode numbers/ctime; do not treat those as persistent
problem identifiers. Do not replace snapshots with a plain map of visible text
files. Keep original file bytes separately for Reset.

Model application state explicitly
----------------------------------

Keep one stable application problem record per problem/workspace identity. It
may extend the shared `VmTarget` interface:

```ts
import type { VmImage, VmTarget } from "../client-core/vm-session";
interface ProblemTarget extends VmTarget {
    readonly problemId: bigint;
    readonly image: VmImage;
    // Existing application workspace, submission, grading, and step state.
}
```

`VmTarget` requires `image`, an optional mutable `snapshot`, and
`loadFiles(): Promise<ReadonlyMap<string, Uint8Array>>`. `loadFiles()` returns
complete original bytes for initialization/Reset, not a stream or lazy file
loader. The application supplies network loading and caching. Failure must
reject; it must not return a partially populated map. Copies/cache originals
must not alias mutable guest bytes.

Keep these distinct:

*   Original files define Reset and initialization.
*   The active 9p namespace is the guest/editor working tree.
*   Per-problem snapshots preserve the entire local working tree across switches.
*   Official student-file maps/revisions define what the server receives.
*   Server acknowledgements describe only successfully submitted revisions.

Do not submit every snapshot entry. Exam currently submits official
student-owned paths and preserves their canonical entries when a guest removes
or renames them away. Preserve that application policy unless explicitly
changing it. Snapshot persistence of extra guest files is separate from their
eligibility for submission. Use `canEdit(path)` to enforce the student/system
distinction, including after renames; filesystem permission bits alone are not
the application editor policy.

Step advancement and server actions need explicit snapshot invalidation. A new
step that replaces the workspace must not restore an old step's snapshot.
Invalidate it when replacing authoritative problem state, or store targets
under a key containing problem/step identity. A refresh that updates system
files while retaining student work must merge those changes into the active
namespace or inactive snapshot before it is next restored. Preserve the
existing refresh-versus-replacement distinction; do not silently restore stale
system files from a previous snapshot.

Replace the editor implementation
---------------------------------

Create `EditorSession` with the editor host and all required callbacks:

*   `canEdit(path)` checks the active problem's student-owned paths.
*   `onChange()` updates Save enabled/dirty state and other application UI.
*   `onSynced(trigger)` schedules application persistence on appropriate triggers.
*   `onError(error)` reports failure without clearing the dirty buffer.
*   `confirmDiscard(path)` presents the existing conflict decision.

Use `session.view` for exam's clipboard integration and any application editor
extensions. Use `session.path`, `dirty`, and `readOnly` instead of maintaining
parallel editor globals. `open(filesystem, path)` requires a clean buffer;
flush before file selection. `clear()` is destructive and deliberately discards
the buffer. Use `setReadOnly(true)` during a serialized transition, restoring
the previous access state if selection fails or is superseded.

The shared editor installs language support, four-space soft tabs, and the
existing newline convention: remove one final LF for display; append one LF
when saving nonempty editor text; save an empty editor as empty bytes. NUL
content is shown read-only. Do not duplicate these conversions in exam.

Forward relevant 9p notifications to `session.handleChange(change)`. It filters
its own host origin (1n), follows file/directory renames, handles aliases, keeps
dirty text through metadata/rename events, and asks before discarding content
conflicts. A rejected conflict prompts once until resolution. Reserve distinct
numeric origins for other application writes. Server-returned file writes must
not masquerade as editor writes or their visible conflicts would be hidden.

Editor flush and server save are different operations
----------------------------------------------------

`await session.flush(trigger)` acknowledges only editor-to-9p success. The
shared timer debounces thirty seconds after the latest edit, and blur is the
primary trigger. Failed writes retain text and retry; do not clear editorDirty
before writing as the reference `flushEditor()` did.

Keep exam's serialized server save queue and submitted-revision acknowledgement.
Save is enabled when `session.dirty` OR the problem's student revision differs
from its acknowledged server revision. A clean editor does not mean a saved
problem. Server failures must preserve/rearm the application save timer.

The integration contract for each trigger is:

| Trigger            | Editor/9p requirement                  | Exam persistence                           |
|--------------------|----------------------------------------|--------------------------------------------|
| Blur               | Shared automatic flush                 | Enqueue server save immediately afterward  |
| Debounced timer    | Shared automatic flush                 | Enqueue server save immediately afterward  |
| Save button        | Await `flush("explicit")`              | Await serialized server save               |
| File selection     | Await `flush("selection")`             | Preserve current save-before-select policy |
| VM input/tab/boot  | Await `flush("interaction")`           | Keep server persistence independent        |
| Problem switch     | Await `flush("transition")`            | Save final outgoing snapshot before leave  |

`onSynced` is a synchronous notification, including no-op flushes. It must
return normally and must not recursively call `flush()`. Restrict its automatic
server-save scheduling to blur/timer (or other deliberately selected triggers).
Enqueue blur/timer saves immediately after the successful flush, rather than
starting another thirty-second delay. `onChange` updates editor UI; it should
not introduce a second editor-buffer autosave timer. The Save button owns its
explicit flush-and-save sequence. Avoid the loop
`onSynced -> requestSave -> flush -> onSynced`.

Continue tracking student-file changes from both guest and host notifications,
including the editor's own origin. Origin filtering suppresses editor reloads,
not submission bookkeeping. Compare copied bytes or use revision-aware updates
so an identical rewrite does not needlessly create another server revision.
Preserve guest-change debounce in the application; it is separate from the
editor-buffer timer. Accepting an editor conflict must not cancel a needed
server save merely because the editor buffer became clean.

An RPC acknowledgement may cover an older student revision than the current
one. Acknowledge only the revision whose bytes were submitted. New edits while
the request is outstanding remain dirty and retain their timer. Refreshes,
server-returned files, and response handlers must be scoped to their captured
problem/step generation and must not replace a newer editor buffer blindly.

Replace the VM controller
-------------------------

Create `VmSession<ProblemTarget>` with the VM terminal host. The options are:

*   `loadRuntime(image)`: load/deduplicate the adapter script from `runtimeUrl`
    and return its typed constructor. The core fetches `wasmUrl`, loads
    `configUrl`, prepares memory/share/disks, and installs runtime callbacks.
*   `flushEditor()`: return `session.flush("interaction")`.
*   `canInteract()`: false during selection, reset, or application actions that
    must exclude terminal input.
*   `beforeReplace()`: retire the editor/visible problem association before
    namespace replacement notifications can act on the old view.
*   `afterSnapshot(target, snapshot)`: await persistence of the outgoing problem
    from final copied state, without reentering the transition queue.

Also supply `onFilesystemChange`, `onStateChange`, and `onError`. Register
`vm.terminal` with exam's private clipboard integration. State changes drive
application buttons/status; the core does not look up DOM IDs or choose labels.
The core owns terminal resize observation and the input queue. Remove exam's
duplicated queues and lifecycle generation implementation once replaced.

Use absolute, immutable `VmImage` descriptors containing `configUrl`,
`runtimeUrl`, `wasmUrl`, `memoryMiB`, and `shareName`. Equality compares all five.
Different problem types can share an identical descriptor. A new image needs
different versioned URLs even if it occupies the same conceptual problem type.
Do not infer equality from problem ID or a type string alone.
Use HTTP-backed image disks. `VmSession` rejects array-backed drive configs:
write-through array disks have no immutable overlay baseline for Reset.
Both current clients already use HTTP-backed image media.

For the current RISC-V-only quiz, one prepared VM/share serves all problems.
`prepareImage(image)` permits preparation before a target exists, but is not
required: first `setTarget` prepares on demand. Problems with no supported VM
must keep an explicit application path; do not pass `undefined` to `setTarget`
or invent an image. If that path needs the shared editor, its application
workspace adapter must satisfy the synchronous filesystem contract.

Transition ordering and cancellation
------------------------------------

Serialize selections in the application. Increment a view-generation counter
as soon as the user selects another problem. Pass
`() => generation === currentGeneration` as `isCurrent` to `setTarget`.
Handle a false result without displaying the obsolete target. Catch rejected
queue operations so one failure does not poison every future selection.

The application sequence is: flush the outgoing editor; disable editing/input;
call `setTarget`; display the selected problem only if still current; finally
restore controls/access appropriately. Do not optimistically replace the
visible problem before a successful transition. The shared transition performs:

1. Obtain incoming originals if needed, while the outgoing VM is intact.
2. Same image: request shutdown and wait for `onVmHalted`. Different image:
   force halt immediately. A request promise resolving is not proof of halt.
3. Copy the outgoing namespace and await `afterSnapshot` before replacing it.
4. Different image: destroy the old VM and prepare a complete new VM. Same
   image: retain disk overlays and handles. Restore incoming snapshot/originals.
5. Boot and return whether the selection is still current.

During shutdown, suppress stale editor/view updates but continue outgoing
submission bookkeeping. The guest can write files while shutting down. Final
snapshot/server persistence must include those writes. `afterSnapshot` receives
the outgoing target explicitly; it must not read a newly selected global
problem. If it rejects, the outgoing VM remains halted with its workspace and
snapshot available; leave selection failed and expose recovery/retry controls.

Refactor the reference `requestSave()` accordingly. It currently waits for
`VmController.settle()`/workspace queues. An `afterSnapshot` callback must not
wait for the enclosing selection/VM transition to settle: that is a deadlock.
Give the submission coordinator a lower-level operation accepting captured
problem identity, revision, and copied student bytes. Normal Save can flush and
call it; the snapshot hook can call it directly. Preserve response refresh and
action semantics around that operation in exam-owned code.

Reboot and Reset
----------------

The reboot control first flushes the editor and calls `vm.reboot()`. A running
guest receives orderly reboot input; a halted guest boots retained state.
Do not use `runtime.reset()` for ordinary reboot. A running guest's input
delivery can finish before acpid has processed it; controls stay in stopping
state until the runtime's reset/start callback. Never use a fixed delay as a
substitute for lifecycle completion.

Add a distinct VM Reset control alongside exam's existing file/problem Reset.
VM Reset intentionally discards the current target's snapshot and restores its
original files. Decide the server persistence treatment using the existing
exam reset policy: restoring local originals must update student revisions and
be saved or run through the authorized reset action. The shared core does not
send that RPC. File Reset and VM Reset remain separate operations.

Keep VM Reset enabled while orderly shutdown/reboot is stopping. Before queuing
the reset transition, increment the selection generation and call
`vm.forceHalt()` outside the queue to release a stalled shutdown. Await that
halt before the queued `setTarget(target, true, isCurrent)` mutation. Do not put
the emergency halt behind the operation it is supposed to unblock. Disable
Reset while a boot is loading. Do not flush dirty editor text for a destructive
Reset. The core retires queued input and input awaiting editor flush, and guards
late shutdown/reboot failures from an obsolete request.

Views, clipboard, and grading
-----------------------------

Replace local tree construction with shared `renderFileTree(host, paths,
options)`. Supply selectedPath, onSelect, and a priority function (student paths
0, system paths 1) to preserve exam's editable-first grouping. Priority reaches
parent directories. The core provides native buttons; keep styles scoped and
avoid application-global button rules that accidentally restyle them.

Use shared `renderInstructions(filesystem, dependencies, documentPath)`.
Dependencies includes referenced workspace images, not only the Markdown file.
Re-render when `changeAffectsPath` affects any dependency. Keep view/request
generations around asynchronous application rendering, and preserve dependency
tracking even on a failed image read so a later write can recover the view.
External images/links retain existing CommonMark behavior; this renderer is not
an HTML sanitization boundary. Preserve the application's trusted-content rule.

Keep exam's tabs and grading actions application-owned. A grading terminal can
use shared `TerminalView(host, callbacks, { readOnly: true, theme, label })`.
Supply exam's grading palette. Keep its streamed LF-to-CRLF normalization in a
small exam output adapter, tracking a preceding CR across chunks; VM output
must remain raw. `clear()` removes modes/history/selection and respects the
read-only cursor setting. Selection, clearSelection, hasSelection, paste,
acceptsInput, and the underlying host element are available for clipboard code.

Change clipboard imports to shared editor/terminal types. Preserve exam's
application-wide private clipboard, system-file redaction, capture handlers,
middle-click/drag restrictions, and grading selection behavior. The shared
terminal's `paste()` implements bracketed paste and strips ESC within bracketed
payloads; it does not implement exam's private clipboard policy. Do not let
native Wterm handlers bypass existing exam capture handlers.

Retain shared terminal CSS and both Wterm patches unchanged. Explicit row height,
partial-height filler, zero overscan near the live boundary, and live-screen
clipping all matter. Fractional physical scroll rounding can reveal a previous
line after clear/Ctrl-L; zero overscan alone does not remove selected history
rows. Do not restore exam's old viewport patch after adopting this version.

Validation and future updates
-----------------------------

Run shared `npm test`, the host type check, the application build, and exam's
real browser/guest/server tests. Shared tests use Google Chrome, temporary
profiles, normal browser timing, and fractional display scaling. They require
no Risclet client or VM image. For the real-WASM snapshot check, set
`RISCBOX_CLIENT_RUNTIME` to the copied adapter's absolute path and
`RISCBOX_CLIENT_WASM` to the copied WASM's absolute path before `npm test`.
That check reports a skip if the artifacts are absent. The adapter must be
loadable as CommonJS for this Node test; if the receiving repository defaults
to ES modules, put `{ "type": "commonjs" }` in the vendor runtime directory's
`package.json`. Browser script loading is unaffected. These tests do not
replace actual guest or RPC acceptance tests.

For editor/submission acceptance, cover:

*   Blur, Save, file selection, and thirty-second debounce after the latest edit;
    failed 9p writes keep dirty text and block selection/input.
*   Guest changes, aliases, renames, dirty conflict accept/reject, and accepting
    a conflict without another interaction still causing required server save.
*   Server failure/retry and edits during a save acknowledge only submitted
    revisions; server-returned files respect conflicts and problem generations.
*   Official student-file filtering and existing remove/rename-away policy;
    read-only system files and private clipboard behavior.
*   Step refresh/replacement, actions, completion, and snapshot invalidation.

For lifecycle acceptance, cover:

*   Same-image switches preserve two independent problem namespaces, including
    extra files/links/metadata, and retain disk overlays.
*   Final guest writes during shutdown reach both snapshot and server submission;
    failed final save leaves the outgoing workspace recoverable.
*   Different-image switches force halt/destroy/prepare, replace invalid handles,
    and keep previous snapshots usable when returning to their image.
*   Orderly Reboot retains state; VM Reset discards local state/restores originals;
    Reset can recover a stuck shutdown and stale input/request failures retire.
*   Rapid selections and failed downloads do not display an obsolete problem;
    clear/Ctrl-L at fractional scale, selection, resize, and grading output work.

For future source updates, keep all exam adaptations outside `client-core/`.
Use the authoritative tree's `sync.mjs --check DEST` then `sync.mjs DEST`.
The first copy may be an empty destination or an identical manually copied tree.
Track `.client-core-provenance.json` in the receiving repository. The tool
refuses local modifications and records exact file hashes, so migration changes
do not accidentally fork shared behavior. Read contract changes, install with
the copied lock file, rerun shared and application checks, and update the
matching Riscbox build when required. Shared fixes belong in the authoritative
tree before copying them to other consumers.
