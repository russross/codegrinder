from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
from concurrent import futures
from typing import Tuple

import grpc

import codegrinder_pb2_grpc as pb_grpc
from config import ServerConfig, load_config
from daycare_registry import DaycareRegistry
from db import setup_db
from grpc_service import CodeGrinderService, IPFilterInterceptor, RecoveryInterceptor
from lti import LTIService, start_lti_http_server
from sessions import LoginRecords


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(filename)s:%(lineno)d: %(message)s")


def _validate_config(config: ServerConfig, http_bind: str) -> None:
    if config.hostname.strip() == "":
        raise RuntimeError("cannot run with no hostname in the config file")
    if config.daycare_secret.strip() == "":
        raise RuntimeError("cannot run with no daycareSecret in the config file")
    if http_bind:
        if config.lti_secret.strip() == "":
            raise RuntimeError("cannot run TA role with no ltiSecret in the config file")
        if config.session_secret.strip() == "":
            raise RuntimeError("cannot run TA role with no sessionSecret in the config file")
    if config.capacity and config.capacity <= 0:
        raise RuntimeError("daycare capacity must be greater than zero")


def build_server(config: ServerConfig) -> Tuple[grpc.Server, CodeGrinderService, DaycareRegistry]:
    conn = setup_db(Path(config.sqlite3_path))
    login_records = LoginRecords()
    registry = DaycareRegistry(secret=config.daycare_secret, version="2.8.0")
    if config.hostname and config.problem_types and config.capacity > 0:
        registry.register_local(config.hostname, config.problem_types, config.capacity)
    service = CodeGrinderService(
        conn=conn,
        config=config,
        login_records=login_records,
        daycare_registry=registry,
    )
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=32),
        interceptors=(RecoveryInterceptor(), IPFilterInterceptor(service.ip_filter)),
    )
    pb_grpc.add_CodeGrinderServiceServicer_to_server(service, server)
    return server, service, registry


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser(description="CodeGrinder Python gRPC server")
    parser.add_argument("--config", type=str, default="")
    parser.add_argument("--bind", type=str, default="127.0.0.1:8080")
    parser.add_argument("--http-bind", type=str, default="127.0.0.1:8081")
    args = parser.parse_args()

    root_env = os.environ.get("CODEGRINDERROOT")
    root = Path(root_env) if root_env else Path.home() / "codegrinder"
    config_path = Path(args.config) if args.config else root / "config.json"
    config = load_config(config_path)
    if not config.sqlite3_path:
        config.sqlite3_path = str(root / "db" / "codegrinder.db")
    _validate_config(config, args.http_bind)
    server, grpc_service, registry = build_server(config)
    if args.http_bind:
        lti_service = LTIService(
            conn=grpc_service.conn,
            config=config,
            login_records=grpc_service.login_records,
            ip_filter=grpc_service.ip_filter,
            daycare_registry=registry,
            version_payload={
                "version": grpc_service.version_info.version,
                "grindVersionRequired": grpc_service.version_info.grind_version_required,
                "grindVersionRecommended": grpc_service.version_info.grind_version_recommended,
                "thonnyVersionRequired": grpc_service.version_info.thonny_version_required,
                "thonnyVersionRecommended": grpc_service.version_info.thonny_version_recommended,
            },
        )
        start_lti_http_server(args.http_bind, lti_service)
    server.add_insecure_port(args.bind)
    server.start()
    server.wait_for_termination()


if __name__ == "__main__":
    main()
