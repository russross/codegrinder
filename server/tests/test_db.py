from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from db import setup_db, transaction


class DBTests(unittest.TestCase):
    def test_setup_db_configures_busy_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "db.sqlite"
            conn = setup_db(db_path)
            row = conn.execute("PRAGMA busy_timeout").fetchone()
            self.assertIsNotNone(row)
            assert row is not None
            self.assertEqual(int(row[0]), 10000)
            conn.close()

    def test_setup_db_and_transaction_commit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "db.sqlite"
            conn = setup_db(db_path)
            conn.execute("CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
            with transaction(conn):
                conn.execute("INSERT INTO items(name) VALUES (?)", ("alpha",))
            row = conn.execute("SELECT COUNT(1) FROM items").fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(int(row[0]), 1)
            conn.close()

    def test_transaction_rollback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "db.sqlite"
            conn = setup_db(db_path)
            conn.execute("CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
            with self.assertRaises(sqlite3.IntegrityError):
                with transaction(conn) as tx:
                    tx.execute("INSERT INTO items(name) VALUES (?)", ("alpha",))
                    tx.execute("INSERT INTO items(id, name) VALUES (?, ?)", (1, "duplicate-id"))
            row = conn.execute("SELECT COUNT(1) FROM items").fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(int(row[0]), 0)
            conn.close()

    def test_can_open_snapshot_db_without_exposing_records(self) -> None:
        db_path = Path(__file__).resolve().parents[2] / "db" / "codegrinder.db"
        if not db_path.exists():
            self.skipTest(f"snapshot DB not present at {db_path}")
        conn = setup_db(db_path)
        row = conn.execute("PRAGMA schema_version").fetchone()
        self.assertIsNotNone(row)
        self.assertGreaterEqual(int(row[0]), 0)
        conn.close()

    def test_problem_type_delete_is_restricted_but_update_cascades_to_steps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "db.sqlite"
            conn = setup_db(db_path)
            schema_path = Path(__file__).resolve().parents[2] / "setup" / "schema.sql"
            conn.executescript(schema_path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO problem_types(problem_type, container) VALUES (?, ?)", ("oldtype", "img"))
            conn.execute(
                "INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                ("p1", "", "[]", "[]", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight) VALUES (?, ?, ?, ?, ?)",
                ("p1", 1, "oldtype", "", 1),
            )

            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("DELETE FROM problem_types WHERE problem_type = ?", ("oldtype",))

            conn.execute("UPDATE problem_types SET problem_type = ? WHERE problem_type = ?", ("newtype", "oldtype"))

            row = conn.execute("SELECT problem_type FROM problem_steps WHERE problem_id = ? AND step_number = ?", ("p1", 1)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["problem_type"], "newtype")
            conn.close()


if __name__ == "__main__":
    unittest.main()
