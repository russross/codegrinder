from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import codegrinder_pb2 as pb
from proto_conv import (
    assignment_row_to_pb,
    commit_row_to_pb,
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


def load_user_by_id(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row:
    return _q1(conn, "SELECT * FROM users WHERE id = ?", (user_id,))


def get_user_me_pb(current_user_row: sqlite3.Row) -> pb.User:
    return user_row_to_pb(current_user_row)


def get_courses_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, lti_label: str, name: str) -> list[pb.Course]:
    where = ""
    args: list[Any] = []
    if lti_label != "":
        where, args = add_where_eq(where, args, "lti_label", lti_label)
    if name != "":
        where, args = add_where_like(where, args, "name", name)
    where, args = add_where_eq(where, args, "assignments.user_id", int(current_user["id"]))
    rows = _q(
        conn,
        "SELECT DISTINCT courses.* FROM courses "
        "JOIN assignments ON courses.id = assignments.course_id"
        + where
        + " ORDER BY lti_label",
        tuple(args),
    )
    return [course_row_to_pb(row) for row in rows]


def get_course_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, course_id: int) -> pb.Course:
    row = _q1(
        conn,
        "SELECT courses.* FROM courses JOIN assignments ON courses.id = assignments.course_id "
        "WHERE assignments.user_id = ? AND assignments.course_id = ?",
        (int(current_user["id"]), course_id),
    )
    return course_row_to_pb(row)


def get_users_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    name: str,
    email: str,
    instructor: str,
    admin: str,
) -> list[pb.User]:
    def parse_bool_text(value: str, field: str) -> bool:
        lowered = value.strip().lower()
        if lowered in ("1", "t", "true"):
            return True
        if lowered in ("0", "f", "false"):
            return False
        raise ValueError(f"error parsing {field} value as boolean")

    where = ""
    args: list[Any] = []
    if name != "":
        where, args = add_where_like(where, args, "name", name)
    if email != "":
        where, args = add_where_like(where, args, "email", email)
    if instructor != "":
        val = parse_bool_text(instructor, "instructor")
        where, args = add_where_eq(where, args, "instructor", int(val))
    if admin != "":
        val = parse_bool_text(admin, "admin")
        where, args = add_where_eq(where, args, "admin", int(val))
    where, args = add_where_eq(where, args, "user_users.user_id", int(current_user["id"]))
    rows = _q(
        conn,
        "SELECT users.* FROM users JOIN user_users ON users.id = user_users.other_user_id"
        + where
        + " ORDER BY id",
        tuple(args),
    )
    return [user_row_to_pb(row) for row in rows]


def get_user_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, user_id: int) -> pb.User:
    row = _q1(
        conn,
        "SELECT users.* FROM users JOIN user_users ON users.id = user_users.other_user_id "
        "WHERE user_users.user_id = ? AND user_users.other_user_id = ?",
        (int(current_user["id"]), user_id),
    )
    return user_row_to_pb(row)


def get_course_users_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, course_id: int) -> list[pb.User]:
    rows = _q(
        conn,
        "SELECT DISTINCT users.* FROM users JOIN assignments ON users.id = assignments.user_id "
        "JOIN user_users ON assignments.user_id = user_users.other_user_id "
        "WHERE assignments.course_id = ? AND user_users.user_id = ? ORDER BY users.id",
        (course_id, int(current_user["id"])),
    )
    if len(rows) == 0:
        raise sqlite3.Error("not found")
    return [user_row_to_pb(row) for row in rows]


def get_assignments_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, search_terms: list[str], ip_allowed: bool) -> list[pb.Assignment]:
    where = ""
    args: list[Any] = []
    for term in search_terms:
        where, args = add_where_like(where, args, "assignment_search_fields.search_text", term)
    where, args = add_where_eq(where, args, "user_assignments.user_id", int(current_user["id"]))
    if where == "":
        where = " WHERE"
    else:
        where += " AND"
    where += " (? OR NOT user_assignments.restricted)"
    args.append(1 if ip_allowed else 0)
    rows = _q(
        conn,
        "SELECT assignments.* FROM assignments JOIN assignment_search_fields "
        "ON assignments.id = assignment_search_fields.assignment_id "
        "JOIN user_assignments ON user_assignments.assignment_id = assignments.id"
        + where
        + " ORDER BY assignments.id",
        tuple(args),
    )
    return [assignment_row_to_pb(row) for row in rows]


