from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any, Callable
from urllib.parse import quote

import codegrinder_pb2 as pb
from google.protobuf.json_format import MessageToDict

from proto_conv import parse_time
from signatures import encode_params, hmac_sha256_base64

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


def _eq_second(a: object, b: object) -> bool:
    return _ts_to_dt(a).replace(microsecond=0) == _ts_to_dt(b).replace(microsecond=0)


def _required_lastrowid(lastrowid: int | None) -> int:
    if lastrowid is None:
        raise ValueError("database did not return last row id")
    return int(lastrowid)


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


def _map_bytes_sorted(items: dict[str, bytes], key_prefix: str, values: dict[str, list[str]]) -> None:
    for name in sorted(items.keys()):
        values[f"{key_prefix}{name}"] = [bytes(items[name] or b"").decode("latin1")]


def _map_bool_sorted(items: dict[str, bool], key_prefix: str, values: dict[str, list[str]]) -> None:
    for name in sorted(items.keys()):
        if items[name]:
            values[f"{key_prefix}{name}"] = ["true"]


def compute_problem_type_signature(problem_type: pb.ProblemType, secret: str) -> str:
    values: dict[str, list[str]] = {
        "name": [problem_type.name],
        "image": [problem_type.image],
    }
    _map_bytes_sorted(dict(problem_type.files), "file-", values)
    for name in sorted(problem_type.actions.keys()):
        action = problem_type.actions[name]
        values[f"action-{name}-command"] = [action.command]
        values[f"action-{name}-parser"] = [action.parser]
        values[f"action-{name}-message"] = [action.message]
        values[f"action-{name}-interactive"] = ["true" if action.interactive else "false"]
        values[f"action-{name}-max-cpu"] = [str(action.max_cpu)]
        values[f"action-{name}-max-session"] = [str(action.max_session)]
        values[f"action-{name}-max-timeout"] = [str(action.max_timeout)]
        values[f"action-{name}-max-fd"] = [str(action.max_fd)]
        values[f"action-{name}-max-file-size"] = [str(action.max_file_size)]
        values[f"action-{name}-max-memory"] = [str(action.max_memory)]
        values[f"action-{name}-max-threads"] = [str(action.max_threads)]
    return hmac_sha256_base64(secret, encode_params(values))


def compute_problem_signature(problem: pb.Problem, steps: list[pb.ProblemStep], secret: str) -> str:
    values: dict[str, list[str]] = {
        "id": [str(problem.id)],
        "unique": [problem.unique],
        "note": [problem.note],
        "createdAt": [_rfc3339_round_sec(_ts_to_dt(problem.created_at))],
        "updatedAt": [_rfc3339_round_sec(_ts_to_dt(problem.updated_at))],
    }
    if len(problem.tags) == 0:
        values["tags"] = []
    else:
        values["tags"] = list(problem.tags)
    if len(problem.options) == 0:
        values["options"] = []
    else:
        values["options"] = list(problem.options)
    for idx, step in enumerate(steps, start=1):
        if step.problem_type == "":
            values[f"step-{idx}-nil"] = [""]
            continue
        values[f"step-{step.step}-problem-type"] = [step.problem_type]
        values[f"step-{step.step}-note"] = [step.note]
        values[f"step-{step.step}-weight"] = [format(step.weight, "g")]
        _map_bytes_sorted(dict(step.files), f"step-{step.step}-file-", values)
        _map_bool_sorted(dict(step.whitelist), f"step-{step.step}-whitelist-", values)
    return hmac_sha256_base64(secret, encode_params(values))


def compute_commit_signature(
    commit: pb.Commit,
    problem_type_signature: str,
    problem_signature: str,
    daycare_host: str,
    user_id: int,
    secret: str,
) -> str:
    values: dict[str, list[str]] = {
        "id": [str(commit.id)],
        "assignment_id": [str(commit.assignment_id)],
        "problem_id": [str(commit.problem_id)],
        "step": [str(commit.step)],
        "action": [commit.action],
        "note": [commit.note],
        "score": [format(commit.score, "g")],
        "created_at": [_rfc3339_round_sec(_ts_to_dt(commit.created_at))],
        "updated_at": [_rfc3339_round_sec(_ts_to_dt(commit.updated_at))],
        "problem_type_signature": [problem_type_signature],
        "problem_signature": [problem_signature],
        "daycare_host": [daycare_host],
        "user_id": [str(user_id)],
    }
    _map_bytes_sorted(dict(commit.files), "file-", values)
    for idx, event in enumerate(commit.transcript):
        values[f"transcript-{idx}"] = [str(event)]
    if commit.HasField("report_card"):
        rc = commit.report_card
        values["reportcard-passed"] = ["true" if rc.passed else "false"]
        values["reportcard-note"] = [rc.note]
        values["reportcard-duration"] = [str(rc.duration)]
        for idx, result in enumerate(rc.results):
            values[f"reportcard-{idx}-name"] = [result.name]
            values[f"reportcard-{idx}-outcome"] = [result.outcome]
            if result.details:
                values[f"reportcard-{idx}-details"] = [result.details]
            if result.context:
                values[f"reportcard-{idx}-context"] = [result.context]
    return hmac_sha256_base64(secret, encode_params(values))


