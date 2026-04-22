from __future__ import annotations

from pathlib import Path

import pytest

import codegrinder_pb2 as pb
from errors import CliError
from workspace_files import clean_relative_path, update_files, workspace_file_map, workspace_official_paths


def test_clean_relative_path_rejects_non_workspace_paths() -> None:
    for raw in ["", "/tmp/file.py", "../file.py", "src/../file.py", "src\\file.py", "."]:
        with pytest.raises(CliError):
            clean_relative_path(raw)


def test_clean_relative_path_returns_validated_workspace_path_type() -> None:
    path = clean_relative_path("src/main.py")

    assert path.path == Path("src/main.py")
    assert path.as_posix() == "src/main.py"


def test_workspace_file_map_normalizes_and_preserves_empty_content() -> None:
    files = workspace_file_map(
        [
            pb.AssignmentStepFile(path="src/main.py", content=b"print('x')\n"),
            pb.AssignmentStepFile(path="empty.txt"),
        ]
    )

    assert files == {"src/main.py": b"print('x')\n", "empty.txt": b""}


def test_workspace_official_paths_combines_system_and_student_files() -> None:
    workspace = pb.GetWorkspaceResponse(
        system_owned_files=[pb.AssignmentStepFile(path="README.md")],
        student_owned_files=[pb.AssignmentStepFile(path="src/main.py")],
    )

    assert workspace_official_paths(workspace) == {"README.md", "src/main.py"}


def test_update_files_rewrites_changed_content_and_prunes_removed_paths(tmp_path: Path) -> None:
    (tmp_path / "src" / "old.py").parent.mkdir()
    (tmp_path / "src" / "old.py").write_text("old\n", encoding="utf-8")
    (tmp_path / "src" / "main.py").write_text("before\n", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "obsolete.md").write_text("obsolete\n", encoding="utf-8")

    update_files(
        tmp_path,
        {"src/main.py": b"after\n", "new.txt": b"new\n"},
        {"src/main.py", "src/old.py", "docs/obsolete.md"},
        False,
    )

    assert (tmp_path / "src" / "main.py").read_text(encoding="utf-8") == "after\n"
    assert (tmp_path / "new.txt").read_text(encoding="utf-8") == "new\n"
    assert not (tmp_path / "src" / "old.py").exists()
    assert not (tmp_path / "docs").exists()
