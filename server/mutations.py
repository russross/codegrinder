from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any, Callable
from urllib.parse import quote

import codegrinder_pb2 as pb
from google.protobuf.json_format import MessageToDict

from proto_conv import parse_time
from signatures import encode_params, encode_signed_grading_commit, hmac_sha256_base64

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


def _map_bytes_sorted(items: dict[str, bytes], key_prefix: str, values: dict[str, list[str]]) -> None:
    for name in sorted(items.keys()):
        values[f"{key_prefix}{name}"] = [bytes(items[name] or b"").decode("latin1")]


def compute_problem_type_signature(problem_type: pb.ProblemType, secret: str) -> str:
    values: dict[str, list[str]] = {
        "problem_type": [problem_type.problem_type],
        "container": [problem_type.container],
    }
    _map_bytes_sorted(dict(problem_type.files), "file-", values)
    for name in sorted(problem_type.actions.keys()):
        action = problem_type.actions[name]
        values[f"action-{name}-command"] = [action.command]
        values[f"action-{name}-parser"] = [action.parser]
        values[f"action-{name}-max-cpu"] = [str(action.max_cpu)]
        values[f"action-{name}-max-fd"] = [str(action.max_fd)]
        values[f"action-{name}-max-file-size"] = [str(action.max_file_size)]
        values[f"action-{name}-max-memory"] = [str(action.max_memory)]
        values[f"action-{name}-max-threads"] = [str(action.max_threads)]
    return hmac_sha256_base64(secret, encode_params(values))


def compute_problem_signature(problem: pb.Problem, steps: list[pb.ProblemStep], secret: str) -> str:
    values: dict[str, list[str]] = {
        "problem_id": [problem.problem_id],
        "problem_note": [problem.problem_note],
    }
    if problem.problem_tags:
        values["problem_tags"] = list(problem.problem_tags)
    if problem.problem_options:
        values["problem_options"] = list(problem.problem_options)
    for step in steps:
        values[f"step-{step.step}-problem_type"] = [step.problem_type]
        values[f"step-{step.step}-note"] = [step.note]
        values[f"step-{step.step}-instructions"] = [step.instructions]
        values[f"step-{step.step}-weight"] = [format(step.weight, "g")]
    return hmac_sha256_base64(secret, encode_params(values))


def compute_commit_signature(
    commit: pb.Commit,
    problem_type_signature: str,
    problem_signature: str,
    hostname: str,
    user_id: str,
    secret: str,
) -> str:
    values: dict[str, list[str]] = {
        "problem_type_signature": [problem_type_signature],
        "problem_signature": [problem_signature],
        "hostname": [hostname],
        "user_id": [user_id],
        "assignment_user_id": [commit.assignment.user_id],
        "assignment_course_id": [commit.assignment.course_id],
        "assignment_problem_set_id": [commit.assignment.problem_set_id],
        "problem_id": [commit.problem_id],
        "step": [str(commit.step)],
        "action": [commit.action],
        "note": [commit.note],
        "score": [format(commit.score, "g")],
    }
    return hmac_sha256_base64(secret, encode_params(values))


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


