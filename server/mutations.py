from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any, Callable

import codegrinder_pb2 as pb
import pathspec
from google.protobuf.json_format import MessageToDict

from problem_files import ProblemStepFileType
from read_store import list_problem_type_pbs, load_problem_step_files, load_problem_type_files, load_problem_type_pb
from proto_conv import parse_time
from signatures import decode_signed_runtime_bundle, encode_signed_runtime_bundle

SIGNED_COMMIT_TIMEOUT = timedelta(minutes=15)


@dataclass(slots=True)
class SaveGradingCommitResult:
    bundle: pb.RuntimeBundle
    save_status: pb.CommitSaveStatus.ValueType


@dataclass(slots=True)
class SaveWorkspaceCommitResult:
    commit: pb.Commit
    save_status: pb.CommitSaveStatus.ValueType
    problem_note: str


@dataclass(slots=True)
class _SavedGradingCommit:
    commit: pb.Commit
    save_status: pb.CommitSaveStatus.ValueType
    step_context: sqlite3.Row
    action_name: str
    total_steps: int
    problem_options: list[str]


def _timestamp_now() -> datetime:
    return datetime.now(tz=UTC)


def _ts_to_dt(ts: object) -> datetime:
    if hasattr(ts, "ToDatetime"):
        dt = ts.ToDatetime(tzinfo=UTC)  # type: ignore[attr-defined]
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    return parse_time(ts)


def _set_ts(ts: object, value: datetime) -> None:
    ts.FromDatetime(value.astimezone(UTC))  # type: ignore[attr-defined]


def _rfc3339_round_sec(ts: datetime) -> str:
    return ts.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_load(raw: Any, fallback: Any) -> Any:
    if raw is None or raw == "":
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, bytes):
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            return fallback
    else:
        text = str(raw)
    if text.strip() == "":
        return fallback
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        return fallback
    if parsed is None:
        return fallback
    return parsed


def _require_positive_int_weight(value: float, label: str) -> int:
    if not float(value).is_integer():
        raise ValueError(f"{label} must be an integer")
    out = int(value)
    if out <= 0:
        raise ValueError(f"{label} must be greater than zero")
    return out


def _problem_to_row(problem: pb.Problem) -> tuple[str, str, str, str, str, str]:
    now = _timestamp_now()
    if not problem.HasField("created_at"):
        _set_ts(problem.created_at, now)
    _set_ts(problem.updated_at, now)
    return (
        problem.problem_id,
        problem.problem_note,
        json.dumps(list(problem.problem_tags)),
        json.dumps(list(problem.problem_options)),
        _rfc3339_round_sec(_ts_to_dt(problem.created_at)),
        _rfc3339_round_sec(_ts_to_dt(problem.updated_at)),
    )


def _create_default_problem_set(tx: sqlite3.Connection, problem: pb.Problem) -> None:
    now_sql = _rfc3339_round_sec(_timestamp_now())
    tags_json = json.dumps(list(problem.problem_tags))
    try:
        tx.execute(
            "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (problem.problem_id, problem.problem_note, tags_json, now_sql, now_sql),
        )
    except sqlite3.IntegrityError as exc:
        raise ValueError(f"problem set {problem.problem_id!r} already exists") from exc
    tx.execute(
        "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight) VALUES (?, ?, ?)",
        (problem.problem_id, problem.problem_id, 1),
    )


def _save_problem_step_files(
    tx: sqlite3.Connection,
    problem_id: str,
    step: int,
    file_type: ProblemStepFileType,
    files: dict[str, bytes],
) -> None:
    tx.execute(
        "DELETE FROM problem_step_files WHERE problem_id = ? AND step_number = ? AND file_type = ?",
        (problem_id, step, file_type.value),
    )
    for name in sorted(files.keys()):
        tx.execute(
            "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
            (problem_id, step, file_type.value, name, bytes(files[name] or b"")),
        )


def _commit_to_json_transcript(commit: pb.Commit) -> str:
    payload = [MessageToDict(event, preserving_proto_field_name=False) for event in commit.transcript]
    return json.dumps(payload, separators=(",", ":"))


def _report_card_to_json(report_card: pb.ReportCard | None) -> str:
    if report_card is None:
        return "null"
    duration = int(report_card.duration.seconds) * 1_000_000_000 + int(report_card.duration.nanos)
    data = {
        "passed": bool(report_card.passed),
        "note": str(report_card.note),
        "duration": duration,
        "results": [
            {
                "name": str(result.name),
                "outcome": str(result.outcome),
                "details": str(result.details),
                "context": str(result.context),
            }
            for result in report_card.results
        ],
    }
    return json.dumps(data, separators=(",", ":"))


@dataclass(slots=True)
class _UploadedEntry:
    content: bytes
    source: str


@dataclass(slots=True)
class _AuthorStepFiles:
    regular: dict[str, bytes]
    starter: dict[str, bytes]
    solution: dict[str, bytes]


