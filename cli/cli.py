from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

import codegrinder_pb2 as pb

from errors import CliError, fail
from gcfg import GcfgSection, get_all_values, get_first_section, get_last_value, get_sections, parse_gcfg
from helpers import (
    Session,
    check_version,
    clean_error,
    course_directory,
    dashes,
    dump_message,
    find_dotfile,
    grpc_metadata,
    grpc_time_now,
    has_instructor_file,
    load_config,
    managed_session,
    plural,
    program_name,
    save_dotfile,
    update_files,
    write_config,
)
from models import AssignmentRef, Config, DotFileInfo, ProblemInfo
from protocol import dump_event, dump_transcript
from version import CURRENT_VERSION

PROBLEM_CONFIG_NAME = "problem.cfg"

T = TypeVar("T")


@dataclass(slots=True)
class AuthorStepCfg:
    note: str
    problem_type: str
    weight: float


@dataclass(slots=True)
class ProblemCfg:
    unique: str
    note: str
    problem_type: str
    tags: list[str]
    options: list[str]
    steps: list[AuthorStepCfg]


@dataclass(slots=True)
class ProblemSetCfg:
    unique: str
    note: str
    tags: list[str]
    problems: dict[str, float]


def _rpc_call(config: Config, name: str, fn: Callable[..., T], request: object, metadata: Sequence[tuple[str, str]]) -> T:
    dump_message(config, name, True, request)
    try:
        response = fn(request, metadata=metadata)
    except Exception as exc:
        raise CliError(clean_error(exc)) from exc
    dump_message(config, name, False, response)
    return response


def _set_proto_timestamp(target: object, now) -> None:
    seconds = int(now.timestamp())
    nanos = int((now.timestamp() - seconds) * 1_000_000_000)
    setattr(target, "seconds", seconds)
    setattr(target, "nanos", nanos)


def _assignment_key(assignment: pb.Assignment) -> pb.AssignmentKey:
    return pb.AssignmentKey(
        user_id=assignment.user_id,
        course_id=assignment.course_id,
        problem_set_id=assignment.problem_set_id,
    )


def _assignment_key_eq(a: pb.AssignmentKey, b: pb.AssignmentKey) -> bool:
    return a.user_id == b.user_id and a.course_id == b.course_id and a.problem_set_id == b.problem_set_id


def _usage_error(parser: argparse.ArgumentParser) -> None:
    parser.print_help()
    raise CliError("", exit_code=1)


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

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)
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


def _build_commit_from_disk(
    problem_dir: Path,
    student_owned_paths: list[str],
    assignment: pb.AssignmentKey,
    problem_id: str,
    step_num: int,
) -> pb.Commit:
    files: dict[str, bytes] = {}
    missing: list[str] = []
    for name in student_owned_paths:
        path = problem_dir / Path(name)
        if not path.exists():
            missing.append(name)
            continue
        files[name] = path.read_bytes()

    if missing:
        lines = ["did not find all the expected files"] + [f"  {name} not found" for name in missing]
        fail("\n".join(lines) + "\nall expected files must be present")

    now = grpc_time_now()
    commit = pb.Commit(
        id=0,
        assignment=assignment,
        problem_id=problem_id,
        step=step_num,
        files=files,
    )
    _set_proto_timestamp(commit.created_at, now)
    _set_proto_timestamp(commit.updated_at, now)
    return commit


