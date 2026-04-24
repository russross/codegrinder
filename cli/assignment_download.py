from __future__ import annotations

import shutil
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import codegrinder_pb2 as pb

from errors import CliError, fail
from helpers import course_directory, load_dotfile, save_dotfile
from models import AssignmentRef, DotFileInfo, ProblemInfo
from workspace_files import update_files, workspace_file_map


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


class AssignmentWorkspaceClient(WorkspaceClient, Protocol):
    def get_assignment(self, assignment: pb.AssignmentKey) -> pb.GetAssignmentResponse: ...


def assignment_directory(root_dir: Path, course_name: str, problem_set_id: str) -> Path:
    return root_dir / course_directory(course_name) / problem_set_id


def assignment_label(course_name: str, problem_set_id: str) -> str:
    return f"{course_directory(course_name)}/{problem_set_id}"


def dotfile_matches_assignment(dotfile: DotFileInfo, assignment: pb.AssignmentKey) -> bool:
    return (
        dotfile.assignment_ref.user_id == assignment.user_id
        and dotfile.assignment_ref.course_id == assignment.course_id
        and dotfile.assignment_ref.problem_set_id == assignment.problem_set_id
    )


def dotfile_matches_problems(dotfile: DotFileInfo, problems: Sequence[pb.AssignmentListProblem]) -> bool:
    return {info.problem_id for info in dotfile.problems.values()} == {problem.problem_id for problem in problems}


def dotfile_matches_assignment_summary(dotfile: DotFileInfo, info_resp: pb.GetAssignmentResponse) -> bool:
    expected = {
        problem.problem_id: ProblemInfo(
            problem_id=problem.problem_id,
            step=int(problem.current_step_number),
        )
        for problem in info_resp.problems
    }
    return dotfile.problems == expected


def unpack_assignment(
    client: WorkspaceClient,
    info_resp: pb.GetAssignmentResponse,
    root_dir: Path,
    pretty_full: str,
) -> Path:
    print(f"unpacking problem set in {pretty_full}")

    change_to = root_dir
    infos: dict[str, ProblemInfo] = {}
    total_problems = len(info_resp.problems)
    for problem_info in info_resp.problems:
        infos[problem_info.problem_id] = ProblemInfo(
            problem_id=problem_info.problem_id,
            step=int(problem_info.current_step_number),
        )
        target = root_dir if total_problems == 1 else root_dir / problem_info.problem_id
        if total_problems > 1:
            if problem_info.current_step_number > 1:
                print(f"unpacking problem {problem_info.problem_id} step {problem_info.current_step_number}")
            else:
                print(f"unpacking problem {problem_info.problem_id}")
        elif problem_info.current_step_number > 1:
            print(f"unpacking step {problem_info.current_step_number}")

        workspace = client.get_workspace(
            info_resp.assignment,
            problem_info.problem_id,
            int(problem_info.current_step_number),
            pb.WORKSPACE_FILE_STATE_CURRENT,
            True,
            False,
        )
        files = workspace_file_map(workspace.system_owned_files)
        files.update(workspace_file_map(workspace.student_owned_files))
        update_files(target, files, None, False)

    dotfile = DotFileInfo(
        assignment_ref=AssignmentRef(
            user_id=info_resp.assignment.user_id,
            course_id=info_resp.assignment.course_id,
            problem_set_id=info_resp.assignment.problem_set_id,
        ),
        problems=infos,
        path=str(root_dir / ".grind"),
    )
    save_dotfile(dotfile)
    return change_to


def download_assignment_summary(
    client: WorkspaceClient,
    info_resp: pb.GetAssignmentResponse,
    root_dir: Path,
    pretty_full: str,
) -> Path:
    if info_resp.download_status != pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE:
        if info_resp.download_status == pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY:
            fail(f"assignment {pretty_full} prerequisite is not ready")
        fail(f"assignment {pretty_full} is not open yet")
    root_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{root_dir.name}.", dir=root_dir.parent))
    try:
        change_to = unpack_assignment(client, info_resp, staging, pretty_full)
        if root_dir.exists():
            fail(f"directory {pretty_full} already exists\ndelete it first if you want to re-download the assignment")
        staging.rename(root_dir)
        if change_to == staging:
            return root_dir
        return root_dir / change_to.relative_to(staging)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def download_assignment(
    client: AssignmentWorkspaceClient,
    assignment: pb.AssignmentKey,
    root_dir: Path,
    pretty_full: str,
) -> Path:
    return download_assignment_summary(client, client.get_assignment(assignment), root_dir, pretty_full)


def download_assignment_to_root(
    client: AssignmentWorkspaceClient,
    assignment: pb.AssignmentKey,
    root_dir: Path,
    pretty_root: str,
) -> Path:
    info_resp = client.get_assignment(assignment)
    target_dir = assignment_directory(root_dir, info_resp.course_name, info_resp.assignment.problem_set_id)
    pretty_full = str(Path(pretty_root) / course_directory(info_resp.course_name) / info_resp.assignment.problem_set_id)
    if target_dir.exists():
        fail(f"directory {pretty_full} already exists\ndelete it first if you want to re-download the assignment")
    return download_assignment_summary(client, info_resp, target_dir, pretty_full)


def existing_assignment_warning(
    item: pb.AssignmentListItem,
    target_dir: Path,
    info_resp: pb.GetAssignmentResponse | None = None,
) -> str | None:
    label = assignment_label(item.course_name, item.assignment.problem_set_id)
    dotfile_path = target_dir / ".grind"
    if not dotfile_path.exists():
        return f"warning: assignment {label} directory exists but has no .grind metadata; skipping"
    try:
        dotfile = load_dotfile(dotfile_path)
    except CliError:
        return f"warning: assignment {label} has invalid .grind metadata; skipping"
    if not dotfile_matches_assignment(dotfile, item.assignment):
        return f"warning: assignment {label} directory belongs to a different assignment; skipping"
    if info_resp is not None and not dotfile_matches_assignment_summary(dotfile, info_resp):
        return f"warning: assignment {label} has different problem metadata; skipping"
    if info_resp is None and not dotfile_matches_problems(dotfile, item.problems):
        return f"warning: assignment {label} has different problem metadata; skipping"
    return None
