from __future__ import annotations

import json
import logging
import os
import re
import sys
import tomllib
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import grpc
from google.protobuf.json_format import MessageToDict
from packaging.version import Version

import codegrinder_pb2 as pb
import codegrinder_pb2_grpc as pb_grpc
from errors import CliError, fail
from models import AssignmentRef, Config, DotFileInfo, ProblemInfo
from version import CURRENT_VERSION

PER_PROBLEM_SET_DOT_FILE = ".grind"
CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "codegrinder"
CONFIG_FILE = CONFIG_DIR / "config.toml"


@dataclass(slots=True)
class Session:
    stub: pb_grpc.CodeGrinderServiceStub
    channel: grpc.Channel
    user: pb.User


def clean_error(exc: Exception) -> str:
    if isinstance(exc, grpc.RpcError):
        details_attr = getattr(exc, "details", None)
        if callable(details_attr):
            details = details_attr()
            if isinstance(details, str) and details:
                return details
    return str(exc)


def program_name() -> str:
    if not sys.argv:
        return "grind"
    return Path(sys.argv[0]).name or "grind"


def _parse_config_file() -> dict[str, object]:
    try:
        return tomllib.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        fail(
            f"failed to parse {CONFIG_FILE}: {exc}\n"
            f"you may wish to try deleting the file and running '{program_name()} login' again"
        )


def _config_from_raw(raw: dict[str, object]) -> Config:
    host = raw.get("host", "")
    cookie = raw.get("cookie", "")
    workspace_root = raw.get("workspace_root", str(Path.home()))
    instructor = raw.get("instructor", False)
    if (
        not isinstance(host, str)
        or not isinstance(cookie, str)
        or not isinstance(workspace_root, str)
        or not isinstance(instructor, bool)
    ):
        fail(
            f"failed to parse {CONFIG_FILE}: invalid config value type\n"
            f"you may wish to try deleting the file and running '{program_name()} login' again"
        )
    return Config(host=host, cookie=cookie, workspace_root=Path(workspace_root).expanduser(), instructor=instructor)


def load_config() -> Config:
    if not CONFIG_FILE.exists():
        fail(f"Unable to load config file; try running '{program_name()} login'")
    return _config_from_raw(_parse_config_file())


def load_config_or_default() -> Config:
    if not CONFIG_FILE.exists():
        return Config(workspace_root=Path.home())
    return _config_from_raw(_parse_config_file())


def _toml_string(value: str) -> str:
    return json.dumps(value)


def write_config(config: Config) -> None:
    existing = load_config_or_default()
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    merged = Config(
        host=config.host,
        cookie=config.cookie,
        workspace_root=existing.workspace_root,
        instructor=existing.instructor,
    )
    lines = [
        f"host = {_toml_string(merged.host)}",
        f"cookie = {_toml_string(merged.cookie)}",
        f"workspace_root = {_toml_string(str(merged.workspace_root))}",
    ]
    if merged.instructor:
        lines.append("instructor = true")
    CONFIG_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def check_version(version: pb.Version) -> None:
    if version is None:
        fail("failed to get version from server")

    current = Version(CURRENT_VERSION.version)
    required = Version(version.grind_version_required)
    if required > current:
        fail(
            f"this is grind version {CURRENT_VERSION.version}, but the server requires "
            f"{version.grind_version_required} or higher\n"
            "  you must upgrade to continue"
        )

    recommended = Version(version.grind_version_recommended)
    if recommended > current:
        logging.error(
            "this is grind version %s, but the server recommends %s or higher",
            CURRENT_VERSION.version,
            version.grind_version_recommended,
        )
        logging.error("  please upgrade as soon as possible")


def _sanitize_map(data: Any) -> None:
    if isinstance(data, dict):
        for key, value in list(data.items()):
            if key in {"files", "solution", "starter_files"} and isinstance(value, dict):
                for name in list(value.keys()):
                    value[name] = "..."
            _sanitize_map(value)
    elif isinstance(data, list):
        for value in data:
            _sanitize_map(value)


def dump_message(config: Config, call: str, is_outgoing: bool, msg: object | None) -> None:
    if config.api_dump:
        if msg is None:
            payload: object = None
        elif hasattr(msg, "DESCRIPTOR"):
            payload = MessageToDict(msg, preserving_proto_field_name=True)
            _sanitize_map(payload)
        else:
            payload = msg
        marker = "-->" if is_outgoing else "<--"
        logging.error("%s %s %s", marker, call, json.dumps(payload, indent=4))
    elif config.api_report:
        marker = "-->" if is_outgoing else "<--"
        logging.error("%s %s", marker, call)


def grpc_metadata(cookie: str) -> Sequence[tuple[str, str]]:
    return (("cookie", cookie),)


def new_grpc_client(config: Config) -> tuple[pb_grpc.CodeGrinderServiceStub, grpc.Channel]:
    target = f"{config.host}:443"
    channel = grpc.secure_channel(target, grpc.ssl_channel_credentials(), compression=grpc.Compression.Gzip)
    stub = pb_grpc.CodeGrinderServiceStub(channel)
    return stub, channel


def setup(config: Config) -> Session:
    if config.api_dump:
        config.api_report = True
    stub, channel = new_grpc_client(config)
    try:
        req = pb.HelloRequest()
        dump_message(config, "Hello", True, req)
        response = stub.Hello(req, metadata=grpc_metadata(config.cookie))
        dump_message(config, "Hello", False, response)
    except Exception as exc:
        channel.close()
        raise CliError(clean_error(exc)) from exc

    check_version(response.version)
    if not response.HasField("user"):
        channel.close()
        fail("server returned no user")
    return Session(stub=stub, channel=channel, user=response.user)


