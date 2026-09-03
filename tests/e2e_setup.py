#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from e2e_common import (
    ARTIFACT_DIR,
    C_STEPS_ID,
    CONFIG_PATH,
    COURSE_ID,
    COURSE_NAME,
    DB_PATH,
    LIVE_CONFIG,
    RISC_SINGLE_ID,
    RISC_SLICES_ID,
    ROOT,
    RUN_MARKER,
    RUN_ROOT,
    SESSION_KEY,
    SMOKE_PROBLEMS,
    TEST_PREFIX,
    USER_ID,
    CommandResult,
    require,
    run,
    run_expect_failure,
    server_endpoint,
    session_key_hash,
)

TESTS_DIR = ROOT / "tests"
PRODUCTION_PROBLEM_TYPES = ("cinout", "riscv") + tuple(
    smoke.problem_type for smoke in SMOKE_PROBLEMS
)
REQUIRED_SCHEMA_OBJECTS = {
    "accessible_assignment_fields",
    "assignment_list_fields",
    "assignments",
    "authors",
    "commits",
    "courses",
    "problem_set_problems",
    "problem_sets",
    "problem_steps",
    "problem_type_actions",
    "problem_type_files",
    "problem_types",
    "problems",
    "user_courses",
    "user_sessions",
    "users",
}


@contextmanager
def database() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    try:
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("PRAGMA foreign_keys = ON")
        yield connection
    finally:
        connection.close()


def validate_prerequisites(env: dict[str, str]) -> None:
    if shutil.which("grind", path=env.get("PATH")) is None:
        raise RuntimeError("deployed grind executable is not present on PATH")
    if not DB_PATH.is_file():
        raise RuntimeError(f"configured live database does not exist: {DB_PATH}")

    validate_schema()
    required_images = load_production_problem_type_images()
    run([LIVE_CONFIG.container_engine, "info"], env=env)
    missing_images = [
        image for image in required_images if not image_is_present(image, env)
    ]
    if missing_images:
        joined = ", ".join(missing_images)
        raise RuntimeError(
            f"required Docker image(s) are missing: {joined}; build them before running tests/e2e.py"
        )
    if not public_version_is_reachable():
        raise RuntimeError(f"deployed server is not reachable at {server_endpoint()}")


def image_is_present(image: str, env: dict[str, str]) -> bool:
    result = subprocess.run(
        [LIVE_CONFIG.container_engine, "image", "inspect", image],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=False,
    )
    return result.returncode == 0


def validate_schema() -> None:
    with database() as db:
        rows = db.execute(
            "SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')"
        ).fetchall()
    found = {str(row[0]) for row in rows}
    missing = sorted(REQUIRED_SCHEMA_OBJECTS - found)
    if missing:
        raise RuntimeError(
            f"configured live database is missing required schema objects: {', '.join(missing)}"
        )


def load_production_problem_type_images() -> tuple[str, ...]:
    placeholders = ", ".join("?" for _ in PRODUCTION_PROBLEM_TYPES)
    with database() as db:
        rows = db.execute(
            f"SELECT problem_type, container FROM problem_types "
            f"WHERE problem_type IN ({placeholders})",
            PRODUCTION_PROBLEM_TYPES,
        ).fetchall()
    found = {str(row[0]) for row in rows}
    missing = sorted(set(PRODUCTION_PROBLEM_TYPES) - found)
    if missing:
        raise RuntimeError(
            f"live database is missing required production problem types: {', '.join(missing)}"
        )
    return tuple(sorted({str(row[1]) for row in rows}))


def public_version_is_reachable() -> bool:
    request = urllib.request.Request(f"{server_endpoint()}/version")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def prepare_clean_start(env: dict[str, str]) -> None:
    if RUN_ROOT.exists() and not RUN_MARKER.is_file():
        raise RuntimeError(
            f"refusing to remove unmarked e2e run directory {RUN_ROOT}; "
            f"remove it manually or choose a different CODEGRINDER_E2E_RUN_ROOT"
        )
    shutil.rmtree(RUN_ROOT, ignore_errors=True)
    RUN_ROOT.mkdir(parents=True)
    RUN_MARKER.write_text("CodeGrinder e2e scratch directory\n", encoding="utf-8")
    remove_test_container(env)