def get_user_assignments_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, user_id: int, ip_allowed: bool) -> list[pb.Assignment]:
    rows = _q(
        conn,
        "SELECT assignments.* FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id "
        "WHERE assignments.user_id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted) "
        "ORDER BY course_id, updated_at",
        (user_id, int(current_user["id"]), 1 if ip_allowed else 0),
    )
    return [assignment_row_to_pb(row) for row in rows]


def get_course_user_assignments_pb(
    conn: sqlite3.Connection, current_user: sqlite3.Row, course_id: int, user_id: int, ip_allowed: bool
) -> list[pb.Assignment]:
    rows = _q(
        conn,
        "SELECT assignments.* FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id "
        "WHERE course_id = ? AND assignments.user_id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted) "
        "ORDER BY updated_at",
        (course_id, user_id, int(current_user["id"]), 1 if ip_allowed else 0),
    )
    if len(rows) == 0:
        raise sqlite3.Error("not found")
    return [assignment_row_to_pb(row) for row in rows]


def get_assignment_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, assignment_id: int, ip_allowed: bool) -> pb.Assignment:
    row = _q1(
        conn,
        "SELECT assignments.* FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id "
        "WHERE assignments.id = ? AND user_assignments.user_id = ? AND (? OR NOT user_assignments.restricted)",
        (assignment_id, int(current_user["id"]), 1 if ip_allowed else 0),
    )
    return assignment_row_to_pb(row)


def load_commit_files(conn: sqlite3.Connection, commit_id: int) -> dict[str, bytes]:
    rows = _q(conn, "SELECT path, content FROM commit_files WHERE commit_id = ?", (commit_id,))
    return {str(row["path"]): bytes(row["content"] or b"") for row in rows}


def get_assignment_problem_commit_last_pb(
    conn: sqlite3.Connection, current_user: sqlite3.Row, assignment_id: int, problem_id: int, ip_allowed: bool
) -> pb.Commit:
    row = _q1(
        conn,
        "SELECT commits.* FROM commits JOIN user_assignments ON commits.assignment_id = user_assignments.assignment_id "
        "WHERE commits.assignment_id = ? AND problem_id = ? AND user_assignments.user_id = ? "
        "AND (? OR NOT user_assignments.restricted) ORDER BY step DESC, updated_at DESC LIMIT 1",
        (assignment_id, problem_id, int(current_user["id"]), 1 if ip_allowed else 0),
    )
    return commit_row_to_pb(row, load_commit_files(conn, int(row["id"])))


def get_assignment_problem_step_commit_last_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    assignment_id: int,
    problem_id: int,
    step: int,
    ip_allowed: bool,
) -> pb.Commit:
    row = _q1(
        conn,
        "SELECT commits.* FROM commits JOIN user_assignments ON commits.assignment_id = user_assignments.assignment_id "
        "WHERE commits.assignment_id = ? AND problem_id = ? AND step = ? AND user_assignments.user_id = ? "
        "AND (? OR NOT user_assignments.restricted) ORDER BY updated_at DESC LIMIT 1",
        (assignment_id, problem_id, step, int(current_user["id"]), 1 if ip_allowed else 0),
    )
    return commit_row_to_pb(row, load_commit_files(conn, int(row["id"])))


def get_problem_types_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return _q(conn, "SELECT * FROM problem_types ORDER BY name")


def get_problem_type_actions_rows(conn: sqlite3.Connection, name: str) -> list[sqlite3.Row]:
    return _q(conn, "SELECT * FROM problem_type_actions WHERE problem_type = ?", (name,))


