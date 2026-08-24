use crate::error::{CliError, Result, fail};
use crate::proto::codegrinder::AssignmentKey;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const DOT_FILE_NAME: &str = ".grind";
pub const DEFAULT_RPC_TIMEOUT_SECONDS: u64 = 10;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ApiTrace {
    pub report: bool,
    pub dump: bool,
    pub rpc_timeout: Duration,
}

impl ApiTrace {
    pub fn new(report: bool, dump: bool) -> Self {
        Self::with_timeout(
            report,
            dump,
            Duration::from_secs(DEFAULT_RPC_TIMEOUT_SECONDS),
        )
    }

    pub fn with_timeout(report: bool, dump: bool, rpc_timeout: Duration) -> Self {
        Self {
            report: report || dump,
            dump,
            rpc_timeout,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct Roles {
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_author: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_instructor: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_admin: bool,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub session_key: String,
    pub workspace_root: PathBuf,
    pub roles: Roles,
    pub trace: ApiTrace,
    pub rpc_timeout: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthenticatedUser {
    pub user_id: String,
    pub user_name: String,
    pub user_login: String,
    pub roles: Roles,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AssignmentRef {
    pub user_id: String,
    pub course_id: String,
    pub problem_set_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProblemInfo {
    pub problem_id: String,
    pub step: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DotFile {
    pub assignment: AssignmentRef,
    pub problems: BTreeMap<String, ProblemInfo>,
    pub path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RawConfig {
    #[serde(default)]
    host: String,
    #[serde(default)]
    session_key: String,
    #[serde(default = "home_string")]
    workspace_root: String,
    #[serde(flatten)]
    roles: Roles,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RawDotFile {
    assignment: AssignmentRef,
    problems: BTreeMap<String, ProblemInfo>,
}

pub fn config_file() -> PathBuf {
    let config_home = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".config"));
    config_home.join("codegrinder").join("config.toml")
}

pub fn load_config() -> Result<Config> {
    let path = config_file();
    if !path.exists() {
        fail(format!(
            "Unable to load config file; try running '{} login'",
            program_name()
        ))
    } else {
        load_config_from_path(&path, ApiTrace::new(false, false))
    }
}

pub fn load_config_or_default() -> Result<Config> {
    let path = config_file();
    if path.exists() {
        load_config_from_path(&path, ApiTrace::new(false, false))
    } else {
        Ok(Config {
            host: String::new(),
            session_key: String::new(),
            workspace_root: home_dir(),
            roles: Roles::default(),
            trace: ApiTrace::new(false, false),
            rpc_timeout: Duration::from_secs(DEFAULT_RPC_TIMEOUT_SECONDS),
        })
    }
}

pub fn load_config_from_path(path: &Path, trace: ApiTrace) -> Result<Config> {
    let contents = fs::read_to_string(path).map_err(|error| {
        CliError::Io(format!("unable to read config {}: {error}", path.display()))
    })?;
    let raw: RawConfig = toml::from_str(&contents)
        .map_err(|error| CliError::Toml(format!("invalid config {}: {error}", path.display())))?;
    Ok(Config {
        host: raw.host,
        session_key: raw.session_key,
        workspace_root: expand_home(&raw.workspace_root),
        roles: raw.roles,
        trace,
        rpc_timeout: trace.rpc_timeout,
    })
}

pub fn write_login_config(config: &Config) -> Result<()> {
    let path = config_file();
    let existing = load_config_or_default()?;
    let raw = RawConfig {
        host: config.host.clone(),
        session_key: config.session_key.clone(),
        workspace_root: existing.workspace_root.to_string_lossy().to_string(),
        roles: config.roles,
    };
    let parent = path.parent().ok_or_else(|| {
        crate::error::CliError::Message(format!("invalid config path {}", path.display()))
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        CliError::Io(format!(
            "unable to create config directory {}: {error}",
            parent.display()
        ))
    })?;
    let contents = toml::to_string(&raw)?;
    fs::write(&path, contents).map_err(|error| {
        CliError::Io(format!(
            "unable to write config {}: {error}",
            path.display()
        ))
    })?;
    Ok(())
}

pub fn find_dotfile(start_dir: &Path) -> Result<(DotFile, PathBuf, Option<PathBuf>)> {
    let start_dir = if start_dir.is_absolute() {
        start_dir.to_path_buf()
    } else {
        start_dir.canonicalize()?
    };
    let ancestors = start_dir
        .ancestors()
        .map(Path::to_path_buf)
        .collect::<Vec<_>>();
    for (index, problem_set_dir) in ancestors.iter().enumerate() {
        let dotfile_path = problem_set_dir.join(DOT_FILE_NAME);
        if dotfile_path.exists() {
            let dotfile = load_dotfile(&dotfile_path)?;
            let problem_dir = index
                .checked_sub(1)
                .and_then(|previous| ancestors.get(previous))
                .cloned();
            return Ok((dotfile, problem_set_dir.clone(), problem_dir));
        }
    }
    fail(format!(
        "unable to find {DOT_FILE_NAME} in {} or an ancestor directory\n   you must run this in a problem directory\n   or supply the directory name as an argument",
        start_dir.display()
    ))
}

pub fn load_dotfile(path: &Path) -> Result<DotFile> {
    let contents = fs::read_to_string(path)
        .map_err(|error| CliError::Io(format!("unable to read {}: {error}", path.display())))?;
    let raw: RawDotFile = toml::from_str(&contents)
        .map_err(|error| CliError::Toml(format!("invalid {}: {error}", path.display())))?;
    Ok(DotFile {
        assignment: raw.assignment,
        problems: raw.problems,
        path: path.to_path_buf(),
    })
}

pub fn save_dotfile(dotfile: &DotFile) -> Result<()> {
    let raw = RawDotFile {
        assignment: dotfile.assignment.clone(),
        problems: dotfile.problems.clone(),
    };
    let contents = toml::to_string(&raw)?;
    fs::write(&dotfile.path, contents).map_err(|error| {
        CliError::Io(format!(
            "unable to write {}: {error}",
            dotfile.path.display()
        ))
    })?;
    Ok(())
}

pub fn assignment_key_from_ref(assignment: &AssignmentRef) -> AssignmentKey {
    AssignmentKey {
        user_id: assignment.user_id.clone(),
        course_id: assignment.course_id.clone(),
        problem_set_id: assignment.problem_set_id.clone(),
    }
}

pub fn assignment_ref_from_key(assignment: &AssignmentKey) -> AssignmentRef {
    AssignmentRef {
        user_id: assignment.user_id.clone(),
        course_id: assignment.course_id.clone(),
        problem_set_id: assignment.problem_set_id.clone(),
    }
}

pub fn program_name() -> String {
    env::args()
        .next()
        .and_then(|arg| {
            PathBuf::from(arg)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "grind".to_string())
}

pub fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn expand_home(raw: &str) -> PathBuf {
    if raw == "~" {
        home_dir()
    } else if let Some(rest) = raw.strip_prefix("~/") {
        home_dir().join(rest)
    } else {
        PathBuf::from(raw)
    }
}

pub fn abbreviate_home(path: &Path) -> String {
    let home = home_dir();
    let expanded = path.to_path_buf();
    match expanded.strip_prefix(&home) {
        Ok(relative) if relative.as_os_str().is_empty() => "~".to_string(),
        Ok(relative) => PathBuf::from("~")
            .join(relative)
            .to_string_lossy()
            .to_string(),
        Err(_) => expanded.to_string_lossy().to_string(),
    }
}

fn home_string() -> String {
    home_dir().to_string_lossy().to_string()
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::{
        ApiTrace, AssignmentRef, DotFile, ProblemInfo, load_config_from_path, save_dotfile,
    };
    use std::collections::BTreeMap;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn load_config_defaults_missing_role_flags_to_false() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("config.toml");
        fs::write(
            &path,
            "host = \"example.edu\"\nsession_key = \"abc\"\nworkspace_root = \"/tmp/work\"\n",
        )
        .expect("write");

        let config = load_config_from_path(&path, ApiTrace::new(false, false)).expect("config");

        assert_eq!(config.host, "example.edu");
        assert_eq!(config.session_key, "abc");
        assert!(!config.roles.is_author);
        assert!(!config.roles.is_instructor);
        assert!(!config.roles.is_admin);
    }

    #[test]
    fn dotfile_round_trip_uses_toml_tables() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join(".grind");
        let dotfile = DotFile {
            assignment: AssignmentRef {
                user_id: "u1".to_string(),
                course_id: "c1".to_string(),
                problem_set_id: "ps1".to_string(),
            },
            problems: BTreeMap::from([(
                "p1".to_string(),
                ProblemInfo {
                    problem_id: "p101".to_string(),
                    step: 3,
                },
            )]),
            path: path.clone(),
        };

        save_dotfile(&dotfile).expect("save");
        let text = fs::read_to_string(path).expect("read");

        assert!(text.contains("[assignment]"));
        assert!(text.contains("[problems.p1]"));
        assert!(text.contains("step = 3"));
    }
}
