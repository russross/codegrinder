from __future__ import annotations

import secrets
import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from proto_conv import parse_time
from signatures import hmac_sha256_base64
from timeutils import next_session_expiry

LOGIN_TOKEN_TIMEOUT = timedelta(minutes=5)
SESSION_LAST_USED_UPDATE_INTERVAL = timedelta(minutes=10)
KEY_CHAR_SET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
_SESSION_KEY_HMAC_CONTEXT = b"codegrinder:session-key:v1\0"


class SessionError(ValueError):
    pass


@dataclass(slots=True)
class Session:
    session_key: str
    expires_at: datetime
    user_id: str


def _format_db_time(value: datetime) -> str:
    if value.tzinfo is None:
        raise SessionError("session timestamps must be timezone-aware")
    return value.astimezone(UTC).replace(microsecond=0).isoformat()


def make_login_token() -> str:
    return "".join(secrets.choice(KEY_CHAR_SET) for _ in range(8))


def make_session_key() -> str:
    return secrets.token_urlsafe(32)


def session_key_hash(session_key: str, session_secret: str) -> str:
    if session_key.strip() == "":
        raise SessionError("session key is empty")
    if session_secret.strip() == "":
        raise SessionError("session secret is empty")
    return hmac_sha256_base64(session_secret, _SESSION_KEY_HMAC_CONTEXT + session_key.encode("utf-8"))


def create_session(
    tx: sqlite3.Connection,
    user_id: str,
    now: datetime,
    sessions_expire: list[datetime],
    session_secret: str,
) -> Session:
    if user_id.strip() == "":
        raise SessionError("session does not contain a legal user ID field")
    expires_at = next_session_expiry(now, sessions_expire)
    while True:
        session_key = make_session_key()
        key_hash = session_key_hash(session_key, session_secret)
        try:
            tx.execute(
                "INSERT INTO user_sessions(session_key_hash, user_id, session_created_at, session_expires_at, session_last_used_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    key_hash,
                    user_id,
                    _format_db_time(now),
                    _format_db_time(expires_at),
                    _format_db_time(now),
                ),
            )
        except sqlite3.IntegrityError:
            if tx.execute("SELECT 1 FROM user_sessions WHERE session_key_hash = ?", (key_hash,)).fetchone() is not None:
                continue
            raise
        return Session(session_key=session_key, expires_at=expires_at, user_id=user_id)


def load_session_user_id(
    tx: sqlite3.Connection,
    session_key: str,
    session_secret: str,
    now: datetime,
) -> str:
    key_hash = session_key_hash(session_key, session_secret)
    row = tx.execute(
        "SELECT user_id, session_expires_at, session_last_used_at "
        "FROM user_sessions "
        "WHERE session_key_hash = ? AND session_revoked_at IS NULL AND datetime(session_expires_at) >= datetime(?)",
        (key_hash, _format_db_time(now)),
    ).fetchone()
    if row is None:
        raise SessionError("session is expired or invalid; must log in again to continue")
    last_used_at = parse_time(row["session_last_used_at"])
    if last_used_at <= now - SESSION_LAST_USED_UPDATE_INTERVAL:
        tx.execute(
            "UPDATE user_sessions SET session_last_used_at = ? WHERE session_key_hash = ?",
            (_format_db_time(now), key_hash),
        )
    user_id = str(row["user_id"])
    if user_id.strip() == "":
        raise SessionError("session does not contain a legal user ID field")
    return user_id


def delete_expired_sessions(tx: sqlite3.Connection, now: datetime) -> int:
    cursor = tx.execute(
        "DELETE FROM user_sessions WHERE datetime(session_expires_at) < datetime(?)",
        (_format_db_time(now),),
    )
    return cursor.rowcount


@dataclass(slots=True)
class _LoginToken:
    user_id: str
    time: datetime


class LoginTokens:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tokens: dict[str, _LoginToken] = {}

    def _expire(self, now: datetime) -> None:
        expired = [
            token
            for token, record in self._tokens.items()
            if (now - record.time) >= LOGIN_TOKEN_TIMEOUT
        ]
        for token in expired:
            del self._tokens[token]

    def insert(self, user_id: str, now: datetime) -> str:
        with self._lock:
            while True:
                token = make_login_token()
                if token not in self._tokens:
                    break
            self._tokens[token] = _LoginToken(user_id=user_id, time=now)
            self._expire(now)
            return token

    def get(self, token: str, now: datetime) -> str:
        with self._lock:
            self._expire(now)
            if token not in self._tokens:
                raise SessionError(
                    f'login token "{token}" not found: tokens expire after 5 minutes and can only be used once'
                )
            user_id = self._tokens[token].user_id
            del self._tokens[token]
            return user_id
