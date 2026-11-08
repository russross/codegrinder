VM client build and checks
==========================

1. Build and publish with `make -C client` (or root `make vm`).
2. Check types with `make -C client check`.
3. Run persistence, publication, and real-WASM checks with `make -C client test`.
4. Run browser widgets with `make -C client test-widgets`.
5. Run full RPC and guest checks with `make -C client test-browser`.

Use Bun and system protoc on Debian or Alpine. Browser checks discover Chrome/Chromium on PATH (or use `CODEGRINDER_CHROMIUM`) and use disposable profiles, headed when DISPLAY is available. Full-page checks use puppeteer-core with that installed browser. Pixel checks need WebGL; headless Alpine can use Mesa's mesa-vulkan-swrast package.

Source lives in `client/` and `vms/`. Builds stage source under root `build/`, where Bun-installed dependencies, generated protobuf bindings, bundles, guest preparation files, and image intermediates also live. Generated protocol files are never tracked. `build/downloads/` caches the pinned Alpine archive, Riscbox archive and unpacked release, and standalone Risclet executable. It is safe to delete all of `build/`; subsequent builds recover downloads and outputs as needed.

`make -C vms` prepares and publishes VM assets independently. QEMU for RISC-V, fakeroot, cpio, e2fsprogs, Brotli, and uv are required. Version-only files in `vms/` select upstream releases. UI edits do not rebuild unchanged guest images.

Deploy `dist/client/` and `dist/vms/` together. These directories contain deployment assets only. Serve the app at `/client/` and VM assets at `/vms/`. Caddy leaves stable files to the browser's default caching behavior and caches content-hashed assets immutably for one week. Preserve older immutable files during ordinary publication.

`make -C client mostlyclean` removes staged client and VM intermediates and prunes deployed files outside the current publication inventory. It preserves the current page and its active assets. Downloads remain cached. `clean` also removes deployment trees. Use incremental builds during development.

SSHFS mounts require `-o no_contain_symlinks` for package, SDK, and VM release links. Fakeroot records image ownership without attempting real ownership changes in the mounted workspace.
