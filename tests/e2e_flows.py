#!/usr/bin/env python3
from __future__ import annotations

import sqlite3
import shutil
from pathlib import Path

from e2e_common import ROOT, RUN_ROOT, USER_ID, WORKSPACE_DIR, require, run, run_expect_failure
from e2e_setup import require_download_status


DB_PATH = RUN_ROOT / "codegrinder.db"


def require_current_step(assignment_dir: Path, problem_id: str, step: int) -> None:
    dotfile = assignment_dir / ".grind"
    require(dotfile.is_file(), f"missing {dotfile}")
    text = dotfile.read_text(encoding="utf-8")
    require(f'problem_id = "{problem_id}"' in text, f"{dotfile} does not reference {problem_id}")
    require(f"step = {step}" in text, f"{dotfile} is not on step {step}")


def require_score(problem_set_id: str, expected: float) -> None:
    with sqlite3.connect(DB_PATH) as db:
        row = db.execute(
            """
            SELECT COALESCE(assignment_score, 0.0)
            FROM assignment_list_fields
            WHERE user_id = ? AND course_id = ? AND problem_set_id = ?
            """,
            (USER_ID, "e2e-course", problem_set_id),
        ).fetchone()
    require(row is not None, f"missing assignment score for {problem_set_id}")
    actual = float(row[0])
    require(
        abs(actual - expected) < 0.000001,
        f"{problem_set_id} score {actual}, expected {expected}",
    )


def recover_deleted_assignment(assignment_dir: Path, env: dict[str, str]) -> None:
    shutil.rmtree(assignment_dir)
    require(not assignment_dir.exists(), f"{assignment_dir} was not deleted")
    run(["grind", "get"], env=env)
    require(assignment_dir.is_dir(), f"{assignment_dir} was not recreated")


def run_array_max_flow(env: dict[str, str]) -> None:
    run(["grind", "list"], env=env)
    run(["grind", "get"], env=env)
    assignment_dir = WORKSPACE_DIR / "array-max"
    require(assignment_dir.is_dir(), f"{assignment_dir} was not downloaded")
    run_expect_failure(["make"], cwd=assignment_dir, env=env)
    run(["grind", "grade"], cwd=assignment_dir, env=env, check=False, expect_code=0)
    require_score("array-max", 0.0)

    (assignment_dir / "array_max.s").unlink()
    run_expect_failure(["grind", "grade"], cwd=assignment_dir, env=env)
    run(["grind", "sync"], cwd=assignment_dir, env=env)
    require((assignment_dir / "array_max.s").is_file(), "sync did not restore array_max.s")

    (assignment_dir / "array_max.s").write_text("broken\n", encoding="utf-8")
    run(["grind", "grade"], cwd=assignment_dir, env=env, check=False, expect_code=0)
    require_score("array-max", 0.0)
    (assignment_dir / "array_max.s").unlink()
    run(["grind", "sync"], cwd=assignment_dir, env=env)
    require(
        (assignment_dir / "array_max.s").read_text(encoding="utf-8") == "broken\n",
        "sync did not restore saved broken work",
    )

    (assignment_dir / "junk.txt").write_text("junk\n", encoding="utf-8")
    (assignment_dir / "junkdir").mkdir(exist_ok=True)
    (assignment_dir / "junkdir" / "junk.txt").write_text("junk\n", encoding="utf-8")
    (assignment_dir / ".git").mkdir(exist_ok=True)
    (assignment_dir / ".git" / "config").write_text("[core]\n", encoding="utf-8")
    run(["grind", "sync"], cwd=assignment_dir, env=env)
    require(not (assignment_dir / "junk.txt").exists(), "sync did not remove junk.txt")
    require(not (assignment_dir / "junkdir").exists(), "sync did not prune junkdir")
    require((assignment_dir / ".git" / "config").is_file(), "sync did not preserve .git/config")

    run(["grind", "solve"], cwd=assignment_dir, env=env)
    run(["make"], cwd=assignment_dir, env=env)
    run(["grind", "grade"], cwd=assignment_dir, env=env)
    require_score("array-max", 1.0)

    solved_array_max = (assignment_dir / "array_max.s").read_text(encoding="utf-8")
    recover_deleted_assignment(assignment_dir, env)
    require_current_step(assignment_dir, "array-max", 1)
    require(
        (assignment_dir / "array_max.s").read_text(encoding="utf-8") == solved_array_max,
        "grind get did not restore array-max after directory deletion",
    )

    from e2e_setup import update_assignment_lock

    update_assignment_lock("array-max", "2020-01-01 00:00:00")
    (assignment_dir / "array_max.s").write_text("broken\n", encoding="utf-8")
    locked_failure = run(["grind", "grade"], cwd=assignment_dir, env=env, check=False, expect_code=0)
    require(
        "grade was not posted to the LMS because the assignment is locked" in locked_failure.stdout,
        "locked grade did not report skipped LMS passback",
    )
    require_score("array-max", 0.0)
    run(["grind", "solve"], cwd=assignment_dir, env=env)
    locked_success = run(["grind", "grade"], cwd=assignment_dir, env=env)
    require(
        "grade was not posted to the LMS because the assignment is locked" in locked_success.stdout,
        "locked passing grade did not report skipped LMS passback",
    )
    require_score("array-max", 1.0)


