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
            f"{program_name()} login <hostname> <sessionkey>\n\n"
            "where <hostname> and <sessionkey> are given in the instructions.\n\n"
            "You should normally only need to do this once per semester.\n"
        )
        fail(f"Usage: {program_name()} login <hostname> <sessionkey>")

    config = Config(host=args.login_args[0], cookie="", api_report=False, api_dump=False)
    channel = None
    try:
        stub, channel = new_grpc_client(config)
        req = pb.HelloRequest(key=args.login_args[1])
        dump_message(config, "Hello", True, req)
        response = stub.Hello(req)
        dump_message(config, "Hello", False, response)
        config.cookie = response.cookie
        config.is_author = bool(response.is_author)
        config.is_instructor = bool(response.is_instructor)
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