def remove_test_container(env: dict[str, str]) -> None:
    subprocess.run(
        [LIVE_CONFIG.container_engine, "rm", "-f", f"nanny-{USER_ID}"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=False,
    )


def cleanup_success_artifacts() -> None:
    if not RUN_MARKER.is_file():
        raise RuntimeError(f"refusing to remove unmarked e2e run directory {RUN_ROOT}")
    shutil.rmtree(RUN_ROOT, ignore_errors=True)


def purge_test_data() -> None:
    with database() as db:
        assert_test_namespace_is_isolated(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            pattern = f"{TEST_PREFIX}*"
            db.execute("DELETE FROM users WHERE user_id GLOB ?", (pattern,))
            db.execute("DELETE FROM courses WHERE course_id GLOB ?", (pattern,))
            db.execute(
                "UPDATE problem_sets SET continues_problem_set_id = NULL "
                "WHERE problem_set_id GLOB ?",
                (pattern,),
            )
            db.execute(
                "DELETE FROM problem_sets WHERE problem_set_id GLOB ?", (pattern,)
            )
            db.execute("DELETE FROM problems WHERE problem_id GLOB ?", (pattern,))
            db.execute(
                "DELETE FROM problem_types WHERE problem_type GLOB ?", (pattern,)
            )
            db.commit()
        except BaseException:
            db.rollback()
            raise
        remaining = sum(
            int(
                db.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE {column} GLOB ?",
                    (pattern,),
                ).fetchone()[0]
            )
            for table, column in (
                ("users", "user_id"),
                ("courses", "course_id"),
                ("problem_sets", "problem_set_id"),
                ("problems", "problem_id"),
                ("problem_types", "problem_type"),
            )
        )
        require(remaining == 0, "test-prefixed database data remains after purge")


def assert_test_namespace_is_isolated(db: sqlite3.Connection) -> None:
    pattern = f"{TEST_PREFIX}*"
    checks = (
        (
            "SELECT 1 FROM assignments WHERE problem_set_id GLOB ? AND user_id NOT GLOB ? LIMIT 1",
            "a non-test user has an assignment for a test problem set",
        ),
        (
            "SELECT 1 FROM problem_set_problems WHERE problem_id GLOB ? AND problem_set_id NOT GLOB ? LIMIT 1",
            "a non-test problem set contains a test problem",
        ),
        (
            "SELECT 1 FROM problem_sets WHERE continues_problem_set_id GLOB ? AND problem_set_id NOT GLOB ? LIMIT 1",
            "a non-test problem set continues a test problem set",
        ),
        (
            "SELECT 1 FROM problem_steps WHERE problem_type GLOB ? AND problem_id NOT GLOB ? LIMIT 1",
            "a non-test problem uses a test problem type",
        ),
        (
            "SELECT 1 FROM user_courses WHERE course_id GLOB ? AND user_id NOT GLOB ? LIMIT 1",
            "a non-test user belongs to a test course",
        ),
    )
    for query, message in checks:
        if db.execute(query, (pattern, pattern)).fetchone() is not None:
            raise RuntimeError(f"refusing to purge test data: {message}")


def write_grind_config() -> None:
    CONFIG_PATH.unlink(missing_ok=True)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        "\n".join(
            [
                f'host = "{server_endpoint()}"',
                f'session_key = "{SESSION_KEY}"',
                f'workspace_root = "{RUN_ROOT}"',
                "is_author = true",
                "is_instructor = true",
                "is_admin = true",
                "",
            ]
        ),
        encoding="utf-8",
    )


def seed_user_session() -> None:
    now = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
    expires = "2099-01-01 00:00:00"
    session_hash = session_key_hash(SESSION_KEY, LIVE_CONFIG.session_secret)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute(
                "INSERT INTO users(user_id, user_name, user_login, admin) VALUES(?, ?, ?, 1)",
                (USER_ID, "Test User", "test-user@example.invalid"),
            )
            db.execute("INSERT INTO authors(user_id) VALUES(?)", (USER_ID,))
            db.execute(
                "INSERT INTO courses(course_id, course_name) VALUES(?, ?)",
                (COURSE_ID, COURSE_NAME),
            )
            db.execute(
                "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES(?, ?, ?)",
                (USER_ID, COURSE_ID, "Learner,Instructor"),
            )
            db.execute(
                """
                INSERT INTO user_sessions(
                    session_key_hash, user_id, session_created_at,
                    session_expires_at, session_last_used_at
                ) VALUES(?, ?, ?, ?, ?)
                """,
                (session_hash, USER_ID, now, expires, now),
            )
            db.commit()
        except BaseException:
            db.rollback()
            raise


def wait_for_grind(env: dict[str, str]) -> None:
    deadline = time.monotonic() + 15
    last: CommandResult | None = None
    while time.monotonic() < deadline:
        last = run(["grind", "list"], env=env, check=False)
        if last.returncode == 0 or "no assignments found" in last.stderr:
            return
        time.sleep(0.5)
    detail = last.stderr if last is not None else "no response"
    raise RuntimeError(
        f"deployed grind could not authenticate to {server_endpoint()}: {detail}"
    )


