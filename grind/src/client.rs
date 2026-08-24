use crate::config::{ApiTrace, AuthenticatedUser, Config, Roles, write_login_config};
use crate::error::{CliError, Result, fail, rpc_error, transport_error};
use crate::proto::codegrinder::code_grinder_service_client::CodeGrinderServiceClient;
use crate::proto::codegrinder::{
    AssignmentKey, AuthorProblemDraft, Commit, GetAssignmentRequest, GetAssignmentResponse,
    GetProblemTypeRequest, GetProblemTypeResponse, GetProblemTypesRequest, GetProblemTypesResponse,
    GetWorkspaceRequest, GetWorkspaceResponse, GradingCommit, HelloRequest, HelloResponse,
    ListAssignmentsRequest, ListAssignmentsResponse, ProblemBundle, ProblemSetBundle,
    ProblemTypeAction, SaveGradedCommitRequest, SaveGradedCommitResponse, SaveMode,
    SaveProblemRequest, SaveProblemResponse, SaveProblemSetRequest, SaveProblemSetResponse,
    SaveProblemTypeFilesRequest, SaveProblemTypeFilesResponse, SaveProblemTypeRequest,
    SaveProblemTypeResponse, SaveUngradedCommitRequest, SaveUngradedCommitResponse,
    SaveWorkspaceCommitRequest, SaveWorkspaceCommitResponse, SearchProblemCatalogRequest,
    SearchProblemCatalogResponse, SignedRuntimeBundle, WorkspaceFileState,
};
use crate::version::CURRENT_VERSION;
use prost::Message;
use semver::Version;
use std::collections::BTreeMap;
use std::env;
use std::ffi::OsStr;
use std::fmt::Debug;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::str::FromStr;
use std::time::Duration;
use tokio::process::Command;
use tonic::metadata::MetadataValue;
use tonic::transport::{Channel, ClientTlsConfig, Endpoint};
use tonic::{Request, Streaming};

macro_rules! call_rpc {
    ($session:expr, $name:literal, $request:expr, $method:ident) => {{
        let request = $request;
        dump(&$session.config.trace, $name, true, &request);
        let request = authorize(
            timed_request(request, $session.config.rpc_timeout),
            &$session.config.session_key,
        )?;
        let response = $session
            .client
            .$method(request)
            .await
            .map_err(|status| rpc_error($name, &$session.config.host, status))?
            .into_inner();
        dump(&$session.config.trace, $name, false, &response);
        Ok::<_, CliError>(response)
    }};
}

#[derive(Debug)]
pub struct Session {
    pub client: CodeGrinderServiceClient<Channel>,
    pub user: AuthenticatedUser,
    pub config: Config,
}

impl Session {
    pub async fn connect(mut config: Config, trace: ApiTrace) -> Result<Self> {
        config.trace = trace;
        config.rpc_timeout = trace.rpc_timeout;
        let mut client = new_grpc_client(&config).await?;
        let request = authorize(
            timed_request(
                HelloRequest {
                    token: String::new(),
                },
                config.rpc_timeout,
            ),
            &config.session_key,
        )?;
        dump(&config.trace, "Hello", true, &request.get_ref());
        let response = client
            .hello(request)
            .await
            .map_err(|status| rpc_error("Hello", &config.host, status))?
            .into_inner();
        dump(&config.trace, "Hello", false, &response);
        check_version(&response, &config.host).await?;
        let user = user_from_hello(&response)?;
        if config.roles != user.roles {
            config.roles = user.roles;
            write_login_config(&config)?;
        }
        Ok(Self {
            client,
            user,
            config,
        })
    }

    pub async fn list_assignments(
        &mut self,
        search: Vec<String>,
        include_student_context: bool,
    ) -> Result<ListAssignmentsResponse> {
        call_rpc!(
            self,
            "ListAssignments",
            ListAssignmentsRequest {
                search,
                include_student_context,
            },
            list_assignments
        )
    }