def _fix_line_endings(data: bytes) -> bytes:
    out = data.replace(b"\r\n", b"\n")
    if out == b"":
        return out
    if not out.endswith(b"\n"):
        out += b"\n"
    while b" \n" in out:
        out = out.replace(b" \n", b"\n")
    while out.endswith(b"\n\n"):
        out = out[:-1]
    if out == b"\n":
        return b""
    return out


def _normalize_commit(commit: pb.Commit, now: datetime, whitelist: dict[str, bool]) -> None:
    commit.action = commit.action.strip()
    commit.note = commit.note.strip()
    clean: dict[str, bytes] = {}
    for name in list(commit.files.keys()):
        if whitelist.get(name, False):
            clean[name] = _fix_line_endings(bytes(commit.files[name] or b""))
    commit.files.clear()
    commit.files.update(clean)
    if len(commit.files) == 0:
        raise ValueError("commit must have at least one file")
    if commit.score < 0.0 or commit.score > 1.0:
        raise ValueError("commit score must be between 0 and 1")
    if _ts_to_dt(commit.created_at) > now or _ts_to_dt(commit.updated_at) > now:
        raise ValueError("commit timestamp is invalid")


def _normalize_problem(problem: pb.Problem, steps: list[pb.ProblemStep], now: datetime) -> None:
    problem.unique = problem.unique.strip()
    if problem.unique == "":
        raise ValueError("unique ID cannot be empty")
    if quote(problem.unique, safe="") != problem.unique:
        raise ValueError("unique ID must be URL friendly")
    problem.note = problem.note.strip()
    if problem.note == "":
        raise ValueError("note cannot be empty")
    tags = sorted([tag.strip() for tag in list(problem.tags)])
    problem.tags[:] = tags
    options = sorted([opt.strip() for opt in list(problem.options)])
    problem.options[:] = options
    if len(steps) == 0:
        raise ValueError("problem must have at least one step")
    prev_whitelist: dict[str, bool] = {}
    for idx, step in enumerate(steps, start=1):
        step.step = idx
        step.note = step.note.strip()
        if step.note == "":
            raise ValueError(f"missing note for step {idx}")
        if step.weight <= 0.0:
            step.weight = 1.0
        fixed = {name: _fix_line_endings(bytes(content or b"")) for name, content in dict(step.files).items()}
        step.files.clear()
        step.files.update(fixed)
        carry = dict(prev_whitelist)
        for key, val in dict(step.whitelist).items():
            if val:
                carry[key] = True
        step.whitelist.clear()
        step.whitelist.update(carry)
        prev_whitelist = carry
    if _ts_to_dt(problem.created_at) > now or _ts_to_dt(problem.updated_at) > now:
        raise ValueError("problem timestamp is invalid")


def _load_problem_type(tx: sqlite3.Connection, root_files_dir: str, name: str) -> pb.ProblemType:
    row = tx.execute("SELECT * FROM problem_types WHERE name = ?", (name,)).fetchone()
    if row is None:
        raise sqlite3.Error(f"problem type {name!r} not found")
    actions_rows = tx.execute("SELECT * FROM problem_type_actions WHERE problem_type = ?", (name,)).fetchall()
    files: dict[str, bytes] = {}
    from pathlib import Path

    base = Path(root_files_dir) / name
    if base.exists() and base.is_dir():
        for path in base.rglob("*"):
            if path.is_file():
                files[str(path.relative_to(base))] = path.read_bytes()
    actions: dict[str, pb.ProblemTypeAction] = {}
    for arow in actions_rows:
        actions[str(arow["action"])] = pb.ProblemTypeAction(
            problem_type=str(arow["problem_type"]),
            action=str(arow["action"]),
            command=str(arow["command"]),
            parser=str(arow["parser"] or ""),
            message=str(arow["message"]),
            interactive=bool(arow["interactive"]),
            max_cpu=int(arow["max_cpu"]),
            max_session=int(arow["max_session"]),
            max_timeout=int(arow["max_timeout"]),
            max_fd=int(arow["max_fd"]),
            max_file_size=int(arow["max_file_size"]),
            max_memory=int(arow["max_memory"]),
            max_threads=int(arow["max_threads"]),
        )
    return pb.ProblemType(name=str(row["name"]), image=str(row["image"]), files=files, actions=actions)


