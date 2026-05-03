from __future__ import annotations

from pathlib import Path

import pytest

import cli
import helpers
from admin_commands import _collect_changes, _print_file_statuses
from errors import CliError


def test_files_command_visible_only_for_cached_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "load_config_or_default", lambda: helpers.Config(is_admin=False))
    student_parser = cli._build_parser()
    with pytest.raises(SystemExit):
        student_parser.parse_args(["files"])

    monkeypatch.setattr(cli, "load_config_or_default", lambda: helpers.Config(is_admin=True))
    admin_parser = cli._build_parser()
    namespace = admin_parser.parse_args(["files", "--type", "python3unittest"])

    assert namespace.command == "files"
    assert namespace.problem_type == "python3unittest"


def test_collect_files_changes_rejects_duplicate_normalized_paths(tmp_path: Path) -> None:
    path = tmp_path / "tests"
    path.mkdir()
    (path / "new.py").write_bytes(b"new\n")

    with pytest.raises(CliError):
        _collect_changes(
            tmp_path,
            adds=["tests/new.py"],
            updates=["tests/./new.py"],
            deletes=[],
        )


def test_files_status_reports_only_server_file_set(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    (tmp_path / "same.py").write_bytes(b"same\n")
    (tmp_path / "changed.py").write_bytes(b"local\n")
    (tmp_path / "extra.py").write_bytes(b"extra\n")

    _print_file_statuses(
        tmp_path,
        {
            "same.py": b"same\n",
            "changed.py": b"server\n",
            "missing.py": b"server\n",
        },
    )

    assert capsys.readouterr().out.splitlines() == [
        "changed: changed.py",
        "missing: missing.py",
        "unchanged: same.py",
    ]
