#!/usr/bin/env python3
"""Synchronize component source inputs into the shared build tree."""
import json
import shutil
import sys
from pathlib import Path


def stage(source: Path, target: Path) -> None:
    # The inventory owns only copied source files, never generated build outputs.
    target.mkdir(parents=True, exist_ok=True)
    manifest = target / '.sources.json'
    previous = set(json.loads(manifest.read_text()) if manifest.exists() else [])
    current = set()
    for path in sorted(source.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(source)
        current.add(str(relative))
        destination = target / relative
        if not destination.exists() or destination.read_bytes() != path.read_bytes():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
    for name in previous - current:
        (target / name).unlink(missing_ok=True)
    manifest.write_text(json.dumps(sorted(current)) + '\n')


if __name__ == '__main__':
    try:
        stage(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, ValueError) as error:
        sys.exit(f'source staging: {error}')
