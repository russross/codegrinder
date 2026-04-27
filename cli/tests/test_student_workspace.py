from __future__ import annotations

from pathlib import Path

import codegrinder_pb2 as pb
from helpers import save_dotfile
from models import AssignmentRef, DotFileInfo, ProblemInfo
from student_workspace import build_grading_commit, gather_student_context, save_current_student_files


class _StudentClient:
    def __init__(self, workspace: pb.GetWorkspaceResponse) -> None:
        self.workspace = workspace
        self.requests: list[tuple[str, int, bool]] = []

    def get_workspace(
        self,
        assignment: pb.AssignmentKey,
        problem_id: str,
        step_number: int,
        file_state: pb.WorkspaceFileState.ValueType,
        include_contents: bool,
        include_solution_files: bool,
    ) -> pb.GetWorkspaceResponse:
        assert assignment == self.workspace.assignment
        assert file_state == pb.WORKSPACE_FILE_STATE_CURRENT
        assert include_contents is True
        self.requests.append((problem_id, step_number, include_solution_files))
        return self.workspace


def test_gather_student_context_refreshes_system_files_and_builds_commit(tmp_path: Path) -> None:
    save_dotfile(
        DotFileInfo(
            assignment_ref=AssignmentRef(user_id="u1", course_id="c1", problem_set_id="ps1"),
            problems={"problem-a": ProblemInfo(problem_id="problem-a", step=2)},
            path=str(tmp_path / ".grind"),
        )
    )
    (tmp_path / "README.md").write_text("stale\n", encoding="utf-8")
    (tmp_path / "main.py").write_text("student\n", encoding="utf-8")
    workspace = pb.GetWorkspaceResponse(
        assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1"),
        problem_id="problem-a",
        step_number=2,
        last_step_number=3,
        system_owned_files={"README.md": b"fresh\n"},
        student_owned_files={"main.py": b"starter\n"},
    )
    client = _StudentClient(workspace)

    context = gather_student_context(client, tmp_path)

    assert (tmp_path / "README.md").read_text(encoding="utf-8") == "fresh\n"
    assert context.problem_info == ProblemInfo(problem_id="problem-a", step=2)
    assert context.current_paths == {"README.md", "main.py"}
    assert dict(context.commit.files) == {"main.py": b"student\n"}
    assert client.requests == [("problem-a", 2, False)]


def test_build_grading_commit_sets_action_note_and_user_without_rebuilding_files(tmp_path: Path) -> None:
    save_dotfile(
        DotFileInfo(
            assignment_ref=AssignmentRef(user_id="u1", course_id="c1", problem_set_id="ps1"),
            problems={"problem-a": ProblemInfo(problem_id="problem-a", step=1)},
            path=str(tmp_path / ".grind"),
        )
    )
    (tmp_path / "main.py").write_text("student\n", encoding="utf-8")
    workspace = pb.GetWorkspaceResponse(
        assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1"),
        problem_id="problem-a",
        step_number=1,
        last_step_number=1,
        student_owned_files={"main.py": b"starter\n"},
    )
    context = gather_student_context(_StudentClient(workspace), tmp_path)

    grading = build_grading_commit("user-123", context, "grade", "grind grade")

    assert grading.user_id == "user-123"
    assert grading.commit.action == "grade"
    assert grading.commit.note == "grind grade"
    assert dict(grading.commit.files) == {"main.py": b"student\n"}
    assert context.commit.action == ""
    assert context.commit.note == ""


class _SaveClient:
    def __init__(self) -> None:
        self.commit: pb.Commit | None = None

    def save_workspace_commit(self, commit: pb.Commit) -> pb.SaveWorkspaceCommitResponse:
        self.commit = commit
        return pb.SaveWorkspaceCommitResponse()


def test_save_current_student_files_sets_note_without_mutating_context_commit(tmp_path: Path) -> None:
    save_dotfile(
        DotFileInfo(
            assignment_ref=AssignmentRef(user_id="u1", course_id="c1", problem_set_id="ps1"),
            problems={"problem-a": ProblemInfo(problem_id="problem-a", step=1)},
            path=str(tmp_path / ".grind"),
        )
    )
    (tmp_path / "main.py").write_text("student\n", encoding="utf-8")
    workspace = pb.GetWorkspaceResponse(
        assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1"),
        problem_id="problem-a",
        step_number=1,
        last_step_number=1,
        student_owned_files={"main.py": b"starter\n"},
    )
    context = gather_student_context(_StudentClient(workspace), tmp_path)
    client = _SaveClient()

    save_current_student_files(client, context, "grind sync")

    assert client.commit is not None
    assert client.commit.action == ""
    assert client.commit.note == "grind sync"
    assert context.commit.action == ""
    assert context.commit.note == ""
