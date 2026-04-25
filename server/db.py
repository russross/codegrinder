from __future__ import annotations

import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from typing import Iterator

from timeutils import format_duration_for_log

_DB_LOCK = threading.Lock()


def setup_db(path: Path) -> sqlite3.Connection:
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


@contextmanager
def transaction(conn: sqlite3.Connection, *, label: str | None = None) -> Iterator[sqlite3.Connection]:
    with _DB_LOCK:
        start = time.monotonic()
        conn.execute("BEGIN")
        try:
            yield conn
        except Exception:
            conn.execute("ROLLBACK")
            raise
        else:
            conn.execute("COMMIT")
        finally:
            elapsed_seconds = time.monotonic() - start
            if elapsed_seconds > 0.5:
                elapsed = format_duration_for_log(timedelta(seconds=elapsed_seconds))
                if label is None:
                    logging.info("transaction took %s", elapsed)
                else:
                    logging.info("transaction %s took %s", label, elapsed)