def _normalize_rel_path(path: str, *, label: str) -> str:
    raw = path.strip()
    if raw == "":
        raise ValueError(f"{label} path must not be empty")
    if "\\" in raw:
        raise ValueError(f"{label} path must not contain backslashes: {path!r}")
    normalized = PurePosixPath(raw)
    if normalized.is_absolute():
        raise ValueError(f"{label} path must be relative: {path!r}")
    parts = normalized.parts
    if len(parts) == 0:
        raise ValueError(f"{label} path must not be empty")
    for part in parts:
        if part in ("", ".", ".."):
            raise ValueError(f"{label} path must not contain '.' or '..': {path!r}")
    return normalized.as_posix()


def _collect_author_files(files: list[pb.AuthorFile], *, label: str) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for entry in files:
        path = _normalize_rel_path(entry.path, label=label)
        out[path] = bytes(entry.content or b"")
    return out


def save_problem_type_files(
    tx: sqlite3.Connection,
    problem_type: str,
    files: dict[str, bytes],
) -> pb.ProblemType:
    problem_type_name = _clean_identifier(problem_type, label="problem type")

    cursor = tx.execute("SELECT 1 FROM problem_types WHERE problem_type = ?", (problem_type_name,))
    if cursor.fetchone() is None:
        raise ValueError(f"unknown problem type {problem_type_name!r}")

    normalized_paths: set[str] = set()
    prepared: list[tuple[str, bytes]] = []
    for raw_path, raw_content in files.items():
        path = _normalize_rel_path(raw_path, label="problem type file")
        if path in normalized_paths:
            raise ValueError(f"multiple changes for problem type file {path!r}")
        normalized_paths.add(path)
        prepared.append((path, bytes(raw_content or b"")))

    for path, content in prepared:
        tx.execute(
            "INSERT INTO problem_type_files(problem_type, path, content) VALUES (?, ?, ?) "
            "ON CONFLICT(problem_type, path) DO UPDATE SET content = excluded.content",
            (problem_type_name, path, content),
        )

    if normalized_paths:
        placeholders = ", ".join("?" for _ in normalized_paths)
        tx.execute(
            f"DELETE FROM problem_type_files WHERE problem_type = ? AND path NOT IN ({placeholders})",
            (problem_type_name, *sorted(normalized_paths)),
        )
    else:
        tx.execute("DELETE FROM problem_type_files WHERE problem_type = ?", (problem_type_name,))

    return load_problem_type_pb(tx, problem_type_name)


def save_problem_type(
    tx: sqlite3.Connection,
    problem_type: str,
    container: str,
    actions: dict[str, pb.ProblemTypeAction],
) -> list[pb.ProblemType]:
    problem_type_name = _clean_identifier(problem_type, label="problem type")
    container_name = container.strip()
    if container_name == "":
        raise ValueError(f"container is required for problem type {problem_type_name!r}")

    prepared_actions = _prepare_problem_type_actions(problem_type_name, actions)

    tx.execute(
        "INSERT INTO problem_types(problem_type, container) VALUES (?, ?) "
        "ON CONFLICT(problem_type) DO UPDATE SET container = excluded.container",
        (problem_type_name, container_name),
    )

    action_names = {action_name for action_name, _definition in prepared_actions}
    for action_name, definition in prepared_actions:
        tx.execute(
            "INSERT INTO problem_type_actions("
            "problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(problem_type, action) DO UPDATE SET "
            "command = excluded.command, "
            "parser = excluded.parser, "
            "max_cpu = excluded.max_cpu, "
            "max_fd = excluded.max_fd, "
            "max_file_size = excluded.max_file_size, "
            "max_memory = excluded.max_memory, "
            "max_threads = excluded.max_threads",
            _problem_type_action_row(problem_type_name, action_name, definition),
        )

    if action_names:
        placeholders = ", ".join("?" for _ in action_names)
        tx.execute(
            f"DELETE FROM problem_type_actions WHERE problem_type = ? AND action NOT IN ({placeholders})",
            (problem_type_name, *sorted(action_names)),
        )
    else:
        tx.execute("DELETE FROM problem_type_actions WHERE problem_type = ?", (problem_type_name,))

    return list_problem_type_pbs(tx)


def _prepare_problem_type_actions(
    problem_type_name: str,
    actions: dict[str, pb.ProblemTypeAction],
) -> list[tuple[str, pb.ProblemTypeAction]]:
    seen: set[str] = set()
    prepared: list[tuple[str, pb.ProblemTypeAction]] = []
    for raw_action_name, definition in actions.items():
        action_name = _clean_identifier(raw_action_name, label="problem type action")
        if action_name in seen:
            raise ValueError(f"multiple definitions for problem type action {problem_type_name!r}/{action_name!r}")
        seen.add(action_name)
        _validate_problem_type_action_definition(definition, label=f"{problem_type_name!r}/{action_name!r}")
        prepared.append((action_name, definition))
    return prepared


def _clean_identifier(value: str, *, label: str) -> str:
    cleaned = value.strip()
    if cleaned == "":
        raise ValueError(f"{label} is required")
    if cleaned != value:
        raise ValueError(f"{label} must not have leading or trailing whitespace: {value!r}")
    return cleaned


