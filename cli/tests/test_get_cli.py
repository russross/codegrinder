from __future__ import annotations

from pathlib import Path

import pytest

import codegrinder_pb2 as pb
from assignment_download import download_assignment_summary, existing_assignment_warning
from cli import _build_parser
from errors import CliError
from helpers import load_dotfile, save_dotfile
from models import AssignmentRef, DotFileInfo, ProblemInfo


def _list_item() -> pb.AssignmentListItem:
    return pb.AssignmentListItem(
        assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1"),
        course_name="CS 101",
        problems=[pb.AssignmentListProblem(problem_id="p1")],
        download_status=pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE,
    )


def _assignment_summary(step: int = 1) -> pb.GetAssignmentResponse:
    return pb.GetAssignmentResponse(
        assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1"),
        course_name="CS 101",
        problems=[pb.AssignmentProblemProgress(problem_id="p1", current_step_number=step)],
        download_status=pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE,
    )


class _DownloadClient:
    def __init__(self, workspaces: dict[str, pb.GetWorkspaceResponse]) -> None:
        self.workspaces = workspaces
        self.requested: list[tuple[str, int]] = []

    def get_workspace(
        self,
        assignment: pb.AssignmentKey,
        problem_id: str,
        step_number: int,
        file_state: pb.WorkspaceFileState.ValueType,
        include_contents: bool,
        include_solution_files: bool,
    ) -> pb.GetWorkspaceResponse:
        self.requested.append((problem_id, step_number))
        assert assignment.problem_set_id == "ps1"
        assert file_state == pb.WORKSPACE_FILE_STATE_CURRENT
        assert include_contents is True
        assert include_solution_files is False
        workspace = self.workspaces.get(problem_id)
        if workspace is None:
            raise CliError(f"missing workspace {problem_id}")
        return workspace


def _workspace(problem_id: str, step: int) -> pb.GetWorkspaceResponse:
    return pb.GetWorkspaceResponse(
        assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1"),
        problem_id=problem_id,
        step_number=step,
        last_step_number=2,
        system_owned_files=[pb.AssignmentStepFile(path="README.md", content=f"{problem_id} docs\n".encode())],
        student_owned_files=[pb.AssignmentStepFile(path="main.py", content=f"print({problem_id!r})\n".encode())],
    )


def test_get_command_rejects_assignment_arguments() -> None:
    parser = _build_parser()
    args = parser.parse_args(["get", "1"])
    setattr(args, "parser", parser)
    with pytest.raises(CliError):
        args.func(args)


def test_existing_assignment_without_dotfile_warns(tmp_path: Path) -> None:
    warning = existing_assignment_warning(_list_item(), tmp_path)

    assert warning == "warning: assignment CS 101/ps1 directory exists but has no .grind metadata; skipping"


def test_existing_assignment_with_matching_metadata_skips_silently(tmp_path: Path) -> None:
    save_dotfile(
        DotFileInfo(
            assignment_ref=AssignmentRef(user_id="u1", course_id="c1", problem_set_id="ps1"),
            problems={"p1": ProblemInfo(problem_id="p1", step=1)},
            path=str(tmp_path / ".grind"),
        )
    )

    assert existing_assignment_warning(_list_item(), tmp_path, _assignment_summary()) is None


def test_existing_assignment_with_problem_mismatch_warns(tmp_path: Path) -> None:
    save_dotfile(
        DotFileInfo(
            assignment_ref=AssignmentRef(user_id="u1", course_id="c1", problem_set_id="ps1"),
            problems={"p2": ProblemInfo(problem_id="p2", step=1)},
            path=str(tmp_path / ".grind"),
        )
    )

    warning = existing_assignment_warning(_list_item(), tmp_path)

    assert warning == "warning: assignment CS 101/ps1 has different problem metadata; skipping"


def test_download_assignment_summary_stages_files_and_writes_metadata(tmp_path: Path) -> None:
    target = tmp_path / "CS 101" / "ps1"
    summary = pb.GetAssignmentResponse(
        assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1"),
        course_name="CS 101",
        problems=[
            pb.AssignmentProblemProgress(problem_id="p1", current_step_number=1),
            pb.AssignmentProblemProgress(problem_id="p2", current_step_number=2),
        ],
        download_status=pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE,
    )
    client = _DownloadClient({"p1": _workspace("p1", 1), "p2": _workspace("p2", 2)})

    change_to = download_assignment_summary(client, summary, target, "CS 101/ps1")

    assert change_to == target
    assert (target / "p1" / "README.md").read_text(encoding="utf-8") == "p1 docs\n"
    assert (target / "p1" / "main.py").read_text(encoding="utf-8") == "print('p1')\n"
    assert (target / "p2" / "README.md").read_text(encoding="utf-8") == "p2 docs\n"
    dotfile = load_dotfile(target / ".grind")
    assert dotfile.problems == {
        "p1": ProblemInfo(problem_id="p1", step=1),
        "p2": ProblemInfo(problem_id="p2", step=2),
    }
    assert client.requested == [("p1", 1), ("p2", 2)]


def test_download_assignment_summary_cleans_staging_on_workspace_failure(tmp_path: Path) -> None:
    target = tmp_path / "course" / "ps1"
    summary = _assignment_summary()
    client = _DownloadClient({})

    with pytest.raises(CliError, match="missing workspace p1"):
        download_assignment_summary(client, summary, target, "course/ps1")

    assert not target.exists()
    assert list(target.parent.iterdir()) == []


def test_existing_assignment_with_step_mismatch_warns(tmp_path: Path) -> None:
    save_dotfile(
        DotFileInfo(
            assignment_ref=AssignmentRef(user_id="u1", course_id="c1", problem_set_id="ps1"),
            problems={"p1": ProblemInfo(problem_id="p1", step=1)},
            path=str(tmp_path / ".grind"),
        )
    )

    warning = existing_assignment_warning(_list_item(), tmp_path, _assignment_summary(step=2))

    assert warning == "warning: assignment CS 101/ps1 has different problem metadata; skipping"
