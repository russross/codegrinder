from __future__ import annotations

import json
import sqlite3
from pathlib import PurePosixPath
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


def _where_clause(conditions: list[str]) -> str:
    return "" if not conditions else " WHERE " + " AND ".join(conditions)


def _assignment_download_status(value: Any) -> pb.AssignmentDownloadStatus:
    status = int(value)
    if status == int(pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE):
        return pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE
    if status == int(pb.ASSIGNMENT_DOWNLOAD_STATUS_NOT_OPEN):
        return pb.ASSIGNMENT_DOWNLOAD_STATUS_NOT_OPEN
    if status == int(pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY):
        return pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY
    raise ValueError(f"unknown assignment download status: {status}")


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
    conditions = ["accessible_assignment_fields.viewer_user_id = ?", "(? OR NOT accessible_assignment_fields.restricted)"]
    args: list[Any] = [str(current_user["user_id"]), 1 if ip_allowed else 0]
    for term in search_terms:
        conditions.append("accessible_assignment_fields.search_text LIKE ?")
        args.append(f"%{term.lower()}%")
    if not include_student_context:
        conditions.append("accessible_assignment_fields.assignment_user_id = ?")
        args.append(str(current_user["user_id"]))

    rows = _q(
        conn,
        "SELECT "
        "assignment_user_id, course_id, problem_set_id, "
        "unlock_at, due_at, lock_at, download_status, "
        "problem_set_note, course_name, "
        "user_name, user_login "
        "FROM accessible_assignment_fields "
        + _where_clause(conditions)
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
            download_status=_assignment_download_status(row["download_status"]),
        )
        for row in rows
    ]
    problem_set_ids = sorted({item.assignment.problem_set_id for item in items})
    if problem_set_ids:
        placeholders = ", ".join("?" for _ in problem_set_ids)
        problems_by_set: dict[str, list[pb.AssignmentListProblem]] = {problem_set_id: [] for problem_set_id in problem_set_ids}
        for row in _q(
            conn,
            "SELECT problem_set_id, problem_id, first_step, last_step FROM problem_set_problems "
            f"WHERE problem_set_id IN ({placeholders}) "
            "ORDER BY problem_set_id, problem_id",
            tuple(problem_set_ids),
        ):
            problems_by_set[str(row["problem_set_id"])].append(
                pb.AssignmentListProblem(
                    problem_id=str(row["problem_id"]),
                    first_step=int(row["first_step"] or 0),
                    last_step=int(row["last_step"] or 0),
                )
            )
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
        "accessible_assignment_fields.download_status, accessible_assignment_fields.download_available "
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
    return {_normalize_workspace_path(str(row["path"])): bytes(row["content"] or b"") for row in rows}


def _normalize_workspace_path(raw: str) -> str:
    if "\\" in raw:
        raise ValueError(f"invalid workspace path: {raw!r}")
    path = PurePosixPath(raw)
    if raw.strip() == "" or path.is_absolute():
        raise ValueError(f"invalid workspace path: {raw!r}")
    parts = path.parts
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"invalid workspace path: {raw!r}")
    return path.as_posix()


def _normalize_file_map(files: dict[str, bytes]) -> dict[str, bytes]:
    return {_normalize_workspace_path(path): content for path, content in files.items()}


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
            continuation = conn.execute(
                "SELECT previous_slice.problem_set_id, previous_slice.last_step "
                "FROM problem_sets "
                "JOIN problem_set_problems AS current_slice "
                "ON current_slice.problem_set_id = problem_sets.problem_set_id "
                "JOIN problem_set_problems AS previous_slice "
                "ON previous_slice.problem_set_id = problem_sets.continues_problem_set_id "
                "AND previous_slice.problem_id = current_slice.problem_id "
                "AND previous_slice.last_step = current_slice.first_step - 1 "
                "WHERE problem_sets.problem_set_id = ? AND current_slice.problem_id = ? "
                "AND current_slice.first_step = ?",
                (problem_set_id, problem_id, step_number),
            ).fetchone()
            if continuation is not None:
                files = load_commit_files(
                    conn,
                    user_id,
                    course_id,
                    str(continuation["problem_set_id"]),
                    problem_id,
                    int(continuation["last_step"]),
                )
            else:
                files = load_problem_step_files(conn, problem_id, step_number - 1, ProblemStepFileType.SOLUTION)
    for path, content in starter_files.items():
        files[_normalize_workspace_path(path)] = content
    return _normalize_file_map(files)


