from __future__ import annotations

import base64
import hmac
from datetime import UTC, datetime
from hashlib import sha256
from urllib.parse import urlencode


def escape(value: str) -> str:
    out = []
    for byte in value.encode("utf-8"):
        if (
            0x61 <= byte <= 0x7A
            or 0x41 <= byte <= 0x5A
            or 0x30 <= byte <= 0x39
            or byte in (0x2D, 0x2E, 0x5F, 0x7E)
        ):
            out.append(chr(byte))
        else:
            out.append(f"%{byte:02X}")
    return "".join(out)


def encode_params(values: dict[str, list[str]]) -> bytes:
    parts: list[str] = []
    for key in sorted(values.keys()):
        prefix = f"{escape(key)}="
        for value in values[key]:
            parts.append(prefix + escape(value))
    return "&".join(parts).encode("utf-8")


def hmac_sha256_base64(secret: str, payload: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), payload, sha256)
    return base64.b64encode(mac.digest()).decode("ascii")


def compute_daycare_registration_signature(
    hostname: str,
    problem_types: list[str],
    capacity: int,
    when: datetime,
    version: str,
    secret: str,
) -> str:
    ordered = sorted(problem_types)
    values: dict[str, list[str]] = {
        "hostname": [hostname],
        "capacity": [str(capacity)],
        "time": [when.astimezone().replace(microsecond=0).astimezone(UTC).isoformat().replace("+00:00", "Z")],
        "version": [version],
    }
    for index, name in enumerate(ordered):
        values[f"problemType-{index}"] = [name]
    return hmac_sha256_base64(secret, encode_params(values))
