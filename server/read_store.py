from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import codegrinder_pb2 as pb
from problem_files import ProblemStepFileType
from proto_conv import to_timestamp


@dataclass(slots=True)
class WorkspaceFiles:
    step_number: int
    total_steps: int
    system_owned_files: list[pb.AssignmentStepFile]
    student_owned_files: list[pb.AssignmentStepFile]


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
    items = [
        pb.AssignmentListItem(
            assignment=pb.AssignmentKey(
                user_id=str(row["user_id"]),
                course_id=str(row["course_id"]),
                problem_set_id=str(row["problem_set_id"] or ""),
            ),
            problem_set_note=str(row["problem_set_note"] or ""),
            unlock_at=to_timestamp(row["unlock_at"]),
            due_at=to_timestamp(row["due_at"]),
            lock_at=to_timestamp(row["lock_at"]),
            course_name=str(row["course_name"] or ""),
            user_name=str(row["user_name"] or ""),
            user_login=str(row["user_login"] or ""),
        )
        for row in rows
    ]
    if include_student_context:
        return items
    for item in items:
        item.user_name = ""
        item.user_login = ""
    return items


def get_assignment_access_row(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    assignment: pb.AssignmentKey,
    ip_allowed: bool,
) -> sqlite3.Row:
    return _q1(
        conn,
        "SELECT assignments.* FROM assignments JOIN user_assignments "
        "ON assignments.user_id = user_assignments.assignment_user_id "
        "AND assignments.course_id = user_assignments.course_id "
        "AND assignments.problem_set_id = user_assignments.problem_set_id "
        "WHERE assignments.user_id = ? AND assignments.course_id = ? AND assignments.problem_set_id = ? "
        "AND user_assignments.viewer_user_id = ? AND (? OR NOT user_assignments.restricted)",
        (
            assignment.user_id,
            assignment.course_id,
            assignment.problem_set_id,
            str(current_user["user_id"]),
            1 if ip_allowed else 0,
        ),
    )


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


def _starter_student_files(
    conn: sqlite3.Connection,
    user_id: str,
    course_id: str,
    problem_set_id: str,
    problem_id: str,
    step_number: int,
    starter_files: dict[str, bytes],
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
        else:
            files = load_problem_step_files(conn, problem_id, step_number - 1, ProblemStepFileType.SOLUTION)
    for path, content in starter_files.items():
        files[path] = content
    return files


def _system_owned_files_for_step(
    load_problem_type_files: Callable[[str], dict[str, bytes]],
    problem_type: str,
    step_files: dict[str, bytes],
) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    files.update(step_files)
    for path, content in load_problem_type_files(problem_type).items():
        files[str(Path(path))] = content
    return files


def get_assignment_summary_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    assignment: pb.AssignmentKey,
    ip_allowed: bool,
) -> pb.GetAssignmentResponse:
    assignment_row = _q1(
        conn,
        "SELECT "
        "assignments.user_id, assignments.course_id, assignments.problem_set_id, "
        "courses.course_name, problem_sets.problem_set_note "
        "FROM assignments "
        "JOIN user_assignments ON user_assignments.assignment_user_id = assignments.user_id "
        "AND user_assignments.course_id = assignments.course_id "
        "AND user_assignments.problem_set_id = assignments.problem_set_id "
        "JOIN courses ON courses.course_id = assignments.course_id "
        "JOIN problem_sets ON problem_sets.problem_set_id = assignments.problem_set_id "
        "WHERE assignments.user_id = ? AND assignments.course_id = ? AND assignments.problem_set_id = ? "
        "AND user_assignments.viewer_user_id = ? AND (? OR NOT user_assignments.restricted)",
        (
            assignment.user_id,
            assignment.course_id,
            assignment.problem_set_id,
            str(current_user["user_id"]),
            1 if ip_allowed else 0,
        ),
    )
    problem_rows = _q(
        conn,
        "SELECT problem_id, problem_note, current_step_number, total_steps "
        "FROM assignment_problem_progress "
        "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? "
        "ORDER BY problem_id",
        (assignment.user_id, assignment.course_id, assignment.problem_set_id),
    )
    problems: list[pb.AssignmentProblemProgress] = []
    for row in problem_rows:
        problems.append(
            pb.AssignmentProblemProgress(
                problem_id=str(row["problem_id"]),
                problem_note=str(row["problem_note"]),
                current_step_number=int(row["current_step_number"]),
                total_steps=int(row["total_steps"]),
            )
        )
    return pb.GetAssignmentResponse(
        assignment=pb.AssignmentKey(
            user_id=str(assignment_row["user_id"]),
            course_id=str(assignment_row["course_id"]),
            problem_set_id=str(assignment_row["problem_set_id"]),
        ),
        problem_set_note=str(assignment_row["problem_set_note"]),
        course_name=str(assignment_row["course_name"]),
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
        "SELECT current_step_number "
        "FROM assignment_problem_progress "
        "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ?",
        (user_id, course_id, problem_set_id, problem_id),
    )
    return int(row["current_step_number"])