def _system_owned_files_for_step(
    load_problem_type_files: Callable[[str], dict[str, bytes]],
    problem_type: str,
    step_files: dict[str, bytes],
) -> dict[str, bytes]:
    files: dict[str, bytes] = _normalize_file_map(step_files)
    for path, content in load_problem_type_files(problem_type).items():
        files[_normalize_workspace_path(path)] = content
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
        "assignment_user_id, course_id, problem_set_id, course_name, problem_set_note, download_status "
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
        "SELECT problem_id, problem_note, current_step_number, first_step_number, last_step_number "
        "FROM assignment_problem_progress "
        "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? "
        "ORDER BY problem_id",
        (assignment.user_id, assignment.course_id, assignment.problem_set_id),
    )
    problems = [
        pb.AssignmentProblemProgress(
            problem_id=str(row["problem_id"]),
            problem_note=str(row["problem_note"]),
            current_step_number=int(row["current_step_number"]),
            first_step_number=int(row["first_step_number"]),
            last_step_number=int(row["last_step_number"]),
        )
        for row in problem_rows
    ]
    return pb.GetAssignmentResponse(
        assignment=pb.AssignmentKey(
            user_id=str(assignment_row["assignment_user_id"]),
            course_id=str(assignment_row["course_id"]),
            problem_set_id=str(assignment_row["problem_set_id"]),
        ),
        problem_set_note=str(assignment_row["problem_set_note"]),
        course_name=str(assignment_row["course_name"]),
        problems=problems,
        download_status=_assignment_download_status(assignment_row["download_status"]),
    )


def _workspace_reset_to_step_start(file_state: pb.WorkspaceFileState.ValueType) -> bool:
    match file_state:
        case pb.WORKSPACE_FILE_STATE_CURRENT:
            return False
        case pb.WORKSPACE_FILE_STATE_STEP_START:
            return True
        case _:
            raise ValueError("workspace file state is invalid")


