from __future__ import annotations

import logging
import sqlite3
import time
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from typing import Iterator

from timeutils import format_duration_for_log


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(
        path,
        timeout=10.0,
        check_same_thread=False,
        isolation_level=None,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA cache_size = -20000")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def setup_db(path: Path) -> sqlite3.Connection:
    return _connect(path)


def _database_path(conn: sqlite3.Connection) -> Path | None:
    row = conn.execute("PRAGMA database_list").fetchone()
    if row is None:
        return None
    raw_path = str(row["file"] if isinstance(row, sqlite3.Row) else row[2])
    if raw_path == "":
        return None
    return Path(raw_path)


@contextmanager
def transaction(conn: sqlite3.Connection, *, label: str | None = None) -> Iterator[sqlite3.Connection]:
    db_path = _database_path(conn)
    tx = _connect(db_path) if db_path is not None else conn
    start = time.monotonic()
    tx.execute("BEGIN")
    try:
        yield tx
    except Exception:
        tx.execute("ROLLBACK")
        raise
    else:
        tx.execute("COMMIT")
    finally:
        if tx is not conn:
            tx.close()
        elapsed_seconds = time.monotonic() - start
        if elapsed_seconds > 0.5:
            elapsed = format_duration_for_log(timedelta(seconds=elapsed_seconds))
            if label is None:
                logging.info("transaction took %s", elapsed)
            else:
                logging.info("transaction %s took %s", label, elapsed)
