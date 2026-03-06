from __future__ import annotations

import unittest
from base64 import urlsafe_b64encode
from datetime import UTC, datetime, timedelta

from sessions import (
    COOKIE_NAME,
    CookieSession,
    LoginRecords,
    SessionError,
    decode_session,
    encode_session,
    make_login_key,
    new_session,
)


class SessionTests(unittest.TestCase):
    def test_encode_decode_roundtrip(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        session = CookieSession(expires_at=now + timedelta(hours=1), user_id="42")
        encoded = encode_session(session, "secret")
        decoded = decode_session(encoded, "secret", now)
        self.assertEqual(decoded.user_id, "42")
        self.assertEqual(decoded.expires_at, session.expires_at)

    def test_decode_rejects_bad_signature(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        session = CookieSession(expires_at=now + timedelta(hours=1), user_id="42")
        encoded = encode_session(session, "secret")
        tampered = encoded[:-1] + ("A" if encoded[-1] != "A" else "B")
        with self.assertRaises(SessionError):
            decode_session(tampered, "secret", now)

    def test_decode_rejects_expired(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        session = CookieSession(expires_at=now - timedelta(seconds=1), user_id="42")
        encoded = encode_session(session, "secret")
        with self.assertRaises(SessionError):
            decode_session(encoded, "secret", now)

    def test_decode_accepts_cookie_name_prefix(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        session = CookieSession(expires_at=now + timedelta(hours=1), user_id="42")
        encoded = encode_session(session, "secret")
        decoded = decode_session(f"{COOKIE_NAME}={encoded}", "secret", now)
        self.assertEqual(decoded.user_id, "42")

    def test_decode_rejects_invalid_payload_layout(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        bad_payload = urlsafe_b64encode(b"too-short").decode("ascii").rstrip("=")
        bad_sig = urlsafe_b64encode(b"x" * 32).decode("ascii").rstrip("=")
        with self.assertRaises(SessionError):
            decode_session(f"{bad_payload}.{bad_sig}", "secret", now)

    def test_new_session_uses_markers(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        markers = [
            datetime(2020, 1, 1, 0, 0, 0, tzinfo=UTC),
            datetime(2020, 7, 1, 0, 0, 0, tzinfo=UTC),
        ]
        session = new_session("10", now, markers)
        self.assertEqual(session.expires_at, datetime(2026, 7, 1, 0, 0, 0, tzinfo=UTC))

    def test_make_login_key_shape(self) -> None:
        key = make_login_key()
        self.assertEqual(len(key), 8)
        self.assertTrue(key.isascii())

    def test_login_records_insert_and_get(self) -> None:
        records = LoginRecords()
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        key = records.insert("77", now)
        self.assertEqual(records.get(key, now), "77")
        with self.assertRaises(SessionError):
            records.get(key, now)

    def test_login_records_expire(self) -> None:
        records = LoginRecords()
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        key = records.insert("77", now)
        future = now + timedelta(minutes=6)
        with self.assertRaises(SessionError):
            records.get(key, future)


if __name__ == "__main__":
    unittest.main()
