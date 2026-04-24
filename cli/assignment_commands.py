from __future__ import annotations

import argparse
from pathlib import Path

import codegrinder_pb2 as pb

from assignment_download import assignment_directory, download_assignment, existing_assignment_warning
from command_support import load_command_config, usage_error
from errors import fail
from helpers import course_directory, managed_session
from presentation import print_assignment_list, sorted_assignment_items
from rpc_client import CodeGrinderClient


def command_list(args: argparse.Namespace) -> None:
    if args.extra:
        usage_error(args.parser)

    config = load_command_config(args)
    with managed_session(config) as session:
        client = CodeGrinderClient(config, session)
        response = client.list_assignments(include_student_context=False)
        items = list(response.items)
        if not items:
            fail("no assignments found\nyou must start each assignment through Canvas before you can access it here")

        items = sorted_assignment_items(items)
        print_assignment_list(items)


def command_get(args: argparse.Namespace) -> None:
    if args.extra:
        usage_error(args.parser)

    config = load_command_config(args)
    root_dir = config.workspace_root
    pretty_root = str(config.workspace_root)

    with managed_session(config) as session:
        client = CodeGrinderClient(config, session)
        response = client.list_assignments(search=[], include_student_context=False)
        for item in sorted_assignment_items(response.items):
            if item.assignment.user_id != session.user.user_id:
                continue
            if item.download_status != pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE:
                if item.download_status == pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY:
                    label = f"{course_directory(item.course_name)}/{item.assignment.problem_set_id}"
                    print(f"warning: assignment {label} prerequisite is not ready; skipping")
                continue
            target_dir = assignment_directory(root_dir, item.course_name, item.assignment.problem_set_id)
            pretty_full = str(Path(pretty_root) / course_directory(item.course_name) / item.assignment.problem_set_id)
            if target_dir.exists():
                warning = existing_assignment_warning(item, target_dir, client.get_assignment(item.assignment))
                if warning is not None:
                    print(warning)
                continue
            download_assignment(client, item.assignment, target_dir, pretty_full)
