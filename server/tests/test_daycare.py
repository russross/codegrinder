from __future__ import annotations

import io
import queue
import tarfile
import unittest
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from typing import cast

import grpc

import codegrinder_pb2 as pb
from config import ServerConfig
from daycare import (
    CommandError,
    CommandResult,
    DaycareRuntime,
    TRANSCRIPT_DATA_LIMIT,
    TRANSCRIPT_EVENT_COUNT_LIMIT,
    gather_files_and_step,
    stream_nanny_events,
)
from signatures import decode_signed_grading_commit, encode_signed_grading_commit


def _tar_bytes(files: dict[str, bytes]) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for name, content in files.items():
            info = tarfile.TarInfo(name=name)
            info.type = tarfile.REGTYPE
            info.mode = 0o644
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    return stream.getvalue()


@dataclass(slots=True)
class _PlannedResult:
    result: CommandResult | None = None
    error: str | None = None


def _command_key(args: list[str]) -> str:
    op_index = -1
    for idx, token in enumerate(args):
        if idx + 1 >= len(args):
            break
        if token.split("/")[-1] in ("docker", "podman"):
            op_index = idx + 1
            break
    if op_index >= 0:
        op = args[op_index]
        if op == "cp":
            if len(args) >= op_index + 2 and args[op_index + 1] == "-":
                return "cp_put"
            if len(args) >= op_index + 2 and args[-1] == "-":
                return "cp_get"
        return op
    return "other"


class _FakeRunner:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self._planned: dict[str, list[_PlannedResult]] = {}

    def plan_result(self, key: str, result: CommandResult) -> None:
        self._planned.setdefault(key, []).append(_PlannedResult(result=result))

    def plan_error(self, key: str, error: str) -> None:
        self._planned.setdefault(key, []).append(_PlannedResult(error=error))

    def run(
        self,
        args: list[str],
        *,
        input_bytes: bytes | None = None,
        timeout_seconds: float | None = None,
        cancel_event: object | None = None,
    ) -> CommandResult:
        self.calls.append(list(args))
        if timeout_seconds is not None and timeout_seconds <= 0:
            raise CommandError("command timed out")
        if cancel_event is not None and getattr(cancel_event, "is_set")() is True:
            raise CommandError("command canceled")
        key = _command_key(args)
        queue = self._planned.get(key, [])
        if queue:
            planned = queue.pop(0)
            if planned.error is not None:
                raise CommandError(planned.error)
            if planned.result is not None:
                return planned.result
        if key == "run":
            return CommandResult(returncode=0, stdout=b"container-id\n", stderr=b"")
        if key == "cp_get":
            return CommandResult(returncode=0, stdout=_tar_bytes({}), stderr=b"")
        _ = input_bytes
        return CommandResult(returncode=0, stdout=b"", stderr=b"")


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


def _build_runtime(runner: _FakeRunner) -> DaycareRuntime:
    config = ServerConfig(
        hostname="daycare.example.invalid",
        daycare_secret="daycare-secret",
        capacity=2,
        session_secret="session-secret",
    )
    return DaycareRuntime(config, runner=runner)


def _build_signed_request(
    *,
    hostname: str = "daycare.example.invalid",
    daycare_secret: str = "daycare-secret",
    action: str = "grade",
    parser: str = "",
    updated_at: datetime | None = None,
) -> pb.DaycareRequest:
    now = updated_at or datetime.now(tz=UTC)
    action_entry = pb.ProblemTypeAction(
        command="run-tests",
        parser=parser,
        max_cpu=10,
        max_fd=128,
        max_file_size=2,
        max_memory=128,
        max_threads=16,
    )
    ptype = pb.ProblemType(
        problem_type="python3unittest",
        container="img",
        files={"Makefile": b"all:\n\t@echo ok\n"},
        actions={action: action_entry},
    )
    problem = pb.Problem(
        problem_id="prob-7",
        problem_note="problem note",
        problem_tags=["tag"],
        problem_options=[],
        created_at=now,
        updated_at=now,
    )
    step = pb.ProblemStep(
        problem_id="prob-7",
        step=1,
        problem_type="python3unittest",
        note="step note",
        instructions="step instructions",
        weight=1.0,
        files={"template.txt": b"tmpl\n"},
        whitelist={"main.py": True},
    )
    commit = pb.Commit(
        assignment=pb.AssignmentKey(user_id="123", course_id="c-1", problem_set_id="ps-1"),
        problem_id="prob-7",
        step=1,
        action=action,
        note="",
        files={"main.py": b"print('hello')\n"},
        score=0.0,
        created_at=now,
        updated_at=now,
    )
    bundle = pb.GradingCommit(
        problem_type=ptype,
        problem=problem,
        problem_steps=[step],
        hostname=hostname,
        user_id="123",
        commit=commit,
    )
    return pb.DaycareRequest(
        commit=encode_signed_grading_commit(bundle, daycare_secret),
        problem_type="python3unittest",
        action=action,
        args=[],
    )


