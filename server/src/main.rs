mod config;
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
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::{Router, http::StatusCode};
use axum_server::tls_rustls::RustlsConfig;
use chrono::Utc;
use proto::code_grinder_service_server::CodeGrinderServiceServer;
use tonic::codec::CompressionEncoding;
use tower::Layer;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;

use crate::config::{load_config, validate_config};
use crate::daycare::DaycareRuntime;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::ipfilter::IpFilter;
use crate::lti::{LtiState, VersionPayload};
use crate::registry::DaycareRegistry;
use crate::service::{CodeGrinderServer, CodeGrinderServerParts};
use crate::sessions::{LoginTokens, delete_expired_sessions};
use crate::signatures::compute_daycare_registration_signature;
use crate::timeutil::now_utc;

const VERSION: &str = "2.8.0";
const DAYCARE_REGISTRATION_INTERVAL: Duration = Duration::from_secs(10);

#[tokio::main]
async fn main() -> AppResult<()> {
    let args = Args::parse()?;
    let root = env::var_os("CODEGRINDERROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs_home().join("codegrinder"));
    let config_path = args.config.unwrap_or_else(|| root.join("config.json"));
    let config = Arc::new(load_config(&config_path, &root)?);
    validate_config(&config, args.ta, args.daycare)?;
    let db = Db::open(&config.sqlite3_path)?;
    if args.ta {
        db.transaction(|conn| delete_expired_sessions(conn, now_utc()))
            .await?;
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
    let daycare = args
        .daycare
        .then(|| DaycareRuntime::new(config.clone()))
        .transpose()?;
    if args.daycare && !args.ta {
        tokio::spawn(register_daycare(config.clone(), VERSION.to_owned()));
    }
    let version = VersionPayload {
        version: VERSION.to_owned(),
        grind_version_required: "2.7.0".to_owned(),
        grind_version_recommended: "2.7.0".to_owned(),
        thonny_version_required: "2.7.0".to_owned(),
        thonny_version_recommended: "2.7.0".to_owned(),
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
        let lti_state = LtiState {
            db,
            config: config.clone(),
            login_tokens,
            ip_filter,
            registry,
            version,
        };
        lti::router(lti_state).merge(grpc_router).fallback_service(
            ServeDir::new(&config.www_root).append_index_html_on_directories(true),
        )
    } else {
        grpc_router.fallback(|| async { (StatusCode::NOT_FOUND, "not found") })
    }
    .layer(CompressionLayer::new());
    serve(app, args.bind, config).await
}

async fn register_daycare(config: Arc<config::ServerConfig>, version: String) {
    let client = reqwest::Client::new();
    let url = if config.ta_hostname.starts_with("http://")
        || config.ta_hostname.starts_with("https://")
    {
        format!(
            "{}/daycare_registrations",
            config.ta_hostname.trim_end_matches('/')
        )
    } else {
        format!("https://{}/daycare_registrations", config.ta_hostname)
    };
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
        let request = signature.map(|signature| registry::DaycareRegistration {
            hostname: config.hostname.clone(),
            problem_types: config.problem_types.clone(),
            capacity: config.capacity,
            time: now,
            version: version.clone(),
            signature,
        });
        match request {
            Ok(registration) => match client.post(&url).json(&registration).send().await {
                Ok(response) if response.status().is_success() => {
                    if last_status != "succeeded" {
                        eprintln!(
                            "registered daycare with {url}; attempt took {:?}",
                            started.elapsed()
                        );
                    }
                    last_status = "succeeded".to_owned();
                }
                Ok(response) => {
                    let status = response.status();
                    let body = response.text().await.unwrap_or_default();
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

async fn serve(app: Router, bind: SocketAddr, config: Arc<config::ServerConfig>) -> AppResult<()> {
    match (&config.tls_cert, &config.tls_key) {
        (Some(cert), Some(key)) => {
            let tls = RustlsConfig::from_pem_file(cert, key)
                .await
                .map_err(|err| AppError::Internal(format!("failed to load TLS config: {err}")))?;
            axum_server::bind_rustls(bind, tls)
                .serve(app.into_make_service_with_connect_info::<SocketAddr>())
                .await
                .map_err(|err| AppError::Internal(format!("server error: {err}")))
        }
        _ => {
            let listener = tokio::net::TcpListener::bind(bind).await?;
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .map_err(|err| AppError::Internal(format!("server error: {err}")))
        }
    }
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
        let mut bind = "127.0.0.1:8443"
            .parse::<SocketAddr>()
            .map_err(|err| AppError::BadRequest(format!("invalid default bind: {err}")))?;
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
                        AppError::BadRequest("--bind requires host:port".to_owned())
                    })?;
                    bind = value
                        .parse()
                        .map_err(|err| AppError::BadRequest(format!("invalid --bind: {err}")))?;
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
                    println!(
                        "usage: codegrinder-server [-ta] [-daycare] [--config PATH] [--bind HOST:PORT]"
                    );
                    std::process::exit(0);
                }
                other => return Err(AppError::BadRequest(format!("unknown argument {other:?}"))),
            }
        }
        if !role_specified {
            ta = true;
            daycare = true;
        }
        Ok(Self {
            config,
            bind,
            ta,
            daycare,
        })
    }
}

fn dirs_home() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
