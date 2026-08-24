use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::timeutil::{local_session_defaults, parse_db_time};

#[derive(Clone, Debug, Default)]
pub struct IpFilterConfig {
    pub whitelist: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub hostname: String,
    pub ta_hostname: String,
    pub daycare_secret: String,
    pub lti_secret: String,
    pub session_secret: String,
    pub capacity: usize,
    pub problem_types: Vec<String>,
    pub tool_name: String,
    pub tool_id: String,
    pub tool_description: String,
    pub container_engine: String,
    pub sqlite3_path: PathBuf,
    pub sessions_expire: Vec<DateTime<Utc>>,
    pub ip_filter: IpFilterConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIpFilter {
    #[serde(default)]
    whitelist: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConfig {
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    ta_hostname: String,
    #[serde(default)]
    daycare_secret: String,
    #[serde(default)]
    lti_secret: String,
    #[serde(default)]
    session_secret: String,
    #[serde(default)]
    capacity: usize,
    #[serde(default)]
    problem_types: Vec<String>,
    #[serde(default = "default_tool_name")]
    tool_name: String,
    #[serde(default = "default_tool_id")]
    tool_id: String,
    #[serde(default = "default_tool_description")]
    tool_description: String,
    #[serde(default = "default_container_engine")]
    container_engine: String,
    #[serde(default)]
    sqlite3_path: PathBuf,
    sessions_expire: Option<Vec<String>>,
    ip_filter: Option<RawIpFilter>,
}

fn default_tool_name() -> String {
    "CodeGrinder".to_owned()
}

fn default_tool_id() -> String {
    "codegrinder".to_owned()
}

fn default_tool_description() -> String {
    "Programming exercises with grading".to_owned()
}

fn default_container_engine() -> String {
    "docker".to_owned()
}

pub fn load_config(path: &Path) -> AppResult<ServerConfig> {
    let raw: RawConfig = serde_json::from_slice(&fs::read(path)?)?;
    let config_dir = path.parent().unwrap_or_else(|| Path::new("."));
    let sessions_expire = match raw.sessions_expire {
        Some(values) => values
            .iter()
            .map(|value| parse_db_time(value))
            .collect::<AppResult<Vec<_>>>()?,
        None => local_session_defaults(),
    };
    Ok(ServerConfig {
        hostname: raw.hostname,
        ta_hostname: raw.ta_hostname,
        daycare_secret: decode_base64_if_needed(&raw.daycare_secret),
        lti_secret: raw.lti_secret,
        session_secret: decode_base64_if_needed(&raw.session_secret),
        capacity: raw.capacity,
        problem_types: raw.problem_types,
        tool_name: raw.tool_name,
        tool_id: raw.tool_id,
        tool_description: raw.tool_description,
        container_engine: raw.container_engine,
        sqlite3_path: resolve_config_path(
            config_dir,
            raw.sqlite3_path,
            Path::new("db/codegrinder.db"),
        ),
        sessions_expire,
        ip_filter: IpFilterConfig {
            whitelist: raw.ip_filter.map(|ip| ip.whitelist).unwrap_or_default(),
        },
    })
}

fn resolve_config_path(config_dir: &Path, configured: PathBuf, default: &Path) -> PathBuf {
    let path = if configured.as_os_str().is_empty() {
        default
    } else {
        &configured
    };
    if path.is_absolute() {
        path.to_owned()
    } else {
        config_dir.join(path)
    }
}

pub fn validate_config(
    config: &ServerConfig,
    ta_enabled: bool,
    daycare_enabled: bool,
) -> AppResult<()> {
    if config.hostname.trim().is_empty() {
        return Err(AppError::Internal(
            "cannot run with no hostname in the config file".to_owned(),
        ));
    }
    if config.daycare_secret.trim().is_empty() {
        return Err(AppError::Internal(
            "cannot run with no daycareSecret in the config file".to_owned(),
        ));
    }
    if ta_enabled && config.lti_secret.trim().is_empty() {
        return Err(AppError::Internal(
            "cannot run TA role with no ltiSecret in the config file".to_owned(),
        ));
    }
    if ta_enabled && config.session_secret.trim().is_empty() {
        return Err(AppError::Internal(
            "cannot run TA role with no sessionSecret in the config file".to_owned(),
        ));
    }
    if daycare_enabled && config.problem_types.is_empty() {
        return Err(AppError::Internal(
            "cannot run Daycare role with no problemTypes in the config file".to_owned(),
        ));
    }
    if daycare_enabled && config.capacity == 0 {
        return Err(AppError::Internal(
            "Daycare capacity must be greater than zero".to_owned(),
        ));
    }
    if daycare_enabled && !ta_enabled && config.ta_hostname.trim().is_empty() {
        return Err(AppError::Internal(
            "cannot run standalone Daycare role with no taHostname in the config file".to_owned(),
        ));
    }
    Ok(())
}

fn decode_base64_if_needed(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    STANDARD
        .decode(raw)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_else(|| raw.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn decodes_base64_secrets_when_possible() {
        assert_eq!(decode_base64_if_needed("c2VjcmV0"), "secret");
        assert_eq!(decode_base64_if_needed("not base64"), "not base64");
    }

    #[test]
    fn resolves_data_paths_from_the_config_directory() {
        let dir = tempdir().unwrap();
        let config_path = dir.path().join("server.json");
        fs::write(
            &config_path,
            r#"{
                "hostname": "example.test",
                "sqlite3Path": "state/server.db"
            }"#,
        )
        .unwrap();

        let config = load_config(&config_path).unwrap();

        assert_eq!(config.sqlite3_path, dir.path().join("state/server.db"));
    }
}
