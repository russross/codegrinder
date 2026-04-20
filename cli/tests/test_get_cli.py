from __future__ import annotations

from pathlib import Path

import pytest

import codegrinder_pb2 as pb
from cli import _build_parser, existing_assignment_warning
from errors import CliError
from helpers import save_dotfile
from models import AssignmentRef, DotFileInfo, ProblemInfo


def _list_item() -> pb.AssignmentListItem:
    return pb.AssignmentListItem(
        assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1"),
        course_name="CS 101",
        problems=[pb.AssignmentListProblem(problem_id="p1")],
        download_status=pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE,
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
            problems={"p1": ProblemInfo(problem_id="p1", step=1, total_steps=1)},
            path=str(tmp_path / ".grind"),
        )
    )

    assert existing_assignment_warning(_list_item(), tmp_path) is None


def test_existing_assignment_with_problem_mismatch_warns(tmp_path: Path) -> None:
    save_dotfile(
        DotFileInfo(
            assignment_ref=AssignmentRef(user_id="u1", course_id="c1", problem_set_id="ps1"),
            problems={"p2": ProblemInfo(problem_id="p2", step=1, total_steps=1)},
            path=str(tmp_path / ".grind"),
        )
    )

    warning = existing_assignment_warning(_list_item(), tmp_path)

    assert warning == "warning: assignment CS 101/ps1 has different problem metadata; skipping"
