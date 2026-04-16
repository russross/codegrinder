from __future__ import annotations

from pathlib import Path

from cli import _build_parser
from student_workspace import clean_workspace_tree


def test_clean_command_is_registered() -> None:
    parser = _build_parser()
    args = parser.parse_args(["clean"])
    assert args.command == "clean"
    assert args.extra == []


def test_clean_workspace_tree_removes_unofficial_files_and_empty_dirs(tmp_path: Path) -> None:
    (tmp_path / "keep.py").write_text("keep", encoding="utf-8")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("main", encoding="utf-8")
    (tmp_path / "src" / "scratch.txt").write_text("scratch", encoding="utf-8")
    (tmp_path / "empty" / "nested").mkdir(parents=True)
    (tmp_path / "empty" / "nested" / "junk.txt").write_text("junk", encoding="utf-8")

    clean_workspace_tree(tmp_path, {"keep.py", "src/main.py"})

    assert (tmp_path / "keep.py").read_text(encoding="utf-8") == "keep"
    assert (tmp_path / "src" / "main.py").read_text(encoding="utf-8") == "main"
    assert not (tmp_path / "src" / "scratch.txt").exists()
    assert not (tmp_path / "empty").exists()
    assert (tmp_path / "src").is_dir()