def get_problem_row(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: int) -> sqlite3.Row:
    if bool(current_user["author"]):
        return _q1(conn, "SELECT * FROM problems WHERE id = ?", (problem_id,))
    return _q1(
        conn,
        "SELECT problems.* FROM problems JOIN user_problems ON problems.id = problem_id "
        "WHERE user_id = ? AND problem_id = ?",
        (int(current_user["id"]), problem_id),
    )


def get_problems_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, unique: str, problem_type: str, note: str) -> list[pb.Problem]:
    where = ""
    args: list[Any] = []
    if unique != "":
        where, args = add_where_eq(where, args, "unique_id", unique)
    if problem_type != "":
        where, args = add_where_eq(where, args, "problem_type", problem_type)
    if note != "":
        where, args = add_where_like(where, args, "note", note)
    if bool(current_user["author"]):
        rows = _q(conn, "SELECT * FROM problems" + where + " ORDER BY id", tuple(args))
    else:
        where, args = add_where_eq(where, args, "user_id", int(current_user["id"]))
        rows = _q(
            conn,
            "SELECT problems.* FROM problems JOIN user_problems ON problems.id = problem_id"
            + where
            + " ORDER BY id",
            tuple(args),
        )
    return [problem_row_to_pb(row) for row in rows]


def get_problem_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: int) -> pb.Problem:
    return problem_row_to_pb(get_problem_row(conn, current_user, problem_id))


def get_problem_steps_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: int) -> list[pb.ProblemStep]:
    if bool(current_user["author"]):
        rows = _q(conn, "SELECT * FROM problem_steps WHERE problem_id = ? ORDER BY step", (problem_id,))
    else:
        rows = _q(
            conn,
            "SELECT problem_steps.* FROM problem_steps JOIN user_problems ON problem_steps.problem_id = user_problems.problem_id "
            "WHERE user_problems.user_id = ? AND user_problems.problem_id = ? ORDER BY step",
            (int(current_user["id"]), problem_id),
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


def load_problem_step_files(conn: sqlite3.Connection, problem_id: int, step: int) -> dict[str, bytes]:
    rows = _q(conn, "SELECT path, content FROM problem_step_files WHERE problem_id = ? AND step = ?", (problem_id, step))
    return {str(row["path"]): bytes(row["content"] or b"") for row in rows}


def load_problem_step_solution(conn: sqlite3.Connection, problem_id: int, step: int) -> dict[str, bytes]:
    rows = _q(
        conn,
        "SELECT path, content FROM problem_step_solution_files WHERE problem_id = ? AND step = ?",
        (problem_id, step),
    )
    return {str(row["path"]): bytes(row["content"] or b"") for row in rows}


def get_problem_step_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_id: int, step_no: int) -> pb.ProblemStep:
    if bool(current_user["author"]):
        row = _q1(conn, "SELECT * FROM problem_steps WHERE problem_id = ? AND step = ?", (problem_id, step_no))
    else:
        row = _q1(
            conn,
            "SELECT problem_steps.* FROM problem_steps JOIN user_problems ON problem_steps.problem_id = user_problems.problem_id "
            "WHERE user_problems.user_id = ? AND problem_steps.problem_id = ? AND problem_steps.step = ?",
            (int(current_user["id"]), problem_id, step_no),
        )
    step = problem_step_row_to_pb(row)
    step.files.update(load_problem_step_files(conn, problem_id, step_no))
    if bool(current_user["admin"]) or bool(current_user["author"]):
        step.solution.update(load_problem_step_solution(conn, problem_id, step_no))
    return step