def gather_student(config: Config, session: Session, start_dir: Path) -> tuple[pb.ProblemType, pb.Problem, pb.ProblemStep, pb.Assignment, pb.Commit, DotFileInfo, Path]:
    dotfile, problem_set_dir, maybe_problem_dir = find_dotfile(start_dir)
    assignment = pb.Assignment(
        user_id=dotfile.assignment_ref.user_id,
        course_id=dotfile.assignment_ref.course_id,
        problem_set_id=dotfile.assignment_ref.problem_set_id,
    )

    if len(dotfile.problems) == 1:
        unique = next(iter(dotfile.problems))
        problem_dir = problem_set_dir
    else:
        if maybe_problem_dir is None:
            fail("you must run this from within a specific problem directory")
        unique = maybe_problem_dir.name
        problem_dir = maybe_problem_dir

    info = dotfile.problems.get(unique)
    if info is None:
        fail(f"unable to recognize the problem based on the directory name of {unique!r}")

    problem_resp = _rpc_call(
        config,
        "GetProblem",
        session.stub.GetProblem,
        pb.GetProblemRequest(problem_id=info.problem_id),
        grpc_metadata(config.cookie),
    )
    problem = problem_resp.problem

    step_files_resp = _rpc_call(
        config,
        "GetAssignmentStepFiles",
        session.stub.GetAssignmentStepFiles,
        pb.GetAssignmentStepFilesRequest(
            assignment=_assignment_key(assignment),
            problem_id=problem.problem_id,
            step_number=info.step,
            reset_to_step_start=False,
            include_contents=False,
        ),
        grpc_metadata(config.cookie),
    )

    step_resp = _rpc_call(
        config,
        "GetProblemStep",
        session.stub.GetProblemStep,
        pb.GetProblemStepRequest(problem_id=problem.problem_id, step=info.step),
        grpc_metadata(config.cookie),
    )
    step = step_resp.problem_step

    type_resp = _rpc_call(
        config,
        "GetProblemType",
        session.stub.GetProblemType,
        pb.GetProblemTypeRequest(problem_type=step.problem_type),
        grpc_metadata(config.cookie),
    )
    problem_type = type_resp.problem_type

    step_files: dict[str, bytes] = {}
    for name, contents in step.files.items():
        if name not in step.whitelist:
            step_files[str(Path(name))] = contents
    for name, contents in problem_type.files.items():
        step_files[str(Path(name))] = contents
    update_files(problem_dir, step_files, None, True)

    commit = _build_commit_from_disk(
        problem_dir,
        [str(Path(entry.path)) for entry in step_files_resp.student_owned_files],
        pb.AssignmentKey(
            user_id=dotfile.assignment_ref.user_id,
            course_id=dotfile.assignment_ref.course_id,
            problem_set_id=dotfile.assignment_ref.problem_set_id,
        ),
        info.problem_id,
        info.step,
    )
    return problem_type, problem, step, assignment, commit, dotfile, problem_dir


def handle_daycare_stream(
    config: Config,
    session: Session,
    bundle: pb.SignedGradingCommit,
    args: list[str],
    directory: Path,
    process_events: bool,
) -> pb.SignedGradingCommit | None:
    parsed = pb.GradingCommit()
    parsed.ParseFromString(bundle.commit)
    request = pb.DaycareRequest(
        commit=bundle,
        problem_type=parsed.problem_type.problem_type,
        action=parsed.commit.action,
        args=args,
    )
    dump_message(config, "Daycare", True, request)
    try:
        stream = session.stub.Daycare(request, metadata=grpc_metadata(config.cookie))
    except Exception as exc:
        raise CliError(f"error starting Daycare session: {clean_error(exc)}") from exc
    dump_message(config, "Daycare", False, None)

    for reply in stream:
        if reply.error:
            dump_message(config, "Daycare Error", False, reply.error)
            raise CliError(f"server returned an error: {reply.error}")
        if reply.HasField("commit"):
            dump_message(config, "Daycare Commit", False, reply.commit)
            return reply.commit
        if reply.HasField("event"):
            event = reply.event
            dump_message(config, "Daycare Event", False, event)
            if event.event in {"exec", "stdin", "stdout", "exit", "error", "stderr"}:
                if process_events:
                    print(dump_event(event), end="")
            elif event.event == "files" and process_events and event.files and str(directory):
                for name, contents in event.files.items():
                    logging.error("downloading file %s", name)
                    path = directory / Path(name)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(contents)
            continue
        raise CliError("unexpected reply from server")

    logging.error("session closed by server")
    return None


