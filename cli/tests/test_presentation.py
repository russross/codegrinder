from __future__ import annotations

from pathlib import Path

import pytest

import codegrinder_pb2 as pb
from presentation import print_assignment_list


def test_assignment_list_uses_canvas_title_score_and_pretty_workspace_path(
    capsys: pytest.CaptureFixture[str],
) -> None:
    items = [
        pb.AssignmentListItem(
            assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="sudoku"),
            course_name="CS 2810",
            assignment_title="Sudoku pencil marks calculator",
            assignment_score=0.25,
        ),
        pb.AssignmentListItem(
            assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="sorting"),
            course_name="CS 2810",
            assignment_title="Sorting lab",
            assignment_score=1.0,
        ),
    ]

    print_assignment_list(items, Path.home())

    assert capsys.readouterr().out.splitlines() == [
        "CS 2810",
        "-------",
        "Sudoku pencil marks calculator   25% (~/cs2810/sudoku)",
        "Sorting lab                     100% (~/cs2810/sorting)",
    ]


def test_assignment_list_reports_waiting_prerequisite(capsys: pytest.CaptureFixture[str]) -> None:
    items = [
        pb.AssignmentListItem(
            assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="sudoku2"),
            course_name="CS 2810",
            assignment_title="Sudoku part 2",
            download_status=pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY,
            prerequisite_problem_set_id="sudoku1",
        ),
    ]

    print_assignment_list(items, Path.home())

    assert capsys.readouterr().out.splitlines() == [
        "CS 2810",
        "-------",
        "Sudoku part 2    0% (~/cs2810/sudoku2) waiting for sudoku1",
    ]
