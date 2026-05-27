from __future__ import annotations

import pytest

import cli
import helpers


def test_problem_command_is_registered_for_cached_instructors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "load_config_or_default", lambda: helpers.Config(is_instructor=True))
    parser = cli._build_parser()

    args = parser.parse_args(["problem", "loops"])

    assert args.command == "problem"
    assert args.problem_args == ["loops"]


def test_problem_command_is_hidden_without_cached_author_or_instructor(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "load_config_or_default", lambda: helpers.Config())
    parser = cli._build_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(["problem", "loops"])
