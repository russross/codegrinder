from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import codegrinder_pb2 as pb

from errors import fail
from helpers import find_dotfile, grpc_time_now
from models import DotFileInfo, ProblemInfo
from workspace_files import clean_relative_path, update_files, workspace_file_map, workspace_official_paths


class WorkspaceClient(Protocol):
    def get_workspace(
        self,
        assignment: pb.AssignmentKey,
        problem_id: str,
        step_number: int,
        file_state: pb.WorkspaceFileState.ValueType,
        include_contents: bool,
        include_solution_files: bool,
    ) -> pb.GetWorkspaceResponse: ...


class WorkspaceSaveClient(Protocol):
    def save_workspace_commit(self, commit: pb.Commit) -> pb.SaveWorkspaceCommitResponse: ...


@dataclass(slots=True)
class StudentCommandContext:
    workspace: pb.GetWorkspaceResponse
    commit: pb.Commit
    dotfile: DotFileInfo
    problem_dir: Path
    problem_info: ProblemInfo
    current_paths: set[str]


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
        relative_path = clean_relative_path(name)
        path = problem_dir / relative_path.path
        if not path.exists():
            missing.append(name)
            continue
        files[relative_path.as_posix()] = path.read_bytes()

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


def save_current_student_files(
    client: WorkspaceSaveClient,
    student: StudentCommandContext,
    note: str,
) -> pb.SaveWorkspaceCommitResponse:
    return client.save_workspace_commit(commit_with_metadata(student.commit, action="", note=note))


def get_workspace(
    client: WorkspaceClient,
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


def gather_student_context(client: WorkspaceClient, start_dir: Path) -> StudentCommandContext:
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
        [clean_relative_path(path).as_posix() for path in workspace.student_owned_files],
        workspace.assignment,
        workspace.problem_id,
        int(workspace.step_number),
    )
    current_paths = workspace_official_paths(workspace)
    return StudentCommandContext(
        workspace=workspace,
        commit=commit,
        dotfile=dotfile,
        problem_dir=problem_dir,
        problem_info=info,
        current_paths=current_paths,
    )


def commit_with_metadata(commit: pb.Commit, *, action: str, note: str) -> pb.Commit:
    updated = pb.Commit()
    updated.CopyFrom(commit)
    updated.action = action
    updated.note = note
    return updated


def build_grading_commit(
    user_id: str,
    student: StudentCommandContext,
    action: str,
    note: str,
) -> pb.GradingCommit:
    return pb.GradingCommit(user_id=user_id, commit=commit_with_metadata(student.commit, action=action, note=note))
