use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult};
use crate::files::split_system_and_student;
use crate::proto;
use crate::proto::{
    AssignmentDownloadStatus, AssignmentKey, AssignmentListItem, AssignmentListProblem,
    AssignmentProblemProgress, GetAssignmentResponse, GetWorkspaceResponse, ProblemCatalogProblem,
    ProblemCatalogSet, ProblemCatalogStep, ProblemType, ProblemTypeAction,
};
use crate::timeutil::timestamp_opt;

#[derive(Clone, Debug)]
pub struct UserRow {
    pub user_id: String,
    pub user_name: String,
    pub user_login: String,
    pub admin: bool,
    pub author: bool,
    pub instructor: bool,
}

pub fn load_user_by_id(conn: &Connection, user_id: &str) -> AppResult<UserRow> {
    conn.query_row(
        "SELECT * FROM user_role_flags WHERE user_id = ?",
        params![user_id],
        user_from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("user not found".to_owned()))
}

fn user_from_row(row: &Row<'_>) -> rusqlite::Result<UserRow> {
    Ok(UserRow {
        user_id: row.get("user_id")?,
        user_name: row.get("user_name")?,
        user_login: row.get("user_login")?,
        admin: row.get::<_, i64>("admin")? != 0,
        author: row.get::<_, i64>("author")? != 0,
        instructor: row.get::<_, i64>("instructor")? != 0,
    })
}

pub fn list_assignments(
    conn: &Connection,
    current_user: &UserRow,
    search: &[String],
    include_student_context: bool,
    ip_allowed: bool,
) -> AppResult<Vec<AssignmentListItem>> {
    let mut sql =
        String::from("SELECT * FROM accessible_assignment_fields WHERE viewer_user_id = ?");
    let mut values: Vec<String> = vec![current_user.user_id.clone()];
    if !include_student_context {
        sql.push_str(" AND is_owner");
    }
    if !ip_allowed {
        sql.push_str(" AND NOT restricted");
    }
    for term in search {
        sql.push_str(" AND search_text LIKE ?");
        values.push(format!("%{term}%"));
    }
    sql.push_str(" ORDER BY course_name, assignment_title, problem_set_id, user_name");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values), |row| {
        Ok(AssignmentListItem {
            assignment: Some(AssignmentKey {
                user_id: row.get("assignment_user_id")?,
                course_id: row.get("course_id")?,
                problem_set_id: row.get("problem_set_id")?,
            }),
            problem_set_note: row.get("problem_set_note")?,
            unlock_at: timestamp_opt(row.get::<_, Option<String>>("unlock_at")?)
                .map_err(to_sql_err)?,
            due_at: timestamp_opt(row.get::<_, Option<String>>("due_at")?).map_err(to_sql_err)?,
            lock_at: timestamp_opt(row.get::<_, Option<String>>("lock_at")?).map_err(to_sql_err)?,
            course_name: row.get("course_name")?,
            user_name: row.get("user_name")?,
            user_login: row.get("user_login")?,
            problems: Vec::new(),
            download_status: row.get::<_, i32>("download_status")?,
            assignment_title: row.get("assignment_title")?,
            assignment_score: row.get("assignment_score")?,
            prerequisite_problem_set_id: row
                .get::<_, Option<String>>("prerequisite_problem_set_id")?
                .unwrap_or_default(),
        })
    })?;
    let mut items = rows.collect::<Result<Vec<_>, _>>()?;
    for item in &mut items {
        let Some(key) = item.assignment.as_ref() else {
            return Err(AppError::Internal(
                "assignment list item missing assignment key".to_owned(),
            ));
        };
        item.problems = list_assignment_problems(conn, &key.problem_set_id)?;
    }
    Ok(items)
}

