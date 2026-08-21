#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

from e2e_common import (
    ROOT,
    USER_ID,
    WORKSPACE_DIR,
    CommandResult,
    format_failure,
    require,
    run,
)
from e2e_flows import require_score


ASSIGNMENT_DIR = WORKSPACE_DIR / "containment"
STUDENT_FILE = ASSIGNMENT_DIR / "containment.c"
NANNY_NAME = f"nanny-{USER_ID}"


def run_containment_flow(env: dict[str, str]) -> None:
    run(["grind", "get"], env=env)
    require(ASSIGNMENT_DIR.is_dir(), f"{ASSIGNMENT_DIR} was not downloaded")

    check_bad_submission(
        env,
        "infinite loop",
        """
int containment_answer(void) {
    volatile int keep_running = 1;
    while (keep_running) {
    }
    return 0;
}
""",
    )
    check_bad_submission(
        env,
        "memory pig",
        """
#include <stdlib.h>
#include <string.h>

int containment_answer(void) {
    enum { chunk_size = 16 * 1024 * 1024 };
    for (;;) {
        void *chunk = malloc(chunk_size);
        if (chunk == NULL) {
            return 1;
        }
        memset(chunk, 0x5a, chunk_size);
    }
}
""",
    )
    check_bad_submission(
        env,
        "file-size pig",
        """
#include <stdio.h>

int containment_answer(void) {
    FILE *out = fopen("oversized-output.bin", "wb");
    if (out == NULL) {
        return 1;
    }
    for (;;) {
        if (fputc('x', out) == EOF) {
            return 1;
        }
    }
}
""",
    )
    check_bad_submission(
        env,
        "fork bomb",
        """
#include <unistd.h>

int containment_answer(void) {
    for (;;) {
        if (fork() < 0) {
            return 1;
        }
    }
}
""",
    )
    check_same_user_preemption(env)


def check_bad_submission(env: dict[str, str], name: str, source: str) -> None:
    write_student_source(source)
    started = time.monotonic()
    result = run(
        ["grind", "grade"],
        cwd=ASSIGNMENT_DIR,
        env=env,
        check=False,
        expect_code=0,
        timeout=40,
    )
    elapsed = time.monotonic() - started
    require(
        elapsed < 25.0,
        f"{name} was not contained quickly enough; elapsed {elapsed:.1f}s",
    )
    require_score("containment", 0.0)
    require_no_nanny_container(env)
    require(
        "failed" in result.stdout.lower()
        or "exit status" in result.stdout.lower()
        or "timed out" in result.stdout.lower()
        or result.stderr,
        f"{name} produced no visible failure signal",
    )


def check_same_user_preemption(env: dict[str, str]) -> None:
    write_student_source(
        """
int containment_answer(void) {
    volatile int keep_running = 1;
    while (keep_running) {
    }
    return 0;
}
"""
    )
    first = subprocess.Popen(
        ["grind", "action", "step"],
        cwd=ASSIGNMENT_DIR,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        require_nanny_container(env)
        write_student_source(
            """
int containment_answer(void) {
    return 42;
}
"""
        )
        started = time.monotonic()
        second = run(
            ["grind", "action", "step"],
            cwd=ASSIGNMENT_DIR,
            env=env,
            timeout=40,
        )
        elapsed = time.monotonic() - started
        require(second.returncode == 0, "preempting action did not succeed")
        require(
            elapsed < 20.0,
            f"preempting action took too long; elapsed {elapsed:.1f}s",
        )

        try:
            stdout, stderr = first.communicate(timeout=10)
        except subprocess.TimeoutExpired as error:
            first.kill()
            first.communicate(timeout=10)
            raise RuntimeError("superseded daycare action was not terminated early") from error

        first_result = CommandResult(
            ["grind", "action", "step"],
            ASSIGNMENT_DIR,
            first.returncode,
            stdout,
            stderr,
        )
        print_process_output(first_result)
        require(
            first_result.returncode != 0
            or "superseded" in first_result.stdout.lower()
            or "superseded" in first_result.stderr.lower()
            or "killed by sigkill" in first_result.stdout.lower()
            or "session closed by server" in first_result.stderr.lower(),
            format_failure(
                first_result,
                "superseded daycare action appeared to finish normally",
            ),
        )
        require_no_nanny_container(env)
    finally:
        if first.poll() is None:
            first.kill()
            first.wait(timeout=10)


def write_student_source(source: str) -> None:
    STUDENT_FILE.write_text(source.strip() + "\n", encoding="utf-8")


def require_nanny_container(env: dict[str, str]) -> None:
    deadline = time.monotonic() + 20.0
    while time.monotonic() < deadline:
        if nanny_container_exists(env):
            return
        time.sleep(0.25)
    raise RuntimeError(f"{NANNY_NAME} was not started")


def require_no_nanny_container(env: dict[str, str]) -> None:
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if not nanny_container_exists(env):
            return
        time.sleep(0.25)
    raise RuntimeError(f"{NANNY_NAME} was left behind")


def nanny_container_exists(env: dict[str, str]) -> bool:
    result = subprocess.run(
        [
            "docker",
            "ps",
            "-a",
            "--filter",
            f"name=^/{NANNY_NAME}$",
            "--format",
            "{{.Names}}",
        ],
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=10,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"docker ps failed: {result.stderr}")
    return NANNY_NAME in result.stdout.splitlines()


def print_process_output(result: CommandResult) -> None:
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
