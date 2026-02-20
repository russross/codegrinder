from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class IPFilterConfig:
    whitelist: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ServerConfig:
    hostname: str = ""
    daycare_secret: str = ""
    acme_email: str = ""
    acme_url: str = ""
    lti_secret: str = ""
    session_secret: str = ""
    ta_hostname: str = ""
    capacity: int = 0
    problem_types: list[str] = field(default_factory=list)
    tool_name: str = "CodeGrinder"
    tool_id: str = "codegrinder"
    tool_description: str = "Programming exercises with grading"
    container_engine: str = "doas podman"
    acme_cache: str = ""
    sqlite3_path: str = ""
    sessions_expire: list[datetime] = field(default_factory=list)
    ip_filter: IPFilterConfig | None = None


def _decode_base64_if_needed(raw: str) -> str:
    if raw == "":
        return raw
    try:
        data = base64.b64decode(raw, validate=True)
    except Exception:
        return raw
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return raw


def _parse_datetime(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError(f"sessionsExpire must contain timezone-aware timestamps: {value!r}")
    return parsed


def _default_sessions_expire(tzinfo: Any) -> list[datetime]:
    return [
        datetime(2020, 1, 1, 0, 0, 0, tzinfo=tzinfo),
        datetime(2020, 7, 1, 0, 0, 0, tzinfo=tzinfo),
    ]


def load_config(config_path: Path) -> ServerConfig:
    data = json.loads(config_path.read_text(encoding="utf-8"))

    now_tz = datetime.now().astimezone().tzinfo
    if now_tz is None:
        raise RuntimeError("local timezone is required")

    cfg = ServerConfig(
        hostname=str(data.get("hostname", "")),
        daycare_secret=str(data.get("daycareSecret", "")),
        acme_email=str(data.get("acmeEmail", "")),
        acme_url=str(data.get("acmeURL", "")),
        lti_secret=str(data.get("ltiSecret", "")),
        session_secret=str(data.get("sessionSecret", "")),
        ta_hostname=str(data.get("taHostname", "")),
        capacity=int(data.get("capacity", 0) or 0),
        problem_types=list(data.get("problemTypes", [])),
        tool_name=str(data.get("toolName", "CodeGrinder")),
        tool_id=str(data.get("toolID", "codegrinder")),
        tool_description=str(data.get("toolDescription", "Programming exercises with grading")),
        container_engine=str(data.get("containerEngine", "doas podman")),
        acme_cache=str(data.get("acmeDir", "")),
        sqlite3_path=str(data.get("sqlite3Path", "")),
        sessions_expire=_default_sessions_expire(now_tz),
        ip_filter=None,
    )

    raw_sessions = data.get("sessionsExpire")
    if raw_sessions is not None:
        cfg.sessions_expire = [_parse_datetime(str(item)) for item in raw_sessions]

    if isinstance(data.get("ipFilter"), dict):
        whitelist = data["ipFilter"].get("whitelist", [])
        cfg.ip_filter = IPFilterConfig(whitelist=[str(item) for item in whitelist])

    cfg.session_secret = _decode_base64_if_needed(cfg.session_secret)
    cfg.daycare_secret = _decode_base64_if_needed(cfg.daycare_secret)

    return cfg