    pub async fn search_problem_catalog(
        &mut self,
        search: Vec<String>,
    ) -> Result<SearchProblemCatalogResponse> {
        call_rpc!(
            self,
            "SearchProblemCatalog",
            SearchProblemCatalogRequest { search },
            search_problem_catalog
        )
    }

    pub async fn get_problem_types(&mut self) -> Result<GetProblemTypesResponse> {
        call_rpc!(
            self,
            "GetProblemTypes",
            GetProblemTypesRequest {},
            get_problem_types
        )
    }

    pub async fn get_problem_type(
        &mut self,
        problem_type: String,
    ) -> Result<GetProblemTypeResponse> {
        call_rpc!(
            self,
            "GetProblemType",
            GetProblemTypeRequest { problem_type },
            get_problem_type
        )
    }

    pub async fn save_problem_type_files(
        &mut self,
        problem_type: String,
        files: BTreeMap<String, Vec<u8>>,
    ) -> Result<SaveProblemTypeFilesResponse> {
        call_rpc!(
            self,
            "SaveProblemTypeFiles",
            SaveProblemTypeFilesRequest {
                problem_type,
                files
            },
            save_problem_type_files
        )
    }

    pub async fn save_problem_type(
        &mut self,
        problem_type: String,
        container: String,
        actions: BTreeMap<String, ProblemTypeAction>,
    ) -> Result<SaveProblemTypeResponse> {
        call_rpc!(
            self,
            "SaveProblemType",
            SaveProblemTypeRequest {
                problem_type,
                container,
                actions,
            },
            save_problem_type
        )
    }

    pub async fn get_assignment(
        &mut self,
        assignment: AssignmentKey,
    ) -> Result<GetAssignmentResponse> {
        call_rpc!(
            self,
            "GetAssignment",
            GetAssignmentRequest {
                assignment: Some(assignment),
            },
            get_assignment
        )
    }

    pub async fn get_workspace(
        &mut self,
        assignment: AssignmentKey,
        problem_id: String,
        step_number: i64,
        file_state: WorkspaceFileState,
        include_contents: bool,
        include_solution_files: bool,
    ) -> Result<GetWorkspaceResponse> {
        call_rpc!(
            self,
            "GetWorkspace",
            GetWorkspaceRequest {
                assignment: Some(assignment),
                problem_id,
                step_number,
                file_state: file_state as i32,
                include_contents,
                include_solution_files,
            },
            get_workspace
        )
    }

    pub async fn prepare_problem(
        &mut self,
        draft: AuthorProblemDraft,
        action: String,
    ) -> Result<ProblemBundle> {
        let response = call_rpc!(
            self,
            "PrepareProblem",
            crate::proto::codegrinder::PrepareProblemRequest {
                draft: Some(draft),
                action,
            },
            prepare_problem
        )?;
        response
            .bundle
            .ok_or_else(|| CliError::Message("server returned no problem bundle".to_string()))
    }

    pub async fn save_problem(
        &mut self,
        mode: SaveMode,
        bundle: ProblemBundle,
    ) -> Result<SaveProblemResponse> {
        call_rpc!(
            self,
            "SaveProblem",
            SaveProblemRequest {
                mode: mode as i32,
                bundle: Some(bundle),
            },
            save_problem
        )
    }

    pub async fn save_problem_set(
        &mut self,
        mode: SaveMode,
        bundle: ProblemSetBundle,
    ) -> Result<SaveProblemSetResponse> {
        call_rpc!(
            self,
            "SaveProblemSet",
            SaveProblemSetRequest {
                mode: mode as i32,
                bundle: Some(bundle),
            },
            save_problem_set
        )
    }

    pub async fn save_workspace_commit(
        &mut self,
        commit: Commit,
    ) -> Result<SaveWorkspaceCommitResponse> {
        call_rpc!(
            self,
            "SaveWorkspaceCommit",
            SaveWorkspaceCommitRequest {
                commit: Some(commit)
            },
            save_workspace_commit
        )
    }

