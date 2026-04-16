from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import TypeVar

import codegrinder_pb2 as pb

from author_config import PROBLEM_CONFIG_NAME, parse_author_problem_config, parse_author_problem_set_config
from authoring import find_problem_cfg, gather_author, save_problem_set
from errors import CliError, fail
from helpers import (
    Session,
    check_version,
    clean_error,
    course_directory,
    dashes,
    dump_message,
    grpc_metadata,
    grpc_time_now,
    has_instructor_file,
    load_config,
    managed_session,
    program_name,
    save_dotfile,
    update_files,
    write_config,
)
from models import AssignmentRef, Config, DotFileInfo, ProblemInfo
from student_workspace import (
    assignment_key_from_dotfile as _assignment_from_dotfile,
    clean_workspace_tree,
    gather_student as _gather_student,
    get_workspace as _get_workspace,
    resolve_student_problem as _resolve_student_problem,
    save_student_workspace as _save_student_workspace,
    workspace_file_map as _assignment_step_files,
    workspace_official_paths as _workspace_paths,
)
from daycare_client import handle_daycare_stream
from protocol import dump_transcript
from version import CURRENT_VERSION


T = TypeVar("T")


def _rpc_call(config: Config, name: str, fn: Callable[..., T], request: object, metadata: Sequence[tuple[str, str]]) -> T:
    dump_message(config, name, True, request)
    try:
        response = fn(request, metadata=metadata)
    except Exception as exc:
        raise CliError(clean_error(exc)) from exc
    dump_message(config, name, False, response)
    return response


def _usage_error(parser: argparse.ArgumentParser) -> None:
    parser.print_help()
    raise CliError("", exit_code=1)


def load_command_config(args: argparse.Namespace) -> Config:
    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)
    return config


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
    stub, channel = None, None
    try:
        from helpers import new_grpc_client

        stub, channel = new_grpc_client(config)
        req = pb.HelloRequest(key=args.login_args[1])
        dump_message(config, "Hello", True, req)
        response = stub.Hello(req)
        dump_message(config, "Hello", False, response)
        config.cookie = response.cookie
        check_version(response.version)
        if not response.HasField("user"):
            fail("failed to fetch user: empty response")
        write_config(config)
        print(f"login successful; welcome {response.user.user_name}")
    except CliError:
        raise
    except Exception as exc:
        fail(f"failed to login: {clean_error(exc)}")
    finally:
        if channel is not None:
            channel.close()


def command_list(args: argparse.Namespace) -> None:
    if args.extra:
        _usage_error(args.parser)

    config = load_command_config(args)
    with managed_session(config) as session:
        response = _rpc_call(
            config,
            "ListAssignments",
            session.stub.ListAssignments,
            pb.ListAssignmentsRequest(include_student_context=False),
            grpc_metadata(config.cookie),
        )
        items = list(response.items)
        if not items:
            fail("no assignments found\nyou must start each assignment through Canvas before you can access it here")

        items = sorted(
            items,
            key=lambda item: (
                item.assignment.course_id,
                item.due_at.seconds if item.HasField("due_at") else 0,
                item.lock_at.seconds if item.HasField("lock_at") else 0,
                item.assignment.user_id,
                item.assignment.problem_set_id,
            ),
        )
        longest_idx = len(str(len(items)))
        longest_ps = max(len(item.assignment.problem_set_id) for item in items)

        current_course_id = ""
        for idx, item in enumerate(items, start=1):
            assignment = item.assignment
            if assignment.course_id != current_course_id:
                if current_course_id != "":
                    print()
                current_course_id = assignment.course_id
                print(item.course_name)
                print(dashes(len(item.course_name)))

            pset_label = assignment.problem_set_id
            print(f"{idx:>{longest_idx}}. {pset_label:<{longest_ps}} ({course_directory(item.course_name)}/{pset_label})")


