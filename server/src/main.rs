mod config;
mod curl;
mod daycare;
mod db;
mod error;
mod files;
mod ipfilter;
mod lti;
mod mutations;
mod passback;
mod proto;
mod registry;
mod service;
mod sessions;
mod signatures;
mod store;
mod timeutil;

use std::env;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use chrono::Utc;
use http::header::CONTENT_TYPE;
use http::{HeaderMap, HeaderValue};
use proto::code_grinder_service_server::CodeGrinderServiceServer;
use tonic::codec::CompressionEncoding;
use tower::Layer;

use crate::config::{load_config, validate_config};
use crate::curl::{CurlHttpVersion, CurlPostRequest};
use crate::daycare::DaycareRuntime;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::ipfilter::IpFilter;
use crate::lti::{LtiState, VersionPayload};
use crate::passback::spawn_startup_grade_passbacks;
use crate::registry::DaycareRegistry;
use crate::service::{CodeGrinderServer, CodeGrinderServerParts};
use crate::sessions::{LoginTokens, delete_expired_sessions};
use crate::signatures::compute_daycare_registration_signature;
use crate::timeutil::now_utc;

const VERSION: &str = "3.0.0";
const DAYCARE_REGISTRATION_INTERVAL: Duration = Duration::from_secs(10);
const DEFAULT_BIND_PORT: u16 = 1400;

#[tokio::main]
async fn main() -> AppResult<()> {
    let args = Args::parse()?;
    let config_path = args
        .config
        .or_else(|| env::var_os("CODEGRINDER_CONFIG").map(PathBuf::from))
        .ok_or_else(|| {
            AppError::BadRequest(
                "no config file selected; use --config PATH or CODEGRINDER_CONFIG".to_owned(),
            )
        })?;
    let config = Arc::new(load_config(&config_path)?);
    validate_config(&config, args.ta, args.daycare)?;
    curl::require_available()
        .await
        .map_err(|err| AppError::Internal(format!("curl is required: {err}")))?;
    let db = Db::open(&config.sqlite3_path)?;
    if args.ta {
        db.transaction(|conn| delete_expired_sessions(conn, now_utc())).await?;
        let recovery_count = spawn_startup_grade_passbacks(db.clone(), config.clone()).await?;
        if recovery_count > 0 {
            eprintln!(
                "scheduled {recovery_count} unfinished LMS grade passbacks over the next 10 minutes"
            );
        }
    }
    let login_tokens = Arc::new(LoginTokens::default());
    let registry = DaycareRegistry::new(config.daycare_secret.clone(), VERSION.to_owned());
    let registry = if args.daycare {
        registry.with_local(&config.hostname, &config.problem_types, config.capacity)
    } else {
        registry
    };
    let registry = Arc::new(registry);
    let ip_filter = IpFilter::from_entries(&config.ip_filter.whitelist);
    let daycare = args.daycare.then(|| DaycareRuntime::new(config.clone())).transpose()?;
    if args.daycare && !args.ta {
        tokio::spawn(register_daycare(config.clone(), VERSION.to_owned()));
    }
    let version = VersionPayload {
        version: VERSION.to_owned(),
        grind_version_required: "3.0.0".to_owned(),
        grind_version_recommended: "3.0.0".to_owned(),
    };
    let service = CodeGrinderServer::new(CodeGrinderServerParts {
        db: db.clone(),
        config: config.clone(),
        login_tokens: login_tokens.clone(),
        registry: registry.clone(),
        daycare,
        ip_filter: ip_filter.clone(),
        version: version.clone(),
        ta_enabled: args.ta,
        daycare_enabled: args.daycare,
    });
    let grpc = CodeGrinderServiceServer::new(service)
        .accept_compressed(CompressionEncoding::Gzip)
        .send_compressed(CompressionEncoding::Gzip);
    let grpc_web = tonic_web::GrpcWebLayer::new().layer(grpc);
    let grpc_router =
        Router::new().route_service("/codegrinder.CodeGrinderService/{*grpc}", grpc_web);
    let app = if args.ta {
        let lti_state =
            LtiState { db, config: config.clone(), login_tokens, ip_filter, registry, version };
        lti::router(lti_state).merge(grpc_router)
    } else {
        grpc_router
    };
    serve(app, args.bind).await
}

