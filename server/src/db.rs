use std::any::Any;
use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use tokio::sync::{mpsc, oneshot};

use crate::error::{AppError, AppResult};

const SCHEMA_SQL: &str = include_str!("../../setup/schema.sql");

type DbJob = Box<dyn FnOnce(&Connection) -> AppResult<DbResponse> + Send + 'static>;

enum DbResponse {
    Value(Box<dyn Any + Send>),
}

struct DbMessage {
    job: DbJob,
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
                    let result = (message.job)(&conn);
                    let _ = message.reply.send(result);
                }
            })
            .map_err(|err| AppError::Internal(format!("failed to start db thread: {err}")))?;
        Ok(Self { sender })
    }

    pub async fn call<T, F>(&self, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> AppResult<T> + Send + 'static,
    {
        let (reply, recv) = oneshot::channel();
        let job = Box::new(move |conn: &Connection| {
            f(conn).map(|value| DbResponse::Value(Box::new(value)))
        });
        self.sender
            .send(DbMessage { job, reply })
            .map_err(|_| AppError::Internal("database worker stopped".to_owned()))?;
        match recv
            .await
            .map_err(|_| AppError::Internal("database worker dropped response".to_owned()))??
        {
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
        self.call(move |conn| {
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
        PRAGMA busy_timeout = 10000;
        ",
    )?;
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
}
