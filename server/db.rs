use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags};
use tokio::task::spawn_blocking;

use crate::error::{AppError, AppResult};

const DEFAULT_BUSY_TIMEOUT: Duration = Duration::from_secs(10);
const SQLITE_PROGRESS_OPS: i32 = 1_000;

#[derive(Clone)]
pub struct Db {
    path: PathBuf,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Validate the database at startup. Each transaction owns a fresh connection
        // so independent requests can run concurrently without sharing connection state.
        open_connection(path)?;
        Ok(Self { path: path.to_owned() })
    }

    async fn call_until<T, F>(&self, deadline: Option<Instant>, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> AppResult<T> + Send + 'static,
    {
        let path = self.path.clone();
        let job = spawn_blocking(move || {
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                return Err(deadline_exceeded());
            }
            let conn = open_connection_until(&path, deadline)?;
            set_job_deadline(&conn, deadline)?;
            f(&conn)
        });

        // Blocking connection setup and lock acquisition stay outside the async runtime.
        // SQL progress and busy handlers also enforce the deadline inside the worker.
        let result = match deadline {
            Some(deadline) => {
                let remaining = deadline
                    .checked_duration_since(Instant::now())
                    .ok_or_else(deadline_exceeded)?;
                tokio::time::timeout(remaining, job).await.map_err(|_| deadline_exceeded())?
            }
            None => job.await,
        };
        result.map_err(|err| AppError::Internal(format!("database task failed: {err}")))?
    }

    pub async fn transaction<T, F>(&self, write: bool, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> AppResult<T> + Send + 'static,
    {
        self.transaction_until(write, None, f).await
    }

    pub async fn transaction_until<T, F>(
        &self,
        write: bool,
        deadline: Option<Instant>,
        f: F,
    ) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> AppResult<T> + Send + 'static,
    {
        self.call_until(deadline, move |conn| {
            // Potential writers acquire their lock before reading so another connection
            // cannot invalidate the snapshot before the first write.
            conn.execute_batch(if write { "BEGIN IMMEDIATE" } else { "BEGIN" })?;
            let result = f(conn);
            match result {
                Ok(value) => {
                    conn.execute_batch("COMMIT")?;
                    Ok(value)
                }
                Err(err) => {
                    let _ = conn.execute_batch("ROLLBACK");
                    Err(err)
                }
            }
        })
        .await
    }
}

fn set_job_deadline(conn: &Connection, deadline: Option<Instant>) -> AppResult<()> {
    let Some(deadline) = deadline else {
        conn.busy_timeout(DEFAULT_BUSY_TIMEOUT)?;
        conn.progress_handler(0, None::<fn() -> bool>)?;
        return Ok(());
    };
    let remaining =
        deadline.checked_duration_since(Instant::now()).ok_or_else(deadline_exceeded)?;
    conn.busy_timeout(remaining.min(DEFAULT_BUSY_TIMEOUT))?;
    conn.progress_handler(SQLITE_PROGRESS_OPS, Some(move || Instant::now() >= deadline))?;
    Ok(())
}

fn deadline_exceeded() -> AppError {
    AppError::DeadlineExceeded("request deadline exceeded".to_owned())
}

pub fn open_connection(path: &Path) -> AppResult<Connection> {
    open_connection_until(path, None)
}

fn open_connection_until(path: &Path, deadline: Option<Instant>) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
    )?;
    configure_connection(&conn, deadline)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_test_connection(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
    )?;
    configure_connection(&conn, None)?;
    conn.execute_batch(include_str!("../setup/schema.sql"))?;
    Ok(conn)
}

fn configure_connection(conn: &Connection, deadline: Option<Instant>) -> AppResult<()> {
    // Connection setup can acquire database locks, so it uses the same timeout and
    // SQL progress deadline as the transaction that follows it.
    set_job_deadline(conn, deadline)?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -20000;
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    };
    use tokio::sync::oneshot;

    #[test]
    fn test_connection_uses_canonical_schema() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_test_connection(&dir.path().join("db.sqlite")).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(1) FROM sqlite_master WHERE name = 'users'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn connection_requires_an_existing_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.sqlite");

        assert!(open_connection(&path).is_err());
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn transaction_write_intent_controls_concurrent_writers() {
        for write in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("db.sqlite");
            let other = open_test_connection(&path).unwrap();
            other.busy_timeout(Duration::ZERO).unwrap();
            let db = Db::open(&path).unwrap();

            // A separate writer can commit alongside a reader, but a potential writer
            // reserves its lock before the callback establishes a read snapshot.
            db.transaction(write, move |conn| {
                let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |row| {
                    row.get(0)
                })?;
                assert_eq!(count, 0);
                let result = other.execute(
                    "INSERT INTO users(user_id, user_name, user_login) VALUES ('other', 'Other', 'other')",
                    [],
                );
                if write {
                    assert!(matches!(
                        result,
                        Err(rusqlite::Error::SqliteFailure(error, _))
                            if error.code == rusqlite::ErrorCode::DatabaseBusy
                    ));
                    conn.execute(
                        "INSERT INTO users(user_id, user_name, user_login) VALUES ('owner', 'Owner', 'owner')",
                        [],
                    )?;
                } else {
                    assert_eq!(result.unwrap(), 1);
                }
                Ok(())
            })
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn reader_completes_while_another_transaction_holds_the_write_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        open_test_connection(&path).unwrap();
        let db = Db::open(&path).unwrap();
        let writer_db = db.clone();
        let (started, ready) = oneshot::channel();
        let (release, wait_for_release) = mpsc::channel();

        // Keep an uncommitted write open while a separate request reads its own
        // snapshot. The channels establish ordering without relying on sleeps.
        let writer = tokio::spawn(async move {
            writer_db
                .transaction(true, move |conn| {
                    conn.execute(
                        "INSERT INTO users(user_id, user_name, user_login) VALUES ('writer', 'Writer', 'writer')",
                        [],
                    )?;
                    started.send(()).unwrap();
                    wait_for_release.recv_timeout(Duration::from_secs(10)).unwrap();
                    Ok(())
                })
                .await
        });
        tokio::time::timeout(Duration::from_secs(5), ready).await.unwrap().unwrap();
        let reader = tokio::time::timeout(
            Duration::from_secs(5),
            db.transaction(false, |conn| {
                Ok(conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get::<_, i64>(0))?)
            }),
        )
        .await;

        // Release and join the writer before asserting so a failed concurrency check
        // does not leave a blocking task waiting for the test to finish.
        release.send(()).unwrap();
        writer.await.unwrap().unwrap();
        assert_eq!(reader.unwrap().unwrap(), 0);
        let count = db
            .transaction(false, |conn| {
                Ok(conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get::<_, i64>(0))?)
            })
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn expired_transaction_deadline_does_not_run_job() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        open_test_connection(&path).unwrap();
        let db = Db::open(&path).unwrap();
        db.transaction(false, |_| Ok(())).await.unwrap();
        let called = Arc::new(AtomicBool::new(false));
        let called_in_job = called.clone();

        let result = db
            .transaction_until(false, Some(Instant::now() - Duration::from_millis(1)), move |_| {
                called_in_job.store(true, Ordering::Relaxed);
                Ok(())
            })
            .await;

        assert!(matches!(result, Err(AppError::DeadlineExceeded(_))));
        assert!(!called.load(Ordering::Relaxed));
    }
}