    pub async fn save_ungraded_commit(
        &mut self,
        commit: GradingCommit,
    ) -> Result<SaveUngradedCommitResponse> {
        call_rpc!(
            self,
            "SaveUngradedCommit",
            SaveUngradedCommitRequest {
                commit: Some(commit)
            },
            save_ungraded_commit
        )
    }

    pub async fn save_graded_commit(
        &mut self,
        bundle: SignedRuntimeBundle,
    ) -> Result<SaveGradedCommitResponse> {
        call_rpc!(
            self,
            "SaveGradedCommit",
            SaveGradedCommitRequest {
                bundle: Some(bundle)
            },
            save_graded_commit
        )
    }

    pub async fn daycare(
        &mut self,
        request: crate::proto::codegrinder::DaycareRequest,
    ) -> Result<Streaming<crate::proto::codegrinder::DaycareResponse>> {
        dump(&self.config.trace, "Daycare", true, &request);
        let timeout = daycare_timeout(&request, self.config.rpc_timeout);
        let request = authorize(timed_request(request, timeout), &self.config.session_key)?;
        let response = self
            .client
            .daycare(request)
            .await
            .map_err(|status| rpc_error("Daycare", &self.config.host, status))?
            .into_inner();
        dump(&self.config.trace, "Daycare", false, &"stream");
        Ok(response)
    }
}

pub async fn login(host: &str, token: &str, trace: ApiTrace) -> Result<HelloResponse> {
    let config = Config {
        host: host.to_string(),
        session_key: String::new(),
        workspace_root: crate::config::home_dir(),
        roles: Roles::default(),
        trace,
        rpc_timeout: trace.rpc_timeout,
    };
    let mut client = new_grpc_client(&config).await?;
    let request = HelloRequest {
        token: token.to_string(),
    };
    dump(&trace, "Hello", true, &request);
    let response = client
        .hello(timed_request(request, config.rpc_timeout))
        .await
        .map_err(|status| rpc_error("Hello", &config.host, status))?
        .into_inner();
    dump(&trace, "Hello", false, &response);
    check_version(&response, &config.host).await?;
    if response.user_id.is_empty() {
        fail("failed to fetch user: empty response")
    } else {
        Ok(response)
    }
}

pub async fn check_version(response: &HelloResponse, host: &str) -> Result<()> {
    let version = response
        .version
        .as_ref()
        .ok_or_else(|| CliError::Message("failed to get version from server".to_string()))?;
    let current =
        Version::parse(CURRENT_VERSION).map_err(|error| CliError::Message(error.to_string()))?;
    let required = Version::parse(&version.grind_version_required)
        .map_err(|error| CliError::Message(error.to_string()))?;
    if required > current {
        if let Some(updater) = updater_in_path() {
            if upgrade_grind(&updater, host).await {
                fail("grind upgraded; try the command again")?;
            }
            fail("grind upgrade failed")?;
        }
        fail(format!(
            "this is grind version {CURRENT_VERSION}, but the server requires {} or higher\n  you must upgrade to continue",
            version.grind_version_required
        ))?;
    }
    let recommended = Version::parse(&version.grind_version_recommended)
        .map_err(|error| CliError::Message(error.to_string()))?;
    if recommended > current {
        if let Some(updater) = updater_in_path() {
            if upgrade_grind(&updater, host).await {
                eprintln!("grind upgraded; continuing");
            } else {
                eprintln!("grind upgrade failed; continuing");
            }
            return Ok(());
        }
        eprintln!(
            "this is grind version {CURRENT_VERSION}, but the server recommends {} or higher",
            version.grind_version_recommended
        );
        eprintln!("  please upgrade as soon as possible");
    }
    Ok(())
}

fn updater_in_path() -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    updater_in_paths(&path)
}

fn updater_in_paths(path: &OsStr) -> Option<PathBuf> {
    env::split_paths(path)
        .map(|directory| directory.join("update-grind"))
        .find(|candidate| {
            candidate.metadata().is_ok_and(|metadata| {
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            })
        })
}

