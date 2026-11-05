VM client build and checks
==========================

1. Build and publish with `make -C client` (or root `make vm`).
2. Check types with `make -C client check`.
3. Run persistence, publication, and real-WASM checks with `make -C client test`.
4. Run browser widgets with `make -C client test-widgets`.
5. Run full RPC and guest checks with `make -C client test-browser`.

Use Alpine system Node 24 and npm. Browser checks use Chromium and disposable profiles, headed when DISPLAY is available. Full-page checks also use ChromeDriver. Pixel checks need WebGL; headless Alpine can use Mesa's mesa-vulkan-swrast package.

Source lives in `client/` and `vms/`. Builds stage source under root `build/`, where npm dependencies, generated protobuf bindings, bundles, guest preparation files, and image intermediates also live. Generated protocol files are never tracked. `build/downloads/` caches the pinned Alpine archive, Riscbox archive and unpacked release, and standalone Risclet executable. It is safe to delete all of `build/`; subsequent builds recover downloads and outputs as needed.

`make -C vms` prepares and publishes VM assets independently. QEMU for RISC-V, fakeroot, cpio, e2fsprogs, Brotli, and uv are required. Version-only files in `vms/` select upstream releases. UI edits do not rebuild unchanged guest images.

Deploy `dist/client/` and `dist/vms/` together. These directories contain deployment assets only. Serve the app at `/client/` and VM assets at `/vms/`. Revalidate HTML, stable direct page dependencies, and `c.cfg`/`riscv.cfg`; cache content-hashed runtime and drive directories immutably. Preserve older immutable files during ordinary publication.

`make -C client mostlyclean` removes staged client and VM intermediates and prunes deployed files outside the current publication inventory. It preserves the current page and its active assets. Downloads remain cached. `clean` also removes deployment trees. Use incremental builds during development.
