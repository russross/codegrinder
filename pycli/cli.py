from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

import codegrinder_pb2 as pb
import grpc

from errors import CliError, fail
from gcfg import GcfgSection, get_all_values, get_first_section, get_last_value, get_sections, parse_gcfg
from helpers import (
    CONFIG_FILE,
    Session,
    check_version,
    clean_error,
    config_dir,
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
    setup,
    update_files,
    write_config,
)
from models import Config, DotFileInfo, ProblemInfo
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
        print(f"login successful; welcome {response.user.name}")
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
            "ListProblems",
            session.stub.ListProblems,
            pb.ListProblemsRequest(),
            grpc_metadata(config.cookie),
        )
        assignments = list(response.assignments)
        if not assignments:
            fail("no assignments found\nyou must start each assignment through Canvas before you can access it here")

        courses = {course.id: course for course in response.courses}
        problem_sets = {ps.id: ps for ps in response.problem_sets}

        longest_id = max(len(str(a.id)) for a in assignments)
        longest_name = max(len(a.canvas_title) for a in assignments)

        current_course_id = -1
        for assignment in assignments:
            if assignment.course_id != current_course_id:
                if current_course_id != -1:
                    print()
                current_course_id = assignment.course_id
                course = courses[current_course_id]
                print(course.name)
                print(dashes(len(course.name)))

            course = courses[assignment.course_id]
            problem_set = problem_sets[assignment.problem_set_id]
            print(
                f"id:{assignment.id:<{longest_id}} "
                f"{assignment.canvas_title:<{longest_name}} "
                f"{assignment.score * 100:3.0f}% "
                f"({course_directory(course.label)}/{problem_set.unique})"
            )


def _build_commit_from_disk(
    problem_dir: Path,
    step: pb.ProblemStep,
    assignment_id: int,
    problem_id: int,
    step_num: int,
) -> pb.Commit:
    files: dict[str, bytes] = {}
    missing: list[str] = []
    for name in step.whitelist:
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
        assignment_id=assignment_id,
        problem_id=problem_id,
        step=step_num,
        files=files,
    )
    _set_proto_timestamp(commit.created_at, now)
    _set_proto_timestamp(commit.updated_at, now)
    return commit


def gather_student(config: Config, session: Session, start_dir: Path) -> tuple[pb.ProblemType, pb.Problem, pb.ProblemStep, pb.Assignment, pb.Commit, DotFileInfo, Path]:
    dotfile, problem_set_dir, maybe_problem_dir = find_dotfile(start_dir)

    assignment_resp = _rpc_call(
        config,
        "GetAssignment",
        session.stub.GetAssignment,
        pb.GetAssignmentRequest(assignment_id=dotfile.assignment_id),
        grpc_metadata(config.cookie),
    )
    assignment = assignment_resp.assignment

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
        pb.GetProblemRequest(problem_id=info.id),
        grpc_metadata(config.cookie),
    )
    problem = problem_resp.problem

    step_resp = _rpc_call(
        config,
        "GetProblemStep",
        session.stub.GetProblemStep,
        pb.GetProblemStepRequest(problem_id=problem.id, step=info.step),
        grpc_metadata(config.cookie),
    )
    step = step_resp.problem_step

    type_resp = _rpc_call(
        config,
        "GetProblemType",
        session.stub.GetProblemType,
        pb.GetProblemTypeRequest(name=step.problem_type),
        grpc_metadata(config.cookie),
    )
    problem_type = type_resp.problem_type

    step_files: dict[str, bytes] = {}
    for name, contents in step.files.items():
        if name not in step.whitelist:
            step_files[str(Path(name))] = contents
    for name, contents in problem_type.files.items():
        step_files[str(Path(name))] = contents
    step_files[str(Path("doc") / "index.html")] = step.instructions.encode("utf-8")
    update_files(problem_dir, step_files, None, True)

    commit = _build_commit_from_disk(problem_dir, step, dotfile.assignment_id, info.id, info.step)
    return problem_type, problem, step, assignment, commit, dotfile, problem_dir


def _fetch_problem_type(config: Config, session: Session, cache: dict[str, pb.ProblemType], name: str) -> pb.ProblemType:
    if name not in cache:
        response = _rpc_call(
            config,
            "GetProblemType",
            session.stub.GetProblemType,
            pb.GetProblemTypeRequest(name=name),
            grpc_metadata(config.cookie),
        )
        cache[name] = response.problem_type
    return cache[name]