def install_test_problem_types(env: dict[str, str]) -> None:
    staged_root = stage_test_problem_types()
    run(
        [
            str(staged_root / "bin" / "sync-actions"),
            *(f"{TEST_PREFIX}{name}" for name in PRODUCTION_PROBLEM_TYPES),
        ],
        env=env,
    )
    run(
        [
            str(staged_root / "bin" / "sync-files"),
            *(f"{TEST_PREFIX}{name}" for name in PRODUCTION_PROBLEM_TYPES),
        ],
        env=env,
    )
    require_test_problem_types_match_production()
    run(["grind", "problemtype", "list"], env=env)


def stage_test_problem_types() -> Path:
    source_root = ROOT / "problemtypes"
    staged_root = ARTIFACT_DIR / "problemtypes"
    shutil.copytree(source_root / "bin", staged_root / "bin")
    shutil.copytree(source_root / "common", staged_root / "common", symlinks=True)
    for production_name in PRODUCTION_PROBLEM_TYPES:
        test_name = f"{TEST_PREFIX}{production_name}"
        shutil.copytree(
            source_root / "types" / production_name,
            staged_root / "types" / test_name,
            symlinks=True,
        )
    return staged_root


def require_test_problem_types_match_production() -> None:
    with database() as db:
        for production_name in PRODUCTION_PROBLEM_TYPES:
            test_name = f"{TEST_PREFIX}{production_name}"
            production_type = db.execute(
                "SELECT container FROM problem_types WHERE problem_type = ?",
                (production_name,),
            ).fetchone()
            test_type = db.execute(
                "SELECT container FROM problem_types WHERE problem_type = ?",
                (test_name,),
            ).fetchone()
            require(
                test_type == production_type,
                f"installed problem type {test_name} does not match {production_name}",
            )
            production_actions = db.execute(
                "SELECT action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads "
                "FROM problem_type_actions WHERE problem_type = ? ORDER BY action",
                (production_name,),
            ).fetchall()
            test_actions = db.execute(
                "SELECT action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads "
                "FROM problem_type_actions WHERE problem_type = ? ORDER BY action",
                (test_name,),
            ).fetchall()
            require(
                test_actions == production_actions,
                f"installed actions for {test_name} do not match {production_name}",
            )
            production_files = db.execute(
                "SELECT path, content FROM problem_type_files WHERE problem_type = ? ORDER BY path",
                (production_name,),
            ).fetchall()
            test_files = db.execute(
                "SELECT path, content FROM problem_type_files WHERE problem_type = ? ORDER BY path",
                (test_name,),
            ).fetchall()
            require(
                test_files == production_files,
                f"installed files for {test_name} do not match {production_name}",
            )


def run_problem_type_command_checks(env: dict[str, str]) -> None:
    type_list = run(["grind", "type", "--list"], env=env).stdout
    for production_name in PRODUCTION_PROBLEM_TYPES:
        test_name = f"{TEST_PREFIX}{production_name}"
        require(test_name in type_list, f"grind type --list did not show {test_name}")

    type_dir = ARTIFACT_DIR / "type-test-riscv"
    type_dir.mkdir(parents=True, exist_ok=False)
    run(["grind", "type", "test-riscv"], cwd=type_dir, env=env)
    require(
        (type_dir / "Makefile").is_file(),
        "grind type test-riscv did not write Makefile",
    )
    require(
        (type_dir / "print.s").is_file(),
        "grind type test-riscv did not write print.s",
    )


def create_problem_sources(env: dict[str, str]) -> None:
    staged_sources = stage_test_problem_sources()
    problem_ids = (RISC_SINGLE_ID, RISC_SLICES_ID, C_STEPS_ID) + tuple(
        smoke.problem_id for smoke in SMOKE_PROBLEMS
    )
    for problem_id in problem_ids:
        run(["grind", "create"], cwd=staged_sources / problem_id, env=env, timeout=1800)
    run(["grind", "problem", TEST_PREFIX], env=env)


def stage_test_problem_sources() -> Path:
    staged_sources = ARTIFACT_DIR / "problem-sources"
    source_names = {
        RISC_SINGLE_ID: "fixture-riscv-single",
        RISC_SLICES_ID: "fixture-riscv-slices",
        C_STEPS_ID: "fixture-c-steps",
    }
    source_names.update(
        {smoke.problem_id: smoke.source_directory for smoke in SMOKE_PROBLEMS}
    )
    for problem_id, source_name in source_names.items():
        shutil.copytree(TESTS_DIR / source_name, staged_sources / problem_id)
    return staged_sources


