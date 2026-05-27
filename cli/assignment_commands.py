from __future__ import annotations

import argparse

import codegrinder_pb2 as pb

from assignment_download import assignment_directory, download_assignment, existing_assignment_warning
from command_support import managed_client, usage_error
from errors import fail
from helpers import abbreviate_home, course_directory
from presentation import print_assignment_list, sorted_assignment_items


def command_list(args: argparse.Namespace) -> None:
    if args.extra:
        usage_error(args.parser)

    with managed_client(args) as env:
        items = sorted_assignment_items(env.client.list_assignments(include_student_context=False).items)
        if not items:
            fail("no assignments found\nyou must start each assignment through Canvas before you can access it here")
        print_assignment_list(items, env.config.workspace_root)


def command_get(args: argparse.Namespace) -> None:
    if args.extra:
        usage_error(args.parser)

    with managed_client(args) as env:
        root_dir = env.config.workspace_root
        for item in sorted_assignment_items(env.client.list_assignments(include_student_context=False).items):
            if item.assignment.user_id != env.session.user.user_id:
                continue
            match item.download_status:
                case pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE:
                    pass
                case pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY:
                    label = f"{course_directory(item.course_name)}/{item.assignment.problem_set_id}"
                    print(
                        f"warning: assignment {label} is waiting for "
                        f"{item.prerequisite_problem_set_id}; skipping"
                    )
                    continue
                case _:
                    continue
            target_dir = assignment_directory(root_dir, item.course_name, item.assignment.problem_set_id)
            pretty_full = abbreviate_home(root_dir / course_directory(item.course_name) / item.assignment.problem_set_id)
            if target_dir.exists():
                warning = existing_assignment_warning(item, target_dir, env.client.get_assignment(item.assignment))
                if warning is not None:
                    print(warning)
                continue
            download_assignment(env.client, item.assignment, target_dir, pretty_full)
