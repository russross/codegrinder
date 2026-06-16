#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEST_DIR = ROOT / "tests"
RUN_ROOT = Path("/tmp/codegrinder-smoke")
ARTIFACT_DIR = RUN_ROOT / "artifacts"
XDG_CONFIG_HOME = RUN_ROOT / "xdg-config"
CONFIG_PATH = XDG_CONFIG_HOME / "codegrinder" / "config.toml"
DB_PATH = RUN_ROOT / "codegrinder.db"
SERVER_CONFIG_PATH = ARTIFACT_DIR / "config.json"
TARGET_DEBUG = ROOT / "target" / "debug"
SESSION_KEY = "smoke-test-session-key"
SESSION_SECRET = "smoke-test-session-secret"
DAYCARE_SECRET = "smoke-test-daycare-secret"
USER_ID = "smoke-user"
COURSE_ID = "smoke-course"
COURSE_NAME = "CS 2810 Smoke"
COURSE_DIR = "cs2810"
WORKSPACE_DIR = RUN_ROOT / COURSE_DIR
LEGACY_WORKSPACE_DIR = Path("/tmp") / COURSE_DIR
PORT = int(os.environ.get("CODEGRINDER_SMOKE_PORT", "18080"))
HOST = f"http://localhost:{PORT}"
SERVER_LOG = ARTIFACT_DIR / "server.log"


@dataclass(frozen=True)
class CommandResult:
    command: list[str]
    cwd: Path
    returncode: int
    stdout: str
    stderr: str


def main() -> int:
    env = smoke_env()
    server: subprocess.Popen[str] | None = None
    completed = False
    try:
        prepare_clean_start()
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        ensure_server_not_running(env)
        ensure_docker_running(env)
        build_rust(env)
        env["PATH"] = f"{TARGET_DEBUG}:{env['PATH']}"
        check_version_without_config(env)
        check_login_argument_shapes(env)
        build_containers(env)
        rebuild_database(env)
        write_grind_config()
        write_server_config()
        server = start_server(env)
        seed_user_session()
        wait_for_grind(env)
        run_command_surface_checks(env)
        run_api_trace_check(env)
        sync_problem_types(env)
        run_problem_type_command_checks(env)
        create_problem_sources(env)
        create_sudoku_slices(env)
        run_author_catalog_checks(env)
        list_problem_catalog(env)
        set_course_roles("Learner")
        create_assignment("array-max", "Array Max")
        run_array_max_flow(env)
        create_assignment("huff", "Huffman Encoder")
        create_assignment("sudoku-1", "Sudoku Pencil Marks 1")
        create_assignment("sudoku-2", "Sudoku Pencil Marks 2")
        create_assignment("sudoku-3", "Sudoku Pencil Marks 3")
        create_assignment("sudoku", "Future Full Sudoku", unlock_at="2099-01-01 00:00:00")
        run_followup_download_checks(env)
        delete_assignment("sudoku")
        run_huff_flow(env)
        run_sudoku_flow(env)
        require_score("array-max", 1.0)
        require_score("huff", 1.0)
        require_score("sudoku-1", 1.0)
        require_score("sudoku-2", 1.0)
        require_score("sudoku-3", 1.0)
        run(["grind", "list"], env=env)
        completed = True
        print("smoke test completed")
        return 0
    finally:
        if server is not None:
            stop_process(server)
        if completed:
            cleanup_success_artifacts()
        else:
            print(f"smoke test artifacts left in {RUN_ROOT}", file=sys.stderr)


