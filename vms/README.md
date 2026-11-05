VM image preparation
====================

Run `make -C vms` from the repository root to prepare and publish both images. Application builds invoke this automatically. Build requirements and deployment rules are documented in [client/BUILD.md](../client/BUILD.md).

`guest/` supplies common boot, account, timezone, and workspace setup. `c/` and `riscv/` supply image-specific overlays. The three `.version` files pin the shared Alpine minirootfs, Riscbox runtime and preparation payloads, and Risclet executable. The Alpine archive digest is recorded in `build.mk`.

Sources are synchronized into `build/vms/`; preparation executes there. Original downloads and the extracted Riscbox release are cached under `build/downloads/`. Image staging, preparation logs, ext4 images, split manifests, and output inventories stay under `build/vms/build/`. Published configurations, drive directories, and runtime directories live only under `dist/vms/`.

`mostlyclean` removes VM intermediates and deployed VM assets outside the current client publication inventory. `clean` removes every deployed VM asset. Downloads remain reusable, and deleting all of `build/` is safe.
