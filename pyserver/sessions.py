from __future__ import annotations

import base64
import binascii
import hmac
import secrets
import struct
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256

from timeutils import next_session_expiry

COOKIE_NAME = "codegrinder"
LOGIN_RECORD_TIMEOUT = timedelta(minutes=5)
KEY_CHAR_SET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
SESSION_VERSION = 1
SESSION_PAYLOAD_STRUCT = struct.Struct(">BqQ")


class SessionError(ValueError):
    pass


@dataclass(slots=True)
class CookieSession:
    expires_at: datetime
    user_id: int
    path: str = "/"


def new_session(user_id: int, now: datetime, sessions_expire: list[datetime]) -> CookieSession:
    expires_at = next_session_expiry(now, sessions_expire)
    return CookieSession(expires_at=expires_at, user_id=user_id)


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    pad = "=" * ((4 - (len(value) % 4)) % 4)
    return base64.urlsafe_b64decode(value + pad)


def encode_session(session: CookieSession, secret: str) -> str:
    if session.expires_at.tzinfo is None:
        raise SessionError("session is expired; must log in again to continue")
    if session.user_id < 1:
        raise SessionError("session does not contain a legal user ID field")
    expires_at_utc = session.expires_at.astimezone(UTC)
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    delta = expires_at_utc - epoch
    expires_at_us = ((delta.days * 86_400) + delta.seconds) * 1_000_000 + delta.microseconds
    payload = SESSION_PAYLOAD_STRUCT.pack(SESSION_VERSION, expires_at_us, session.user_id)
    sig = hmac.new(secret.encode("utf-8"), payload, sha256).digest()
    return f"{_b64url_encode(payload)}.{_b64url_encode(sig)}"


def decode_session(cookie_value: str, secret: str, now: datetime) -> CookieSession:
    if cookie_value.startswith(COOKIE_NAME + "="):
        cookie_value = cookie_value[len(COOKIE_NAME) + 1 :]
    try:
        payload_encoded, sig_encoded = cookie_value.split(".", 1)
    except ValueError as exc:
        raise SessionError("unable to decode session cookie") from exc

    try:
        payload = _b64url_decode(payload_encoded)
        version, expires_at_us, user_id = SESSION_PAYLOAD_STRUCT.unpack(payload)
        expected_sig = hmac.new(secret.encode("utf-8"), payload, sha256).digest()
        got_sig = _b64url_decode(sig_encoded)
    except (ValueError, struct.error, binascii.Error) as exc:
        raise SessionError("unable to decode session cookie") from exc

    if version != SESSION_VERSION:
        raise SessionError("unable to decode session cookie")
    if not hmac.compare_digest(expected_sig, got_sig):
        raise SessionError("unable to decode session cookie")

    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    expires_at = epoch + timedelta(microseconds=expires_at_us)
    if expires_at < now:
        raise SessionError("session is expired; must log in again to continue")
    if user_id < 1:
        raise SessionError("session does not contain a legal user ID field")

    return CookieSession(expires_at=expires_at, user_id=user_id)


@dataclass(slots=True)
class _LoginRecord:
    user_id: int
    time: datetime


class LoginRecords:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: dict[str, _LoginRecord] = {}

    def _expire(self, now: datetime) -> None:
        expired = [
            key
            for key, record in self._records.items()
            if (now - record.time) >= LOGIN_RECORD_TIMEOUT
        ]
        for key in expired:
            del self._records[key]

    def insert(self, user_id: int, now: datetime) -> str:
        with self._lock:
            while True:
                key = make_login_key()
                if key not in self._records:
                    break
            self._records[key] = _LoginRecord(user_id=user_id, time=now)
            self._expire(now)
            return key

    def get(self, key: str, now: datetime) -> int:
        with self._lock:
            self._expire(now)
            if key not in self._records:
                raise SessionError(
                    f'session "{key}" not found: key expires after 5 minutes and can only be used once'
                )
            user_id = self._records[key].user_id
            del self._records[key]
            return user_id


def make_login_key() -> str:
    return "".join(secrets.choice(KEY_CHAR_SET) for _ in range(8))