def _validate_problem_type_action_definition(action: pb.ProblemTypeAction, *, label: str) -> None:
    if action.command.strip() == "":
        raise ValueError(f"command is required for problem type action {label}")
    if action.command.strip() != action.command:
        raise ValueError(f"command must not have leading or trailing whitespace for problem type action {label}")
    if action.parser not in ("", "xunit", "check"):
        raise ValueError(f"parser must be empty, 'xunit', or 'check' for problem type action {label}")
    if action.max_cpu <= 0:
        raise ValueError(f"max-cpu must be greater than 0 for problem type action {label}")
    if action.max_fd <= 0:
        raise ValueError(f"max-fd must be greater than 0 for problem type action {label}")
    if action.max_file_size <= 0:
        raise ValueError(f"max-file-size must be greater than 0 for problem type action {label}")
    if action.max_memory < 0:
        raise ValueError(f"max-memory must be greater than or equal to 0 for problem type action {label}")
    if action.max_threads <= 0:
        raise ValueError(f"max-threads must be greater than 0 for problem type action {label}")


def _problem_type_action_row(
    problem_type_name: str,
    action_name: str,
    definition: pb.ProblemTypeAction,
) -> tuple[str, str, str, str | None, int, int, int, int, int]:
    return (
        problem_type_name,
        action_name,
        definition.command,
        None if definition.parser == "" else definition.parser,
        int(definition.max_cpu),
        int(definition.max_fd),
        int(definition.max_file_size),
        int(definition.max_memory),
        int(definition.max_threads),
    )


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


def _filter_ignored_entries(tree: dict[str, _UploadedEntry]) -> dict[str, _UploadedEntry]:
    filtered_paths = _filter_ignored_paths({path: entry.content for path, entry in tree.items()})
    return {
        path: entry
        for path, entry in tree.items()
        if path in filtered_paths
    }


def _filter_ignored_paths(tree: dict[str, bytes]) -> dict[str, bytes]:
    spec = _gitignore_spec(tree)
    return {
        path: content
        for path, content in tree.items()
        if not spec.match_file(path)
    }


def _build_problem_from_draft(draft: pb.AuthorProblemDraft) -> pb.Problem:
    if draft.problem_id.strip() == "":
        raise ValueError("problem_id is required")
    if draft.problem_note.strip() == "":
        raise ValueError("problem_note is required")
    problem = pb.Problem(
        problem_id=draft.problem_id,
        problem_note=draft.problem_note,
        problem_tags=list(draft.problem_tags),
        problem_options=list(draft.problem_options),
    )
    now = _timestamp_now()
    _set_ts(problem.created_at, now)
    _set_ts(problem.updated_at, now)
    return problem


def _build_effective_author_tree(
    step_draft: pb.AuthorProblemStepDraft,
    problem_type: pb.ProblemType,
    step_index: int,
) -> dict[str, _UploadedEntry]:
    uploaded_files = _collect_author_files(list(step_draft.files), label=f"step {step_index} file")
    starter_files = _collect_author_files(list(step_draft.starter_files), label=f"step {step_index} starter file")
    problem_type_files = {
        _normalize_rel_path(str(path), label=f"problem type {problem_type.problem_type} file"): bytes(content or b"")
        for path, content in dict(problem_type.files).items()
    }
    return _filter_ignored_entries(
        {
            **{path: _UploadedEntry(content=content, source="uploaded") for path, content in uploaded_files.items()},
            **{
                f"_starter/{path}": _UploadedEntry(content=content, source="starter")
                for path, content in starter_files.items()
            },
            **{
                path: _UploadedEntry(content=content, source="problem_type")
                for path, content in problem_type_files.items()
            },
        }
    )


def _partition_author_step_files(
    *,
    filtered_tree: dict[str, _UploadedEntry],
    problem_type: pb.ProblemType,
    prior_solution_paths: set[str],
    step_index: int,
) -> _AuthorStepFiles:
    starter_files: dict[str, bytes] = {}
    for path, entry in filtered_tree.items():
        if entry.source != "starter":
            continue
        logical_path = _normalize_rel_path(path.removeprefix("_starter/"), label=f"step {step_index} starter file")
        if logical_path in problem_type.files:
            raise ValueError(
                f"step {step_index} starter file {logical_path!r} conflicts with problem type file {logical_path!r}"
            )
        starter_files[logical_path] = entry.content

    student_owned_paths = prior_solution_paths | set(starter_files.keys())
    solution_files: dict[str, bytes] = {}
    regular_files: dict[str, bytes] = {}
    for path, entry in filtered_tree.items():
        if entry.source != "uploaded":
            continue
        if path in student_owned_paths:
            solution_files[path] = entry.content
        else:
            regular_files[path] = entry.content

    missing = [path for path in sorted(student_owned_paths) if path not in solution_files]
    if missing:
        lines = [f"step {step_index} solution is missing required student files:"]
        lines.extend(f"  {path}" for path in missing)
        raise ValueError("\n".join(lines))

    return _AuthorStepFiles(regular=regular_files, starter=starter_files, solution=solution_files)


