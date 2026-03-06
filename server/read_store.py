from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Callable

import codegrinder_pb2 as pb
from proto_conv import (
    assignment_list_item_row_to_pb,
    assignment_row_to_pb,
    course_row_to_pb,
    problem_row_to_pb,
    problem_set_problem_row_to_pb,
    problem_set_row_to_pb,
    problem_step_row_to_pb,
    user_row_to_pb,
)


def _q(conn: sqlite3.Connection, sql: str, args: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    cur = conn.execute(sql, args)
    return list(cur.fetchall())


def _q1(conn: sqlite3.Connection, sql: str, args: tuple[Any, ...] = ()) -> sqlite3.Row:
    row = conn.execute(sql, args).fetchone()
    if row is None:
        raise sqlite3.Error("not found")
    return row


def add_where_eq(where: str, args: list[Any], label: str, value: Any) -> tuple[str, list[Any]]:
    if where == "":
        where = " WHERE"
    else:
        where += " AND"
    where += f" {label} = ?"
    args.append(value)
    return where, args


def add_where_like(where: str, args: list[Any], label: str, value: str) -> tuple[str, list[Any]]:
    if where == "":
        where = " WHERE"
    else:
        where += " AND"
    where += f" {label} LIKE ?"
    args.append(f"%{value.lower()}%")
    return where, args


def load_user_by_id(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    return _q1(
        conn,
        "SELECT users.*, EXISTS(SELECT 1 FROM authors WHERE authors.user_id = users.user_id) AS author FROM users WHERE users.user_id = ?",
        (user_id,),
    )


def get_user_me_pb(current_user_row: sqlite3.Row) -> pb.User:
    return user_row_to_pb(current_user_row)


def get_course_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, course_id: str) -> pb.Course:
    row = _q1(
        conn,
        "SELECT courses.* FROM courses NATURAL JOIN user_assignments "
        "WHERE user_assignments.viewer_user_id = ? AND user_assignments.course_id = ?",
        (str(current_user["user_id"]), course_id),
    )
    return course_row_to_pb(row)


def get_user_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, user_id: str) -> pb.User:
    row = _q1(
        conn,
        "SELECT users.*, EXISTS(SELECT 1 FROM authors WHERE authors.user_id = users.user_id) AS author "
        "FROM users JOIN user_users ON users.user_id = user_users.other_user_id "
        "WHERE user_users.viewer_user_id = ? AND user_users.other_user_id = ?",
        (str(current_user["user_id"]), user_id),
    )
    return user_row_to_pb(row)


def get_assignments_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, search_terms: list[str], ip_allowed: bool) -> list[pb.Assignment]:
    where = ""
    args: list[Any] = []
    for term in search_terms:
        where, args = add_where_like(where, args, "assignment_search_fields.search_text", term)
    where, args = add_where_eq(where, args, "user_assignments.viewer_user_id", str(current_user["user_id"]))
    if where == "":
        where = " WHERE"
    else:
        where += " AND"
    where += " (? OR NOT user_assignments.restricted)"
    args.append(1 if ip_allowed else 0)
    rows = _q(
        conn,
        "SELECT assignments.* FROM assignments JOIN assignment_search_fields "
        "NATURAL JOIN assignment_search_fields "
        "JOIN user_assignments ON user_assignments.assignment_user_id = assignments.user_id "
        "AND user_assignments.course_id = assignments.course_id "
        "AND user_assignments.problem_set_id = assignments.problem_set_id"
        + where
        + " ORDER BY assignments.course_id, assignments.due_at, assignments.problem_set_id",
        tuple(args),
    )
    return [assignment_row_to_pb(row) for row in rows]