def get_problem_sets_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, unique: str, note: str, search: list[str]) -> list[pb.ProblemSet]:
    where = ""
    args: list[Any] = []
    search_flag = False
    for term in search:
        where, args = add_where_like(where, args, "problem_set_search_fields.search_text", term)
        search_flag = True
    if unique != "":
        where, args = add_where_eq(where, args, "problem_sets.unique_id", unique)
    if note != "":
        where, args = add_where_like(where, args, "problem_sets.note", note)
    if bool(current_user["author"]):
        query = "SELECT problem_sets.* FROM problem_sets"
        if search_flag:
            query += " JOIN problem_set_search_fields ON problem_sets.id = problem_set_search_fields.problem_set_id"
        query += where + " ORDER BY problem_sets.id"
        rows = _q(conn, query, tuple(args))
    else:
        where, args = add_where_eq(where, args, "user_problem_sets.user_id", int(current_user["id"]))
        query = "SELECT problem_sets.* FROM problem_sets JOIN user_problem_sets ON problem_sets.id = user_problem_sets.problem_set_id"
        if search_flag:
            query += " JOIN problem_set_search_fields ON problem_sets.id = problem_set_search_fields.problem_set_id"
        query += where + " ORDER BY problem_sets.id"
        rows = _q(conn, query, tuple(args))
    return [problem_set_row_to_pb(row) for row in rows]


def get_problem_set_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_set_id: int) -> pb.ProblemSet:
    if bool(current_user["author"]):
        row = _q1(conn, "SELECT * FROM problem_sets WHERE id = ?", (problem_set_id,))
    else:
        row = _q1(
            conn,
            "SELECT problem_sets.* FROM problem_sets JOIN user_problem_sets ON problem_sets.id = problem_set_id "
            "WHERE user_id = ? AND problem_set_id = ?",
            (int(current_user["id"]), problem_set_id),
        )
    return problem_set_row_to_pb(row)


def get_problem_set_problems_pb(conn: sqlite3.Connection, current_user: sqlite3.Row, problem_set_id: int) -> list[pb.ProblemSetProblem]:
    if bool(current_user["author"]):
        rows = _q(conn, "SELECT * FROM problem_set_problems WHERE problem_set_id = ? ORDER BY problem_id", (problem_set_id,))
    else:
        rows = _q(
            conn,
            "SELECT problem_set_problems.* FROM problem_set_problems JOIN user_problem_sets ON problem_set_problems.problem_set_id = user_problem_sets.problem_set_id "
            "WHERE user_problem_sets.user_id = ? AND problem_set_problems.problem_set_id = ? ORDER BY problem_id",
            (int(current_user["id"]), problem_set_id),
        )
    if len(rows) == 0:
        raise sqlite3.Error("not found")
    return [problem_set_problem_row_to_pb(row) for row in rows]


def get_list_problems_bundle(
    conn: sqlite3.Connection, user_id: int, current_user: sqlite3.Row, ip_allowed: bool
) -> tuple[pb.User, list[pb.Assignment], list[pb.Course], list[pb.ProblemSet]]:
    user_pb = user_row_to_pb(current_user)
    assignments = get_user_assignments_pb(conn, current_user, user_id, ip_allowed)
    course_map: dict[int, pb.Course] = {}
    problem_set_map: dict[int, pb.ProblemSet] = {}
    for asst in assignments:
        if asst.course_id not in course_map:
            course_map[asst.course_id] = get_course_pb(conn, current_user, int(asst.course_id))
        if asst.problem_set_id not in problem_set_map:
            problem_set_map[asst.problem_set_id] = get_problem_set_pb(conn, current_user, int(asst.problem_set_id))
    return user_pb, assignments, list(course_map.values()), list(problem_set_map.values())


def problem_type_pb(name: str, image: str, files: dict[str, bytes], action_rows: list[sqlite3.Row]) -> pb.ProblemType:
    actions: dict[str, pb.ProblemTypeAction] = {}
    for row in action_rows:
        actions[str(row["action"])] = pb.ProblemTypeAction(
            problem_type=str(row["problem_type"]),
            action=str(row["action"]),
            command=str(row["command"]),
            parser=str(row["parser"] or ""),
            message=str(row["message"]),
            interactive=bool(row["interactive"]),
            max_cpu=int(row["max_cpu"]),
            max_session=int(row["max_session"]),
            max_timeout=int(row["max_timeout"]),
            max_fd=int(row["max_fd"]),
            max_file_size=int(row["max_file_size"]),
            max_memory=int(row["max_memory"]),
            max_threads=int(row["max_threads"]),
        )
    return pb.ProblemType(name=name, image=image, files=files, actions=actions)