def save_student_workspace(config: Config, session: Session, student, note: str) -> None:
    _save_student_workspace(config, session, _rpc_call, student, note)


def get_workspace(
    config: Config,
    session: Session,
    assignment: pb.AssignmentKey,
    problem_id: str,
    step_number: int,
    file_state: pb.WorkspaceFileState.ValueType,
    include_contents: bool,
    include_solution_files: bool,
) -> pb.GetWorkspaceResponse:
    return _get_workspace(
        config,
        session,
        _rpc_call,
        assignment,
        problem_id,
        step_number,
        file_state,
        include_contents,
        include_solution_files,
    )


def gather_student(config: Config, session: Session, start_dir: Path):
    return _gather_student(config, session, _rpc_call, start_dir)


def get_assignment(config: Config, session: Session, assignment: pb.AssignmentKey, root_dir: Path, pretty_root: str) -> Path:
    info_resp = _rpc_call(
        config,
        "GetAssignment",
        session.stub.GetAssignment,
        pb.GetAssignmentRequest(assignment=assignment),
        grpc_metadata(config.cookie),
    )
    root_dir = root_dir / course_directory(info_resp.course_name) / info_resp.assignment.problem_set_id
    pretty_full = str(Path(pretty_root) / course_directory(info_resp.course_name) / info_resp.assignment.problem_set_id)
    if root_dir.exists():
        fail(f"directory {pretty_full} already exists\ndelete it first if you want to re-download the assignment")

    print(f"unpacking problem set in {pretty_full}")

    change_to = root_dir
    infos: dict[str, ProblemInfo] = {}
    total_problems = len(info_resp.problems)
    for problem_info in info_resp.problems:
        infos[problem_info.problem_id] = ProblemInfo(
            problem_id=problem_info.problem_id,
            step=int(problem_info.current_step_number),
            total_steps=int(problem_info.total_steps),
        )
        target = root_dir if total_problems == 1 else root_dir / problem_info.problem_id
        if total_problems > 1:
            if problem_info.current_step_number > 1:
                print(f"unpacking problem {problem_info.problem_id} step {problem_info.current_step_number}")
            else:
                print(f"unpacking problem {problem_info.problem_id}")
        elif problem_info.current_step_number > 1:
            print(f"unpacking step {problem_info.current_step_number}")

        workspace = get_workspace(
            config,
            session,
            assignment,
            problem_info.problem_id,
            int(problem_info.current_step_number),
            pb.WORKSPACE_FILE_STATE_CURRENT,
            True,
            False,
        )
        files = _assignment_step_files(workspace.system_owned_files)
        files.update(_assignment_step_files(workspace.student_owned_files))
        update_files(target, files, None, False)

    dotfile = DotFileInfo(
        assignment_ref=AssignmentRef(
            user_id=info_resp.assignment.user_id,
            course_id=info_resp.assignment.course_id,
            problem_set_id=info_resp.assignment.problem_set_id,
        ),
        problems=infos,
        path=str(root_dir / ".grind"),
    )
    save_dotfile(dotfile)
    return change_to


