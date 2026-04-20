from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Callable

import codegrinder_pb2 as pb
from problem_files import ProblemStepFileType
from proto_conv import to_timestamp


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
        where, args = add_where_like(where, args, "accessible_assignment_fields.search_text", term)
    where, args = add_where_eq(where, args, "accessible_assignment_fields.viewer_user_id", str(current_user["user_id"]))
    if not include_student_context:
        where, args = add_where_eq(where, args, "accessible_assignment_fields.assignment_user_id", str(current_user["user_id"]))
    if where == "":
        where = " WHERE"
    else:
        where += " AND"
    where += " (? OR NOT accessible_assignment_fields.restricted)"
    args.append(1 if ip_allowed else 0)

    rows = _q(
        conn,
        "SELECT "
        "assignment_user_id, course_id, problem_set_id, "
        "unlock_at, due_at, lock_at, download_available, "
        "problem_set_note, course_name, "
        "user_name, user_login "
        "FROM accessible_assignment_fields "
        + where
        + " ORDER BY course_id, due_at, lock_at, "
        "assignment_user_id, problem_set_id",
        tuple(args),
    )
    items: list[pb.AssignmentListItem] = [
        pb.AssignmentListItem(
            assignment=pb.AssignmentKey(
                user_id=str(row["assignment_user_id"]),
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
            download_status=(
                pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE
                if bool(row["download_available"])
                else pb.ASSIGNMENT_DOWNLOAD_STATUS_NOT_OPEN
            ),
        )
        for row in rows
    ]
    problem_set_ids = sorted({item.assignment.problem_set_id for item in items})
    if problem_set_ids:
        placeholders = ", ".join("?" for _ in problem_set_ids)
        problem_rows = _q(
            conn,
            "SELECT problem_set_id, problem_id FROM problem_set_problems "
            f"WHERE problem_set_id IN ({placeholders}) "
            "ORDER BY problem_set_id, problem_id",
            tuple(problem_set_ids),
        )
        problems_by_set: dict[str, list[pb.AssignmentListProblem]] = {problem_set_id: [] for problem_set_id in problem_set_ids}
        for row in problem_rows:
            problems_by_set[str(row["problem_set_id"])].append(pb.AssignmentListProblem(problem_id=str(row["problem_id"])))
        for item in items:
            item.problems.extend(problems_by_set.get(item.assignment.problem_set_id, []))
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
        "SELECT assignments.*, accessible_assignment_fields.is_owner, "
        "accessible_assignment_fields.is_course_instructor, accessible_assignment_fields.restricted AS viewer_restricted, "
        "accessible_assignment_fields.download_available "
        "FROM assignments "
        "JOIN accessible_assignment_fields "
        "ON assignments.user_id = accessible_assignment_fields.assignment_user_id "
        "AND assignments.course_id = accessible_assignment_fields.course_id "
        "AND assignments.problem_set_id = accessible_assignment_fields.problem_set_id "
        "WHERE assignments.user_id = ? AND assignments.course_id = ? AND assignments.problem_set_id = ? "
        "AND accessible_assignment_fields.viewer_user_id = ? AND (? OR NOT accessible_assignment_fields.restricted)",
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
            "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
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
        "assignment_user_id, course_id, problem_set_id, course_name, problem_set_note "
        "FROM accessible_assignment_fields "
        "WHERE assignment_user_id = ? AND course_id = ? AND problem_set_id = ? "
        "AND viewer_user_id = ? AND (? OR NOT restricted)",
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
            user_id=str(assignment_row["assignment_user_id"]),
            course_id=str(assignment_row["course_id"]),
            problem_set_id=str(assignment_row["problem_set_id"]),
        ),
        problem_set_note=str(assignment_row["problem_set_note"]),
        course_name=str(assignment_row["course_name"]),
        problems=problems,
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
    assignment_access = get_assignment_access_row(conn, current_user, assignment, ip_allowed)
    if not bool(assignment_access["download_available"]):
        raise PermissionError("assignment is not open yet")
    step_row = _q1(
        conn,
        "SELECT * FROM workspace_step_context "
        "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? "
        "AND step_number = CASE WHEN ? = 0 THEN current_step_number ELSE ? END",
        (
            assignment.user_id,
            assignment.course_id,
            assignment.problem_set_id,
            problem_id,
            step_number,
            step_number,
        ),
    )
    resolved_step_number = int(step_row["step_number"])
    total_steps = max(1, int(step_row["total_steps"] or 0))
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
            "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
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

    action_rows = get_problem_type_actions_rows(conn, str(step_row["problem_type"]))
    solution_files: dict[str, bytes] = {}
    if include_solution_files:
        if not bool(current_user["author"]):
            raise PermissionError("solution files require author access")
        solution_files = load_problem_step_files(conn, problem_id, int(resolved_step_number), ProblemStepFileType.SOLUTION)

    if not include_contents:
        solution_files = {path: b"" for path in solution_files}

    return pb.GetWorkspaceResponse(
        assignment=assignment,
        problem_id=problem_id,
        problem_note=str(step_row["problem_note"]),
        step_number=resolved_step_number,
        total_steps=total_steps,
        problem_type=str(step_row["problem_type"]),
        step_note=str(step_row["step_note"]),
        step_weight=float(step_row["step_weight"]),
        actions=sorted(str(row["action"]) for row in action_rows),
        system_owned_files=[
            pb.AssignmentStepFile(path=path, content=content)
            for path, content in sorted(system_owned_files.items())
        ],
        student_owned_files=[
            pb.AssignmentStepFile(path=path, content=content)
            for path, content in sorted(student_owned_files.items())
        ],
        solution_files=[
            pb.AssignmentStepFile(path=path, content=content)
            for path, content in sorted(solution_files.items())
        ],
    )


def get_problem_types_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return _q(conn, "SELECT * FROM problem_types ORDER BY problem_type")


def get_problem_type_actions_rows(conn: sqlite3.Connection, problem_type: str) -> list[sqlite3.Row]:
    return _q(conn, "SELECT * FROM problem_type_actions WHERE problem_type = ?", (problem_type,))


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
        where, args = add_where_like(where, args, "LOWER(problem_set_search_fields.search_text)", term)

    if bool(current_user["author"]):
        set_rows = _q(
            conn,
            "SELECT problem_sets.* FROM problem_sets "
            "JOIN problem_set_search_fields ON problem_set_search_fields.problem_set_id = problem_sets.problem_set_id"
            + where
            + " ORDER BY problem_sets.problem_set_id",
            tuple(args),
        )
    else:
        if where == "":
            where = " WHERE"
        else:
            where += " AND"
        where += " accessible_problem_sets.viewer_user_id = ?"
        args.append(str(current_user["user_id"]))
        set_rows = _q(
            conn,
            "SELECT problem_sets.* FROM problem_sets "
            "JOIN accessible_problem_sets ON accessible_problem_sets.problem_set_id = problem_sets.problem_set_id"
            " JOIN problem_set_search_fields ON problem_set_search_fields.problem_set_id = problem_sets.problem_set_id"
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
        tags = json.loads(str(row["problem_set_tags"]))
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
        "problem_set_id, "
        "problem_id, "
        "problem_weight, "
        "problem_note, "
        "step_number, "
        "step_note, "
        "step_weight "
        "FROM problem_catalog_rows "
        f"WHERE problem_set_id IN ({placeholders}) "
        "ORDER BY problem_set_id, problem_id, step_number",
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