def get_assignment_step_files_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    assignment: pb.AssignmentKey,
    problem_id: str,
    step_number: int,
    reset_to_step_start: bool,
    include_contents: bool,
    ip_allowed: bool,
    load_problem_type_files: Callable[[str], dict[str, bytes]],
) -> WorkspaceFiles:
    get_assignment_access_row(conn, current_user, assignment, ip_allowed)
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
        "SELECT total_steps FROM problem_total_steps WHERE problem_id = ?",
        (problem_id,),
    )
    total_steps = max(1, int(total_steps_row["total_steps"] or 0))
    step_files = load_problem_step_files(conn, problem_id, resolved_step_number, ProblemStepFileType.REGULAR)
    starter_files = load_problem_step_files(conn, problem_id, resolved_step_number, ProblemStepFileType.STARTER)
    system_owned_files = _system_owned_files_for_step(
        load_problem_type_files,
        str(step_row["problem_type"]),
        step_files,
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
            starter_files,
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
                starter_files,
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
    if not include_contents:
        system_owned_files = {path: b"" for path in system_owned_files}
        student_owned_files = {path: b"" for path in student_owned_files}

    return WorkspaceFiles(
        step_number=resolved_step_number,
        total_steps=total_steps,
        system_owned_files=[
            pb.AssignmentStepFile(path=path, content=content)
            for path, content in sorted(system_owned_files.items())
        ],
        student_owned_files=[
            pb.AssignmentStepFile(path=path, content=content)
            for path, content in sorted(student_owned_files.items())
        ],
    )



def get_workspace_pb(
    conn: sqlite3.Connection,
    current_user: sqlite3.Row,
    assignment: pb.AssignmentKey,
    problem_id: str,
    step_number: int,
    file_state: pb.WorkspaceFileState.ValueType,
    include_contents: bool,
    include_solution_files: bool,
    ip_allowed: bool,
    load_problem_type_files: Callable[[str], dict[str, bytes]],
) -> pb.GetWorkspaceResponse:
    reset_to_step_start = file_state == pb.WORKSPACE_FILE_STATE_STEP_START
    files = get_assignment_step_files_pb(
        conn,
        current_user,
        assignment,
        problem_id,
        step_number,
        reset_to_step_start,
        include_contents,
        ip_allowed,
        load_problem_type_files,
    )
    problem_row = get_problem_row(conn, current_user, problem_id)
    step_row = _q1(
        conn,
        "SELECT * FROM problem_steps WHERE problem_id = ? AND step_number = ?",
        (problem_id, int(files.step_number)),
    )
    action_rows = get_problem_type_actions_rows(conn, str(step_row["problem_type"]))
    solution_files: dict[str, bytes] = {}
    if include_solution_files:
        if not bool(current_user["author"]):
            raise PermissionError("solution files require author access")
        solution_files = load_problem_step_files(conn, problem_id, int(files.step_number), ProblemStepFileType.SOLUTION)

    if not include_contents:
        solution_files = {path: b"" for path in solution_files}

    return pb.GetWorkspaceResponse(
        assignment=assignment,
        problem_id=problem_id,
        problem_note=str(problem_row["problem_note"]),
        step_number=files.step_number,
        total_steps=files.total_steps,
        problem_type=str(step_row["problem_type"]),
        step_note=str(step_row["step_note"]),
        step_weight=float(step_row["step_weight"]),
        actions=sorted(str(row["action"]) for row in action_rows),
        system_owned_files=files.system_owned_files,
        student_owned_files=files.student_owned_files,
        solution_files=[
            pb.AssignmentStepFile(path=path, content=content)
            for path, content in sorted(solution_files.items())
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


def load_problem_step_files(
    conn: sqlite3.Connection,
    problem_id: str,
    step: int,
    file_type: ProblemStepFileType,
) -> dict[str, bytes]:
    rows = _q(
        conn,
        "SELECT path, content FROM problem_step_files WHERE problem_id = ? AND step_number = ? AND file_type = ?",
        (problem_id, step, file_type.value),
    )
    return {str(row["path"]): bytes(row["content"] or b"") for row in rows}


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
    set_ids: list[str] = []
    for row in set_rows:
        raw_tags = row["problem_set_tags"]
        tags: list[Any]
        if raw_tags is None or raw_tags == "":
            tags = []
        elif isinstance(raw_tags, list):
            tags = raw_tags
        elif isinstance(raw_tags, bytes):
            try:
                parsed_tags = json.loads(raw_tags.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
                parsed_tags = []
            tags = parsed_tags if isinstance(parsed_tags, list) else []
        else:
            try:
                parsed_tags = json.loads(str(raw_tags))
            except (json.JSONDecodeError, TypeError, ValueError):
                parsed_tags = []
            tags = parsed_tags if isinstance(parsed_tags, list) else []

        problem_set_id = str(row["problem_set_id"])
        item = pb.ProblemCatalogSet(
            problem_set_id=problem_set_id,
            problem_set_note=str(row["problem_set_note"]),
            problem_set_tags=[str(tag) for tag in tags],
        )
        set_items.append(item)
        set_by_id[problem_set_id] = item
        set_ids.append(problem_set_id)

    placeholders = ", ".join("?" for _ in set_ids)
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
        tuple(set_ids),
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


def problem_type_pb(problem_type: str, container: str, files: dict[str, bytes], action_rows: list[sqlite3.Row]) -> pb.ProblemType:
    actions: dict[str, pb.ProblemTypeAction] = {}
    for row in action_rows:
        actions[str(row["action"])] = pb.ProblemTypeAction(
            command=str(row["command"]),
            parser=str(row["parser"] or ""),
            max_cpu=int(row["max_cpu"]),
            max_fd=int(row["max_fd"]),
            max_file_size=int(row["max_file_size"]),
            max_memory=int(row["max_memory"]),
            max_threads=int(row["max_threads"]),
        )
    return pb.ProblemType(problem_type=problem_type, container=container, files=files, actions=actions)
