from __future__ import annotations

from pathlib import Path

import pytest

from author_config import parse_author_problem_config, parse_author_problem_set_config
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

    parsed = parse_author_problem_config(cfg)
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
        parse_author_problem_config(cfg)
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

    parsed = parse_author_problem_set_config(cfg)
    assert parsed.problem_set_id == "cs1400-ps1"
    assert [(problem.problem_id, problem.weight) for problem in parsed.problems] == [("p-one", 2.5), ("p-two", 1.0)]


def test_parse_problem_set_cfg_reads_slice_continuation(tmp_path: Path) -> None:
    cfg = tmp_path / "set.cfg"
    cfg.write_text(
        """
[problemset]
unique = loops-part-2
note = Loops part 2
continues = loops-part-1

[problem \"loops\"]
steps = 3-5
""".strip()
        + "\n",
        encoding="utf-8",
    )

    parsed = parse_author_problem_set_config(cfg)
    assert parsed.continues_problem_set_id == "loops-part-1"
    assert len(parsed.problems) == 1
    assert parsed.problems[0].problem_id == "loops"
    assert parsed.problems[0].first_step == 3
    assert parsed.problems[0].last_step == 5