def get_assignment_list_items_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    search_terms: list[str],
    include_student_context: bool,
    ip_allowed: bool,
) -> list[pb.AssignmentListItem]:
    where = ""
    args: list[Any] = []
    for term in search_terms:
        where, args = add_where_like(where, args, "assignment_search_fields.search_text", term)
    where, args = add_where_eq(where, args, "user_assignments.viewer_user_id", str(current_user["user_id"]))
    if not include_student_context:
        where, args = add_where_eq(where, args, "assignments.user_id", str(current_user["user_id"]))
    if where == "":
        where = " WHERE"
    else:
        where += " AND"
    where += " (? OR NOT user_assignments.restricted)"
    args.append(1 if ip_allowed else 0)

    rows = _q(
        conn,
        "SELECT "
        "assignments.user_id, assignments.course_id, assignments.problem_set_id, "
        "assignments.unlock_at, assignments.due_at, assignments.lock_at, "
        "problem_sets.problem_set_note, courses.course_name, users.user_name, users.user_login "
        "FROM assignments "
        "JOIN user_assignments ON user_assignments.assignment_user_id = assignments.user_id "
        "AND user_assignments.course_id = assignments.course_id "
        "AND user_assignments.problem_set_id = assignments.problem_set_id "
        "JOIN assignment_search_fields ON assignment_search_fields.user_id = assignments.user_id "
        "AND assignment_search_fields.course_id = assignments.course_id "
        "AND assignment_search_fields.problem_set_id = assignments.problem_set_id "
        "JOIN courses ON courses.course_id = assignments.course_id "
        "JOIN users ON users.user_id = assignments.user_id "
        "JOIN problem_sets ON problem_sets.problem_set_id = assignments.problem_set_id "
        + where
        + " ORDER BY assignments.course_id, assignments.due_at, assignments.lock_at, assignments.user_id, assignments.problem_set_id",
        tuple(args),
    )
    items = [assignment_list_item_row_to_pb(row) for row in rows]
    if include_student_context:
        return items
    for item in items:
        item.user_name = ""
        item.user_login = ""
    return items


def get_user_assignments_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, user_id: str, ip_allowed: bool) -> list[pb.Assignment]:
    rows = _q(
        conn,
        "SELECT assignments.* FROM assignments JOIN user_assignments "
        "ON assignments.user_id = user_assignments.assignment_user_id "
        "AND assignments.course_id = user_assignments.course_id "
        "AND assignments.problem_set_id = user_assignments.problem_set_id "
        "WHERE assignments.user_id = ? AND user_assignments.viewer_user_id = ? AND (? OR NOT user_assignments.restricted) "
        "ORDER BY assignments.course_id, assignments.due_at, assignments.problem_set_id",
        (user_id, str(current_user["user_id"]), 1 if ip_allowed else 0),
    )
    return [assignment_row_to_pb(row) for row in rows]


def get_assignment_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    assignment_user_id: str,
    assignment_course_id: str,
    assignment_problem_set_id: str,
    ip_allowed: bool,
) -> pb.Assignment:
    row = _q1(
        conn,
        "SELECT assignments.* FROM assignments JOIN user_assignments "
        "ON assignments.user_id = user_assignments.assignment_user_id "
        "AND assignments.course_id = user_assignments.course_id "
        "AND assignments.problem_set_id = user_assignments.problem_set_id "
        "WHERE assignments.user_id = ? AND assignments.course_id = ? AND assignments.problem_set_id = ? "
        "AND user_assignments.viewer_user_id = ? AND (? OR NOT user_assignments.restricted)",
        (
            assignment_user_id,
            assignment_course_id,
            assignment_problem_set_id,
            str(current_user["user_id"]),
            1 if ip_allowed else 0,
        ),
    )
    return assignment_row_to_pb(row)


def load_commit_files(
    conn: sqlite3.Connection,
    user_id: str,
    course_id: str,
    problem_set_id: str,
    problem_id: str,
    step: int,
) -> dict[str, bytes]:
    rows = _q(
        conn,
        "SELECT path, content FROM commit_files WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
        (user_id, course_id, problem_set_id, problem_id, step),
    )
    return {str(row["path"]): bytes(row["content"] or b"") for row in rows}


def _student_owned_paths_for_step(conn: sqlite3.Connection, problem_id: str, step_number: int) -> list[str]:
    row = _q1(
        conn,
        "SELECT whitelist FROM problem_step_whitelist WHERE problem_id = ? AND step_number = ?",
        (problem_id, step_number),
    )
    raw = row["whitelist"]
    if raw is None:
        return []
    if isinstance(raw, bytes):
        text = raw.decode("utf-8")
    else:
        text = str(raw)
    try:
        loaded = json.loads(text)
    except json.JSONDecodeError:
        loaded = {}
    if not isinstance(loaded, dict):
        return []
    return sorted(str(key) for key in loaded.keys())


