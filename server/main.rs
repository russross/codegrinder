mod config;
mod curl;
mod daycare;
mod db;
mod error;
mod files;
mod ipfilter;
mod logging;
mod lti;
mod mutations;
mod passback;
mod proto;
mod service;
mod sessions;
mod signatures;
mod store;
mod timeutil;

use std::env;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use proto::code_grinder_service_server::CodeGrinderServiceServer;
use tonic::codec::CompressionEncoding;
use tower::Layer;

use crate::config::{load_config, validate_config};
use crate::daycare::DaycareRuntime;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::ipfilter::IpFilter;
use crate::lti::{LtiState, VersionPayload};
use crate::passback::spawn_startup_grade_passbacks;
use crate::service::{CodeGrinderServer, CodeGrinderServerParts};
use crate::sessions::{LoginTokens, delete_expired_sessions};
use crate::timeutil::now_utc;

const VERSION: &str = "3.0.0";
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
    let ip_filter = IpFilter::from_entries(&config.ip_filter.whitelist)?;
    validate_config(&config)?;
    curl::require_available()
        .await
        .map_err(|err| AppError::Internal(format!("curl is required: {err}")))?;
    let db = Db::open(&config.sqlite3_path)?;
    // Session maintenance and passback recovery finish scheduling before admission.
    db.transaction(true, |conn| delete_expired_sessions(conn, now_utc())).await?;
    spawn_startup_grade_passbacks(db.clone(), config.clone()).await?;
    let login_tokens = Arc::new(LoginTokens::default());
    let daycare = DaycareRuntime::new(config.clone())?;
    let version = VersionPayload {
        version: VERSION.to_owned(),
        grind_version_required: "3.0.0".to_owned(),
        grind_version_recommended: "3.0.0".to_owned(),
    };
    let service = CodeGrinderServer::new(CodeGrinderServerParts {
        db: db.clone(),
        config: config.clone(),
        login_tokens: login_tokens.clone(),
        daycare,
        ip_filter: ip_filter.clone(),
        version: version.clone(),
    });
    let grpc = CodeGrinderServiceServer::new(service)
        .accept_compressed(CompressionEncoding::Gzip)
        .send_compressed(CompressionEncoding::Gzip);
    let grpc_web = tonic_web::GrpcWebLayer::new().layer(grpc);
    let grpc_router =
        Router::new().route_service("/codegrinder.CodeGrinderService/{*grpc}", grpc_web);
    // Administrative requests and container execution share a listener, not transactions.
    let lti_state = LtiState { db, config, login_tokens, ip_filter, version };
    let app = lti::router(lti_state).merge(grpc_router);
    serve(app, args.bind).await
}

async fn serve(app: Router, bind: SocketAddr) -> AppResult<()> {
    let listener = tokio::net::TcpListener::bind(bind).await?;
    logging::record("INFO", "server_listening", format_args!("bind={bind}"));
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .map_err(|err| AppError::Internal(format!("server error: {err}")))
}

struct Args {
    config: Option<PathBuf>,
    bind: SocketAddr,
}

impl Args {
    fn parse() -> AppResult<Self> {
        let mut config = None;
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
                "--help" | "-h" => {
                    println!("usage: codegrinder --config PATH [--bind ADDRESS]");
                    std::process::exit(0);
                }
                other => return Err(AppError::BadRequest(format!("unknown argument {other:?}"))),
            }
        }
        Ok(Self { config, bind })
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