def command_get(args: argparse.Namespace) -> None:
    if not args.get_args or len(args.get_args) > 2:
        if not args.get_args:
            _usage_error(args.parser)
        fail(
            "you must specify the assignment to download\n"
            f"   run '{program_name()} list' to see your assignments\n"
            "   you must give the assignment number (displayed on the left of the list)\n"
            "   or a name in the form COURSE/problem-set-id (displayed in parentheses)"
        )

    config = load_command_config(args)

    name = args.get_args[0]
    root_dir = Path.home()
    pretty_root = "~"
    if len(args.get_args) == 2:
        root_dir = Path(args.get_args[1])
        pretty_root = str(root_dir)

    with managed_session(config) as session:
        assignment: pb.AssignmentKey
        if name.isdigit() and int(name) > 0:
            asst_resp = _rpc_call(
                config,
                "ListAssignments",
                session.stub.ListAssignments,
                pb.ListAssignmentsRequest(search=[], include_student_context=False),
                grpc_metadata(config.cookie),
            )
            ordered = sorted(
                list(asst_resp.items),
                key=lambda item: (
                    item.assignment.course_id,
                    item.due_at.seconds if item.HasField("due_at") else 0,
                    item.lock_at.seconds if item.HasField("lock_at") else 0,
                    item.assignment.user_id,
                    item.assignment.problem_set_id,
                ),
            )
            idx = int(name)
            if idx < 1 or idx > len(ordered):
                fail(f"assignment number {idx} not found; run '{program_name()} list' to refresh numbering")
            assignment = ordered[idx - 1].assignment
        else:
            parts = name.split("/")
            if len(parts) != 2:
                fail(
                    "unknown assignment identifier\n"
                    f"   run '{program_name()} get [number]'\n"
                    f"   or  '{program_name()} get [course/problem-id]'"
                )
            course_term, pset_term = parts
            response = _rpc_call(
                config,
                "ListAssignments",
                session.stub.ListAssignments,
                pb.ListAssignmentsRequest(search=[course_term, pset_term], include_student_context=False),
                grpc_metadata(config.cookie),
            )
            matches = list(response.items)
            if not matches:
                fail(
                    "no matching assignment found\n"
                    f"   run '{program_name()} get [number]'\n"
                    f"   or  '{program_name()} get [course/problem-id]'"
                )
            if len(matches) != 1:
                fail(
                    "found more than one matching assignment\n"
                    f"   run '{program_name()} get [number]' instead"
                )
            assignment = matches[0].assignment

        if assignment.user_id != session.user.user_id:
            fail("you do not have access to that assignment")
        get_assignment(config, session, assignment, root_dir, pretty_root)


def command_sync(args: argparse.Namespace) -> None:
    if args.extra:
        _usage_error(args.parser)

    config = load_command_config(args)
    with managed_session(config) as session:
        student = gather_student(config, session, Path("."))
        save_student_workspace(config, session, student, "grind sync")
        print(f"problem {student.workspace.problem_id} step {student.commit.step} synced")


def command_clean(args: argparse.Namespace) -> None:
    if args.extra:
        _usage_error(args.parser)

    config = load_command_config(args)
    with managed_session(config) as session:
        student = gather_student(config, session, Path("."))
        save_student_workspace(config, session, student, "grind clean")
        clean_workspace_tree(student.problem_dir, _workspace_paths(student.workspace))
        print(f"problem {student.workspace.problem_id} step {student.commit.step} cleaned")


