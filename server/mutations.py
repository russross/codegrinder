from __future__ import annotations

import fnmatch
import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import Any, Callable

import codegrinder_pb2 as pb
from google.protobuf.json_format import MessageToDict

from problem_files import ProblemStepFileType
from proto_conv import parse_time
from signatures import encode_signed_grading_commit

SIGNED_COMMIT_TIMEOUT = timedelta(minutes=15)


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
class _IgnoreRule:
    base_dir: str
    pattern: str
    anchored: bool
    directory_only: bool


def _normalize_rel_path(path: str, *, label: str) -> str:
    raw = path.strip()
    if raw == "":
        raise ValueError(f"{label} path must not be empty")
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


def _parse_ignore_rules(tree: dict[str, _UploadedEntry]) -> list[_IgnoreRule]:
    rules: list[_IgnoreRule] = []
    for path in sorted(tree.keys()):
        if PurePosixPath(path).name != ".gitignore":
            continue
        base_dir = PurePosixPath(path).parent.as_posix()
        if base_dir == ".":
            base_dir = ""
        text = tree[path].content.decode("utf-8", errors="replace")
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if line == "" or line.startswith("#"):
                continue
            anchored = line.startswith("/")
            if anchored:
                line = line[1:]
            directory_only = line.endswith("/")
            if directory_only:
                line = line[:-1]
            if line == "":
                continue
            rules.append(_IgnoreRule(base_dir=base_dir, pattern=line, anchored=anchored, directory_only=directory_only))
    return rules


def _relative_to_base(path: str, base_dir: str) -> str | None:
    if base_dir == "":
        return path
    if path == base_dir:
        return ""
    prefix = base_dir + "/"
    if not path.startswith(prefix):
        return None
    return path[len(prefix) :]


def _match_ignore_rule(rule: _IgnoreRule, path: str) -> bool:
    rel_path = _relative_to_base(path, rule.base_dir)
    if rel_path is None or rel_path == "":
        return False
    rel_obj = PurePosixPath(rel_path)
    candidate_paths = [rel_obj.as_posix()]
    if not rule.anchored and "/" not in rule.pattern:
        candidate_paths.extend(part for part in rel_obj.parts)
    if not rule.anchored and "/" in rule.pattern:
        parts = rel_obj.parts
        candidate_paths.extend("/".join(parts[idx:]) for idx in range(1, len(parts)))
    if rule.directory_only:
        directory_candidates = []
        parts = rel_obj.parts[:-1]
        for idx in range(1, len(parts) + 1):
            directory_candidates.append("/".join(parts[:idx]))
        candidate_paths.extend(directory_candidates)
    for candidate in candidate_paths:
        if candidate == "":
            continue
        if fnmatch.fnmatchcase(candidate, rule.pattern):
            return True
    return False


def _filter_ignored_entries(tree: dict[str, _UploadedEntry]) -> dict[str, _UploadedEntry]:
    rules = _parse_ignore_rules(tree)
    out: dict[str, _UploadedEntry] = {}
    for path, entry in tree.items():
        ignored = False
        for rule in rules:
            if _match_ignore_rule(rule, path):
                ignored = True
        if not ignored:
            out[path] = entry
    return out


def _load_problem_type_from_store(
    tx: sqlite3.Connection,
    problem_type: str,
    load_problem_type_files: Callable[[str], dict[str, bytes]],
) -> pb.ProblemType:
    row = tx.execute("SELECT * FROM problem_types WHERE problem_type = ?", (problem_type,)).fetchone()
    if row is None:
        raise sqlite3.Error("not found")
    action_rows = tx.execute("SELECT * FROM problem_type_actions WHERE problem_type = ?", (problem_type,)).fetchall()
    actions: dict[str, pb.ProblemTypeAction] = {}
    for action_row in action_rows:
        actions[str(action_row["action"])] = pb.ProblemTypeAction(
            command=str(action_row["command"]),
            parser=str(action_row["parser"] or ""),
            max_cpu=int(action_row["max_cpu"]),
            max_fd=int(action_row["max_fd"]),
            max_file_size=int(action_row["max_file_size"]),
            max_memory=int(action_row["max_memory"]),
            max_threads=int(action_row["max_threads"]),
        )
    return pb.ProblemType(
        problem_type=problem_type,
        container=str(row["container"]),
        files=load_problem_type_files(problem_type),
        actions=actions,
    )


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


