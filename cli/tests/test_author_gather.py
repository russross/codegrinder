from __future__ import annotations

from pathlib import Path

import codegrinder_pb2 as pb
import pytest

from authoring import gather_author, prepare_author_steps, resolve_author_problem_layout
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

    draft, step_dir, step_num = gather_author("", root)

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


def test_gather_author_rejects_solution_layout_directory(tmp_path: Path) -> None:
    root = tmp_path / "unsupported-solution-layout"
    root.mkdir()
    _write_problem_cfg(root)
    solution_dir = root / "_solution"
    solution_dir.mkdir()
    solution_dir.joinpath("main.py").write_text("print('unsupported')\n", encoding="utf-8")
    starter_dir = root / "_starter"
    starter_dir.mkdir()
    starter_dir.joinpath("main.py").write_text("print('starter')\n", encoding="utf-8")

    with pytest.raises(CliError) as err:
        gather_author("", root)
    assert "the _solution authoring layout is not supported" in str(err.value)


class _FakeProblemTypeClient:
    def get_problem_type(self, problem_type: str) -> pb.GetProblemTypeResponse:
        return pb.GetProblemTypeResponse(
            problem_type=pb.ProblemType(
                problem_type=problem_type,
                files={"type_support.txt": b"canonical support\n"},
            )
        )


def test_prepare_and_gather_author_prefilters_git_gitignore_and_problem_type_files(tmp_path: Path) -> None:
    root = tmp_path / "filtered-problem"
    root.mkdir()
    _write_problem_cfg(root)
    root.joinpath("main.py").write_text("print('hello')\n", encoding="utf-8")
    root.joinpath(".gitignore").write_text("ignored.tmp\nignored_dir/\n", encoding="utf-8")
    root.joinpath("ignored.tmp").write_text("ignore me\n", encoding="utf-8")
    (root / "ignored_dir").mkdir()
    root.joinpath("ignored_dir", "hidden.txt").write_text("hidden\n", encoding="utf-8")
    (root / ".git").mkdir()
    root.joinpath(".git", "config").write_text("[core]\n", encoding="utf-8")
    root.joinpath("type_support.txt").write_text("stale\n", encoding="utf-8")
    root.joinpath("build.out").write_text("artifact\n", encoding="utf-8")
    root.joinpath("Makefile").write_text("clean:\n\trm -f build.out\n", encoding="utf-8")

    layout = resolve_author_problem_layout(root)
    assert layout is not None

    prepared_steps = prepare_author_steps(_FakeProblemTypeClient(), layout)
    assert root.joinpath("type_support.txt").read_text(encoding="utf-8") == "canonical support\n"
    assert not root.joinpath("build.out").exists()

    draft, _, _ = gather_author("", root, prepared_steps)

    assert {item.path: item.content for item in draft.steps[0].files} == {
        ".gitignore": b"ignored.tmp\nignored_dir/\n",
        "Makefile": b"clean:\n\trm -f build.out\n",
        "main.py": b"print('hello')\n",
    }
