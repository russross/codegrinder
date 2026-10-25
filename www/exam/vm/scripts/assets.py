#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import TypedDict


class Drive(TypedDict):
    file: str


class Share(TypedDict):
    server: str
    tag: str


class Configuration(TypedDict):
    version: int
    machine: str
    memory_size: int
    bios: str
    kernel: str
    cmdline: str
    console: str
    drive0: Drive
    fs0: Share


def write_changed(path: Path, content: str) -> None:
    # Unchanged manifests keep their timestamps so the UI remains incremental.
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    temporary = path.with_name(path.name + ".part")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def payload(pattern: str) -> str:
    matches = [path.name for path in Path("build/riscbox").iterdir() if re.fullmatch(pattern, path.name)]
    if len(matches) != 1:
        raise ValueError(f"expected one release payload: {pattern}")
    return matches[0]


def prepare(version: str, names: list[str]) -> None:
    # All boot URLs resolve within the matching immutable runtime release.
    if re.fullmatch(r"\d+\.\d+\.\d+", version) is None:
        raise ValueError("expected Riscbox release version")
    release = f"../runtime/riscbox-{version}"
    firmware = payload(r"fw_dynamic\.bin-.*\.gz")
    kernel = payload(r"linux-.*\.gz")
    assets: dict[str, dict[str, str]] = {}
    outputs = ["build/assets.json"]
    for name in names:
        drive = Path(f"build/{name}-disk-name").read_text(encoding="utf-8").strip()
        config: Configuration = {
            "version": 1, "machine": "riscv64", "memory_size": 256,
            "bios": f"{release}/{firmware}",
            "kernel": f"{release}/{kernel}",
            "cmdline": "root=/dev/vda rw rootfstype=ext4 console=hvc0 quiet loglevel=0",
            "console": "virtio", "drive0": {"file": f"{drive}/blk.txt"},
            "fs0": {"server": "workspace", "tag": "shared"},
        }
        content = json.dumps(config, indent=2) + "\n"
        digest = hashlib.sha256(content.encode()).hexdigest()[:16]
        filename = f"{name}-{digest}.cfg"
        write_changed(Path("image") / filename, content)
        write_changed(Path("image") / f"{name}.cfg", content)
        assets[name] = {
            "configUrl": f"vm/image/{filename}",
            "runtimeUrl": f"vm/runtime/riscbox-{version}/riscbox.js",
            "wasmUrl": f"vm/runtime/riscbox-{version}/riscbox.wasm",
        }
        outputs.extend([f"image/{filename}", f"image/{name}.cfg"])

    # Immutable configurations keep already-open clients on their original disk.
    write_changed(Path("build/assets.json"), json.dumps(assets, indent=2) + "\n")
    Path("build/assets-outputs.mk").write_text(
        f"ASSETS_OUTPUTS := {' '.join(outputs)}\n"
        "build/assets.stamp: $(ASSETS_OUTPUTS)\n$(ASSETS_OUTPUTS):\n",
        encoding="utf-8",
    )


def main() -> int:
    try:
        if len(sys.argv) < 3:
            raise ValueError("expected Riscbox release version")
        prepare(sys.argv[1], sys.argv[2:])
    except (OSError, ValueError) as error:
        print(f"VM assets: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
