from __future__ import annotations

import fnmatch
import io
import json
import logging
import queue
import re
import shlex
import subprocess
import tarfile
import threading
import time
import xml.etree.ElementTree as et
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Callable, Iterator, Protocol

import grpc

import codegrinder_pb2 as pb
from config import ServerConfig
from mutations import (
    compute_commit_signature,
    compute_problem_signature,
    compute_problem_type_signature,
)
from proto_conv import parse_time
from timeutils import format_duration_for_log

DEFAULT_CONTAINER_ENGINE = "podman"
STUDENT_UID = 1001
SIGNED_REQUEST_MAX_AGE = timedelta(minutes=15)
TRANSCRIPT_EVENT_COUNT_LIMIT = 500
TRANSCRIPT_DATA_LIMIT = 100_000

_FORWARDED_EVENT_TYPES = {"exec", "exit", "stdin", "stdout", "stderr", "stdinclosed", "error", "files"}
_STREAM_EVENT_TYPES = {"stdin", "stdout", "stderr"}

_TEST_FAILURE_CONTEXT_GTEST = re.compile(r"^(tests/[^:/]*:\d+)")
_TEST_FAILURE_CONTEXT_PYTHON = re.compile(r'File "[^"]*/([^/]+)", line (\d+)')


def _now_utc() -> datetime:
    return datetime.now(tz=UTC)


def _set_timestamp(dst: object, value: datetime) -> None:
    dst.FromDatetime(value.astimezone(UTC))  # type: ignore[attr-defined]


def _ts_to_datetime(ts: object) -> datetime:
    if hasattr(ts, "ToDatetime"):
        dt = ts.ToDatetime(tzinfo=UTC)  # type: ignore[attr-defined]
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    return parse_time(ts)


def _duration_string(value: timedelta) -> str:
    return format_duration_for_log(value)


def _uses_podman(container_command: list[str]) -> bool:
    for token in container_command:
        if token.strip().split("/")[-1] == "podman":
            return True
    return False


def _resolve_container_image(image: str, *, container_command: list[str]) -> str:
    if image == "":
        return image
    if not _uses_podman(container_command):
        return image
    first = image.split("/", 1)[0]
    if "." in first or ":" in first or first == "localhost":
        return image
    return f"localhost/{image}"


def _image_candidates_for_runtime(image: str, *, container_command: list[str]) -> list[str]:
    if image == "":
        return [image]
    if not _uses_podman(container_command):
        return [image]
    rewritten = _resolve_container_image(image, container_command=container_command)
    if rewritten == image:
        return [image]
    return [rewritten, image]


def _is_missing_local_image_error(message: str) -> bool:
    text = message.lower()
    return (
        "image not known" in text
        or "no such image" in text
        or "image not found" in text
        or "unable to find image" in text
        or "manifest unknown" in text
    )


def _event_message(
    event: str,
    *,
    exec_command: list[str] | None = None,
    exit_status: int | None = None,
    stream_data: bytes | None = None,
    error: str | None = None,
    files: dict[str, bytes] | None = None,
) -> pb.EventMessage:
    msg = pb.EventMessage(event=event)
    _set_timestamp(msg.time, _now_utc())
    if exec_command is not None:
        msg.exec_command[:] = exec_command
    if exit_status is not None:
        msg.exit_status = exit_status
    if stream_data is not None:
        msg.stream_data = stream_data
    if error is not None:
        msg.error = error
    if files is not None:
        msg.files.update(files)
    return msg


def _report_card_new() -> pb.ReportCard:
    return pb.ReportCard(passed=True)


def _report_card_log_and_fail(report_card: pb.ReportCard, message: str) -> None:
    logging.info(message)
    report_card.passed = False
    if report_card.note:
        report_card.note = f"{report_card.note}, {message}"
    else:
        report_card.note = message


def _report_card_add_failed(report_card: pb.ReportCard, name: str, details: str, context: str) -> None:
    report_card.passed = False
    report_card.results.append(
        pb.ReportCardResult(
            name=name,
            outcome="failed",
            details=details,
            context=context,
        )
    )


def _report_card_add_passed(report_card: pb.ReportCard, name: str, details: str) -> None:
    report_card.results.append(
        pb.ReportCardResult(
            name=name,
            outcome="passed",
            details=details,
        )
    )


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


def _first_child(element: et.Element, local_name: str) -> et.Element | None:
    for child in list(element):
        if _local_name(child.tag) == local_name:
            return child
    return None


def _attr_int(element: et.Element, key: str) -> int:
    raw = element.attrib.get(key, "").strip()
    if raw == "":
        return 0
    try:
        return int(raw)
    except ValueError:
        return 0


def _attr_float(element: et.Element, key: str) -> float:
    raw = element.attrib.get(key, "").strip()
    if raw == "":
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


class CommandError(RuntimeError):
    pass


@dataclass(slots=True)
class CommandResult:
    returncode: int
    stdout: bytes
    stderr: bytes


class CommandRunner(Protocol):
    def run(
        self,
        args: list[str],
        *,
        input_bytes: bytes | None = None,
        timeout_seconds: float | None = None,
        cancel_event: threading.Event | None = None,
    ) -> CommandResult: ...


