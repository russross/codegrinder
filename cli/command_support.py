from __future__ import annotations

import argparse

from errors import CliError
from helpers import load_config
from models import Config


def usage_error(parser: argparse.ArgumentParser) -> None:
    parser.print_help()
    raise CliError("", exit_code=1)


def load_command_config(args: argparse.Namespace) -> Config:
    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)
    return config