def prepare_problem(
    tx: sqlite3.Connection,
    current_user_id: str,
    draft: pb.AuthorProblemDraft,
    action: str,
    daycare_secret: str,
    assign_host: Callable[[set[str]], str],
) -> pb.ProblemBundle:
    if len(draft.steps) == 0:
        raise ValueError("problem draft must include at least one step")
    problem = _build_problem_from_draft(draft)
    bundle = pb.ProblemBundle(problem=problem, user_id=current_user_id)
    bundle.hostname = assign_host({step.problem_type for step in draft.steps})
    prior_solution_paths: set[str] = set()
    now = _timestamp_now()
    effective_action = "grade" if action == "" else action

    for index, step_draft in enumerate(draft.steps, start=1):
        if int(step_draft.step_number) != index:
            raise ValueError(f"expected step {index}, found {int(step_draft.step_number)}")
        if step_draft.problem_type.strip() == "":
            raise ValueError(f"step {index} problem type is required")
        step_note = str(step_draft.note)
        weight = float(step_draft.weight)
        step_weight = _require_positive_int_weight(weight, f"step {index} weight")

        problem_type = load_problem_type_pb(tx, step_draft.problem_type)
        bundle.problem_types[problem_type.problem_type].CopyFrom(problem_type)

        filtered_tree = _build_effective_author_tree(step_draft, problem_type, index)
        files = _partition_author_step_files(
            filtered_tree=filtered_tree,
            problem_type=problem_type,
            prior_solution_paths=prior_solution_paths,
            step_index=index,
        )

        step = pb.ProblemStep(
            problem_id=problem.problem_id,
            step=index,
            problem_type=problem_type.problem_type,
            note=step_note,
            weight=float(step_weight),
            files=files.regular,
            starter_files=files.starter,
            whitelist={path: True for path in sorted(files.solution)},
        )
        bundle.problem_steps.append(step)
        prior_solution_paths = set(files.solution)

        commit = pb.Commit(
            step=index,
            action=effective_action,
            note="author solution submitted via grind"
            if action == ""
            else f"author solution tested with action {action} via grind",
            problem_id=problem.problem_id,
            files=files.solution,
        )
        _set_ts(commit.created_at, now)
        _set_ts(commit.updated_at, now)
        bundle.solution_commits.append(commit)

    del bundle.signed_validation_bundles[:]
    for index, commit in enumerate(bundle.solution_commits):
        grading_commit = _grading_commit_from_problem_bundle(bundle=bundle, step_index=index, commit=commit)
        bundle.signed_validation_bundles.append(encode_signed_runtime_bundle(grading_commit, daycare_secret))
    return bundle


def _bytes_map(value: Any) -> dict[str, bytes]:
    return {str(path): bytes(content or b"") for path, content in dict(value).items()}


def _require_validated_solution_commit(
    *,
    current_user_id: str,
    daycare_secret: str,
    bundle: pb.ProblemBundle,
    step_index: int,
) -> pb.Commit:
    step_number = step_index + 1
    solution_commit = bundle.solution_commits[step_index]
    signed = bundle.signed_validation_bundles[step_index]
    runtime = decode_signed_runtime_bundle(signed, daycare_secret)
    expected_runtime = _grading_commit_from_problem_bundle(
        bundle=bundle,
        step_index=step_index,
        commit=solution_commit,
    )
    validated = runtime.commit

    if runtime.user_id != current_user_id:
        raise ValueError(f"step {step_number} validation user mismatch")
    if runtime.problem_id != bundle.problem.problem_id:
        raise ValueError(f"step {step_number} validation problem mismatch")
    if int(runtime.step_number) != step_number:
        raise ValueError(f"step {step_number} validation step mismatch")
    if int(runtime.total_steps) != len(bundle.problem_steps):
        raise ValueError(f"step {step_number} validation total step mismatch")
    if runtime.action != "grade" or validated.action != "grade":
        raise ValueError(f"step {step_number} validation must be a grade action")
    if validated.problem_id != bundle.problem.problem_id:
        raise ValueError(f"step {step_number} validated commit problem mismatch")
    if int(validated.step) != step_number:
        raise ValueError(f"step {step_number} validated commit step mismatch")
    if _bytes_map(validated.files) != _bytes_map(solution_commit.files):
        raise ValueError(f"step {step_number} validated solution files mismatch")
    if _bytes_map(runtime.files) != _bytes_map(expected_runtime.files):
        raise ValueError(f"step {step_number} validated runtime files mismatch")
    if _bytes_map(runtime.starter_files) != _bytes_map(bundle.problem_steps[step_index].starter_files):
        raise ValueError(f"step {step_number} validated starter files mismatch")
    if not validated.HasField("report_card"):
        raise ValueError(f"step {step_number} validation has no report card")
    if not validated.report_card.passed or validated.score != 1.0:
        raise ValueError(f"step {step_number} solution did not pass validation")
    return validated


