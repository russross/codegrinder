from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence

from assignment_commands import command_get, command_list
from auth_commands import command_login, command_version
from author_commands import command_create, command_problem, command_solve, command_student, command_type
from errors import CliError
from helpers import clean_error, load_config_or_default
from student_commands import command_action, command_grade, command_reset, command_sync


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="grind", description="A command-line tool to access CodeGrinder")
    parser.set_defaults(func=None)

    config = load_config_or_default()
    is_instructor = config.is_instructor
    is_author = config.is_author

    if is_instructor:
        parser.add_argument("--api", action="store_true", help="report all API requests")
        parser.add_argument("--api-dump", action="store_true", help="dump API request and response data")
    else:
        parser.set_defaults(api=False, api_dump=False)

    subs = parser.add_subparsers(dest="command")

    version = subs.add_parser("version", help="print the version number of grind")
    version.set_defaults(func=command_version)

    login = subs.add_parser("login", help="login to codegrinder server")
    login.add_argument("login_args", nargs="*")
    login.set_defaults(func=command_login)

    list_cmd = subs.add_parser("list", help="list all of your active assignments")
    list_cmd.add_argument("extra", nargs="*")
    list_cmd.set_defaults(func=command_list)

    get_cmd = subs.add_parser("get", help="download new assignments to the configured workspace root")
    get_cmd.add_argument("extra", nargs="*")
    get_cmd.set_defaults(func=command_get)

    sync_cmd = subs.add_parser(
        "sync",
        help="save your work, update local problem files, and remove files outside the official workspace set",
    )
    sync_cmd.add_argument("extra", nargs="*")
    sync_cmd.set_defaults(func=command_sync)

    grade_cmd = subs.add_parser("grade", help="save your work and submit it for grading")
    grade_cmd.add_argument("extra", nargs="*")
    grade_cmd.set_defaults(func=command_grade)

    action_cmd = subs.add_parser("action", help="save your work and run an action on the server")
    action_cmd.add_argument("action_args", nargs="*")
    action_cmd.set_defaults(func=command_action)

    reset_cmd = subs.add_parser("reset", help="go back to the beginning of the current step for specified files")
    reset_cmd.add_argument("reset_args", nargs="*")
    reset_cmd.set_defaults(func=command_reset)

    if is_author:
        create_cmd = subs.add_parser("create", help="create a new problem/problem set (authors only)")
        create_cmd.add_argument("-u", "--update", action="store_true")
        create_cmd.add_argument("-a", "--action", default="")
        create_cmd.add_argument("create_args", nargs="*")
        create_cmd.set_defaults(func=command_create)

    if is_instructor:
        student_cmd = subs.add_parser("student", help="download a student assignment (instructors only)")
        student_cmd.add_argument("student_args", nargs="*")
        student_cmd.set_defaults(func=command_student)

    if is_instructor or is_author:
        solve_cmd = subs.add_parser("solve", help="write solution files for the current problem step")
        solve_cmd.add_argument("extra", nargs="*")
        solve_cmd.set_defaults(func=command_solve)

    if is_author:
        problem_cmd = subs.add_parser("problem", help="find a problem set URL (authors only)")
        problem_cmd.add_argument("problem_args", nargs="*")
        problem_cmd.set_defaults(func=command_problem)

        type_cmd = subs.add_parser("type", help="download files for a problem type (authors only)")
        type_cmd.add_argument("-r", "--remove", action="store_true")
        type_cmd.add_argument("-l", "--list", action="store_true")
        type_cmd.add_argument("type_args", nargs="*")
        type_cmd.set_defaults(func=command_type)

    return parser


def run(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(format="%(message)s", level=logging.ERROR)

    parser = _build_parser()
    namespace = parser.parse_args(list(argv) if argv is not None else None)
    func = getattr(namespace, "func", None)
    if func is None:
        parser.print_help()
        return 1

    setattr(namespace, "parser", parser)

    try:
        func(namespace)
        return 0
    except CliError as exc:
        if exc.message:
            print(exc.message, file=sys.stderr)
        return exc.exit_code
    except Exception as exc:
        message = clean_error(exc) or exc.__class__.__name__
        print(f"unexpected error: {message}", file=sys.stderr)
        return 1


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