def next_step(
    config: Config,
    session: Session,
    directory: Path,
    info: ProblemInfo,
    problem: pb.Problem,
    commit: pb.Commit,
    types_cache: dict[str, pb.ProblemType],
) -> bool:
    print(f"step {commit.step} passed")

    try:
        new_step_resp = _rpc_call(
            config,
            "GetProblemStep",
            session.stub.GetProblemStep,
            pb.GetProblemStepRequest(problem_id=problem.id, step=commit.step + 1),
            grpc_metadata(config.cookie),
        )
    except CliError:
        print("you have completed all steps for this problem")
        return False

    old_step_resp = _rpc_call(
        config,
        "GetProblemStep",
        session.stub.GetProblemStep,
        pb.GetProblemStepRequest(problem_id=problem.id, step=commit.step),
        grpc_metadata(config.cookie),
    )

    new_step = new_step_resp.problem_step
    old_step = old_step_resp.problem_step
    print(f"moving to step {new_step.step}")

    old_type = _fetch_problem_type(config, session, types_cache, old_step.problem_type)
    new_type = _fetch_problem_type(config, session, types_cache, new_step.problem_type)

    files: dict[str, bytes] = {}
    for name, contents in commit.files.items():
        files[str(Path(name))] = contents
    for name, contents in new_step.files.items():
        files[str(Path(name))] = contents
    files[str(Path("doc") / "index.html")] = new_step.instructions.encode("utf-8")

    for name, contents in new_type.files.items():
        path_name = str(Path(name))
        if path_name in files:
            print(f"warning: problem type file is overwriting problem file: {name}")
        files[path_name] = contents

    old_files: set[str] = {str(Path(name)) for name in old_type.files}
    old_files.update(str(Path(name)) for name in old_step.files)

    update_files(directory, files, old_files, False)
    info.step += 1
    return True