def prepare_problem(
    tx: sqlite3.Connection,
    current_user_id: str,
    draft: pb.AuthorProblemDraft,
    action: str,
    daycare_secret: str,
    assign_host: Callable[[set[str]], str],
    load_problem_type_files: Callable[[str], dict[str, bytes]],
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

        problem_type = _load_problem_type_from_store(tx, step_draft.problem_type, load_problem_type_files)
        bundle.problem_types[problem_type.problem_type].CopyFrom(problem_type)

        uploaded_tree: dict[str, _UploadedEntry] = {}
        for path, content in _collect_author_files(list(step_draft.files), label=f"step {index} file").items():
            uploaded_tree[path] = _UploadedEntry(content=content, source="uploaded")
        for path, content in _collect_author_files(
            list(step_draft.starter_files), label=f"step {index} starter file"
        ).items():
            uploaded_tree[f"_starter/{path}"] = _UploadedEntry(content=content, source="starter")
        for path, content in dict(problem_type.files).items():
            normalized = _normalize_rel_path(str(path), label=f"problem type {problem_type.problem_type} file")
            uploaded_tree[normalized] = _UploadedEntry(content=bytes(content or b""), source="problem_type")

        filtered_tree = _filter_ignored_entries(uploaded_tree)
        starter_files: dict[str, bytes] = {}
        for path, entry in filtered_tree.items():
            if entry.source != "starter":
                continue
            logical_path = _normalize_rel_path(path.removeprefix("_starter/"), label=f"step {index} starter file")
            if logical_path in problem_type.files:
                raise ValueError(
                    f"step {index} starter file {logical_path!r} conflicts with problem type file {logical_path!r}"
                )
            starter_files[logical_path] = entry.content

        student_owned_paths = prior_solution_paths | set(starter_files.keys())
        solution_files: dict[str, bytes] = {}
        step_files: dict[str, bytes] = {}
        for path, entry in filtered_tree.items():
            if entry.source != "uploaded":
                continue
            if path in student_owned_paths:
                solution_files[path] = entry.content
            else:
                step_files[path] = entry.content

        missing = [path for path in sorted(student_owned_paths) if path not in solution_files]
        if missing:
            lines = [f"step {index} solution is missing required student files:"]
            lines.extend(f"  {path}" for path in missing)
            raise ValueError("\n".join(lines))

        step = pb.ProblemStep(
            problem_id=problem.problem_id,
            step=index,
            problem_type=problem_type.problem_type,
            note=step_note,
            weight=float(step_weight),
            files=step_files,
            starter_files=starter_files,
            whitelist={path: True for path in sorted(solution_files)},
        )
        bundle.problem_steps.append(step)
        prior_solution_paths = set(solution_files)

        commit = pb.Commit(
            step=index,
            action=effective_action,
            note="author solution submitted via grind"
            if action == ""
            else f"author solution tested with action {action} via grind",
            problem_id=problem.problem_id,
            files=solution_files,
        )
        _set_ts(commit.created_at, now)
        _set_ts(commit.updated_at, now)
        bundle.commits.append(commit)

    del bundle.signed_grading_commits[:]
    for index, commit in enumerate(bundle.commits):
        grading_commit = _grading_commit_from_problem_bundle(bundle=bundle, step_index=index, commit=commit)
        bundle.signed_grading_commits.append(encode_signed_grading_commit(grading_commit, daycare_secret))
    return bundle


def save_problem(
    tx: sqlite3.Connection,
    current_user_id: str,
    mode: pb.SaveMode.ValueType,
    bundle: pb.ProblemBundle,
) -> pb.ProblemBundle:
    if bundle.user_id != current_user_id:
        raise ValueError("bundle must include user's ID")
    if bundle.problem.problem_id == "":
        raise ValueError("problem_id is required")
    row = tx.execute("SELECT * FROM problems WHERE problem_id = ?", (bundle.problem.problem_id,)).fetchone()
    if mode == pb.SAVE_MODE_UNSPECIFIED:
        raise ValueError("save mode is required")
    if mode == pb.SAVE_MODE_CREATE and row is not None:
        raise ValueError(f"problem {bundle.problem.problem_id!r} already exists")
    if mode == pb.SAVE_MODE_UPDATE and row is None:
        raise ValueError(f"problem {bundle.problem.problem_id!r} does not exist")
    if row is not None:
        _set_ts(bundle.problem.created_at, parse_time(row["problem_created_at"]))
    values = _problem_to_row(bundle.problem)
    if row is None:
        tx.execute(
            "INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            values,
        )
    else:
        tx.execute(
            "UPDATE problems SET problem_note = ?, problem_tags = ?, problem_options = ?, problem_created_at = ?, problem_updated_at = ? WHERE problem_id = ?",
            (values[1], values[2], values[3], values[4], values[5], values[0]),
        )

    for idx, step in enumerate(bundle.problem_steps, start=1):
        step.problem_id = bundle.problem.problem_id
        step.step = idx
        step_weight = _require_positive_int_weight(float(step.weight), f"step {idx} weight")
        existing = tx.execute(
            "SELECT 1 FROM problem_steps WHERE problem_id = ? AND step_number = ?",
            (step.problem_id, step.step),
        ).fetchone()
        if existing is None:
            tx.execute(
                "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_instructions, step_weight) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    step.problem_id,
                    step.step,
                    step.problem_type,
                    step.note,
                    "",
                    step_weight,
                ),
            )
        else:
            tx.execute(
                "UPDATE problem_steps SET problem_type = ?, step_note = ?, step_instructions = ?, step_weight = ? "
                "WHERE problem_id = ? AND step_number = ?",
                (
                    step.problem_type,
                    step.note,
                    "",
                    step_weight,
                    step.problem_id,
                    step.step,
                ),
            )
        if idx > len(bundle.commits):
            raise ValueError(f"missing commit for step {idx}")
        commit = bundle.commits[idx - 1]
        if int(commit.step) != idx:
            raise ValueError(f"commit step mismatch for step {idx}")
        _save_problem_step_files(tx, step.problem_id, step.step, ProblemStepFileType.REGULAR, dict(step.files))
        _save_problem_step_files(tx, step.problem_id, step.step, ProblemStepFileType.STARTER, dict(step.starter_files))
        _save_problem_step_files(tx, step.problem_id, step.step, ProblemStepFileType.SOLUTION, dict(commit.files))

    tx.execute(
        "DELETE FROM problem_steps WHERE problem_id = ? AND step_number > ?",
        (bundle.problem.problem_id, len(bundle.problem_steps)),
    )
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
    now_sql = _rfc3339_round_sec(_timestamp_now())
    tags_json = json.dumps(list(pset.problem_set_tags))
    row = tx.execute("SELECT * FROM problem_sets WHERE problem_set_id = ?", (pset.problem_set_id,)).fetchone()
    if mode == pb.SAVE_MODE_CREATE and row is not None:
        raise ValueError(f"problem set {pset.problem_set_id!r} already exists")
    if mode == pb.SAVE_MODE_UPDATE and row is None:
        raise ValueError(f"problem set {pset.problem_set_id!r} does not exist")
    if row is None:
        tx.execute(
            "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at) VALUES (?, ?, ?, ?, ?)",
            (pset.problem_set_id, pset.problem_set_note, tags_json, now_sql, now_sql),
        )
    else:
        tx.execute(
            "UPDATE problem_sets SET problem_set_note = ?, problem_set_tags = ?, problem_set_updated_at = ? WHERE problem_set_id = ?",
            (pset.problem_set_note, tags_json, now_sql, pset.problem_set_id),
        )

    tx.execute("DELETE FROM problem_set_problems WHERE problem_set_id = ?", (pset.problem_set_id,))
    for psp in bundle.problem_set_problems:
        psp.problem_set_id = pset.problem_set_id
        problem_weight = _require_positive_int_weight(float(psp.weight), f"problem {psp.problem_id} weight")
        exists = tx.execute("SELECT 1 FROM problems WHERE problem_id = ?", (psp.problem_id,)).fetchone()
        if exists is None:
            raise ValueError(f"problem {psp.problem_id!r} does not exist")
        tx.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight) VALUES (?, ?, ?)",
            (psp.problem_set_id, psp.problem_id, problem_weight),
        )
    return bundle


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


