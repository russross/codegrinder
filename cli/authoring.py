from __future__ import annotations

import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import codegrinder_pb2 as pb
import pathspec

from author_config import AuthorProblemConfig, PROBLEM_CONFIG_NAME, parse_author_problem_config, parse_author_problem_set_config
from errors import fail
from helpers import clean_error, plural
from rpc_client import CodeGrinderClient
from workspace_files import update_files


@dataclass(frozen=True, slots=True)
class AuthorProblemLayout:
    root_dir: Path
    active_step_dir: Path
    active_step_number: int
    config: AuthorProblemConfig


@dataclass(frozen=True, slots=True)
class PreparedAuthorStep:
    directory: Path
    problem_type_files: frozenset[str]


class ProblemTypeClient(Protocol):
    def get_problem_type(self, problem_type: str) -> pb.GetProblemTypeResponse: ...


def resolve_author_problem_layout(start_dir: Path) -> AuthorProblemLayout | None:
    directory = start_dir.resolve()
    step_dir = directory
    while not (directory / PROBLEM_CONFIG_NAME).exists():
        step_dir = directory
        parent = directory.parent
        if parent == directory:
            return None
        directory = parent

    config = parse_author_problem_config(directory / PROBLEM_CONFIG_NAME)
    if config.single_step_layout:
        step_num = 1
    elif step_dir != directory and step_dir.name.isdigit():
        n = int(step_dir.name)
        step_num = n if 1 <= n <= len(config.steps) else 0
    else:
        step_num = 0

    return AuthorProblemLayout(
        root_dir=directory,
        active_step_dir=step_dir,
        active_step_number=step_num,
        config=config,
    )


def prepare_author_steps(client: ProblemTypeClient, layout: AuthorProblemLayout) -> dict[int, PreparedAuthorStep]:
    prepared_steps: dict[int, PreparedAuthorStep] = {}
    for idx, step in enumerate(layout.config.steps, start=1):
        step_directory = layout.root_dir if layout.config.single_step_layout else layout.root_dir / str(idx)
        if not step_directory.is_dir():
            fail(f"missing step directory {step_directory}")

        print(f"refreshing problem type files for step {idx}")
        response = client.get_problem_type(step.problem_type)
        files = {str(Path(name)): contents for name, contents in response.problem_type.files.items()}
        update_files(step_directory, files, None, True)

        print(f"running make clean for step {idx}")
        try:
            subprocess.run(["make", "clean"], cwd=step_directory, check=True)
        except FileNotFoundError as exc:
            fail(f"error running make clean in {step_directory}: {clean_error(exc)}")
        except subprocess.CalledProcessError as exc:
            fail(f"error running make clean in {step_directory}: {clean_error(exc)}")

        prepared_steps[idx] = PreparedAuthorStep(
            directory=step_directory,
            problem_type_files=frozenset(files),
        )
    return prepared_steps


def _gitignore_spec(tree: dict[str, bytes]) -> pathspec.GitIgnoreSpec:
    lines: list[str] = []
    for path in sorted(tree.keys()):
        if Path(path).name != ".gitignore":
            continue
        parent = Path(path).parent.as_posix()
        prefix = "" if parent == "." else f"{parent}/"
        for raw_line in tree[path].decode("utf-8", errors="replace").splitlines():
            line = raw_line.rstrip("\r")
            if prefix and line.startswith("/"):
                lines.append(prefix + line[1:])
            elif prefix and line.startswith("!"):
                lines.append("!" + prefix + line[1:])
            elif prefix:
                lines.append(prefix + line)
            else:
                lines.append(line)
    return pathspec.GitIgnoreSpec.from_lines(lines)


def _filter_ignored_paths(tree: dict[str, bytes]) -> dict[str, bytes]:
    spec = _gitignore_spec(tree)
    return {
        path: content
        for path, content in tree.items()
        if not spec.match_file(path)
    }


