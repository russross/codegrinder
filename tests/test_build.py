#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Fake external tools record sequencing while the real Makefiles own dependencies.
TOOL = '''#!/usr/bin/env python3
import json
import os
import sys
import shutil
from pathlib import Path
name = Path(sys.argv[0]).name
arguments = sys.argv[1:]
with open(os.environ["BUILD_LOG"], "a") as log:
    log.write(json.dumps([name, *arguments]) + "\\n")
if name == "npm" and arguments == ["ci"]:
    shutil.rmtree("node_modules", ignore_errors=True)
    Path("node_modules/.bin").mkdir(parents=True, exist_ok=True)
    Path("node_modules/.bin/webpack").symlink_to(sys.argv[0])
elif name == "webpack":
    if Path("index.template.html").exists():
        Path("build/ui").mkdir(parents=True, exist_ok=True)
        Path("build/ui/app.js").write_text("bundle")
    else:
        Path("scripts/app.js").write_text("bundle")
        Path("sw.js").write_text("worker")
elif name == "clang":
    Path(arguments[arguments.index("-o") + 1]).write_text(arguments[-1])
elif name == "cargo" and arguments[0] == "build":
    binary = Path("../target/release") / arguments[arguments.index("-p") + 1]
    binary.parent.mkdir(parents=True, exist_ok=True)
    source = Path("input.txt")
    binary.write_text(source.read_text() if source.exists() else "executable")
    binary.chmod(0o755)
'''


class BuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="codegrinder-build-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.log = self.root / "commands.jsonl"
        self.environment = dict(os.environ)
        self.environment["BUILD_LOG"] = str(self.log)
        self.environment["PATH"] = f"{self.root / 'tools'}:{os.environ['PATH']}"

        # Only build definitions and tiny fixtures enter the disposable checkout.
        for name in (
            "Makefile", "scripts", "server/Makefile", "grind/Makefile", "stepper/Makefile",
            "legacyweb", "grind/index.html", "grind/update-grind", "client", "vms", "tests/Makefile",
            "macos-minimal-sdk/Makefile", "macos-minimal-sdk/versions.inc",
        ):
            source = ROOT / name
            destination = self.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination)
            else:
                shutil.copyfile(source, destination)
        self.write("protocol/codegrinder.proto", "protocol")
        for name in ("npm", "cargo", "clang", "rustfmt"):
            self.write(f"tools/{name}", TOOL, executable=True)

    def write(self, name: str, content: str, *, executable: bool = False) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        if executable:
            path.chmod(0o755)
        return path

    def make(self, directory: str, *arguments: str) -> str:
        result = subprocess.run(
            ["make", "--no-print-directory", "-C", str(self.root / directory), *arguments],
            env=self.environment, text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def commands(self) -> list[list[str]]:
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def browser_fixture(self, directory: str) -> None:
        for name in ("package.json", "package-lock.json", "tsconfig.json", "webpack.config.mjs"):
            self.write(f"{directory}/{name}", "{}")
        prefix = "generated/" if directory.endswith("web") else ""
        paths = [f"{prefix}{name}" for name in (
            "codegrinder.ts", "codegrinder.client.ts",
            "google/protobuf/duration.ts", "google/protobuf/timestamp.ts",
        )]
        script = "#!/bin/sh\nset -eu\n"
        script += "mkdir -p " + " ".join(sorted({str(Path(path).parent) for path in paths})) + "\n"
        script += "for path in " + " ".join(paths) + "; do printf 'generated' > \"$path\"; done\n"
        self.write(f"{directory}/proto-gen.sh", script, executable=True)
        self.write(f"{directory}/style.css", "style")

    def test_web_tracks_changes_deletions_and_missing_outputs(self) -> None:
        self.browser_fixture("legacyweb")
        self.write("legacyweb/scripts/app.ts", "first")
        self.make("legacyweb", "-j4")
        initial = self.commands()
        self.make("legacyweb", "-j4")
        self.assertEqual(self.commands(), initial)

        # Source edits and removals rebuild bundles without reinstalling packages.
        self.write("legacyweb/scripts/extra.ts", "extra")
        self.make("legacyweb")
        self.assertEqual(len(self.commands()), len(initial) + 2)
        (self.root / "legacyweb/scripts/extra.ts").unlink()
        self.make("legacyweb")
        self.assertEqual(len(self.commands()), len(initial) + 4)
        self.write("legacyweb/scripts/app.ts", "second")
        self.make("legacyweb")
        self.assertEqual(len(self.commands()), len(initial) + 6)
        (self.root / "dist/web/scripts/app.js").unlink()
        self.make("legacyweb")
        self.assertTrue((self.root / "dist/web/scripts/app.js").exists())

        # Missing generated imports are regenerated as a single grouped output.
        generated = self.root / "build/legacyweb/generated/google/protobuf/duration.ts"
        generated.unlink()
        self.make("legacyweb", "-j4")
        self.assertTrue(generated.exists())
        installed = sum(command == ["npm", "ci"] for command in self.commands())
        self.assertEqual(installed, 1)
        self.write("legacyweb/package-lock.json", '{"changed": true}')
        self.make("legacyweb")
        self.assertEqual(sum(command == ["npm", "ci"] for command in self.commands()), 2)

    def test_server_publication_is_atomic_and_preserved_by_mostlyclean(self) -> None:
        self.write("server/input.txt", "first executable")
        self.make("server")
        binary = self.root / "dist/server/codegrinder"
        self.assertTrue(os.access(binary, os.X_OK))
        timestamp = binary.stat().st_mtime_ns
        self.make("server")
        self.assertEqual(binary.stat().st_mtime_ns, timestamp)

        # A service holding the old inode can finish while the next start sees new bytes.
        with binary.open() as running:
            self.write("server/input.txt", "replacement executable")
            self.make("server")
            self.assertEqual(running.read(), "first executable")
            self.assertEqual(binary.read_text(), "replacement executable")
        self.make("server", "mostlyclean")
        self.assertTrue(binary.exists())
        self.make("server", "clean")
        self.assertFalse(binary.exists())

    def test_grind_static_assets_publish_to_the_download_directory(self) -> None:
        self.make("grind", "static-dist")
        for name in ("index.html", "update-grind"):
            deployed = self.root / "dist/grind" / name
            self.assertEqual(deployed.read_bytes(), (self.root / "grind" / name).read_bytes())
        self.make("grind", "mostlyclean")
        self.assertTrue((self.root / "dist/grind/update-grind").exists())
        self.make("grind", "clean-dist")
        self.assertFalse((self.root / "dist/grind/update-grind").exists())

    def test_upstream_sdk_make_targets(self) -> None:
        self.write("macos-minimal-sdk/src/usr/include/stdio.h", "header")
        self.write("macos-minimal-sdk/src/x86_64/libSystem.s", "x86 stubs")
        self.write("macos-minimal-sdk/src/arm64/libSystem.s", "arm stubs")
        self.make("macos-minimal-sdk", "-j4")
        for architecture in ("x86_64", "arm64"):
            sysroot = self.root / f"macos-minimal-sdk/sysroot-macos-{architecture}"
            self.assertEqual((sysroot / "usr/include/stdio.h").read_text(), "header")
            self.assertTrue((sysroot / "usr/lib/libSystem.B.dylib").exists())
            self.assertTrue((sysroot / "usr/lib/libSystem.dylib").is_symlink())

    def vm_fixture(self) -> None:
        self.browser_fixture("client")
        self.write("client/index.ts", "source")
        self.write("client/index.template.html", "{{app}} {{style}} {{favicon}}")
        self.write("client/favicon.svg", "icon")
        self.write("stepper/Makefile", "riscv64:\n\t@mkdir -p dist\n\t@test -f dist/stepper.linux_riscv64 || echo runner > dist/stepper.linux_riscv64\n")
        self.write("tools/uv", '#!/bin/sh\nshift 3\nexec python3 "$@"\n', executable=True)
        self.write("build/downloads/alpine-minirootfs-3.24.3-riscv64.tar.gz", "alpine")
        self.write("build/downloads/risclet-0.5.5", "risclet")
        for name in ("riscbox.js", "riscbox.wasm", "linux", "fw_dynamic.bin"):
            self.write(f"release/riscbox-deadbeef/{name}", name)
        self.write("release/riscbox.d.ts", "declarations")
        self.write("release/splitimg.py", '''import hashlib
import sys
from pathlib import Path
name = "drive-" + hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()[:8]
directory = Path(sys.argv[2]) / name
directory.mkdir(parents=True, exist_ok=True)
(directory / "blk.txt").write_text("disk")
print(name)
''')
        with tarfile.open(self.root / "build/downloads/riscbox-0.9.0.tar.gz", "w:gz") as archive:
            archive.add(self.root / "release", arcname="riscbox")
        self.write("vms/build-image.sh", '''#!/usr/bin/env python3
import sys
from pathlib import Path
name = sys.argv[1]
Path(f"build/{name}-rootfs.ext4").write_bytes(Path("guest/etc/inittab").read_bytes() + name.encode())
''', executable=True)

    def test_client_incremental_publication_and_source_deletions(self) -> None:
        self.vm_fixture()
        self.make("client", "-j4")
        page = self.root / "dist/client/index.html"
        first = page.stat().st_mtime_ns
        commands = self.commands()
        self.make("client")
        self.assertEqual(self.commands(), commands)
        self.assertEqual(page.stat().st_mtime_ns, first)
        self.write("client/style.css", "changed style")
        self.make("client")
        self.assertEqual((self.root / "dist/client/style.css").read_text(), "changed style")
        self.assertEqual(page.stat().st_mtime_ns, first)
        self.write("client/extra.ts", "extra")
        self.make("client")
        (self.root / "client/extra.ts").unlink()
        self.make("client")
        self.assertFalse((self.root / "build/client/extra.ts").exists())
        (self.root / "dist/client/app.js").unlink()
        self.make("client")
        self.assertTrue((self.root / "dist/client/app.js").exists())
        (self.root / "build/client/google/protobuf/duration.ts").unlink()
        self.make("client")
        self.assertTrue((self.root / "build/client/google/protobuf/duration.ts").exists())
        self.assertFalse((self.root / "client/codegrinder.ts").exists())
        self.assertFalse((self.root / "client/node_modules").exists())

    def test_vm_missing_outputs_and_download_cache(self) -> None:
        self.vm_fixture()
        self.make("vms")
        rootfs = self.root / "build/vms/build/c-rootfs.ext4"
        timestamp = rootfs.stat().st_mtime_ns
        assets = json.loads((self.root / "build/vms/build/assets.json").read_text())
        self.assertEqual(assets["c"]["configUrl"], "../vms/c.cfg")
        self.assertEqual(assets["c"]["runtimeUrl"], "../vms/riscbox-deadbeef/riscbox.js")
        config = self.root / "dist/vms/c.cfg"
        drive = config.parent / json.loads(config.read_text())["drive0"]["file"]
        for path in (drive, config, self.root / "dist/vms/riscbox-deadbeef/riscbox.wasm"):
            path.unlink()
            self.make("vms")
            self.assertTrue(path.exists(), str(path))
            self.assertEqual(rootfs.stat().st_mtime_ns, timestamp)
        cached = self.root / "build/downloads/riscbox-0.9.0/riscbox.d.ts"
        extracted = cached.stat().st_mtime_ns
        self.make("vms")
        self.assertEqual(cached.stat().st_mtime_ns, extracted)
        shutil.rmtree(self.root / "build/downloads/riscbox-0.9.0")
        self.make("vms")
        self.assertTrue(cached.exists())

    def test_cleanup_preserves_published_assets_and_private_data(self) -> None:
        self.vm_fixture()
        self.make("client")
        page = self.root / "dist/client/index.html"
        inventory = (page.parent / ".published-assets.json").read_text()
        self.write("dist/vms/c-drive-stale/blk.txt", "stale")
        self.write("dist/client/app-stale.js", "stale")
        self.write("db/private", "private")
        self.make("vms", "mostlyclean")
        self.assertTrue((self.root / "build/client").exists())
        self.assertTrue((self.root / "dist/client/app-stale.js").exists())
        self.make("client", "mostlyclean")
        self.make("client", "mostlyclean")
        self.assertFalse((self.root / "build/client").exists())
        self.assertFalse((self.root / "dist/client/app-stale.js").exists())
        self.assertFalse((self.root / "dist/vms/c-drive-stale").exists())
        for name in json.loads(inventory):
            self.assertTrue((page.parent / name).exists(), name)
        self.assertTrue((self.root / "build/downloads/riscbox-0.9.0.tar.gz").exists())
        self.make("client", "clean")
        self.assertFalse(page.exists())
        self.assertFalse((self.root / "dist/vms").exists())
        self.assertEqual((self.root / "db/private").read_text(), "private")

    def test_cleanup_requires_inventory_for_existing_page(self) -> None:
        self.write("dist/client/index.html", "existing page")
        self.write("dist/client/app.js", "existing bundle")
        result = subprocess.run(["make", "-C", str(self.root / "client"), "mostlyclean"],
                                text=True, capture_output=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rebuild the VM client page", result.stderr)
        self.assertTrue((self.root / "dist/client/app.js").exists())

    def test_vm_cleanup_without_published_client(self) -> None:
        self.write("dist/vms/c.cfg", "unpublished configuration")
        self.write("dist/vms/c-drive-stale/blk.txt", "unpublished drive")
        self.make("vms", "mostlyclean")
        self.assertEqual(list((self.root / "dist/vms").iterdir()), [])

    def test_root_cleanup_preserves_deployment_and_private_data(self) -> None:
        private = ("config.json", "db/codegrinder.db", "backup/database.gz")
        deployed = (
            "target/release/codegrinder", "target/release/grind",
            "dist/server/codegrinder", "dist/grind/update-grind", "dist/grind/index.html",
            "stepper/dist/stepper.linux_amd64", "stepper/dist/stepper.linux_riscv64",
            "dist/grind/grind.linux_amd64", "dist/web/scripts/app.js", "dist/web/sw.js",
            "dist/client/index.html", "dist/client/app.js",
            "dist/vms/c.cfg", "dist/vms/c-drive-current/blk.txt",
            "dist/vms/riscbox-current/riscbox.js",
        )
        intermediates = (
            "target/release/deps/library", "target/release/.fingerprint/package",
            "target/aarch64-unknown-linux-musl/release/grind", "target/.rustc_info.json",
            "target/riscv64gc-unknown-linux-musl/standalone-linux/stepper",
            "stepper/dist/stepper.linux_riscv64.part", "dist/grind/grind.linux_amd64.part",
            "dist/grind/index.html.part", "dist/grind/update-grind.part",
            "build/legacyweb/generated/codegrinder.ts", "build/legacyweb/node_modules/package/file",
            "build/client/codegrinder.ts", "build/client/node_modules/package/file",
            "build/vms/build/c-rootfs.ext4", "dist/vms/stale.cfg",
            "dist/client/index.html.part", "dist/client/.published-assets.json.part",
            "dist/vms/c-drive-stale/blk.txt", "dist/client/app-stale.js",
            "macos-minimal-sdk/sysroot-macos-arm64/usr/lib/libSystem.B.dylib",
            "macos-minimal-sdk/sysroot-macos-x86_64/usr/lib/libSystem.B.dylib",
            "macos-minimal-sdk/download/archive", "macos-minimal-sdk/hello",
            "tests/__pycache__/module.pyc",
        )
        for name in (*private, *deployed, *intermediates):
            self.write(name, name)
        self.write("dist/client/.published-assets.json", json.dumps([
            "app.js", "../vms/c.cfg", "../vms/c-drive-current",
            "../vms/riscbox-current",
        ]))
        self.make(".", "mostlyclean")
        for name in (*private, *deployed):
            self.assertEqual((self.root / name).read_text(), name)
        for name in intermediates:
            self.assertFalse((self.root / name).exists(), name)
        self.make(".", "clean")
        for name in private:
            self.assertEqual((self.root / name).read_text(), name)
        for name in deployed:
            self.assertFalse((self.root / name).exists(), name)

    def test_rust_checks_precede_tests_and_stay_component_scoped(self) -> None:
        self.make("grind", "test", "TEST_ARGS=workspace")
        self.assertEqual(self.commands(), [
            ["cargo", "fmt", "--package", "grind", "--check"],
            ["cargo", "clippy", "--release", "--locked", "-p", "grind", "--", "-D", "warnings"],
            ["cargo", "test", "--release", "--locked", "-p", "grind", "workspace"],
        ])
        self.log.unlink()
        self.make(".", "test", "-j4")
        commands = self.commands()
        self.assertEqual([command[1] for command in commands], ["fmt", "clippy", "fmt", "clippy", "fmt", "--edition", "clippy", "test", "test", "test"])


if __name__ == "__main__":
    unittest.main()
