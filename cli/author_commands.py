from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path

import codegrinder_pb2 as pb

from assignment_download import download_assignment_to_root
from author_config import PROBLEM_CONFIG_NAME
from author_validation import validate_author_solution_bundle
from authoring import gather_author, resolve_author_problem_layout, save_problem_set
from command_support import load_command_config, usage_error
from daycare_client import handle_daycare_stream
from errors import fail
from helpers import clean_error, managed_session, program_name
from presentation import print_problem_catalog, sorted_student_assignment_items
from rpc_client import CodeGrinderClient
from student_workspace import assignment_key_from_dotfile, get_workspace, resolve_student_problem
from workspace_files import update_files, workspace_file_map


def command_problem(args: argparse.Namespace) -> None:
    if not args.problem_args:
        fail(
            "you must specify search terms to find the problem set\n"
            "  terms will match against the problem set name, note,\n"
            "  and tags, or agains the same attributes of a problem\n"
            "  in the problem set. All searchs are case-insensitive.\n"
            f"  e.g.: '{program_name()} problem cs2810 formula'"
        )

    config = load_command_config(args)

    with managed_session(config) as session:
        client = CodeGrinderClient(config, session)
        catalog_resp = client.search_problem_catalog(args.problem_args)
        problem_sets = sorted(catalog_resp.problem_sets, key=lambda ps: ps.problem_set_id.lower())
        if not problem_sets:
            fail("no problem sets found matching the terms you gave")
        print_problem_catalog(problem_sets, client.config.host)


def command_solve(args: argparse.Namespace) -> None:
    if args.extra:
        usage_error(args.parser)

    config = load_command_config(args)

    with managed_session(config) as session:
        client = CodeGrinderClient(config, session)
        if not session.user.author:
            fail("you must be an author to use this command")
        dotfile, problem_dir, problem_id, info = resolve_student_problem(Path("."))
        workspace = get_workspace(
            client,
            assignment_key_from_dotfile(dotfile),
            problem_id,
            info.step,
            pb.WORKSPACE_FILE_STATE_CURRENT,
            True,
            True,
        )
        if not workspace.solution_files:
            fail("no solution files found")
        update_files(problem_dir, workspace_file_map(workspace.solution_files), None, True)


def command_type(args: argparse.Namespace) -> None:
    config = load_command_config(args)

    with managed_session(config) as session:
        client = CodeGrinderClient(config, session)
        if args.list:
            if args.type_args or args.remove:
                print("warning: for a list request, other options will be ignored")
            print("Problem types:")
            response = client.get_problem_types()
            if not response.problem_types:
                fail("no problem types found")
            width = max(len(pt.problem_type) for pt in response.problem_types)
            for problem_type in response.problem_types:
                actions = ", ".join(problem_type.actions.keys())
                print(f"    {problem_type.problem_type:<{width}}  actions: {actions}")
            return

        directory = Path(".")
        problem_type_name = ""
        if not args.type_args:
            layout = resolve_author_problem_layout(Path("."))
            if layout is None:
                fail(f"you must supply the problem type or have a valid {PROBLEM_CONFIG_NAME} file already in place")
            if not layout.config.single_step_layout and layout.active_step_number < 1:
                fail("you must run this from within a step directory")
            directory = layout.active_step_dir
            problem_type_name = (
                layout.config.steps[0].problem_type
                if layout.config.single_step_layout
                else layout.config.steps[layout.active_step_number - 1].problem_type
            )
        elif len(args.type_args) == 1:
            problem_type_name = args.type_args[0]
        else:
            usage_error(args.parser)

        response = client.get_problem_type(problem_type_name)
        problem_type = response.problem_type

        if args.remove:
            old_files = {str(Path(name)) for name in problem_type.files}
            update_files(directory, {}, old_files, True)
        else:
            files = {str(Path(name)): contents for name, contents in problem_type.files.items()}
            update_files(directory, files, None, True)


