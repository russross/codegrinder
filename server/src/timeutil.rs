use chrono::{DateTime, Local, TimeZone, Utc};
use prost_types::Timestamp;

use crate::error::{AppError, AppResult};

pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

pub fn db_time(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

pub fn parse_db_time(raw: &str) -> AppResult<DateTime<Utc>> {
    let text = raw
        .strip_suffix('Z')
        .map_or_else(|| raw.to_owned(), |s| format!("{s}+00:00"));
    DateTime::parse_from_rfc3339(&text)
        .map(|dt| dt.with_timezone(&Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S")
                .map(|dt| Utc.from_utc_datetime(&dt))
        })
        .map_err(|err| AppError::BadRequest(format!("invalid timestamp {raw:?}: {err}")))
}

pub fn parse_optional_db_time(raw: Option<String>) -> AppResult<Option<DateTime<Utc>>> {
    raw.map(|value| parse_db_time(&value)).transpose()
}

pub fn timestamp(value: DateTime<Utc>) -> Timestamp {
    Timestamp {
        seconds: value.timestamp(),
        nanos: value.timestamp_subsec_nanos() as i32,
    }
}

pub fn timestamp_opt(raw: Option<String>) -> AppResult<Option<Timestamp>> {
    Ok(parse_optional_db_time(raw)?.map(timestamp))
}

pub fn timestamp_to_utc(ts: &Timestamp) -> AppResult<DateTime<Utc>> {
    DateTime::from_timestamp(ts.seconds, ts.nanos as u32)
        .ok_or_else(|| AppError::BadRequest("invalid protobuf timestamp".to_owned()))
}

pub fn parse_canvas_time(raw: &str) -> Option<DateTime<Utc>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(trimmed)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

pub fn local_session_defaults() -> Vec<DateTime<Utc>> {
    let tz = Local::now().timezone();
    [
        tz.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).single(),
        tz.with_ymd_and_hms(2020, 7, 1, 0, 0, 0).single(),
    ]
    .into_iter()
    .flatten()
    .map(|dt| dt.with_timezone(&Utc))
    .collect()
}

pub fn next_session_expiry(now: DateTime<Utc>, expiries: &[DateTime<Utc>]) -> DateTime<Utc> {
    expiries
        .iter()
        .copied()
        .filter(|value| *value > now)
        .min()
        .unwrap_or_else(|| now + chrono::Duration::days(180))
}