def _save_problem_step_files(tx: sqlite3.Connection, table: str, problem_id: str, step: int, files: dict[str, bytes]) -> None:
    tx.execute(f"DELETE FROM {table} WHERE problem_id = ? AND step_number = ?", (problem_id, step))
    for name in sorted(files.keys()):
        tx.execute(
            f"INSERT INTO {table}(problem_id, step_number, path, content) VALUES (?, ?, ?, ?)",
            (problem_id, step, name, bytes(files[name] or b"")),
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


def sign_problem_bundle_unconfirmed(
    tx: sqlite3.Connection,
    current_user_id: str,
    bundle: pb.ProblemBundle,
    daycare_secret: str,
    assign_host: Callable[[set[str]], str],
) -> pb.ProblemBundle:
    if bundle.user_id != current_user_id:
        raise ValueError("bundle must include user's ID")
    now = _timestamp_now()
    if bundle.problem.problem_id == "":
        bundle.problem.problem_id = quote(bundle.problem.problem_note.strip().lower().replace(" ", "-"), safe="-._~")
    _set_ts(bundle.problem.created_at, now)
    _set_ts(bundle.problem.updated_at, now)
    for idx, step in enumerate(bundle.problem_steps, start=1):
        step.problem_id = bundle.problem.problem_id
        step.step = idx
    bundle.problem_signature = compute_problem_signature(bundle.problem, list(bundle.problem_steps), daycare_secret)
    if bundle.hostname == "":
        bundle.hostname = assign_host({step.problem_type for step in bundle.problem_steps})
    del bundle.signed_grading_commits[:]
    for idx, step in enumerate(bundle.problem_steps):
        if idx >= len(bundle.commits):
            break
        commit = _grading_commit_from_problem_bundle(
            bundle=bundle,
            step_index=idx,
            commit=bundle.commits[idx],
        )
        bundle.signed_grading_commits.append(encode_signed_grading_commit(commit, daycare_secret))
    return bundle


def save_problem_bundle_common(
    tx: sqlite3.Connection,
    current_user_id: str,
    bundle: pb.ProblemBundle,
    daycare_secret: str,
) -> pb.ProblemBundle:
    if bundle.user_id != current_user_id:
        raise ValueError("bundle must include user's ID")
    if bundle.problem.problem_id == "":
        raise ValueError("problem_id is required")
    row = tx.execute("SELECT * FROM problems WHERE problem_id = ?", (bundle.problem.problem_id,)).fetchone()
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
                    step.instructions,
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
                    step.instructions,
                    step_weight,
                    step.problem_id,
                    step.step,
                ),
            )
        _save_problem_step_files(tx, "problem_step_files", step.problem_id, step.step, dict(step.files))
        _save_problem_step_files(tx, "problem_step_solution_files", step.problem_id, step.step, dict(step.solution))

    tx.execute(
        "DELETE FROM problem_steps WHERE problem_id = ? AND step_number > ?",
        (bundle.problem.problem_id, len(bundle.problem_steps)),
    )

    bundle.problem_signature = compute_problem_signature(bundle.problem, list(bundle.problem_steps), daycare_secret)
    return bundle


def update_problem_bundle(
    tx: sqlite3.Connection,
    current_user_id: str,
    problem_id: str,
    bundle: pb.ProblemBundle,
    daycare_secret: str,
) -> pb.ProblemBundle:
    if bundle.problem.problem_id != problem_id:
        raise ValueError("problem ID mismatch")
    return save_problem_bundle_common(tx, current_user_id, bundle, daycare_secret)


def save_problem_set_bundle_common(tx: sqlite3.Connection, bundle: pb.ProblemSetBundle) -> pb.ProblemSetBundle:
    pset = bundle.problem_set
    if pset.problem_set_id == "":
        raise ValueError("problem_set_id is required")
    now_sql = _rfc3339_round_sec(_timestamp_now())
    tags_json = json.dumps(list(pset.problem_set_tags))
    row = tx.execute("SELECT * FROM problem_sets WHERE problem_set_id = ?", (pset.problem_set_id,)).fetchone()
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
        tx.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight) VALUES (?, ?, ?)",
            (psp.problem_set_id, psp.problem_id, problem_weight),
        )
    return bundle


def create_problem_set_bundle(tx: sqlite3.Connection, bundle: pb.ProblemSetBundle) -> pb.ProblemSetBundle:
    return save_problem_set_bundle_common(tx, bundle)


def update_problem_set_bundle(tx: sqlite3.Connection, bundle: pb.ProblemSetBundle) -> pb.ProblemSetBundle:
    return save_problem_set_bundle_common(tx, bundle)


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
        instructions=str(step_row["step_instructions"]),
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