def get_assignment(config: Config, session: Session, assignment: pb.Assignment, root_dir: Path, pretty_root: str) -> Path:
    info_resp = _rpc_call(
        config,
        "GetAssignment",
        session.stub.GetAssignment,
        pb.GetAssignmentRequest(assignment=_assignment_key(assignment)),
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

        files_resp = _rpc_call(
            config,
            "GetAssignmentStepFiles",
            session.stub.GetAssignmentStepFiles,
            pb.GetAssignmentStepFilesRequest(
                assignment=_assignment_key(assignment),
                problem_id=problem_info.problem_id,
                step_number=problem_info.current_step_number,
                reset_to_step_start=False,
                include_contents=True,
            ),
            grpc_metadata(config.cookie),
        )
        files: dict[str, bytes] = {}
        for entry in files_resp.system_owned_files:
            files[str(Path(entry.path))] = entry.content
        for entry in files_resp.student_owned_files:
            files[str(Path(entry.path))] = entry.content
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

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

    name = args.get_args[0]
    root_dir = Path.home()
    pretty_root = "~"
    if len(args.get_args) == 2:
        root_dir = Path(args.get_args[1])
        pretty_root = str(root_dir)

    with managed_session(config) as session:
        assignment: pb.Assignment
        if name.isdigit() and int(name) > 0:
            asst_resp = _rpc_call(
                config,
                "GetAssignments",
                session.stub.GetAssignments,
                pb.GetAssignmentsRequest(search=[]),
                grpc_metadata(config.cookie),
            )
            ordered = sorted(
                list(asst_resp.assignments),
                key=lambda a: (
                    a.course_id,
                    a.due_at.seconds if a.HasField("due_at") else 0,
                    a.lock_at.seconds if a.HasField("lock_at") else 0,
                    a.user_id,
                    a.problem_set_id,
                ),
            )
            idx = int(name)
            if idx < 1 or idx > len(ordered):
                fail(f"assignment number {idx} not found; run '{program_name()} list' to refresh numbering")
            assignment = ordered[idx - 1]
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
                "GetAssignments",
                session.stub.GetAssignments,
                pb.GetAssignmentsRequest(search=[course_term, pset_term]),
                grpc_metadata(config.cookie),
            )
            matches = list(response.assignments)
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
            assignment = matches[0]

        if assignment.user_id != session.user.user_id:
            fail("you do not have access to that assignment")
        get_assignment(config, session, assignment, root_dir, pretty_root)


def command_sync(args: argparse.Namespace) -> None:
    if args.extra:
        _usage_error(args.parser)

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)
    with managed_session(config) as session:
        _, problem, _, _, commit, _, _ = gather_student(config, session, Path("."))
        commit.action = ""
        commit.note = "grind sync"
        unsigned = pb.GradingCommit(user_id=session.user.user_id, commit=commit)
        _rpc_call(
            config,
            "SaveUngradedCommit",
            session.stub.SaveUngradedCommit,
            pb.SaveUngradedCommitRequest(commit=unsigned),
            grpc_metadata(config.cookie),
        )
        print(f"problem {problem.problem_id} step {commit.step} synced")


