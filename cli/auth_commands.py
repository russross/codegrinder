from __future__ import annotations

import argparse

import codegrinder_pb2 as pb

from errors import CliError, fail
from helpers import check_version, clean_error, dump_message, new_grpc_client, program_name, write_config
from models import Config
from version import CURRENT_VERSION


def command_version(_: argparse.Namespace) -> None:
    print("grind " + CURRENT_VERSION.version)


def command_login(args: argparse.Namespace) -> None:
    if len(args.login_args) != 2:
        print(
            "To log in, click on an assignment in Canvas and follow the\n"
            "instructions given. You should run a command of the form:\n\n"
            f"{program_name()} login <hostname> <token>\n\n"
            "where <hostname> and <token> are given in the instructions.\n\n"
            "You should normally only need to do this once per semester.\n"
        )
        fail(f"Usage: {program_name()} login <hostname> <token>")

    config = Config(host=args.login_args[0], session_key="", api_report=False, api_dump=False)
    channel = None
    try:
        stub, channel = new_grpc_client(config)
        req = pb.HelloRequest(token=args.login_args[1])
        dump_message(config, "Hello", True, req)
        response = stub.Hello(req)
        dump_message(config, "Hello", False, response)
        config.session_key = response.session_key
        config.is_author = bool(response.is_author)
        config.is_instructor = bool(response.is_instructor)
        config.is_admin = bool(response.is_admin)
        check_version(response.version)
        if response.user_id == "":
            fail("failed to fetch user: empty response")
        write_config(config)
        print(f"login successful; welcome {response.user_name}")
    except CliError:
        raise
    except Exception as exc:
        fail(f"failed to login: {clean_error(exc)}")
    finally:
        if channel is not None:
            channel.close()
