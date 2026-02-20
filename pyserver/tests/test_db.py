from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from db import setup_db, transaction


class DBTests(unittest.TestCase):
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
                with transaction(conn):
                    conn.execute("INSERT INTO items(name) VALUES (?)", ("alpha",))
                    conn.execute("INSERT INTO items(id, name) VALUES (?, ?)", (1, "duplicate-id"))
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


if __name__ == "__main__":
    unittest.main()