def command_grade(args: argparse.Namespace) -> None:
    if args.extra:
        _usage_error(args.parser)

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

    with managed_session(config) as session:
        _, problem, _, _, commit, dotfile, _ = gather_student(config, session, Path("."))
        info = dotfile.problems.get(problem.problem_id)
        if info is None:
            fail(f"unable to find problem info for {problem.problem_id}")
        current_files_resp = _rpc_call(
            config,
            "GetAssignmentStepFiles",
            session.stub.GetAssignmentStepFiles,
            pb.GetAssignmentStepFilesRequest(
                assignment=commit.assignment,
                problem_id=problem.problem_id,
                step_number=info.step,
                reset_to_step_start=False,
                include_contents=False,
            ),
            grpc_metadata(config.cookie),
        )
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
        signed = signed_resp.commit
        signed_commit = pb.GradingCommit()
        signed_commit.ParseFromString(signed.commit)
        if not signed_commit.hostname:
            fail("server was unable to find a suitable daycare, unable to grade")

        print(f"submitting {problem.problem_id} step {commit.step} for grading")
        graded = handle_daycare_stream(config, session, signed, [], Path(""), False)
        if graded is None:
            fail("the server ended the connection without sending a report card")

        saved_resp = _rpc_call(
            config,
            "SaveGradedCommit",
            session.stub.SaveGradedCommit,
            pb.SaveGradedCommitRequest(commit=graded),
            grpc_metadata(config.cookie),
        )
        _ = saved_resp
        graded_bundle = pb.GradingCommit()
        graded_bundle.ParseFromString(graded.commit)
        saved_commit = graded_bundle.commit

        if saved_commit.HasField("report_card") and saved_commit.report_card.passed and saved_commit.score == 1.0:
            print(f"step {saved_commit.step} passed")
            if info.step >= info.total_steps:
                print("you have completed all steps for this problem")
            else:
                next_step_number = info.step + 1
                print(f"moving to step {next_step_number}")
                new_files_resp = _rpc_call(
                    config,
                    "GetAssignmentStepFiles",
                    session.stub.GetAssignmentStepFiles,
                    pb.GetAssignmentStepFilesRequest(
                        assignment=commit.assignment,
                        problem_id=problem.problem_id,
                        step_number=next_step_number,
                        reset_to_step_start=False,
                        include_contents=True,
                    ),
                    grpc_metadata(config.cookie),
                )
                files: dict[str, bytes] = {}
                for entry in new_files_resp.system_owned_files:
                    files[str(Path(entry.path))] = entry.content
                for entry in new_files_resp.student_owned_files:
                    files[str(Path(entry.path))] = entry.content
                old_paths: set[str] = {str(Path(entry.path)) for entry in current_files_resp.system_owned_files}
                old_paths.update(str(Path(entry.path)) for entry in current_files_resp.student_owned_files)
                update_files(Path("."), files, old_paths, False)
                info.step = next_step_number
                info.total_steps = int(new_files_resp.total_steps)
                save_dotfile(dotfile)
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

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

    with managed_session(config) as session:
        problem_type, problem, _, _, commit, _, _ = gather_student(config, session, Path("."))
        commit.action = action
        commit.note = "grind action " + action

        if action not in problem_type.actions:
            print(f"available actions for problem type {problem_type.problem_type}:")
            for name in sorted(problem_type.actions):
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
        signed = signed_resp.commit
        signed_commit = pb.GradingCommit()
        signed_commit.ParseFromString(signed.commit)

        if not signed_commit.hostname:
            fail("server was unable to find a suitable daycare, unable to run action")

        print(f"starting interactive session for {problem.problem_id} step {commit.step}")
        handle_daycare_stream(config, session, signed, [], Path("."), True)


def command_reset(args: argparse.Namespace) -> None:
    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

    with managed_session(config) as session:
        _, problem, _, assignment, _, dotfile, problem_dir = gather_student(config, session, Path("."))
        info = dotfile.problems[problem.problem_id]
        reset_files_resp = _rpc_call(
            config,
            "GetAssignmentStepFiles",
            session.stub.GetAssignmentStepFiles,
            pb.GetAssignmentStepFilesRequest(
                assignment=_assignment_key(assignment),
                problem_id=problem.problem_id,
                step_number=info.step,
                reset_to_step_start=True,
                include_contents=True,
            ),
            grpc_metadata(config.cookie),
        )

        listed: set[str] = set()
        for requested in args.reset_args:
            found = False
            clean = str(Path(requested))
            for entry in reset_files_resp.student_owned_files:
                entry_path = str(Path(entry.path))
                if clean == entry_path or (Path(clean).name == clean and Path(clean).name == Path(entry_path).name):
                    listed.add(entry_path)
                    found = True
            if not found:
                fail(f"no file matching {requested!r} in the list of student files for this step")

        files: dict[str, bytes] = {
            str(Path(entry.path)): entry.content
            for entry in reset_files_resp.system_owned_files
        }
        expected_student: dict[str, bytes] = {
            str(Path(entry.path)): entry.content
            for entry in reset_files_resp.student_owned_files
        }
        for path_name, contents in expected_student.items():
            files[path_name] = contents

        found_mod = False
        for entry in reset_files_resp.student_owned_files:
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

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

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

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

    with managed_session(config) as session:
        if not session.user.author:
            fail("you must be an author to use this command")
        _, _, step, _, _, _, problem_dir = gather_student(config, session, Path("."))
        if not step.solution:
            fail("no solution files found")
        files = {str(Path(name)): contents for name, contents in step.solution.items()}
        update_files(problem_dir, files, None, True)