@contextmanager
def managed_session(config: Config) -> Iterator[Session]:
    session = setup(config)
    try:
        yield session
    finally:
        session.channel.close()


def course_directory(label: str) -> str:
    match = re.match(r"^([A-Za-z]+[- ]*\d+\w*)\b", label)
    if match is not None:
        return match.group(1)
    return label


def plural(count: int) -> str:
    return "" if count == 1 else "s"


def _dotfile_from_raw(path: Path, raw: dict[str, object]) -> DotFileInfo:
    assignment_ref_raw = raw.get("assignmentRef")
    if not isinstance(assignment_ref_raw, dict):
        fail(f"error parsing {path}: missing assignmentRef")
    assignment_ref_map = cast(dict[str, object], assignment_ref_raw)
    assignment_user_id = assignment_ref_map.get("userID")
    assignment_course_id = assignment_ref_map.get("courseID")
    assignment_problem_set_id = assignment_ref_map.get("problemSetID")
    if not isinstance(assignment_user_id, str) or not isinstance(assignment_course_id, str) or not isinstance(assignment_problem_set_id, str):
        fail(f"error parsing {path}: invalid assignmentRef")

    problems_raw = raw.get("problems")
    if not isinstance(problems_raw, dict):
        fail(f"error parsing {path}: missing problems")
    typed_problems = cast(dict[object, object], problems_raw)

    problems: dict[str, ProblemInfo] = {}
    for unique, info in typed_problems.items():
        if not isinstance(unique, str) or not isinstance(info, dict):
            fail(f"error parsing {path}: invalid problem entry")
        info_map = cast(dict[str, object], info)
        pid = info_map.get("problemID")
        step = info_map.get("step")
        total_steps = info_map.get("totalSteps")
        if not isinstance(pid, str) or not isinstance(step, int):
            fail(f"error parsing {path}: invalid problem entry for {unique}")
        normalized_total_steps = 1
        if isinstance(total_steps, int) and total_steps > 0:
            normalized_total_steps = total_steps
        problems[unique] = ProblemInfo(problem_id=pid, step=step, total_steps=normalized_total_steps)
    return DotFileInfo(
        assignment_ref=AssignmentRef(
            user_id=assignment_user_id,
            course_id=assignment_course_id,
            problem_set_id=assignment_problem_set_id,
        ),
        problems=problems,
        path=str(path),
    )


def find_dotfile(start_dir: Path) -> tuple[DotFileInfo, Path, Path | None]:
    problem_set_dir = start_dir
    problem_dir: Path | None = None

    while True:
        dotfile_path = problem_set_dir / PER_PROBLEM_SET_DOT_FILE
        if dotfile_path.exists():
            break
        if not problem_set_dir.is_absolute():
            problem_set_dir = problem_set_dir.resolve()
            continue
        parent = problem_set_dir.parent
        if parent == problem_set_dir:
            fail(
                f"unable to find {PER_PROBLEM_SET_DOT_FILE} in {start_dir} or an ancestor directory\n"
                "   you must run this in a problem directory\n"
                "   or supply the directory name as an argument"
            )
        problem_dir = problem_set_dir
        problem_set_dir = parent

    dotfile_path = problem_set_dir / PER_PROBLEM_SET_DOT_FILE
    try:
        raw_obj = json.loads(dotfile_path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"error reading/parsing {dotfile_path}: {clean_error(exc)}")
    if not isinstance(raw_obj, dict):
        fail(f"error parsing {dotfile_path}: root is not an object")
    return _dotfile_from_raw(dotfile_path, raw_obj), problem_set_dir, problem_dir


def load_dotfile(path: Path) -> DotFileInfo:
    try:
        raw_obj = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"error reading/parsing {path}: {clean_error(exc)}")
    if not isinstance(raw_obj, dict):
        fail(f"error parsing {path}: root is not an object")
    return _dotfile_from_raw(path, raw_obj)


def save_dotfile(dotfile: DotFileInfo) -> None:
    payload = {
        "assignmentRef": {
            "userID": dotfile.assignment_ref.user_id,
            "courseID": dotfile.assignment_ref.course_id,
            "problemSetID": dotfile.assignment_ref.problem_set_id,
        },
        "problems": {
            key: {"problemID": info.problem_id, "step": info.step, "totalSteps": info.total_steps}
            for key, info in dotfile.problems.items()
        },
    }
    target = Path(dotfile.path)
    target.write_text(json.dumps(payload, indent=4) + "\n", encoding="utf-8")


def update_files(directory: Path, files: dict[str, bytes], old_files: set[str] | None, chatty: bool) -> None:
    for name, contents in files.items():
        path = directory / name
        if not path.exists():
            if chatty:
                print(f"saving file:   {name}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)
            continue

        on_disk = path.read_bytes()
        if on_disk != contents:
            if chatty:
                print(f"updating file: {name}")
            path.write_bytes(contents)

    if old_files is None:
        return
    for name in old_files:
        if name in files:
            continue
        path = directory / name
        if path.exists():
            if chatty:
                print(f"removing file: {name}")
            path.unlink()
        parent = Path(name).parent
        if parent != Path("."):
            maybe = directory / parent
            try:
                maybe.rmdir()
            except OSError:
                pass


def grpc_time_now() -> datetime:
    return datetime.now(tz=UTC)


def dashes(count: int) -> str:
    return "-" * count