def smoke_env() -> dict[str, str]:
    env = os.environ.copy()
    env["CODEGRINDERROOT"] = str(ROOT)
    env["CONTAINER_ENGINE"] = "docker"
    env["XDG_CONFIG_HOME"] = str(XDG_CONFIG_HOME)
    return env


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
                "ltiSecret": "smoke-test-lti-secret",
                "sessionSecret": SESSION_SECRET,
                "capacity": 1,
                "problemTypes": ["cinout", "riscv"],
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
                VALUES('smoke-user', 'Smoke User', 'smoke@example.com', 1);
            INSERT INTO authors(user_id) VALUES('smoke-user');
            INSERT INTO courses(course_id, course_name)
                VALUES('smoke-course', 'CS 2810 Smoke');
            INSERT INTO user_courses(user_id, course_id, course_roles)
                VALUES('smoke-user', 'smoke-course', 'Learner,Instructor');
            """
        )
        db.execute(
            """
            INSERT INTO user_sessions(
                session_key_hash, user_id, session_created_at,
                session_expires_at, session_last_used_at
            ) VALUES(?, 'smoke-user', ?, ?, ?)
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
    for name in ["array-max", "sudoku", "huff"]:
        run(["grind", "create"], cwd=TEST_DIR / name, env=env, timeout=1800)
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
    run_expect_failure(["grind", "problem", "definitely-not-a-smoke-problem"], env=env)
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
            ) VALUES(?, ?, ?, ?, 0, ?, ?, 'text', 'smoke-consumer', ?, ?)
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
        run_expect_failure(["make"], cwd=assignment_dir, env=env)
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
        run_host_make_if_available(["clang", "clang-tidy"], cwd=assignment_dir, env=env)
        run(["grind", "grade"], cwd=assignment_dir, env=env)
        require_score("huff", step / 5.0)
        if step == 2:
            dotfile = assignment_dir / ".grind"
            original_dotfile = dotfile.read_text(encoding="utf-8")
            dotfile.write_text(original_dotfile.replace("step = 3", "step = 1"), encoding="utf-8")
            try:
                run_expect_failure(["grind", "sync"], cwd=assignment_dir, env=env)
                require_score("huff", 2.0 / 5.0)
            finally:
                dotfile.write_text(original_dotfile, encoding="utf-8")
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

    require_current_step(sudoku3, "sudoku", 4)
    run(["grind", "solve"], cwd=sudoku3, env=env)
    run(["make"], cwd=sudoku3, env=env)
    run(["grind", "grade"], cwd=sudoku3, env=env)
    require_score("sudoku-3", 1.0)


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
            (USER_ID, COURSE_ID, problem_set_id),
        ).fetchone()
    require(row is not None, f"missing assignment score for {problem_set_id}")
    actual = float(row[0])
    require(
        abs(actual - expected) < 0.000001,
        f"{problem_set_id} score {actual}, expected {expected}",
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


def run_expect_failure(
    command: list[str],
    *,
    cwd: Path = ROOT,
    env: dict[str, str],
    timeout: int = 300,
) -> CommandResult:
    result = run(command, cwd=cwd, env=env, check=False, timeout=timeout)
    if result.returncode == 0:
        raise RuntimeError(format_failure(result, "command unexpectedly succeeded"))
    return result


def run_host_make_if_available(
    required_commands: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
) -> None:
    missing = [command for command in required_commands if shutil.which(command) is None]
    if missing:
        print(f"skipping host make; missing {', '.join(missing)}")
        return
    run(["make"], cwd=cwd, env=env)


def run(
    command: list[str],
    *,
    cwd: Path = ROOT,
    env: dict[str, str],
    check: bool = True,
    expect_code: int | None = None,
    timeout: int = 300,
) -> CommandResult:
    print(f"+ {' '.join(command)}", flush=True)
    proc = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    result = CommandResult(command, cwd, proc.returncode, proc.stdout, proc.stderr)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    if expect_code is not None and result.returncode != expect_code:
        raise RuntimeError(format_failure(result, f"expected exit {expect_code}"))
    if check and result.returncode != 0:
        raise RuntimeError(format_failure(result, "command failed"))
    return result


def format_failure(result: CommandResult, message: str) -> str:
    return "\n".join(
        [
            message,
            f"cwd: {result.cwd}",
            f"command: {' '.join(result.command)}",
            f"exit: {result.returncode}",
            f"stdout:\n{result.stdout}",
            f"stderr:\n{result.stderr}",
        ]
    )


def session_key_hash(session_key: str, session_secret: str) -> str:
    payload = b"codegrinder:session-key:v1\0" + session_key.encode("utf-8")
    digest = hmac.new(session_secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


if __name__ == "__main__":
    raise SystemExit(main())
