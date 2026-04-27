from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import codegrinder_pb2 as pb

from errors import fail


@dataclass(frozen=True, slots=True)
class RelativeWorkspacePath:
    path: Path

    def as_posix(self) -> str:
        return self.path.as_posix()


def clean_relative_path(raw: str) -> RelativeWorkspacePath:
    if "\\" in raw:
        fail(f"invalid path from server: {raw!r}")
    path = PurePosixPath(raw)
    if path.is_absolute() or raw.strip() == "":
        fail(f"invalid path from server: {raw!r}")
    parts = path.parts
    if not parts or any(part in ("", ".", "..") for part in parts):
        fail(f"invalid path from server: {raw!r}")
    return RelativeWorkspacePath(Path(*parts))


def workspace_file_map(entries: Mapping[str, bytes]) -> dict[str, bytes]:
    return {clean_relative_path(path).as_posix(): bytes(content or b"") for path, content in entries.items()}


def workspace_official_paths(workspace: pb.GetWorkspaceResponse) -> set[str]:
    return {
        clean_relative_path(path).as_posix()
        for path in [*workspace.system_owned_files.keys(), *workspace.student_owned_files.keys()]
    }


def clean_workspace_tree(directory: Path, official_paths: set[str]) -> None:
    official = {Path(path) for path in official_paths}
    for path in sorted(directory.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        rel = path.relative_to(directory)
        if path.is_dir():
            try:
                path.rmdir()
            except OSError:
                pass
            continue
        if rel in official:
            continue
        print(f"removing file: {rel}")
        path.unlink()


def update_files(directory: Path, files: dict[str, bytes], old_files: set[str] | None, chatty: bool) -> None:
    for name, contents in files.items():
        relative_path = clean_relative_path(name)
        path = directory / relative_path.path
        if not path.exists():
            if chatty:
                print(f"saving file:   {name}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)
            continue

        on_disk = path.read_bytes()
        if on_disk != contents:
            if chatty:
                print(f"updating file: {name}")
            path.write_bytes(contents)

    if old_files is None:
        return
    for name in old_files:
        if name in files:
            continue
        relative_path = clean_relative_path(name)
        path = directory / relative_path.path
        if path.exists():
            if chatty:
                print(f"removing file: {name}")
            path.unlink()
        parent = relative_path.path.parent
        if parent != Path("."):
            maybe = directory / parent
            try:
                maybe.rmdir()
            except OSError:
                pass