def sign_problem_bundle_unconfirmed(
    tx: sqlite3.Connection,
    current_user_id: int,
    bundle: pb.ProblemBundle,
    daycare_secret: str,
    root_files_dir: str,
    assign_host: Callable[[set[str]], str],
) -> pb.ProblemBundle:
    now = _timestamp_now()
    if len(bundle.problem_types) > 0 or len(bundle.problem_type_signatures) > 0:
        raise ValueError("bundle must not include problem type")
    if not bundle.HasField("problem"):
        raise ValueError("bundle must include the problem")
    if len(bundle.problem_steps) == 0:
        raise ValueError("problem must have at least one step")
    if len(bundle.problem_steps) != len(bundle.commits):
        raise ValueError("problem must have exactly one commit for each step")
    if bundle.problem_signature != "":
        raise ValueError("unconfirmed bundle must not have problem signature")
    if len(bundle.commit_signatures) > 0:
        raise ValueError("unconfirmed bundle must not have commit signatures")
    if bundle.hostname != "":
        raise ValueError("unconfirmed bundle must not have daycare hostname")
    if bundle.user_id != current_user_id:
        raise ValueError("user ID in problem bundle must match current user ID")

    type_set: set[str] = set()
    for step in bundle.problem_steps:
        type_set.add(step.problem_type)
    bundle.problem_types.clear()
    bundle.problem_type_signatures.clear()
    for name in sorted(type_set):
        ptype = _load_problem_type(tx, root_files_dir, name)
        bundle.problem_types[name].CopyFrom(ptype)
        bundle.problem_type_signatures[name] = compute_problem_type_signature(ptype, daycare_secret)

    if bundle.problem.id > 0:
        _set_ts(bundle.problem.updated_at, now)
    else:
        _set_ts(bundle.problem.created_at, now)
        _set_ts(bundle.problem.updated_at, now)
    _normalize_problem(bundle.problem, list(bundle.problem_steps), now)

    if bundle.problem.id != 0:
        old = tx.execute("SELECT * FROM problems WHERE id = ?", (bundle.problem.id,)).fetchone()
        if old is None:
            raise ValueError(f"request to update problem {bundle.problem.id}, but that problem does not exist")
        if bundle.problem.unique != str(old["unique_id"]):
            raise ValueError("updating a problem cannot change its unique ID")
        if not _eq_second(bundle.problem.created_at, old["created_at"]):
            raise ValueError("updating a problem cannot change its created time")

    conflict = tx.execute("SELECT id FROM problems WHERE unique_id = ?", (bundle.problem.unique,)).fetchone()
    if conflict is not None and int(conflict["id"]) != int(bundle.problem.id):
        raise ValueError(f'unique ID "{bundle.problem.unique}" is already in use by problem {int(conflict["id"])}')

    _set_ts(bundle.problem.updated_at, now)
    bundle.problem_signature = compute_problem_signature(bundle.problem, list(bundle.problem_steps), daycare_secret)
    bundle.hostname = assign_host(type_set)

    del bundle.commit_signatures[:]
    for idx, commit in enumerate(bundle.commits):
        commit.id = 0
        commit.assignment_id = 0
        commit.problem_id = bundle.problem.id
        commit.step = idx + 1
        ptype = bundle.problem_types[bundle.problem_steps[idx].problem_type]
        if commit.action not in ptype.actions:
            raise ValueError(
                f'commit {idx} has action "{commit.action}", which does not exist for problem type {ptype.name}'
            )
        del commit.transcript[:]
        commit.ClearField("report_card")
        commit.score = 0.0
        _set_ts(commit.created_at, now)
        _set_ts(commit.updated_at, now)
        _normalize_commit(commit, now, dict(bundle.problem_steps[idx].whitelist))
        sig = compute_commit_signature(
            commit,
            bundle.problem_type_signatures[ptype.name],
            bundle.problem_signature,
            bundle.hostname,
            bundle.user_id,
            daycare_secret,
        )
        bundle.commit_signatures.append(sig)
    return bundle


def _problem_to_row(problem: pb.Problem) -> tuple[str, str, str, str, str, str]:
    created = _rfc3339_round_sec(_ts_to_dt(problem.created_at))
    updated = _rfc3339_round_sec(_ts_to_dt(problem.updated_at))
    return (
        problem.unique,
        problem.note,
        json.dumps(list(problem.tags)),
        json.dumps(list(problem.options)),
        created,
        updated,
    )


def _save_problem_step_files(tx: sqlite3.Connection, table: str, problem_id: int, step: int, files: dict[str, bytes]) -> None:
    tx.execute(f"DELETE FROM {table} WHERE problem_id = ? AND step = ?", (problem_id, step))
    for name in sorted(files.keys()):
        tx.execute(
            f"INSERT INTO {table}(problem_id, step, path, content) VALUES (?, ?, ?, ?)",
            (problem_id, step, name, bytes(files[name] or b"")),
        )


