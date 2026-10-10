Exam build and checks
=====================

1. Build from the repository root with `make exam`.
2. Check types with `npm --prefix www/exam run typecheck`.
3. Run persistence and real-WASM tests with `npm --prefix www/exam test`.
4. Run editor, instructions, highlighter, and terminal browser tests with
   `npm --prefix www/exam run test:widgets`.
5. Run the complete exam and real guest checks with
   `npm --prefix www/exam run test:browser`.

Use Alpine system Node 24 and npm. The Makefile installs the locked dependencies,
prepares the VM assets, generates protobuf bindings, checks types, and bundles
all client libraries locally. No CDN is required. Browser tests use Chromium
and ChromeDriver with disposable profiles, headed when DISPLAY is available.
The terminal pixel tests also need working WebGL; DOM fallback has its own test.
Headless pixel checks on Alpine can use Mesa's `mesa-vulkan-swrast` package.
Pixel checks live in the widget suite; the full-page suite checks RPC and guest
behavior without duplicating those renderer fixtures.

The app owns its editor, terminal, workspace, and VM modules directly.
`problem-workspace.ts` maintains official files and submission revisions;
`workspace.ts` handles filesystem population and snapshots. Compare these
modules with the Risclet demo manually when considering future updates.

Image preparation requires QEMU for RISC-V, fakeroot, cpio, and e2fsprogs.
The `vm/Makefile` caches downloads and rebuilds the ext4 image only when its
release versions, guest files, or image preparation inputs change. UI edits do
not rerun package installation or disk splitting. See `vm/README.md`.

`index.template.html` is the entry-page source; the build replaces `index.html`
after publishing its assets. Deploy that entry, the complete `dist/` directory,
`vm/runtime/`, and `vm/image/` together. Keep existing immutable assets when
copying a new deployment so cached pages and open tabs can load their original
bytes. HTML should revalidate; content-named files and release directories may
use long-lived immutable caching.

Reboot preserves terminal history and the guest disk overlay. Clicking Reset VM
during shutdown force-halts, replaces the terminal parser, discards the overlay,
and restores official workspace files without flushing editor text or sending
RPCs. CodeGrinder file Reset remains independent.