def command_type(args: argparse.Namespace) -> None:
    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

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

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

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
            download_student_assignment(config, session, most_recent.assignment, None)
        else:
            fail(
                "the search found assignments for more than one user\n"
                f"   either pick the correct assignment number from the list\n"
                f"   and run '{program_name()} student [number]'\n"
                "   or repeat the search with additional terms\n"
                "   to narrow the results"
            )


def download_student_assignment(config: Config, session: Session, assignment_key: pb.AssignmentKey, assignment: pb.Assignment | None) -> None:
    if assignment is None:
        assignment = pb.Assignment(
            user_id=assignment_key.user_id,
            course_id=assignment_key.course_id,
            problem_set_id=assignment_key.problem_set_id,
        )
    user_resp = _rpc_call(
        config,
        "GetUser",
        session.stub.GetUser,
        pb.GetUserRequest(user_id=assignment.user_id),
        grpc_metadata(config.cookie),
    )
    user = user_resp.user
    print(f"[{user.user_name}] assignment {assignment.course_id}/{assignment.problem_set_id}")

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


def parse_problem_cfg(path: Path) -> ProblemCfg:
    sections = parse_gcfg(path)
    problem_section = get_first_section(sections, "problem")
    if problem_section is None:
        fail(f"failed to parse {path}: missing [problem] section")

    unique = get_last_non_empty(get_all_values(problem_section, "unique"), "problem.unique", path)
    note = get_last_non_empty(get_all_values(problem_section, "note"), "problem.note", path)
    problem_type = get_last_value_or_empty(problem_section, "type")
    tags = get_all_values(problem_section, "tag")
    options = get_all_values(problem_section, "option")

    step_sections = get_sections(sections, "step")
    steps: list[AuthorStepCfg] = []
    if not step_sections:
        steps.append(AuthorStepCfg(note=note, problem_type=problem_type, weight=1.0))
    else:
        step_map: dict[int, AuthorStepCfg] = {}
        for section in step_sections:
            if section.subsection is None or not section.subsection.isdigit():
                fail(f"failed to parse {path}: step sections must be [step \"N\"]")
            index = int(section.subsection)
            step_note = get_last_non_empty(get_all_values(section, "note"), f"step {index}.note", path)
            section_type = get_last_value_or_empty(section, "type")
            if (section_type == "") == (problem_type == ""):
                fail("problem type must be specified for the problem as a whole or for each step, but not both")
            resolved_type = section_type if section_type else problem_type
            weight_text = get_last_value_or_empty(section, "weight")
            weight = float(weight_text) if weight_text else 1.0
            step_map[index] = AuthorStepCfg(note=step_note, problem_type=resolved_type, weight=weight)

        if not step_map:
            fail(f"expected to find {len(step_sections)} step{plural(len(step_sections))}, but only found 0")
        for idx in range(1, max(step_map) + 1):
            if idx not in step_map:
                fail(f"expected to find {len(step_map)} step{plural(len(step_map))}, but only found {idx-1}")
            steps.append(step_map[idx])

    return ProblemCfg(unique=unique, note=note, problem_type=problem_type, tags=tags, options=options, steps=steps)