class SubprocessCommandRunner:
    def run(
        self,
        args: list[str],
        *,
        input_bytes: bytes | None = None,
        timeout_seconds: float | None = None,
        cancel_event: threading.Event | None = None,
    ) -> CommandResult:
        if timeout_seconds is not None and timeout_seconds <= 0:
            raise CommandError("command timed out before start")
        stdin = subprocess.PIPE if input_bytes is not None else None
        try:
            proc = subprocess.Popen(
                args,
                stdin=stdin,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError as exc:
            raise CommandError(f"failed to start command {args!r}: {exc}") from exc

        provided_input: bytes | None = input_bytes
        start = time.monotonic()
        while True:
            if cancel_event is not None and cancel_event.is_set():
                proc.kill()
                _ = proc.communicate()
                raise CommandError("command canceled")
            remaining: float | None
            if timeout_seconds is None:
                remaining = None
            else:
                elapsed = time.monotonic() - start
                remaining = timeout_seconds - elapsed
                if remaining <= 0:
                    proc.kill()
                    _ = proc.communicate()
                    raise CommandError("command timed out")
            try:
                if remaining is None:
                    stdout, stderr = proc.communicate(input=provided_input)
                else:
                    stdout, stderr = proc.communicate(input=provided_input, timeout=min(0.1, remaining))
                break
            except subprocess.TimeoutExpired:
                provided_input = None
                continue
        return CommandResult(returncode=int(proc.returncode or 0), stdout=stdout, stderr=stderr)


@dataclass(slots=True)
class Limits:
    max_cpu: int
    max_session: int
    max_timeout: int
    max_fd: int
    max_file_size: int
    max_memory: int
    max_threads: int

    @classmethod
    def from_action(cls, action: pb.ProblemTypeAction) -> Limits:
        return cls(
            max_cpu=int(action.max_cpu),
            max_session=int(action.max_session),
            max_timeout=int(action.max_timeout),
            max_fd=int(action.max_fd),
            max_file_size=int(action.max_file_size),
            max_memory=int(action.max_memory),
            max_threads=int(action.max_threads),
        )

    def override(self, options: list[str]) -> None:
        for option in options:
            if "=" not in option:
                continue
            key, raw_value = option.split("=", 1)
            key = key.strip()
            try:
                parsed = int(raw_value.strip())
            except ValueError:
                continue
            if key == "maxCPU":
                self.max_cpu = parsed
            elif key == "maxSession":
                self.max_session = parsed
            elif key == "maxTimeout":
                self.max_timeout = parsed
            elif key == "maxFD":
                self.max_fd = parsed
            elif key == "maxFileSize":
                self.max_file_size = parsed
            elif key == "maxMemory":
                self.max_memory = parsed
            elif key == "maxThreads":
                self.max_threads = parsed


class Nanny:
    def __init__(
        self,
        *,
        runner: CommandRunner,
        container_command: list[str],
        user_id: int,
        name: str,
        container_id: str,
        cgroup_path: Path | None,
        action_deadline_monotonic: float,
        cancel_event: threading.Event,
    ) -> None:
        self._runner = runner
        self._container_command = tuple(container_command)
        self._user_id = user_id
        self._name = name
        self._container_id = container_id
        self._cgroup_path = cgroup_path
        self._action_deadline_monotonic = action_deadline_monotonic
        self._cancel_event = cancel_event
        self._start_monotonic = time.monotonic()
        self._action_exit_status: int | None = None
        self.report_card = _report_card_new()
        self.events: queue.Queue[pb.EventMessage | None] = queue.Queue(maxsize=100)
        self._closed = False
        self._files_cache: dict[str, bytes] | None = None

    @property
    def name(self) -> str:
        return self._name

    @property
    def container_id(self) -> str:
        return self._container_id

    def elapsed(self) -> timedelta:
        return timedelta(seconds=max(0.0, time.monotonic() - self._start_monotonic))

    def emit_event(self, event: pb.EventMessage) -> None:
        self.events.put(event)

    def close_events(self) -> None:
        self.events.put(None)

    @classmethod
    def create(
        cls,
        *,
        runner: CommandRunner,
        container_command: list[str],
        user_id: int,
        image: str,
        problem_type: pb.ProblemType,
        problem: pb.Problem,
        action: str,
        limits: Limits,
        name: str,
        args: list[str],
        action_deadline_monotonic: float,
        cancel_event: threading.Event,
    ) -> Nanny:
        disk_bytes = max(0, int(limits.max_file_size)) * 1024 * 1024
        time_limit_seconds = max(0, int(limits.max_cpu)) * 2
        memory = f"{int(limits.max_memory)}m"
        command = [
            *container_command,
            "run",
            "-d",
            "--pull=never",
            "--name",
            name,
            "--hostname",
            name,
            "--user",
            f"{STUDENT_UID}:{STUDENT_UID}",
            "--net=none",
            "--memory",
            memory,
            "--memory-swap",
            memory,
            "--pids-limit",
            str(int(limits.max_threads)),
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--ulimit",
            "core=0:0",
            "--ulimit",
            f"cpu={int(limits.max_cpu)}",
            "--ulimit",
            f"fsize={disk_bytes}",
            image,
            "/bin/sleep",
            f"{time_limit_seconds}s",
        ]
        if len(args) == 0:
            logging.info(
                "new container %s; action %s on %s (%s); params cpu=%d, fd=%d, file=%d, mem=%d, threads=%d",
                name,
                action,
                problem.unique,
                problem_type.name,
                limits.max_cpu,
                limits.max_fd,
                limits.max_file_size,
                limits.max_memory,
                limits.max_threads,
            )
        else:
            logging.info(
                "new container %s; action %s on %s (%s); params cpu=%d, fd=%d, file=%d, mem=%d, threads=%d args=%s",
                name,
                action,
                problem.unique,
                problem_type.name,
                limits.max_cpu,
                limits.max_fd,
                limits.max_file_size,
                limits.max_memory,
                limits.max_threads,
                args,
            )
        result = _run_with_action_timeout(
            runner,
            command,
            action_deadline_monotonic=action_deadline_monotonic,
            cancel_event=cancel_event,
        )
        if result.returncode != 0:
            output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
            if "is already in use" in output:
                logging.info("killing existing container with same name %s", name)
                _remove_container_action_scope(
                    runner,
                    container_command=container_command,
                    id_or_name=name,
                    action_deadline_monotonic=action_deadline_monotonic,
                    cancel_event=cancel_event,
                )
                result = _run_with_action_timeout(
                    runner,
                    command,
                    action_deadline_monotonic=action_deadline_monotonic,
                    cancel_event=cancel_event,
                )
            if result.returncode != 0:
                output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
                raise CommandError(f"container run failed: exit={result.returncode}; output={output}")
        container_id = result.stdout.decode("utf-8", errors="replace").strip()
        if container_id == "":
            raise CommandError("container run failed: empty container ID")
        cgroup_path: Path | None = None
        try:
            cgroup_path = _resolve_container_cgroup_path(
                runner,
                container_command=tuple(container_command),
                container_id=container_id,
            )
        except Exception as exc:
            logging.info("could not resolve cgroup path for container %s: %s", container_id, exc)
        return cls(
            runner=runner,
            container_command=container_command,
            user_id=user_id,
            name=name,
            container_id=container_id,
            cgroup_path=cgroup_path,
            action_deadline_monotonic=action_deadline_monotonic,
            cancel_event=cancel_event,
        )

    def shutdown(self, _message: str) -> None:
        if self._closed:
            return
        self._closed = True
        cleanup_deadline = time.monotonic() + 5.0
        errors: list[str] = []
        usage = _CgroupUsage()
        if self._cgroup_path is not None:
            usage = _collect_cgroup_usage(self._cgroup_path)
        for step_name, args in (
            ("stop", [*self._container_command, "stop", "--time", "1", self._container_id]),
            ("wait", [*self._container_command, "wait", self._container_id]),
        ):
            try:
                _ = _run_with_cleanup_timeout(
                    self._runner,
                    args,
                    cleanup_deadline_monotonic=cleanup_deadline,
                )
            except CommandError as exc:
                errors.append(f"{step_name}: {exc}")

        _log_container_usage_summary(
            self._runner,
            container_command=self._container_command,
            name=self._name,
            container_id=self._container_id,
            cgroup_path=self._cgroup_path,
            usage=usage,
            action_exit=self._action_exit_status,
        )

        try:
            _ = _run_with_cleanup_timeout(
                self._runner,
                [*self._container_command, "rm", "-f", self._container_id],
                cleanup_deadline_monotonic=cleanup_deadline,
            )
        except CommandError as exc:
            errors.append(f"rm: {exc}")
        if errors:
            raise CommandError("; ".join(errors))

    def put_files(self, files: dict[str, bytes], mode: int) -> None:
        if len(files) == 0:
            return
        tar_bytes = _tar_bytes(files, mode=mode)
        result = _run_with_action_timeout(
            self._runner,
            [*self._container_command, "cp", "-", f"{self._container_id}:/home/student/"],
            input_bytes=tar_bytes,
            action_deadline_monotonic=self._action_deadline_monotonic,
            cancel_event=self._cancel_event,
        )
        if result.returncode != 0:
            output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
            raise CommandError(f"container cp failed: exit={result.returncode}; output={output}")

    def get_files(self, filenames: list[str]) -> dict[str, bytes]:
        if len(filenames) == 0:
            return {}
        if self._files_cache is None:
            if self._closed:
                raise CommandError("cannot fetch files, container is closed")
            result = _run_with_action_timeout(
                self._runner,
                [*self._container_command, "cp", f"{self._container_id}:/home/student/.", "-"],
                action_deadline_monotonic=self._action_deadline_monotonic,
                cancel_event=self._cancel_event,
            )
            if result.returncode != 0:
                output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
                raise CommandError(f"container cp from container failed: exit={result.returncode}; output={output}")
            self._files_cache = _untar_bytes(result.stdout)

        selected: dict[str, bytes] = {}
        for name, contents in self._files_cache.items():
            for pattern in filenames:
                if fnmatch.fnmatchcase(name, pattern):
                    selected[name] = contents
                    break
        return selected

    def exec_command(self, cmd: list[str]) -> int:
        self.emit_event(_event_message("exec", exec_command=cmd))
        result = _run_with_action_timeout(
            self._runner,
            [*self._container_command, "exec", "--user", str(STUDENT_UID), self._container_id, *cmd],
            action_deadline_monotonic=self._action_deadline_monotonic,
            cancel_event=self._cancel_event,
        )
        if result.stdout:
            self.emit_event(_event_message("stdout", stream_data=result.stdout))
        if result.stderr:
            self.emit_event(_event_message("stderr", stream_data=result.stderr))
        self.emit_event(_event_message("exit", exit_status=result.returncode))
        self._action_exit_status = result.returncode
        return result.returncode


def _remove_container_action_scope(
    runner: CommandRunner,
    *,
    container_command: list[str],
    id_or_name: str,
    action_deadline_monotonic: float,
    cancel_event: threading.Event,
) -> None:
    _ = _run_with_action_timeout(
        runner,
        [*container_command, "rm", "-f", id_or_name],
        action_deadline_monotonic=action_deadline_monotonic,
        cancel_event=cancel_event,
    )


def _run_with_action_timeout(
    runner: CommandRunner,
    args: list[str],
    *,
    input_bytes: bytes | None = None,
    action_deadline_monotonic: float,
    cancel_event: threading.Event,
) -> CommandResult:
    remaining = action_deadline_monotonic - time.monotonic()
    if remaining <= 0:
        raise CommandError("action timed out")
    return runner.run(
        args,
        input_bytes=input_bytes,
        timeout_seconds=remaining,
        cancel_event=cancel_event,
    )


def _run_with_cleanup_timeout(
    runner: CommandRunner,
    args: list[str],
    *,
    cleanup_deadline_monotonic: float,
) -> CommandResult:
    remaining = cleanup_deadline_monotonic - time.monotonic()
    if remaining <= 0:
        raise CommandError("cleanup timed out")
    return runner.run(
        args,
        timeout_seconds=remaining,
        cancel_event=None,
    )


@dataclass(slots=True)
class _CgroupUsage:
    mem_peak: int = -1
    pids_peak: int = -1
    cpu_usage_usec: int = -1
    cpu_user_usec: int = -1
    cpu_system_usec: int = -1
    mem_oom: int = 0
    mem_oom_kill: int = 0
    mem_max: int = 0
    mem_high: int = 0
    errs: str = ""


def _append_err(existing: str, next_err: str) -> str:
    if next_err == "":
        return existing
    if existing == "":
        return next_err
    return f"{existing}; {next_err}"


def _read_cgroup_int(path: Path) -> int:
    raw = path.read_text(encoding="utf-8").strip()
    if raw in ("", "max"):
        return -1
    return int(raw)


def _read_cgroup_kv(path: Path) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if len(fields) != 2:
            continue
        try:
            out[fields[0]] = int(fields[1])
        except ValueError:
            continue
    return out


def _resolve_container_cgroup_path(runner: CommandRunner, *, container_command: tuple[str, ...], container_id: str) -> Path:
    result = runner.run([*container_command, "inspect", "--format", "{{.State.Pid}}", container_id], timeout_seconds=2.0)
    if result.returncode != 0:
        output = (result.stdout + result.stderr).decode("utf-8", errors="replace").strip()
        raise CommandError(f"inspect pid failed: {output}")
    pid = result.stdout.decode("utf-8", errors="replace").strip()
    if pid in ("", "0"):
        raise CommandError(f"invalid pid from inspect: {pid!r}")
    cgroup_path = Path("/proc") / pid / "cgroup"
    data = cgroup_path.read_text(encoding="utf-8")
    for line in data.splitlines():
        parts = line.split(":", 2)
        if len(parts) != 3:
            continue
        if parts[0] == "0" and parts[1] == "":
            return Path("/sys/fs/cgroup") / parts[2].lstrip("/")
    raise CommandError(f"cgroup v2 path not found in /proc/{pid}/cgroup")


def _collect_cgroup_usage(cgroup_path: Path) -> _CgroupUsage:
    usage = _CgroupUsage()
    try:
        usage.mem_peak = _read_cgroup_int(cgroup_path / "memory.peak")
    except FileNotFoundError:
        pass
    except Exception as exc:
        usage.errs = _append_err(usage.errs, f"memory.peak: {exc}")
    try:
        usage.pids_peak = _read_cgroup_int(cgroup_path / "pids.peak")
    except FileNotFoundError:
        pass
    except Exception as exc:
        usage.errs = _append_err(usage.errs, f"pids.peak: {exc}")
    try:
        stats = _read_cgroup_kv(cgroup_path / "cpu.stat")
        usage.cpu_usage_usec = int(stats.get("usage_usec", -1))
        usage.cpu_user_usec = int(stats.get("user_usec", -1))
        usage.cpu_system_usec = int(stats.get("system_usec", -1))
    except FileNotFoundError:
        pass
    except Exception as exc:
        usage.errs = _append_err(usage.errs, f"cpu.stat: {exc}")
    try:
        vals = _read_cgroup_kv(cgroup_path / "memory.events")
        usage.mem_oom = int(vals.get("oom", 0))
        usage.mem_oom_kill = int(vals.get("oom_kill", 0))
        usage.mem_max = int(vals.get("max", 0))
        usage.mem_high = int(vals.get("high", 0))
    except FileNotFoundError:
        pass
    except Exception as exc:
        usage.errs = _append_err(usage.errs, f"memory.events: {exc}")
    return usage


def _human_bytes(n: int) -> str:
    if n < 0:
        return "-1"
    if n < 1024:
        return f"{n}b"
    value = float(n)
    if n < 1024 * 1024:
        return f"{value / 1024.0:.1f}k"
    if n < 1024 * 1024 * 1024:
        return f"{value / (1024.0 * 1024.0):.1f}m"
    if n < 1024 * 1024 * 1024 * 1024:
        return f"{value / (1024.0 * 1024.0 * 1024.0):.1f}g"
    return f"{value / (1024.0 * 1024.0 * 1024.0 * 1024.0):.1f}t"


def _human_usec(usec: int) -> str:
    if usec < 0:
        return "-1"
    return format_duration_for_log(timedelta(microseconds=usec))


def _duration_from_strings(started_at: str, finished_at: str) -> str:
    if started_at == "" or finished_at == "":
        return ""
    started_raw = started_at[:-1] + "+00:00" if started_at.endswith("Z") else started_at
    finished_raw = finished_at[:-1] + "+00:00" if finished_at.endswith("Z") else finished_at
    try:
        start = datetime.fromisoformat(started_raw)
        finish = datetime.fromisoformat(finished_raw)
    except ValueError:
        return ""
    if finish < start:
        return ""
    return format_duration_for_log(finish - start)


def _log_container_usage_summary(
    runner: CommandRunner,
    *,
    container_command: tuple[str, ...],
    name: str,
    container_id: str,
    cgroup_path: Path | None,
    usage: _CgroupUsage | None = None,
    action_exit: int | None = None,
) -> None:
    usage_data = usage if usage is not None else _CgroupUsage()
    inspect_error = ""
    state: dict[str, object] = {}
    if usage is None and cgroup_path is not None:
        try:
            usage_data = _collect_cgroup_usage(cgroup_path)
        except Exception as exc:
            usage_data.errs = _append_err(usage_data.errs, str(exc))

    try:
        inspect_result = runner.run([*container_command, "inspect", container_id], timeout_seconds=2.0)
        if inspect_result.returncode != 0:
            inspect_error = (inspect_result.stdout + inspect_result.stderr).decode("utf-8", errors="replace").strip()
        else:
            docs_raw = inspect_result.stdout.decode("utf-8", errors="replace")
            docs = json.loads(docs_raw)
            if isinstance(docs, list) and len(docs) > 0 and isinstance(docs[0], dict):
                maybe_state = docs[0].get("State")
                if isinstance(maybe_state, dict):
                    state = maybe_state
    except Exception as exc:
        inspect_error = str(exc)

    parts = [
        f"name={name}",
    ]
    if action_exit is not None:
        parts.append(f"action_exit={action_exit}")
    if usage_data.mem_peak >= 0:
        parts.append(f"mem_peak={_human_bytes(usage_data.mem_peak)}")
    if usage_data.cpu_usage_usec >= 0:
        parts.append(f"cpu={_human_usec(usage_data.cpu_usage_usec)}")
    if usage_data.cpu_user_usec >= 0:
        parts.append(f"cpu_user={_human_usec(usage_data.cpu_user_usec)}")
    if usage_data.cpu_system_usec >= 0:
        parts.append(f"cpu_system={_human_usec(usage_data.cpu_system_usec)}")
    if usage_data.pids_peak >= 0:
        parts.append(f"pids_peak={usage_data.pids_peak}")
    status = str(state.get("Status", "") or "")
    if status not in ("", "exited"):
        parts.append(f"status={status}")
    duration = _duration_from_strings(str(state.get("StartedAt", "") or ""), str(state.get("FinishedAt", "") or ""))
    if duration != "":
        parts.append(f"duration={duration}")
    if bool(state.get("OOMKilled", False)):
        parts.append("oomkilled=true")
    if usage_data.mem_oom > 0:
        parts.append(f"mem_events_oom={usage_data.mem_oom}")
    if usage_data.mem_oom_kill > 0:
        parts.append(f"mem_events_oom_kill={usage_data.mem_oom_kill}")
    if usage_data.mem_max > 0:
        parts.append(f"mem_events_max={usage_data.mem_max}")
    if usage_data.mem_high > 0:
        parts.append(f"mem_events_high={usage_data.mem_high}")
    if inspect_error != "":
        parts.append(f"inspect_err={inspect_error}")
    if usage_data.errs != "":
        parts.append(f"cgroup_err={usage_data.errs}")
    logging.info("container usage summary %s", " ".join(parts))


def _tar_bytes(files: dict[str, bytes], mode: int) -> bytes:
    stream = io.BytesIO()
    nowish = _now_utc() - timedelta(seconds=1)
    created_dirs: set[str] = set()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for raw_name, raw_content in files.items():
            path = PurePosixPath(raw_name)
            if str(path) in ("", "."):
                continue
            parts = list(path.parents)
            parts.reverse()
            for part in parts:
                if str(part) in ("", "."):
                    continue
                dir_name = str(part)
                if dir_name in created_dirs:
                    continue
                created_dirs.add(dir_name)
                info = tarfile.TarInfo(name=dir_name)
                info.type = tarfile.DIRTYPE
                info.mode = 0o777
                info.uid = STUDENT_UID
                info.gid = STUDENT_UID
                info.uname = str(STUDENT_UID)
                info.gname = str(STUDENT_UID)
                info.mtime = int(nowish.timestamp())
                archive.addfile(info)

            content = bytes(raw_content or b"")
            file_info = tarfile.TarInfo(name=str(path))
            file_info.type = tarfile.REGTYPE
            file_info.mode = mode
            file_info.uid = STUDENT_UID
            file_info.gid = STUDENT_UID
            file_info.uname = str(STUDENT_UID)
            file_info.gname = str(STUDENT_UID)
            file_info.mtime = int(nowish.timestamp())
            file_info.size = len(content)
            archive.addfile(file_info, io.BytesIO(content))
    return stream.getvalue()


def _untar_bytes(data: bytes) -> dict[str, bytes]:
    result: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            fileobj = archive.extractfile(member)
            if fileobj is None:
                continue
            result[str(PurePosixPath(member.name))] = fileobj.read()
    return result


def validate_and_extract_action(
    *,
    bundle: pb.CommitBundle,
    problem_type_param: str,
    action_param: str,
    daycare_secret: str,
    hostname: str,
    now: datetime,
) -> pb.ProblemTypeAction:
    if not bundle.HasField("problem_type"):
        raise ValueError("commit bundle must include the problem type")
    if bundle.problem_type_signature == "":
        raise ValueError("commit bundle must include the problem type signature")
    if not bundle.HasField("problem"):
        raise ValueError("commit bundle must include the problem")
    if bundle.problem_type.name != problem_type_param:
        raise ValueError(
            f"problem type in URL ({problem_type_param}) must match problem type in bundle ({bundle.problem_type.name})"
        )
    if action_param == "":
        raise ValueError("action must be included in request URL")
    if action_param not in bundle.problem_type.actions:
        raise ValueError(f'action "{action_param}" not defined for problem type {bundle.problem_type.name}')
    if len(bundle.problem_steps) == 0:
        raise ValueError("commit bundle must include the problem steps")
    if bundle.problem_signature == "":
        raise ValueError("commit bundle must include the problem signature")
    if not bundle.HasField("commit"):
        raise ValueError("commit bundle must include the commit")
    if bundle.commit_signature == "":
        raise ValueError("commit bundle must include the commit signature")
    if bundle.hostname == "":
        raise ValueError("commit bundle must include the daycare host name")
    if bundle.user_id < 1:
        raise ValueError("commit bundle must include the user's ID")

    type_sig = compute_problem_type_signature(bundle.problem_type, daycare_secret)
    if bundle.problem_type_signature != type_sig:
        raise ValueError("problem type signature mismatch")
    problem_sig = compute_problem_signature(bundle.problem, list(bundle.problem_steps), daycare_secret)
    if bundle.problem_signature != problem_sig:
        raise ValueError("problem signature mismatch")
    commit_sig = compute_commit_signature(
        bundle.commit,
        type_sig,
        problem_sig,
        bundle.hostname,
        int(bundle.user_id),
        daycare_secret,
    )
    if bundle.commit_signature != commit_sig:
        raise ValueError("commit signature mismatch")
    if bundle.hostname != hostname:
        raise ValueError(f"commit is signed for host {bundle.hostname}, this is {hostname}")
    age = now - _ts_to_datetime(bundle.commit.updated_at)
    if age < timedelta(0):
        age = -age
    if age > SIGNED_REQUEST_MAX_AGE:
        raise ValueError(f"commit signature is {age} old, cannot be more than {SIGNED_REQUEST_MAX_AGE}")
    if bundle.commit.action != action_param:
        raise ValueError(f"commit says action is {bundle.commit.action}, but request says {action_param}")
    return bundle.problem_type.actions[action_param]


def gather_files_and_step(bundle: pb.CommitBundle) -> tuple[pb.ProblemStep, dict[str, bytes]]:
    step_num = int(bundle.commit.step)
    if step_num < 1 or step_num > len(bundle.problem_steps):
        raise ValueError(f"commit refers to step number {step_num}, but there are {len(bundle.problem_steps)} steps")
    step = bundle.problem_steps[step_num - 1]
    if int(step.step) != step_num:
        raise ValueError(
            f"step number mismatch: commit is for step {step_num}, but step object thinks it is {int(step.step)}"
        )
    if step.problem_type != bundle.problem_type.name:
        raise ValueError(
            f'problem type mismatch in step {step.step}: expected "{bundle.problem_type.name}", got "{step.problem_type}"'
        )

    merged: dict[str, bytes] = {}
    merged.update({name: bytes(content or b"") for name, content in dict(bundle.problem_type.files).items()})
    merged.update({name: bytes(content or b"") for name, content in dict(step.files).items()})
    merged.update({name: bytes(content or b"") for name, content in dict(bundle.commit.files).items()})
    return step, merged


def stream_nanny_events(
    *,
    events: queue.Queue[pb.EventMessage | None],
    commit: pb.Commit,
    emit_response: Callable[[pb.DaycareResponse], None],
) -> None:
    count = 0
    overflow = 0
    discarded = 0
    while True:
        event = events.get()
        if event is None:
            break
        stream_len = len(bytes(event.stream_data or b""))
        if count > TRANSCRIPT_DATA_LIMIT:
            overflow += stream_len
        else:
            count += stream_len
            if (
                len(commit.transcript) > 0
                and commit.transcript[-1].event == event.event
                and event.event in _STREAM_EVENT_TYPES
            ):
                prev = commit.transcript[-1]
                prev.stream_data = bytes(prev.stream_data) + bytes(event.stream_data)
                prev.time.CopyFrom(event.time)
            elif len(commit.transcript) < TRANSCRIPT_EVENT_COUNT_LIMIT:
                copied = pb.EventMessage()
                copied.CopyFrom(event)
                commit.transcript.append(copied)
            else:
                discarded += 1

        if event.event in _FORWARDED_EVENT_TYPES:
            emit_response(pb.DaycareResponse(event=event))
    if overflow > 0 or discarded > 0:
        logging.info(
            "transcript truncated by %d events and %d bytes of stream data",
            discarded,
            overflow,
        )


def run_and_parse_xunit(nanny: Nanny, cmd: list[str]) -> None:
    filename = "test_detail.xml"
    try:
        status = nanny.exec_command(cmd)
    except CommandError as exc:
        _report_card_log_and_fail(nanny.report_card, f"Error running unit tests: {exc}")
        return
    if status > 127:
        _report_card_log_and_fail(nanny.report_card, f"Crashed with exit status {status} while running unit tests")
        return
    nanny.report_card.passed = status == 0
    try:
        xmlfiles = nanny.get_files([filename])
    except CommandError:
        _report_card_log_and_fail(nanny.report_card, "Error getting unit test results")
        return
    parse_xunit(nanny, xmlfiles.get(filename, b""))


def parse_xunit(nanny: Nanny, contents: bytes) -> None:
    if len(contents) == 0:
        _report_card_log_and_fail(nanny.report_card, "No unit test results found")
        return
    try:
        root = et.fromstring(contents)
    except et.ParseError as exc:
        _report_card_log_and_fail(nanny.report_card, f"error parsing unit test results: {exc}")
        return

    suites: list[et.Element]
    root_name = _local_name(root.tag)
    if root_name == "testsuites":
        suites = [child for child in list(root) if _local_name(child.tag) == "testsuite"]
    elif root_name == "testsuite":
        suites = [root]
    else:
        _report_card_log_and_fail(nanny.report_card, "error parsing unit test results: unexpected XML root")
        return

    tests = failures = disabled = skipped = errors = 0
    for suite in suites:
        tests += _attr_int(suite, "tests")
        failures += _attr_int(suite, "failures")
        disabled += _attr_int(suite, "disabled")
        skipped += _attr_int(suite, "skipped")
        errors += _attr_int(suite, "errors")
        _ = _attr_float(suite, "time")
    fails = failures + disabled + skipped + errors
    nanny.report_card.note = f"Passed {tests - fails}/{tests} tests in {_duration_string(nanny.elapsed())}"
    nanny.report_card.passed = nanny.report_card.passed and tests > 0 and fails == 0

    for suite in suites:
        for test_case in [child for child in list(suite) if _local_name(child.tag) == "testcase"]:
            name = test_case.attrib.get("name", "")
            class_name = test_case.attrib.get("classname", "")
            if class_name:
                name = f"{class_name} -> {name}"

            failure = _first_child(test_case, "failure")
            error = _first_child(test_case, "error")
            disabled_elem = _first_child(test_case, "disabled")
            skipped_elem = _first_child(test_case, "skipped")
            status = test_case.attrib.get("status", "")

            if (
                (status in ("run", ""))
                and failure is None
                and error is None
                and disabled_elem is None
                and skipped_elem is None
            ):
                _report_card_add_passed(nanny.report_card, name, "")
                continue

            body = ""
            if failure is not None and failure.text:
                body = failure.text
            elif error is not None and error.text:
                body = error.text
            elif disabled_elem is not None and disabled_elem.text:
                body = disabled_elem.text
            elif skipped_elem is not None and skipped_elem.text:
                body = skipped_elem.text

            context = ""
            groups = _TEST_FAILURE_CONTEXT_GTEST.search(body)
            if groups is not None and groups.lastindex and groups.lastindex >= 1:
                context = groups.group(1)
            else:
                py_groups = _TEST_FAILURE_CONTEXT_PYTHON.search(body)
                if py_groups is not None and py_groups.lastindex and py_groups.lastindex >= 2:
                    context = f"{py_groups.group(1)}:{py_groups.group(2)}"
            _report_card_add_failed(nanny.report_card, name, body, context)


def run_and_parse_check_xml(nanny: Nanny, cmd: list[str]) -> None:
    filename = "test_detail.xml"
    try:
        status = nanny.exec_command(cmd)
    except CommandError as exc:
        _report_card_log_and_fail(nanny.report_card, f"Error running unit tests: {exc}")
        return
    if status > 127:
        _report_card_log_and_fail(nanny.report_card, f"Crashed with exit status {status} while running unit tests")
        return
    nanny.report_card.passed = status == 0
    try:
        xmlfiles = nanny.get_files([filename])
    except CommandError:
        _report_card_log_and_fail(nanny.report_card, "Error getting unit test results")
        return
    parse_check_xml(nanny, xmlfiles.get(filename, b""))


def _child_text(parent: et.Element, name: str) -> str:
    child = _first_child(parent, name)
    if child is None or child.text is None:
        return ""
    return child.text


def parse_check_xml(nanny: Nanny, contents: bytes) -> None:
    if len(contents) == 0:
        _report_card_log_and_fail(nanny.report_card, "No unit test results found")
        return
    try:
        root = et.fromstring(contents)
    except et.ParseError as exc:
        _report_card_log_and_fail(nanny.report_card, f"error parsing unit test results: {exc}")
        return
    successes = failures = errors = 0
    for suite in [child for child in list(root) if _local_name(child.tag) == "suite"]:
        for test in [child for child in list(suite) if _local_name(child.tag) == "test"]:
            result = test.attrib.get("result", "")
            test_id = _child_text(test, "id")
            message = _child_text(test, "message")
            function = _child_text(test, "fn")
            if result == "success":
                successes += 1
                _report_card_add_passed(nanny.report_card, test_id, message)
            elif result == "failure":
                failures += 1
                _report_card_add_failed(nanny.report_card, test_id, message, function)
            else:
                errors += 1
                _report_card_add_failed(nanny.report_card, test_id, message, function)

    nanny.report_card.passed = successes > 0 and failures == 0 and errors == 0
    total = successes + failures + errors
    if total < 1:
        nanny.report_card.note = f"No test results found in {_duration_string(nanny.elapsed())}"
    else:
        nanny.report_card.note = f"Passed {successes}/{total} tests in {_duration_string(nanny.elapsed())}"


def _compute_grade_score(report_card: pb.ReportCard) -> float:
    if report_card.passed:
        return 1.0
    if len(report_card.results) == 0:
        return 0.0
    passed = sum(1 for result in report_card.results if result.outcome == "passed")
    return float(passed) / float(len(report_card.results))


class DaycareRuntime:
    def __init__(
        self,
        config: ServerConfig,
        *,
        runner: CommandRunner | None = None,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self._config = config
        self._runner = runner or SubprocessCommandRunner()
        self._now_fn = now_fn or _now_utc
        configured_engine = config.container_engine.strip()
        if configured_engine == "":
            configured_engine = DEFAULT_CONTAINER_ENGINE
        parsed_engine = shlex.split(configured_engine)
        if len(parsed_engine) == 0:
            parsed_engine = [DEFAULT_CONTAINER_ENGINE]
        self._container_command = parsed_engine
        self._resolved_image_cache: dict[str, str | None] = {}
        self._resolved_image_cache_lock = threading.Lock()
        cap = int(config.capacity)
        if cap <= 0:
            cap = 1
        self._container_limiter = threading.BoundedSemaphore(cap)

    def _image_candidates_with_cache(self, *, image: str) -> list[str]:
        with self._resolved_image_cache_lock:
            cached = self._resolved_image_cache.get(image)
        if cached is not None:
            return [cached]
        return _image_candidates_for_runtime(image, container_command=self._container_command)

    def _cache_resolved_image(self, *, image: str, resolved_image: str) -> None:
        with self._resolved_image_cache_lock:
            self._resolved_image_cache[image] = resolved_image

    def stream(self, request: pb.DaycareRequest, context: grpc.ServicerContext) -> Iterator[pb.DaycareResponse]:
        if request is None:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "request is required")
            raise AssertionError("unreachable")
        if not request.HasField("commit_bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "commit bundle is required")
            raise AssertionError("unreachable")

        q: queue.Queue[pb.DaycareResponse | None] = queue.Queue(maxsize=100)
        cancel_event = threading.Event()

        def worker() -> None:
            try:
                self._handle_problem_action(
                    cancel_event=cancel_event,
                    bundle=request.commit_bundle,
                    problem_type_param=request.problem_type,
                    action_param=request.action,
                    args=list(request.args),
                    out_queue=q,
                )
            finally:
                q.put(None)

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

        broken = False
        while True:
            payload = q.get()
            if payload is None:
                break
            if broken:
                continue
            is_active = True
            try:
                is_active = bool(context.is_active())
            except Exception:
                is_active = True
            if not is_active:
                broken = True
                cancel_event.set()
                continue
            yield payload
        cancel_event.set()
        thread.join(timeout=0.1)

    def _handle_problem_action(
        self,
        *,
        cancel_event: threading.Event,
        bundle: pb.CommitBundle,
        problem_type_param: str,
        action_param: str,
        args: list[str],
        out_queue: queue.Queue[pb.DaycareResponse | None],
    ) -> None:
        now = self._now_fn()
        nanny_name = f"nanny-{bundle.user_id}"
        outcome = "ok"

        def emit_error(message: str) -> None:
            nonlocal outcome
            outcome = message
            logging.info(message)
            out_queue.put(pb.DaycareResponse(error=message))

        try:
            action = validate_and_extract_action(
                bundle=bundle,
                problem_type_param=problem_type_param,
                action_param=action_param,
                daycare_secret=self._config.daycare_secret,
                hostname=self._config.hostname,
                now=now,
            )
        except ValueError as exc:
            emit_error(f"validation error: {exc}")
            return

        bundle.commit_signature = ""

        try:
            _, files = gather_files_and_step(bundle)
        except ValueError as exc:
            emit_error(f"error gathering files: {exc}")
            return

        self._container_limiter.acquire()
        logging.info("container locked for user %d", bundle.user_id)
        try:
            limits = Limits.from_action(action)
            limits.override(list(bundle.problem.options))
            timeout_seconds = float(int(limits.max_cpu) * 2 + 5)
            action_deadline_monotonic = time.monotonic() + timeout_seconds

            image_candidates = self._image_candidates_with_cache(image=bundle.problem_type.image)
            nanny: Nanny | None = None
            creation_error: CommandError | None = None
            missing_images: list[str] = []
            for candidate in image_candidates:
                try:
                    nanny = Nanny.create(
                        runner=self._runner,
                        container_command=self._container_command,
                        user_id=int(bundle.user_id),
                        image=candidate,
                        problem_type=bundle.problem_type,
                        problem=bundle.problem,
                        action=action.action,
                        limits=limits,
                        name=nanny_name,
                        args=args,
                        action_deadline_monotonic=action_deadline_monotonic,
                        cancel_event=cancel_event,
                    )
                    self._cache_resolved_image(image=bundle.problem_type.image, resolved_image=candidate)
                    break
                except CommandError as exc:
                    creation_error = exc
                    if _is_missing_local_image_error(str(exc)):
                        missing_images.append(candidate)
                        continue
                    emit_error(f"error creating container: {exc}")
                    return

            if nanny is None:
                if len(missing_images) == len(image_candidates) and len(image_candidates) > 0:
                    tried = ", ".join(repr(elt) for elt in image_candidates)
                    emit_error(f"error creating container: container image not found in local store: tried {tried}")
                elif creation_error is not None:
                    emit_error(f"error creating container: {creation_error}")
                else:
                    emit_error("error creating container: unknown image resolution failure")
                return

            try:
                def emit_response(response: pb.DaycareResponse) -> None:
                    out_queue.put(response)

                event_listener = threading.Thread(
                    target=stream_nanny_events,
                    kwargs={
                        "events": nanny.events,
                        "commit": bundle.commit,
                        "emit_response": emit_response,
                    },
                    daemon=True,
                )
                event_listener.start()

                try:
                    nanny.put_files(files, 0o666)
                except CommandError as exc:
                    _report_card_log_and_fail(nanny.report_card, f"uploading files: {exc}")
                    nanny.close_events()
                    event_listener.join()
                    return

                cmd = action.command.split()
                if action.parser == "xunit":
                    run_and_parse_xunit(nanny, cmd)
                elif action.parser == "check":
                    run_and_parse_check_xml(nanny, cmd)
                elif action.parser != "":
                    _report_card_log_and_fail(
                        nanny.report_card,
                        f'unknown parser "{action.parser}" for problem type {action.problem_type} action {action.action}',
                    )
                else:
                    joined = " ".join(cmd)
                    try:
                        status = nanny.exec_command(cmd)
                    except CommandError as exc:
                        _report_card_log_and_fail(nanny.report_card, f'"{joined}" exec error: {exc}')
                    else:
                        if status != 0:
                            _report_card_log_and_fail(
                                nanny.report_card,
                                f'"{joined}" failed with exit status {status}',
                            )

                bundle.commit.report_card.CopyFrom(nanny.report_card)

                for option in bundle.problem.options:
                    parts = option.split("=", 1)
                    if len(parts) != 2 or parts[0] != "download":
                        continue
                    try:
                        downloaded = nanny.get_files(parts[1].split(","))
                    except CommandError as exc:
                        logging.info("error trying to download files from container: %s", exc)
                        continue
                    if downloaded:
                        nanny.emit_event(_event_message("files", files=downloaded))

                nanny.close_events()
                event_listener.join()

                if bundle.commit.action == "grade":
                    bundle.commit.score = _compute_grade_score(bundle.commit.report_card)
                    _set_timestamp(bundle.commit.updated_at, now)
                    bundle.commit_signature = compute_commit_signature(
                        bundle.commit,
                        bundle.problem_type_signature,
                        bundle.problem_signature,
                        bundle.hostname,
                        int(bundle.user_id),
                        self._config.daycare_secret,
                    )
                    out_queue.put(pb.DaycareResponse(commit_bundle=bundle))
            finally:
                try:
                    nanny.shutdown("action finished")
                except CommandError as exc:
                    logging.info("nanny shutdown error: %s", exc)
        finally:
            self._container_limiter.release()
            if outcome == "ok":
                logging.info("handler for %s finished", nanny_name)
            else:
                logging.info(
                    "handler for %s finished with %s",
                    nanny_name,
                    outcome,
                )
            logging.info("container unlocked for user %d", bundle.user_id)
