#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


def prune(root: Path, vm_only: bool) -> None:
    # The published inventory survives cache cleanup and unpublished VM builds.
    manifest = root / ".published-assets.json"
    if manifest.exists():
        value: object = json.loads(manifest.read_text(encoding="utf-8"))
        if not isinstance(value, list) or any(not isinstance(path, str) for path in value):
            raise ValueError("invalid published asset inventory")
        active = {Path(path) for path in value}
    elif (root / "index.html").exists():
        raise ValueError("rebuild the exam page to record its assets before mostlyclean")
    else:
        active = set()

    # Only generated deployment trees are swept; runtime package metadata is source.
    directories = [Path("vm/image"), Path("vm/runtime")]
    if not vm_only:
        directories.append(Path("dist"))
    active.add(Path("vm/runtime/package.json"))
    for directory in directories:
        target = root / directory
        if not target.exists():
            continue
        for path in target.iterdir():
            if path.relative_to(root) in active:
                continue
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink()


def main() -> int:
    # Both component entry points resolve the same published page and inventory.
    try:
        if sys.argv[1:] not in ([], ["--vm-only"]):
            raise ValueError("usage: prune.py [--vm-only]")
        prune(Path(__file__).resolve().parent.parent, bool(sys.argv[1:]))
    except (OSError, ValueError) as error:
        print(f"Exam cleanup: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
