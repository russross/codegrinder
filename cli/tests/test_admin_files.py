from __future__ import annotations

import argparse
from pathlib import Path

import pytest

import codegrinder_pb2 as pb
import cli
import helpers
from admin_commands import _action_specs_from_args, _collect_file_set, _parse_action_specs, _print_file_statuses, _print_problem_type
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


def test_problemtype_management_parser_sets_complete_action_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "load_config_or_default", lambda: helpers.Config(is_admin=True))
    parser = cli._build_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(
            [
                "problemtype",
                "action",
                "set",
                "--problem-type",
                "python3unittest",
            ]
        )

    action_namespace = parser.parse_args(
        [
            "problemtype",
            "action",
            "set",
            "--problem-type",
            "python3unittest",
            "--container",
            "img",
            "--action",
            "grade|make grade|xunit|10|100|10|256|20",
        ]
    )

    assert action_namespace.problemtype_command == "action-set"
    assert action_namespace.problem_type == "python3unittest"
    assert action_namespace.container == "img"
    assert action_namespace.actions == ["grade|make grade|xunit|10|100|10|256|20"]


def test_parse_action_specs_rejects_duplicate_actions() -> None:
    with pytest.raises(CliError):
        _parse_action_specs(
            [
                "grade|make grade|xunit|10|100|10|256|20",
                "grade|make test|xunit|10|100|10|256|20",
            ]
        )


def test_action_specs_from_args_reads_nonempty_noncomment_file(tmp_path: Path) -> None:
    actions_file = tmp_path / "actions"
    actions_file.write_text(
        "# comment\n\nstep|make step|none|10|100|10|256|20\n",
        encoding="utf-8",
    )
    namespace = argparse.Namespace(
        actions=["grade|make grade|xunit|10|100|10|256|20"],
        actions_file=str(actions_file),
    )

    assert _action_specs_from_args(namespace) == [
        "grade|make grade|xunit|10|100|10|256|20",
        "step|make step|none|10|100|10|256|20",
    ]


def test_collect_file_set_reads_recursive_files_and_ignores_git(tmp_path: Path) -> None:
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "new.py").write_bytes(b"new\n")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_bytes(b"ignored\n")

    assert _collect_file_set(tmp_path) == {"tests/new.py": b"new\n"}


def test_collect_file_set_rejects_duplicate_normalized_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "tests"
    path.mkdir()
    (path / "new.py").write_bytes(b"new\n")
    (path / "other.py").write_bytes(b"other\n")

    original = Path.relative_to

    def fake_relative_to(self: Path, other: Path) -> Path:
        if self.name in ("new.py", "other.py"):
            return Path("tests/new.py")
        return original(self, other)

    monkeypatch.setattr(Path, "relative_to", fake_relative_to)
    with pytest.raises(CliError):
        _collect_file_set(tmp_path)


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
        "action set command:",
        "  grind problemtype action set \\",
        "    --problem-type  python3unittest \\",
        "    --container     codegrinder/python:3.12 \\",
        "    --action        'grade|make grade|xunit|10|128|10485760|536870912|32'",
        "",
        "canonical files:",
        "  Makefile",
    ]