def _validate_problem_bundle_signatures(
    tx: sqlite3.Connection,
    bundle: pb.ProblemBundle,
    daycare_secret: str,
    root_files_dir: str,
) -> dict[str, pb.ProblemType]:
    type_set = {step.problem_type for step in bundle.problem_steps}
    if len(type_set) != len(bundle.problem_type_signatures):
        raise ValueError(
            "problem bundle includes problem type signatures that do not match the step list"
        )
    canonical: dict[str, pb.ProblemType] = {}
    for name in sorted(bundle.problem_type_signatures.keys()):
        if name not in type_set:
            raise ValueError(f'the problem requires problem type "{name}" but no signature provided for that type')
        ptype = _load_problem_type(tx, root_files_dir, name)
        sig = compute_problem_type_signature(ptype, daycare_secret)
        if bundle.problem_type_signatures[name] != sig:
            raise ValueError(f'problem type signature for "{name}" does not check out')
        canonical[name] = ptype
    return canonical


def _report_card_score(report_card: pb.ReportCard) -> float:
    if len(report_card.results) == 0:
        return 0.0
    passed = sum(1 for result in report_card.results if result.outcome == "passed")
    score = float(passed) / float(len(report_card.results))
    if not report_card.passed and score >= 1.0:
        score = float(passed) / float(len(report_card.results) + 1)
    return score


def _assignment_compute_score(raw_scores: dict[str, list[float]], major: dict[str, float], minor: dict[str, list[float]]) -> float:
    major_weight_sum = 0.0
    major_score_sum = 0.0
    for unique, major_weight in major.items():
        scores = raw_scores.get(unique, [])
        minor_weight_sum = 0.0
        minor_score_sum = 0.0
        for idx, mw in enumerate(minor.get(unique, [])):
            minor_weight_sum += mw
            if idx < len(scores):
                minor_score_sum += scores[idx] * mw
        if minor_weight_sum == 0.0:
            continue
        major_weight_sum += major_weight
        major_score_sum += (minor_score_sum / minor_weight_sum) * major_weight
    if major_weight_sum == 0.0:
        return 0.0
    return major_score_sum / major_weight_sum


def _problem_weights(tx: sqlite3.Connection, problem_set_id: int) -> tuple[dict[str, float], dict[str, list[float]]]:
    rows = tx.execute(
        "SELECT problems.unique_id AS major_key, problem_set_problems.weight AS major_weight, "
        "problem_steps.step AS minor_key, problem_steps.weight AS minor_weight "
        "FROM problem_set_problems JOIN problems ON problem_set_problems.problem_id = problems.id "
        "JOIN problem_steps ON problem_steps.problem_id = problems.id "
        "WHERE problem_set_problems.problem_set_id = ? ORDER BY unique_id, step",
        (problem_set_id,),
    ).fetchall()
    if len(rows) == 0:
        raise ValueError("no problem step weights found, unable to compute score")
    major: dict[str, float] = {}
    minor: dict[str, list[float]] = {}
    for row in rows:
        key = str(row["major_key"])
        major[key] = float(row["major_weight"])
        minor.setdefault(key, []).append(float(row["minor_weight"]))
        if len(minor[key]) != int(row["minor_key"]):
            raise ValueError("step weights do not line up when computing score")
    return major, minor