def save_problem(
    tx: sqlite3.Connection,
    current_user_id: str,
    daycare_secret: str,
    mode: pb.SaveMode.ValueType,
    bundle: pb.ProblemBundle,
) -> pb.ProblemBundle:
    if bundle.user_id != current_user_id:
        raise ValueError("bundle must include user's ID")
    if bundle.problem.problem_id == "":
        raise ValueError("problem_id is required")
    if len(bundle.problem_steps) == 0:
        raise ValueError("problem must include at least one step")
    if len(bundle.solution_commits) != len(bundle.problem_steps):
        raise ValueError("problem must include one solution commit per step")
    if len(bundle.signed_validation_bundles) != len(bundle.problem_steps):
        raise ValueError("problem must include one signed validation bundle per step")
    if mode == pb.SAVE_MODE_UNSPECIFIED:
        raise ValueError("save mode is required")
    validated_commits = [
        _require_validated_solution_commit(
            current_user_id=current_user_id,
            daycare_secret=daycare_secret,
            bundle=bundle,
            step_index=idx,
        )
        for idx in range(len(bundle.problem_steps))
    ]
    values = _problem_to_row(bundle.problem)
    match mode:
        case pb.SAVE_MODE_CREATE:
            try:
                tx.execute(
                    "INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    values,
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError(f"problem {bundle.problem.problem_id!r} already exists") from exc
        case pb.SAVE_MODE_UPDATE:
            updated = tx.execute(
                "UPDATE problems SET problem_note = ?, problem_tags = ?, problem_options = ?, problem_updated_at = ? "
                "WHERE problem_id = ? RETURNING problem_created_at",
                (values[1], values[2], values[3], values[5], values[0]),
            )
            row = updated.fetchone()
            if row is None:
                raise ValueError(f"problem {bundle.problem.problem_id!r} does not exist")
            _set_ts(bundle.problem.created_at, parse_time(row["problem_created_at"]))
        case _:
            raise ValueError("save mode is required")

    for idx, step in enumerate(bundle.problem_steps, start=1):
        step.problem_id = bundle.problem.problem_id
        step.step = idx
        step_weight = _require_positive_int_weight(float(step.weight), f"step {idx} weight")
        existing = tx.execute(
            "UPDATE problem_steps SET problem_type = ?, step_note = ?, step_weight = ? "
            "WHERE problem_id = ? AND step_number = ?",
            (
                step.problem_type,
                step.note,
                step_weight,
                step.problem_id,
                step.step,
            ),
        )
        if existing.rowcount == 0:
            tx.execute(
                "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    step.problem_id,
                    step.step,
                    step.problem_type,
                    step.note,
                    step_weight,
                ),
            )
        commit = validated_commits[idx - 1]
        if int(commit.step) != idx:
            raise ValueError(f"commit step mismatch for step {idx}")
        _save_problem_step_files(tx, step.problem_id, step.step, ProblemStepFileType.REGULAR, dict(step.files))
        _save_problem_step_files(tx, step.problem_id, step.step, ProblemStepFileType.STARTER, dict(step.starter_files))
        _save_problem_step_files(tx, step.problem_id, step.step, ProblemStepFileType.SOLUTION, dict(commit.files))

    tx.execute(
        "DELETE FROM problem_steps WHERE problem_id = ? AND step_number > ?",
        (bundle.problem.problem_id, len(bundle.problem_steps)),
    )
    if mode == pb.SAVE_MODE_CREATE:
        _create_default_problem_set(tx, bundle.problem)
    return bundle


