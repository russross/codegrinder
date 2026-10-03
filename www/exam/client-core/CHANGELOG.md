Client core changes
===================

2026-10-02 — assembly dialect highlighting
----------------------------------------

`risclet.ts` supplies the teaching assembly dialect as a CodeMirror 6 stream
language. `languageFor()` now selects it for `.s` and `.S` files instead of GAS.
Other filename mappings are unchanged. Mounted consumers inherit this language
selection without API changes. The highlighter recognizes implemented opcodes,
exact directives, registers, labels, expressions, and supported literals, and
marks unknown opcodes/directives and malformed tokens as invalid. It is a syntax
highlighter, not an assembler validator. This integration changes Exam's shared
source only; the separate `www/web` application is unaffected.

2026-10-02 — Reboot retry recovery in Exam
----------------------------------------

Exam no longer has a separate Reset VM button. Reboot VM stays enabled and reads
Reset VM while the runtime is stopping, with a fixed width across Boot VM,
Reboot VM, and Reset VM labels.
A second click before the runtime's
halt/restart event calls the shared `reset()` operation without flushing dirty
editor text. After the event, clicks revert to normal Boot/Reboot behavior.
This is an Exam host UI policy; the core's reset and reboot APIs remain available
to mounted consumers, with no required UI change in other clients.

2026-10-02 — authoritative source and explicit VM transitions
-----------------------------------------------------------

Exam now owns this source directory. Other clients compile it directly through
an sshfs mount. All shared dependencies, webpack helpers, tests, and integration
documentation live here. Supply your own matching Riscbox runtime artifacts and
TypeScript alias overrides; no surrounding Exam source is required. See
`README.md` for build and mount details.

Breaking lifecycle API
----------------------

`VmSession.setTarget(target, resetBoolean, isCurrent)` is replaced by
`setTarget(target, transition: VmTransition, isCurrent)`. There are no implicit
client policies. To retain the demo's previous snapshot-switch behavior:

```ts
const switchTransition: VmTransition = {
    workspace: "snapshot",
    poweroff: "orderly",
    discardDiskChanges: false,
    boot: true,
};
await vm.setTarget(target, switchTransition, isCurrent);
```

To prepare a clean workspace without booting:

```ts
const cleanTransition: VmTransition = {
    workspace: "files",
    poweroff: "force",
    discardDiskChanges: true,
    boot: false,
};
await vm.setTarget(target, cleanTransition, isCurrent);
```

Different images still force halt and replace the runtime. Image equality uses
configuration/runtime/WASM URLs, memory size, and share name. Same-image clean
transitions reuse the runtime, cold-reset it, discard all disk overlays, and
rebuild the 9p tree. `boot: false` ends in `"ready"`; call `boot()` or
`bootIfInactive()` when the user chooses to boot.

The optional `VmSessionOptions.afterHalt(target)` hook runs after halting and
before snapshotting or replacing files. Use it to capture and persist outgoing
official file bytes independently of complete namespace snapshots. Existing
`afterSnapshot` callbacks run only in snapshot mode. `loadFiles()` runs after
outgoing hooks and before replacement, so it sees their final workspace state.
Do not await a queue that already contains the current transition inside either
hook. A rejected hook leaves the outgoing namespace available for recovery.

`VmSession.reset(isCurrent?)` replaces the old boolean reset form. It reloads
`target.loadFiles()` with force halt, disk discard, file-tree replacement, and
boot. Choose `loadFiles()` contents in the host: originals retain the demo's
old reset policy; current official bytes retain the user's current work.
Reset does not call `flushEditor()`. Host hooks still run: suppress server saves,
editor clearing, and reset-generated filesystem conflict notifications if the
host must preserve dirty editor text. For emergency recovery, force halt outside
the host selection queue before enqueueing reset.

Exam's integration policy
-------------------------

These are host policies, not changes imposed on mounted consumers:

*   Initial selection and problem/step switches use the clean transition above.
    Instructions are the default tab; selecting VM or Boot VM triggers boot.
    Missing instructions select VM and thereby boot it.
*   Reset VM rebuilds canonical system files and current official student files,
    discards guest-only files/links and disk overlays, and boots. Dirty editor
    text and gRPC state are preserved; reset itself sends no RPC.
*   Save and actions do not change VM power state. Step advancement prepares a
    clean unbooted workspace; a failed or final-step grade preserves the VM.
*   System-file views and instructions read canonical system bytes. Guest writes
    remain temporary in 9p and do not change those views or submissions.

Reboot remains an orderly guest request preserving files and overlays. The
`"stopping"` state blocks terminal input until the runtime halt/restart notification.
Hosts choose their controls; Exam keeps editing and saves available and uses a
second Reboot click for reset recovery, as described above.