def command_grade(args: argparse.Namespace) -> None:
    if args.extra:
        _usage_error(args.parser)

    config = load_command_config(args)

    with managed_session(config) as session:
        student = gather_student(config, session, Path("."))
        workspace = student.workspace
        commit = student.commit
        info = student.dotfile.problems.get(workspace.problem_id)
        if info is None:
            fail(f"unable to find problem info for {workspace.problem_id}")
        current_paths: set[str] = {str(Path(entry.path)) for entry in workspace.system_owned_files}
        current_paths.update(str(Path(entry.path)) for entry in workspace.student_owned_files)
        commit.action = "grade"
        commit.note = "grind grade"
        unsigned = pb.GradingCommit(user_id=session.user.user_id, commit=commit)

        signed_resp = _rpc_call(
            config,
            "SaveUngradedCommit",
            session.stub.SaveUngradedCommit,
            pb.SaveUngradedCommitRequest(commit=unsigned),
            grpc_metadata(config.cookie),
        )
        signed = signed_resp.bundle
        signed_bundle = pb.RuntimeBundle()
        signed_bundle.ParseFromString(signed.bundle)
        if not signed_bundle.hostname:
            fail("server was unable to find a suitable daycare, unable to grade")

        print(f"submitting {workspace.problem_id} step {commit.step} for grading")
        graded = handle_daycare_stream(config, session, signed, [], Path(""), False)
        if graded is None:
            fail("the server ended the connection without sending a report card")

        saved_resp = _rpc_call(
            config,
            "SaveGradedCommit",
            session.stub.SaveGradedCommit,
            pb.SaveGradedCommitRequest(bundle=graded),
            grpc_metadata(config.cookie),
        )
        _ = saved_resp
        graded_bundle = pb.RuntimeBundle()
        graded_bundle.ParseFromString(graded.bundle)
        saved_commit = graded_bundle.commit

        if saved_commit.HasField("report_card") and saved_commit.report_card.passed and saved_commit.score == 1.0:
            print(f"step {saved_commit.step} passed")
            if int(workspace.step_number) >= int(workspace.total_steps):
                print("you have completed all steps for this problem")
            else:
                next_step_number = int(workspace.step_number) + 1
                print(f"moving to step {next_step_number}")
                next_workspace = get_workspace(
                    config,
                    session,
                    commit.assignment,
                    workspace.problem_id,
                    next_step_number,
                    pb.WORKSPACE_FILE_STATE_CURRENT,
                    True,
                    False,
                )
                files = _assignment_step_files(next_workspace.system_owned_files)
                files.update(_assignment_step_files(next_workspace.student_owned_files))
                update_files(Path("."), files, current_paths, False)
                info.step = next_step_number
                info.total_steps = int(next_workspace.total_steps)
                save_dotfile(student.dotfile)
        else:
            print(f"  solution for step {saved_commit.step} failed")
            if saved_commit.HasField("report_card"):
                print(f"  ReportCard: {saved_commit.report_card.note}")
            print(dump_transcript(saved_commit), end="")


def command_action(args: argparse.Namespace) -> None:
    if len(args.action_args) > 1:
        _usage_error(args.parser)

    action = args.action_args[0] if args.action_args else ""
    if action == "grade":
        fail(
            f"'{program_name()} action' is for testing code, not for grading\n"
            f"  to submit your code for grading, use '{program_name()} grade'"
        )

    config = load_command_config(args)

    with managed_session(config) as session:
        student = gather_student(config, session, Path("."))
        workspace = student.workspace
        commit = student.commit
        commit.action = action
        commit.note = "grind action " + action

        if action not in workspace.actions:
            print("available actions for this step:")
            for name in sorted(workspace.actions):
                if name == "grade":
                    continue
                print(f"   {name}")
            fail(f"use '{program_name()} action [action]' to initiate an action")

        unsigned = pb.GradingCommit(user_id=session.user.user_id, commit=commit)
        signed_resp = _rpc_call(
            config,
            "SaveUngradedCommit",
            session.stub.SaveUngradedCommit,
            pb.SaveUngradedCommitRequest(commit=unsigned),
            grpc_metadata(config.cookie),
        )
        signed = signed_resp.bundle
        signed_bundle = pb.RuntimeBundle()
        signed_bundle.ParseFromString(signed.bundle)

        if not signed_bundle.hostname:
            fail("server was unable to find a suitable daycare, unable to run action")

        print(f"starting interactive session for {workspace.problem_id} step {commit.step}")
        handle_daycare_stream(config, session, signed, [], Path("."), True)