def save_problem_set(
    tx: sqlite3.Connection,
    mode: pb.SaveMode.ValueType,
    bundle: pb.ProblemSetBundle,
) -> pb.ProblemSetBundle:
    pset = bundle.problem_set
    if pset.problem_set_id == "":
        raise ValueError("problem_set_id is required")
    if mode == pb.SAVE_MODE_UNSPECIFIED:
        raise ValueError("save mode is required")
    _validate_problem_set_slice(tx, bundle)
    now_sql = _rfc3339_round_sec(_timestamp_now())
    tags_json = json.dumps(list(pset.problem_set_tags))
    continues_problem_set_id = pset.continues_problem_set_id or None
    match mode:
        case pb.SAVE_MODE_CREATE:
            try:
                tx.execute(
                    "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, continues_problem_set_id, problem_set_created_at, problem_set_updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (pset.problem_set_id, pset.problem_set_note, tags_json, continues_problem_set_id, now_sql, now_sql),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError(f"problem set {pset.problem_set_id!r} already exists") from exc
        case pb.SAVE_MODE_UPDATE:
            updated = tx.execute(
                "UPDATE problem_sets SET problem_set_note = ?, problem_set_tags = ?, continues_problem_set_id = ?, problem_set_updated_at = ? WHERE problem_set_id = ?",
                (pset.problem_set_note, tags_json, continues_problem_set_id, now_sql, pset.problem_set_id),
            )
            if updated.rowcount == 0:
                raise ValueError(f"problem set {pset.problem_set_id!r} does not exist")
        case _:
            raise ValueError("save mode is required")

    tx.execute("DELETE FROM problem_set_problems WHERE problem_set_id = ?", (pset.problem_set_id,))
    seen_problem_ids: set[str] = set()
    for psp in bundle.problem_set_problems:
        psp.problem_set_id = pset.problem_set_id
        if psp.problem_id in seen_problem_ids:
            raise ValueError(f"problem {psp.problem_id!r} listed more than once")
        seen_problem_ids.add(psp.problem_id)
        problem_weight = _require_positive_int_weight(float(psp.weight), f"problem {psp.problem_id} weight")
        first_step = int(psp.first_step) if int(psp.first_step) > 0 else None
        last_step = int(psp.last_step) if int(psp.last_step) > 0 else None
        try:
            tx.execute(
                "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step) VALUES (?, ?, ?, ?, ?)",
                (psp.problem_set_id, psp.problem_id, problem_weight, first_step, last_step),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"problem {psp.problem_id!r} does not exist") from exc
    return bundle


def _validate_problem_set_slice(tx: sqlite3.Connection, bundle: pb.ProblemSetBundle) -> None:
    pset = bundle.problem_set
    problems = list(bundle.problem_set_problems)
    sliced = [problem for problem in problems if int(problem.first_step) > 0 or int(problem.last_step) > 0]
    if pset.continues_problem_set_id and not sliced:
        raise ValueError("continues_problem_set_id requires a sliced problem set")
    if not sliced:
        return
    if len(problems) != 1 or len(sliced) != 1:
        raise ValueError("step slicing is only supported for unary problem sets")
    problem = sliced[0]
    first_step = int(problem.first_step)
    last_step = int(problem.last_step)
    if first_step <= 0 or last_step <= 0:
        raise ValueError("sliced problem sets require first_step and last_step")
    if last_step < first_step:
        raise ValueError("last_step must be greater than or equal to first_step")
    max_step_row = tx.execute("SELECT MAX(step_number) AS max_step FROM problem_steps WHERE problem_id = ?", (problem.problem_id,)).fetchone()
    max_step = int(max_step_row["max_step"] or 0) if max_step_row is not None else 0
    if max_step == 0:
        raise ValueError(f"problem {problem.problem_id!r} does not exist")
    if last_step > max_step:
        raise ValueError(f"slice ends after final step for problem {problem.problem_id!r}")
    if first_step == 1:
        if pset.continues_problem_set_id:
            raise ValueError("first slice must not continue another problem set")
        return
    if not pset.continues_problem_set_id:
        raise ValueError("sliced problem sets after step 1 require continues_problem_set_id")
    previous = tx.execute(
        "SELECT problem_set_problems.problem_id, problem_set_problems.first_step, problem_set_problems.last_step "
        "FROM problem_set_problems "
        "WHERE problem_set_problems.problem_set_id = ?",
        (pset.continues_problem_set_id,),
    ).fetchall()
    if len(previous) != 1:
        raise ValueError("continued problem set must be a unary sliced problem set")
    previous_problem = previous[0]
    if str(previous_problem["problem_id"]) != problem.problem_id:
        raise ValueError("continued problem set must use the same problem")
    if previous_problem["first_step"] is None or previous_problem["last_step"] is None:
        raise ValueError("continued problem set must be sliced")
    if int(previous_problem["last_step"]) != first_step - 1:
        raise ValueError("continued problem set must end at the previous step")


def _save_commit_files(
    tx: sqlite3.Connection,
    user_id: str,
    course_id: str,
    problem_set_id: str,
    problem_id: str,
    step: int,
    files: dict[str, bytes],
) -> None:
    tx.execute(
        "DELETE FROM commit_files WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
        (user_id, course_id, problem_set_id, problem_id, step),
    )
    for name in sorted(files):
        tx.execute(
            "INSERT INTO commit_files(user_id, course_id, problem_set_id, problem_id, step_number, path, content) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, course_id, problem_set_id, problem_id, step, name, bytes(files[name] or b"")),
        )


def _runtime_limits_from_action(action: pb.ProblemTypeAction) -> pb.RuntimeLimits:
    return pb.RuntimeLimits(
        max_cpu=int(action.max_cpu),
        max_fd=int(action.max_fd),
        max_file_size=int(action.max_file_size),
        max_memory=int(action.max_memory),
        max_threads=int(action.max_threads),
    )


def _runtime_bundle_from_parts(
    *,
    hostname: str,
    user_id: str,
    assignment: pb.AssignmentKey,
    problem_id: str,
    problem_note: str,
    problem_options: list[str],
    step_number: int,
    total_steps: int,
    action_name: str,
    action: pb.ProblemTypeAction,
    container: str,
    files: dict[str, bytes],
    commit: pb.Commit,
    starter_files: dict[str, bytes] | None = None,
) -> pb.RuntimeBundle:
    return pb.RuntimeBundle(
        hostname=hostname,
        user_id=user_id,
        assignment=assignment,
        problem_id=problem_id,
        problem_note=problem_note,
        problem_options=problem_options,
        step_number=step_number,
        total_steps=total_steps,
        action=action_name,
        container=container,
        command=action.command,
        parser=action.parser,
        limits=_runtime_limits_from_action(action),
        files=files,
        commit=commit,
        starter_files={} if starter_files is None else starter_files,
    )


def _load_assignment_commit_policy(
    tx: sqlite3.Connection,
    current_user_id: str,
    assignment: pb.AssignmentKey,
    ip_allowed: bool,
) -> sqlite3.Row:
    row = tx.execute(
        "SELECT * FROM accessible_assignment_commit_policy "
        "WHERE viewer_user_id = ? AND assignment_user_id = ? AND course_id = ? AND problem_set_id = ? "
        "AND (? OR NOT restricted)",
        (
            current_user_id,
            assignment.user_id,
            assignment.course_id,
            assignment.problem_set_id,
            1 if ip_allowed else 0,
        ),
    ).fetchone()
    if row is None:
        raise sqlite3.Error("not found")
    return row


def _commit_save_status(policy: sqlite3.Row) -> pb.CommitSaveStatus.ValueType:
    match (bool(policy["not_saved_locked"]), bool(policy["not_saved_not_owner"])):
        case (True, _):
            return pb.COMMIT_SAVE_STATUS_NOT_SAVED_LOCKED
        case (False, True):
            return pb.COMMIT_SAVE_STATUS_NOT_SAVED_NOT_OWNER
        case _:
            return pb.COMMIT_SAVE_STATUS_SAVED


def _load_grading_step_context(tx: sqlite3.Connection, commit: pb.Commit) -> sqlite3.Row:
    row = tx.execute(
        "SELECT * FROM grading_step_context "
        "WHERE problem_set_id = ? AND problem_id = ? AND step_number = ?",
        (commit.assignment.problem_set_id, commit.problem_id, int(commit.step)),
    ).fetchone()
    if row is None:
        raise sqlite3.Error("not found")
    return row


def _normalize_commit_files(files: dict[str, bytes]) -> dict[str, bytes]:
    return {_normalize_rel_path(str(path), label="commit file"): bytes(content or b"") for path, content in files.items()}


def _require_student_owned_files(commit_files: dict[str, bytes], step_context: sqlite3.Row) -> None:
    whitelist = _json_load(step_context["whitelist"], {})
    allowed_paths = {str(k) for k, v in whitelist.items() if bool(v)} if isinstance(whitelist, dict) else set()
    unexpected_paths = sorted(set(commit_files) - allowed_paths)
    if unexpected_paths:
        raise ValueError("commit includes non-student-owned files: " + ", ".join(unexpected_paths))


def _replace_commit_files(commit: pb.Commit, files: dict[str, bytes]) -> None:
    commit.files.clear()
    commit.files.update(files)


def _problem_type_actions_pb(action_rows: list[sqlite3.Row]) -> dict[str, pb.ProblemTypeAction]:
    return {
        str(row["action"]): pb.ProblemTypeAction(
            command=str(row["command"]),
            parser=str(row["parser"] or ""),
            max_cpu=int(row["max_cpu"]),
            max_fd=int(row["max_fd"]),
            max_file_size=int(row["max_file_size"]),
            max_memory=int(row["max_memory"]),
            max_threads=int(row["max_threads"]),
        )
        for row in action_rows
    }


def _save_grading_commit(
    tx: sqlite3.Connection,
    current_user_id: str,
    bundle: pb.GradingCommit,
    ip_allowed: bool,
    graded: bool,
) -> _SavedGradingCommit:
    if bundle.user_id != current_user_id:
        raise ValueError("bundle must include user's ID")
    commit = bundle.commit
    policy = _load_assignment_commit_policy(tx, current_user_id, commit.assignment, ip_allowed)
    save_status = _commit_save_status(policy)
    step_context = _load_grading_step_context(tx, commit)
    commit_files = _normalize_commit_files(dict(commit.files))
    _require_student_owned_files(commit_files, step_context)
    _replace_commit_files(commit, commit_files)

    now = _timestamp_now()
    if not commit.HasField("created_at"):
        _set_ts(commit.created_at, now)
    _set_ts(commit.updated_at, now)

    action_name = commit.action
    if not graded:
        commit.action = ""

    if bool(policy["can_save_commit"]):
        tx.execute(
            "INSERT OR REPLACE INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                commit.assignment.user_id,
                commit.assignment.course_id,
                commit.assignment.problem_set_id,
                commit.problem_id,
                int(commit.step),
                commit.action,
                commit.note,
                _commit_to_json_transcript(commit),
                _report_card_to_json(commit.report_card if commit.HasField("report_card") else None),
                commit.score,
                _rfc3339_round_sec(_ts_to_dt(commit.created_at)),
                _rfc3339_round_sec(_ts_to_dt(commit.updated_at)),
            ),
        )
        _save_commit_files(
            tx,
            commit.assignment.user_id,
            commit.assignment.course_id,
            commit.assignment.problem_set_id,
            commit.problem_id,
            int(commit.step),
            commit_files,
        )
    commit.action = action_name

    total_steps = max(1, int(step_context["total_steps"] or 0))
    problem_options_raw = _json_load(step_context["problem_options"], [])
    problem_options = [str(v) for v in problem_options_raw] if isinstance(problem_options_raw, list) else []
    saved_commit = pb.Commit()
    saved_commit.CopyFrom(commit)
    return _SavedGradingCommit(
        commit=saved_commit,
        save_status=save_status,
        step_context=step_context,
        action_name=action_name,
        total_steps=total_steps,
        problem_options=problem_options,
    )


