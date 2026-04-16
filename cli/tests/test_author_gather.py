from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from authoring import gather_author
from errors import CliError


def _write_problem_cfg(directory: Path) -> None:
    directory.joinpath("problem.cfg").write_text(
        f"""
[problem]
unique = {directory.name}
note = Example Problem
type = python3unittest
""".strip()
        + "\n",
        encoding="utf-8",
    )


def test_gather_author_uses_standard_layout_and_reports_whitespace(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tmp_path / "example-problem"
    root.mkdir()
    _write_problem_cfg(root)
    root.joinpath("main.py").write_bytes(b"print('hello')  \r\n")
    root.joinpath("README.md").write_text("docs only", encoding="utf-8")
    starter_dir = root / "_starter"
    starter_dir.mkdir()
    starter_dir.joinpath("main.py").write_text("print('starter')\n", encoding="utf-8")

    draft, step_dir, step_num = gather_author(datetime.now(tz=UTC), "", root)

    assert step_dir == root
    assert step_num == 1
    assert draft.problem_id == "example-problem"
    assert len(draft.steps) == 1
    step = draft.steps[0]
    assert {item.path: item.content for item in step.files} == {
        "README.md": b"docs only",
        "main.py": b"print('hello')  \r\n",
    }
    assert {item.path: item.content for item in step.starter_files} == {
        "main.py": b"print('starter')\n",
    }

    output = capsys.readouterr().out
    assert "warning: step 1 file README.md has missing final newline" in output
    assert "warning: step 1 file main.py has non-Unix line endings, trailing spaces" in output


def test_gather_author_rejects_legacy_solution_layout(tmp_path: Path) -> None:
    root = tmp_path / "legacy-problem"
    root.mkdir()
    _write_problem_cfg(root)
    solution_dir = root / "_solution"
    solution_dir.mkdir()
    solution_dir.joinpath("main.py").write_text("print('legacy')\n", encoding="utf-8")
    starter_dir = root / "_starter"
    starter_dir.mkdir()
    starter_dir.joinpath("main.py").write_text("print('starter')\n", encoding="utf-8")

    with pytest.raises(CliError) as err:
        gather_author(datetime.now(tz=UTC), "", root)
    assert "legacy _solution authoring layout is no longer supported" in str(err.value)