def command_student(args: argparse.Namespace) -> None:
    if not args.student_args:
        fail(
            "you must specify the assignment to download\n"
            "   either give the student's assignment number\n"
            "   or give search terms to find the assignment\n"
            "   where terms search assignment name, course name,\n"
            "   problem set name, problem set tags, user name, and user email\n"
            f"   e.g.: '{program_name()} student alice loops'"
        )

    config = load_command_config(args)

    with managed_session(config) as session:
        client = CodeGrinderClient(config, session)
        response = client.list_assignments(search=args.student_args, include_student_context=True)
        items = sorted_student_assignment_items(response.items)
        if not items:
            fail("no assignments found matching the terms you gave")

        user_ids = {item.assignment.user_id for item in items}
        longest_num = len(str(len(items)))

        prev_user_id = ""
        for idx, item in enumerate(items, start=1):
            assignment = item.assignment
            if assignment.user_id != prev_user_id:
                if prev_user_id != "":
                    print()
                prev_user_id = assignment.user_id
                print(f"{item.user_name} ({item.user_login})")
                print("-" * (len(item.user_name) + len(item.user_login) + len(" ()")))

            when = item.due_at.ToDatetime().strftime("%d %b %y %H:%M UTC") if item.HasField("due_at") else "no due date"
            print(f"{idx:>{longest_num}}. {assignment.problem_set_id} ({item.course_name}) [{when}]")
        print()

        if len(user_ids) == 1:
            most_recent = items[-1]
            download_student_assignment(client, most_recent)
        else:
            fail(
                "the search found assignments for more than one user\n"
                f"   either pick the correct assignment number from the list\n"
                f"   and run '{program_name()} student [number]'\n"
                "   or repeat the search with additional terms\n"
                "   to narrow the results"
            )


def download_student_assignment(client: CodeGrinderClient, item: pb.AssignmentListItem) -> None:
    assignment = item.assignment
    print(f"[{item.user_name}] assignment {assignment.course_id}/{assignment.problem_set_id}")

    root_dir = Path("/tmp") / f"grind-tmp.{os.getpid()}"
    root_dir.mkdir(mode=0o700, exist_ok=False)
    try:
        change_to = download_assignment_to_root(client, assignment, root_dir, str(root_dir))
        shell = os.environ.get("SHELL", "/bin/bash")
        print("exit shell when finished")
        subprocess.run([shell], cwd=change_to, check=True)
    except subprocess.CalledProcessError as exc:
        fail(f"error waiting for shell to terminate: {clean_error(exc)}")
    finally:
        print(f"deleting {root_dir}")
        shutil.rmtree(root_dir, ignore_errors=True)


def command_create(args: argparse.Namespace) -> None:
    config = load_command_config(args)

    pset = args.create_args[0] if len(args.create_args) == 1 else ""
    if len(args.create_args) > 1:
        usage_error(args.parser)

    action = args.action
    is_update = bool(args.update)

    with managed_session(config) as session:
        client = CodeGrinderClient(config, session)
        if pset:
            if action:
                fail("you cannot specify an action when creating a problem set")
            save_problem_set(client, Path(pset), is_update)
            return

        if is_update and action:
            fail("you specified --update, which is not valid when running an action")

        draft, step_dir, step_num = gather_author(action, Path("."))

        signed_resp = client.prepare_problem(draft, action)
        signed = signed_resp.bundle

        if not signed.hostname:
            fail("server was unable to find a suitable daycare, unable to validate")

        if action:
            if step_num < 1:
                fail("to use --action, you must run from within a step directory")
            print(f"running interactive session for action {action!r} on step {step_num}")

            handle_daycare_stream(client, signed.signed_validation_bundles[step_num - 1], [], step_dir, True)
            return

        validate_author_solution_bundle(
            signed,
            lambda bundle: handle_daycare_stream(client, bundle, [], Path(""), False),
        )

        final_resp = client.save_problem(pb.SAVE_MODE_UPDATE if is_update else pb.SAVE_MODE_CREATE, signed)
        final = final_resp.bundle
        if is_update:
            print(f"problem {final.problem.problem_id!r} saved and ready to use")
        else:
            print(f"problem {final.problem.problem_id!r} created and ready to use")