def _load_workspace_step_row(
    conn: sqlite3.Connection,
    assignment: pb.AssignmentKey,
    problem_id: str,
    step_number: int,
) -> sqlite3.Row:
    return _q1(
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


def _student_owned_files_for_workspace(
    conn: sqlite3.Connection,
    assignment: pb.AssignmentKey,
    problem_id: str,
    step_number: int,
    starter_files: dict[str, bytes],
    reset_to_step_start: bool,
) -> dict[str, bytes]:
    if reset_to_step_start:
        return _starter_student_files(
            conn,
            assignment.user_id,
            assignment.course_id,
            assignment.problem_set_id,
            problem_id,
            step_number,
            starter_files,
        )
    commit_row = conn.execute(
        "SELECT user_id, course_id, problem_set_id, problem_id, step_number FROM commits "
        "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
        (assignment.user_id, assignment.course_id, assignment.problem_set_id, problem_id, step_number),
    ).fetchone()
    if commit_row is None:
        return _starter_student_files(
            conn,
            assignment.user_id,
            assignment.course_id,
            assignment.problem_set_id,
            problem_id,
            step_number,
            starter_files,
        )
    return load_commit_files(
        conn,
        str(commit_row["user_id"]),
        str(commit_row["course_id"]),
        str(commit_row["problem_set_id"]),
        str(commit_row["problem_id"]),
        int(commit_row["step_number"]),
    )


def _assignment_step_files(files: dict[str, bytes]) -> list[pb.AssignmentStepFile]:
    return [pb.AssignmentStepFile(path=path, content=content) for path, content in sorted(_normalize_file_map(files).items())]


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
    reset_to_step_start = _workspace_reset_to_step_start(file_state)
    assignment_access = get_assignment_access_row(conn, current_user, assignment, ip_allowed)
    if not bool(assignment_access["download_available"]):
        if int(assignment_access["download_status"]) == pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY:
            raise PermissionError("assignment prerequisite is not ready")
        raise PermissionError("assignment is not open yet")
    step_row = _load_workspace_step_row(conn, assignment, problem_id, step_number)
    resolved_step_number = int(step_row["step_number"])
    step_files = load_problem_step_files(conn, problem_id, resolved_step_number, ProblemStepFileType.REGULAR)
    starter_files = load_problem_step_files(conn, problem_id, resolved_step_number, ProblemStepFileType.STARTER)
    system_owned_files = _system_owned_files_for_step(
        load_problem_type_files,
        str(step_row["problem_type"]),
        step_files,
    )
    student_owned_files = _student_owned_files_for_workspace(
        conn,
        assignment,
        problem_id,
        resolved_step_number,
        starter_files,
        reset_to_step_start,
    )
    if not include_contents:
        system_owned_files = {path: b"" for path in system_owned_files}
        student_owned_files = {path: b"" for path in student_owned_files}

    action_rows = get_problem_type_actions_rows(conn, str(step_row["problem_type"]))
    if include_solution_files and not bool(current_user["author"]):
        raise PermissionError("solution files require author access")
    solution_files = (
        load_problem_step_files(conn, problem_id, int(resolved_step_number), ProblemStepFileType.SOLUTION)
        if include_solution_files
        else {}
    )

    if not include_contents:
        solution_files = {path: b"" for path in solution_files}

    return pb.GetWorkspaceResponse(
        assignment=assignment,
        problem_id=problem_id,
        problem_note=str(step_row["problem_note"]),
        step_number=resolved_step_number,
        problem_type=str(step_row["problem_type"]),
        step_note=str(step_row["step_note"]),
        step_weight=float(step_row["step_weight"]),
        actions=sorted(str(row["action"]) for row in action_rows),
        system_owned_files=_assignment_step_files(system_owned_files),
        student_owned_files=_assignment_step_files(student_owned_files),
        solution_files=_assignment_step_files(solution_files),
        first_step_number=int(step_row["first_step_number"]),
        last_step_number=int(step_row["last_step_number"]),
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
    conditions: list[str] = []
    args: list[Any] = []
    for term in search_terms:
        conditions.append("LOWER(problem_set_search_fields.search_text) LIKE ?")
        args.append(f"%{term.lower()}%")

    if bool(current_user["author"]):
        set_rows = _q(
            conn,
            "SELECT problem_sets.* FROM problem_sets "
            "JOIN problem_set_search_fields ON problem_set_search_fields.problem_set_id = problem_sets.problem_set_id"
            + _where_clause(conditions)
            + " ORDER BY problem_sets.problem_set_id",
            tuple(args),
        )
    else:
        conditions = [*conditions, "accessible_problem_sets.viewer_user_id = ?"]
        args.append(str(current_user["user_id"]))
        set_rows = _q(
            conn,
            "SELECT problem_sets.* FROM problem_sets "
            "JOIN accessible_problem_sets ON accessible_problem_sets.problem_set_id = problem_sets.problem_set_id"
            " JOIN problem_set_search_fields ON problem_set_search_fields.problem_set_id = problem_sets.problem_set_id"
            + _where_clause(conditions)
            + " ORDER BY problem_sets.problem_set_id",
            tuple(args),
        )

    if not set_rows:
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
    actions = {
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
    return pb.ProblemType(problem_type=problem_type, container=container, files=files, actions=actions)
