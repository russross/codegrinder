Exam build and checks
=====================

1. Build from the repository root with `make exam`.
2. Check types with `make -C www/exam check`.
3. Run persistence and real-WASM tests with `make -C www/exam test`.
4. Run editor, instructions, highlighter, and terminal browser tests with
   `make -C www/exam test-widgets`.
5. Run the complete exam and real guest checks with
   `make -C www/exam test-browser`.

Use Alpine system Node 24 and npm. The Makefile installs the locked dependencies,
prepares the VM assets, generates protobuf bindings, checks types, and bundles
all client libraries locally. No CDN is required. Browser tests use Chromium
and ChromeDriver with disposable profiles, headed when DISPLAY is available.
The terminal pixel tests also need working WebGL; DOM fallback has its own test.
Headless pixel checks on Alpine can use Mesa's `mesa-vulkan-swrast` package.
Pixel checks live in the widget suite; the full-page suite checks RPC and guest
behavior without duplicating those renderer fixtures.

Select tests for the affected modules and boundaries. Do not rerun Rust tests
for UI-only changes. Use incremental builds without cleaning first; unreliable
incremental rules must be fixed. `make -C www/exam mostlyclean` removes build
caches, generated protobuf sources, and npm dependencies while preserving the
entry page, published bundles, and every deployed VM asset. `clean` also deletes
those deployment assets. Build scripts use POSIX shell or dependency-free
Python and do not need a virtual environment.

The app owns its editor, terminal, workspace, and VM modules directly.
`problem-workspace.ts` maintains official files and submission revisions;
`workspace.ts` handles filesystem population and snapshots. Compare these
modules with the risclet demo manually when considering future updates.

Image preparation requires QEMU for RISC-V, fakeroot, cpio, and e2fsprogs.
The `vm/Makefile` caches downloads and rebuilds the ext4 image only when its
release versions, guest files, or image preparation inputs change. UI edits do
not rerun package installation or disk splitting. See `vm/README.md`.

`index.template.html` is the entry-page source; the build replaces `index.html`
only when its contents change, after publishing its assets. Deploy that entry, the complete `dist/` directory,
`vm/runtime/`, and `vm/image/` together. Keep existing immutable assets when
copying a new deployment so cached pages and open tabs can load their original
bytes. Direct page dependencies use stable `dist/app.js`, `dist/style.css`,
and `dist/favicon.svg` URLs. HTML and these files should revalidate; content-named files and release directories may
use long-lived immutable caching.

Reboot clears terminal history and preserves the guest disk overlay. Same-type problem and step changes replace the live 9p tree without resetting the VM. Clicking Reset VM
during shutdown force-halts, replaces the terminal parser, discards the overlay,
and restores official workspace files without flushing editor text or sending
RPCs. CodeGrinder file Reset remains independent.