def _commit_metadata_bundle(bundle: pb.GradingCommit, saved: _SavedGradingCommit) -> pb.RuntimeBundle:
    return pb.RuntimeBundle(
        user_id=bundle.user_id,
        assignment=saved.commit.assignment,
        problem_id=saved.commit.problem_id,
        problem_note=str(saved.step_context["problem_note"]),
        problem_options=saved.problem_options,
        step_number=int(saved.commit.step),
        total_steps=saved.total_steps,
        commit=saved.commit,
    )


def _runtime_bundle_for_commit(
    tx: sqlite3.Connection,
    bundle: pb.GradingCommit,
    saved: _SavedGradingCommit,
    assign_host: Callable[[set[str]], str],
) -> SaveGradingCommitResult:
    if saved.action_name == "":
        return SaveGradingCommitResult(bundle=_commit_metadata_bundle(bundle, saved), save_status=saved.save_status)

    step_context = saved.step_context
    actions = _problem_type_actions_pb(
        tx.execute("SELECT * FROM problem_type_actions WHERE problem_type = ?", (step_context["problem_type"],)).fetchall()
    )
    runtime_action_name = saved.action_name
    runtime_action = actions.get(runtime_action_name)
    if runtime_action is None:
        raise ValueError(f'action "{runtime_action_name}" not defined for problem type {step_context["problem_type"]}')

    runtime_files = (
        load_problem_type_files(tx, str(step_context["problem_type"]))
        | load_problem_step_files(tx, saved.commit.problem_id, int(saved.commit.step), ProblemStepFileType.REGULAR)
        | dict(saved.commit.files)
    )
    runtime_hostname = bundle.hostname or assign_host({str(step_context["problem_type"])})
    runtime_commit = pb.Commit()
    runtime_commit.CopyFrom(saved.commit)
    runtime_commit.action = runtime_action_name
    return SaveGradingCommitResult(
        save_status=saved.save_status,
        bundle=_runtime_bundle_from_parts(
            hostname=runtime_hostname,
            user_id=bundle.user_id,
            assignment=saved.commit.assignment,
            problem_id=saved.commit.problem_id,
            problem_note=str(step_context["problem_note"]),
            problem_options=saved.problem_options,
            step_number=int(saved.commit.step),
            total_steps=saved.total_steps,
            action_name=runtime_action_name,
            action=runtime_action,
            container=str(step_context["container"]),
            files=runtime_files,
            commit=runtime_commit,
        ),
    )


