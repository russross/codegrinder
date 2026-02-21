from __future__ import annotations

import json
import logging
import re
import sys
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
from models import Config, DotFileInfo, ProblemInfo
from version import CURRENT_VERSION

INSTRUCTOR_FILE = ".codegrinderinstructor"
PER_PROBLEM_SET_DOT_FILE = ".grind"
CONFIG_DIR = Path("~/.config/codegrinder").expanduser()
CONFIG_FILE = CONFIG_DIR / "config.json"


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


def config_dir() -> Path:
    return CONFIG_DIR


def has_instructor_file() -> bool:
    return (Path.home() / INSTRUCTOR_FILE).exists()


def load_config() -> Config:
    if not CONFIG_FILE.exists():
        fail(f"Unable to load config file; try running '{program_name()} login'")

    try:
        raw = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(
            f"failed to parse {CONFIG_FILE}: {exc}\n"
            f"you may wish to try deleting the file and running '{program_name()} login' again"
        )

    host = raw.get("host", "")
    cookie = raw.get("cookie", "")
    if not isinstance(host, str) or not isinstance(cookie, str):
        fail(
            f"failed to parse {CONFIG_FILE}: invalid host/cookie type\n"
            f"you may wish to try deleting the file and running '{program_name()} login' again"
        )
    return Config(host=host, cookie=cookie)


def write_config(config: Config) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"host": config.host, "cookie": config.cookie}
    CONFIG_FILE.write_text(json.dumps(payload, indent=4) + "\n", encoding="utf-8")


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
            if key in {"files", "solution"} and isinstance(value, dict):
                for name in list(value.keys()):
                    value[name] = "..."
            elif key == "instructions":
                data[key] = "..."
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
    assignment_id_raw = raw.get("assignmentID")
    if not isinstance(assignment_id_raw, int):
        fail(f"error parsing {path}: missing assignmentID")

    problems_raw = raw.get("problems")
    if not isinstance(problems_raw, dict):
        fail(f"error parsing {path}: missing problems")
    typed_problems = cast(dict[object, object], problems_raw)

    problems: dict[str, ProblemInfo] = {}
    for unique, info in typed_problems.items():
        if not isinstance(unique, str) or not isinstance(info, dict):
            fail(f"error parsing {path}: invalid problem entry")
        info_map = cast(dict[str, object], info)
        pid = info_map.get("id")
        step = info_map.get("step")
        if not isinstance(pid, int) or not isinstance(step, int):
            fail(f"error parsing {path}: invalid problem entry for {unique}")
        problems[unique] = ProblemInfo(id=pid, step=step)
    return DotFileInfo(assignment_id=assignment_id_raw, problems=problems, path=str(path))


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


def save_dotfile(dotfile: DotFileInfo) -> None:
    payload = {
        "assignmentID": dotfile.assignment_id,
        "problems": {
            key: {"id": info.id, "step": info.step}
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
