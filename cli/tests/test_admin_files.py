from __future__ import annotations

from pathlib import Path

import pytest

import codegrinder_pb2 as pb
import cli
import helpers
from admin_commands import _collect_changes, _print_file_statuses, _print_problem_type
from errors import CliError


def test_problemtype_files_command_visible_only_for_cached_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "load_config_or_default", lambda: helpers.Config(is_admin=False))
    student_parser = cli._build_parser()
    with pytest.raises(SystemExit):
        student_parser.parse_args(["problemtype"])

    monkeypatch.setattr(cli, "load_config_or_default", lambda: helpers.Config(is_admin=True))
    admin_parser = cli._build_parser()
    with pytest.raises(SystemExit):
        admin_parser.parse_args(["files"])

    namespace = admin_parser.parse_args(["problemtype", "files", "--type", "python3unittest"])

    assert namespace.command == "problemtype"
    assert namespace.problemtype_command == "files"
    assert namespace.problem_type == "python3unittest"


def test_problemtype_management_parser_requires_explicit_action_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "load_config_or_default", lambda: helpers.Config(is_admin=True))
    parser = cli._build_parser()

    namespace = parser.parse_args(["problemtype", "create", "--problem-type", "python3unittest", "--container", "img"])

    assert namespace.command == "problemtype"
    assert namespace.problemtype_command == "create"
    assert namespace.problem_type == "python3unittest"
    assert namespace.container == "img"

    with pytest.raises(SystemExit):
        parser.parse_args(
            [
                "problemtype",
                "action",
                "add",
                "--problem-type",
                "python3unittest",
                "--action",
                "grade",
                "--command",
                "make grade",
            ]
        )

    action_namespace = parser.parse_args(
        [
            "problemtype",
            "action",
            "add",
            "--problem-type",
            "python3unittest",
            "--action",
            "grade",
            "--command",
            "make grade",
            "--parser",
            "xunit",
            "--max-cpu",
            "10",
            "--max-fd",
            "100",
            "--max-file-size",
            "10",
            "--max-memory",
            "256",
            "--max-threads",
            "20",
        ]
    )

    assert action_namespace.problemtype_command == "action-add"
    assert action_namespace.problem_type == "python3unittest"
    assert action_namespace.action == "grade"
    assert action_namespace.max_memory == 256


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


def test_problemtype_show_prints_aligned_update_commands(capsys: pytest.CaptureFixture[str]) -> None:
    _print_problem_type(
        pb.ProblemType(
            problem_type="python3unittest",
            container="codegrinder/python:3.12",
            actions={
                "grade": pb.ProblemTypeAction(
                    command="make grade",
                    parser="xunit",
                    max_cpu=10,
                    max_fd=128,
                    max_file_size=10485760,
                    max_memory=536870912,
                    max_threads=32,
                )
            },
            files={"Makefile": b"all:\n"},
        )
    )

    assert capsys.readouterr().out.splitlines() == [
        "problem type: python3unittest",
        "container:    codegrinder/python:3.12",
        "actions:",
        "  grade",
        "    command:        make grade",
        "    parser:         xunit",
        "    max_cpu:        10",
        "    max_fd:         128",
        "    max_file_size:  10485760",
        "    max_memory:     536870912",
        "    max_threads:    32",
        "",
        "    update command:",
        "      grind problemtype action update \\",
        "        --problem-type   python3unittest \\",
        "        --action         grade \\",
        "        --command        'make grade' \\",
        "        --parser         xunit \\",
        "        --max-cpu        10 \\",
        "        --max-fd         128 \\",
        "        --max-file-size  10485760 \\",
        "        --max-memory     536870912 \\",
        "        --max-threads    32",
        "",
        "canonical files:",
        "  Makefile",
    ]