def _starter_student_files(
    conn: sqlite3.Connection,
    user_id: str,
    course_id: str,
    problem_set_id: str,
    problem_id: str,
    step_number: int,
    step_files: dict[str, bytes],
    student_owned_paths: set[str],
) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    if step_number > 1:
        prev = conn.execute(
            "SELECT user_id, course_id, problem_set_id, problem_id, step_number FROM commits "
            "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ? "
            "ORDER BY commit_updated_at DESC LIMIT 1",
            (user_id, course_id, problem_set_id, problem_id, step_number - 1),
        ).fetchone()
        if prev is not None:
            files = load_commit_files(
                conn,
                str(prev["user_id"]),
                str(prev["course_id"]),
                str(prev["problem_set_id"]),
                str(prev["problem_id"]),
                int(prev["step_number"]),
            )
    for path, content in step_files.items():
        if path in student_owned_paths:
            files[path] = content
    return files


def _system_owned_files_for_step(
    load_problem_type_files: Callable[[str], dict[str, bytes]],
    problem_type: str,
    step_instructions: str,
    step_files: dict[str, bytes],
    student_owned_paths: set[str],
) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for path, content in step_files.items():
        if path not in student_owned_paths:
            files[path] = content
    files["doc/index.html"] = step_instructions.encode("utf-8")
    for path, content in load_problem_type_files(problem_type).items():
        files[str(Path(path))] = content
    return files


def get_assignment_info_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    assignment_user_id: str,
    assignment_course_id: str,
    assignment_problem_set_id: str,
    ip_allowed: bool,
) -> pb.GetAssignmentInfoResponse:
    assignment = get_assignment_pb(
        conn,
        current_user,
        assignment_user_id,
        assignment_course_id,
        assignment_problem_set_id,
        ip_allowed,
    )
    course = get_course_pb(conn, current_user, assignment.course_id)
    problem_set = get_problem_set_pb(conn, current_user, assignment.problem_set_id)
    problem_rows = _q(
        conn,
        "SELECT problem_set_problems.problem_id, problems.problem_note "
        "FROM problem_set_problems NATURAL JOIN problems "
        "WHERE problem_set_problems.problem_set_id = ? "
        "ORDER BY problem_set_problems.problem_id",
        (assignment.problem_set_id,),
    )
    total_rows = _q(
        conn,
        "SELECT problem_id, MAX(step_number) AS total_steps "
        "FROM problem_steps GROUP BY problem_id",
    )
    total_steps_by_problem = {
        str(row["problem_id"]): max(1, int(row["total_steps"] or 0))
        for row in total_rows
    }
    success_rows = _q(
        conn,
        "SELECT problem_id, step_number "
        "FROM commits "
        "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? "
        "AND json_extract(report_card, '$.passed') = 1 "
        "AND score = 1.0 "
        "GROUP BY problem_id, step_number",
        (assignment.user_id, assignment.course_id, assignment.problem_set_id),
    )
    success_by_problem: dict[str, set[int]] = {}
    for row in success_rows:
        problem_id = str(row["problem_id"])
        if problem_id not in success_by_problem:
            success_by_problem[problem_id] = set()
        success_by_problem[problem_id].add(int(row["step_number"]))
    problems: list[pb.AssignmentProblemInfo] = []
    for row in problem_rows:
        problem_id = str(row["problem_id"])
        total_steps = total_steps_by_problem.get(problem_id, 1)
        current_step = total_steps
        success_steps = success_by_problem.get(problem_id, set())
        for step_number in range(1, total_steps + 1):
            if step_number not in success_steps:
                current_step = step_number
                break
        problems.append(
            pb.AssignmentProblemInfo(
                problem_id=problem_id,
                problem_note=str(row["problem_note"]),
                current_step_number=current_step,
                total_steps=total_steps,
            )
        )
    return pb.GetAssignmentInfoResponse(
        assignment=pb.AssignmentKey(
            user_id=assignment.user_id,
            course_id=assignment.course_id,
            problem_set_id=assignment.problem_set_id,
        ),
        problem_set_note=problem_set.problem_set_note,
        course_name=course.course_name,
        problems=problems,
    )


