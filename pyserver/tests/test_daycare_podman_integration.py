from __future__ import annotations

import shutil
import subprocess
import unittest
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import grpc

import codegrinder_pb2 as pb
from config import ServerConfig
from daycare import DaycareRuntime
from mutations import (
    compute_commit_signature,
    compute_problem_signature,
    compute_problem_type_signature,
)

_RUNTIME_CANDIDATES: tuple[tuple[str, ...], ...] = (("doas", "podman"), ("podman",))
_IMAGE_CANDIDATES: tuple[str, ...] = ("localhost/codegrinder/riscv", "codegrinder/riscv")


class _AbortError(Exception):
    def __init__(self, code: grpc.StatusCode, details: str) -> None:
        super().__init__(details)
        self.code = code
        self.details = details


class _FakeContext:
    def __init__(self) -> None:
        self.active = True

    def abort(self, code: grpc.StatusCode, details: str) -> None:
        raise _AbortError(code, details)

    def is_active(self) -> bool:
        return self.active


def _selection_sort_files() -> dict[str, bytes]:
    root = Path(__file__).resolve().parents[2] / "selection-sort"
    files: dict[str, bytes] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        files[rel] = path.read_bytes()
    return files


def _build_signed_request(*, action: str, problem_options: list[str], image: str) -> pb.DaycareRequest:
    now = datetime.now(tz=UTC)
    run_action = pb.ProblemTypeAction(
        problem_type="riscv",
        action="run",
        command="make run",
        parser="",
        message="run",
        interactive=False,
        max_cpu=30,
        max_session=30,
        max_timeout=30,
        max_fd=128,
        max_file_size=16,
        max_memory=512,
        max_threads=32,
    )
    grade_action = pb.ProblemTypeAction(
        problem_type="riscv",
        action="grade",
        command="make grade",
        parser="xunit",
        message="grade",
        interactive=False,
        max_cpu=30,
        max_session=30,
        max_timeout=30,
        max_fd=128,
        max_file_size=16,
        max_memory=512,
        max_threads=32,
    )
    ptype = pb.ProblemType(
        name="riscv",
        image=image,
        files={},
        actions={"run": run_action, "grade": grade_action},
    )
    problem = pb.Problem(
        id=100,
        unique="selection-sort",
        note="integration fixture",
        tags=["integration", "riscv"],
        options=problem_options,
        created_at=now,
        updated_at=now,
    )
    step = pb.ProblemStep(
        problem_id=100,
        step=1,
        problem_type="riscv",
        note="fixture step",
        instructions="run fixture",
        weight=1.0,
        files={},
        whitelist={"sort.s": True},
    )
    commit = pb.Commit(
        assignment_id=55,
        problem_id=100,
        step=1,
        action=action,
        note="",
        files=_selection_sort_files(),
        score=0.0,
        created_at=now,
        updated_at=now,
    )

    daycare_secret = "daycare-secret"
    hostname = "daycare.example.invalid"
    user_id = 999
    type_sig = compute_problem_type_signature(ptype, daycare_secret)
    problem_sig = compute_problem_signature(problem, [step], daycare_secret)
    commit_sig = compute_commit_signature(commit, type_sig, problem_sig, hostname, user_id, daycare_secret)

    bundle = pb.CommitBundle(
        problem_type=ptype,
        problem_type_signature=type_sig,
        problem=problem,
        problem_steps=[step],
        problem_signature=problem_sig,
        hostname=hostname,
        user_id=user_id,
        commit=commit,
        commit_signature=commit_sig,
    )
    return pb.DaycareRequest(
        commit_bundle=bundle,
        problem_type="riscv",
        action=action,
        args=[],
    )


class DaycarePodmanIntegrationTests(unittest.TestCase):
    def _require_runtime_and_image(self) -> tuple[list[str], str]:
        messages: list[str] = []
        for runtime in _RUNTIME_CANDIDATES:
            if any(shutil.which(part) is None for part in runtime):
                continue
            for image in _IMAGE_CANDIDATES:
                image_exists = subprocess.run(
                    [*runtime, "image", "exists", image],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if image_exists.returncode != 0:
                    continue
                probe = subprocess.run(
                    [*runtime, "run", "--rm", "--network", "none", "--entrypoint", "/bin/true", image],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                if probe.returncode == 0:
                    return list(runtime), image
                messages.append(f"{' '.join(runtime)} {image}: {probe.stderr.strip()}")
        if len(messages) == 0:
            self.skipTest("required image not present: localhost/codegrinder/riscv or codegrinder/riscv")
        self.skipTest(f"podman runtime unavailable for integration test: {'; '.join(messages)}")
        raise AssertionError("unreachable")

    def _runtime(self, container_command: list[str]) -> DaycareRuntime:
        return DaycareRuntime(
            ServerConfig(
                hostname="daycare.example.invalid",
                daycare_secret="daycare-secret",
                session_secret="session-secret",
                capacity=1,
                container_engine=" ".join(container_command),
            )
        )

    def test_run_action_streams_exec_and_success_exit(self) -> None:
        container_command, image = self._require_runtime_and_image()
        runtime = self._runtime(container_command)
        request = _build_signed_request(action="run", problem_options=[], image=image)

        responses = list(runtime.stream(request, cast(grpc.ServicerContext, _FakeContext())))
        response_kinds = [response.WhichOneof("response") for response in responses]
        self.assertNotIn("error", response_kinds)
        self.assertNotIn("commit_bundle", response_kinds)

        events = [response.event for response in responses if response.WhichOneof("response") == "event"]
        self.assertTrue(any(event.event == "exec" and list(event.exec_command) == ["make", "run"] for event in events))
        self.assertTrue(any(event.event == "exit" and int(event.exit_status) == 0 for event in events))

    def test_grade_action_returns_signed_bundle_and_downloaded_xunit(self) -> None:
        container_command, image = self._require_runtime_and_image()
        runtime = self._runtime(container_command)
        request = _build_signed_request(action="grade", problem_options=["download=test_detail.xml"], image=image)

        responses = list(runtime.stream(request, cast(grpc.ServicerContext, _FakeContext())))
        response_kinds = [response.WhichOneof("response") for response in responses]
        self.assertNotIn("error", response_kinds)

        events = [response.event for response in responses if response.WhichOneof("response") == "event"]
        file_payload: dict[str, bytes] = {}
        for event in events:
            if event.event == "files":
                file_payload.update(dict(event.files))

        self.assertIn("test_detail.xml", file_payload)
        xml_bytes = file_payload["test_detail.xml"]
        self.assertTrue(b"<testsuite" in xml_bytes or b"<testsuites" in xml_bytes)

        grade_response = responses[-1]
        self.assertEqual(grade_response.WhichOneof("response"), "commit_bundle")
        signed_bundle = grade_response.commit_bundle
        self.assertTrue(signed_bundle.commit_signature)
        self.assertTrue(signed_bundle.commit.report_card.passed)
        self.assertEqual(signed_bundle.commit.score, 1.0)
        self.assertGreater(len(signed_bundle.commit.report_card.results), 0)


if __name__ == "__main__":
    unittest.main()