class DaycareTests(unittest.TestCase):
    def test_stream_requires_commit(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        with self.assertRaises(_AbortError) as err:
            _ = list(runtime.stream(pb.DaycareRequest(), cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_validate_error_host_mismatch(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        req = _build_signed_request(hostname="other.example.invalid")
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0].WhichOneof("response"), "error")
        self.assertIn("signed for host", responses[0].error)
        self.assertEqual(len(runner.calls), 0)

    def test_validate_error_expired_signature(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        old = datetime.now(tz=UTC) - timedelta(minutes=16)
        req = _build_signed_request(updated_at=old)
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0].WhichOneof("response"), "error")
        self.assertIn("cannot be more than", responses[0].error)
        self.assertEqual(len(runner.calls), 0)

    def test_existing_container_is_removed_then_retried(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        runner.plan_result(
            "run",
            CommandResult(
                returncode=125,
                stdout=b"",
                stderr=b"Error response from daemon: container name is already in use",
            ),
        )
        runner.plan_result("run", CommandResult(returncode=0, stdout=b"retry-container\n", stderr=b""))
        req = _build_signed_request()
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertGreaterEqual(len(responses), 1)
        self.assertEqual(responses[-1].WhichOneof("response"), "commit")
        self.assertEqual(decode_signed_grading_commit(responses[-1].commit, "daycare-secret").commit.score, 1.0)

        run_indices = [i for i, call in enumerate(runner.calls) if _command_key(call) == "run"]
        rm_name_indices = [
            i
            for i, call in enumerate(runner.calls)
            if _command_key(call) == "rm" and len(call) >= 2 and call[-1] == "nanny-123"
        ]
        self.assertEqual(len(run_indices), 2)
        self.assertEqual(len(rm_name_indices), 1)
        self.assertLess(run_indices[0], rm_name_indices[0])
        self.assertLess(rm_name_indices[0], run_indices[1])

    def test_cleanup_still_runs_when_upload_fails(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        runner.plan_result("cp_put", CommandResult(returncode=1, stdout=b"", stderr=b"cp failed"))
        req = _build_signed_request()
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(responses, [])
        cleanup_calls = [
            call
            for call in runner.calls
            if _command_key(call) in ("stop", "wait", "rm") and len(call) >= 2 and call[-1] == "container-id"
        ]
        self.assertEqual([_command_key(call) for call in cleanup_calls], ["stop", "wait", "rm"])
        self.assertEqual(cleanup_calls[0][-1], "container-id")
        self.assertEqual(cleanup_calls[1][-1], "container-id")
        self.assertEqual(cleanup_calls[2][-1], "container-id")

    def test_cleanup_order_and_container_id_on_success(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        req = _build_signed_request()
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(responses[-1].WhichOneof("response"), "commit")
        cleanup_calls = [
            call
            for call in runner.calls
            if _command_key(call) in ("stop", "wait", "rm") and len(call) >= 2 and call[-1] == "container-id"
        ]
        self.assertEqual([_command_key(call) for call in cleanup_calls], ["stop", "wait", "rm"])
        self.assertTrue(all(call[-1] == "container-id" for call in cleanup_calls))

    def test_logs_container_usage_summary(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        req = _build_signed_request()
        with patch("daycare.logging.info") as info_log:
            _ = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        seen = False
        for call in info_log.call_args_list:
            if len(call.args) == 0:
                continue
            if isinstance(call.args[0], str) and call.args[0].startswith("container usage summary "):
                seen = True
                break
        self.assertTrue(seen)

    def test_cleanup_continues_when_stop_errors(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        runner.plan_error("stop", "simulated stop failure")
        req = _build_signed_request()
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(responses[-1].WhichOneof("response"), "commit")
        cleanup_calls = [
            call
            for call in runner.calls
            if _command_key(call) in ("stop", "wait", "rm") and len(call) >= 2 and call[-1] == "container-id"
        ]
        self.assertEqual([_command_key(call) for call in cleanup_calls], ["stop", "wait", "rm"])

    def test_non_grade_action_does_not_emit_commit(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        req = _build_signed_request(action="run")
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertGreaterEqual(len(responses), 1)
        for response in responses:
            self.assertNotEqual(response.WhichOneof("response"), "commit")

    def test_exec_error_still_emits_signed_grade_bundle(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        runner.plan_error("exec", "simulated exec startup failure")
        req = _build_signed_request()
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(responses[-1].WhichOneof("response"), "commit")
        signed = decode_signed_grading_commit(responses[-1].commit, "daycare-secret")
        self.assertAlmostEqual(signed.commit.score, 0.0)
        self.assertTrue(responses[-1].commit.signature)
        self.assertIn("exec error", signed.commit.report_card.note)
        ops = [_command_key(call) for call in runner.calls]
        self.assertIn("stop", ops)
        self.assertIn("wait", ops)
        self.assertIn("rm", ops)

    def test_invalid_step_number_returns_error_without_docker(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        req = _build_signed_request()
        decoded = decode_signed_grading_commit(req.commit, "daycare-secret")
        decoded.commit.step = 2
        req.commit.CopyFrom(encode_signed_grading_commit(decoded, "daycare-secret"))
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0].WhichOneof("response"), "error")
        self.assertIn("error gathering files", responses[0].error)
        self.assertEqual(len(runner.calls), 0)

    def test_daycare_uses_doas_podman_by_default(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        req = _build_signed_request()
        _ = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertGreater(len(runner.calls), 0)
        run_call = next(call for call in runner.calls if len(call) >= 3 and call[2] == "run")
        self.assertEqual(run_call[0], "doas")
        self.assertEqual(run_call[1], "podman")
        self.assertIn("localhost/img", run_call)
        self.assertIn("--pull=never", run_call)

    def test_daycare_uses_configured_doas_podman_prefix(self) -> None:
        runner = _FakeRunner()
        runtime = DaycareRuntime(
            ServerConfig(
                hostname="daycare.example.invalid",
                daycare_secret="daycare-secret",
                capacity=2,
                session_secret="session-secret",
                container_engine="doas podman",
            ),
            runner=runner,
        )
        req = _build_signed_request()
        _ = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertGreater(len(runner.calls), 0)
        run_call = next(call for call in runner.calls if len(call) >= 3 and call[2] == "run")
        self.assertEqual(run_call[0], "doas")
        self.assertEqual(run_call[1], "podman")
        self.assertIn("localhost/img", run_call)
        self.assertIn("--pull=never", run_call)

    def test_daycare_does_not_prefix_images_for_non_podman_runtime(self) -> None:
        runner = _FakeRunner()
        runtime = DaycareRuntime(
            ServerConfig(
                hostname="daycare.example.invalid",
                daycare_secret="daycare-secret",
                capacity=2,
                session_secret="session-secret",
                container_engine="docker",
            ),
            runner=runner,
        )
        req = _build_signed_request()
        _ = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertGreater(len(runner.calls), 0)
        run_call = next(call for call in runner.calls if _command_key(call) == "run")
        self.assertEqual(run_call[0], "docker")
        self.assertIn("img", run_call)
        self.assertNotIn("localhost/img", run_call)
        self.assertIn("--pull=never", run_call)

    def test_daycare_podman_falls_back_when_localhost_image_missing(self) -> None:
        runner = _FakeRunner()
        runtime = DaycareRuntime(
            ServerConfig(
                hostname="daycare.example.invalid",
                daycare_secret="daycare-secret",
                capacity=2,
                session_secret="session-secret",
                container_engine="doas podman",
            ),
            runner=runner,
        )
        runner.plan_result(
            "run",
            CommandResult(
                returncode=125,
                stdout=b"",
                stderr=b"Error: image not known",
            ),
        )
        runner.plan_result("run", CommandResult(returncode=0, stdout=b"container-id\n", stderr=b""))
        req = _build_signed_request()
        _ = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertGreater(len(runner.calls), 0)
        run_calls = [call for call in runner.calls if len(call) >= 3 and call[2] == "run"]
        self.assertEqual(len(run_calls), 2)
        self.assertEqual(run_calls[0][-3], "localhost/img")
        self.assertEqual(run_calls[1][-3], "img")

    def test_daycare_podman_image_resolution_is_cached_per_runtime(self) -> None:
        runner = _FakeRunner()
        runtime = DaycareRuntime(
            ServerConfig(
                hostname="daycare.example.invalid",
                daycare_secret="daycare-secret",
                capacity=2,
                session_secret="session-secret",
                container_engine="doas podman",
            ),
            runner=runner,
        )
        runner.plan_result(
            "run",
            CommandResult(
                returncode=125,
                stdout=b"",
                stderr=b"Error: image not known",
            ),
        )
        runner.plan_result("run", CommandResult(returncode=0, stdout=b"container-id-1\n", stderr=b""))
        runner.plan_result("run", CommandResult(returncode=0, stdout=b"container-id-2\n", stderr=b""))
        req = _build_signed_request()
        _ = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        _ = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        run_calls = [call for call in runner.calls if len(call) >= 3 and call[2] == "run"]
        self.assertEqual(len(run_calls), 3)
        self.assertEqual(run_calls[0][-3], "localhost/img")
        self.assertEqual(run_calls[1][-3], "img")
        self.assertEqual(run_calls[2][-3], "img")

    def test_daycare_podman_missing_image_fails_after_local_candidates(self) -> None:
        runner = _FakeRunner()
        runtime = DaycareRuntime(
            ServerConfig(
                hostname="daycare.example.invalid",
                daycare_secret="daycare-secret",
                capacity=2,
                session_secret="session-secret",
                container_engine="doas podman",
            ),
            runner=runner,
        )
        runner.plan_result(
            "run",
            CommandResult(
                returncode=125,
                stdout=b"",
                stderr=b"Error: image not known",
            ),
        )
        runner.plan_result(
            "run",
            CommandResult(
                returncode=125,
                stdout=b"",
                stderr=b"Error: image not known",
            ),
        )
        req = _build_signed_request()
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0].WhichOneof("response"), "error")
        self.assertIn("container image not found in local store", responses[0].error)
        run_calls = [call for call in runner.calls if _command_key(call) == "run"]
        self.assertEqual(len(run_calls), 2)
        self.assertTrue(all("--pull=never" in call for call in run_calls))

    def test_xunit_parser_updates_report_card_and_score(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        xunit = (
            b'<testsuites><testsuite name="suite" tests="2" failures="1" skipped="0" errors="0">'
            b'<testcase classname="cls" name="ok"/>'
            b'<testcase classname="cls" name="bad"><failure>boom</failure></testcase>'
            b"</testsuite></testsuites>"
        )
        runner.plan_result("cp_get", CommandResult(returncode=0, stdout=_tar_bytes({"test_detail.xml": xunit}), stderr=b""))
        req = _build_signed_request(parser="xunit")
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(responses[-1].WhichOneof("response"), "commit")
        signed = decode_signed_grading_commit(responses[-1].commit, "daycare-secret")
        self.assertEqual(len(signed.commit.report_card.results), 2)
        self.assertAlmostEqual(signed.commit.score, 0.5)

    def test_gather_files_and_step_merge_order(self) -> None:
        req = _build_signed_request()
        step, merged = gather_files_and_step(decode_signed_grading_commit(req.commit, "daycare-secret"))
        self.assertEqual(step.step, 1)
        self.assertIn("Makefile", merged)
        self.assertIn("template.txt", merged)
        self.assertEqual(merged["main.py"], b"print('hello')\n")

    def test_stream_nanny_events_merges_stdout_and_applies_event_limit(self) -> None:
        event_q: queue.Queue[pb.EventMessage | None] = queue.Queue()
        commit = pb.Commit()
        responses: list[pb.DaycareResponse] = []

        event_q.put(pb.EventMessage(event="stdout", stream_data=b"a"))
        event_q.put(pb.EventMessage(event="stdout", stream_data=b"b"))
        for idx in range(TRANSCRIPT_EVENT_COUNT_LIMIT + 3):
            event_q.put(pb.EventMessage(event="exec", exec_command=[f"cmd-{idx}"]))
        event_q.put(None)

        stream_nanny_events(events=event_q, commit=commit, emit_response=responses.append)
        self.assertEqual(commit.transcript[0].event, "stdout")
        self.assertEqual(commit.transcript[0].stream_data, b"ab")
        self.assertEqual(len(commit.transcript), TRANSCRIPT_EVENT_COUNT_LIMIT)
        self.assertEqual(len(responses), TRANSCRIPT_EVENT_COUNT_LIMIT + 5)

    def test_stream_nanny_events_applies_data_limit_after_large_stream(self) -> None:
        event_q: queue.Queue[pb.EventMessage | None] = queue.Queue()
        commit = pb.Commit()
        responses: list[pb.DaycareResponse] = []
        event_q.put(pb.EventMessage(event="stdout", stream_data=b"a" * (TRANSCRIPT_DATA_LIMIT + 1)))
        event_q.put(pb.EventMessage(event="stdout", stream_data=b"b"))
        event_q.put(None)

        stream_nanny_events(events=event_q, commit=commit, emit_response=responses.append)
        self.assertEqual(len(commit.transcript), 1)
        self.assertEqual(commit.transcript[0].event, "stdout")
        self.assertEqual(len(commit.transcript[0].stream_data), TRANSCRIPT_DATA_LIMIT + 1)
        self.assertEqual(len(responses), 2)

    def test_runtime_applies_problem_option_resource_overrides(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        req = _build_signed_request()
        decoded = decode_signed_grading_commit(req.commit, "daycare-secret")
        decoded.problem.problem_options[:] = [
            "maxCPU=3",
            "maxFileSize=7",
            "maxMemory=64",
            "maxThreads=9",
        ]
        req.commit.CopyFrom(encode_signed_grading_commit(decoded, "daycare-secret"))
        _ = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        run_call = next(call for call in runner.calls if _command_key(call) == "run")
        self.assertIn("--memory", run_call)
        self.assertIn("64m", run_call)
        self.assertIn("--pids-limit", run_call)
        self.assertIn("9", run_call)
        self.assertIn("cpu=3", run_call)
        self.assertIn(f"fsize={7 * 1024 * 1024}", run_call)
        self.assertIn("6s", run_call)

    def test_unknown_parser_marks_grade_failed_and_returns_signed_bundle(self) -> None:
        runner = _FakeRunner()
        runtime = _build_runtime(runner)
        req = _build_signed_request(parser="unknown-parser")
        responses = list(runtime.stream(req, cast(grpc.ServicerContext, _FakeContext())))
        self.assertEqual(responses[-1].WhichOneof("response"), "commit")
        signed = decode_signed_grading_commit(responses[-1].commit, "daycare-secret")
        self.assertFalse(signed.commit.report_card.passed)
        self.assertIn("unknown parser", signed.commit.report_card.note)
        self.assertEqual(signed.commit.score, 0.0)
        self.assertTrue(responses[-1].commit.signature)


if __name__ == "__main__":
    unittest.main()