def parse_problem_set_cfg(path: Path) -> ProblemSetCfg:
    sections = parse_gcfg(path)
    pset = get_first_section(sections, "problemset")
    if pset is None:
        fail(f"failed to parse {path}: missing [problemset] section")

    unique = get_last_non_empty(get_all_values(pset, "unique"), "problemset.unique", path)
    note = get_last_non_empty(get_all_values(pset, "note"), "problemset.note", path)
    tags = get_all_values(pset, "tag")

    problem_sections = get_sections(sections, "problem")
    problems: dict[str, float] = {}
    for section in problem_sections:
        if section.subsection is None:
            continue
        weight_text = get_last_value_or_empty(section, "weight")
        weight = float(weight_text) if weight_text else 1.0
        problems[section.subsection] = weight

    return ProblemSetCfg(unique=unique, note=note, tags=tags, problems=problems)


def get_last_non_empty(values: list[str], field: str, path: Path) -> str:
    if not values:
        fail(f"failed to parse {path}: missing {field}")
    value = values[-1].strip()
    if not value:
        fail(f"failed to parse {path}: empty {field}")
    return value


def get_last_value_or_empty(section: GcfgSection, key: str) -> str:
    value = get_last_value(section, key)
    return "" if value is None else value


def find_problem_cfg(now, start_dir: Path) -> tuple[Path, Path, int, pb.Problem | None, list[pb.ProblemStep], bool]:
    directory = start_dir.resolve()
    step_dir = directory
    step_num = 0
    while not (directory / PROBLEM_CONFIG_NAME).exists():
        step_dir = directory
        parent = directory.parent
        if parent == directory:
            return Path(""), Path(""), 0, None, [], False
        directory = parent

    cfg = parse_problem_cfg(directory / PROBLEM_CONFIG_NAME)
    problem = pb.Problem(
        problem_id=cfg.unique,
        problem_note=cfg.note,
        problem_tags=cfg.tags,
        problem_options=cfg.options,
    )
    _set_proto_timestamp(problem.created_at, now)
    _set_proto_timestamp(problem.updated_at, now)

    single = len(cfg.steps) == 1 and get_sections(parse_gcfg(directory / PROBLEM_CONFIG_NAME), "step") == []
    steps: list[pb.ProblemStep] = []
    for idx, step_cfg in enumerate(cfg.steps, start=1):
        steps.append(
            pb.ProblemStep(
                step=idx,
                note=step_cfg.note,
                problem_type=step_cfg.problem_type,
                weight=step_cfg.weight,
                files={},
            )
        )

    if single:
        step_num = 1
    elif step_dir != directory and step_dir.name.isdigit():
        n = int(step_dir.name)
        if 1 <= n <= len(steps):
            step_num = n

    return directory, step_dir, step_num, problem, steps, single


