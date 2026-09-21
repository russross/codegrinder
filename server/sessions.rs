use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use rand::RngExt;
use rand::distr::{Alphanumeric, SampleString};
use rusqlite::{Connection, params};

use crate::error::{AppError, AppResult};
use crate::signatures::hmac_sha256_base64;
use crate::timeutil::{db_time, next_session_expiry, parse_db_time};

const LOGIN_TOKEN_TIMEOUT: Duration = Duration::minutes(5);
const SESSION_LAST_USED_UPDATE_INTERVAL: Duration = Duration::minutes(10);
const SESSION_KEY_HMAC_CONTEXT: &[u8] = b"codegrinder:session-key:v1\0";
const LOGIN_TOKEN_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

#[derive(Clone, Debug)]
pub struct Session {
    pub session_key: String,
}

#[derive(Clone, Debug)]
struct LoginToken {
    user_id: String,
    time: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub struct LoginTokens {
    tokens: Mutex<HashMap<String, LoginToken>>,
}

impl LoginTokens {
    pub fn insert(&self, user_id: &str, now: DateTime<Utc>) -> AppResult<String> {
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| AppError::Internal("login token lock poisoned".to_owned()))?;
        expire_tokens(&mut tokens, now);
        loop {
            let token = make_login_token();
            if !tokens.contains_key(&token) {
                tokens.insert(token.clone(), LoginToken { user_id: user_id.to_owned(), time: now });
                return Ok(token);
            }
        }
    }

    pub fn take(&self, token: &str, now: DateTime<Utc>) -> AppResult<String> {
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| AppError::Internal("login token lock poisoned".to_owned()))?;
        expire_tokens(&mut tokens, now);
        tokens.remove(token).map(|record| record.user_id).ok_or_else(|| {
            AppError::BadRequest(format!(
                "login token {token:?} not found: tokens expire after 5 minutes and can only be used once"
            ))
        })
    }
}

fn expire_tokens(tokens: &mut HashMap<String, LoginToken>, now: DateTime<Utc>) {
    tokens.retain(|_, record| now - record.time < LOGIN_TOKEN_TIMEOUT);
}

fn make_login_token() -> String {
    let mut rng = rand::rng();
    (0..8)
        .map(|_| {
            let idx = rng.random_range(0..LOGIN_TOKEN_CHARS.len());
            LOGIN_TOKEN_CHARS[idx] as char
        })
        .collect()
}

fn make_session_key() -> String {
    Alphanumeric.sample_string(&mut rand::rng(), 43)
}

pub fn session_key_hash(session_key: &str, session_secret: &str) -> AppResult<String> {
    if session_key.trim().is_empty() {
        return Err(AppError::Unauthorized("session key is empty".to_owned()));
    }
    if session_secret.trim().is_empty() {
        return Err(AppError::Internal("session secret is empty".to_owned()));
    }
    let payload = [SESSION_KEY_HMAC_CONTEXT, session_key.as_bytes()].concat();
    hmac_sha256_base64(session_secret, &payload)
}

pub fn create_session(
    tx: &Connection,
    user_id: &str,
    now: DateTime<Utc>,
    sessions_expire: &[DateTime<Utc>],
    session_secret: &str,
) -> AppResult<Session> {
    if user_id.trim().is_empty() {
        return Err(AppError::BadRequest(
            "session does not contain a legal user ID field".to_owned(),
        ));
    }
    let expires_at = next_session_expiry(now, sessions_expire);
    for _ in 0..20 {
        let session_key = make_session_key();
        let key_hash = session_key_hash(&session_key, session_secret)?;
        let result = tx.execute(
            "INSERT INTO user_sessions(session_key_hash, user_id, session_created_at, session_expires_at, session_last_used_at) VALUES (?, ?, ?, ?, ?)",
            params![key_hash, user_id, db_time(now), db_time(expires_at), db_time(now)],
        );
        match result {
            Ok(_) => {
                return Ok(Session { session_key });
            }
            Err(rusqlite::Error::SqliteFailure(error, _))
                if error.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY => {}
            Err(err) => return Err(err.into()),
        }
    }
    Err(AppError::Internal("could not create unique session key".to_owned()))
}

pub fn load_session_user_id(
    tx: &Connection,
    session_key: &str,
    session_secret: &str,
    now: DateTime<Utc>,
) -> AppResult<String> {
    let key_hash = session_key_hash(session_key, session_secret)?;
    let row = tx.query_row(
        "SELECT user_id, session_last_used_at FROM user_sessions WHERE session_key_hash = ? AND session_revoked_at IS NULL AND datetime(session_expires_at) >= datetime(?)",
        params![key_hash, db_time(now)],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    );
    let (user_id, last_used_at) = match row {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(AppError::Unauthorized(
                "session is expired or invalid; must log in again to continue".to_owned(),
            ));
        }
        Err(err) => return Err(err.into()),
    };
    if parse_db_time(&last_used_at)? <= now - SESSION_LAST_USED_UPDATE_INTERVAL {
        tx.execute(
            "UPDATE user_sessions SET session_last_used_at = ? WHERE session_key_hash = ?",
            params![db_time(now), key_hash],
        )?;
    }
    if user_id.trim().is_empty() {
        return Err(AppError::Unauthorized(
            "session does not contain a legal user ID field".to_owned(),
        ));
    }
    Ok(user_id)
}

pub fn delete_expired_sessions(tx: &Connection, now: DateTime<Utc>) -> AppResult<usize> {
    Ok(tx.execute(
        "DELETE FROM user_sessions WHERE datetime(session_expires_at) < datetime(?)",
        params![db_time(now)],
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_tokens_are_single_use() {
        let tokens = LoginTokens::default();
        let now = Utc::now();
        let token = tokens.insert("u1", now).unwrap();
        assert_eq!(tokens.take(&token, now).unwrap(), "u1");
        assert!(tokens.take(&token, now).is_err());
    }
}