def run_javascript_hello_flow(env: dict[str, str]) -> None:
    assignment_dir = WORKSPACE_DIR / "javascript-hello"
    require(assignment_dir.is_dir(), f"{assignment_dir} was not downloaded")
    require_current_step(assignment_dir, "javascript-hello", 1)

    run(["grind", "grade"], cwd=assignment_dir, env=env, check=False, expect_code=0)
    require_score("javascript-hello", 0.0)

    run(["grind", "solve"], cwd=assignment_dir, env=env)
    run(["grind", "grade"], cwd=assignment_dir, env=env)
    require_score("javascript-hello", 1.0)


def run_followup_download_checks(env: dict[str, str]) -> None:
    run(["grind", "list"], env=env)
    require_download_status("sudoku", 1)
    run(["grind", "get"], env=env)
    require((WORKSPACE_DIR / "array-max" / ".grind").is_file(), "array-max was disturbed")
    require((WORKSPACE_DIR / "huff" / ".grind").is_file(), "huff was not downloaded")
    require((WORKSPACE_DIR / "sudoku-1" / ".grind").is_file(), "sudoku-1 was not downloaded")
    require(not (WORKSPACE_DIR / "sudoku").exists(), "future-locked sudoku downloaded early")
    require(not (WORKSPACE_DIR / "sudoku-2").exists(), "sudoku-2 downloaded before prerequisite")
    require(not (WORKSPACE_DIR / "sudoku-3").exists(), "sudoku-3 downloaded before prerequisite")
    (WORKSPACE_DIR / "huff" / "get-marker.txt").write_text("preserved\n", encoding="utf-8")
    run(["grind", "get"], env=env)
    require(
        (WORKSPACE_DIR / "huff" / "get-marker.txt").is_file(),
        "grind get rewrote an existing valid assignment directory",
    )


