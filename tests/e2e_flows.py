#!/usr/bin/env python3
from __future__ import annotations

import sqlite3
import shutil
from pathlib import Path

from e2e_common import (
    ROOT,
    RUN_ROOT,
    USER_ID,
    WORKSPACE_DIR,
    require,
    run,
    run_expect_failure,
)
from e2e_setup import require_download_status


DB_PATH = RUN_ROOT / "codegrinder.db"


def require_current_step(assignment_dir: Path, problem_id: str, step: int) -> None:
    dotfile = assignment_dir / ".grind"
    require(dotfile.is_file(), f"missing {dotfile}")
    text = dotfile.read_text(encoding="utf-8")
    require(
        f'problem_id = "{problem_id}"' in text,
        f"{dotfile} does not reference {problem_id}",
    )
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


def run_riscv_single_flow(env: dict[str, str]) -> None:
    run(["grind", "list"], env=env)
    run(["grind", "get"], env=env)
    assignment_dir = WORKSPACE_DIR / "fixture-riscv-single"
    require(assignment_dir.is_dir(), f"{assignment_dir} was not downloaded")
    run_expect_failure(["make"], cwd=assignment_dir, env=env)
    run(["grind", "grade"], cwd=assignment_dir, env=env, check=False, expect_code=0)
    require_score("fixture-riscv-single", 0.0)

    (assignment_dir / "fixture_single.s").unlink()
    run_expect_failure(["grind", "grade"], cwd=assignment_dir, env=env)
    run(["grind", "sync"], cwd=assignment_dir, env=env)
    require(
        (assignment_dir / "fixture_single.s").is_file(),
        "sync did not restore fixture_single.s",
    )

    (assignment_dir / "fixture_single.s").write_text("broken\n", encoding="utf-8")
    run(["grind", "grade"], cwd=assignment_dir, env=env, check=False, expect_code=0)
    require_score("fixture-riscv-single", 0.0)
    (assignment_dir / "fixture_single.s").unlink()
    run(["grind", "sync"], cwd=assignment_dir, env=env)
    require(
        (assignment_dir / "fixture_single.s").read_text(encoding="utf-8") == "broken\n",
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
    require(
        (assignment_dir / ".git" / "config").is_file(),
        "sync did not preserve .git/config",
    )

    run(["grind", "solve"], cwd=assignment_dir, env=env)
    run(["make"], cwd=assignment_dir, env=env)
    run(["grind", "grade"], cwd=assignment_dir, env=env)
    require_score("fixture-riscv-single", 1.0)

    solved_fixture = (assignment_dir / "fixture_single.s").read_text(encoding="utf-8")
    recover_deleted_assignment(assignment_dir, env)
    require_current_step(assignment_dir, "fixture-riscv-single", 1)
    require(
        (assignment_dir / "fixture_single.s").read_text(encoding="utf-8")
        == solved_fixture,
        "grind get did not restore fixture-riscv-single after directory deletion",
    )

    from e2e_setup import update_assignment_lock

    update_assignment_lock("fixture-riscv-single", "2020-01-01 00:00:00")
    (assignment_dir / "fixture_single.s").write_text("broken\n", encoding="utf-8")
    locked_failure = run(
        ["grind", "grade"], cwd=assignment_dir, env=env, check=False, expect_code=0
    )
    require(
        "grade was not posted to the LMS because the assignment is locked"
        in locked_failure.stdout,
        "locked grade did not report skipped LMS passback",
    )
    require_score("fixture-riscv-single", 0.0)
    run(["grind", "solve"], cwd=assignment_dir, env=env)
    locked_success = run(["grind", "grade"], cwd=assignment_dir, env=env)
    require(
        "grade was not posted to the LMS because the assignment is locked"
        in locked_success.stdout,
        "locked passing grade did not report skipped LMS passback",
    )
    require_score("fixture-riscv-single", 1.0)


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
    require_download_status("fixture-riscv-slices", 1)
    run(["grind", "get"], env=env)
    require(
        (WORKSPACE_DIR / "fixture-riscv-single" / ".grind").is_file(),
        "fixture-riscv-single was disturbed",
    )
    require(
        (WORKSPACE_DIR / "fixture-c-steps" / ".grind").is_file(),
        "fixture-c-steps was not downloaded",
    )
    require(
        (WORKSPACE_DIR / "fixture-riscv-slices-1" / ".grind").is_file(),
        "fixture-riscv-slices-1 was not downloaded",
    )
    require(
        not (WORKSPACE_DIR / "fixture-riscv-slices").exists(),
        "future-locked fixture-riscv-slices downloaded early",
    )
    require(
        not (WORKSPACE_DIR / "fixture-riscv-slices-2").exists(),
        "fixture-riscv-slices-2 downloaded before prerequisite",
    )
    require(
        not (WORKSPACE_DIR / "fixture-riscv-slices-3").exists(),
        "fixture-riscv-slices-3 downloaded before prerequisite",
    )
    (WORKSPACE_DIR / "fixture-c-steps" / "get-marker.txt").write_text(
        "preserved\n", encoding="utf-8"
    )
    run(["grind", "get"], env=env)
    require(
        (WORKSPACE_DIR / "fixture-c-steps" / "get-marker.txt").is_file(),
        "grind get rewrote an existing valid assignment directory",
    )


def run_c_steps_flow(env: dict[str, str]) -> None:
    assignment_dir = WORKSPACE_DIR / "fixture-c-steps"
    for step, filename in [
        (1, "fixture_one.c"),
        (2, "fixture_two.c"),
        (3, "fixture_three.c"),
        (4, "fixture_four.c"),
        (5, "fixture_five.c"),
    ]:
        require_current_step(assignment_dir, "fixture-c-steps", step)
        if step == 1:
            run_expect_failure(
                ["grind", "action", "grade"], cwd=assignment_dir, env=env
            )
            run_expect_failure(
                ["grind", "action", "not-an-action"], cwd=assignment_dir, env=env
            )
            run_expect_failure(
                ["grind", "reset", "not-a-student-file.c"], cwd=assignment_dir, env=env
            )
        run(["grind", "action", "step"], cwd=assignment_dir, env=env, check=False)
        path = assignment_dir / filename
        original = path.read_bytes()
        path.write_bytes(original + b"\n")
        if step == 1:
            run(["grind", "reset"], cwd=assignment_dir, env=env)
            require(
                path.read_bytes() != original,
                "reset without file unexpectedly overwrote modified work",
            )
        run(["grind", "reset", filename], cwd=assignment_dir, env=env)
        require(path.read_bytes() == original, f"reset did not restore {filename}")
        path.write_text("broken\n", encoding="utf-8")
        run(["grind", "sync"], cwd=assignment_dir, env=env)
        require(
            path.read_text(encoding="utf-8") == "broken\n",
            f"sync did not persist {filename}",
        )
        run(["grind", "solve"], cwd=assignment_dir, env=env)
        if step == 1:
            run(["grind", "sync"], cwd=assignment_dir / "doc", env=env)
        run(["grind", "grade"], cwd=assignment_dir, env=env)
        require_score("fixture-c-steps", step / 5.0)
        if step == 2:
            dotfile = assignment_dir / ".grind"
            original_dotfile = dotfile.read_text(encoding="utf-8")
            dotfile.write_text(
                original_dotfile.replace("step = 3", "step = 1"), encoding="utf-8"
            )
            try:
                run_expect_failure(["grind", "sync"], cwd=assignment_dir, env=env)
                run_expect_failure(["grind", "grade"], cwd=assignment_dir, env=env)
                require_score("fixture-c-steps", 2.0 / 5.0)
            finally:
                dotfile.write_text(original_dotfile, encoding="utf-8")
            recover_deleted_assignment(assignment_dir, env)
            require_current_step(assignment_dir, "fixture-c-steps", 3)
            require(
                (assignment_dir / "fixture_three.c").is_file(),
                "grind get did not restore fixture-c-steps after directory deletion",
            )
    run(["grind", "list"], env=env)
    run(["grind", "get"], env=env)


def run_riscv_slices_flow(env: dict[str, str]) -> None:
    slice1 = WORKSPACE_DIR / "fixture-riscv-slices-1"
    slice2 = WORKSPACE_DIR / "fixture-riscv-slices-2"
    slice3 = WORKSPACE_DIR / "fixture-riscv-slices-3"

    require_current_step(slice1, "fixture-riscv-slices", 1)
    run(["grind", "solve"], cwd=slice1, env=env)
    run(["make"], cwd=slice1, env=env)
    run(["grind", "grade"], cwd=slice1, env=env)
    require_current_step(slice1, "fixture-riscv-slices", 2)
    run(["grind", "get"], env=env)
    require(
        not slice2.exists(),
        "fixture-riscv-slices-2 downloaded before slice 1 completed",
    )

    run(["grind", "solve"], cwd=slice1, env=env)
    run(["make"], cwd=slice1, env=env)
    run(["grind", "grade"], cwd=slice1, env=env)
    require_score("fixture-riscv-slices-1", 1.0)
    run(["grind", "get"], env=env)
    require(
        slice2.is_dir(),
        "fixture-riscv-slices-2 did not download after slice 1 completed",
    )
    require(
        not slice3.exists(),
        "fixture-riscv-slices-3 downloaded before slice 2 completed",
    )

    require_current_step(slice2, "fixture-riscv-slices", 3)
    value_file = slice2 / "value.s"
    original = value_file.read_bytes()
    value_file.write_bytes(original + b"\n")
    run(["grind", "reset", "value.s"], cwd=slice2, env=env)
    require(value_file.read_bytes() == original, "sliced fixture reset failed")
    run(["grind", "solve"], cwd=slice2, env=env)
    run(["make"], cwd=slice2, env=env)
    run(["grind", "grade"], cwd=slice2, env=env)
    require_score("fixture-riscv-slices-2", 1.0)
    run(["grind", "get"], env=env)
    require(
        slice3.is_dir(),
        "fixture-riscv-slices-3 did not download after slice 2 completed",
    )

    recover_deleted_assignment(slice2, env)
    require_current_step(slice2, "fixture-riscv-slices", 3)
    require(
        (slice2 / "value.s").is_file(),
        "grind get did not restore fixture-riscv-slices-2 after directory deletion",
    )
    require(
        slice3.is_dir(), "fixture-riscv-slices-3 was disturbed while recovering slice 2"
    )

    require_current_step(slice3, "fixture-riscv-slices", 4)
    run(["grind", "solve"], cwd=slice3, env=env)
    run(["make"], cwd=slice3, env=env)
    run(["grind", "grade"], cwd=slice3, env=env)
    require_score("fixture-riscv-slices-3", 1.0)
