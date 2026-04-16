from __future__ import annotations

from pathlib import Path

import pytest

from cli import parse_problem_cfg, parse_problem_set_cfg
from errors import CliError


def test_parse_problem_cfg_step_types_override_global(tmp_path: Path) -> None:
    cfg = tmp_path / "problem.cfg"
    cfg.write_text(
        """
[problem]
unique = loops-1
note = Loops practice

[step \"1\"]
note = First step
type = python3unittest
weight = 0.5

[step \"2\"]
note = Second step
type = python3unittest
""".strip()
        + "\n",
        encoding="utf-8",
    )

    parsed = parse_problem_cfg(cfg)
    assert parsed.problem_id == "loops-1"
    assert len(parsed.steps) == 2
    assert parsed.steps[0].weight == 0.5
    assert parsed.steps[1].problem_type == "python3unittest"


def test_parse_problem_cfg_rejects_mixed_type_specification(tmp_path: Path) -> None:
    cfg = tmp_path / "problem.cfg"
    cfg.write_text(
        """
[problem]
unique = loops-2
note = Mixed type
type = python3unittest

[step \"1\"]
note = First
type = cppunittest
""".strip()
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(CliError) as err:
        parse_problem_cfg(cfg)
    assert "problem type must be specified" in str(err.value)


def test_parse_problem_set_cfg_reads_problem_weights(tmp_path: Path) -> None:
    cfg = tmp_path / "set.cfg"
    cfg.write_text(
        """
[problemset]
unique = cs1400-ps1
note = Intro set
tag = intro

[problem \"p-one\"]
weight = 2.5

[problem \"p-two\"]
""".strip()
        + "\n",
        encoding="utf-8",
    )

    parsed = parse_problem_set_cfg(cfg)
    assert parsed.problem_set_id == "cs1400-ps1"
    assert parsed.problems["p-one"] == 2.5
    assert parsed.problems["p-two"] == 1.0