def _resolve_current_step_number(
    conn: sqlite3.Connection,
    user_id: str,
    course_id: str,
    problem_set_id: str,
    problem_id: str,
) -> int:
    row = _q1(
        conn,
        "SELECT MAX(step_number) AS total_steps FROM problem_steps WHERE problem_id = ?",
        (problem_id,),
    )
    total_steps = max(1, int(row["total_steps"] or 0))
    success_rows = _q(
        conn,
        "SELECT step_number "
        "FROM commits "
        "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? "
        "AND json_extract(report_card, '$.passed') = 1 "
        "AND score = 1.0 "
        "GROUP BY step_number",
        (user_id, course_id, problem_set_id, problem_id),
    )
    success_steps = {int(success_row["step_number"]) for success_row in success_rows}
    for candidate in range(1, total_steps + 1):
        if candidate not in success_steps:
            return candidate
    return total_steps


def get_problem_step_files_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    assignment_user_id: str,
    assignment_course_id: str,
    assignment_problem_set_id: str,
    problem_id: str,
    step_number: int,
    reset_to_step_start: bool,
    ip_allowed: bool,
    load_problem_type_files: Callable[[str], dict[str, bytes]],
) -> pb.GetProblemStepFilesResponse:
    assignment = get_assignment_pb(
        conn,
        current_user,
        assignment_user_id,
        assignment_course_id,
        assignment_problem_set_id,
        ip_allowed,
    )
    _q1(
        conn,
        "SELECT 1 FROM problem_set_problems WHERE problem_set_id = ? AND problem_id = ?",
        (assignment.problem_set_id, problem_id),
    )
    resolved_step_number = step_number
    if resolved_step_number == 0:
        resolved_step_number = _resolve_current_step_number(
            conn,
            assignment.user_id,
            assignment.course_id,
            assignment.problem_set_id,
            problem_id,
        )
    step_row = _q1(
        conn,
        "SELECT * FROM problem_steps WHERE problem_id = ? AND step_number = ?",
        (problem_id, resolved_step_number),
    )
    total_steps_row = _q1(
        conn,
        "SELECT MAX(step_number) AS total_steps FROM problem_steps WHERE problem_id = ?",
        (problem_id,),
    )
    total_steps = max(1, int(total_steps_row["total_steps"] or 0))
    step_files = load_problem_step_files(conn, problem_id, resolved_step_number)
    student_owned_paths = set(_student_owned_paths_for_step(conn, problem_id, resolved_step_number))
    system_owned_files = _system_owned_files_for_step(
        load_problem_type_files,
        str(step_row["problem_type"]),
        str(step_row["step_instructions"]),
        step_files,
        student_owned_paths,
    )
    student_owned_files: dict[str, bytes]
    if reset_to_step_start:
        student_owned_files = _starter_student_files(
            conn,
            assignment.user_id,
            assignment.course_id,
            assignment.problem_set_id,
            problem_id,
            resolved_step_number,
            step_files,
            student_owned_paths,
        )
    else:
        commit_row = conn.execute(
            "SELECT user_id, course_id, problem_set_id, problem_id, step_number FROM commits "
            "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ? "
            "ORDER BY commit_updated_at DESC LIMIT 1",
            (assignment.user_id, assignment.course_id, assignment.problem_set_id, problem_id, resolved_step_number),
        ).fetchone()
        if commit_row is None:
            student_owned_files = _starter_student_files(
                conn,
                assignment.user_id,
                assignment.course_id,
                assignment.problem_set_id,
                problem_id,
                resolved_step_number,
                step_files,
                student_owned_paths,
            )
        else:
            student_owned_files = load_commit_files(
                conn,
                str(commit_row["user_id"]),
                str(commit_row["course_id"]),
                str(commit_row["problem_set_id"]),
                str(commit_row["problem_id"]),
                int(commit_row["step_number"]),
            )
    return pb.GetProblemStepFilesResponse(
        step_number=resolved_step_number,
        total_steps=total_steps,
        system_owned_files=[
            pb.ProblemStepFileBlob(path=path, content=content)
            for path, content in sorted(system_owned_files.items())
        ],
        student_owned_files=[
            pb.ProblemStepFileBlob(path=path, content=content)
            for path, content in sorted(student_owned_files.items())
        ],
    )


def get_problem_types_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return _q(conn, "SELECT * FROM problem_types ORDER BY problem_type")


def get_problem_type_actions_rows(conn: sqlite3.Connection, problem_type: str) -> list[sqlite3.Row]:
    return _q(conn, "SELECT * FROM problem_type_actions WHERE problem_type = ?", (problem_type,))


