use std::fmt;

use chrono::Utc;

// Each record occupies one line so concurrent tasks remain readable in syslog.
pub fn record(level: &str, event: &str, fields: fmt::Arguments<'_>) {
    eprintln!("{} level={level} event={event} {fields}", Utc::now().to_rfc3339());
}