def command_reset(args: argparse.Namespace) -> None:
    config = load_command_config(args)

    with managed_session(config) as session:
        dotfile, problem_dir, problem_id, info = _resolve_student_problem(Path("."))
        reset_workspace = get_workspace(
            config,
            session,
            _assignment_from_dotfile(dotfile),
            problem_id,
            info.step,
            pb.WORKSPACE_FILE_STATE_STEP_START,
            True,
            False,
        )

        listed: set[str] = set()
        for requested in args.reset_args:
            found = False
            clean = str(Path(requested))
            for entry in reset_workspace.student_owned_files:
                entry_path = str(Path(entry.path))
                if clean == entry_path or (Path(clean).name == clean and Path(clean).name == Path(entry_path).name):
                    listed.add(entry_path)
                    found = True
            if not found:
                fail(f"no file matching {requested!r} in the list of student files for this step")

        files = _assignment_step_files(reset_workspace.system_owned_files)
        expected_student = _assignment_step_files(reset_workspace.student_owned_files)
        files.update(expected_student)

        found_mod = False
        for entry in reset_workspace.student_owned_files:
            path_name = str(Path(entry.path))
            expected = expected_student.get(path_name)
            if expected is None:
                fail(f"cannot find file {path_name!r} in the step but it is on the whitelist")
            on_disk = problem_dir / Path(path_name)
            if not on_disk.exists():
                found_mod = True
                continue
            if on_disk.read_bytes() != expected:
                found_mod = True
                if path_name not in listed:
                    print(f"file {path_name} has been modified")
                    del files[path_name]

        update_files(problem_dir, files, None, True)
        if not found_mod:
            print("no student files have been modified since the beginning of this step")


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
        catalog_resp = _rpc_call(
            config,
            "SearchProblemCatalog",
            session.stub.SearchProblemCatalog,
            pb.SearchProblemCatalogRequest(search=args.problem_args),
            grpc_metadata(config.cookie),
        )
        problem_sets = sorted(catalog_resp.problem_sets, key=lambda ps: ps.problem_set_id.lower())
        if not problem_sets:
            fail("no problem sets found matching the terms you gave")

        for index, pset in enumerate(problem_sets):
            if index > 0:
                print()
            print(pset.problem_set_note)

            for problem in pset.problems:
                if problem.problem_weight == 1:
                    print(f"  * {problem.problem_note} ({problem.problem_id})")
                else:
                    print(f"  * {problem.problem_note} ({problem.problem_id}, weight {problem.problem_weight})")
                for step in problem.steps:
                    text = step.step_note.replace("\n", "\n       ")
                    suffix = "" if step.step_weight == 1 else f" (weight {step.step_weight})"
                    n = int(step.step_number)
                    print(f"    {n}. {text}{suffix}")

            print()
            print(f"  → https://{config.host}/lti/problem_sets/cli/{pset.problem_set_id}")


def command_solve(args: argparse.Namespace) -> None:
    if args.extra:
        _usage_error(args.parser)

    config = load_command_config(args)

    with managed_session(config) as session:
        if not session.user.author:
            fail("you must be an author to use this command")
        dotfile, problem_dir, problem_id, info = _resolve_student_problem(Path("."))
        workspace = get_workspace(
            config,
            session,
            _assignment_from_dotfile(dotfile),
            problem_id,
            info.step,
            pb.WORKSPACE_FILE_STATE_CURRENT,
            True,
            True,
        )
        if not workspace.solution_files:
            fail("no solution files found")
        update_files(problem_dir, _assignment_step_files(workspace.solution_files), None, True)