def get_problem_row(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: str) -> sqlite3.Row:
    if bool(current_user["author"]):
        return _q1(conn, "SELECT * FROM problems WHERE problem_id = ?", (problem_id,))
    return _q1(
        conn,
        "SELECT problems.* FROM problems NATURAL JOIN user_problems "
        "WHERE user_problems.user_id = ? AND user_problems.problem_id = ?",
        (str(current_user["user_id"]), problem_id),
    )


def get_problems_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: str, problem_type: str, note: str) -> list[pb.Problem]:
    where = ""
    args: list[Any] = []
    if problem_id != "":
        where, args = add_where_eq(where, args, "problems.problem_id", problem_id)
    if problem_type != "":
        where, args = add_where_eq(where, args, "problem_steps.problem_type", problem_type)
    if note != "":
        where, args = add_where_like(where, args, "problems.problem_note", note)
    if bool(current_user["author"]):
        rows = _q(
            conn,
            "SELECT DISTINCT problems.* FROM problems NATURAL LEFT JOIN problem_steps"
            + where
            + " ORDER BY problems.problem_id",
            tuple(args),
        )
    else:
        where, args = add_where_eq(where, args, "user_problems.user_id", str(current_user["user_id"]))
        rows = _q(
            conn,
            "SELECT DISTINCT problems.* FROM problems "
            "NATURAL JOIN user_problems "
            "NATURAL LEFT JOIN problem_steps"
            + where
            + " ORDER BY problems.problem_id",
            tuple(args),
        )
    return [problem_row_to_pb(row) for row in rows]


def get_problem_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: str) -> pb.Problem:
    return problem_row_to_pb(get_problem_row(conn, current_user, problem_id))


def get_problem_steps_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: str) -> list[pb.ProblemStep]:
    if bool(current_user["author"]):
        rows = _q(
            conn,
            "SELECT problem_steps.*, problem_step_whitelist.whitelist FROM problem_steps "
            "NATURAL JOIN problem_step_whitelist "
            "WHERE problem_steps.problem_id = ? ORDER BY problem_steps.step_number",
            (problem_id,),
        )
    else:
        rows = _q(
            conn,
            "SELECT problem_steps.*, problem_step_whitelist.whitelist FROM problem_steps "
            "NATURAL JOIN problem_step_whitelist "
            "NATURAL JOIN user_problems "
            "WHERE user_problems.user_id = ? AND user_problems.problem_id = ? ORDER BY problem_steps.step_number",
            (str(current_user["user_id"]), problem_id),
        )
    if len(rows) == 0:
        raise sqlite3.Error("not found")
    out: list[pb.ProblemStep] = []
    for row in rows:
        step = problem_step_row_to_pb(row)
        if not bool(current_user["author"]):
            step.solution.clear()
        out.append(step)
    return out


def load_problem_step_files(conn: sqlite3.Connection, problem_id: str, step: int) -> dict[str, bytes]:
    rows = _q(conn, "SELECT path, content FROM problem_step_files WHERE problem_id = ? AND step_number = ?", (problem_id, step))
    return {str(row["path"]): bytes(row["content"] or b"") for row in rows}


def load_problem_step_solution(conn: sqlite3.Connection, problem_id: str, step: int) -> dict[str, bytes]:
    rows = _q(
        conn,
        "SELECT path, content FROM problem_step_solution_files WHERE problem_id = ? AND step_number = ?",
        (problem_id, step),
    )
    return {str(row["path"]): bytes(row["content"] or b"") for row in rows}


def get_problem_step_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: str, step_no: int) -> pb.ProblemStep:
    if bool(current_user["author"]):
        row = _q1(
            conn,
            "SELECT problem_steps.*, problem_step_whitelist.whitelist FROM problem_steps "
            "NATURAL JOIN problem_step_whitelist "
            "WHERE problem_steps.problem_id = ? AND problem_steps.step_number = ?",
            (problem_id, step_no),
        )
    else:
        row = _q1(
            conn,
            "SELECT problem_steps.*, problem_step_whitelist.whitelist FROM problem_steps "
            "NATURAL JOIN problem_step_whitelist "
            "NATURAL JOIN user_problems "
            "WHERE user_problems.user_id = ? AND problem_steps.problem_id = ? AND problem_steps.step_number = ?",
            (str(current_user["user_id"]), problem_id, step_no),
        )
    step = problem_step_row_to_pb(row)
    step.files.update(load_problem_step_files(conn, problem_id, step_no))
    if bool(current_user["author"]):
        step.solution.update(load_problem_step_solution(conn, problem_id, step_no))
    return step


