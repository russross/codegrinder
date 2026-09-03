#!/usr/bin/env python3
from __future__ import annotations

import base64
import binascii
import fcntl
import hashlib
import hmac
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO


TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parent
SERVER_CONFIG_PATH = ROOT / "config.json"
RUN_ROOT = Path(
    os.environ.get("CODEGRINDER_E2E_RUN_ROOT", "/tmp/codegrinder-e2e")
).resolve()
RUN_MARKER = RUN_ROOT / ".codegrinder-e2e"
ARTIFACT_DIR = RUN_ROOT / "artifacts"
XDG_CONFIG_HOME = RUN_ROOT / "xdg-config"
CONFIG_PATH = XDG_CONFIG_HOME / "codegrinder" / "config.toml"

TEST_PREFIX = "test-"
SESSION_KEY = f"{TEST_PREFIX}e2e-session-key"
USER_ID = f"{TEST_PREFIX}user"
COURSE_ID = f"{TEST_PREFIX}course"
COURSE_NAME = "Test 2810"
COURSE_DIR = "test2810"
WORKSPACE_DIR = RUN_ROOT / COURSE_DIR

RISC_SINGLE_ID = f"{TEST_PREFIX}fixture-riscv-single"
RISC_SLICES_ID = f"{TEST_PREFIX}fixture-riscv-slices"
C_STEPS_ID = f"{TEST_PREFIX}fixture-c-steps"


@dataclass(frozen=True)
class LiveConfig:
    server_endpoint: str
    database_path: Path
    session_secret: str
    container_engine: str


@dataclass(frozen=True)
class SmokeProblem:
    problem_id: str
    problem_type: str
    source_directory: str
    title: str


@dataclass(frozen=True)
class CommandResult:
    command: list[str]
    cwd: Path
    returncode: int
    stdout: str
    stderr: str


def load_live_config() -> LiveConfig:
    try:
        raw = json.loads(SERVER_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(
            f"cannot read deployed configuration {SERVER_CONFIG_PATH}: {error}"
        ) from error

    host = raw.get("taHostname") or raw.get("hostname")
    if not isinstance(host, str) or not host.strip():
        raise RuntimeError(
            f"{SERVER_CONFIG_PATH} does not define taHostname or hostname"
        )
    endpoint = host.strip().rstrip("/")
    if not endpoint.startswith(("http://", "https://")):
        endpoint = f"https://{endpoint}"

    configured_database = raw.get("sqlite3Path", "db/codegrinder.db")
    if not isinstance(configured_database, str) or not configured_database.strip():
        raise RuntimeError(f"{SERVER_CONFIG_PATH} has an invalid sqlite3Path")
    database_path = Path(configured_database)
    if not database_path.is_absolute():
        database_path = SERVER_CONFIG_PATH.parent / database_path
    database_path = database_path.resolve()

    raw_secret = raw.get("sessionSecret")
    if not isinstance(raw_secret, str) or not raw_secret:
        raise RuntimeError(f"{SERVER_CONFIG_PATH} does not define sessionSecret")

    raw_engine = raw.get("containerEngine", "docker")
    if not isinstance(raw_engine, str) or not raw_engine.strip():
        raise RuntimeError(f"{SERVER_CONFIG_PATH} has an invalid containerEngine")

    return LiveConfig(
        server_endpoint=endpoint,
        database_path=database_path,
        session_secret=decode_base64_if_text(raw_secret),
        container_engine=raw_engine.split()[0],
    )


def decode_base64_if_text(raw: str) -> str:
    try:
        return base64.b64decode(raw, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return raw


LIVE_CONFIG = load_live_config()
DB_PATH = LIVE_CONFIG.database_path

SMOKE_PROBLEMS = (
    SmokeProblem(
        problem_id=f"{TEST_PREFIX}smoke-goinout",
        problem_type="goinout",
        source_directory="smoke-goinout",
        title="Test Go input/output smoke test",
    ),
    SmokeProblem(
        problem_id=f"{TEST_PREFIX}smoke-javascriptunittest",
        problem_type="javascriptunittest",
        source_directory="smoke-javascriptunittest",
        title="Test JavaScript unit-test smoke test",
    ),
    SmokeProblem(
        problem_id=f"{TEST_PREFIX}smoke-python3unittest",
        problem_type="python3unittest",
        source_directory="smoke-python3unittest",
        title="Test Python unit-test smoke test",
    ),
    SmokeProblem(
        problem_id=f"{TEST_PREFIX}smoke-python3inout",
        problem_type="python3inout",
        source_directory="smoke-python3inout",
        title="Test Python input/output smoke test",
    ),
    SmokeProblem(
        problem_id=f"{TEST_PREFIX}smoke-rustinout",
        problem_type="rustinout",
        source_directory="smoke-rustinout",
        title="Test Rust input/output smoke test",
    ),
    SmokeProblem(
        problem_id=f"{TEST_PREFIX}smoke-sqliteinout",
        problem_type="sqliteinout",
        source_directory="smoke-sqliteinout",
        title="Test SQLite input/output smoke test",
    ),
)


def e2e_env() -> dict[str, str]:
    env = os.environ.copy()
    env["CONTAINER_ENGINE"] = LIVE_CONFIG.container_engine
    env["XDG_CONFIG_HOME"] = str(XDG_CONFIG_HOME)
    return env


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


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


def session_key_hash(session_key: str, session_secret: str) -> str:
    payload = b"codegrinder:session-key:v1\0" + session_key.encode("utf-8")
    digest = hmac.new(session_secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def server_endpoint() -> str:
    return LIVE_CONFIG.server_endpoint


def acquire_run_lock() -> TextIO:
    lock_path = RUN_ROOT.parent / "codegrinder-e2e.lock"
    lock = lock_path.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        lock.close()
        raise RuntimeError(
            "another CodeGrinder end-to-end test is already running"
        ) from error
    return lock
