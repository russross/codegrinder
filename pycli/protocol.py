from __future__ import annotations

import base64
import hashlib
import hmac
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import codegrinder_pb2 as pb

_SIGNAL_NAMES: dict[int, str] = {
    1: "SIGHUP",
    2: "SIGINT",
    3: "SIGQUIT",
    4: "SIGILL",
    5: "SIGTRAP",
    6: "SIGABRT",
    7: "SIGBUS",
    8: "SIGFPE",
    9: "SIGKILL",
    10: "SIGUSR1",
    11: "SIGSEGV",
    12: "SIGUSR2",
    13: "SIGPIPE",
    14: "SIGALRM",
    15: "SIGTERM",
}


def _escape(value: str) -> str:
    return quote(value, safe="-._~")


def _encode(values: Mapping[str, list[str]]) -> bytes:
    parts: list[str] = []
    for key in sorted(values):
        prefix = f"{_escape(key)}="
        for value in values[key]:
            parts.append(prefix + _escape(value))
    return "&".join(parts).encode("utf-8")


def compute_hmac_signature(secret: str, values: Mapping[str, list[str]]) -> str:
    digest = hmac.new(secret.encode("utf-8"), _encode(values), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def format_timestamp(ts: Any) -> str:
    dt = ts.ToDatetime(tzinfo=UTC)
    rounded = dt.replace(microsecond=0)
    return rounded.isoformat().replace("+00:00", "Z")


def dump_event(event: pb.EventMessage) -> str:
    if event.event == "exec":
        return "$ " + " ".join(event.exec_command) + "\r\n"
    if event.event == "exit":
        if event.exit_status == 0:
            return ""
        signal_name = _SIGNAL_NAMES.get(event.exit_status - 128)
        if signal_name is not None:
            return f"exit status {event.exit_status} (killed by {signal_name})\r\n"
        return f"exit status {event.exit_status}\r\n"
    if event.event in {"stdin", "stdout", "stderr"}:
        return event.stream_data.decode("utf-8", errors="replace")
    if event.event == "error":
        return f"Error: {event.error}\r\n"
    return ""


def dump_transcript(commit: pb.Commit) -> str:
    output: list[str] = []
    for event in commit.transcript:
        output.append(dump_event(event))
    return "".join(output)