def gather_author(
    now,
    action: str,
    start_dir: Path,
) -> tuple[pb.AuthorProblemDraft, Path, int]:
    directory, step_dir, step_num, problem, steps, single = find_problem_cfg(now, start_dir)
    if problem is None:
        fail(f"unable to find {PROBLEM_CONFIG_NAME} in current directory or one of its ancestors\n   you must run this in a problem directory")

    if single and (directory / "1").is_dir():
        fail(
            f"{PROBLEM_CONFIG_NAME} is set up for a single-step problem with the step files in\n"
            f"  the same directory as {PROBLEM_CONFIG_NAME}, but there is also a directory named '1'\n"
            f"  Please add a [step \"1\"] entry to {PROBLEM_CONFIG_NAME} or move the step files\n"
            "  into the main directory and delete the '1' directory"
        )

    if directory.name != problem.problem_id:
        fail("the problem directory name must match the problem unique ID")

    def report_whitespace_issues(path_label: str, content: bytes) -> None:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            return
        issues: list[str] = []
        if "\r" in text:
            issues.append("non-Unix line endings")
        if text != "" and not text.endswith("\n"):
            issues.append("missing final newline")
        if any(line.endswith(" ") for line in text.splitlines()):
            issues.append("trailing spaces")
        if issues:
            print(f"warning: {path_label} has {', '.join(issues)}")

    def gather_step_tree(step_directory: Path, step_index: int) -> tuple[list[pb.AuthorFile], list[pb.AuthorFile]]:
        if not step_directory.is_dir():
            fail(f"missing step directory {step_directory}")
        authored_files: list[pb.AuthorFile] = []
        starter_files: list[pb.AuthorFile] = []
        for path in sorted(step_directory.rglob("*")):
            rel = path.relative_to(step_directory)
            if path.is_dir():
                continue
            rel_posix = rel.as_posix()
            if single and rel_posix == PROBLEM_CONFIG_NAME:
                continue
            parts = rel.parts
            if parts[0] == "_solution":
                fail("legacy _solution authoring layout is no longer supported")
            content = path.read_bytes()
            if parts[0] == "_starter":
                if len(parts) == 1:
                    fail("_starter must be a directory")
                logical_path = Path(*parts[1:]).as_posix()
                report_whitespace_issues(f"step {step_index} file _starter/{logical_path}", content)
                starter_files.append(pb.AuthorFile(path=logical_path, content=content))
                continue
            report_whitespace_issues(f"step {step_index} file {rel_posix}", content)
            authored_files.append(pb.AuthorFile(path=rel_posix, content=content))
        return authored_files, starter_files

    draft = pb.AuthorProblemDraft(
        problem_id=problem.problem_id,
        problem_note=problem.problem_note,
        problem_tags=problem.problem_tags,
        problem_options=problem.problem_options,
    )

    for idx, step in enumerate(steps, start=1):
        print(f"gathering step {idx}")
        step_directory = directory if single else directory / str(idx)
        authored_files, starter_files = gather_step_tree(step_directory, idx)
        draft.steps.append(
            pb.AuthorProblemStepDraft(
                step_number=idx,
                note=step.note,
                problem_type=step.problem_type,
                weight=step.weight,
                files=authored_files,
                starter_files=starter_files,
            )
        )
        print(
            f"  found {len(authored_files)} authored file{plural(len(authored_files))} "
            f"and {len(starter_files)} starter file{plural(len(starter_files))}"
        )

    if action and not single and (step_dir == directory or step_num < 1):
        fail("to run an action, you must be in a step directory")

    return draft, step_dir, step_num


def create_problem_set(config: Config, session: Session, path: Path, is_update: bool) -> None:
    now = grpc_time_now()
    cfg = parse_problem_set_cfg(path)

    problem_set = pb.ProblemSet(
        problem_set_id=cfg.unique,
        problem_set_note=cfg.note,
        problem_set_tags=cfg.tags,
    )
    _set_proto_timestamp(problem_set.created_at, now)
    _set_proto_timestamp(problem_set.updated_at, now)

    if path.name != problem_set.problem_set_id + ".cfg":
        fail("the problem set file name must match the problem set unique ID")

    bundle = pb.ProblemSetBundle(problem_set=problem_set)

    if not cfg.problems:
        fail("a problem set must contain at least one problem")

    for unique, weight in cfg.problems.items():
        response = _rpc_call(
            config,
            "GetProblems",
            session.stub.GetProblems,
            pb.GetProblemsRequest(problem_id=unique),
            grpc_metadata(config.cookie),
        )
        problems = list(response.problems)
        if not problems:
            fail(f"problem with unique ID {unique!r} not found")
        if len(problems) != 1:
            fail(f"error: server found multiple problems with matching unique ID {unique!r}")
        bundle.problem_set_problems.append(
            pb.ProblemSetProblem(problem_id=problems[0].problem_id, weight=weight if weight > 0.0 else 1.0)
        )

    mode = pb.SAVE_MODE_UPDATE if is_update else pb.SAVE_MODE_CREATE
    final = _rpc_call(
        config,
        "SaveProblemSet",
        session.stub.SaveProblemSet,
        pb.SaveProblemSetRequest(mode=mode, bundle=bundle),
        grpc_metadata(config.cookie),
    )
    if is_update:
        print(f"problem set {final.bundle.problem_set.problem_set_id!r} saved and ready to use")
    else:
        print(f"problem set {final.bundle.problem_set.problem_set_id!r} created and ready to use")


def command_create(args: argparse.Namespace) -> None:
    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

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
            validated_commit = pb.GradingCommit()
            validated_commit.ParseFromString(validated.commit)
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