async fn upgrade_grind(updater: &Path, host: &str) -> bool {
    let Some(hostname) = server_hostname(host) else {
        return false;
    };
    Command::new(updater)
        .arg("grind")
        .arg(hostname)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .is_ok_and(|status| status.success())
}

fn server_hostname(host: &str) -> Option<String> {
    endpoint_uri(host)
        .ok()?
        .parse::<http::Uri>()
        .ok()?
        .host()
        .map(str::to_owned)
}

pub fn user_from_hello(response: &HelloResponse) -> Result<AuthenticatedUser> {
    if response.user_id.is_empty() {
        fail("server returned no user")
    } else {
        Ok(AuthenticatedUser {
            user_id: response.user_id.clone(),
            user_name: response.user_name.clone(),
            user_login: response.user_login.clone(),
            roles: Roles {
                is_author: response.is_author,
                is_instructor: response.is_instructor,
                is_admin: response.is_admin,
            },
        })
    }
}

pub fn decode_runtime(
    bundle: &SignedRuntimeBundle,
) -> Result<crate::proto::codegrinder::RuntimeBundle> {
    crate::proto::codegrinder::RuntimeBundle::decode(bundle.bundle.as_slice())
        .map_err(|error| CliError::Message(format!("failed to decode runtime bundle: {error}")))
}

async fn new_grpc_client(config: &Config) -> Result<CodeGrinderServiceClient<Channel>> {
    let uri = endpoint_uri(&config.host)?;
    let endpoint = Endpoint::from_shared(uri.clone())
        .map_err(|error| CliError::Message(format!("invalid server address {uri:?}: {error}")))?;
    let channel = if uri.starts_with("http://") {
        endpoint
            .connect()
            .await
            .map_err(|error| transport_error(&uri, error))?
    } else {
        let tls = ClientTlsConfig::new()
            .with_webpki_roots()
            .domain_name(tls_domain_name(&uri)?);
        endpoint
            .tls_config(tls)
            .map_err(|error| CliError::Message(format!("invalid TLS settings for {uri}: {error}")))?
            .connect()
            .await
            .map_err(|error| transport_error(&uri, error))?
    };
    Ok(CodeGrinderServiceClient::new(channel)
        .send_compressed(tonic::codec::CompressionEncoding::Gzip)
        .accept_compressed(tonic::codec::CompressionEncoding::Gzip))
}

fn endpoint_uri(host: &str) -> Result<String> {
    let host = host.trim();
    if host.starts_with("http://") || host.starts_with("https://") {
        Ok(host.trim_end_matches('/').to_string())
    } else {
        Ok(format!("https://{host}:443"))
    }
}

fn tls_domain_name(uri: &str) -> Result<String> {
    let rest = uri
        .strip_prefix("https://")
        .ok_or_else(|| CliError::Message(format!("invalid HTTPS endpoint {uri:?}")))?;
    let authority = rest.split('/').next().unwrap_or(rest);
    if authority.starts_with('[') {
        return authority
            .split(']')
            .next()
            .map(|host| format!("{host}]"))
            .ok_or_else(|| CliError::Message(format!("invalid HTTPS endpoint {uri:?}")));
    }
    Ok(authority.split(':').next().unwrap_or(authority).to_string())
}

fn authorize<T>(mut request: Request<T>, session_key: &str) -> Result<Request<T>> {
    let value = MetadataValue::from_str(&format!("Bearer {session_key}"))
        .map_err(|error| CliError::Message(format!("invalid session key metadata: {error}")))?;
    request.metadata_mut().insert("authorization", value);
    Ok(request)
}

fn timed_request<T>(message: T, timeout: Duration) -> Request<T> {
    let mut request = Request::new(message);
    request.set_timeout(timeout);
    request
}

fn daycare_timeout(
    request: &crate::proto::codegrinder::DaycareRequest,
    rpc_timeout: Duration,
) -> Duration {
    request
        .bundle
        .as_ref()
        .and_then(runtime_action_timeout)
        .and_then(|action_timeout| action_timeout.checked_add(rpc_timeout))
        .unwrap_or(rpc_timeout)
}

