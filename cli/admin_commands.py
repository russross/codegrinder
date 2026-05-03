from __future__ import annotations

import argparse
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import codegrinder_pb2 as pb

from author_config import PROBLEM_CONFIG_NAME
from authoring import resolve_author_problem_layout
from command_support import managed_client
from errors import fail
from workspace_files import clean_relative_path, workspace_file_map


class ProblemTypeFileOperation(Enum):
    ADD = pb.PROBLEM_TYPE_FILE_OPERATION_ADD
    UPDATE = pb.PROBLEM_TYPE_FILE_OPERATION_UPDATE
    DELETE = pb.PROBLEM_TYPE_FILE_OPERATION_DELETE


@dataclass(frozen=True, slots=True)
class ProblemTypeFileChange:
    operation: ProblemTypeFileOperation
    path: str
    content: bytes


@dataclass(frozen=True, slots=True)
class ResolvedProblemType:
    problem_type: str
    directory: Path


def command_files(args: argparse.Namespace) -> None:
    resolved = _resolve_problem_type(args.problem_type)
    changes = _collect_changes(
        resolved.directory,
        adds=args.add_files,
        updates=args.update_files,
        deletes=args.delete_files,
    )

    with managed_client(args) as env:
        if not env.session.user.is_admin:
            fail("you must be an admin to use this command")

        if not changes:
            response = env.client.get_problem_type(resolved.problem_type)
            _print_file_statuses(resolved.directory, workspace_file_map(response.problem_type.files))
            return

        proto_changes = [
            pb.ProblemTypeFileChange(
                operation=change.operation.value,
                path=change.path,
                content=change.content,
            )
            for change in changes
        ]
        env.client.save_problem_type_files(resolved.problem_type, proto_changes)
        for change in changes:
            print(f"{change.operation.name.lower()}: {change.path}")


def _resolve_problem_type(explicit_problem_type: str) -> ResolvedProblemType:
    if explicit_problem_type:
        return ResolvedProblemType(problem_type=explicit_problem_type, directory=Path("."))

    layout = resolve_author_problem_layout(Path("."))
    if layout is None:
        fail(f"you must supply --type or have a valid {PROBLEM_CONFIG_NAME} file already in place")
    if not layout.config.single_step_layout and layout.active_step_number < 1:
        fail("you must run this from within a step directory")
    problem_type = (
        layout.config.steps[0].problem_type
        if layout.config.single_step_layout
        else layout.config.steps[layout.active_step_number - 1].problem_type
    )
    return ResolvedProblemType(problem_type=problem_type, directory=layout.active_step_dir)


def _collect_changes(
    directory: Path,
    *,
    adds: list[str],
    updates: list[str],
    deletes: list[str],
) -> list[ProblemTypeFileChange]:
    changes: list[ProblemTypeFileChange] = []
    seen_paths: set[str] = set()
    for operation, paths in (
        (ProblemTypeFileOperation.ADD, adds),
        (ProblemTypeFileOperation.UPDATE, updates),
        (ProblemTypeFileOperation.DELETE, deletes),
    ):
        for raw_path in paths:
            path = clean_relative_path(raw_path).as_posix()
            if path in seen_paths:
                fail(f"multiple changes requested for {path!r}")
            seen_paths.add(path)
            content = b"" if operation is ProblemTypeFileOperation.DELETE else _read_local_file(directory, path)
            changes.append(ProblemTypeFileChange(operation=operation, path=path, content=content))
    return changes


def _read_local_file(directory: Path, path: str) -> bytes:
    local_path = directory / Path(path)
    if not local_path.is_file():
        fail(f"local file {path!r} does not exist")
    return local_path.read_bytes()


def _print_file_statuses(directory: Path, server_files: dict[str, bytes]) -> None:
    if not server_files:
        print("no problem type files found")
        return
    for path, expected in sorted(server_files.items()):
        local_path = directory / Path(path)
        if not local_path.exists():
            status = "missing"
        elif local_path.read_bytes() == expected:
            status = "unchanged"
        else:
            status = "changed"
        print(f"{status}: {path}")