def save_ungraded_commit(
    tx: sqlite3.Connection,
    current_user_id: str,
    bundle: pb.GradingCommit,
    ip_allowed: bool,
    assign_host: Callable[[set[str]], str],
) -> SaveGradingCommitResult:
    saved = _save_grading_commit(tx, current_user_id, bundle, ip_allowed, graded=False)
    return _runtime_bundle_for_commit(tx, bundle, saved, assign_host)


def save_workspace_commit(
    tx: sqlite3.Connection,
    current_user_id: str,
    commit: pb.Commit,
    ip_allowed: bool,
) -> SaveWorkspaceCommitResult:
    if commit.action != "":
        raise ValueError("workspace commit action must be empty")
    working = pb.Commit()
    working.CopyFrom(commit)
    del working.transcript[:]
    working.ClearField("report_card")
    working.score = 0.0
    grading = pb.GradingCommit(user_id=current_user_id, commit=working)
    saved = _save_grading_commit(tx, current_user_id, grading, ip_allowed, graded=False)
    return SaveWorkspaceCommitResult(
        commit=saved.commit,
        save_status=saved.save_status,
        problem_note=str(saved.step_context["problem_note"]),
    )


def save_graded_runtime_bundle(
    tx: sqlite3.Connection,
    current_user_id: str,
    runtime: pb.RuntimeBundle,
    ip_allowed: bool,
) -> SaveGradingCommitResult:
    grading = pb.GradingCommit(user_id=runtime.user_id, hostname=runtime.hostname, commit=runtime.commit)
    saved = _save_grading_commit(tx, current_user_id, grading, ip_allowed, graded=True)
    runtime.commit.CopyFrom(saved.commit)
    return SaveGradingCommitResult(bundle=runtime, save_status=saved.save_status)


def _grading_commit_from_problem_bundle(
    *,
    bundle: pb.ProblemBundle,
    step_index: int,
    commit: pb.Commit,
) -> pb.RuntimeBundle:
    step = bundle.problem_steps[step_index]
    problem_type = bundle.problem_types[step.problem_type]
    runtime_action_name = commit.action if commit.action != "" else "grade"
    action = problem_type.actions.get(runtime_action_name)
    if action is None:
        raise ValueError(f'action "{runtime_action_name}" not defined for problem type {problem_type.problem_type}')
    runtime_files = _bytes_map(problem_type.files) | _bytes_map(step.files) | _bytes_map(commit.files)
    runtime_commit = pb.Commit()
    runtime_commit.CopyFrom(commit)
    runtime_commit.problem_id = bundle.problem.problem_id
    runtime_commit.step = step.step
    runtime_commit.action = runtime_action_name
    return _runtime_bundle_from_parts(
        hostname=bundle.hostname,
        user_id=bundle.user_id,
        assignment=runtime_commit.assignment,
        problem_id=bundle.problem.problem_id,
        problem_note=bundle.problem.problem_note,
        problem_options=list(bundle.problem.problem_options),
        step_number=int(step.step),
        total_steps=len(bundle.problem_steps),
        action_name=runtime_action_name,
        action=action,
        container=problem_type.container,
        files=runtime_files,
        commit=runtime_commit,
        starter_files=_bytes_map(step.starter_files),
    )
