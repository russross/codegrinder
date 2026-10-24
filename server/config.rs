use std::collections::BTreeSet;
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawIpFilter {
    #[serde(default)]
    whitelist: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawConfig {
    #[serde(default)]
    hostname: String,
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
        Some(values) => {
            values.iter().map(|value| parse_db_time(value)).collect::<AppResult<Vec<_>>>()?
        }
        None => local_session_defaults(),
    };
    let whitelist = raw.ip_filter.map(|filter| filter.whitelist).unwrap_or_default();
    Ok(ServerConfig {
        hostname: raw.hostname,
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
        ip_filter: IpFilterConfig { whitelist },
    })
}

fn resolve_config_path(config_dir: &Path, configured: PathBuf, default: &Path) -> PathBuf {
    let path = if configured.as_os_str().is_empty() { default } else { &configured };
    if path.is_absolute() { path.to_owned() } else { config_dir.join(path) }
}

pub fn validate_config(config: &ServerConfig) -> AppResult<()> {
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
    if config.lti_secret.trim().is_empty() {
        return Err(AppError::Internal(
            "cannot run with no ltiSecret in the config file".to_owned(),
        ));
    }
    if config.session_secret.trim().is_empty() {
        return Err(AppError::Internal(
            "cannot run with no sessionSecret in the config file".to_owned(),
        ));
    }
    if config.problem_types.is_empty() {
        return Err(AppError::Internal(
            "cannot run with no problemTypes in the config file".to_owned(),
        ));
    }
    let mut problem_types = BTreeSet::new();
    for problem_type in &config.problem_types {
        if problem_type.trim().is_empty() {
            return Err(AppError::Internal("problemTypes entries must not be empty".to_owned()));
        }
        if !problem_types.insert(problem_type) {
            return Err(AppError::Internal(format!(
                "problemTypes contains duplicate entry {problem_type:?}"
            )));
        }
    }
    if config.capacity == 0 {
        return Err(AppError::Internal("Daycare capacity must be greater than zero".to_owned()));
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

    fn config_from_json(raw: &str) -> AppResult<ServerConfig> {
        let dir = tempdir().unwrap();
        let config_path = dir.path().join("server.json");
        fs::write(&config_path, raw).unwrap();
        load_config(&config_path)
    }

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

    #[test]
    fn rejects_unknown_config_fields_at_every_level() {
        let top_level =
            config_from_json(r#"{"hostname":"example.test","hostnme":"typo"}"#).unwrap_err();
        assert!(top_level.to_string().contains("unknown field `hostnme`"));

        let nested = config_from_json(r#"{"hostname":"example.test","ipFilter":{"whiteList":[]}}"#)
            .unwrap_err();
        assert!(nested.to_string().contains("unknown field `whiteList`"));
    }

    #[test]
    fn requires_bookkeeping_secrets_and_local_execution_configuration() {
        let config = config_from_json(
            r#"{
                "hostname": "example.test",
                "daycareSecret": "secret",
                "ltiSecret": "secret",
                "sessionSecret": "secret",
                "capacity": 1,
                "problemTypes": ["python"]
            }"#,
        )
        .unwrap();
        validate_config(&config).unwrap();

        // Every server needs both bookkeeping credentials and execution capacity.
        let mut missing_lti = config.clone();
        missing_lti.lti_secret.clear();
        assert!(validate_config(&missing_lti).unwrap_err().to_string().contains("ltiSecret"));
        let mut missing_session = config.clone();
        missing_session.session_secret.clear();
        assert!(
            validate_config(&missing_session).unwrap_err().to_string().contains("sessionSecret")
        );
        let mut missing_types = config.clone();
        missing_types.problem_types.clear();
        assert!(validate_config(&missing_types).unwrap_err().to_string().contains("problemTypes"));
        let mut no_capacity = config;
        no_capacity.capacity = 0;
        assert!(validate_config(&no_capacity).unwrap_err().to_string().contains("capacity"));
    }

    #[test]
    fn rejects_empty_and_duplicate_problem_type_entries() {
        let mut config = config_from_json(
            r#"{
                "hostname": "example.test",
                "daycareSecret": "secret",
                "ltiSecret": "secret",
                "sessionSecret": "secret",
                "capacity": 1,
                "problemTypes": ["python"]
            }"#,
        )
        .unwrap();

        config.problem_types = vec!["python".to_owned(), " ".to_owned()];
        assert!(validate_config(&config).unwrap_err().to_string().contains("empty"));

        config.problem_types = vec!["python".to_owned(), "python".to_owned()];
        assert!(
            validate_config(&config)
                .unwrap_err()
                .to_string()
                .contains("duplicate entry \"python\"")
        );
    }
}