def create_riscv_slices(env: dict[str, str]) -> None:
    problem_sets = {
        f"{RISC_SLICES_ID}-1.cfg": f"""
[problemset]
unique = {RISC_SLICES_ID}-1
note = Test end-to-end RISC-V slice 1
tag = test-e2e
tag = riscv

[problem "{RISC_SLICES_ID}"]
steps = 1-2
""",
        f"{RISC_SLICES_ID}-2.cfg": f"""
[problemset]
unique = {RISC_SLICES_ID}-2
note = Test end-to-end RISC-V slice 2
tag = test-e2e
tag = riscv
continues = {RISC_SLICES_ID}-1

[problem "{RISC_SLICES_ID}"]
steps = 3-3
""",
        f"{RISC_SLICES_ID}-3.cfg": f"""
[problemset]
unique = {RISC_SLICES_ID}-3
note = Test end-to-end RISC-V slice 3
tag = test-e2e
tag = riscv
continues = {RISC_SLICES_ID}-2

[problem "{RISC_SLICES_ID}"]
steps = 4-4
""",
    }
    problem_set_dir = ARTIFACT_DIR / "psets"
    problem_set_dir.mkdir(parents=True, exist_ok=False)
    for filename, content in problem_sets.items():
        path = problem_set_dir / filename
        path.write_text(content.strip() + "\n", encoding="utf-8")
        run(["grind", "create", str(path)], env=env)


def run_author_catalog_checks(env: dict[str, str]) -> None:
    run_expect_failure(["grind", "problem", "test-definitely-not-a-problem"], env=env)
    first_slice = ARTIFACT_DIR / "psets" / f"{RISC_SLICES_ID}-1.cfg"
    run_expect_failure(["grind", "create", str(first_slice)], env=env)

    invalid = ARTIFACT_DIR / "psets" / f"{RISC_SLICES_ID}-bad-gap.cfg"
    invalid.write_text(
        f"""
[problemset]
unique = {RISC_SLICES_ID}-bad-gap
note = Test end-to-end invalid slice gap
tag = test-e2e
tag = riscv
continues = {RISC_SLICES_ID}-1

[problem "{RISC_SLICES_ID}"]
steps = 4-4
""".strip()
        + "\n",
        encoding="utf-8",
    )
    run_expect_failure(["grind", "create", str(invalid)], env=env)


def list_problem_catalog(env: dict[str, str]) -> None:
    output = run(["grind", "problem", RISC_SLICES_ID], env=env).stdout
    for problem_set_id in (
        RISC_SLICES_ID,
        f"{RISC_SLICES_ID}-1",
        f"{RISC_SLICES_ID}-2",
        f"{RISC_SLICES_ID}-3",
    ):
        require(problem_set_id in output, f"catalog is missing {problem_set_id}")
    for smoke in SMOKE_PROBLEMS:
        smoke_output = run(["grind", "problem", smoke.problem_id], env=env).stdout
        require(
            smoke.problem_id in smoke_output,
            f"catalog is missing {smoke.problem_id}",
        )


def create_assignment(
    problem_set_id: str,
    title: str,
    *,
    unlock_at: str | None = None,
    lock_at: str | None = None,
) -> None:
    with database() as db:
        db.execute(
            """
            INSERT INTO assignments(
                user_id, course_id, problem_set_id, assignment_title, restricted,
                grade_id, outcome_url, outcome_ext_accepted, consumer_key,
                unlock_at, lock_at
            ) VALUES(?, ?, ?, ?, 0, NULL, 'test-no-passback', 'text',
                     'test-consumer', ?, ?)
            """,
            (USER_ID, COURSE_ID, problem_set_id, title, unlock_at, lock_at),
        )
        db.commit()


def delete_assignment(problem_set_id: str) -> None:
    with database() as db:
        db.execute(
            "DELETE FROM assignments WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
            (USER_ID, COURSE_ID, problem_set_id),
        )
        db.commit()


def update_assignment_lock(problem_set_id: str, lock_at: str | None) -> None:
    with database() as db:
        db.execute(
            "UPDATE assignments SET lock_at = ? "
            "WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
            (lock_at, USER_ID, COURSE_ID, problem_set_id),
        )
        db.commit()


def set_course_roles(course_roles: str) -> None:
    with database() as db:
        db.execute(
            "UPDATE user_courses SET course_roles = ? WHERE user_id = ? AND course_id = ?",
            (course_roles, USER_ID, COURSE_ID),
        )
        db.commit()


def require_download_status(problem_set_id: str, expected: int) -> None:
    with database() as db:
        row = db.execute(
            """
            SELECT download_status
            FROM accessible_assignment_fields
            WHERE viewer_user_id = ?
                AND assignment_user_id = ?
                AND course_id = ?
                AND problem_set_id = ?
            """,
            (USER_ID, USER_ID, COURSE_ID, problem_set_id),
        ).fetchone()
    require(row is not None, f"missing assignment download status for {problem_set_id}")
    actual = int(row[0])
    require(
        actual == expected,
        f"{problem_set_id} download status {actual}, expected {expected}",
    )