fn list_assignment_problems(
    conn: &Connection,
    problem_set_id: &str,
) -> AppResult<Vec<AssignmentListProblem>> {
    let mut stmt = conn.prepare(
        "SELECT problem_id, COALESCE(first_step, 0), COALESCE(last_step, 0) FROM problem_set_problems WHERE problem_set_id = ? ORDER BY problem_id",
    )?;
    Ok(stmt
        .query_map(params![problem_set_id], |row| {
            Ok(AssignmentListProblem {
                problem_id: row.get(0)?,
                first_step: row.get(1)?,
                last_step: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

pub fn get_assignment(
    conn: &Connection,
    current_user: &UserRow,
    key: &AssignmentKey,
    ip_allowed: bool,
) -> AppResult<GetAssignmentResponse> {
    let (
        problem_set_note,
        course_name,
        download_status,
        restricted,
        prerequisite_problem_set_id,
        is_course_instructor,
    ) = conn
        .query_row(
            "SELECT * FROM accessible_assignment_fields WHERE viewer_user_id = ? AND assignment_user_id = ? AND course_id = ? AND problem_set_id = ?",
            params![current_user.user_id, key.user_id, key.course_id, key.problem_set_id],
            |row| {
                Ok((
                    row.get::<_, String>("problem_set_note")?,
                    row.get::<_, String>("course_name")?,
                    row.get::<_, i32>("download_status")?,
                    row.get::<_, i64>("restricted")? != 0,
                    row.get::<_, Option<String>>("prerequisite_problem_set_id")?.unwrap_or_default(),
                    row.get::<_, i64>("is_course_instructor")? != 0,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("assignment not found".to_owned()))?;
    if !ip_allowed && restricted && !is_course_instructor {
        return Err(AppError::Forbidden(
            "assignment is restricted to approved IP ranges".to_owned(),
        ));
    }
    let mut stmt = conn.prepare(
        "SELECT problem_id, problem_note, current_step_number, first_step_number, last_step_number FROM assignment_problem_progress WHERE user_id = ? AND course_id = ? AND problem_set_id = ? ORDER BY problem_id",
    )?;
    let problems = stmt
        .query_map(
            params![key.user_id, key.course_id, key.problem_set_id],
            |row| {
                Ok(AssignmentProblemProgress {
                    problem_id: row.get(0)?,
                    problem_note: row.get(1)?,
                    current_step_number: row.get(2)?,
                    first_step_number: row.get(3)?,
                    last_step_number: row.get(4)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(GetAssignmentResponse {
        assignment: Some(key.clone()),
        problem_set_note,
        course_name,
        problems,
        download_status,
        prerequisite_problem_set_id,
    })
}

pub fn list_problem_types(conn: &Connection) -> AppResult<Vec<ProblemType>> {
    let rows = conn
        .prepare("SELECT problem_type, container FROM problem_types ORDER BY problem_type")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(problem_type, container)| {
            Ok(ProblemType {
                problem_type: problem_type.clone(),
                container,
                files: load_problem_type_files(conn, &problem_type)?,
                actions: load_problem_type_actions(conn, &problem_type)?,
            })
        })
        .collect()
}

pub fn load_problem_type(conn: &Connection, problem_type: &str) -> AppResult<ProblemType> {
    let container = conn
        .query_row(
            "SELECT container FROM problem_types WHERE problem_type = ?",
            params![problem_type],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("problem type not found".to_owned()))?;
    Ok(ProblemType {
        problem_type: problem_type.to_owned(),
        container,
        files: load_problem_type_files(conn, problem_type)?,
        actions: load_problem_type_actions(conn, problem_type)?,
    })
}

pub fn load_problem_type_files(
    conn: &Connection,
    problem_type: &str,
) -> AppResult<BTreeMap<String, Vec<u8>>> {
    load_file_map(
        conn,
        "SELECT path, content FROM problem_type_files WHERE problem_type = ? ORDER BY path",
        &[problem_type],
    )
}

fn load_problem_type_actions(
    conn: &Connection,
    problem_type: &str,
) -> AppResult<BTreeMap<String, ProblemTypeAction>> {
    let mut stmt = conn.prepare(
        "SELECT action, command, COALESCE(parser, ''), max_cpu, max_fd, max_file_size, max_memory, max_threads FROM problem_type_actions WHERE problem_type = ? ORDER BY action",
    )?;
    Ok(stmt
        .query_map(params![problem_type], |row| {
            Ok((
                row.get::<_, String>(0)?,
                ProblemTypeAction {
                    command: row.get(1)?,
                    parser: row.get(2)?,
                    max_cpu: row.get(3)?,
                    max_fd: row.get(4)?,
                    max_file_size: row.get(5)?,
                    max_memory: row.get(6)?,
                    max_threads: row.get(7)?,
                },
            ))
        })?
        .collect::<Result<BTreeMap<_, _>, _>>()?)
}

pub fn get_workspace(
    conn: &Connection,
    current_user: &UserRow,
    query: WorkspaceQuery,
) -> AppResult<GetWorkspaceResponse> {
    if query.file_state == proto::WorkspaceFileState::Unspecified as i32 {
        return Err(AppError::BadRequest(
            "workspace file state is required".to_owned(),
        ));
    }
    if query.file_state != proto::WorkspaceFileState::Current as i32
        && query.file_state != proto::WorkspaceFileState::StepStart as i32
    {
        return Err(AppError::BadRequest(
            "unknown workspace file state".to_owned(),
        ));
    }
    let assignment = get_assignment(conn, current_user, &query.key, query.ip_allowed)?;
    if assignment.download_status != AssignmentDownloadStatus::Available as i32 {
        return Err(AppError::Forbidden(
            "assignment is not available for download".to_owned(),
        ));
    }
    let step = if query.requested_step > 0 {
        query.requested_step
    } else {
        assignment
            .problems
            .iter()
            .find(|p| p.problem_id == query.problem_id)
            .map(|p| p.current_step_number)
            .ok_or_else(|| AppError::NotFound("problem not found in assignment".to_owned()))?
    };
    let context = conn
        .query_row(
            "SELECT * FROM workspace_step_context WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            params![
                query.key.user_id,
                query.key.course_id,
                query.key.problem_set_id,
                query.problem_id,
                step
            ],
            |row| {
                Ok((
                    row.get::<_, String>("problem_note")?,
                    row.get::<_, String>("problem_type")?,
                    row.get::<_, String>("step_note")?,
                    row.get::<_, i64>("step_weight")?,
                    row.get::<_, i64>("first_step_number")?,
                    row.get::<_, i64>("last_step_number")?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("workspace step not found".to_owned()))?;
    let mut regular_files = load_step_files(conn, &query.problem_id, step, "regular", true)?;
    let starter_files = load_step_files(conn, &query.problem_id, step, "starter", true)?;
    let student_files = if query.file_state == proto::WorkspaceFileState::Current as i32 {
        match commit_files_if_commit_exists(conn, &query.key, &query.problem_id, step)? {
            Some(files) => files,
            None => {
                starter_student_files(conn, &query.key, &query.problem_id, step, starter_files)?
            }
        }
    } else {
        starter_student_files(conn, &query.key, &query.problem_id, step, starter_files)?
    };
    if query.include_solution_files {
        let access = conn.query_row(
            "SELECT is_course_instructor FROM accessible_assignment_fields WHERE viewer_user_id = ? AND assignment_user_id = ? AND course_id = ? AND problem_set_id = ?",
            params![
                current_user.user_id,
                query.key.user_id,
                query.key.course_id,
                query.key.problem_set_id
            ],
            |row| row.get::<_, i64>(0),
        )? != 0;
        if !current_user.author && !access {
            return Err(AppError::Forbidden(
                "solution files require author or instructor access".to_owned(),
            ));
        }
    }
    let problem_type = load_problem_type(conn, &context.1)?;
    regular_files.extend(problem_type.files.iter().map(|(path, content)| {
        (
            path.clone(),
            if query.include_contents {
                content.clone()
            } else {
                Vec::new()
            },
        )
    }));
    let (system_owned_files, student_owned_files) =
        split_system_and_student(regular_files, student_files, query.include_contents);
    Ok(GetWorkspaceResponse {
        assignment: Some(query.key),
        problem_id: query.problem_id.clone(),
        problem_note: context.0,
        step_number: step,
        problem_type: context.1,
        step_note: context.2,
        step_weight: context.3 as f64,
        actions: problem_type.actions.keys().cloned().collect(),
        system_owned_files,
        student_owned_files,
        solution_files: if query.include_solution_files {
            load_step_files(
                conn,
                &query.problem_id,
                step,
                "solution",
                query.include_contents,
            )?
        } else {
            BTreeMap::new()
        },
        first_step_number: context.4,
        last_step_number: context.5,
    })
}

fn starter_student_files(
    conn: &Connection,
    key: &AssignmentKey,
    problem_id: &str,
    step: i64,
    starter_files: BTreeMap<String, Vec<u8>>,
) -> AppResult<BTreeMap<String, Vec<u8>>> {
    let mut files = if step > 1 {
        if let Some(previous) = commit_files_if_commit_exists(conn, key, problem_id, step - 1)? {
            previous
        } else if let Some(previous) =
            continuation_previous_commit(conn, key, problem_id, step, true)?
        {
            previous
        } else {
            load_step_files(conn, problem_id, step - 1, "solution", true)?
        }
    } else {
        BTreeMap::new()
    };
    for (path, content) in starter_files {
        files.insert(path, content);
    }
    Ok(files)
}

fn commit_files_if_commit_exists(
    conn: &Connection,
    key: &AssignmentKey,
    problem_id: &str,
    step: i64,
) -> AppResult<Option<BTreeMap<String, Vec<u8>>>> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM commits WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            params![
                key.user_id,
                key.course_id,
                key.problem_set_id,
                problem_id,
                step
            ],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        current_commit_files(conn, key, problem_id, step, true).map(Some)
    } else {
        Ok(None)
    }
}

fn continuation_previous_commit(
    conn: &Connection,
    key: &AssignmentKey,
    problem_id: &str,
    step: i64,
    include_contents: bool,
) -> AppResult<Option<BTreeMap<String, Vec<u8>>>> {
    let previous = conn
        .query_row(
            "SELECT prerequisite_problem_set_id, prerequisite_step_number FROM problem_set_continuations WHERE problem_set_id = ? AND problem_id = ? AND first_step = ?",
            params![key.problem_set_id, problem_id, step],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    previous
        .map(|(previous_problem_set_id, previous_step)| {
            let previous_key = AssignmentKey {
                user_id: key.user_id.clone(),
                course_id: key.course_id.clone(),
                problem_set_id: previous_problem_set_id,
            };
            current_commit_files(
                conn,
                &previous_key,
                problem_id,
                previous_step,
                include_contents,
            )
        })
        .transpose()
}

#[derive(Clone)]
pub struct WorkspaceQuery {
    pub key: AssignmentKey,
    pub problem_id: String,
    pub requested_step: i64,
    pub file_state: i32,
    pub include_contents: bool,
    pub include_solution_files: bool,
    pub ip_allowed: bool,
}

pub fn load_step_files(
    conn: &Connection,
    problem_id: &str,
    step: i64,
    file_type: &str,
    include_contents: bool,
) -> AppResult<BTreeMap<String, Vec<u8>>> {
    let files = load_file_map(
        conn,
        "SELECT path, content FROM problem_step_files WHERE problem_id = ? AND step_number = ? AND file_type = ? ORDER BY path",
        &[problem_id, &step.to_string(), file_type],
    )?;
    Ok(if include_contents {
        files
    } else {
        files.into_keys().map(|path| (path, Vec::new())).collect()
    })
}

fn current_commit_files(
    conn: &Connection,
    key: &AssignmentKey,
    problem_id: &str,
    step: i64,
    include_contents: bool,
) -> AppResult<BTreeMap<String, Vec<u8>>> {
    let files = load_file_map(
        conn,
        "SELECT path, content FROM commit_files WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ? ORDER BY path",
        &[
            &key.user_id,
            &key.course_id,
            &key.problem_set_id,
            problem_id,
            &step.to_string(),
        ],
    )?;
    Ok(if include_contents {
        files
    } else {
        files.into_keys().map(|path| (path, Vec::new())).collect()
    })
}

pub fn search_problem_catalog(
    conn: &Connection,
    current_user: &UserRow,
    search: &[String],
) -> AppResult<Vec<ProblemCatalogSet>> {
    let mut sql = if current_user.author {
        String::from(
            "SELECT problem_set_id, problem_set_note, problem_set_tags FROM problem_catalog_sets WHERE 1",
        )
    } else {
        String::from(
            "SELECT problem_set_id, problem_set_note, problem_set_tags FROM accessible_problem_catalog_sets WHERE viewer_user_id = ?",
        )
    };
    let mut values = if current_user.author {
        Vec::new()
    } else {
        vec![current_user.user_id.clone()]
    };
    for term in search {
        sql.push_str(" AND search_text LIKE ?");
        values.push(format!("%{term}%"));
    }
    sql.push_str(" ORDER BY problem_set_id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(values), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(problem_set_id, note, tags)| {
            Ok(ProblemCatalogSet {
                problem_set_id: problem_set_id.clone(),
                problem_set_note: note,
                problem_set_tags: serde_json::from_str(&tags).unwrap_or_default(),
                problems: catalog_problems(conn, &problem_set_id)?,
            })
        })
        .collect()
}

fn catalog_problems(
    conn: &Connection,
    problem_set_id: &str,
) -> AppResult<Vec<ProblemCatalogProblem>> {
    let mut stmt = conn.prepare(
        "SELECT problem_id, problem_note, problem_weight, step_number, step_note, step_weight FROM problem_catalog_rows WHERE problem_set_id = ? ORDER BY problem_id, step_number",
    )?;
    let rows = stmt
        .query_map(params![problem_set_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                ProblemCatalogStep {
                    step_number: row.get(3)?,
                    step_note: row.get(4)?,
                    step_weight: row.get(5)?,
                },
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut problems = BTreeMap::<String, ProblemCatalogProblem>::new();
    for (problem_id, problem_note, problem_weight, step) in rows {
        problems
            .entry(problem_id.clone())
            .or_insert_with(|| ProblemCatalogProblem {
                problem_id,
                problem_note,
                problem_weight,
                steps: Vec::new(),
            })
            .steps
            .push(step);
    }
    Ok(problems.into_values().collect())
}

pub fn student_owned_paths_from_whitelist_json(raw: &str) -> AppResult<BTreeSet<String>> {
    Ok(serde_json::from_str::<BTreeMap<String, i64>>(raw)
        .map_err(|err| AppError::Internal(format!("invalid whitelist json: {err}")))?
        .into_keys()
        .collect())
}

fn load_file_map(
    conn: &Connection,
    sql: &str,
    args: &[&str],
) -> AppResult<BTreeMap<String, Vec<u8>>> {
    let mut stmt = conn.prepare(sql)?;
    Ok(stmt
        .query_map(rusqlite::params_from_iter(args.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?
        .collect::<Result<BTreeMap<_, _>, _>>()?)
}

fn to_sql_err(error: AppError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::db::open_connection;
    use crate::mutations::{save_problem_type, save_problem_type_files};
    use crate::proto::{Commit, CommitSaveStatus, ReportCard, WorkspaceFileState};
    use crate::timeutil::db_time;
    use chrono::{Duration, Utc};

    #[test]
    fn download_status_is_view_owned_for_unlock_lock_prereq_and_instructors() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_store_fixture(&conn);
        insert_assignment(
            &conn,
            "student",
            "future",
            Some(Utc::now() + Duration::days(1)),
            None,
        );
        insert_assignment(
            &conn,
            "student",
            "locked",
            None,
            Some(Utc::now() - Duration::days(1)),
        );
        insert_assignment(&conn, "student", "slice2", None, None);
        insert_assignment(
            &conn,
            "teacher",
            "future",
            Some(Utc::now() + Duration::days(1)),
            None,
        );
        let student = user(&conn, "student");
        let teacher = user(&conn, "teacher");

        let student_items = list_assignments(&conn, &student, &[], false, true).unwrap();
        let status = status_by_problem_set(&student_items);
        assert_eq!(
            status["future"],
            AssignmentDownloadStatus::NotOpen as i32,
            "unlock_at, not lock_at, controls download availability"
        );
        assert_eq!(status["locked"], AssignmentDownloadStatus::Available as i32);
        assert_eq!(
            status["slice2"],
            AssignmentDownloadStatus::PrereqNotReady as i32
        );
        assert!(
            get_workspace(
                &conn,
                &student,
                WorkspaceQuery {
                    key: key("student", "future"),
                    problem_id: "p1".to_owned(),
                    requested_step: 0,
                    file_state: WorkspaceFileState::Current as i32,
                    include_contents: true,
                    include_solution_files: false,
                    ip_allowed: true,
                },
            )
            .is_err()
        );
        assert!(
            get_workspace(
                &conn,
                &student,
                WorkspaceQuery {
                    key: key("student", "locked"),
                    problem_id: "p1".to_owned(),
                    requested_step: 0,
                    file_state: WorkspaceFileState::Current as i32,
                    include_contents: true,
                    include_solution_files: false,
                    ip_allowed: true,
                },
            )
            .is_ok()
        );

        let instructor_items = list_assignments(&conn, &teacher, &[], true, true).unwrap();
        let instructor_status = status_by_problem_set(&instructor_items);
        assert_eq!(
            instructor_status["future"],
            AssignmentDownloadStatus::Available as i32
        );
        assert_eq!(
            instructor_status["slice2"],
            AssignmentDownloadStatus::Available as i32
        );
    }

    #[test]
    fn current_workspace_layers_problem_type_and_commit_files_without_contents() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_store_fixture(&conn);
        insert_assignment(&conn, "student", "base", None, None);
        insert_commit(
            &conn,
            "student",
            "base",
            1,
            true,
            &[("answer.txt", b"passed")],
        );
        insert_commit(
            &conn,
            "student",
            "base",
            2,
            false,
            &[("answer.txt", b"commit")],
        );
        let student = user(&conn, "student");

        let workspace = get_workspace(
            &conn,
            &student,
            WorkspaceQuery {
                key: key("student", "base"),
                problem_id: "p1".to_owned(),
                requested_step: 2,
                file_state: WorkspaceFileState::Current as i32,
                include_contents: false,
                include_solution_files: false,
                ip_allowed: true,
            },
        )
        .unwrap();

        assert_eq!(
            workspace
                .system_owned_files
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["helper.txt", "runner.py", "tests.py"]
        );
        assert_eq!(
            workspace
                .student_owned_files
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["answer.txt"]
        );
        assert!(workspace.system_owned_files.values().all(Vec::is_empty));
        assert!(workspace.student_owned_files.values().all(Vec::is_empty));
        assert!(workspace.solution_files.is_empty());
    }

    #[test]
    fn solution_files_require_author_or_course_instructor() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_store_fixture(&conn);
        insert_assignment(&conn, "student", "base", None, None);
        let student = user(&conn, "student");
        let teacher = user(&conn, "teacher");

        let denied = get_workspace(
            &conn,
            &student,
            WorkspaceQuery {
                key: key("student", "base"),
                problem_id: "p1".to_owned(),
                requested_step: 1,
                file_state: WorkspaceFileState::Current as i32,
                include_contents: true,
                include_solution_files: true,
                ip_allowed: true,
            },
        );
        assert!(denied.is_err());

        let allowed = get_workspace(
            &conn,
            &teacher,
            WorkspaceQuery {
                key: key("student", "base"),
                problem_id: "p1".to_owned(),
                requested_step: 1,
                file_state: WorkspaceFileState::Current as i32,
                include_contents: false,
                include_solution_files: true,
                ip_allowed: true,
            },
        )
        .unwrap();
        assert_eq!(allowed.solution_files["answer.txt"], Vec::<u8>::new());
    }

    #[test]
    fn ip_restrictions_use_course_access_policy_not_global_role_flags() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_store_fixture(&conn);
        insert_assignment(&conn, "student", "base", None, None);
        conn.execute(
            "UPDATE assignments SET restricted = 1 WHERE user_id = 'student' AND problem_set_id = 'base'",
            [],
        )
        .unwrap();

        let student = user(&conn, "student");
        assert!(
            list_assignments(&conn, &student, &["Base".to_owned()], false, false)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list_assignments(&conn, &student, &["Base".to_owned()], false, true)
                .unwrap()
                .len(),
            1
        );

        let teacher = user(&conn, "teacher");
        assert_eq!(
            list_assignments(&conn, &teacher, &["Base".to_owned()], true, false)
                .unwrap()
                .len(),
            1
        );

        conn.execute(
            "INSERT INTO users(user_id, user_name, user_login) VALUES ('cross', 'Cross', 'cross')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO courses(course_id, course_name) VALUES ('c2', 'Other Course')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES ('cross', 'c1', 'Learner')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES ('cross', 'c2', 'Instructor')",
            [],
        )
        .unwrap();
        insert_assignment(&conn, "cross", "base", None, None);
        conn.execute(
            "UPDATE assignments SET restricted = 1 WHERE user_id = 'cross' AND problem_set_id = 'base'",
            [],
        )
        .unwrap();
        let cross = user(&conn, "cross");
        assert!(cross.instructor);
        assert!(
            list_assignments(&conn, &cross, &["Base".to_owned()], false, false)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn later_step_start_overlays_current_starters_on_previous_state() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_store_fixture(&conn);
        insert_assignment(&conn, "student", "base", None, None);
        let student = user(&conn, "student");

        let from_solution = get_workspace(
            &conn,
            &student,
            WorkspaceQuery {
                key: key("student", "base"),
                problem_id: "p1".to_owned(),
                requested_step: 2,
                file_state: WorkspaceFileState::StepStart as i32,
                include_contents: true,
                include_solution_files: false,
                ip_allowed: true,
            },
        )
        .unwrap();
        assert_eq!(from_solution.student_owned_files["answer.txt"], b"starter2");

        insert_commit(
            &conn,
            "student",
            "base",
            1,
            true,
            &[("answer.txt", b"previous work")],
        );
        let from_commit = get_workspace(
            &conn,
            &student,
            WorkspaceQuery {
                key: key("student", "base"),
                problem_id: "p1".to_owned(),
                requested_step: 2,
                file_state: WorkspaceFileState::StepStart as i32,
                include_contents: true,
                include_solution_files: false,
                ip_allowed: true,
            },
        )
        .unwrap();
        assert_eq!(from_commit.student_owned_files["answer.txt"], b"starter2");
    }

    #[test]
    fn author_problem_catalog_search_sees_unassigned_problem_sets() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_store_fixture(&conn);
        conn.execute("INSERT INTO authors(user_id) VALUES ('author')", [])
            .unwrap();

        let author = user(&conn, "author");
        let results = search_problem_catalog(&conn, &author, &["Slice".to_owned()]).unwrap();

        assert_eq!(
            results
                .iter()
                .map(|item| item.problem_set_id.as_str())
                .collect::<Vec<_>>(),
            vec!["slice1", "slice2"]
        );
    }

    #[test]
    fn continuation_step_start_overlays_current_starters_on_previous_slice_commit() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_store_fixture(&conn);
        insert_assignment(&conn, "student", "slice1", None, None);
        insert_assignment(&conn, "student", "slice2", None, None);
        insert_commit(
            &conn,
            "student",
            "slice1",
            1,
            true,
            &[("answer.txt", b"previous passed")],
        );
        let student = user(&conn, "student");

        let start = get_workspace(
            &conn,
            &student,
            WorkspaceQuery {
                key: key("student", "slice2"),
                problem_id: "p1".to_owned(),
                requested_step: 2,
                file_state: WorkspaceFileState::StepStart as i32,
                include_contents: true,
                include_solution_files: false,
                ip_allowed: true,
            },
        )
        .unwrap();
        assert_eq!(start.student_owned_files["answer.txt"], b"starter2");

        let current = get_workspace(
            &conn,
            &student,
            WorkspaceQuery {
                key: key("student", "slice2"),
                problem_id: "p1".to_owned(),
                requested_step: 0,
                file_state: WorkspaceFileState::Current as i32,
                include_contents: true,
                include_solution_files: false,
                ip_allowed: true,
            },
        )
        .unwrap();
        assert_eq!(current.step_number, 2);
    }

    #[test]
    fn assignment_scores_and_progress_are_scoped_to_problem_set_steps() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_store_fixture(&conn);
        insert_assignment(&conn, "student", "base", None, None);
        insert_assignment(&conn, "student", "slice1", None, None);
        insert_commit(
            &conn,
            "student",
            "base",
            1,
            true,
            &[("answer.txt", b"passed")],
        );
        insert_commit(
            &conn,
            "student",
            "base",
            2,
            false,
            &[("answer.txt", b"partial")],
        );
        insert_commit(
            &conn,
            "student",
            "slice1",
            1,
            true,
            &[("answer.txt", b"passed")],
        );
        let student = user(&conn, "student");

        let full = get_assignment(&conn, &student, &key("student", "base"), true).unwrap();
        assert_eq!(full.problems[0].current_step_number, 2);
        assert!(full.problems[0].last_step_number > full.problems[0].first_step_number);
        let full_score = list_assignments(&conn, &student, &["Base".to_owned()], false, true)
            .unwrap()
            .pop()
            .unwrap()
            .assignment_score;
        assert!(full_score > 0.0 && full_score < 1.0);

        let slice = get_assignment(&conn, &student, &key("student", "slice1"), true).unwrap();
        assert_eq!(slice.problems[0].first_step_number, 1);
        assert_eq!(slice.problems[0].last_step_number, 1);
        assert_eq!(slice.problems[0].current_step_number, 1);
        let slice_score = list_assignments(&conn, &student, &["Slice One".to_owned()], false, true)
            .unwrap()
            .pop()
            .unwrap()
            .assignment_score;
        assert_eq!(slice_score, 1.0);
    }

    fn status_by_problem_set(items: &[AssignmentListItem]) -> BTreeMap<String, i32> {
        items
            .iter()
            .map(|item| {
                (
                    item.assignment.as_ref().unwrap().problem_set_id.clone(),
                    item.download_status,
                )
            })
            .collect()
    }

    fn seed_store_fixture(conn: &Connection) {
        save_problem_type(
            conn,
            "python",
            "python:latest",
            &BTreeMap::from([(
                "grade".to_owned(),
                ProblemTypeAction {
                    command: "pytest".to_owned(),
                    parser: "xunit".to_owned(),
                    max_cpu: 10,
                    max_fd: 20,
                    max_file_size: 30,
                    max_memory: 40,
                    max_threads: 2,
                },
            )]),
        )
        .unwrap();
        save_problem_type_files(
            conn,
            "python",
            &BTreeMap::from([
                ("runner.py".to_owned(), b"runner".to_vec()),
                ("helper.txt".to_owned(), b"type-helper".to_vec()),
            ]),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at)
             VALUES ('p1', 'Problem', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        for (step, weight, regular, starter, solution) in [
            (
                1,
                1,
                b"tests1".as_slice(),
                b"starter1".as_slice(),
                b"solution1".as_slice(),
            ),
            (
                2,
                3,
                b"tests2".as_slice(),
                b"starter2".as_slice(),
                b"solution2".as_slice(),
            ),
            (
                3,
                1,
                b"tests3".as_slice(),
                b"starter3".as_slice(),
                b"solution3".as_slice(),
            ),
        ] {
            conn.execute(
                "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight)
                 VALUES ('p1', ?, 'python', 'Step', ?)",
                params![step, weight],
            )
            .unwrap();
            for (kind, path, content) in [
                ("regular", "tests.py", regular),
                ("regular", "helper.txt", b"regular-helper".as_slice()),
                ("starter", "answer.txt", starter),
                ("solution", "answer.txt", solution),
            ] {
                conn.execute(
                    "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content)
                     VALUES ('p1', ?, ?, ?, ?)",
                    params![step, kind, path, content],
                )
                .unwrap();
            }
        }
        for (pset, note, continues, first, last) in [
            ("base", "Base", None, None, None),
            ("future", "Future", None, None, None),
            ("locked", "Locked", None, None, None),
            ("slice1", "Slice One", None, Some(1), Some(1)),
            ("slice2", "Slice Two", Some("slice1"), Some(2), Some(2)),
        ] {
            conn.execute(
                "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, continues_problem_set_id, problem_set_created_at, problem_set_updated_at)
                 VALUES (?, ?, '[]', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                params![pset, note, continues],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step)
                 VALUES (?, 'p1', 1, ?, ?)",
                params![pset, first, last],
            )
            .unwrap();
        }
        for (user_id, name, login, roles) in [
            ("student", "Student", "student", "Learner"),
            ("teacher", "Teacher", "teacher", "Instructor"),
            ("author", "Author", "author", "Learner"),
        ] {
            conn.execute(
                "INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?)",
                params![user_id, name, login],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO courses(course_id, course_name) VALUES ('c1', 'Course')
                 ON CONFLICT(course_id) DO NOTHING",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES (?, 'c1', ?)",
                params![user_id, roles],
            )
            .unwrap();
        }
    }

    fn insert_assignment(
        conn: &Connection,
        user_id: &str,
        problem_set_id: &str,
        unlock_at: Option<chrono::DateTime<Utc>>,
        lock_at: Option<chrono::DateTime<Utc>>,
    ) {
        conn.execute(
            "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, lock_at)
             VALUES (?, 'c1', ?, ?, 0, ?, 'https://lms.example/outcome', 'text', 'consumer', ?, ?)",
            params![
                user_id,
                problem_set_id,
                format!("Assignment {problem_set_id}"),
                format!("{user_id}-{problem_set_id}"),
                unlock_at.map(db_time),
                lock_at.map(db_time),
            ],
        )
        .unwrap();
    }

    fn insert_commit(
        conn: &Connection,
        user_id: &str,
        problem_set_id: &str,
        step: i64,
        passed: bool,
        files: &[(&str, &[u8])],
    ) {
        let mut commit = Commit {
            assignment: Some(key(user_id, problem_set_id)),
            problem_id: "p1".to_owned(),
            step,
            action: "grade".to_owned(),
            note: "commit".to_owned(),
            score: if passed { 1.0 } else { 0.25 },
            report_card: Some(ReportCard {
                passed,
                note: "report".to_owned(),
                duration: None,
                results: Vec::new(),
            }),
            files: files
                .iter()
                .map(|(path, content)| ((*path).to_owned(), (*content).to_vec()))
                .collect(),
            ..Commit::default()
        };
        if !passed {
            commit.report_card.as_mut().unwrap().passed = false;
        }
        crate::mutations::save_graded_commit(
            conn,
            &user(conn, user_id),
            &crate::signatures::encode_signed_runtime_bundle(
                &crate::proto::RuntimeBundle {
                    user_id: user_id.to_owned(),
                    commit: Some(commit),
                    ..crate::proto::RuntimeBundle::default()
                },
                "daycare-secret",
            )
            .unwrap(),
            &crate::config::ServerConfig {
                hostname: "ta.example".to_owned(),
                ta_hostname: String::new(),
                daycare_secret: "daycare-secret".to_owned(),
                lti_secret: "lti-secret".to_owned(),
                session_secret: "session-secret".to_owned(),
                capacity: 1,
                problem_types: Vec::new(),
                tool_name: "CodeGrinder".to_owned(),
                tool_id: "codegrinder".to_owned(),
                tool_description: "Programming exercises".to_owned(),
                container_engine: "docker".to_owned(),
                sqlite3_path: std::path::PathBuf::new(),
                sessions_expire: Vec::new(),
                ip_filter: crate::config::IpFilterConfig::default(),
                tls_cert: None,
                tls_key: None,
                www_root: std::path::PathBuf::new(),
            },
            true,
        )
        .unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(1) FROM commits WHERE user_id = ? AND problem_set_id = ? AND step_number = ?",
                params![user_id, problem_set_id, step],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );
        assert_eq!(CommitSaveStatus::Saved as i32, 0);
    }

    fn user(conn: &Connection, user_id: &str) -> UserRow {
        load_user_by_id(conn, user_id).unwrap()
    }

    fn key(user_id: &str, problem_set_id: &str) -> AssignmentKey {
        AssignmentKey {
            user_id: user_id.to_owned(),
            course_id: "c1".to_owned(),
            problem_set_id: problem_set_id.to_owned(),
        }
    }
}
