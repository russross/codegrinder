from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from shlex import quote

import codegrinder_pb2 as pb

from author_config import PROBLEM_CONFIG_NAME
from authoring import resolve_author_problem_layout
from command_support import managed_client
from errors import fail
from workspace_files import clean_relative_path, workspace_file_map


@dataclass(frozen=True, slots=True)
class ResolvedProblemType:
    problem_type: str
    directory: Path


def command_files(args: argparse.Namespace) -> None:
    resolved = _resolve_problem_type(args.problem_type)

    with managed_client(args) as env:
        if not env.session.user.is_admin:
            fail("you must be an admin to use this command")

        if not args.set_files:
            response = env.client.get_problem_type(resolved.problem_type)
            _print_file_statuses(resolved.directory, workspace_file_map(response.problem_type.files))
            return

        files = _collect_file_set(resolved.directory)
        env.client.save_problem_type_files(resolved.problem_type, files)
        print(f"set {len(files)} files for problem type: {resolved.problem_type}")


def command_problemtype(args: argparse.Namespace) -> None:
    with managed_client(args) as env:
        if not env.session.user.is_admin:
            fail("you must be an admin to use this command")

        match args.problemtype_command:
            case "list":
                _print_problem_type_list(list(env.client.get_problem_types().problem_types))
            case "show":
                response = env.client.get_problem_type(args.problem_type)
                _print_problem_type(response.problem_type)
            case "action-set":
                actions = _parse_action_specs(_action_specs_from_args(args))
                env.client.save_problem_type(args.problem_type, args.container, actions)
                print(f"set {len(actions)} actions for problem type: {args.problem_type}")
            case _:
                fail("unknown problemtype command")


def _resolve_problem_type(explicit_problem_type: str) -> ResolvedProblemType:
    if explicit_problem_type:
        return ResolvedProblemType(problem_type=explicit_problem_type, directory=Path("."))

    layout = resolve_author_problem_layout(Path("."))
    if layout is None:
        fail(f"you must supply --type or have a valid {PROBLEM_CONFIG_NAME} file already in place")
    if not layout.config.single_step_layout and layout.active_step_number < 1:
        fail("you must run this from within a step directory")
    problem_type = (
        layout.config.steps[0].problem_type
        if layout.config.single_step_layout
        else layout.config.steps[layout.active_step_number - 1].problem_type
    )
    return ResolvedProblemType(problem_type=problem_type, directory=layout.active_step_dir)


def _collect_file_set(directory: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for local_path in sorted(directory.rglob("*")):
        if ".git" in local_path.relative_to(directory).parts:
            continue
        if not local_path.is_file():
            continue
        path = clean_relative_path(local_path.relative_to(directory).as_posix()).as_posix()
        if path in files:
            fail(f"multiple local files resolve to {path!r}")
        files[path] = local_path.read_bytes()
    return files


def _print_file_statuses(directory: Path, server_files: dict[str, bytes]) -> None:
    if not server_files:
        print("no problem type files found")
        return
    for path, expected in sorted(server_files.items()):
        local_path = directory / Path(path)
        if not local_path.exists():
            status = "missing"
        elif local_path.read_bytes() == expected:
            status = "unchanged"
        else:
            status = "changed"
        print(f"{status}: {path}")


def _parse_action_specs(specs: list[str]) -> dict[str, pb.ProblemTypeAction]:
    actions: dict[str, pb.ProblemTypeAction] = {}
    for spec in specs:
        parts = spec.split("|")
        if len(parts) != 8:
            fail(
                "action must use: "
                "NAME|COMMAND|PARSER|MAX_CPU|MAX_FD|MAX_FILE_SIZE|MAX_MEMORY|MAX_THREADS"
            )
        action_name, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads = parts
        action_name = action_name.strip()
        if action_name == "":
            fail("action name is required")
        if action_name in actions:
            fail(f"multiple definitions for action {action_name!r}")
        actions[action_name] = pb.ProblemTypeAction(
            command=command,
            parser="" if parser == "none" else parser,
            max_cpu=_parse_int(max_cpu, label=f"{action_name} max_cpu"),
            max_fd=_parse_int(max_fd, label=f"{action_name} max_fd"),
            max_file_size=_parse_int(max_file_size, label=f"{action_name} max_file_size"),
            max_memory=_parse_int(max_memory, label=f"{action_name} max_memory"),
            max_threads=_parse_int(max_threads, label=f"{action_name} max_threads"),
        )
    return actions


def _action_specs_from_args(args: argparse.Namespace) -> list[str]:
    specs = list(args.actions)
    if args.actions_file:
        path = Path(args.actions_file)
        if not path.is_file():
            fail(f"actions file {args.actions_file!r} does not exist")
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped == "" or stripped.startswith("#"):
                continue
            specs.append(stripped)
    return specs


def _parse_int(value: str, *, label: str) -> int:
    try:
        return int(value)
    except ValueError:
        fail(f"{label} must be an integer")


def _print_problem_type_list(problem_types: list[pb.ProblemType]) -> None:
    if not problem_types:
        print("no problem types found")
        return
    width = max(len(problem_type.problem_type) for problem_type in problem_types)
    for problem_type in sorted(problem_types, key=lambda item: item.problem_type):
        actions = ", ".join(sorted(problem_type.actions.keys()))
        print(f"{problem_type.problem_type:<{width}}  container: {problem_type.container}  actions: {actions}")


def _print_problem_type(problem_type: pb.ProblemType) -> None:
    print(f"problem type: {problem_type.problem_type}")
    print(f"container:    {problem_type.container}")
    print("actions:")
    if not problem_type.actions:
        print("  none")
    else:
        for index, (action_name, action) in enumerate(sorted(problem_type.actions.items())):
            if index > 0:
                print()
            print(f"  {action_name}")
            _print_problem_type_action(action)
        print()
        print("action set command:")
        print("  grind problemtype action set \\")
        print(f"    --problem-type  {quote(problem_type.problem_type)} \\")
        print(f"    --container     {quote(problem_type.container)} \\")
        action_specs = [
            _action_spec(action_name, action)
            for action_name, action in sorted(problem_type.actions.items())
        ]
        for index, spec in enumerate(action_specs):
            suffix = " \\" if index < len(action_specs) - 1 else ""
            print(f"    --action        {quote(spec)}{suffix}")
        print()
    print("canonical files:")
    if not problem_type.files:
        print("  none")
    else:
        for path in sorted(problem_type.files.keys()):
            print(f"  {path}")


def _print_problem_type_action(action: pb.ProblemTypeAction) -> None:
    parser = action.parser or "none"
    print(f"    command:        {action.command}")
    print(f"    parser:         {parser}")
    print(f"    max_cpu:        {action.max_cpu}")
    print(f"    max_fd:         {action.max_fd}")
    print(f"    max_file_size:  {action.max_file_size}")
    print(f"    max_memory:     {action.max_memory}")
    print(f"    max_threads:    {action.max_threads}")


def _action_spec(action_name: str, action: pb.ProblemTypeAction) -> str:
    parser = action.parser or "none"
    return (
        f"{action_name}|{action.command}|{parser}|{action.max_cpu}|{action.max_fd}|"
        f"{action.max_file_size}|{action.max_memory}|{action.max_threads}"
    )
