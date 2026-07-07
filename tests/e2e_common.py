#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parent
RUN_ROOT = Path("/tmp/codegrinder-e2e")
ARTIFACT_DIR = RUN_ROOT / "artifacts"
XDG_CONFIG_HOME = RUN_ROOT / "xdg-config"
CONFIG_PATH = XDG_CONFIG_HOME / "codegrinder" / "config.toml"
DB_PATH = RUN_ROOT / "codegrinder.db"
SERVER_CONFIG_PATH = ARTIFACT_DIR / "config.json"
TARGET_DEBUG = ROOT / "target" / "debug"
SESSION_KEY = "e2e-test-session-key"
SESSION_SECRET = "e2e-test-session-secret"
DAYCARE_SECRET = "e2e-test-daycare-secret"
USER_ID = "e2e-user"
COURSE_ID = "e2e-course"
COURSE_NAME = "CS 2810 E2E"
COURSE_DIR = "cs2810"
WORKSPACE_DIR = RUN_ROOT / COURSE_DIR
LEGACY_WORKSPACE_DIR = Path("/tmp") / COURSE_DIR
SERVER_LOG = ARTIFACT_DIR / "server.log"


@dataclass(frozen=True)
class CommandResult:
    command: list[str]
    cwd: Path
    returncode: int
    stdout: str
    stderr: str


def e2e_env() -> dict[str, str]:
    env = os.environ.copy()
    env["CODEGRINDERROOT"] = str(ROOT)
    env["CONTAINER_ENGINE"] = "docker"
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
    if SERVER_CONFIG_PATH.is_file():
        config = json.loads(SERVER_CONFIG_PATH.read_text(encoding="utf-8"))
        raw = config.get("taHostname") or config.get("hostname")
        if not isinstance(raw, str) or raw.strip() == "":
            raise RuntimeError(f"{SERVER_CONFIG_PATH} does not define hostname or taHostname")
        host = raw.strip().rstrip("/")
    else:
        host = os.environ.get("CODEGRINDER_E2E_HOST", "https://dev.russross.com").rstrip("/")
    if host.startswith("http://") or host.startswith("https://"):
        return host
    return f"https://{host}"


def stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)