def save_grading_commit_common(
    tx: sqlite3.Connection,
    current_user_id: str,
    bundle: pb.GradingCommit,
    daycare_secret: str,
    ip_allowed: bool,
    assign_host: Callable[[set[str]], str],
    graded: bool,
) -> pb.GradingCommit:
    if bundle.user_id != current_user_id:
        raise ValueError("bundle must include user's ID")
    commit = bundle.commit
    assignment = tx.execute(
        "SELECT * FROM assignments WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
        (commit.assignment.user_id, commit.assignment.course_id, commit.assignment.problem_set_id),
    ).fetchone()
    is_instructor = False
    if assignment is None:
        uc = tx.execute(
            "SELECT 1 FROM user_courses WHERE user_id = ? AND course_id = ? AND is_instructor",
            (current_user_id, commit.assignment.course_id),
        ).fetchone()
        if uc is not None:
            assignment = tx.execute(
                "SELECT * FROM assignments WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
                (commit.assignment.user_id, commit.assignment.course_id, commit.assignment.problem_set_id),
            ).fetchone()
            is_instructor = assignment is not None
    if assignment is None:
        raise sqlite3.Error("not found")
    if (not ip_allowed) and bool(assignment["restricted"]) and (not is_instructor):
        raise ValueError("assignment access restricted")

    problem = tx.execute("SELECT * FROM problems WHERE problem_id = ?", (commit.problem_id,)).fetchone()
    if problem is None:
        raise sqlite3.Error("not found")
    step_row = tx.execute(
        "SELECT problem_steps.*, problem_step_whitelist.whitelist FROM problem_steps "
        "NATURAL JOIN problem_step_whitelist "
        "WHERE problem_steps.problem_id = ? AND problem_steps.step_number = ?",
        (commit.problem_id, commit.step),
    ).fetchone()
    if step_row is None:
        raise sqlite3.Error("not found")

    now = _timestamp_now()
    if not commit.HasField("created_at"):
        _set_ts(commit.created_at, now)
    _set_ts(commit.updated_at, now)

    action = commit.action
    if not graded:
        commit.action = ""

    if not is_instructor:
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
            dict(commit.files),
        )
    commit.action = action

    if bundle.hostname == "":
        bundle.hostname = assign_host({step_row["problem_type"]})
    problem_type = tx.execute("SELECT * FROM problem_types WHERE problem_type = ?", (step_row["problem_type"],)).fetchone()
    if problem_type is None:
        raise sqlite3.Error("not found")
    problem_type_actions = tx.execute("SELECT * FROM problem_type_actions WHERE problem_type = ?", (step_row["problem_type"],)).fetchall()
    actions: dict[str, pb.ProblemTypeAction] = {}
    for row in problem_type_actions:
        actions[str(row["action"])] = pb.ProblemTypeAction(
            command=str(row["command"]),
            parser=str(row["parser"] or ""),
            max_cpu=int(row["max_cpu"]),
            max_fd=int(row["max_fd"]),
            max_file_size=int(row["max_file_size"]),
            max_memory=int(row["max_memory"]),
            max_threads=int(row["max_threads"]),
        )
    pb_problem_type = pb.ProblemType(
        problem_type=str(problem_type["problem_type"]),
        container=str(problem_type["container"]),
        actions=actions,
    )

    pb_problem = pb.Problem(
        problem_id=str(problem["problem_id"]),
        problem_note=str(problem["problem_note"]),
    )
    tags = _json_load(problem["problem_tags"], [])
    if isinstance(tags, list):
        pb_problem.problem_tags.extend([str(v) for v in tags])
    options = _json_load(problem["problem_options"], [])
    if isinstance(options, list):
        pb_problem.problem_options.extend([str(v) for v in options])

    pb_step = pb.ProblemStep(
        problem_id=str(step_row["problem_id"]),
        step=int(step_row["step_number"]),
        problem_type=str(step_row["problem_type"]),
        note=str(step_row["step_note"]),
        weight=float(step_row["step_weight"]),
    )
    whitelist = _json_load(step_row["whitelist"], {})
    if isinstance(whitelist, dict):
        pb_step.whitelist.update({str(k): bool(v) for k, v in whitelist.items()})
    return pb.GradingCommit(
        problem_type=pb_problem_type,
        problem=pb_problem,
        problem_steps=[pb_step],
        hostname=bundle.hostname,
        user_id=bundle.user_id,
        commit=commit,
    )


def _grading_commit_from_problem_bundle(
    *,
    bundle: pb.ProblemBundle,
    step_index: int,
    commit: pb.Commit,
) -> pb.GradingCommit:
    step = bundle.problem_steps[step_index]
    problem_type = bundle.problem_types[step.problem_type]
    return pb.GradingCommit(
        problem_type=problem_type,
        problem=bundle.problem,
        problem_steps=bundle.problem_steps,
        hostname=bundle.hostname,
        user_id=bundle.user_id,
        commit=commit,
    )