def handle_daycare_stream(
    config: Config,
    session: Session,
    bundle: pb.CommitBundle,
    args: list[str],
    directory: Path,
    process_events: bool,
) -> pb.CommitBundle | None:
    request = pb.DaycareRequest(
        commit_bundle=bundle,
        problem_type=bundle.problem_type.name,
        action=bundle.commit.action,
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
        if reply.HasField("commit_bundle"):
            dump_message(config, "Daycare CommitBundle", False, reply.commit_bundle)
            return reply.commit_bundle
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
    course_resp = _rpc_call(
        config,
        "GetCourse",
        session.stub.GetCourse,
        pb.GetCourseRequest(course_id=assignment.course_id),
        grpc_metadata(config.cookie),
    )
    course = course_resp.course

    pset_resp = _rpc_call(
        config,
        "GetProblemSet",
        session.stub.GetProblemSet,
        pb.GetProblemSetRequest(problem_set_id=assignment.problem_set_id),
        grpc_metadata(config.cookie),
    )
    problem_set = pset_resp.problem_set

    psps_resp = _rpc_call(
        config,
        "GetProblemSetProblems",
        session.stub.GetProblemSetProblems,
        pb.GetProblemSetProblemsRequest(problem_set_id=assignment.problem_set_id),
        grpc_metadata(config.cookie),
    )

    commits: dict[str, pb.Commit | None] = {}
    problems: dict[str, pb.Problem] = {}
    steps: dict[str, pb.ProblemStep] = {}
    types_cache: dict[str, pb.ProblemType] = {}
    problem_steps: dict[str, int] = {}

    for entry in psps_resp.problem_set_problems:
        problem_resp = _rpc_call(
            config,
            "GetProblem",
            session.stub.GetProblem,
            pb.GetProblemRequest(problem_id=entry.problem_id),
            grpc_metadata(config.cookie),
        )
        problem = problem_resp.problem
        problems[problem.unique] = problem

        try:
            commit_resp = _rpc_call(
                config,
                "GetAssignmentProblemCommitLast",
                session.stub.GetAssignmentProblemCommitLast,
                pb.GetAssignmentProblemCommitLastRequest(assignment_id=assignment.id, problem_id=problem.id),
                grpc_metadata(config.cookie),
            )
            commit = commit_resp.commit
            problem_steps[problem.unique] = int(commit.step)
        except CliError:
            commit = None
            problem_steps[problem.unique] = 1

        step_resp = _rpc_call(
            config,
            "GetProblemStep",
            session.stub.GetProblemStep,
            pb.GetProblemStepRequest(problem_id=problem.id, step=problem_steps[problem.unique]),
            grpc_metadata(config.cookie),
        )
        step = step_resp.problem_step
        commits[problem.unique] = commit
        steps[problem.unique] = step
        if step.problem_type not in types_cache:
            type_resp = _rpc_call(
                config,
                "GetProblemType",
                session.stub.GetProblemType,
                pb.GetProblemTypeRequest(name=step.problem_type),
                grpc_metadata(config.cookie),
            )
            types_cache[step.problem_type] = type_resp.problem_type

    infos: dict[str, ProblemInfo] = {
        unique: ProblemInfo(id=problem.id, step=problem_steps[unique])
        for unique, problem in problems.items()
    }

    root_dir = root_dir / course_directory(course.label) / problem_set.unique
    pretty_full = str(Path(pretty_root) / course_directory(course.label) / problem_set.unique)
    if root_dir.exists():
        fail(f"directory {pretty_full} already exists\ndelete it first if you want to re-download the assignment")

    print(f"unpacking problem set in {pretty_full}")

    most_recent = grpc_time_now().replace(year=1970)
    change_to = root_dir
    for unique in list(steps.keys()):
        commit = commits[unique]
        problem = problems[unique]
        step = steps[unique]

        target = root_dir if len(steps) == 1 else root_dir / unique
        if len(steps) > 1:
            if step.step > 1:
                print(f"unpacking problem {unique} step {step.step}")
            else:
                print(f"unpacking problem {unique}")
        elif step.step > 1:
            print(f"unpacking step {step.step}")

        files: dict[str, bytes] = {str(Path(name)): contents for name, contents in step.files.items()}
        files[str(Path("doc") / "index.html")] = step.instructions.encode("utf-8")

        if commit is not None:
            updated = commit.updated_at.ToDatetime()
            if updated > most_recent:
                most_recent = updated
                change_to = target
            for name, contents in commit.files.items():
                files[str(Path(name))] = contents

        for name, contents in types_cache[step.problem_type].files.items():
            path_name = str(Path(name))
            if path_name in files:
                print(f"warning: problem type file is overwriting problem file: {target / Path(name)}")
            files[path_name] = contents

        update_files(target, files, None, False)

        if commit is not None and commit.HasField("report_card") and commit.report_card.passed and commit.score == 1.0:
            next_step(config, session, target, infos[unique], problem, commit, types_cache)

    dotfile = DotFileInfo(
        assignment_id=assignment.id,
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
            response = _rpc_call(
                config,
                "GetAssignment",
                session.stub.GetAssignment,
                pb.GetAssignmentRequest(assignment_id=int(name)),
                grpc_metadata(config.cookie),
            )
            assignment = response.assignment
        else:
            parts = name.split("/")
            if len(parts) != 2:
                fail(
                    "unknown assignment identifier\n"
                    f"   run '{program_name()} get [id]'\n"
                    f"   or  '{program_name()} get [course/problem-id]'\n"
                    f"   [id] and [course/problem-id] can be found using '{program_name()} list'"
                )
            search_terms = [parts[0], parts[1]]
            response = _rpc_call(
                config,
                "GetAssignments",
                session.stub.GetAssignments,
                pb.GetAssignmentsRequest(search=search_terms),
                grpc_metadata(config.cookie),
            )
            matches = list(response.assignments)
            if not matches:
                fail(
                    "no matching assignment found\n"
                    f"   run '{program_name()} get [id]'\n"
                    f"   or  '{program_name()} get [course/problem-id]'\n"
                    f"   [id] and [course/problem-id] can be found using '{program_name()} list'"
                )
            if len(matches) != 1:
                fail(
                    "found more than one matching assignment\n"
                    f"   run '{program_name()} get [id]' instead\n"
                    f"   [id] can be found using '{program_name()} list'"
                )
            assignment = matches[0]

        if assignment.user_id != session.user.id:
            fail(f"you do not have an assignment with number {assignment.id}")
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
        unsigned = pb.CommitBundle(user_id=session.user.id, commit=commit)
        _rpc_call(
            config,
            "PostCommitBundlesUnsigned",
            session.stub.PostCommitBundlesUnsigned,
            pb.PostCommitBundlesUnsignedRequest(bundle=unsigned),
            grpc_metadata(config.cookie),
        )
        print(f"problem {problem.unique} step {commit.step} synced")


def command_grade(args: argparse.Namespace) -> None:
    if args.extra:
        _usage_error(args.parser)

    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

    with managed_session(config) as session:
        _, problem, _, _, commit, dotfile, _ = gather_student(config, session, Path("."))
        commit.action = "grade"
        commit.note = "grind grade"
        unsigned = pb.CommitBundle(user_id=session.user.id, commit=commit)

        signed_resp = _rpc_call(
            config,
            "PostCommitBundlesUnsigned",
            session.stub.PostCommitBundlesUnsigned,
            pb.PostCommitBundlesUnsignedRequest(bundle=unsigned),
            grpc_metadata(config.cookie),
        )
        signed = signed_resp.bundle
        if not signed.hostname:
            fail("server was unable to find a suitable daycare, unable to grade")

        print(f"submitting {problem.unique} step {commit.step} for grading")
        graded = handle_daycare_stream(config, session, signed, [], Path(""), False)
        if graded is None:
            fail("the server ended the connection without sending a report card")

        to_save = pb.CommitBundle(
            hostname=graded.hostname,
            user_id=graded.user_id,
            commit=graded.commit,
            commit_signature=graded.commit_signature,
        )

        saved_resp = _rpc_call(
            config,
            "PostCommitBundlesSigned",
            session.stub.PostCommitBundlesSigned,
            pb.PostCommitBundlesSignedRequest(bundle=to_save),
            grpc_metadata(config.cookie),
        )
        saved_commit = saved_resp.bundle.commit

        if saved_commit.HasField("report_card") and saved_commit.report_card.passed and saved_commit.score == 1.0:
            info = dotfile.problems.get(problem.unique)
            if info is None:
                fail(f"unable to find problem info for {problem.unique}")
            if next_step(config, session, Path("."), info, problem, saved_commit, {}):
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
            print(f"available actions for problem type {problem_type.name}:")
            for name in sorted(problem_type.actions):
                if name == "grade":
                    continue
                print(f"   {name}")
            fail(f"use '{program_name()} action [action]' to initiate an action")

        unsigned = pb.CommitBundle(user_id=session.user.id, commit=commit)
        signed_resp = _rpc_call(
            config,
            "PostCommitBundlesUnsigned",
            session.stub.PostCommitBundlesUnsigned,
            pb.PostCommitBundlesUnsignedRequest(bundle=unsigned),
            grpc_metadata(config.cookie),
        )
        signed = signed_resp.bundle

        if not signed.hostname:
            fail("server was unable to find a suitable daycare, unable to run action")

        print(f"starting interactive session for {problem.unique} step {commit.step}")
        handle_daycare_stream(config, session, signed, [], Path("."), True)


def command_reset(args: argparse.Namespace) -> None:
    config = load_config()
    config.api_report = bool(args.api)
    config.api_dump = bool(args.api_dump)

    with managed_session(config) as session:
        problem_type, problem, step, assignment, _, dotfile, problem_dir = gather_student(config, session, Path("."))
        info = dotfile.problems[problem.unique]

        listed: set[str] = set()
        for requested in args.reset_args:
            found = False
            clean = str(Path(requested))
            for entry in step.whitelist:
                entry_path = str(Path(entry))
                if clean == entry_path or (Path(clean).name == clean and Path(clean).name == Path(entry_path).name):
                    listed.add(entry)
                    found = True
            if not found:
                fail(f"no file matching {requested!r} in the list of student files for this step")

        files: dict[str, bytes] = {}

        if info.step > 1:
            commit_resp = _rpc_call(
                config,
                "GetAssignmentProblemStepCommitLast",
                session.stub.GetAssignmentProblemStepCommitLast,
                pb.GetAssignmentProblemStepCommitLastRequest(
                    assignment_id=assignment.id,
                    problem_id=problem.id,
                    step=info.step - 1,
                ),
                grpc_metadata(config.cookie),
            )
            for name, contents in commit_resp.commit.files.items():
                files[str(Path(name))] = contents

        for name, contents in step.files.items():
            files[str(Path(name))] = contents
        files[str(Path("doc") / "index.html")] = step.instructions.encode("utf-8")
        for name, contents in problem_type.files.items():
            files[str(Path(name))] = contents

        found_mod = False
        for name in step.whitelist:
            path_name = str(Path(name))
            expected = files.get(path_name)
            if expected is None:
                fail(f"cannot find file {name!r} in the step but it is on the whitelist")
            on_disk = problem_dir / Path(name)
            if not on_disk.exists():
                found_mod = True
                continue
            if on_disk.read_bytes() != expected:
                found_mod = True
                if name not in listed:
                    print(f"file {name} has been modified")
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
        psets_resp = _rpc_call(
            config,
            "GetProblemSets",
            session.stub.GetProblemSets,
            pb.GetProblemSetsRequest(search=args.problem_args),
            grpc_metadata(config.cookie),
        )
        problem_sets = sorted(psets_resp.problem_sets, key=lambda ps: ps.unique.lower())
        if not problem_sets:
            fail("no problem sets found matching the terms you gave")

        problems: dict[int, pb.Problem] = {}
        problem_steps: dict[int, list[pb.ProblemStep]] = {}

        for index, pset in enumerate(problem_sets):
            if index > 0:
                print()
            print(pset.note)

            psps_resp = _rpc_call(
                config,
                "GetProblemSetProblems",
                session.stub.GetProblemSetProblems,
                pb.GetProblemSetProblemsRequest(problem_set_id=pset.id),
                grpc_metadata(config.cookie),
            )
            for psp in psps_resp.problem_set_problems:
                if psp.problem_id not in problems:
                    problem_resp = _rpc_call(
                        config,
                        "GetProblem",
                        session.stub.GetProblem,
                        pb.GetProblemRequest(problem_id=psp.problem_id),
                        grpc_metadata(config.cookie),
                    )
                    problems[psp.problem_id] = problem_resp.problem

                if psp.problem_id not in problem_steps:
                    steps_resp = _rpc_call(
                        config,
                        "GetProblemSteps",
                        session.stub.GetProblemSteps,
                        pb.GetProblemStepsRequest(problem_id=psp.problem_id),
                        grpc_metadata(config.cookie),
                    )
                    problem_steps[psp.problem_id] = list(steps_resp.problem_steps)

                problem = problems[psp.problem_id]
                if psp.weight == 1.0:
                    print(f"  * {problem.note} ({problem.unique})")
                else:
                    print(f"  * {problem.note} ({problem.unique}, weight {psp.weight:.2f})")
                for n, step in enumerate(problem_steps[psp.problem_id], start=1):
                    text = step.note.replace("\n", "\n       ")
                    suffix = "" if step.weight == 1.0 else f" (weight {step.weight:.2f})"
                    print(f"    {n}. {text}{suffix}")

            print()
            print(f"  → https://{config.host}/lti/problem_sets/cli/{pset.unique}")


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
            width = max(len(pt.name) for pt in response.problem_types)
            for problem_type in response.problem_types:
                actions = ", ".join(problem_type.actions.keys())
                print(f"    {problem_type.name:<{width}}  actions: {actions}")
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
            pb.GetProblemTypeRequest(name=problem_type_name),
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
        if len(args.student_args) == 1 and args.student_args[0].isdigit() and int(args.student_args[0]) > 0:
            download_student_assignment(config, session, int(args.student_args[0]), None)
            return

        response = _rpc_call(
            config,
            "GetAssignments",
            session.stub.GetAssignments,
            pb.GetAssignmentsRequest(search=args.student_args),
            grpc_metadata(config.cookie),
        )
        assignments = sorted(
            response.assignments,
            key=lambda a: (a.user_id, a.updated_at.ToDatetime()),
        )
        if not assignments:
            fail("no assignments found matching the terms you gave")

        users: dict[int, pb.User] = {}
        courses: dict[int, pb.Course] = {}
        longest_id = max(len(str(a.id)) for a in assignments)
        longest_name = max(len(a.canvas_title) for a in assignments)

        for assignment in assignments:
            if assignment.user_id not in users:
                user_resp = _rpc_call(
                    config,
                    "GetUser",
                    session.stub.GetUser,
                    pb.GetUserRequest(user_id=assignment.user_id),
                    grpc_metadata(config.cookie),
                )
                users[assignment.user_id] = user_resp.user
            if assignment.course_id not in courses:
                course_resp = _rpc_call(
                    config,
                    "GetCourse",
                    session.stub.GetCourse,
                    pb.GetCourseRequest(course_id=assignment.course_id),
                    grpc_metadata(config.cookie),
                )
                courses[assignment.course_id] = course_resp.course

        prev_user_id = -1
        for assignment in assignments:
            user = users[assignment.user_id]
            if user.id != prev_user_id:
                if prev_user_id != -1:
                    print()
                prev_user_id = user.id
                print(f"{user.name} ({user.email})")
                print(dashes(len(user.name) + len(user.email) + len(" ()")))

            when = assignment.updated_at.ToDatetime().strftime("%d %b %y %H:%M UTC")
            print(
                f"id:{assignment.id:<{longest_id}} "
                f"{assignment.canvas_title:<{longest_name}} "
                f"{assignment.score * 100:3.0f}% "
                f"({courses[assignment.course_id].name})  [{when}]"
            )
        print()

        if len(users) == 1:
            most_recent = assignments[-1]
            download_student_assignment(config, session, most_recent.id, most_recent)
        else:
            fail(
                "the search found assignments for more than one user\n"
                f"   either pick the correct assignment id from the list\n"
                f"   and run '{program_name()} student [id]'\n"
                "   or repeat the search with additional terms\n"
                "   to narrow the results"
            )


def download_student_assignment(config: Config, session: Session, assignment_id: int, assignment: pb.Assignment | None) -> None:
    if assignment is None:
        response = _rpc_call(
            config,
            "GetAssignment",
            session.stub.GetAssignment,
            pb.GetAssignmentRequest(assignment_id=assignment_id),
            grpc_metadata(config.cookie),
        )
        assignment = response.assignment

    user_resp = _rpc_call(
        config,
        "GetUser",
        session.stub.GetUser,
        pb.GetUserRequest(user_id=assignment.user_id),
        grpc_metadata(config.cookie),
    )
    user = user_resp.user
    print(f"[{user.name}] asst {assignment.id} @ {assignment.score * 100:.0f}% '{assignment.canvas_title}'")

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


def parse_gitignore(content: str) -> list[str]:
    patterns: list[str] = []
    for line in content.splitlines():
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        patterns.append(text)
    return patterns


def match_pattern(pattern: str, path: str) -> bool:
    if pattern.endswith("/"):
        needle = pattern.removesuffix("/")
        return path.startswith(needle + "/") or path == needle
    if pattern.startswith("*"):
        return path.endswith(pattern.removeprefix("*"))
    return path == pattern


def is_ignored(path: str, patterns: list[str]) -> bool:
    return any(match_pattern(pattern, path) for pattern in patterns)


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
        unique=cfg.unique,
        note=cfg.note,
        tags=cfg.tags,
        options=cfg.options,
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
    config: Config,
    session: Session,
    now,
    is_update: bool,
    action: str,
    start_dir: Path,
) -> tuple[pb.ProblemBundle, Path, int]:
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

    if directory.name != problem.unique:
        fail("the problem directory name must match the problem unique ID")

    problem_types: dict[str, pb.ProblemType] = {}
    for step in steps:
        if step.problem_type not in problem_types:
            response = _rpc_call(
                config,
                "GetProblemType",
                session.stub.GetProblemType,
                pb.GetProblemTypeRequest(name=step.problem_type),
                grpc_metadata(config.cookie),
            )
            problem_types[step.problem_type] = response.problem_type

    unsigned = pb.ProblemBundle(problem=problem)

    existing_resp = _rpc_call(
        config,
        "GetProblems",
        session.stub.GetProblems,
        pb.GetProblemsRequest(unique=problem.unique),
        grpc_metadata(config.cookie),
    )
    existing = list(existing_resp.problems)
    if len(existing) == 0:
        if is_update:
            fail(f"you specified --update, but no existing problem with unique ID {problem.unique!r} was found")
        existing_sets_resp = _rpc_call(
            config,
            "GetProblemSets",
            session.stub.GetProblemSets,
            pb.GetProblemSetsRequest(unique=problem.unique),
            grpc_metadata(config.cookie),
        )
        existing_sets = list(existing_sets_resp.problem_sets)
        if len(existing_sets) > 1:
            fail(f"error: server found multiple problem sets with matching unique ID {problem.unique!r}")
        if len(existing_sets) == 1:
            fail(
                f"problem set {existing_sets[0].id} already exists with unique ID {existing_sets[0].unique!r}\n"
                "  this would prevent creating a problem set containing just this problem with matching id"
            )
        print(f"unique ID is {problem.unique!r}")
        print("  this problem is new--no existing problem has the same unique ID")
    elif len(existing) == 1:
        if action == "" and not is_update:
            fail(f"you did not specify --update, but a problem already exists with unique ID {problem.unique!r}")
        print(f"unique ID is {problem.unique!r}")
        print(f"  this is an update of problem {existing[0].id}")
        print(f"  ({existing[0].note!r})")
        problem.id = existing[0].id
        problem.created_at.CopyFrom(existing[0].created_at)
    else:
        fail(f"error: server found multiple problems with matching unique ID {problem.unique!r}")

    whitelist: dict[str, bool] = {}
    for idx, step in enumerate(steps, start=1):
        print(f"gathering step {idx}")
        commit = pb.Commit(
            step=idx,
            action="grade" if action == "" else action,
            note="author solution submitted via grind"
            if action == ""
            else f"author solution tested with action {action} via grind",
            files={},
        )
        _set_proto_timestamp(commit.created_at, now)
        _set_proto_timestamp(commit.updated_at, now)

        starter: dict[str, bytes] = {}
        solution: dict[str, bytes] = {}
        root: dict[str, bytes] = {}
        step_directory = directory if single else directory / str(idx)

        gitignore = problem_types[step.problem_type].files.get(".gitignore", b"")
        patterns = parse_gitignore(gitignore.decode("utf-8", errors="replace"))

        for path in step_directory.rglob("*"):
            rel = path.relative_to(step_directory).as_posix()
            if path.is_dir():
                if is_ignored(rel, patterns):
                    print(f"  skipping directory {rel}")
                    continue
                continue
            if single and rel == PROBLEM_CONFIG_NAME:
                continue
            if rel in problem_types[step.problem_type].files:
                print(f"  skipping file {rel}")
                print("    because it is provided by the problem type")
                continue
            if is_ignored(rel, patterns):
                print(f"  skipping file {rel}")
                print("    because it matches .gitignore pattern")
                continue

            contents = path.read_bytes()
            parts = rel.split("/", 1)
            if len(parts) == 2 and parts[0] == "_solution":
                solution[parts[1]] = contents
            elif len(parts) == 2 and parts[0] == "_starter":
                starter[parts[1]] = contents
            else:
                root[rel] = contents

        if solution and not starter:
            for name in list(solution.keys()):
                if name in root:
                    starter[name] = root.pop(name)
                    whitelist[name] = True
                elif name not in whitelist:
                    fail(f"found {name} in the solution, but no matching starter file")
            for name in whitelist:
                if name in root:
                    fail(f"found {name} outside the _solution directory")
        elif starter and not solution:
            for name in starter:
                whitelist[name] = True
            for name in whitelist:
                if name in root:
                    solution[name] = root.pop(name)
        elif starter and solution:
            for name in starter:
                whitelist[name] = True
            for name in whitelist:
                if name in root:
                    fail(f"found {name} outside the _solution and _starter directories")
        elif idx > 1:
            for name in whitelist:
                if name in root:
                    solution[name] = root.pop(name)
        else:
            fail("must have solution files and starter files")

        for name, contents in root.items():
            step.files[name] = contents
        for name, contents in starter.items():
            step.files[name] = contents

        step.whitelist.clear()
        for name in whitelist:
            step.whitelist[name] = True

        unused = dict(whitelist)
        for name, contents in solution.items():
            if name in whitelist:
                commit.files[name] = contents
                unused.pop(name, None)
            else:
                print(f"  warning: skipping solution file {name!r}")
                print("    because it is not in the starter file set of this or any previous step")

        if unused:
            lines = ["  example solution must include all files in the starter set"]
            if idx > 1:
                lines.append("  from this and previous steps")
            lines.extend(f"    solution is missing file {name}" for name in unused)
            fail("\n".join(lines) + "\nsolution rejected, please update and try again")

        unsigned.problem_steps.append(step)
        unsigned.commits.append(commit)
        print(
            f"  found {len(step.files)} problem definition file{plural(len(step.files))} "
            f"and {len(commit.files)} solution file{plural(len(commit.files))}"
        )

    if action:
        if not single and (step_dir == directory or step_num < 1):
            fail("to run an action, you must be in a step directory")
        problem_type = problem_types[steps[0].problem_type if single else steps[step_num - 1].problem_type]
        if action not in problem_type.actions:
            fail(f"action {action!r} does not exist for problem type {problem_type.name}")

    return unsigned, step_dir, step_num


def create_problem_set(config: Config, session: Session, path: Path, is_update: bool) -> None:
    now = grpc_time_now()
    cfg = parse_problem_set_cfg(path)

    problem_set = pb.ProblemSet(
        unique=cfg.unique,
        note=cfg.note,
        tags=cfg.tags,
    )
    _set_proto_timestamp(problem_set.created_at, now)
    _set_proto_timestamp(problem_set.updated_at, now)

    if path.name != problem_set.unique + ".cfg":
        fail("the problem set file name must match the problem set unique ID")

    bundle = pb.ProblemSetBundle(problem_set=problem_set)

    existing_resp = _rpc_call(
        config,
        "GetProblemSets",
        session.stub.GetProblemSets,
        pb.GetProblemSetsRequest(unique=problem_set.unique),
        grpc_metadata(config.cookie),
    )
    existing = list(existing_resp.problem_sets)
    if len(existing) == 0:
        if is_update:
            fail(f"you specified --update, but no existing problem set with unique ID {problem_set.unique!r} was found")
        print(f"unique ID is {problem_set.unique!r}")
        print("  this problem set is new--no existing problem set has the same unique ID")
    elif len(existing) == 1:
        if not is_update:
            fail(f"you did not specify --update, but a problem set already exists with unique ID {problem_set.unique!r}")
        print(f"unique ID is {problem_set.unique!r}")
        print(f"  this is an update of problem set {existing[0].id}")
        print(f"  ({existing[0].note!r})")
        problem_set.id = existing[0].id
        problem_set.created_at.CopyFrom(existing[0].created_at)
    else:
        fail(f"error: server found multiple problems with matching unique ID {problem_set.unique!r}")

    if not cfg.problems:
        fail("a problem set must contain at least one problem")

    for unique, weight in cfg.problems.items():
        response = _rpc_call(
            config,
            "GetProblems",
            session.stub.GetProblems,
            pb.GetProblemsRequest(unique=unique),
            grpc_metadata(config.cookie),
        )
        problems = list(response.problems)
        if not problems:
            fail(f"problem with unique ID {unique!r} not found")
        if len(problems) != 1:
            fail(f"error: server found multiple problems with matching unique ID {unique!r}")
        bundle.problem_set_problems.append(
            pb.ProblemSetProblem(problem_id=problems[0].id, weight=weight if weight > 0.0 else 1.0)
        )

    if bundle.problem_set.id == 0:
        final = _rpc_call(
            config,
            "PostProblemSetBundle",
            session.stub.PostProblemSetBundle,
            pb.PostProblemSetBundleRequest(bundle=bundle),
            grpc_metadata(config.cookie),
        )
        print(f"problem set {final.bundle.problem_set.unique!r} created and ready to use")
    else:
        final = _rpc_call(
            config,
            "PutProblemSetBundle",
            session.stub.PutProblemSetBundle,
            pb.PutProblemSetBundleRequest(bundle=bundle),
            grpc_metadata(config.cookie),
        )
        print(f"problem set {final.bundle.problem_set.unique!r} saved and ready to use")


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

        unsigned, step_dir, step_num = gather_author(config, session, now, is_update, action, Path("."))
        unsigned.user_id = session.user.id

        signed_resp = _rpc_call(
            config,
            "PostProblemBundleUnconfirmed",
            session.stub.PostProblemBundleUnconfirmed,
            pb.PostProblemBundleUnconfirmedRequest(bundle=unsigned),
            grpc_metadata(config.cookie),
        )
        signed = signed_resp.bundle

        if not signed.hostname:
            fail("server was unable to find a suitable daycare, unable to validate")

        if action:
            if step_num < 1:
                fail("to use --action, you must run from within a step directory")
            print(f"running interactive session for action {action!r} on step {step_num}")

            unvalidated = pb.CommitBundle(
                problem_type=signed.problem_types[signed.problem_steps[step_num - 1].problem_type],
                problem_type_signature=signed.problem_type_signatures[signed.problem_steps[step_num - 1].problem_type],
                problem=signed.problem,
                problem_steps=signed.problem_steps,
                problem_signature=signed.problem_signature,
                hostname=signed.hostname,
                user_id=signed.user_id,
                commit=signed.commits[step_num - 1],
                commit_signature=signed.commit_signatures[step_num - 1],
            )
            handle_daycare_stream(config, session, unvalidated, [], step_dir, True)
            return

        for n in range(len(signed.problem_steps)):
            print(f"validating solution for step {n + 1}")
            unvalidated = pb.CommitBundle(
                problem_type=signed.problem_types[signed.problem_steps[n].problem_type],
                problem_type_signature=signed.problem_type_signatures[signed.problem_steps[n].problem_type],
                problem=signed.problem,
                problem_steps=signed.problem_steps,
                problem_signature=signed.problem_signature,
                hostname=signed.hostname,
                user_id=signed.user_id,
                commit=signed.commits[n],
                commit_signature=signed.commit_signatures[n],
            )
            validated = handle_daycare_stream(config, session, unvalidated, [], Path(""), False)
            if validated is None:
                fail("the server ended the connection without sending a report card")
            print("  finished validating solution")
            if not validated.commit.HasField("report_card") or validated.commit.score != 1.0 or not validated.commit.report_card.passed:
                note = validated.commit.report_card.note if validated.commit.HasField("report_card") else ""
                print(f"  solution for step {n + 1} failed: {note}")
                print(dump_transcript(validated.commit), end="")
                fail("please fix solution and try again")

            signed.problem_types[validated.problem_type.name].CopyFrom(validated.problem_type)
            signed.problem_type_signatures[validated.problem_type.name] = validated.problem_type_signature
            signed.problem.CopyFrom(validated.problem)
            del signed.problem_steps[:]
            signed.problem_steps.extend(validated.problem_steps)
            signed.problem_signature = validated.problem_signature
            signed.commits[n].CopyFrom(validated.commit)
            signed.commit_signatures[n] = validated.commit_signature

        print("problem and solution confirmed successfully")

        if signed.problem.id == 0:
            final_resp = _rpc_call(
                config,
                "PostProblemBundleConfirmed",
                session.stub.PostProblemBundleConfirmed,
                pb.PostProblemBundleConfirmedRequest(bundle=signed),
                grpc_metadata(config.cookie),
            )
            final = final_resp.bundle
            print(f"problem {final.problem.unique!r} created and ready to use")
        else:
            final_resp = _rpc_call(
                config,
                "PutProblemBundle",
                session.stub.PutProblemBundle,
                pb.PutProblemBundleRequest(problem_id=signed.problem.id, bundle=signed),
                grpc_metadata(config.cookie),
            )
            final = final_resp.bundle
            print(f"problem {final.problem.unique!r} saved and ready to use")


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