def save_problem_bundle_common(
    tx: sqlite3.Connection,
    current_user_id: int,
    bundle: pb.ProblemBundle,
    daycare_secret: str,
    root_files_dir: str,
) -> pb.ProblemBundle:
    now = _timestamp_now()
    if not bundle.HasField("problem"):
        raise ValueError("bundle must contain a problem")
    _normalize_problem(bundle.problem, list(bundle.problem_steps), now)
    canonical = _validate_problem_bundle_signatures(tx, bundle, daycare_secret, root_files_dir)
    bundle.problem_types.clear()
    for name, ptype in canonical.items():
        bundle.problem_types[name].CopyFrom(ptype)
    expected_problem_sig = compute_problem_signature(bundle.problem, list(bundle.problem_steps), daycare_secret)
    if bundle.problem_signature != expected_problem_sig:
        raise ValueError("problem signature does not check out")
    if len(bundle.problem_steps) != len(bundle.commits):
        raise ValueError("problem must have exactly one commit for each problem step")
    if len(bundle.commit_signatures) != len(bundle.commits):
        raise ValueError("problem must have exactly one commit signature for each commit")
    if bundle.user_id != current_user_id:
        raise ValueError("user ID in problem bundle must match current user ID")
    for idx, commit in enumerate(bundle.commits):
        step = bundle.problem_steps[idx]
        csig = compute_commit_signature(
            commit,
            bundle.problem_type_signatures[step.problem_type],
            bundle.problem_signature,
            bundle.hostname,
            bundle.user_id,
            daycare_secret,
        )
        if csig != bundle.commit_signatures[idx]:
            raise ValueError(f"commit for step {commit.step} has a bad signature")
        if commit.step != step.step or commit.step != idx + 1:
            raise ValueError(f"commit for step {step.step} says it is for step {commit.step}")
        if not commit.HasField("report_card") or (not commit.report_card.passed) or commit.score != 1.0:
            raise ValueError(f"commit for step {idx + 1} did not pass")
        step.solution.clear()
        step.solution.update(dict(commit.files))

    is_update = bundle.problem.id != 0
    old_step_count = 0
    if is_update:
        old_step_count = int(
            tx.execute("SELECT COUNT(1) AS c FROM problem_steps WHERE problem_id = ?", (bundle.problem.id,)).fetchone()["c"]
        )

    if is_update:
        tx.execute(
            "UPDATE problems SET unique_id = ?, note = ?, tags = ?, options = ?, created_at = ?, updated_at = ? WHERE id = ?",
            (*_problem_to_row(bundle.problem), bundle.problem.id),
        )
    else:
        cur = tx.execute(
            "INSERT INTO problems(unique_id, note, tags, options, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            _problem_to_row(bundle.problem),
        )
        bundle.problem.id = _required_lastrowid(cur.lastrowid)

    for step in bundle.problem_steps:
        step.problem_id = bundle.problem.id
        whitelist_json = json.dumps({k: bool(v) for k, v in dict(step.whitelist).items()})
        if step.step > old_step_count:
            tx.execute(
                "INSERT INTO problem_steps(problem_id, step, problem_type, note, instructions, weight, whitelist) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    step.problem_id,
                    step.step,
                    step.problem_type,
                    step.note,
                    step.instructions,
                    step.weight,
                    whitelist_json,
                ),
            )
        else:
            tx.execute(
                "UPDATE problem_steps SET problem_type = ?, note = ?, instructions = ?, weight = ?, whitelist = ? "
                "WHERE problem_id = ? AND step = ?",
                (
                    step.problem_type,
                    step.note,
                    step.instructions,
                    step.weight,
                    whitelist_json,
                    step.problem_id,
                    step.step,
                ),
            )
        _save_problem_step_files(tx, "problem_step_files", step.problem_id, step.step, dict(step.files))
        _save_problem_step_files(tx, "problem_step_solution_files", step.problem_id, step.step, dict(step.solution))

    if len(bundle.problem_steps) < old_step_count:
        tx.execute(
            "DELETE FROM problem_steps WHERE problem_id = ? AND step > ?",
            (bundle.problem.id, len(bundle.problem_steps)),
        )
    return bundle


def update_problem_bundle(
    tx: sqlite3.Connection,
    current_user_id: int,
    problem_id: int,
    bundle: pb.ProblemBundle,
    daycare_secret: str,
    root_files_dir: str,
) -> pb.ProblemBundle:
    if not bundle.HasField("problem"):
        raise ValueError("bundle must contain a problem")
    if bundle.problem.id <= 0:
        raise ValueError("updated problem must have ID > 0")
    if bundle.problem.id != problem_id:
        raise ValueError("problem ID in URL does not match problem ID in bundle")
    old = tx.execute("SELECT * FROM problems WHERE id = ?", (bundle.problem.id,)).fetchone()
    if old is None:
        raise sqlite3.Error("not found")
    if bundle.problem.unique != str(old["unique_id"]):
        raise ValueError("updating a problem cannot change its unique ID")
    if not _eq_second(bundle.problem.created_at, old["created_at"]):
        raise ValueError("updating a problem cannot change its created time")
    assignment_count = int(
        tx.execute(
            "SELECT COUNT(1) AS c FROM assignments INNER JOIN problem_sets ON assignments.problem_set_id = problem_sets.id "
            "INNER JOIN problem_set_problems ON problem_sets.id = problem_set_problems.problem_set_id "
            "WHERE problem_set_problems.problem_id = ?",
            (bundle.problem.id,),
        ).fetchone()["c"]
    )
    if assignment_count > 0:
        old_steps = tx.execute("SELECT * FROM problem_steps WHERE problem_id = ? ORDER BY step", (bundle.problem.id,)).fetchall()
        if len(bundle.problem_steps) != len(old_steps):
            raise ValueError("cannot change the number of steps in a problem that is already in use")
        for idx, row in enumerate(old_steps):
            if bundle.problem_steps[idx].problem_type != str(row["problem_type"]):
                raise ValueError(f"cannot change the problem type of step {idx + 1} in a problem that is already in use")
    return save_problem_bundle_common(tx, current_user_id, bundle, daycare_secret, root_files_dir)