def get_problem_sets_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    problem_set_id: str,
    note: str,
    search: list[str],
) -> list[pb.ProblemSet]:
    where = ""
    args: list[Any] = []
    search_flag = False
    for term in search:
        where, args = add_where_like(where, args, "problem_set_search_fields.search_text", term)
        search_flag = True
    if problem_set_id != "":
        where, args = add_where_eq(where, args, "problem_sets.problem_set_id", problem_set_id)
    if note != "":
        where, args = add_where_like(where, args, "problem_sets.problem_set_note", note)
    if bool(current_user["author"]):
        query = "SELECT problem_sets.* FROM problem_sets"
        if search_flag:
            query += " NATURAL JOIN problem_set_search_fields"
        query += where + " ORDER BY problem_sets.problem_set_id"
        rows = _q(conn, query, tuple(args))
    else:
        where, args = add_where_eq(where, args, "user_problem_sets.user_id", str(current_user["user_id"]))
        query = "SELECT problem_sets.* FROM problem_sets NATURAL JOIN user_problem_sets"
        if search_flag:
            query += " NATURAL JOIN problem_set_search_fields"
        query += where + " ORDER BY problem_sets.problem_set_id"
        rows = _q(conn, query, tuple(args))
    return [problem_set_row_to_pb(row) for row in rows]


def get_problem_set_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_set_id: str) -> pb.ProblemSet:
    if bool(current_user["author"]):
        row = _q1(conn, "SELECT * FROM problem_sets WHERE problem_set_id = ?", (problem_set_id,))
    else:
        row = _q1(
            conn,
            "SELECT problem_sets.* FROM problem_sets NATURAL JOIN user_problem_sets "
            "WHERE user_problem_sets.user_id = ? AND user_problem_sets.problem_set_id = ?",
            (str(current_user["user_id"]), problem_set_id),
        )
    return problem_set_row_to_pb(row)


def get_problem_set_problems_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_set_id: str) -> list[pb.ProblemSetProblem]:
    if bool(current_user["author"]):
        rows = _q(conn, "SELECT * FROM problem_set_problems WHERE problem_set_id = ? ORDER BY problem_id", (problem_set_id,))
    else:
        rows = _q(
            conn,
            "SELECT problem_set_problems.* FROM problem_set_problems NATURAL JOIN user_problem_sets "
            "WHERE user_problem_sets.user_id = ? AND problem_set_problems.problem_set_id = ? ORDER BY problem_id",
            (str(current_user["user_id"]), problem_set_id),
        )
    if len(rows) == 0:
        raise sqlite3.Error("not found")
    return [problem_set_problem_row_to_pb(row) for row in rows]


