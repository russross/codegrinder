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
        Path("build/ui/app-fixture.js").write_text("bundle")
    else:
        Path("scripts/app.js").write_text("bundle")
        Path("sw.js").write_text("worker")
elif name == "clang":
    Path(arguments[arguments.index("-o") + 1]).write_text(arguments[-1])
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
            "Makefile", "scripts", "server/Makefile", "grind/Makefile",
            "www/Makefile", "www/web/Makefile", "www/exam/Makefile",
            "www/exam/scripts/publish.py", "www/exam/vm/Makefile",
            "www/exam/vm/scripts/assets.py", "tests/Makefile",
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
        for name in ("npm", "cargo", "clang"):
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
        self.browser_fixture("www/web")
        self.write("www/web/scripts/app.ts", "first")
        self.make("www/web", "-j4")
        initial = self.commands()
        self.make("www/web", "-j4")
        self.assertEqual(self.commands(), initial)

        # Source edits and removals rebuild bundles without reinstalling packages.
        self.write("www/web/scripts/extra.ts", "extra")
        self.make("www/web")
        self.assertEqual(len(self.commands()), len(initial) + 2)
        (self.root / "www/web/scripts/extra.ts").unlink()
        self.make("www/web")
        self.assertEqual(len(self.commands()), len(initial) + 4)
        self.write("www/web/scripts/app.ts", "second")
        self.make("www/web")
        self.assertEqual(len(self.commands()), len(initial) + 6)
        (self.root / "www/web/scripts/app.js").unlink()
        self.make("www/web")
        self.assertTrue((self.root / "www/web/scripts/app.js").exists())

        # Missing generated imports are regenerated as a single grouped output.
        generated = self.root / "www/web/generated/google/protobuf/duration.ts"
        generated.unlink()
        self.make("www/web", "-j4")
        self.assertTrue(generated.exists())
        installed = sum(command == ["npm", "ci"] for command in self.commands())
        self.assertEqual(installed, 1)
        self.write("www/web/package-lock.json", '{"changed": true}')
        self.make("www/web")
        self.assertEqual(sum(command == ["npm", "ci"] for command in self.commands()), 2)

    def test_exam_css_publication_and_missing_deployment(self) -> None:
        self.browser_fixture("www/exam")
        self.write("www/exam/index.ts", "source")
        self.write("www/exam/index.template.html", "{{app}} {{style}} {{favicon}}")
        self.write("www/exam/favicon.svg", "icon")
        self.write("www/exam/vm/Makefile", "all:\n\t@mkdir -p build\n\t@test -f build/assets.json || printf '{}' > build/assets.json\n")
        self.make("www/exam", "-j4")
        initial = self.commands()
        first_entry = (self.root / "www/exam/index.html").read_text()
        self.make("www/exam")
        self.assertEqual(self.commands(), initial)
        self.write("www/exam/style.css", "changed style")
        self.make("www/exam")
        self.assertEqual(self.commands(), initial)
        new_entry = (self.root / "www/exam/index.html").read_text()
        self.assertNotEqual(first_entry, new_entry)
        for output in first_entry.split():
            self.assertTrue((self.root / "www/exam" / output).exists())

        # A lost published asset is restored, and subsequent builds settle again.
        (self.root / "www/exam" / new_entry.split()[0]).unlink()
        self.make("www/exam")
        self.assertTrue((self.root / "www/exam" / new_entry.split()[0]).exists())
        commands = self.commands()
        self.make("www/exam")
        self.assertEqual(self.commands(), commands)

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

    def test_vm_incremental_build_and_missing_disk_and_runtime(self) -> None:
        vm = "www/exam/vm"
        self.write(f"{vm}/guest/startup", "guest")
        self.write(f"{vm}/build/downloads/risclet-0.5.5", "risclet")
        for name in ("riscbox.js", "riscbox.wasm", "riscbox.d.ts", "fw_dynamic.bin-boot.gz", "linux-kernel.gz"):
            self.write(f"{vm}/fixture-release/{name}", name)
        splitter = '''import hashlib
import json
import os
import sys
from pathlib import Path
with open(os.environ["BUILD_LOG"], "a") as log:
    log.write(json.dumps(["split"]) + "\\n")
drive = "drive-" + hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()[:8]
directory = Path(sys.argv[2]) / drive
directory.mkdir(parents=True, exist_ok=True)
(directory / "blk.txt").write_text("disk")
print(drive)
'''
        self.write(f"{vm}/fixture-release/splitimg.py", splitter)
        archive = self.root / f"{vm}/build/downloads/riscbox-2026.10.7.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            output.add(self.root / f"{vm}/fixture-release", arcname="riscbox")

        # Local preparation substitutes for downloads and QEMU, preserving Make's graph.
        self.write(f"{vm}/scripts/fetch.sh", '#!/bin/sh\nset -eu\nprintf alpine > "$3"\n', executable=True)
        self.write(
            f"{vm}/scripts/download-release.sh",
            '#!/bin/sh\nset -eu\nif [ "$1" = risclet ]; then printf risclet > "$3"; else tar -czf "$3" fixture-release; fi\n',
            executable=True,
        )
        prepare = '''#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
with open(os.environ["BUILD_LOG"], "a") as log:
    log.write(json.dumps(["image"]) + "\\n")
Path("build/rootfs.ext4").write_bytes(Path(sys.argv[2]).read_bytes() + Path("guest/startup").read_bytes())
'''
        self.write(f"{vm}/build-image.sh", prepare, executable=True)
        self.make(vm, "-j4")
        self.assertEqual(self.commands(), [["image"], ["split"]])
        manifest = self.root / f"{vm}/build/assets.json"
        first_manifest = manifest.stat().st_mtime_ns
        self.make(vm)
        self.assertEqual(self.commands(), [["image"], ["split"]])
        self.assertEqual(manifest.stat().st_mtime_ns, first_manifest)

        # A changed publisher runs once even when its manifest bytes stay identical.
        publisher = self.root / f"{vm}/scripts/assets.py"
        publisher.write_text(publisher.read_text() + "\n# Fixture publisher revision.\n")
        self.assertIn("scripts/assets.py", self.make(vm))
        self.assertNotIn("scripts/assets.py", self.make(vm))
        self.assertEqual(manifest.stat().st_mtime_ns, first_manifest)

        # Lost deployment files recover without rebuilding the QEMU-prepared image.
        drive = (self.root / f"{vm}/build/disk-name").read_text().strip()
        block = self.root / f"{vm}/image/{drive}/blk.txt"
        block.unlink()
        self.make(vm)
        self.assertTrue(block.exists())
        self.assertEqual(self.commands(), [["image"], ["split"], ["split"]])
        runtime = self.root / f"{vm}/runtime/riscbox-2026.10.7/riscbox.wasm"
        runtime.unlink()
        self.make(vm)
        self.assertTrue(runtime.exists())
        manifest.unlink()
        self.make(vm)
        self.assertTrue(manifest.exists())
        config = self.root / vm / json.loads(manifest.read_text())["configUrl"].removeprefix("vm/")
        config.unlink()
        self.make(vm)
        self.assertTrue(config.exists())
        commands = self.commands()
        manifest_timestamp = manifest.stat().st_mtime_ns
        self.make(vm)
        self.assertEqual(self.commands(), commands)
        self.assertEqual(manifest.stat().st_mtime_ns, manifest_timestamp)

        self.write(f"{vm}/guest/startup", "updated guest")
        self.make(vm)
        self.assertEqual(self.commands()[-2:], [["image"], ["split"]])

    def test_cleanup_preserves_deployment_and_private_data(self) -> None:
        preserved = (
            "config.json", "db/codegrinder.db", "backup/database.gz",
            "www/exam/vm/image/risclet.cfg", "www/exam/vm/runtime/package.json",
        )
        deployed = (
            "target/release/codegrinder", "target/release/grind",
            "www/grind.linux_amd64", "www/web/scripts/app.js", "www/web/sw.js",
            "www/exam/index.html", "www/exam/dist/app-old.js",
            "www/exam/vm/runtime/riscbox-2026.10.7/riscbox.js",
            "www/exam/vm/runtime/riscbox.js", "www/exam/vm/image/drive-old/blk.txt",
            "www/exam/vm/image/risclet-old.json",
        )
        intermediates = (
            "target/release/deps/library", "target/release/.fingerprint/package",
            "target/aarch64-unknown-linux-musl/release/grind", "target/.rustc_info.json",
            "www/web/generated/codegrinder.ts", "www/web/node_modules/package/file",
            "www/exam/build/ui/app.js", "www/exam/codegrinder.ts",
            "www/exam/index.html.part", "www/grind.linux_amd64.part",
            "www/exam/vm/image/risclet-current.json.part",
            "www/exam/vm/build/rootfs.ext4", "www/exam/vm/runtime/riscbox-2026.10.7/.built",
            "macos-minimal-sdk/sysroot-macos-arm64/usr/lib/libSystem.B.dylib",
            "macos-minimal-sdk/download/archive", "tests/__pycache__/module.pyc",
        )
        for name in (*preserved, *deployed, *intermediates):
            self.write(name, name)
        self.make(".", "mostlyclean")
        for name in (*preserved, *deployed):
            self.assertEqual((self.root / name).read_text(), name)
        for name in intermediates:
            self.assertFalse((self.root / name).exists(), name)
        self.make(".", "clean")
        for name in preserved:
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
        self.assertEqual([command[1] for command in commands], ["fmt", "clippy", "fmt", "clippy", "test", "test"])


if __name__ == "__main__":
    unittest.main()