def create_problem_set_bundle(tx: sqlite3.Connection, bundle: pb.ProblemSetBundle) -> pb.ProblemSetBundle:
    now = _timestamp_now()
    if not bundle.HasField("problem_set"):
        raise ValueError("bundle must contain a problem set")
    pset = bundle.problem_set
    if pset.id != 0:
        raise ValueError("a new problem set must not have an ID")
    if len(bundle.problem_set_problems) == 0:
        raise ValueError("a problem set must have at least one problem")
    pset.unique = pset.unique.strip()
    if pset.unique == "" or quote(pset.unique, safe="") != pset.unique:
        raise ValueError("unique ID must be URL friendly")
    pset.note = pset.note.strip()
    if pset.note == "":
        raise ValueError("note cannot be empty")
    pset.tags[:] = sorted([tag.strip() for tag in list(pset.tags)])
    _set_ts(pset.created_at, now)
    _set_ts(pset.updated_at, now)
    cur = tx.execute(
        "INSERT INTO problem_sets(unique_id, note, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (pset.unique, pset.note, json.dumps(list(pset.tags)), _rfc3339_round_sec(now), _rfc3339_round_sec(now)),
    )
    pset.id = _required_lastrowid(cur.lastrowid)
    for psp in bundle.problem_set_problems:
        psp.problem_set_id = pset.id
        if psp.weight <= 0.0:
            psp.weight = 1.0
        tx.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, weight) VALUES (?, ?, ?)",
            (psp.problem_set_id, psp.problem_id, psp.weight),
        )
    return bundle


def update_problem_set_bundle(tx: sqlite3.Connection, bundle: pb.ProblemSetBundle) -> pb.ProblemSetBundle:
    now = _timestamp_now()
    if not bundle.HasField("problem_set"):
        raise ValueError("bundle must contain a problem set")
    pset = bundle.problem_set
    if pset.id <= 0:
        raise ValueError("updated problem set must have ID > 0")
    if len(bundle.problem_set_problems) == 0:
        raise ValueError("a problem set must have at least one problem")
    old = tx.execute("SELECT * FROM problem_sets WHERE id = ?", (pset.id,)).fetchone()
    if old is None:
        raise sqlite3.Error("not found")
    if pset.unique != str(old["unique_id"]):
        raise ValueError("updating a problem set cannot change its unique ID")
    if not _eq_second(pset.created_at, old["created_at"]):
        raise ValueError("updating a problem set cannot change its created time")
    pset.unique = pset.unique.strip()
    pset.note = pset.note.strip()
    if pset.unique == "" or quote(pset.unique, safe="") != pset.unique:
        raise ValueError("unique ID must be URL friendly")
    if pset.note == "":
        raise ValueError("note cannot be empty")
    pset.tags[:] = sorted([tag.strip() for tag in list(pset.tags)])
    _set_ts(pset.updated_at, now)
    old_psps = tx.execute(
        "SELECT * FROM problem_set_problems WHERE problem_set_id = ? ORDER BY problem_id", (pset.id,)
    ).fetchall()
    sorted_new = sorted(list(bundle.problem_set_problems), key=lambda x: x.problem_id)
    old_ids = [int(row["problem_id"]) for row in old_psps]
    new_ids = [int(psp.problem_id) for psp in sorted_new]
    changes = old_ids != new_ids
    assignment_count = int(tx.execute("SELECT COUNT(1) AS c FROM assignments WHERE problem_set_id = ?", (pset.id,)).fetchone()["c"])
    if assignment_count > 0 and changes:
        raise ValueError("cannot change the set of problems in a problem set that is already in use")
    tx.execute(
        "UPDATE problem_sets SET unique_id = ?, note = ?, tags = ?, created_at = ?, updated_at = ? WHERE id = ?",
        (
            pset.unique,
            pset.note,
            json.dumps(list(pset.tags)),
            _rfc3339_round_sec(_ts_to_dt(pset.created_at)),
            _rfc3339_round_sec(_ts_to_dt(pset.updated_at)),
            pset.id,
        ),
    )
    tx.execute("DELETE FROM problem_set_problems WHERE problem_set_id = ?", (pset.id,))
    for psp in sorted_new:
        psp.problem_set_id = pset.id
        if psp.weight <= 0.0:
            psp.weight = 1.0
        tx.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, weight) VALUES (?, ?, ?)",
            (psp.problem_set_id, psp.problem_id, psp.weight),
        )
    del bundle.problem_set_problems[:]
    bundle.problem_set_problems.extend(sorted_new)
    return bundle


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


def _save_commit_files(tx: sqlite3.Connection, commit_id: int, files: dict[str, bytes]) -> None:
    tx.execute("DELETE FROM commit_files WHERE commit_id = ?", (commit_id,))
    for name in sorted(files.keys()):
        tx.execute(
            "INSERT INTO commit_files(commit_id, path, content) VALUES (?, ?, ?)",
            (commit_id, name, bytes(files[name] or b"")),
        )


