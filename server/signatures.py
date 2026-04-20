from __future__ import annotations

import base64
import hmac
from datetime import UTC, datetime
from hashlib import sha256

import codegrinder_pb2 as pb

_RUNTIME_BUNDLE_HMAC_CONTEXT = b"codegrinder:runtime-bundle:v1\0"


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


def _hmac_sha256(secret: str, payload: bytes) -> bytes:
    return hmac.new(secret.encode("utf-8"), payload, sha256).digest()


def sign_runtime_bundle_blob(secret: str, payload: bytes) -> str:
    mac = _hmac_sha256(secret, _RUNTIME_BUNDLE_HMAC_CONTEXT + payload)
    return base64.b64encode(mac).decode("ascii")


def verify_runtime_bundle_blob(secret: str, payload: bytes, signature: str) -> None:
    expected = sign_runtime_bundle_blob(secret, payload)
    if not hmac.compare_digest(expected, signature):
        raise ValueError("runtime bundle signature mismatch")


def verified_runtime_bundle_blob(envelope: pb.SignedRuntimeBundle, secret: str) -> bytes:
    if envelope.bundle == b"":
        raise ValueError("signed runtime bundle must include encoded bundle bytes")
    if envelope.signature == "":
        raise ValueError("signed runtime bundle must include a signature")
    verify_runtime_bundle_blob(secret, envelope.bundle, envelope.signature)
    return bytes(envelope.bundle)


def parse_runtime_bundle_blob(payload: bytes) -> pb.RuntimeBundle:
    bundle = pb.RuntimeBundle()
    bundle.ParseFromString(payload)
    return bundle


def encode_signed_runtime_bundle(bundle: pb.RuntimeBundle, secret: str) -> pb.SignedRuntimeBundle:
    payload = bundle.SerializeToString()
    return pb.SignedRuntimeBundle(bundle=payload, signature=sign_runtime_bundle_blob(secret, payload))


def decode_signed_runtime_bundle(envelope: pb.SignedRuntimeBundle, secret: str) -> pb.RuntimeBundle:
    return parse_runtime_bundle_blob(verified_runtime_bundle_blob(envelope, secret))


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
