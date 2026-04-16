from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from collections.abc import Sequence

import codegrinder_pb2 as pb

from errors import fail
from helpers import find_dotfile, grpc_time_now, update_files
from models import DotFileInfo, ProblemInfo
from rpc_client import CodeGrinderClient


@dataclass(slots=True)
class StudentWorkspace:
    workspace: pb.GetWorkspaceResponse
    commit: pb.Commit
    dotfile: DotFileInfo
    problem_dir: Path


def _set_proto_timestamp(target: object, now) -> None:
    seconds = int(now.timestamp())
    nanos = int((now.timestamp() - seconds) * 1_000_000_000)
    setattr(target, "seconds", seconds)
    setattr(target, "nanos", nanos)


def build_commit_from_disk(
    problem_dir: Path,
    student_owned_paths: list[str],
    assignment: pb.AssignmentKey,
    problem_id: str,
    step_number: int,
) -> pb.Commit:
    files: dict[str, bytes] = {}
    missing: list[str] = []
    for name in student_owned_paths:
        path = problem_dir / Path(name)
        if not path.exists():
            missing.append(name)
            continue
        files[name] = path.read_bytes()

    if missing:
        lines = ["did not find all the expected files"] + [f"  {name} not found" for name in missing]
        fail("\n".join(lines) + "\nall expected files must be present")

    now = grpc_time_now()
    commit = pb.Commit(
        id=0,
        assignment=assignment,
        problem_id=problem_id,
        step=step_number,
        files=files,
    )
    _set_proto_timestamp(commit.created_at, now)
    _set_proto_timestamp(commit.updated_at, now)
    return commit


def assignment_key_from_dotfile(dotfile: DotFileInfo) -> pb.AssignmentKey:
    return pb.AssignmentKey(
        user_id=dotfile.assignment_ref.user_id,
        course_id=dotfile.assignment_ref.course_id,
        problem_set_id=dotfile.assignment_ref.problem_set_id,
    )


def resolve_student_problem(start_dir: Path) -> tuple[DotFileInfo, Path, str, ProblemInfo]:
    dotfile, problem_set_dir, maybe_problem_dir = find_dotfile(start_dir)
    if len(dotfile.problems) == 1:
        unique = next(iter(dotfile.problems))
        problem_dir = problem_set_dir
    else:
        if maybe_problem_dir is None:
            fail("you must run this from within a specific problem directory")
        unique = maybe_problem_dir.name
        problem_dir = maybe_problem_dir

    info = dotfile.problems.get(unique)
    if info is None:
        fail(f"unable to recognize the problem based on the directory name of {unique!r}")
    return dotfile, problem_dir, info.problem_id, info


def workspace_file_map(entries: Sequence[pb.AssignmentStepFile]) -> dict[str, bytes]:
    return {str(Path(entry.path)): bytes(entry.content or b"") for entry in entries}


def workspace_official_paths(workspace: pb.GetWorkspaceResponse) -> set[str]:
    paths = {str(Path(entry.path)) for entry in workspace.system_owned_files}
    paths.update(str(Path(entry.path)) for entry in workspace.student_owned_files)
    return paths


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


def save_student_workspace(client: CodeGrinderClient, student: StudentWorkspace, note: str) -> None:
    commit = student.commit
    commit.action = ""
    commit.note = note
    unsigned = pb.GradingCommit(user_id=client.session.user.user_id, commit=commit)
    client.save_ungraded_commit(unsigned)


def get_workspace(
    client: CodeGrinderClient,
    assignment: pb.AssignmentKey,
    problem_id: str,
    step_number: int,
    file_state: pb.WorkspaceFileState.ValueType,
    include_contents: bool,
    include_solution_files: bool,
) -> pb.GetWorkspaceResponse:
    return client.get_workspace(
        assignment,
        problem_id,
        step_number,
        file_state,
        include_contents,
        include_solution_files,
    )


def gather_student(client: CodeGrinderClient, start_dir: Path) -> StudentWorkspace:
    dotfile, problem_dir, problem_id, info = resolve_student_problem(start_dir)
    workspace = get_workspace(
        client,
        assignment_key_from_dotfile(dotfile),
        problem_id,
        info.step,
        pb.WORKSPACE_FILE_STATE_CURRENT,
        True,
        False,
    )
    system_files = workspace_file_map(workspace.system_owned_files)
    update_files(problem_dir, system_files, None, True)

    commit = build_commit_from_disk(
        problem_dir,
        [str(Path(entry.path)) for entry in workspace.student_owned_files],
        workspace.assignment,
        workspace.problem_id,
        int(workspace.step_number),
    )
    return StudentWorkspace(workspace=workspace, commit=commit, dotfile=dotfile, problem_dir=problem_dir)