def run_huff_flow(env: dict[str, str]) -> None:
    assignment_dir = WORKSPACE_DIR / "huff"
    for step, filename in [
        (1, "tree.c"),
        (2, "code_table.c"),
        (3, "bitstream.c"),
        (4, "encode.c"),
        (5, "decode.c"),
    ]:
        require_current_step(assignment_dir, "huff", step)
        if step == 1:
            run_expect_failure(["grind", "action", "grade"], cwd=assignment_dir, env=env)
            run_expect_failure(["grind", "action", "not-an-action"], cwd=assignment_dir, env=env)
            run_expect_failure(["grind", "reset", "not-a-student-file.c"], cwd=assignment_dir, env=env)
        run(["grind", "action", "step"], cwd=assignment_dir, env=env, check=False)
        path = assignment_dir / filename
        original = path.read_bytes()
        path.write_bytes(original + b"\n")
        if step == 1:
            run(["grind", "reset"], cwd=assignment_dir, env=env)
            require(path.read_bytes() != original, "reset without file unexpectedly overwrote modified work")
        run(["grind", "reset", filename], cwd=assignment_dir, env=env)
        require(path.read_bytes() == original, f"reset did not restore {filename}")
        path.write_text("broken\n", encoding="utf-8")
        run(["grind", "sync"], cwd=assignment_dir, env=env)
        require(path.read_text(encoding="utf-8") == "broken\n", f"sync did not persist {filename}")
        run(["grind", "solve"], cwd=assignment_dir, env=env)
        if step == 1:
            run(["grind", "sync"], cwd=assignment_dir / "doc", env=env)
        run(["grind", "grade"], cwd=assignment_dir, env=env)
        require_score("huff", step / 5.0)
        if step == 2:
            dotfile = assignment_dir / ".grind"
            original_dotfile = dotfile.read_text(encoding="utf-8")
            dotfile.write_text(original_dotfile.replace("step = 3", "step = 1"), encoding="utf-8")
            try:
                run_expect_failure(["grind", "sync"], cwd=assignment_dir, env=env)
                run_expect_failure(["grind", "grade"], cwd=assignment_dir, env=env)
                require_score("huff", 2.0 / 5.0)
            finally:
                dotfile.write_text(original_dotfile, encoding="utf-8")
            recover_deleted_assignment(assignment_dir, env)
            require_current_step(assignment_dir, "huff", 3)
            require(
                (assignment_dir / "bitstream.c").is_file(),
                "grind get did not restore huff after directory deletion",
            )
    run(["grind", "list"], env=env)
    run(["grind", "get"], env=env)


def run_sudoku_flow(env: dict[str, str]) -> None:
    sudoku1 = WORKSPACE_DIR / "sudoku-1"
    sudoku2 = WORKSPACE_DIR / "sudoku-2"
    sudoku3 = WORKSPACE_DIR / "sudoku-3"

    require_current_step(sudoku1, "sudoku", 1)
    run(["grind", "solve"], cwd=sudoku1, env=env)
    run(["make"], cwd=sudoku1, env=env)
    run(["grind", "grade"], cwd=sudoku1, env=env)
    require_current_step(sudoku1, "sudoku", 2)
    run(["grind", "get"], env=env)
    require(not sudoku2.exists(), "sudoku-2 downloaded before sudoku-1 completed")

    run(["grind", "solve"], cwd=sudoku1, env=env)
    run(["make"], cwd=sudoku1, env=env)
    run(["grind", "grade"], cwd=sudoku1, env=env)
    require_score("sudoku-1", 1.0)
    run(["grind", "get"], env=env)
    require(sudoku2.is_dir(), "sudoku-2 did not download after sudoku-1 completed")
    require(not sudoku3.exists(), "sudoku-3 downloaded before sudoku-2 completed")

    require_current_step(sudoku2, "sudoku", 3)
    sudoku_file = sudoku2 / "pencil_marks.s"
    original = sudoku_file.read_bytes()
    sudoku_file.write_bytes(original + b"\n")
    run(["grind", "reset", "pencil_marks.s"], cwd=sudoku2, env=env)
    require(sudoku_file.read_bytes() == original, "sudoku reset failed")
    run(["grind", "solve"], cwd=sudoku2, env=env)
    run(["make"], cwd=sudoku2, env=env)
    run(["grind", "grade"], cwd=sudoku2, env=env)
    require_score("sudoku-2", 1.0)
    run(["grind", "get"], env=env)
    require(sudoku3.is_dir(), "sudoku-3 did not download after sudoku-2 completed")

    recover_deleted_assignment(sudoku2, env)
    require_current_step(sudoku2, "sudoku", 3)
    require(
        (sudoku2 / "pencil_marks.s").is_file(),
        "grind get did not restore sudoku-2 after directory deletion",
    )
    require(sudoku3.is_dir(), "sudoku-3 was disturbed while recovering sudoku-2")

    require_current_step(sudoku3, "sudoku", 4)
    run(["grind", "solve"], cwd=sudoku3, env=env)
    run(["make"], cwd=sudoku3, env=env)
    run(["grind", "grade"], cwd=sudoku3, env=env)
    require_score("sudoku-3", 1.0)