def save_commit_bundle_common(
    tx: sqlite3.Connection,
    current_user_id: int,
    bundle: pb.CommitBundle,
    daycare_secret: str,
    root_files_dir: str,
    ip_allowed: bool,
    assign_host: Callable[[set[str]], str],
) -> pb.CommitBundle:
    now = _timestamp_now()
    if bundle.HasField("problem_type") and bundle.problem_type.name != "":
        raise ValueError("bundle must not include a problem type object")
    if bundle.problem_type_signature != "":
        raise ValueError("bundle must not include a problem type signature")
    if bundle.HasField("problem") and bundle.problem.unique != "":
        raise ValueError("bundle must not include a problem object")
    if len(bundle.problem_steps) != 0:
        raise ValueError("bundle must not include problem step objects")
    if bundle.problem_signature != "":
        raise ValueError("bundle must not include problem signature")
    if bundle.commit_signature != "" and bundle.hostname == "":
        raise ValueError("bundle must include daycare hostname")
    if bundle.user_id != current_user_id:
        raise ValueError("bundle must include user's ID")
    if not bundle.HasField("commit"):
        raise ValueError("bundle must include commit")
    commit = bundle.commit

    assignment = tx.execute(
        "SELECT * FROM assignments WHERE id = ? AND user_id = ? AND (? OR NOT restricted)",
        (commit.assignment_id, current_user_id, 1 if ip_allowed else 0),
    ).fetchone()
    is_instructor = False
    if assignment is None:
        assignment = tx.execute(
            "SELECT assignments.* FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id "
            "WHERE user_assignments.assignment_id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted)",
            (commit.assignment_id, current_user_id, 1 if ip_allowed else 0),
        ).fetchone()
        if assignment is not None:
            is_instructor = True
    if assignment is None:
        raise sqlite3.Error("not found")

    course_wide = tx.execute(
        "SELECT lock_at FROM assignments WHERE instructor AND lti_id = ? AND lock_at IS NOT NULL ORDER BY lock_at DESC LIMIT 1",
        (assignment["lti_id"],),
    ).fetchone()
    if course_wide is not None:
        course_wide_lock = _ts_to_dt(course_wide["lock_at"])
        student_lock = _ts_to_dt(assignment["lock_at"]) if assignment["lock_at"] else None
        if (student_lock is not None and now > student_lock) or (student_lock is None and now > course_wide_lock):
            raise ValueError("A commit cannot be submitted after the assignment is locked.")

    problem = tx.execute("SELECT * FROM problems WHERE id = ?", (commit.problem_id,)).fetchone()
    if problem is None:
        raise sqlite3.Error("not found")
    step_count = int(tx.execute("SELECT COUNT(1) AS c FROM problem_steps WHERE problem_id = ?", (commit.problem_id,)).fetchone()["c"])
    if step_count < 1:
        raise ValueError(f"no steps found for problem {commit.problem_id}")
    if commit.step < 1 or commit.step > step_count:
        raise ValueError("commit step is invalid")
    step_row = tx.execute(
        "SELECT * FROM problem_steps WHERE problem_id = ? AND step = ?", (commit.problem_id, commit.step)
    ).fetchone()
    if step_row is None:
        raise sqlite3.Error("not found")
    loaded_whitelist = _json_load(step_row["whitelist"], {})
    step_whitelist = loaded_whitelist if isinstance(loaded_whitelist, dict) else {}
    problem_type = _load_problem_type(tx, root_files_dir, str(step_row["problem_type"]))

    loaded_scores = _json_load(assignment["raw_scores"], {})
    raw_scores = loaded_scores if isinstance(loaded_scores, dict) else {}
    problem_unique = str(problem["unique_id"])
    loaded_problem_scores = raw_scores.get(problem_unique, [])
    problem_scores = loaded_problem_scores if isinstance(loaded_problem_scores, list) else []
    scores: list[float] = []
    for value in problem_scores:
        try:
            scores.append(float(value))
        except (TypeError, ValueError):
            continue
    for i in range(int(commit.step) - 1):
        if i >= len(scores) or scores[i] != 1.0:
            raise ValueError(f"commit is for step {commit.step}, but user has not passed step {i+1}")

    latest = tx.execute(
        "SELECT step FROM commits WHERE assignment_id = ? AND problem_id = ? ORDER BY step DESC LIMIT 1",
        (commit.assignment_id, commit.problem_id),
    ).fetchone()
    if latest is not None and int(latest["step"]) > int(commit.step):
        raise ValueError(
            f"commit is for step {commit.step}, but user has already started work on step {int(latest['step'])}"
        )

    _normalize_commit(commit, now, {str(k): bool(v) for k, v in step_whitelist.items()})

    existing = tx.execute(
        "SELECT * FROM commits WHERE assignment_id = ? AND problem_id = ? AND step = ? LIMIT 1",
        (commit.assignment_id, commit.problem_id, commit.step),
    ).fetchone()
    if existing is None:
        commit.id = 0
    else:
        commit.id = int(existing["id"])
        _set_ts(commit.created_at, _ts_to_dt(existing["created_at"]))

    steps: list[pb.ProblemStep] = [pb.ProblemStep() for _ in range(step_count)]
    only_step = pb.ProblemStep(
        problem_id=int(step_row["problem_id"]),
        step=int(step_row["step"]),
        problem_type=str(step_row["problem_type"]),
        note=str(step_row["note"]),
        instructions=str(step_row["instructions"]),
        weight=float(step_row["weight"]),
        whitelist={str(k): bool(v) for k, v in step_whitelist.items()},
    )
    files_rows = tx.execute(
        "SELECT path, content FROM problem_step_files WHERE problem_id = ? AND step = ?",
        (commit.problem_id, commit.step),
    ).fetchall()
    only_step.files.update({str(r["path"]): bytes(r["content"] or b"") for r in files_rows})
    steps[commit.step - 1] = only_step
    loaded_tags = _json_load(problem["tags"], [])
    tags = loaded_tags if isinstance(loaded_tags, list) else []
    loaded_options = _json_load(problem["options"], [])
    options = loaded_options if isinstance(loaded_options, list) else []
    pb_problem = pb.Problem(
        id=int(problem["id"]),
        unique=str(problem["unique_id"]),
        note=str(problem["note"]),
        tags=[str(x) for x in tags],
        options=[str(x) for x in options],
    )
    _set_ts(pb_problem.created_at, _ts_to_dt(problem["created_at"]))
    _set_ts(pb_problem.updated_at, _ts_to_dt(problem["updated_at"]))

    type_sig = compute_problem_type_signature(problem_type, daycare_secret)
    problem_sig = compute_problem_signature(pb_problem, steps, daycare_secret)
    commit_sig = compute_commit_signature(commit, type_sig, problem_sig, bundle.hostname, bundle.user_id, daycare_secret)

    if bundle.commit_signature != "":
        if bundle.commit_signature != commit_sig:
            raise ValueError("commit signature mismatch")
        age = now - _ts_to_dt(commit.updated_at)
        if age < timedelta(0):
            age = -age
        if age > SIGNED_COMMIT_TIMEOUT:
            raise ValueError("commit signature has expired")

    action = commit.action
    if bundle.commit_signature == "":
        commit.action = ""
    if not is_instructor:
        if commit.id == 0:
            cur = tx.execute(
                "INSERT INTO commits(assignment_id, problem_id, step, action, note, transcript, report_card, score, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    commit.assignment_id,
                    commit.problem_id,
                    commit.step,
                    commit.action,
                    commit.note,
                    _commit_to_json_transcript(commit),
                    _report_card_to_json(commit.report_card if commit.HasField("report_card") else None),
                    commit.score,
                    _rfc3339_round_sec(_ts_to_dt(commit.created_at)),
                    _rfc3339_round_sec(_ts_to_dt(commit.updated_at)),
                ),
            )
            commit.id = _required_lastrowid(cur.lastrowid)
        else:
            tx.execute(
                "UPDATE commits SET action = ?, note = ?, transcript = ?, report_card = ?, score = ?, updated_at = ? WHERE id = ?",
                (
                    commit.action,
                    commit.note,
                    _commit_to_json_transcript(commit),
                    _report_card_to_json(commit.report_card if commit.HasField("report_card") else None),
                    commit.score,
                    _rfc3339_round_sec(_ts_to_dt(commit.updated_at)),
                    commit.id,
                ),
            )
        _save_commit_files(tx, commit.id, dict(commit.files))
        if not commit.HasField("report_card"):
            tx.execute(
                "UPDATE assignments SET updated_at = ? WHERE id = ?",
                (_rfc3339_round_sec(now), int(assignment["id"])),
            )
    commit.action = action

    if bundle.hostname == "":
        bundle.hostname = assign_host({problem_type.name})
    commit_sig = compute_commit_signature(commit, type_sig, problem_sig, bundle.hostname, bundle.user_id, daycare_secret)
    signed = pb.CommitBundle(
        problem_type=problem_type,
        problem_type_signature=type_sig,
        problem=pb_problem,
        problem_steps=steps,
        problem_signature=problem_sig,
        hostname=bundle.hostname,
        user_id=bundle.user_id,
        commit=commit,
        commit_signature=commit_sig,
    )
    if commit.HasField("report_card") and not is_instructor:
        score = _report_card_score(commit.report_card)
        while len(scores) < int(commit.step):
            scores.append(0.0)
        scores[int(commit.step) - 1] = score
        raw_scores[problem_unique] = scores
        major, minor = _problem_weights(tx, int(assignment["problem_set_id"]))
        total_score = _assignment_compute_score(raw_scores, major, minor)
        tx.execute(
            "UPDATE assignments SET raw_scores = ?, score = ?, updated_at = ? WHERE id = ?",
            (json.dumps(raw_scores), total_score, _rfc3339_round_sec(now), int(assignment["id"])),
        )
    return signed
