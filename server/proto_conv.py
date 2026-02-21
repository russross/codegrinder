from __future__ import annotations

import json
import base64
from datetime import UTC, datetime, timedelta
from typing import Any

import codegrinder_pb2 as pb


def parse_time(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        dt = raw
    else:
        text = str(raw)
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_timestamp(value: Any | None) -> Any | None:
    if value is None:
        return None
    ts = pb.google_dot_protobuf_dot_timestamp__pb2.Timestamp()  # type: ignore[unresolved-attribute]
    ts.FromDatetime(parse_time(value))
    return ts


def to_duration(value: timedelta | float | int | None) -> Any | None:
    if value is None:
        return None
    if isinstance(value, timedelta):
        td = value
    else:
        td = timedelta(seconds=float(value))
    d = pb.google_dot_protobuf_dot_duration__pb2.Duration()  # type: ignore[unresolved-attribute]
    d.FromTimedelta(td)
    return d


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


def user_row_to_pb(row: Any) -> pb.User:
    return pb.User(
        id=int(row["id"]),
        name=str(row["name"]),
        email=str(row["email"]),
        lti_id=str(row["lti_id"]),
        image_url=str(row["lti_image_url"] or ""),
        canvas_login=str(row["canvas_login"] or ""),
        canvas_id=int(row["canvas_id"] or 0),
        author=bool(row["author"]),
        admin=bool(row["admin"]),
        created_at=to_timestamp(row["created_at"]),
        updated_at=to_timestamp(row["updated_at"]),
        last_signed_in_at=to_timestamp(row["last_signed_in_at"]),
    )


def course_row_to_pb(row: Any) -> pb.Course:
    return pb.Course(
        id=int(row["id"]),
        name=str(row["name"]),
        label=str(row["lti_label"]),
        lti_id=str(row["lti_id"]),
        canvas_id=int(row["canvas_id"] or 0),
        created_at=to_timestamp(row["created_at"]),
        updated_at=to_timestamp(row["updated_at"]),
    )


def assignment_row_to_pb(row: Any) -> pb.Assignment:
    loaded_scores = _json_load(row["raw_scores"], {})
    raw_scores = loaded_scores if isinstance(loaded_scores, dict) else {}
    mapped: dict[str, pb.ScoreList] = {}
    for key, values in raw_scores.items():
        score_values: list[float] = []
        if isinstance(values, list):
            for value in values:
                try:
                    score_values.append(float(value))
                except (TypeError, ValueError):
                    continue
        mapped[str(key)] = pb.ScoreList(scores=score_values)

    return pb.Assignment(
        id=int(row["id"]),
        course_id=int(row["course_id"]),
        problem_set_id=int(row["problem_set_id"] or 0),
        user_id=int(row["user_id"]),
        roles=str(row["roles"] or ""),
        instructor=bool(row["instructor"]),
        raw_scores=mapped,
        score=float(row["score"] or 0.0),
        grade_id=str(row["grade_id"] or ""),
        lti_id=str(row["lti_id"] or ""),
        canvas_title=str(row["canvas_title"] or ""),
        canvas_id=int(row["canvas_id"] or 0),
        canvas_api_domain=str(row["canvas_api_domain"] or ""),
        outcome_url=str(row["outcome_url"] or ""),
        outcome_ext_url=str(row["outcome_ext_url"] or ""),
        outcome_ext_accepted=str(row["outcome_ext_accepted"] or ""),
        finished_url=str(row["finished_url"] or ""),
        consumer_key=str(row["consumer_key"] or ""),
        unlock_at=to_timestamp(row["unlock_at"]),
        due_at=to_timestamp(row["due_at"]),
        lock_at=to_timestamp(row["lock_at"]),
        created_at=to_timestamp(row["created_at"]),
        updated_at=to_timestamp(row["updated_at"]),
    )


def problem_set_row_to_pb(row: Any) -> pb.ProblemSet:
    loaded_tags = _json_load(row["tags"], [])
    tags = loaded_tags if isinstance(loaded_tags, list) else []
    return pb.ProblemSet(
        id=int(row["id"]),
        unique=str(row["unique_id"]),
        note=str(row["note"]),
        tags=[str(x) for x in tags],
        created_at=to_timestamp(row["created_at"]),
        updated_at=to_timestamp(row["updated_at"]),
    )


def problem_row_to_pb(row: Any) -> pb.Problem:
    loaded_tags = _json_load(row["tags"], [])
    tags = loaded_tags if isinstance(loaded_tags, list) else []
    loaded_options = _json_load(row["options"], [])
    options = loaded_options if isinstance(loaded_options, list) else []
    return pb.Problem(
        id=int(row["id"]),
        unique=str(row["unique_id"]),
        note=str(row["note"]),
        tags=[str(x) for x in tags],
        options=[str(x) for x in options],
        created_at=to_timestamp(row["created_at"]),
        updated_at=to_timestamp(row["updated_at"]),
    )


def problem_step_row_to_pb(row: Any) -> pb.ProblemStep:
    loaded_whitelist = _json_load(row["whitelist"], {})
    whitelist = loaded_whitelist if isinstance(loaded_whitelist, dict) else {}
    return pb.ProblemStep(
        problem_id=int(row["problem_id"]),
        step=int(row["step"]),
        problem_type=str(row["problem_type"]),
        note=str(row["note"]),
        instructions=str(row["instructions"]),
        weight=float(row["weight"]),
        whitelist={str(k): bool(v) for k, v in whitelist.items()},
    )


def problem_set_problem_row_to_pb(row: Any) -> pb.ProblemSetProblem:
    return pb.ProblemSetProblem(
        problem_set_id=int(row["problem_set_id"]),
        problem_id=int(row["problem_id"]),
        weight=float(row["weight"]),
    )


def report_card_from_json(raw: Any) -> pb.ReportCard | None:
    if raw is None or raw == "":
        return None
    loaded = _json_load(raw, None)
    if not isinstance(loaded, dict):
        return None
    data = loaded
    results: list[pb.ReportCardResult] = []
    raw_results = data.get("results")
    result_items = raw_results if isinstance(raw_results, list) else []
    for item in result_items:
        if not isinstance(item, dict):
            continue
        results.append(
            pb.ReportCardResult(
                name=str(item.get("name", "")),
                outcome=str(item.get("outcome", "")),
                details=str(item.get("details", "")),
                context=str(item.get("context", "")),
            )
        )
    duration_seconds = 0.0
    duration_raw = data.get("duration")
    if isinstance(duration_raw, (int, float)):
        duration_seconds = float(duration_raw) / 1_000_000_000.0
    elif isinstance(duration_raw, str):
        # protobuf JSON duration format (example: "1.500s")
        text = duration_raw.strip()
        if text.endswith("s"):
            try:
                duration_seconds = float(text[:-1])
            except ValueError:
                duration_seconds = 0.0
    elif isinstance(duration_raw, dict):
        seconds = int(duration_raw.get("seconds", 0) or 0)
        nanos = int(duration_raw.get("nanos", 0) or 0)
        duration_seconds = float(seconds) + float(nanos) / 1_000_000_000.0
    rc = pb.ReportCard(
        passed=bool(data.get("passed", False)),
        note=str(data.get("note", "")),
        results=results,
    )
    duration = to_duration(duration_seconds)
    if duration is not None:
        rc.duration.CopyFrom(duration)
    return rc


def event_message_from_json_item(item: dict[str, Any]) -> pb.EventMessage:
    stream_data = item.get("streamData", "")
    stream_bytes: bytes
    if isinstance(stream_data, str):
        try:
            stream_bytes = base64.b64decode(stream_data, validate=True)
        except Exception:
            stream_bytes = stream_data.encode("utf-8")
    else:
        stream_bytes = bytes(stream_data or b"")

    files_obj: dict[str, bytes] = {}
    raw_files = item.get("files")
    files_map = raw_files if isinstance(raw_files, dict) else {}
    for key, value in files_map.items():
        if isinstance(value, str):
            try:
                files_obj[str(key)] = base64.b64decode(value, validate=True)
            except Exception:
                files_obj[str(key)] = value.encode("utf-8")
        else:
            files_obj[str(key)] = bytes(value or b"")

    raw_exec = item.get("execCommand")
    exec_command = raw_exec if isinstance(raw_exec, list) else []
    event = pb.EventMessage(
        event=str(item.get("event", "")),
        exec_command=[str(x) for x in exec_command],
        exit_status=int(item.get("exitStatus", 0) or 0),
        stream_data=stream_bytes,
        error=str(item.get("error", "")),
        files=files_obj,
    )
    if "time" in item and item["time"]:
        ts = to_timestamp(item["time"])
        if ts is not None:
            event.time.CopyFrom(ts)
    if item.get("reportCard") is not None:
        rc = report_card_from_json(item.get("reportCard"))
        if rc is not None:
            event.report_card.CopyFrom(rc)
    return event


def commit_row_to_pb(row: Any, files: dict[str, bytes]) -> pb.Commit:
    transcript_data = _json_load(row["transcript"], [])
    transcript = [
        event_message_from_json_item(item)
        for item in transcript_data
        if isinstance(item, dict)
    ]
    rc = report_card_from_json(row["report_card"])
    commit = pb.Commit(
        id=int(row["id"]),
        assignment_id=int(row["assignment_id"]),
        problem_id=int(row["problem_id"]),
        step=int(row["step"]),
        action=str(row["action"] or ""),
        note=str(row["note"] or ""),
        files=files,
        transcript=transcript,
        score=float(row["score"] or 0.0),
        created_at=to_timestamp(row["created_at"]),
        updated_at=to_timestamp(row["updated_at"]),
    )
    if rc is not None:
        commit.report_card.CopyFrom(rc)
    return commit
