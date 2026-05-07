from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from db import setup_db
from sessions import (
    LoginTokens,
    SessionError,
    create_session,
    delete_expired_sessions,
    load_session_user_id,
    make_login_token,
    session_key_hash,
)


def _apply_schema(conn) -> None:
    schema_path = Path(__file__).resolve().parents[2] / "setup" / "schema.sql"
    schema = schema_path.read_text(encoding="utf-8")
    conn.executescript(schema)


class SessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = setup_db(Path(self.tmp.name) / "db.sqlite")
        _apply_schema(self.conn)
        self.conn.execute(
            "INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?)",
            ("42", "User 42", "user42"),
        )
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        self.tmp.cleanup()

    def test_create_and_load_session_uses_database_record(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        markers = [
            datetime(2020, 1, 1, 0, 0, 0, tzinfo=UTC),
            datetime(2020, 7, 1, 0, 0, 0, tzinfo=UTC),
        ]
        session = create_session(self.conn, "42", now, markers, "secret")
        self.assertEqual(session.expires_at, datetime(2026, 7, 1, 0, 0, 0, tzinfo=UTC))
        self.assertEqual(load_session_user_id(self.conn, session.session_key, "secret", now), "42")
        row = self.conn.execute("SELECT * FROM user_sessions").fetchone()
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["session_key_hash"], session_key_hash(session.session_key, "secret"))
        self.assertNotEqual(row["session_key_hash"], session.session_key)

    def test_load_session_updates_last_used_only_after_interval(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        markers = [datetime(2020, 7, 1, 0, 0, 0, tzinfo=UTC)]
        session = create_session(self.conn, "42", now, markers, "secret")
        load_session_user_id(self.conn, session.session_key, "secret", now + timedelta(minutes=9))
        row = self.conn.execute("SELECT session_last_used_at FROM user_sessions").fetchone()
        self.assertEqual(row["session_last_used_at"], "2026-02-15T10:00:00+00:00")
        load_session_user_id(self.conn, session.session_key, "secret", now + timedelta(minutes=11))
        row = self.conn.execute("SELECT session_last_used_at FROM user_sessions").fetchone()
        self.assertEqual(row["session_last_used_at"], "2026-02-15T10:11:00+00:00")

    def test_delete_expired_sessions_preserves_revoked_unexpired_sessions(self) -> None:
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        self.conn.execute(
            "INSERT INTO user_sessions(session_key_hash, user_id, session_created_at, session_expires_at, session_last_used_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("expired", "42", "2026-02-01T00:00:00+00:00", "2026-02-10T00:00:00+00:00", "2026-02-01T00:00:00+00:00"),
        )
        self.conn.execute(
            "INSERT INTO user_sessions(session_key_hash, user_id, session_created_at, session_expires_at, session_last_used_at, session_revoked_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                "revoked",
                "42",
                "2026-02-01T00:00:00+00:00",
                "2026-07-01T00:00:00+00:00",
                "2026-02-01T00:00:00+00:00",
                "2026-02-02T00:00:00+00:00",
            ),
        )
        self.assertEqual(delete_expired_sessions(self.conn, now), 1)
        rows = self.conn.execute("SELECT session_key_hash FROM user_sessions ORDER BY session_key_hash").fetchall()
        self.assertEqual([row["session_key_hash"] for row in rows], ["revoked"])

    def test_make_login_token_shape(self) -> None:
        token = make_login_token()
        self.assertEqual(len(token), 8)
        self.assertTrue(token.isascii())

    def test_login_tokens_insert_and_get(self) -> None:
        tokens = LoginTokens()
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        token = tokens.insert("77", now)
        self.assertEqual(tokens.get(token, now), "77")
        with self.assertRaises(SessionError):
            tokens.get(token, now)

    def test_login_tokens_expire(self) -> None:
        tokens = LoginTokens()
        now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        token = tokens.insert("77", now)
        future = now + timedelta(minutes=6)
        with self.assertRaises(SessionError):
            tokens.get(token, future)


if __name__ == "__main__":
    unittest.main()