def gather_author(
    action: str,
    start_dir: Path,
    prepared_steps: Mapping[int, PreparedAuthorStep] | None = None,
) -> tuple[pb.AuthorProblemDraft, Path, int]:
    layout = resolve_author_problem_layout(start_dir)
    if layout is None:
        fail(f"unable to find {PROBLEM_CONFIG_NAME} in current directory or one of its ancestors\n   you must run this in a problem directory")

    directory = layout.root_dir
    step_dir = layout.active_step_dir
    step_num = layout.active_step_number
    config = layout.config

    if config.single_step_layout and (directory / "1").is_dir():
        fail(
            f"{PROBLEM_CONFIG_NAME} is set up for a single-step problem with the step files in\n"
            f"  the same directory as {PROBLEM_CONFIG_NAME}, but there is also a directory named '1'\n"
            f"  Please add a [step \"1\"] entry to {PROBLEM_CONFIG_NAME} or move the step files\n"
            "  into the main directory and delete the '1' directory"
        )

    if directory.name != config.problem_id:
        fail("the problem directory name must match the problem unique ID")

    def report_whitespace_issues(path_label: str, content: bytes) -> None:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            return
        checks = [
            ("\r" in text, "non-Unix line endings"),
            (text != "" and not text.endswith("\n"), "missing final newline"),
            (any(line.endswith(" ") for line in text.splitlines()), "trailing spaces"),
        ]
        issues = [label for found, label in checks if found]
        if issues:
            print(f"warning: {path_label} has {', '.join(issues)}")

    def gather_step_tree(
        step_directory: Path,
        step_index: int,
        problem_type_files: frozenset[str],
    ) -> tuple[list[pb.AuthorFile], list[pb.AuthorFile]]:
        if not step_directory.is_dir():
            fail(f"missing step directory {step_directory}")
        authored_files: list[pb.AuthorFile] = []
        starter_files: list[pb.AuthorFile] = []
        all_paths = sorted(path for path in step_directory.rglob("*") if path.is_file() and ".git" not in path.parts)
        gathered_files = {
            rel_posix: path.read_bytes()
            for path in all_paths
            for rel_posix in [path.relative_to(step_directory).as_posix()]
            if not (config.single_step_layout and rel_posix == PROBLEM_CONFIG_NAME)
            if rel_posix not in problem_type_files
        }
        filtered_files = _filter_ignored_paths(gathered_files)
        for path in all_paths:
            rel = path.relative_to(step_directory)
            rel_posix = rel.as_posix()
            if rel_posix not in filtered_files:
                continue
            parts = rel.parts
            if parts[0] == "_solution":
                fail("the _solution authoring layout is not supported")
            content = filtered_files[rel_posix]
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
        problem_id=config.problem_id,
        problem_note=config.note,
        problem_tags=config.tags,
        problem_options=config.options,
    )

    for idx, step in enumerate(config.steps, start=1):
        print(f"gathering step {idx}")
        prepared = prepared_steps[idx] if prepared_steps and idx in prepared_steps else None
        step_directory = prepared.directory if prepared else directory if config.single_step_layout else directory / str(idx)
        authored_files, starter_files = gather_step_tree(
            step_directory,
            idx,
            prepared.problem_type_files if prepared else frozenset(),
        )
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

    if action and not config.single_step_layout and (step_dir == directory or step_num < 1):
        fail("to run an action, you must be in a step directory")

    return draft, step_dir, step_num


def save_problem_set(client: CodeGrinderClient, path: Path, is_update: bool) -> None:
    cfg = parse_author_problem_set_config(path)

    problem_set = pb.ProblemSet(
        problem_set_id=cfg.problem_set_id,
        problem_set_note=cfg.note,
        problem_set_tags=cfg.tags,
        continues_problem_set_id=cfg.continues_problem_set_id,
    )

    if path.name != problem_set.problem_set_id + ".cfg":
        fail("the problem set file name must match the problem set unique ID")

    bundle = pb.ProblemSetBundle(problem_set=problem_set)

    if not cfg.problems:
        fail("a problem set must contain at least one problem")

    for problem in cfg.problems:
        bundle.problem_set_problems.append(
            pb.ProblemSetProblem(
                problem_id=problem.problem_id,
                weight=problem.weight if problem.weight > 0.0 else 1.0,
                first_step=problem.first_step,
                last_step=problem.last_step,
            )
        )

    mode = pb.SAVE_MODE_UPDATE if is_update else pb.SAVE_MODE_CREATE
    final = client.save_problem_set(mode, bundle)
    verb = "saved" if is_update else "created"
    print(f"problem set {final.bundle.problem_set.problem_set_id!r} {verb} and ready to use")
