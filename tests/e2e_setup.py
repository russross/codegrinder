#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from e2e_common import (
    ARTIFACT_DIR,
    COURSE_ID,
    COURSE_NAME,
    DAYCARE_SECRET,
    DB_PATH,
    HOST,
    LEGACY_WORKSPACE_DIR,
    PORT,
    ROOT,
    RUN_ROOT,
    SERVER_CONFIG_PATH,
    SERVER_LOG,
    SESSION_KEY,
    SESSION_SECRET,
    TARGET_DEBUG,
    USER_ID,
    WORKSPACE_DIR,
    CommandResult,
    e2e_env,
    format_failure,
    port_is_open,
    require,
    run,
    run_expect_failure,
    session_key_hash,
    stop_process,
)
TESTS_DIR = ROOT / "tests"


def prepare_clean_start() -> None:
    shutil.rmtree(RUN_ROOT, ignore_errors=True)
    shutil.rmtree(LEGACY_WORKSPACE_DIR, ignore_errors=True)
    subprocess.run(
        ["docker", "rm", "-f", f"nanny-{USER_ID}"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def cleanup_success_artifacts() -> None:
    shutil.rmtree(RUN_ROOT, ignore_errors=True)
    shutil.rmtree(LEGACY_WORKSPACE_DIR, ignore_errors=True)


def ensure_server_not_running(env: dict[str, str]) -> None:
    if shutil.which("doas") is not None:
        status = subprocess.run(
            ["doas", "rc-service", "codegrinder-server", "status"],
            cwd=ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        combined = f"{status.stdout}\n{status.stderr}".lower()
        if status.returncode == 0 and "started" in combined:
            subprocess.run(
                ["doas", "rc-service", "codegrinder-server", "stop"],
                cwd=ROOT,
                env=env,
                check=False,
            )
            raise RuntimeError(
                "codegrinder-server service was already running; stopped it and aborting"
            )
    if port_is_open(PORT):
        raise RuntimeError(f"localhost:{PORT} is already in use")


def ensure_docker_running(env: dict[str, str]) -> None:
    run(["docker", "info"], env=env)


def build_rust(env: dict[str, str]) -> None:
    run(["cargo", "build", "-p", "codegrinder-server", "-p", "grind"], env=env, timeout=1800)


def check_version_without_config(env: dict[str, str]) -> None:
    isolated_env = env.copy()
    isolated_env["XDG_CONFIG_HOME"] = str(ARTIFACT_DIR / "empty-config")
    result = run(["grind", "version"], env=isolated_env)
    require(result.stdout.startswith("grind "), "grind version did not print the local version")


def check_login_argument_shapes(env: dict[str, str]) -> None:
    isolated_env = env.copy()
    isolated_env["XDG_CONFIG_HOME"] = str(ARTIFACT_DIR / "login-config")
    for command in [
        ["grind", "login"],
        ["grind", "login", HOST],
        ["grind", "login", HOST, "token", "extra"],
    ]:
        result = run_expect_failure(command, env=isolated_env)
        require(
            "login <hostname> <token>" in result.stdout or "login <hostname> <token>" in result.stderr,
            f"{' '.join(command)} did not print login guidance",
        )


def build_containers(env: dict[str, str]) -> None:
    run(["problemtypes/bin/build-containers", "c", "riscv"], env=env, timeout=1800)


def rebuild_database(env: dict[str, str]) -> None:
    DB_PATH.unlink(missing_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    schema = (ROOT / "setup" / "schema.sql").read_text(encoding="utf-8")
    result = subprocess.run(
        ["sqlite3", "-batch", str(DB_PATH)],
        cwd=ROOT,
        env=env,
        text=True,
        input=schema,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=300,
        check=False,
    )
    command_result = CommandResult(
        ["sqlite3", "-batch", str(DB_PATH)],
        ROOT,
        result.returncode,
        result.stdout,
        result.stderr,
    )
    if command_result.stdout:
        print(command_result.stdout, end="")
    if command_result.stderr:
        print(command_result.stderr, end="", file=sys.stderr)
    if command_result.returncode != 0:
        raise RuntimeError(format_failure(command_result, "database schema load failed"))


def write_grind_config() -> None:
    from e2e_common import CONFIG_PATH

    CONFIG_PATH.unlink(missing_ok=True)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        "\n".join(
            [
                f'host = "{HOST}"',
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


def write_server_config() -> None:
    SERVER_CONFIG_PATH.write_text(
        json.dumps(
            {
                "hostname": "localhost",
                "taHostname": HOST,
                "daycareSecret": DAYCARE_SECRET,
                "ltiSecret": "e2e-test-lti-secret",
                "sessionSecret": SESSION_SECRET,
                "capacity": 1,
                "problemTypes": ["cinout", "riscv", "containment-c"],
                "containerEngine": "docker",
                "sqlite3Path": str(DB_PATH),
                "wwwRoot": str(ROOT / "www"),
                "sessionsExpire": ["2099-01-01 00:00:00"],
                "ipFilter": {"whitelist": ["127.0.0.1", "::1"]},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def start_server(env: dict[str, str]) -> subprocess.Popen[str]:
    log = SERVER_LOG.open("w", encoding="utf-8")
    server = subprocess.Popen(
        [
            str(TARGET_DEBUG / "codegrinder-server"),
            "--config",
            str(SERVER_CONFIG_PATH),
            "--dev-http",
            str(PORT),
        ],
        cwd=ROOT,
        env=env,
        text=True,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError(f"server exited early; see {SERVER_LOG}")
        if port_is_open(PORT):
            return server
        time.sleep(0.25)
    stop_process(server)
    raise RuntimeError(f"server did not listen on localhost:{PORT}; see {SERVER_LOG}")


def seed_user_session() -> None:
    now = "2026-06-16 00:00:00"
    expires = "2099-01-01 00:00:00"
    session_hash = session_key_hash(SESSION_KEY, SESSION_SECRET)
    with sqlite3.connect(DB_PATH) as db:
        db.executescript(
            """
            PRAGMA foreign_keys = ON;
            INSERT INTO users(user_id, user_name, user_login, admin)
                VALUES('e2e-user', 'E2E User', 'e2e@example.com', 1);
            INSERT INTO authors(user_id) VALUES('e2e-user');
            INSERT INTO courses(course_id, course_name)
                VALUES('e2e-course', 'CS 2810 E2E');
            INSERT INTO user_courses(user_id, course_id, course_roles)
                VALUES('e2e-user', 'e2e-course', 'Learner,Instructor');
            """
        )
        db.execute(
            """
            INSERT INTO user_sessions(
                session_key_hash, user_id, session_created_at,
                session_expires_at, session_last_used_at
            ) VALUES(?, 'e2e-user', ?, ?, ?)
            """,
            (session_hash, now, expires, now),
        )


def wait_for_grind(env: dict[str, str]) -> None:
    deadline = time.monotonic() + 30
    last: CommandResult | None = None
    while time.monotonic() < deadline:
        last = run(["grind", "list"], env=env, check=False)
        if last.returncode == 0 or "no assignments found" in last.stderr:
            return
        time.sleep(0.5)
    raise RuntimeError(f"grind could not connect: {last.stderr if last else ''}")


def run_command_surface_checks(env: dict[str, str]) -> None:
    for command in [
        ["grind", "list", "extra"],
        ["grind", "get", "extra"],
        ["grind", "sync", "extra"],
        ["grind", "grade", "extra"],
        ["grind", "solve", "extra"],
    ]:
        run_expect_failure(command, cwd=ARTIFACT_DIR, env=env)

    for command in [
        ["grind", "sync"],
        ["grind", "grade"],
        ["grind", "reset"],
        ["grind", "solve"],
        ["grind", "action", "step"],
    ]:
        run_expect_failure(command, cwd=ARTIFACT_DIR, env=env)


def run_api_trace_check(env: dict[str, str]) -> None:
    result = run(["grind", "--api", "list"], env=env, check=False)
    trace = result.stderr
    require("--> Hello" in trace, "--api did not trace Hello")
    require("--> ListAssignments" in trace, "--api did not trace ListAssignments")


def sync_problem_types(env: dict[str, str]) -> None:
    run(["problemtypes/bin/sync-actions", "cinout", "riscv"], env=env)
    run(["problemtypes/bin/sync-files", "cinout", "riscv"], env=env)
    run(["grind", "problemtype", "list"], env=env)


def create_containment_problem_type(env: dict[str, str]) -> None:
    run(
        [
            "grind",
            "problemtype",
            "action",
            "set",
            "--problem-type",
            "containment-c",
            "--container",
            "codegrinder/c",
            "--action",
            "grade|make grade|none|2|64|1|512|24",
            "--action",
            "step|make step|none|2|64|1|512|24",
        ],
        env=env,
    )


def run_problem_type_command_checks(env: dict[str, str]) -> None:
    type_list = run(["grind", "type", "--list"], env=env).stdout
    require("cinout" in type_list, "grind type --list did not show cinout")
    require("riscv" in type_list, "grind type --list did not show riscv")

    type_dir = ARTIFACT_DIR / "type-riscv"
    type_dir.mkdir(parents=True, exist_ok=False)
    run(["grind", "type", "riscv"], cwd=type_dir, env=env)
    require((type_dir / "Makefile").is_file(), "grind type riscv did not write Makefile")
    require((type_dir / "print.s").is_file(), "grind type riscv did not write print.s")


def create_problem_sources(env: dict[str, str]) -> None:
    for name in ["array-max", "sudoku", "huff", "containment"]:
        run(["grind", "create"], cwd=TESTS_DIR / name, env=env, timeout=1800)
    run(["grind", "problem", "cs2810"], env=env)


def create_sudoku_slices(env: dict[str, str]) -> None:
    psets = {
        "sudoku-1.cfg": """
[problemset]
unique = sudoku-1
note = Sudoku Pencil Marks 1
tag = cs2810
tag = riscv

[problem "sudoku"]
steps = 1-2
""",
        "sudoku-2.cfg": """
[problemset]
unique = sudoku-2
note = Sudoku Pencil Marks 2
tag = cs2810
tag = riscv
continues = sudoku-1

[problem "sudoku"]
steps = 3-3
""",
        "sudoku-3.cfg": """
[problemset]
unique = sudoku-3
note = Sudoku Pencil Marks 3
tag = cs2810
tag = riscv
continues = sudoku-2

[problem "sudoku"]
steps = 4-4
""",
    }
    pset_dir = ARTIFACT_DIR / "psets"
    pset_dir.mkdir(parents=True, exist_ok=False)
    for filename, content in psets.items():
        path = pset_dir / filename
        path.write_text(content.strip() + "\n", encoding="utf-8")
        run(["grind", "create", str(path)], env=env)


def run_author_catalog_checks(env: dict[str, str]) -> None:
    run_expect_failure(["grind", "problem", "definitely-not-an-e2e-problem"], env=env)
    run_expect_failure(["grind", "create", str(ARTIFACT_DIR / "psets" / "sudoku-1.cfg")], env=env)

    invalid = ARTIFACT_DIR / "psets" / "sudoku-bad-gap.cfg"
    invalid.write_text(
        """
[problemset]
unique = sudoku-bad-gap
note = Sudoku Bad Gap
tag = cs2810
tag = riscv
continues = sudoku-1

[problem "sudoku"]
steps = 4-4
""".strip()
        + "\n",
        encoding="utf-8",
    )
    run_expect_failure(["grind", "create", str(invalid)], env=env)


def list_problem_catalog(env: dict[str, str]) -> None:
    output = run(["grind", "problem", "sudoku"], env=env).stdout
    for problem_set_id in ["sudoku", "sudoku-1", "sudoku-2", "sudoku-3"]:
        require(problem_set_id in output, f"catalog is missing {problem_set_id}")


def create_assignment(
    problem_set_id: str,
    title: str,
    *,
    unlock_at: str | None = None,
    lock_at: str | None = None,
) -> None:
    with sqlite3.connect(DB_PATH) as db:
        db.execute("PRAGMA foreign_keys = ON")
        db.execute(
            """
            INSERT INTO assignments(
                user_id, course_id, problem_set_id, assignment_title, restricted,
                grade_id, outcome_url, outcome_ext_accepted, consumer_key,
                unlock_at, lock_at
            ) VALUES(?, ?, ?, ?, 0, ?, ?, 'text', 'e2e-consumer', ?, ?)
            ON CONFLICT(user_id, course_id, problem_set_id) DO NOTHING
            """,
            (
                USER_ID,
                COURSE_ID,
                problem_set_id,
                title,
                f"grade-{problem_set_id}",
                "https://lms.example/outcome",
                unlock_at,
                lock_at,
            ),
        )


def delete_assignment(problem_set_id: str) -> None:
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            DELETE FROM assignments
            WHERE user_id = ? AND course_id = ? AND problem_set_id = ?
            """,
            (USER_ID, COURSE_ID, problem_set_id),
        )


def update_assignment_lock(problem_set_id: str, lock_at: str | None) -> None:
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            UPDATE assignments
            SET lock_at = ?
            WHERE user_id = ? AND course_id = ? AND problem_set_id = ?
            """,
            (lock_at, USER_ID, COURSE_ID, problem_set_id),
        )


def set_course_roles(course_roles: str) -> None:
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            UPDATE user_courses
            SET course_roles = ?
            WHERE user_id = ? AND course_id = ?
            """,
            (course_roles, USER_ID, COURSE_ID),
        )


def require_download_status(problem_set_id: str, expected: int) -> None:
    with sqlite3.connect(DB_PATH) as db:
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