async fn register_daycare(config: Arc<config::ServerConfig>, version: String) {
    let url = if config.ta_hostname.starts_with("http://")
        || config.ta_hostname.starts_with("https://")
    {
        format!("{}/daycare_registrations", config.ta_hostname.trim_end_matches('/'))
    } else {
        format!("https://{}/daycare_registrations", config.ta_hostname)
    };
    let headers =
        HeaderMap::from_iter([(CONTENT_TYPE, HeaderValue::from_static("application/json"))]);
    let mut last_status = String::new();
    loop {
        let started = std::time::Instant::now();
        let now = Utc::now();
        let signature = compute_daycare_registration_signature(
            &config.hostname,
            &config.problem_types,
            config.capacity,
            now,
            &version,
            &config.daycare_secret,
        );
        let request = signature.and_then(|signature| {
            serde_json::to_vec(&registry::DaycareRegistration {
                hostname: config.hostname.clone(),
                problem_types: config.problem_types.clone(),
                capacity: config.capacity,
                time: now,
                version: version.clone(),
                signature,
            })
            .map_err(Into::into)
        });
        match request {
            Ok(body) => match curl::post(CurlPostRequest {
                url: &url,
                headers: &headers,
                body: &body,
                timeout: DAYCARE_REGISTRATION_INTERVAL,
                http_version: CurlHttpVersion::Any,
            })
            .await
            {
                Ok(response) if response.status.is_success() => {
                    if last_status != "succeeded" {
                        eprintln!(
                            "registered daycare with {url}; attempt took {:?}",
                            started.elapsed()
                        );
                    }
                    last_status = "succeeded".to_owned();
                }
                Ok(response) => {
                    let status = response.status;
                    let body = String::from_utf8_lossy(&response.body);
                    if last_status != "failed" {
                        eprintln!("unexpected status from {url}: {status}");
                        for line in body.lines().filter(|line| !line.is_empty()) {
                            eprintln!("--> {line}");
                        }
                    }
                    last_status = "failed".to_owned();
                }
                Err(err) => {
                    if last_status != "failed" {
                        eprintln!(
                            "error connecting to register daycare: {err}; attempt took {:?}",
                            started.elapsed()
                        );
                    }
                    last_status = "failed".to_owned();
                }
            },
            Err(err) => {
                if last_status != "failed" {
                    eprintln!("error signing daycare registration: {err}");
                }
                last_status = "failed".to_owned();
            }
        }
        tokio::time::sleep(DAYCARE_REGISTRATION_INTERVAL).await;
    }
}

async fn serve(app: Router, bind: SocketAddr) -> AppResult<()> {
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .map_err(|err| AppError::Internal(format!("server error: {err}")))
}

struct Args {
    config: Option<PathBuf>,
    bind: SocketAddr,
    ta: bool,
    daycare: bool,
}

impl Args {
    fn parse() -> AppResult<Self> {
        let mut config = None;
        let mut ta = false;
        let mut daycare = false;
        let mut role_specified = false;
        let mut bind = default_bind()?;
        let mut args = env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--config" => {
                    let value = args.next().ok_or_else(|| {
                        AppError::BadRequest("--config requires a path".to_owned())
                    })?;
                    config = Some(PathBuf::from(value));
                }
                "--bind" => {
                    let value = args.next().ok_or_else(|| {
                        AppError::BadRequest("--bind requires an address".to_owned())
                    })?;
                    bind = parse_bind(&value, bind)?;
                }
                "-ta" | "--ta" => {
                    ta = true;
                    role_specified = true;
                }
                "-daycare" | "--daycare" => {
                    daycare = true;
                    role_specified = true;
                }
                "--help" | "-h" => {
                    println!("usage: codegrinder [-ta] [-daycare] --config PATH [--bind ADDRESS]");
                    std::process::exit(0);
                }
                other => return Err(AppError::BadRequest(format!("unknown argument {other:?}"))),
            }
        }
        if !role_specified {
            ta = true;
            daycare = true;
        }
        Ok(Self { config, bind, ta, daycare })
    }
}

fn default_bind() -> AppResult<SocketAddr> {
    resolve_bind_host("localhost", DEFAULT_BIND_PORT)
}

fn parse_bind(raw: &str, default: SocketAddr) -> AppResult<SocketAddr> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::BadRequest("invalid --bind: empty address".to_owned()));
    }
    if let Some(port) = value.strip_prefix(':') {
        let port = parse_port(port)?;
        return Ok(SocketAddr::new(default.ip(), port));
    }
    if let Ok(addr) = value.parse::<SocketAddr>() {
        return Ok(addr);
    }
    if let Ok(ip) = value.parse::<IpAddr>() {
        return Ok(SocketAddr::new(ip, default.port()));
    }
    if value.contains(':') && !value.starts_with('[') {
        return resolve_bind_authority(value);
    }
    resolve_bind_host(value, default.port())
}

fn parse_port(raw: &str) -> AppResult<u16> {
    raw.parse::<u16>().map_err(|err| AppError::BadRequest(format!("invalid --bind port: {err}")))
}

fn resolve_bind_host(host: &str, port: u16) -> AppResult<SocketAddr> {
    resolve_bind_authority(&format!("{host}:{port}"))
}

fn resolve_bind_authority(authority: &str) -> AppResult<SocketAddr> {
    authority
        .to_socket_addrs()
        .map_err(|err| AppError::BadRequest(format!("invalid --bind: {err}")))?
        .next()
        .ok_or_else(|| {
            AppError::BadRequest(format!("invalid --bind: {authority} resolved to no addresses"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn parse_bind_defaults_to_localhost_port_1400() {
        let bind = default_bind().unwrap();
        assert_eq!(bind.port(), 1400);
        assert!(matches!(bind.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST) | IpAddr::V6(_)));
    }

    #[test]
    fn parse_bind_accepts_host_port_and_port_only_forms() {
        let default = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 1400);
        assert_eq!(parse_bind("127.0.0.1", default).unwrap(), default);
        assert_eq!(
            parse_bind(":18080", default).unwrap(),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 18080)
        );
        assert_eq!(
            parse_bind("0.0.0.0:18081", default).unwrap(),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 18081)
        );
    }
}
