from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import grpc

import codegrinder_pb2 as pb
from config import ServerConfig
from daycare import DaycareRuntime
from signatures import decode_signed_runtime_bundle, encode_signed_runtime_bundle

_RUNTIME_CANDIDATES: tuple[tuple[str, ...], ...] = (("docker",),)
_IMAGE_CANDIDATES: tuple[str, ...] = ("codegrinder/riscv",)


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
    root = Path(__file__).resolve().parent / "fixtures" / "selection-sort"
    files: dict[str, bytes] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        files[rel] = path.read_bytes()
    return files


def _runtime_limits_from_action(action: pb.ProblemTypeAction) -> pb.RuntimeLimits:
    return pb.RuntimeLimits(
        max_cpu=action.max_cpu,
        max_fd=action.max_fd,
        max_file_size=action.max_file_size,
        max_memory=action.max_memory,
        max_threads=action.max_threads,
    )


def _build_signed_request(*, action: str, problem_options: list[str], image: str) -> pb.DaycareRequest:
    now = datetime.now(tz=UTC)
    run_action = pb.ProblemTypeAction(
        command="make run",
        parser="",
        max_cpu=30,
        max_fd=128,
        max_file_size=16,
        max_memory=512,
        max_threads=32,
    )
    grade_action = pb.ProblemTypeAction(
        command="make grade",
        parser="xunit",
        max_cpu=30,
        max_fd=128,
        max_file_size=16,
        max_memory=512,
        max_threads=32,
    )
    action_entry = grade_action if action == "grade" else run_action
    commit = pb.Commit(
        assignment=pb.AssignmentKey(user_id="999", course_id="c-1", problem_set_id="ps-1"),
        problem_id="selection-sort",
        step=1,
        action=action,
        note="",
        files=_selection_sort_files(),
        score=0.0,
        created_at=now,
        updated_at=now,
    )
    bundle = pb.RuntimeBundle(
        hostname="daycare.example.invalid",
        user_id="999",
        assignment=commit.assignment,
        problem_id="selection-sort",
        problem_note="integration fixture",
        problem_options=problem_options,
        step_number=1,
        total_steps=1,
        action=action,
        container=image,
        command=action_entry.command,
        parser=action_entry.parser,
        limits=_runtime_limits_from_action(action_entry),
        files=_selection_sort_files(),
        commit=commit,
    )
    return pb.DaycareRequest(bundle=encode_signed_runtime_bundle(bundle, "daycare-secret"), args=[])


class DaycareDockerIntegrationTests(unittest.TestCase):
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
            self.skipTest("required image not present: codegrinder/riscv")
        self.skipTest(f"docker runtime unavailable for integration test: {'; '.join(messages)}")
        raise AssertionError("unreachable")

    def _runtime(self, container_command: list[str]) -> DaycareRuntime:
        tmp = tempfile.TemporaryDirectory()
        runtime = DaycareRuntime(
            ServerConfig(
                hostname="daycare.example.invalid",
                daycare_secret="daycare-secret",
                session_secret="session-secret",
                capacity=1,
                container_engine=" ".join(container_command),
                daycare_mount_dir=tmp.name,
            ),
            validate_mount=False,
        )
        setattr(runtime, "_test_tmp", tmp)
        return runtime

    def test_run_action_streams_exec_and_success_exit(self) -> None:
        container_command, image = self._require_runtime_and_image()
        runtime = self._runtime(container_command)
        request = _build_signed_request(action="run", problem_options=[], image=image)

        responses = list(runtime.stream(request, cast(grpc.ServicerContext, _FakeContext())))
        response_kinds = [response.WhichOneof("response") for response in responses]
        self.assertNotIn("error", response_kinds)
        self.assertNotIn("bundle", response_kinds)

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
        self.assertEqual(grade_response.WhichOneof("response"), "bundle")
        signed_bundle = decode_signed_runtime_bundle(grade_response.bundle, "daycare-secret")
        self.assertTrue(grade_response.bundle.signature)
        self.assertTrue(signed_bundle.commit.report_card.passed)
        self.assertEqual(signed_bundle.commit.score, 1.0)
        self.assertGreater(len(signed_bundle.commit.report_card.results), 0)


if __name__ == "__main__":
    unittest.main()
