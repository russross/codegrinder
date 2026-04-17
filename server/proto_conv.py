from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import codegrinder_pb2 as pb


def parse_time(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        dt = raw
    else:
        text = str(raw)
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_timestamp(value: Any | None) -> Any | None:
    if value is None:
        return None
    ts = pb.google_dot_protobuf_dot_timestamp__pb2.Timestamp()  # type: ignore[unresolved-attribute]
    ts.FromDatetime(parse_time(value))
    return ts