def command_type(args: argparse.Namespace) -> None:
    config = load_command_config(args)

    with managed_session(config) as session:
        if args.list:
            if args.type_args or args.remove:
                print("warning: for a list request, other options will be ignored")
            print("Problem types:")
            response = _rpc_call(
                config,
                "GetProblemTypes",
                session.stub.GetProblemTypes,
                pb.GetProblemTypesRequest(),
                grpc_metadata(config.cookie),
            )
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
            _, step_dir, step_num, problem, steps, single = find_problem_cfg(grpc_time_now(), Path("."))
            if problem is None:
                fail(f"you must supply the problem type or have a valid {PROBLEM_CONFIG_NAME} file already in place")
            if not single and step_num < 1:
                fail("you must run this from within a step directory")
            directory = step_dir
            problem_type_name = steps[0].problem_type if single else steps[step_num - 1].problem_type
        elif len(args.type_args) == 1:
            problem_type_name = args.type_args[0]
        else:
            _usage_error(args.parser)

        response = _rpc_call(
            config,
            "GetProblemType",
            session.stub.GetProblemType,
            pb.GetProblemTypeRequest(problem_type=problem_type_name),
            grpc_metadata(config.cookie),
        )
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
        response = _rpc_call(
            config,
            "ListAssignments",
            session.stub.ListAssignments,
            pb.ListAssignmentsRequest(search=args.student_args, include_student_context=True),
            grpc_metadata(config.cookie),
        )
        items = sorted(
            response.items,
            key=lambda item: (
                item.assignment.user_id,
                item.assignment.course_id,
                item.due_at.seconds if item.HasField("due_at") else 0,
                item.assignment.problem_set_id,
            ),
        )
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
                print(dashes(len(item.user_name) + len(item.user_login) + len(" ()")))

            when = item.due_at.ToDatetime().strftime("%d %b %y %H:%M UTC") if item.HasField("due_at") else "no due date"
            print(f"{idx:>{longest_num}}. {assignment.problem_set_id} ({item.course_name}) [{when}]")
        print()

        if len(user_ids) == 1:
            most_recent = items[-1]
            download_student_assignment(config, session, most_recent)
        else:
            fail(
                "the search found assignments for more than one user\n"
                f"   either pick the correct assignment number from the list\n"
                f"   and run '{program_name()} student [number]'\n"
                "   or repeat the search with additional terms\n"
                "   to narrow the results"
            )


def download_student_assignment(config: Config, session: Session, item: pb.AssignmentListItem) -> None:
    assignment = item.assignment
    print(f"[{item.user_name}] assignment {assignment.course_id}/{assignment.problem_set_id}")

    root_dir = Path("/tmp") / f"grind-tmp.{os.getpid()}"
    root_dir.mkdir(mode=0o700, exist_ok=False)
    try:
        change_to = get_assignment(config, session, assignment, root_dir, str(root_dir))
        shell = os.environ.get("SHELL", "/bin/bash")
        print("exit shell when finished")
        subprocess.run([shell], cwd=change_to, check=True)
    except subprocess.CalledProcessError as exc:
        fail(f"error waiting for shell to terminate: {clean_error(exc)}")
    finally:
        print(f"deleting {root_dir}")
        subprocess.run(["rm", "-rf", str(root_dir)], check=False)


def parse_problem_cfg(path: Path):
    return parse_author_problem_config(path)


def parse_problem_set_cfg(path: Path):
    return parse_author_problem_set_config(path)


def create_problem_set(config: Config, session: Session, path: Path, is_update: bool) -> None:
    save_problem_set(config, session, _rpc_call, path, is_update)


