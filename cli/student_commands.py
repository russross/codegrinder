from __future__ import annotations

import argparse
from pathlib import Path

import codegrinder_pb2 as pb

from command_support import managed_client, usage_error
from daycare_client import handle_daycare_stream
from daycare_flow import commit_passed, parse_signed_runtime_bundle
from errors import fail
from helpers import program_name, save_dotfile
from protocol import dump_transcript
from student_workspace import (
    assignment_key_from_dotfile,
    build_grading_commit,
    gather_student_context,
    get_workspace,
    resolve_student_problem,
    save_current_student_files,
)
from workspace_files import clean_workspace_tree, update_files, workspace_file_map, workspace_official_paths


def command_sync(args: argparse.Namespace) -> None:
    if args.extra:
        usage_error(args.parser)

    with managed_client(args) as env:
        student = gather_student_context(env.client, Path("."))
        response = save_current_student_files(env.client, student, "grind sync")
        if response.save_status == pb.COMMIT_SAVE_STATUS_NOT_SAVED_LOCKED:
            print("work was not saved because the assignment is locked")
        clean_workspace_tree(student.problem_dir, workspace_official_paths(student.workspace))
        print(f"problem {student.workspace.problem_id} step {student.commit.step} synced")


def command_grade(args: argparse.Namespace) -> None:
    if args.extra:
        usage_error(args.parser)

    with managed_client(args) as env:
        student = gather_student_context(env.client, Path("."))
        workspace = student.workspace
        commit = student.commit
        unsigned = build_grading_commit(env.session.user.user_id, student, "grade", "grind grade")

        signed_resp = env.client.save_ungraded_commit(unsigned)
        signed = signed_resp.bundle
        parse_signed_runtime_bundle(signed, "server was unable to find a suitable daycare, unable to grade")

        print(f"submitting {workspace.problem_id} step {commit.step} for grading")
        graded = handle_daycare_stream(env.client, signed, [], Path(""), False)
        if graded is None:
            fail("the server ended the connection without sending a report card")

        saved_resp = env.client.save_graded_commit(graded)
        graded_bundle = pb.RuntimeBundle()
        graded_bundle.ParseFromString(graded.bundle)
        saved_commit = graded_bundle.commit
        locked = saved_resp.save_status == pb.COMMIT_SAVE_STATUS_NOT_SAVED_LOCKED

        if commit_passed(saved_commit):
            print(f"step {saved_commit.step} passed")
            if locked:
                print("results were not saved because the assignment is locked")
            elif int(workspace.step_number) >= int(workspace.last_step_number):
                print("you have completed all steps for this problem")
            else:
                next_step_number = int(workspace.step_number) + 1
                print(f"moving to step {next_step_number}")
                next_workspace = get_workspace(
                    env.client,
                    commit.assignment,
                    workspace.problem_id,
                    next_step_number,
                    pb.WORKSPACE_FILE_STATE_CURRENT,
                    True,
                    False,
                )
                files = workspace_file_map(next_workspace.system_owned_files)
                files.update(workspace_file_map(next_workspace.student_owned_files))
                update_files(Path("."), files, student.current_paths, False)
                student.problem_info.step = next_step_number
                save_dotfile(student.dotfile)
        else:
            print(f"  solution for step {saved_commit.step} failed")
            if saved_commit.HasField("report_card"):
                print(f"  ReportCard: {saved_commit.report_card.note}")
            transcript = dump_transcript(saved_commit)
            print(transcript, end="")
            if transcript and not transcript.endswith(("\n", "\r")):
                print()
            if locked:
                print("results were not saved because the assignment is locked")


def command_action(args: argparse.Namespace) -> None:
    if len(args.action_args) > 1:
        usage_error(args.parser)

    action = args.action_args[0] if args.action_args else ""
    if action == "grade":
        fail(
            f"'{program_name()} action' is for testing code, not for grading\n"
            f"  to submit your code for grading, use '{program_name()} grade'"
        )

    with managed_client(args) as env:
        student = gather_student_context(env.client, Path("."))
        workspace = student.workspace
        commit = student.commit

        if action not in workspace.actions:
            print("available actions for this step:")
            for name in sorted(workspace.actions):
                if name == "grade":
                    continue
                print(f"   {name}")
            fail(f"use '{program_name()} action [action]' to initiate an action")

        unsigned = build_grading_commit(env.session.user.user_id, student, action, f"grind action {action}")
        signed_resp = env.client.save_ungraded_commit(unsigned)
        if signed_resp.save_status == pb.COMMIT_SAVE_STATUS_NOT_SAVED_LOCKED:
            print("warning: assignment is locked; action results will not be saved")
        signed = signed_resp.bundle
        parse_signed_runtime_bundle(signed, "server was unable to find a suitable daycare, unable to run action")

        print(f"starting interactive session for {workspace.problem_id} step {commit.step}")
        handle_daycare_stream(env.client, signed, [], Path("."), True)


def command_reset(args: argparse.Namespace) -> None:
    with managed_client(args) as env:
        dotfile, problem_dir, problem_id, info = resolve_student_problem(Path("."))
        reset_workspace = get_workspace(
            env.client,
            assignment_key_from_dotfile(dotfile),
            problem_id,
            info.step,
            pb.WORKSPACE_FILE_STATE_STEP_START,
            True,
            False,
        )

        expected_student = workspace_file_map(reset_workspace.student_owned_files)
        student_paths = list(expected_student)
        exact_matches = {path: {path} for path in student_paths}
        basename_matches: dict[str, set[str]] = {}
        for path in student_paths:
            basename_matches.setdefault(Path(path).name, set()).add(path)

        def matches_for(requested: str) -> set[str]:
            clean = str(Path(requested))
            if Path(clean).name == clean:
                return basename_matches.get(clean, exact_matches.get(clean, set()))
            return exact_matches.get(clean, set())

        requested_paths = {path for requested in args.reset_args for path in matches_for(requested)}
        for requested in args.reset_args:
            if not matches_for(requested):
                fail(f"no file matching {requested!r} in the list of student files for this step")

        files = workspace_file_map(reset_workspace.system_owned_files) | expected_student
        modified_paths = {
            path
            for path, expected in expected_student.items()
            if not (problem_dir / Path(path)).exists() or (problem_dir / Path(path)).read_bytes() != expected
        }
        for path in sorted(modified_paths - requested_paths):
            print(f"file {path} has been modified")
            del files[path]
        update_files(problem_dir, files, None, True)
        if not modified_paths:
            print("no student files have been modified since the beginning of this step")
