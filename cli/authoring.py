from __future__ import annotations

from pathlib import Path

import codegrinder_pb2 as pb

from author_config import PROBLEM_CONFIG_NAME, parse_author_problem_config, parse_author_problem_set_config
from errors import fail
from helpers import grpc_metadata, grpc_time_now, plural
from models import Config


def _set_proto_timestamp(target: object, now) -> None:
    seconds = int(now.timestamp())
    nanos = int((now.timestamp() - seconds) * 1_000_000_000)
    setattr(target, "seconds", seconds)
    setattr(target, "nanos", nanos)


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

    cfg = parse_author_problem_config(directory / PROBLEM_CONFIG_NAME)
    problem = pb.Problem(
        problem_id=cfg.problem_id,
        problem_note=cfg.note,
        problem_tags=cfg.tags,
        problem_options=cfg.options,
    )
    _set_proto_timestamp(problem.created_at, now)
    _set_proto_timestamp(problem.updated_at, now)

    single = cfg.single_step_layout
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


def save_problem_set(config: Config, session, rpc_call, path: Path, is_update: bool) -> None:
    now = grpc_time_now()
    cfg = parse_author_problem_set_config(path)

    problem_set = pb.ProblemSet(
        problem_set_id=cfg.problem_set_id,
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
        bundle.problem_set_problems.append(
            pb.ProblemSetProblem(problem_id=unique, weight=weight if weight > 0.0 else 1.0)
        )

    mode = pb.SAVE_MODE_UPDATE if is_update else pb.SAVE_MODE_CREATE
    final = rpc_call(
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