def command_create(args: argparse.Namespace) -> None:
    config = load_command_config(args)

    pset = args.create_args[0] if len(args.create_args) == 1 else ""
    if len(args.create_args) > 1:
        _usage_error(args.parser)

    action = args.action
    is_update = bool(args.update)

    with managed_session(config) as session:
        if pset:
            if action:
                fail("you cannot specify an action when creating a problem set")
            create_problem_set(config, session, Path(pset), is_update)
            return

        now = grpc_time_now()
        if is_update and action:
            fail("you specified --update, which is not valid when running an action")

        draft, step_dir, step_num = gather_author(now, action, Path("."))

        signed_resp = _rpc_call(
            config,
            "PrepareProblem",
            session.stub.PrepareProblem,
            pb.PrepareProblemRequest(draft=draft, action=action),
            grpc_metadata(config.cookie),
        )
        signed = signed_resp.bundle

        if not signed.hostname:
            fail("server was unable to find a suitable daycare, unable to validate")

        if action:
            if step_num < 1:
                fail("to use --action, you must run from within a step directory")
            print(f"running interactive session for action {action!r} on step {step_num}")

            handle_daycare_stream(config, session, signed.signed_grading_commits[step_num - 1], [], step_dir, True)
            return

        for n in range(len(signed.problem_steps)):
            print(f"validating solution for step {n + 1}")
            validated = handle_daycare_stream(config, session, signed.signed_grading_commits[n], [], Path(""), False)
            if validated is None:
                fail("the server ended the connection without sending a report card")
            validated_commit = pb.RuntimeBundle()
            validated_commit.ParseFromString(validated.bundle)
            print("  finished validating solution")
            if (
                not validated_commit.commit.HasField("report_card")
                or validated_commit.commit.score != 1.0
                or not validated_commit.commit.report_card.passed
            ):
                note = (
                    validated_commit.commit.report_card.note if validated_commit.commit.HasField("report_card") else ""
                )
                print(f"  solution for step {n + 1} failed: {note}")
                print(dump_transcript(validated_commit.commit), end="")
                fail("please fix solution and try again")

            signed.commits[n].CopyFrom(validated_commit.commit)
            signed.signed_grading_commits[n].CopyFrom(validated)

        print("problem and solution confirmed successfully")

        final_resp = _rpc_call(
            config,
            "SaveProblem",
            session.stub.SaveProblem,
            pb.SaveProblemRequest(
                mode=pb.SAVE_MODE_UPDATE if is_update else pb.SAVE_MODE_CREATE,
                bundle=signed,
            ),
            grpc_metadata(config.cookie),
        )
        final = final_resp.bundle
        if is_update:
            print(f"problem {final.problem.problem_id!r} saved and ready to use")
        else:
            print(f"problem {final.problem.problem_id!r} created and ready to use")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="grind", description="A command-line tool to access CodeGrinder")
    parser.set_defaults(func=None)

    is_instructor = has_instructor_file()

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

    get_cmd = subs.add_parser("get", help="download an assignment to work on it locally")
    get_cmd.add_argument("get_args", nargs="*")
    get_cmd.set_defaults(func=command_get)

    sync_cmd = subs.add_parser("sync", help="save your work to the server and update local problem files")
    sync_cmd.add_argument("extra", nargs="*")
    sync_cmd.set_defaults(func=command_sync)

    clean_cmd = subs.add_parser("clean", help="save your work and remove files outside the official workspace set")
    clean_cmd.add_argument("extra", nargs="*")
    clean_cmd.set_defaults(func=command_clean)

    grade_cmd = subs.add_parser("grade", help="save your work and submit it for grading")
    grade_cmd.add_argument("extra", nargs="*")
    grade_cmd.set_defaults(func=command_grade)

    action_cmd = subs.add_parser("action", help="save your work and run an action on the server")
    action_cmd.add_argument("action_args", nargs="*")
    action_cmd.set_defaults(func=command_action)

    reset_cmd = subs.add_parser("reset", help="go back to the beginning of the current step for specified files")
    reset_cmd.add_argument("reset_args", nargs="*")
    reset_cmd.set_defaults(func=command_reset)

    if is_instructor:
        create_cmd = subs.add_parser("create", help="create a new problem/problem set (authors only)")
        create_cmd.add_argument("-u", "--update", action="store_true")
        create_cmd.add_argument("-a", "--action", default="")
        create_cmd.add_argument("create_args", nargs="*")
        create_cmd.set_defaults(func=command_create)

        student_cmd = subs.add_parser("student", help="download a student assignment (instructors only)")
        student_cmd.add_argument("student_args", nargs="*")
        student_cmd.set_defaults(func=command_student)

        solve_cmd = subs.add_parser("solve", help="save the solution for the current problem step (authors only)")
        solve_cmd.add_argument("extra", nargs="*")
        solve_cmd.set_defaults(func=command_solve)

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
    except Exception as exc:  # fallback to avoid stack traces to users
        print(clean_error(exc), file=sys.stderr)
        return 1


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