fn runtime_action_timeout(bundle: &SignedRuntimeBundle) -> Option<Duration> {
    let runtime = decode_runtime(bundle).ok()?;
    let limits = runtime.limits?;
    let cpu = limits.max_cpu.max(1) as u64;
    Some(Duration::from_secs(cpu.saturating_mul(2).saturating_add(5)))
}

fn dump(trace: &ApiTrace, call: &str, outgoing: bool, message: &impl Debug) {
    if !trace.report {
        return;
    }
    let marker = if outgoing { "-->" } else { "<--" };
    if trace.dump {
        eprintln!("{marker} {call} {}", summarize_debug(message));
    } else {
        eprintln!("{marker} {call}");
    }
}

fn summarize_debug(message: &impl Debug) -> String {
    let text = format!("{message:#?}");
    let mut output = String::new();
    for line in text.lines() {
        if line.contains("_files:") || line.contains("files:") {
            output.push_str(line);
            output.push_str(" ... elided\n");
        } else {
            output.push_str(line);
            output.push('\n');
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    use prost::Message;
    use tempfile::tempdir;

    use super::{daycare_timeout, timed_request, updater_in_paths, upgrade_grind};
    use crate::proto::codegrinder::{
        DaycareRequest, RuntimeBundle, RuntimeLimits, SignedRuntimeBundle,
    };

    #[test]
    fn rpc_timeout_is_encoded_as_grpc_timeout_metadata() {
        let request = timed_request((), Duration::from_secs(10));

        assert_eq!(
            request
                .metadata()
                .get("grpc-timeout")
                .and_then(|value| value.to_str().ok()),
            Some("10000000u")
        );
    }

    #[test]
    fn daycare_timeout_adds_runtime_action_budget_to_rpc_budget() {
        let bundle = RuntimeBundle {
            limits: Some(RuntimeLimits {
                max_cpu: 10,
                max_fd: 100,
                max_file_size: 10,
                max_memory: 256,
                max_threads: 20,
            }),
            ..RuntimeBundle::default()
        };
        let request = DaycareRequest {
            bundle: Some(SignedRuntimeBundle {
                bundle: bundle.encode_to_vec(),
                signature: "not checked here".to_owned(),
            }),
            args: Vec::new(),
        };

        assert_eq!(
            daycare_timeout(&request, Duration::from_secs(10)),
            Duration::from_secs(35)
        );
    }

    #[test]
    fn updater_lookup_skips_non_executable_matches() {
        let first = tempdir().expect("create first PATH directory");
        let second = tempdir().expect("create second PATH directory");
        fs::write(first.path().join("update-grind"), "not executable")
            .expect("write non-executable updater");
        let executable = second.path().join("update-grind");
        fs::write(&executable, "#!/bin/sh\nexit 0\n").expect("write executable updater");
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
            .expect("make updater executable");
        let path = env::join_paths([first.path(), second.path()]).expect("construct PATH");

        assert_eq!(updater_in_paths(&path), Some(executable));
    }

    #[tokio::test]
    async fn upgrade_passes_mode_and_hostname_to_updater() {
        let directory = tempdir().expect("create updater directory");
        let updater = directory.path().join("update-grind");
        let arguments = directory.path().join("update-grind.args");
        fs::write(
            &updater,
            "#!/bin/sh\nprintf '%s\\n%s\\n' \"$1\" \"$2\" >\"${0}.args\"\n",
        )
        .expect("write updater");
        fs::set_permissions(&updater, fs::Permissions::from_mode(0o755))
            .expect("make updater executable");

        assert!(
            upgrade_grind(&updater, "https://dev.russross.com:443/api").await,
            "updater should succeed"
        );
        assert_eq!(
            fs::read_to_string(arguments).expect("read updater arguments"),
            "grind\ndev.russross.com\n"
        );
    }
}
