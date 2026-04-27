from __future__ import annotations

import argparse
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from errors import CliError
from helpers import Session, load_config, managed_session
from models import Config
from rpc_client import CodeGrinderClient


@dataclass(slots=True)
class CommandClient:
    config: Config
    session: Session
    client: CodeGrinderClient


def usage_error(parser: argparse.ArgumentParser) -> None:
    parser.print_help()
    raise CliError("", exit_code=1)


def load_command_config(args: argparse.Namespace) -> Config:
    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)
    return config


@contextmanager
def managed_client(args: argparse.Namespace) -> Iterator[CommandClient]:
    config = load_command_config(args)
    with managed_session(config) as session:
        yield CommandClient(config=config, session=session, client=CodeGrinderClient(config, session))
