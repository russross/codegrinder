use std::any::Any;
use std::path::Path;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags};
use tokio::sync::{mpsc, oneshot};

use crate::error::{AppError, AppResult};

const SCHEMA_SQL: &str = include_str!("../../setup/schema.sql");
const DEFAULT_BUSY_TIMEOUT: Duration = Duration::from_secs(10);
const SQLITE_PROGRESS_OPS: i32 = 1_000;

type DbJob = Box<dyn FnOnce(&Connection) -> AppResult<DbResponse> + Send + 'static>;

enum DbResponse {
    Value(Box<dyn Any + Send>),
}

struct DbMessage {
    job: DbJob,
    deadline: Option<Instant>,
    reply: oneshot::Sender<AppResult<DbResponse>>,
}

#[derive(Clone)]
pub struct Db {
    sender: mpsc::UnboundedSender<DbMessage>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let path = path.to_owned();
        let (sender, mut receiver) = mpsc::unbounded_channel::<DbMessage>();
        std::thread::Builder::new()
            .name("codegrinder-db".to_owned())
            .spawn(move || {
                let conn = open_connection(&path).expect("database connection failed");
                while let Some(message) = receiver.blocking_recv() {
                    let result = run_job(&conn, message.job, message.deadline);
                    let _ = message.reply.send(result);
                }
            })
            .map_err(|err| AppError::Internal(format!("failed to start db thread: {err}")))?;
        Ok(Self { sender })
    }

    async fn call_until<T, F>(&self, deadline: Option<Instant>, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> AppResult<T> + Send + 'static,
    {
        let (reply, recv) = oneshot::channel();
        let job = Box::new(move |conn: &Connection| {
            f(conn).map(|value| DbResponse::Value(Box::new(value)))
        });
        self.sender
            .send(DbMessage {
                job,
                deadline,
                reply,
            })
            .map_err(|_| AppError::Internal("database worker stopped".to_owned()))?;
        let response = match deadline {
            Some(deadline) => {
                let remaining = deadline
                    .checked_duration_since(Instant::now())
                    .ok_or_else(deadline_exceeded)?;
                tokio::time::timeout(remaining, recv)
                    .await
                    .map_err(|_| deadline_exceeded())?
                    .map_err(|_| {
                        AppError::Internal("database worker dropped response".to_owned())
                    })?
            }
            None => recv
                .await
                .map_err(|_| AppError::Internal("database worker dropped response".to_owned()))?,
        }?;
        match response {
            DbResponse::Value(value) => value
                .downcast::<T>()
                .map(|boxed| *boxed)
                .map_err(|_| AppError::Internal("database response type mismatch".to_owned())),
        }
    }

    pub async fn transaction<T, F>(&self, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> AppResult<T> + Send + 'static,
    {
        self.transaction_until(None, f).await
    }

    pub async fn transaction_until<T, F>(&self, deadline: Option<Instant>, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> AppResult<T> + Send + 'static,
    {
        self.call_until(deadline, move |conn| {
            conn.execute_batch("BEGIN")?;
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

fn run_job(conn: &Connection, job: DbJob, deadline: Option<Instant>) -> AppResult<DbResponse> {
    if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
        return Err(deadline_exceeded());
    }
    set_job_deadline(conn, deadline)?;
    let result = job(conn);
    clear_job_deadline(conn)?;
    result
}

fn set_job_deadline(conn: &Connection, deadline: Option<Instant>) -> AppResult<()> {
    let Some(deadline) = deadline else {
        conn.busy_timeout(DEFAULT_BUSY_TIMEOUT)?;
        conn.progress_handler(0, None::<fn() -> bool>)?;
        return Ok(());
    };
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(deadline_exceeded)?;
    conn.busy_timeout(remaining.min(DEFAULT_BUSY_TIMEOUT))?;
    conn.progress_handler(
        SQLITE_PROGRESS_OPS,
        Some(move || Instant::now() >= deadline),
    )?;
    Ok(())
}

fn clear_job_deadline(conn: &Connection) -> AppResult<()> {
    conn.progress_handler(0, None::<fn() -> bool>)?;
    conn.busy_timeout(DEFAULT_BUSY_TIMEOUT)?;
    Ok(())
}

fn deadline_exceeded() -> AppError {
    AppError::DeadlineExceeded("request deadline exceeded".to_owned())
}

pub fn open_connection(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
    )?;
    configure_connection(&conn)?;
    ensure_schema(&conn)?;
    Ok(conn)
}

fn configure_connection(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -20000;
        ",
    )?;
    conn.busy_timeout(DEFAULT_BUSY_TIMEOUT)?;
    Ok(())
}

fn ensure_schema(conn: &Connection) -> AppResult<()> {
    let has_schema: i64 = conn.query_row(
        "SELECT COUNT(1) FROM sqlite_master WHERE type IN ('table', 'view') AND name = 'problem_types'",
        [],
        |row| row.get(0),
    )?;
    if has_schema == 0 {
        conn.execute_batch(SCHEMA_SQL)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    #[test]
    fn schema_is_created_for_empty_database() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM sqlite_master WHERE name = 'users'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn assignment_completion_view_migration_preserves_dependent_views() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();

        conn.execute_batch(include_str!(
            "../../setup/migrate-assignment-problem-completion.sql"
        ))
        .unwrap();

        let completed_columns: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM pragma_table_info('assignment_problem_progress') WHERE name = 'completed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(completed_columns, 1);
        conn.prepare("SELECT * FROM workspace_step_context")
            .unwrap();
    }

    #[tokio::test]
    async fn expired_transaction_deadline_does_not_run_job() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(&dir.path().join("db.sqlite")).unwrap();
        db.transaction(|_| Ok(())).await.unwrap();
        let called = Arc::new(AtomicBool::new(false));
        let called_in_job = called.clone();

        let result = db
            .transaction_until(Some(Instant::now() - Duration::from_millis(1)), move |_| {
                called_in_job.store(true, Ordering::Relaxed);
                Ok(())
            })
            .await;

        assert!(matches!(result, Err(AppError::DeadlineExceeded(_))));
        assert!(!called.load(Ordering::Relaxed));
    }
}