def search_problem_catalog_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    search_terms: list[str],
) -> pb.SearchProblemCatalogResponse:
    where = ""
    args: list[Any] = []
    for term in search_terms:
        lowered = f"%{term.lower()}%"
        if where == "":
            where = " WHERE"
        else:
            where += " AND"
        where += (
            " ("
            "LOWER(problem_sets.problem_set_id || ',' || problem_sets.problem_set_note || ',' || problem_sets.problem_set_tags) LIKE ? "
            "OR EXISTS ("
            "SELECT 1 FROM problem_set_problems "
            "JOIN problems ON problems.problem_id = problem_set_problems.problem_id "
            "WHERE problem_set_problems.problem_set_id = problem_sets.problem_set_id "
            "AND LOWER(problem_set_problems.problem_id || ',' || problems.problem_note || ',' || problems.problem_tags) LIKE ?"
            ")"
            ")"
        )
        args.append(lowered)
        args.append(lowered)

    if bool(current_user["author"]):
        set_rows = _q(
            conn,
            "SELECT problem_sets.* FROM problem_sets" + where + " ORDER BY problem_sets.problem_set_id",
            tuple(args),
        )
    else:
        if where == "":
            where = " WHERE"
        else:
            where += " AND"
        where += " user_problem_sets.user_id = ?"
        args.append(str(current_user["user_id"]))
        set_rows = _q(
            conn,
            "SELECT problem_sets.* FROM problem_sets "
            "JOIN user_problem_sets ON user_problem_sets.problem_set_id = problem_sets.problem_set_id"
            + where
            + " ORDER BY problem_sets.problem_set_id",
            tuple(args),
        )

    if len(set_rows) == 0:
        return pb.SearchProblemCatalogResponse(problem_sets=[])

    set_items: list[pb.ProblemCatalogSet] = []
    set_by_id: dict[str, pb.ProblemCatalogSet] = {}
    problem_by_key: dict[tuple[str, str], pb.ProblemCatalogProblem] = {}
    set_pbs = [problem_set_row_to_pb(row) for row in set_rows]
    for problem_set in set_pbs:
        item = pb.ProblemCatalogSet(
            problem_set_id=problem_set.problem_set_id,
            problem_set_note=problem_set.problem_set_note,
            problem_set_tags=list(problem_set.problem_set_tags),
        )
        set_items.append(item)
        set_by_id[problem_set.problem_set_id] = item

    placeholders = ", ".join("?" for _ in set_pbs)
    set_ids = tuple(problem_set.problem_set_id for problem_set in set_pbs)
    rows = _q(
        conn,
        "SELECT "
        "problem_set_problems.problem_set_id, "
        "problem_set_problems.problem_id, "
        "problem_set_problems.problem_weight, "
        "problems.problem_note, "
        "problem_steps.step_number, "
        "problem_steps.step_note, "
        "problem_steps.step_weight "
        "FROM problem_set_problems "
        "JOIN problems ON problems.problem_id = problem_set_problems.problem_id "
        "JOIN problem_steps ON problem_steps.problem_id = problem_set_problems.problem_id "
        f"WHERE problem_set_problems.problem_set_id IN ({placeholders}) "
        "ORDER BY problem_set_problems.problem_set_id, problem_set_problems.problem_id, problem_steps.step_number",
        set_ids,
    )

    for row in rows:
        problem_set_id = str(row["problem_set_id"])
        problem_id = str(row["problem_id"])
        key = (problem_set_id, problem_id)
        problem = problem_by_key.get(key)
        if problem is None:
            problem = set_by_id[problem_set_id].problems.add()
            problem.problem_id = problem_id
            problem.problem_note = str(row["problem_note"])
            problem.problem_weight = int(row["problem_weight"])
            problem_by_key[key] = problem
        step = problem.steps.add()
        step.step_number = int(row["step_number"])
        step.step_note = str(row["step_note"])
        step.step_weight = int(row["step_weight"])

    return pb.SearchProblemCatalogResponse(problem_sets=set_items)


def get_list_problems_bundle(
    conn: sqlite3.Connection, user_id: str, current_user: sqlite3.Row, ip_allowed: bool
) -> tuple[pb.User, list[pb.Assignment], list[pb.Course], list[pb.ProblemSet]]:
    user_pb = user_row_to_pb(current_user)
    assignments = get_user_assignments_pb(conn, current_user, user_id, ip_allowed)
    course_map: dict[str, pb.Course] = {}
    problem_set_map: dict[str, pb.ProblemSet] = {}
    for asst in assignments:
        if asst.course_id not in course_map:
            course_map[asst.course_id] = get_course_pb(conn, current_user, asst.course_id)
        if asst.problem_set_id not in problem_set_map:
            problem_set_map[asst.problem_set_id] = get_problem_set_pb(conn, current_user, asst.problem_set_id)
    return user_pb, assignments, list(course_map.values()), list(problem_set_map.values())


def problem_type_pb(problem_type: str, container: str, files: dict[str, bytes], action_rows: list[sqlite3.Row]) -> pb.ProblemType:
    actions: dict[str, pb.ProblemTypeAction] = {}
    for row in action_rows:
        actions[str(row["action"])] = pb.ProblemTypeAction(
            problem_type=str(row["problem_type"]),
            action=str(row["action"]),
            command=str(row["command"]),
            parser=str(row["parser"] or ""),
            max_cpu=int(row["max_cpu"]),
            max_fd=int(row["max_fd"]),
            max_file_size=int(row["max_file_size"]),
            max_memory=int(row["max_memory"]),
            max_threads=int(row["max_threads"]),
        )
    return pb.ProblemType(problem_type=problem_type, container=container, files=files, actions=actions)
