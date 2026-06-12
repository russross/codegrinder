use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::Utc;
use ignore::Match;
use ignore::gitignore::GitignoreBuilder;
use rusqlite::{Connection, OptionalExtension, params};

use crate::config::ServerConfig;
use crate::error::{AppError, AppResult};
use crate::files::validate_file_map;
use crate::proto::{
    AssignmentKey, AuthorProblemDraft, Commit, CommitSaveStatus, GradingCommit, Problem,
    ProblemBundle, ProblemSetBundle, ProblemSetProblem, ProblemStep, ProblemType,
    ProblemTypeAction, RuntimeBundle, RuntimeLimits, SaveMode, SignedRuntimeBundle,
};
use crate::signatures::{decode_signed_runtime_bundle, encode_signed_runtime_bundle};
use crate::store::{
    UserRow, list_problem_types, load_problem_type, student_owned_paths_from_whitelist_json,
};
use crate::timeutil::{db_time, now_utc, parse_db_time, timestamp, timestamp_to_utc};

#[derive(Clone, Debug)]
pub struct CommitResult {
    pub bundle: RuntimeBundle,
    pub save_status: i32,
    pub locked: bool,
}

type FileMap = BTreeMap<String, Vec<u8>>;

pub fn save_problem_type_files(
    conn: &Connection,
    problem_type: &str,
    files: &FileMap,
) -> AppResult<ProblemType> {
    if problem_type.trim().is_empty() {
        return Err(AppError::BadRequest("problem type is required".to_owned()));
    }
    validate_file_map(files)?;
    conn.query_row(
        "SELECT 1 FROM problem_types WHERE problem_type = ?",
        params![problem_type],
        |_| Ok(()),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("problem type not found".to_owned()))?;
    conn.execute(
        "DELETE FROM problem_type_files WHERE problem_type = ?",
        params![problem_type],
    )?;
    for (path, content) in files {
        conn.execute(
            "INSERT INTO problem_type_files(problem_type, path, content) VALUES (?, ?, ?)",
            params![problem_type, path, content],
        )?;
    }
    load_problem_type(conn, problem_type)
}

pub fn save_problem_type(
    conn: &Connection,
    problem_type: &str,
    container: &str,
    actions: &BTreeMap<String, ProblemTypeAction>,
) -> AppResult<Vec<ProblemType>> {
    if problem_type.trim().is_empty() || container.trim().is_empty() {
        return Err(AppError::BadRequest(
            "problem type and container are required".to_owned(),
        ));
    }
    for (name, action) in actions {
        validate_action(name, action)?;
    }
    conn.execute(
        "INSERT INTO problem_types(problem_type, container) VALUES (?, ?) ON CONFLICT(problem_type) DO UPDATE SET container = excluded.container",
        params![problem_type, container],
    )?;
    let mut present = BTreeSet::new();
    for (name, action) in actions {
        present.insert(name.clone());
        conn.execute(
            "INSERT INTO problem_type_actions(problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads)
             VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?)
             ON CONFLICT(problem_type, action) DO UPDATE SET
                command = excluded.command,
                parser = excluded.parser,
                max_cpu = excluded.max_cpu,
                max_fd = excluded.max_fd,
                max_file_size = excluded.max_file_size,
                max_memory = excluded.max_memory,
                max_threads = excluded.max_threads",
            params![
                problem_type,
                name,
                action.command,
                action.parser,
                action.max_cpu,
                action.max_fd,
                action.max_file_size,
                action.max_memory,
                action.max_threads,
            ],
        )?;
    }
    if present.is_empty() {
        conn.execute(
            "DELETE FROM problem_type_actions WHERE problem_type = ?",
            params![problem_type],
        )?;
    } else {
        let placeholders = std::iter::repeat_n("?", present.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM problem_type_actions WHERE problem_type = ? AND action NOT IN ({placeholders})"
        );
        let values = std::iter::once(problem_type.to_owned())
            .chain(present)
            .collect::<Vec<_>>();
        conn.execute(&sql, rusqlite::params_from_iter(values))?;
    }
    list_problem_types(conn)
}

fn validate_action(name: &str, action: &ProblemTypeAction) -> AppResult<()> {
    if name.trim().is_empty() || action.command.trim().is_empty() {
        return Err(AppError::BadRequest(
            "action name and command are required".to_owned(),
        ));
    }
    if !matches!(action.parser.as_str(), "" | "xunit" | "check") {
        return Err(AppError::BadRequest(format!(
            "unknown parser {:?}",
            action.parser
        )));
    }
    if action.max_cpu <= 0
        || action.max_fd <= 0
        || action.max_file_size <= 0
        || action.max_threads <= 0
    {
        return Err(AppError::BadRequest(
            "action limits must be positive".to_owned(),
        ));
    }
    if action.max_memory <= 0 {
        return Err(AppError::BadRequest(
            "max memory must be positive".to_owned(),
        ));
    }
    Ok(())
}

fn require_positive_integer_weight(value: f64, label: &str) -> AppResult<i64> {
    if value.fract() != 0.0 {
        return Err(AppError::BadRequest(format!("{label} must be an integer")));
    }
    let out = value as i64;
    if out <= 0 {
        return Err(AppError::BadRequest(format!(
            "{label} must be greater than zero"
        )));
    }
    Ok(out)
}

pub fn prepare_problem(
    conn: &Connection,
    current_user: &UserRow,
    draft: &AuthorProblemDraft,
    action_filter: &str,
    config: &ServerConfig,
    select_daycare_host: impl Fn(&BTreeSet<String>) -> AppResult<String>,
) -> AppResult<ProblemBundle> {
    if draft.problem_id.trim().is_empty() {
        return Err(AppError::BadRequest("problem id is required".to_owned()));
    }
    if draft.problem_note.trim().is_empty() {
        return Err(AppError::BadRequest("problem note is required".to_owned()));
    }
    if draft.steps.is_empty() {
        return Err(AppError::BadRequest(
            "problem must contain at least one step".to_owned(),
        ));
    }
    let now = now_utc();
    let mut problem_types = BTreeMap::new();
    let mut problem_steps = Vec::new();
    let mut solution_commits = Vec::new();
    let mut signed_validation_bundles = Vec::new();
    let mut prior_solution_paths = BTreeSet::new();
    let type_names = draft
        .steps
        .iter()
        .map(|step| step.problem_type.clone())
        .collect::<BTreeSet<_>>();
    let hostname = select_daycare_host(&type_names)?;
    for (index, step) in draft.steps.iter().enumerate() {
        let step_number = (index + 1) as i64;
        if step.step_number != step_number {
            return Err(AppError::BadRequest(format!(
                "expected step {step_number}, found {}",
                step.step_number
            )));
        }
        if step.problem_type.trim().is_empty() {
            return Err(AppError::BadRequest(format!(
                "step {step_number} problem type is required"
            )));
        }
        let step_weight =
            require_positive_integer_weight(step.weight, &format!("step {step_number} weight"))?;
        let problem_type = load_problem_type(conn, &step.problem_type)?;
        problem_types.insert(step.problem_type.clone(), problem_type.clone());
        let (authored, starter_files) = filtered_author_files(step, &problem_type, step_number)?;
        let mut student_owned_paths = prior_solution_paths.clone();
        student_owned_paths.extend(starter_files.keys().cloned());
        let regular_files = authored
            .iter()
            .filter(|(path, _)| {
                !student_owned_paths.contains(*path) && !problem_type.files.contains_key(*path)
            })
            .map(|(path, content)| (path.clone(), content.clone()))
            .collect::<BTreeMap<_, _>>();
        let solution_files = authored
            .iter()
            .filter(|(path, _)| student_owned_paths.contains(*path))
            .map(|(path, content)| (path.clone(), content.clone()))
            .collect::<BTreeMap<_, _>>();
        let missing = student_owned_paths
            .iter()
            .filter(|path| !solution_files.contains_key(*path))
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(AppError::BadRequest(format!(
                "step {} is missing solution files for student-owned paths: {}",
                step_number,
                missing.join(", ")
            )));
        }
        let whitelist = solution_files
            .keys()
            .map(|path| (path.clone(), true))
            .collect();
        problem_steps.push(ProblemStep {
            problem_id: draft.problem_id.clone(),
            step: step_number,
            problem_type: step.problem_type.clone(),
            note: step.note.clone(),
            weight: step_weight as f64,
            files: regular_files.clone(),
            whitelist,
            starter_files: starter_files.clone(),
        });
        let commit_action = if action_filter.is_empty() {
            "grade"
        } else {
            action_filter
        };
        let commit = Commit {
            id: 0,
            assignment: Some(AssignmentKey {
                user_id: current_user.user_id.clone(),
                course_id: String::new(),
                problem_set_id: draft.problem_id.clone(),
            }),
            problem_id: draft.problem_id.clone(),
            step: step_number,
            action: commit_action.to_owned(),
            note: "author validation".to_owned(),
            files: solution_files.clone(),
            transcript: Vec::new(),
            report_card: None,
            score: 0.0,
            created_at: Some(timestamp(now)),
            updated_at: Some(timestamp(now)),
        };
        solution_commits.push(commit.clone());
        let actions = validation_actions(&problem_type, action_filter)?;
        for (action_name, action) in actions {
            let mut runtime_files = regular_files.clone();
            runtime_files.extend(problem_type.files.clone());
            runtime_files.extend(solution_files.clone());
            let bundle = RuntimeBundle {
                hostname: hostname.clone(),
                user_id: current_user.user_id.clone(),
                assignment: commit.assignment.clone(),
                problem_id: draft.problem_id.clone(),
                problem_note: draft.problem_note.clone(),
                problem_options: draft.problem_options.clone(),
                step_number,
                total_steps: draft.steps.len() as i64,
                action: action_name,
                container: problem_type.container.clone(),
                command: action.command,
                parser: action.parser,
                limits: Some(RuntimeLimits {
                    max_cpu: action.max_cpu,
                    max_fd: action.max_fd,
                    max_file_size: action.max_file_size,
                    max_memory: action.max_memory,
                    max_threads: action.max_threads,
                }),
                files: runtime_files,
                commit: Some(commit.clone()),
                starter_files: starter_files.clone(),
            };
            signed_validation_bundles.push(encode_signed_runtime_bundle(
                &bundle,
                &config.daycare_secret,
            )?);
        }
        prior_solution_paths = solution_files.keys().cloned().collect();
    }
    Ok(ProblemBundle {
        problem: Some(Problem {
            problem_id: draft.problem_id.clone(),
            problem_note: draft.problem_note.clone(),
            problem_tags: draft.problem_tags.clone(),
            problem_options: draft.problem_options.clone(),
            created_at: Some(timestamp(now)),
            updated_at: Some(timestamp(now)),
        }),
        problem_steps,
        problem_types,
        hostname,
        user_id: current_user.user_id.clone(),
        solution_commits,
        signed_validation_bundles,
    })
}

fn validation_actions(
    problem_type: &ProblemType,
    action_filter: &str,
) -> AppResult<Vec<(String, ProblemTypeAction)>> {
    if action_filter.is_empty() {
        return problem_type
            .actions
            .get("grade")
            .cloned()
            .map(|action| vec![("grade".to_owned(), action)])
            .ok_or_else(|| AppError::BadRequest("problem type has no grade action".to_owned()));
    }
    problem_type
        .actions
        .get(action_filter)
        .cloned()
        .map(|action| vec![(action_filter.to_owned(), action)])
        .ok_or_else(|| {
            AppError::BadRequest(format!("problem type has no action {action_filter:?}"))
        })
}

fn filtered_author_files(
    step: &crate::proto::AuthorProblemStepDraft,
    problem_type: &ProblemType,
    step_number: i64,
) -> AppResult<(FileMap, FileMap)> {
    let uploaded = file_vec_to_map(&step.files)?;
    let starter = file_vec_to_map(&step.starter_files)?;
    let mut effective = BTreeMap::<String, Vec<u8>>::new();
    effective.extend(
        uploaded
            .iter()
            .map(|(path, content)| (path.clone(), content.clone())),
    );
    effective.extend(
        starter
            .iter()
            .map(|(path, content)| (format!("_starter/{path}"), content.clone())),
    );
    effective.extend(
        problem_type
            .files
            .iter()
            .map(|(path, content)| (path.clone(), content.clone())),
    );
    let kept = filter_ignored_paths(&effective)?;
    let filtered_uploaded = uploaded
        .into_iter()
        .filter(|(path, _)| kept.contains(path))
        .collect();
    let filtered_starter = starter
        .into_iter()
        .filter_map(|(path, content)| {
            if !kept.contains(&format!("_starter/{path}")) {
                return None;
            }
            if problem_type.files.contains_key(&path) {
                return Some(Err(AppError::BadRequest(format!(
                    "step {step_number} starter file {path:?} conflicts with problem type file {path:?}"
                ))));
            }
            Some(Ok((path, content)))
        })
        .collect::<AppResult<BTreeMap<_, _>>>()?;
    Ok((filtered_uploaded, filtered_starter))
}

fn filter_ignored_paths(files: &FileMap) -> AppResult<BTreeSet<String>> {
    let mut builder = GitignoreBuilder::new(".");
    for (path, content) in files {
        if Path::new(path).file_name().and_then(|name| name.to_str()) != Some(".gitignore") {
            continue;
        }
        let parent = Path::new(path).parent().unwrap_or_else(|| Path::new(""));
        let prefix = if parent.as_os_str().is_empty() {
            String::new()
        } else {
            format!("{}/", path_to_slash(parent)?)
        };
        for raw_line in String::from_utf8_lossy(content).lines() {
            let line = raw_line.trim_end_matches('\r');
            let scoped = if prefix.is_empty() {
                line.to_owned()
            } else if let Some(rest) = line.strip_prefix('/') {
                format!("{prefix}{rest}")
            } else if let Some(rest) = line.strip_prefix('!') {
                format!("!{prefix}{rest}")
            } else {
                format!("{prefix}{line}")
            };
            builder
                .add_line(None, &scoped)
                .map_err(|err| AppError::BadRequest(format!("invalid .gitignore rule: {err}")))?;
        }
    }
    let matcher = builder
        .build()
        .map_err(|err| AppError::BadRequest(format!("invalid .gitignore rules: {err}")))?;
    Ok(files
        .keys()
        .filter(|path| !matches!(matcher.matched(Path::new(path), false), Match::Ignore(_)))
        .cloned()
        .collect())
}

fn path_to_slash(path: &Path) -> AppResult<String> {
    path.components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| AppError::BadRequest("path must be utf-8".to_owned()))
        })
        .collect::<AppResult<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

fn file_vec_to_map(files: &[crate::proto::AuthorFile]) -> AppResult<FileMap> {
    let out = files
        .iter()
        .map(|file| (file.path.clone(), file.content.clone()))
        .collect::<BTreeMap<_, _>>();
    validate_file_map(&out)?;
    Ok(out)
}

pub fn save_problem(
    conn: &Connection,
    current_user: &UserRow,
    mode: i32,
    bundle: &ProblemBundle,
    config: &ServerConfig,
) -> AppResult<ProblemBundle> {
    let problem = bundle
        .problem
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("problem is required".to_owned()))?;
    if bundle.user_id != current_user.user_id {
        return Err(AppError::BadRequest(
            "bundle must include user's ID".to_owned(),
        ));
    }
    if bundle.problem_steps.is_empty() {
        return Err(AppError::BadRequest(
            "problem must include at least one step".to_owned(),
        ));
    }
    if bundle.solution_commits.len() != bundle.problem_steps.len() {
        return Err(AppError::BadRequest(
            "problem must include one solution commit per step".to_owned(),
        ));
    }
    validate_save_mode(conn, mode, "problems", "problem_id", &problem.problem_id)?;
    if mode == SaveMode::Update as i32 {
        validate_assigned_problem_shape(conn, &problem.problem_id, &bundle.problem_steps)?;
    }
    let validated_commits = verify_validation_bundles(bundle, config, &current_user.user_id)?;
    let existing_created = if mode == SaveMode::Update as i32 {
        conn.query_row(
            "SELECT problem_created_at FROM problems WHERE problem_id = ?",
            params![problem.problem_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|raw| parse_db_time(&raw))
        .transpose()?
    } else {
        None
    };
    let created = existing_created.unwrap_or(
        problem
            .created_at
            .as_ref()
            .map(timestamp_to_utc)
            .transpose()?
            .unwrap_or_else(now_utc),
    );
    let updated = problem
        .updated_at
        .as_ref()
        .map(timestamp_to_utc)
        .transpose()?
        .unwrap_or_else(now_utc);
    conn.execute(
        "INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(problem_id) DO UPDATE SET problem_note = excluded.problem_note, problem_tags = excluded.problem_tags, problem_options = excluded.problem_options, problem_updated_at = excluded.problem_updated_at",
        params![
            problem.problem_id,
            problem.problem_note,
            serde_json::to_string(&problem.problem_tags)?,
            serde_json::to_string(&problem.problem_options)?,
            db_time(created),
            db_time(updated),
        ],
    )?;
    for (index, step) in bundle.problem_steps.iter().enumerate() {
        let step_number = (index + 1) as i64;
        if step.step != step_number {
            return Err(AppError::BadRequest(format!(
                "expected step {step_number}, found {}",
                step.step
            )));
        }
        let step_weight =
            require_positive_integer_weight(step.weight, &format!("step {step_number} weight"))?;
        conn.execute(
            "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(problem_id, step_number) DO UPDATE SET
                problem_type = excluded.problem_type,
                step_note = excluded.step_note,
                step_weight = excluded.step_weight",
            params![problem.problem_id, step_number, step.problem_type, step.note, step_weight],
        )?;
        insert_step_files(
            conn,
            &problem.problem_id,
            step_number,
            "regular",
            &step.files,
        )?;
        insert_step_files(
            conn,
            &problem.problem_id,
            step_number,
            "starter",
            &step.starter_files,
        )?;
        insert_step_files(
            conn,
            &problem.problem_id,
            step_number,
            "solution",
            &validated_commits[index].files,
        )?;
    }
    if mode == SaveMode::Update as i32 {
        conn.execute(
            "DELETE FROM problem_steps WHERE problem_id = ? AND step_number > ?",
            params![problem.problem_id, bundle.problem_steps.len() as i64],
        )?;
    }
    if mode == SaveMode::Create as i32 {
        create_default_problem_set(conn, problem)?;
    }
    let mut saved = bundle.clone();
    saved.user_id = current_user.user_id.clone();
    if let Some(problem) = &mut saved.problem {
        problem.created_at = Some(timestamp(created));
    }
    Ok(saved)
}

fn verify_validation_bundles(
    bundle: &ProblemBundle,
    config: &ServerConfig,
    current_user_id: &str,
) -> AppResult<Vec<Commit>> {
    if bundle.signed_validation_bundles.len() != bundle.problem_steps.len() {
        return Err(AppError::BadRequest(
            "missing validation bundles".to_owned(),
        ));
    }
    let mut validated = Vec::new();
    for (index, signed) in bundle.signed_validation_bundles.iter().enumerate() {
        let step_number = (index + 1) as i64;
        let runtime = decode_signed_runtime_bundle(signed, &config.daycare_secret)?;
        let expected = expected_validation_runtime(bundle, index)?;
        let commit = runtime.commit.as_ref().ok_or_else(|| {
            AppError::BadRequest("validation bundle commit is missing".to_owned())
        })?;
        if runtime.user_id != current_user_id {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validation user mismatch"
            )));
        }
        let problem = bundle
            .problem
            .as_ref()
            .ok_or_else(|| AppError::BadRequest("problem is required".to_owned()))?;
        if runtime.problem_id != problem.problem_id {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validation problem mismatch"
            )));
        }
        if runtime.step_number != step_number {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validation step mismatch"
            )));
        }
        if runtime.total_steps != bundle.problem_steps.len() as i64 {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validation total step mismatch"
            )));
        }
        if runtime.action != "grade" || commit.action != "grade" {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validation must be a grade action"
            )));
        }
        if commit.problem_id != problem.problem_id {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validated commit problem mismatch"
            )));
        }
        if commit.step != step_number {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validated commit step mismatch"
            )));
        }
        if commit.files != bundle.solution_commits[index].files {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validated solution files mismatch"
            )));
        }
        if runtime.files != expected.files {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validated runtime files mismatch"
            )));
        }
        if runtime.starter_files != bundle.problem_steps[index].starter_files {
            return Err(AppError::BadRequest(format!(
                "step {step_number} validated starter files mismatch"
            )));
        }
        let report = commit.report_card.as_ref().ok_or_else(|| {
            AppError::BadRequest("validation bundle report card is missing".to_owned())
        })?;
        if !report.passed || commit.score != 1.0 {
            return Err(AppError::BadRequest(
                "validation bundle did not pass".to_owned(),
            ));
        }
        validated.push(commit.clone());
    }
    Ok(validated)
}

fn expected_validation_runtime(bundle: &ProblemBundle, index: usize) -> AppResult<RuntimeBundle> {
    let problem = bundle
        .problem
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("problem is required".to_owned()))?;
    let step = bundle
        .problem_steps
        .get(index)
        .ok_or_else(|| AppError::BadRequest("problem step is missing".to_owned()))?;
    let commit = bundle
        .solution_commits
        .get(index)
        .ok_or_else(|| AppError::BadRequest("solution commit is missing".to_owned()))?;
    let problem_type = bundle
        .problem_types
        .get(&step.problem_type)
        .ok_or_else(|| AppError::BadRequest("problem type is missing".to_owned()))?;
    let action_name = if commit.action.is_empty() {
        "grade"
    } else {
        commit.action.as_str()
    };
    let action = problem_type.actions.get(action_name).ok_or_else(|| {
        AppError::BadRequest(format!(
            "action {action_name:?} not defined for problem type {:?}",
            problem_type.problem_type
        ))
    })?;
    let mut runtime_files = problem_type.files.clone();
    runtime_files.extend(step.files.clone());
    runtime_files.extend(commit.files.clone());
    let mut runtime_commit = commit.clone();
    runtime_commit.problem_id = problem.problem_id.clone();
    runtime_commit.step = step.step;
    runtime_commit.action = action_name.to_owned();
    Ok(RuntimeBundle {
        hostname: bundle.hostname.clone(),
        user_id: bundle.user_id.clone(),
        assignment: runtime_commit.assignment.clone(),
        problem_id: problem.problem_id.clone(),
        problem_note: problem.problem_note.clone(),
        problem_options: problem.problem_options.clone(),
        step_number: step.step,
        total_steps: bundle.problem_steps.len() as i64,
        action: action_name.to_owned(),
        container: problem_type.container.clone(),
        command: action.command.clone(),
        parser: action.parser.clone(),
        limits: Some(RuntimeLimits {
            max_cpu: action.max_cpu,
            max_fd: action.max_fd,
            max_file_size: action.max_file_size,
            max_memory: action.max_memory,
            max_threads: action.max_threads,
        }),
        files: runtime_files,
        commit: Some(runtime_commit),
        starter_files: step.starter_files.clone(),
    })
}

fn validate_save_mode(
    conn: &Connection,
    mode: i32,
    table: &str,
    column: &str,
    id: &str,
) -> AppResult<()> {
    let exists = conn
        .query_row(
            &format!("SELECT 1 FROM {table} WHERE {column} = ?"),
            params![id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if mode == SaveMode::Create as i32 && exists {
        return Err(AppError::Conflict(format!("{id} already exists")));
    }
    if mode == SaveMode::Update as i32 && !exists {
        return Err(AppError::NotFound(format!("{id} does not exist")));
    }
    if mode != SaveMode::Create as i32 && mode != SaveMode::Update as i32 {
        return Err(AppError::BadRequest(
            "save mode must be create or update".to_owned(),
        ));
    }
    Ok(())
}

fn validate_assigned_problem_shape(
    conn: &Connection,
    problem_id: &str,
    new_steps: &[ProblemStep],
) -> AppResult<()> {
    let assignment_count: i64 = conn.query_row(
        "SELECT COUNT(1)
         FROM assignments
         JOIN problem_set_problems
             ON problem_set_problems.problem_set_id = assignments.problem_set_id
         WHERE problem_set_problems.problem_id = ?",
        params![problem_id],
        |row| row.get(0),
    )?;
    if assignment_count == 0 {
        return Ok(());
    }
    let old_steps = conn
        .prepare(
            "SELECT step_number, problem_type FROM problem_steps WHERE problem_id = ? ORDER BY step_number",
        )?
        .query_map(params![problem_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if old_steps.len() != new_steps.len() {
        return Err(AppError::Conflict(
            "cannot change the number of steps in an assigned problem".to_owned(),
        ));
    }
    for (index, ((old_step, old_type), new_step)) in old_steps.iter().zip(new_steps).enumerate() {
        let expected_step = (index + 1) as i64;
        if *old_step != expected_step || new_step.step != expected_step {
            return Err(AppError::BadRequest(format!(
                "expected step {expected_step}, found {}",
                new_step.step
            )));
        }
        if old_type != &new_step.problem_type {
            return Err(AppError::Conflict(format!(
                "cannot change the problem type of step {expected_step} in an assigned problem"
            )));
        }
    }
    Ok(())
}

fn validate_assigned_problem_set_shape(
    conn: &Connection,
    problem_set_id: &str,
    bundle: &ProblemSetBundle,
) -> AppResult<()> {
    let assignment_count: i64 = conn.query_row(
        "SELECT COUNT(1) FROM assignments WHERE problem_set_id = ?",
        params![problem_set_id],
        |row| row.get(0),
    )?;
    if assignment_count == 0 {
        return Ok(());
    }
    let old_shape = conn
        .prepare(
            "SELECT problem_id, COALESCE(first_step, 0), COALESCE(last_step, 0)
             FROM problem_set_problems
             WHERE problem_set_id = ?
             ORDER BY problem_id",
        )?
        .query_map(params![problem_set_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut new_shape = bundle
        .problem_set_problems
        .iter()
        .map(|problem| {
            (
                problem.problem_id.clone(),
                problem.first_step,
                problem.last_step,
            )
        })
        .collect::<Vec<_>>();
    new_shape.sort();
    if old_shape != new_shape {
        return Err(AppError::Conflict(
            "cannot change problem membership or slice bounds in an assigned problem set"
                .to_owned(),
        ));
    }
    Ok(())
}

fn insert_step_files(
    conn: &Connection,
    problem_id: &str,
    step: i64,
    file_type: &str,
    files: &FileMap,
) -> AppResult<()> {
    validate_file_map(files)?;
    conn.execute(
        "DELETE FROM problem_step_files WHERE problem_id = ? AND step_number = ? AND file_type = ?",
        params![problem_id, step, file_type],
    )?;
    for (path, content) in files {
        conn.execute(
            "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
            params![problem_id, step, file_type, path, content],
        )?;
    }
    Ok(())
}

fn create_default_problem_set(conn: &Connection, problem: &Problem) -> AppResult<()> {
    let created = problem
        .created_at
        .as_ref()
        .map(timestamp_to_utc)
        .transpose()?
        .unwrap_or_else(now_utc);
    let updated = problem
        .updated_at
        .as_ref()
        .map(timestamp_to_utc)
        .transpose()?
        .unwrap_or_else(now_utc);
    conn.execute(
        "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, continues_problem_set_id, problem_set_created_at, problem_set_updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
        params![problem.problem_id, problem.problem_note, serde_json::to_string(&problem.problem_tags)?, db_time(created), db_time(updated)],
    )?;
    conn.execute(
        "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step) VALUES (?, ?, 1, NULL, NULL)",
        params![problem.problem_id, problem.problem_id],
    )?;
    Ok(())
}

pub fn save_problem_set(
    conn: &Connection,
    mode: i32,
    bundle: &ProblemSetBundle,
) -> AppResult<ProblemSetBundle> {
    let problem_set = bundle
        .problem_set
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("problem set is required".to_owned()))?;
    validate_save_mode(
        conn,
        mode,
        "problem_sets",
        "problem_set_id",
        &problem_set.problem_set_id,
    )?;
    validate_problem_set_shape(conn, bundle)?;
    if mode == SaveMode::Update as i32 {
        validate_assigned_problem_set_shape(conn, &problem_set.problem_set_id, bundle)?;
    }
    let created = problem_set
        .created_at
        .as_ref()
        .map(timestamp_to_utc)
        .transpose()?
        .unwrap_or_else(now_utc);
    let updated = problem_set
        .updated_at
        .as_ref()
        .map(timestamp_to_utc)
        .transpose()?
        .unwrap_or_else(now_utc);
    conn.execute(
        "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, continues_problem_set_id, problem_set_created_at, problem_set_updated_at)
         VALUES (?, ?, ?, NULLIF(?, ''), ?, ?)
         ON CONFLICT(problem_set_id) DO UPDATE SET problem_set_note = excluded.problem_set_note, problem_set_tags = excluded.problem_set_tags, continues_problem_set_id = excluded.continues_problem_set_id, problem_set_updated_at = excluded.problem_set_updated_at",
        params![
            problem_set.problem_set_id,
            problem_set.problem_set_note,
            serde_json::to_string(&problem_set.problem_set_tags)?,
            problem_set.continues_problem_set_id,
            db_time(created),
            db_time(updated),
        ],
    )?;
    conn.execute(
        "DELETE FROM problem_set_problems WHERE problem_set_id = ?",
        params![problem_set.problem_set_id],
    )?;
    for problem in &bundle.problem_set_problems {
        let problem_weight = require_positive_integer_weight(
            problem.weight,
            &format!("problem {} weight", problem.problem_id),
        )?;
        conn.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step) VALUES (?, ?, ?, NULLIF(?, 0), NULLIF(?, 0))",
            params![problem_set.problem_set_id, problem.problem_id, problem_weight, problem.first_step, problem.last_step],
        )?;
    }
    Ok(bundle.clone())
}

fn validate_problem_set_shape(conn: &Connection, bundle: &ProblemSetBundle) -> AppResult<()> {
    let pset = bundle
        .problem_set
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("problem set is required".to_owned()))?;
    let sliced = bundle
        .problem_set_problems
        .iter()
        .filter(|p| p.first_step > 0 || p.last_step > 0)
        .count();
    if !pset.continues_problem_set_id.is_empty() && sliced == 0 {
        return Err(AppError::BadRequest(
            "continues_problem_set_id requires a sliced problem set".to_owned(),
        ));
    }
    if sliced == 0 {
        return Ok(());
    }
    if sliced > 0 && (bundle.problem_set_problems.len() != 1 || sliced != 1) {
        return Err(AppError::BadRequest(
            "step slicing requires exactly one problem".to_owned(),
        ));
    }
    let slice = bundle
        .problem_set_problems
        .first()
        .ok_or_else(|| AppError::BadRequest("sliced problem set is empty".to_owned()))?;
    validate_slice_bounds(conn, slice)?;
    if slice.first_step == 1 {
        if !pset.continues_problem_set_id.is_empty() {
            return Err(AppError::BadRequest(
                "first slice must not continue another problem set".to_owned(),
            ));
        }
        return Ok(());
    }
    if pset.continues_problem_set_id.is_empty() {
        return Err(AppError::BadRequest(
            "sliced problem sets after step 1 require continues_problem_set_id".to_owned(),
        ));
    }
    let previous = conn
        .prepare(
            "SELECT problem_id, first_step, last_step FROM problem_set_problems WHERE problem_set_id = ?",
        )?
        .query_map(params![pset.continues_problem_set_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if previous.len() != 1 {
        return Err(AppError::BadRequest(
            "continued problem set must be a unary sliced problem set".to_owned(),
        ));
    }
    let (previous_problem_id, previous_first_step, previous_last_step) = &previous[0];
    if previous_problem_id != &slice.problem_id {
        return Err(AppError::BadRequest(
            "continued problem set must use the same problem".to_owned(),
        ));
    }
    let Some(previous_last_step) = previous_last_step else {
        return Err(AppError::BadRequest(
            "continued problem set must be sliced".to_owned(),
        ));
    };
    if previous_first_step.is_none() {
        return Err(AppError::BadRequest(
            "continued problem set must be sliced".to_owned(),
        ));
    }
    if *previous_last_step != slice.first_step - 1 {
        return Err(AppError::BadRequest(
            "continued problem set must end at the previous step".to_owned(),
        ));
    }
    Ok(())
}

fn validate_slice_bounds(conn: &Connection, slice: &ProblemSetProblem) -> AppResult<()> {
    if slice.first_step <= 0 || slice.last_step <= 0 {
        return Err(AppError::BadRequest(
            "sliced problem sets require first_step and last_step".to_owned(),
        ));
    }
    if slice.last_step < slice.first_step {
        return Err(AppError::BadRequest(
            "last_step must be greater than or equal to first_step".to_owned(),
        ));
    }
    let max_step = conn
        .query_row(
            "SELECT MAX(step_number) FROM problem_steps WHERE problem_id = ?",
            params![slice.problem_id],
            |row| row.get::<_, Option<i64>>(0),
        )?
        .unwrap_or(0);
    if max_step == 0 {
        return Err(AppError::BadRequest(format!(
            "problem {:?} does not exist",
            slice.problem_id
        )));
    }
    if slice.last_step > max_step {
        return Err(AppError::BadRequest(format!(
            "slice ends after final step for problem {:?}",
            slice.problem_id
        )));
    }
    Ok(())
}

pub fn save_workspace_commit(
    conn: &Connection,
    current_user: &UserRow,
    commit: &Commit,
    ip_allowed: bool,
) -> AppResult<(i32, String)> {
    if !commit.action.is_empty() {
        return Err(AppError::BadRequest(
            "workspace commit action must be empty".to_owned(),
        ));
    }
    save_commit_core(
        conn,
        current_user,
        commit,
        ip_allowed,
        false,
        CommitPersistence::FilesOnly,
    )
    .map(|result| (result.save_status, result.problem_note))
}

pub fn save_ungraded_commit(
    conn: &Connection,
    current_user: &UserRow,
    grading: &GradingCommit,
    ip_allowed: bool,
    select_daycare_host: impl Fn(&BTreeSet<String>) -> AppResult<String>,
) -> AppResult<CommitResult> {
    if grading.user_id != current_user.user_id {
        return Err(AppError::BadRequest(
            "bundle must include user's ID".to_owned(),
        ));
    }
    let mut commit = grading
        .commit
        .clone()
        .ok_or_else(|| AppError::BadRequest("commit is required".to_owned()))?;
    let action_name = commit.action.clone();
    commit.transcript.clear();
    commit.report_card = None;
    commit.score = 0.0;
    let mut persisted_commit = commit.clone();
    persisted_commit.action.clear();
    let result = save_commit_core(
        conn,
        current_user,
        &persisted_commit,
        ip_allowed,
        false,
        CommitPersistence::FilesOnly,
    )?;
    let key = commit
        .assignment
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("assignment is required".to_owned()))?;
    let context = load_grading_context(conn, key, &commit.problem_id, commit.step)?;
    let action = load_action(conn, &context.problem_type, &action_name)?;
    let hostname = if grading.hostname.is_empty() {
        select_daycare_host(&BTreeSet::from([context.problem_type.clone()]))?
    } else {
        grading.hostname.clone()
    };
    let mut runtime_files = context.regular_files;
    runtime_files.extend(context.problem_type_files);
    runtime_files.extend(commit.files.clone());
    let bundle = RuntimeBundle {
        hostname,
        user_id: current_user.user_id.clone(),
        assignment: commit.assignment.clone(),
        problem_id: commit.problem_id.clone(),
        problem_note: context.problem_note.clone(),
        problem_options: context.problem_options,
        step_number: commit.step,
        total_steps: context.total_steps,
        action: action_name,
        container: context.container,
        command: action.command,
        parser: action.parser,
        limits: Some(RuntimeLimits {
            max_cpu: action.max_cpu,
            max_fd: action.max_fd,
            max_file_size: action.max_file_size,
            max_memory: action.max_memory,
            max_threads: action.max_threads,
        }),
        files: runtime_files,
        commit: Some(commit),
        starter_files: context.starter_files,
    };
    Ok(CommitResult {
        bundle,
        save_status: result.save_status,
        locked: result.locked,
    })
}

pub fn save_graded_commit(
    conn: &Connection,
    current_user: &UserRow,
    signed: &SignedRuntimeBundle,
    config: &ServerConfig,
    ip_allowed: bool,
) -> AppResult<CommitResult> {
    let runtime = decode_signed_runtime_bundle(signed, &config.daycare_secret)?;
    if runtime.user_id != current_user.user_id {
        return Err(AppError::BadRequest(
            "bundle must include user's ID".to_owned(),
        ));
    }
    let commit = runtime
        .commit
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("commit is required".to_owned()))?;
    let result = save_commit_core(
        conn,
        current_user,
        commit,
        ip_allowed,
        true,
        CommitPersistence::Full,
    )?;
    Ok(CommitResult {
        bundle: runtime,
        save_status: result.save_status,
        locked: result.locked,
    })
}

struct SaveCoreResult {
    save_status: i32,
    locked: bool,
    problem_note: String,
}

#[derive(Clone, Copy)]
enum CommitPersistence {
    FilesOnly,
    Full,
}

fn save_commit_core(
    conn: &Connection,
    current_user: &UserRow,
    commit: &Commit,
    ip_allowed: bool,
    allow_action: bool,
    persistence: CommitPersistence,
) -> AppResult<SaveCoreResult> {
    let key = commit
        .assignment
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("assignment is required".to_owned()))?;
    if !allow_action && !commit.action.is_empty() {
        return Err(AppError::BadRequest(
            "workspace commit action must be empty".to_owned(),
        ));
    }
    let policy = conn
        .query_row(
            "SELECT * FROM accessible_assignment_commit_policy WHERE viewer_user_id = ? AND assignment_user_id = ? AND course_id = ? AND problem_set_id = ?",
            params![current_user.user_id, key.user_id, key.course_id, key.problem_set_id],
            |row| Ok((row.get::<_, i64>("can_save_commit")? != 0, row.get::<_, i64>("locked")? != 0, row.get::<_, i64>("not_saved_locked")? != 0, row.get::<_, i64>("not_saved_not_owner")? != 0, row.get::<_, i64>("restricted")? != 0)),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("commit target not found".to_owned()))?;
    if policy.4 && !ip_allowed {
        return Err(AppError::Forbidden(
            "assignment is restricted to approved IP ranges".to_owned(),
        ));
    }
    let context = load_grading_context(conn, key, &commit.problem_id, commit.step)?;
    require_student_owned_files(&commit.files, &context.whitelist)?;
    let save_status = if policy.0 {
        validate_commit_step_sequence(conn, key, &commit.problem_id, commit.step)?;
        persist_commit(conn, commit, persistence)?;
        CommitSaveStatus::Saved as i32
    } else if policy.2 {
        CommitSaveStatus::NotSavedLocked as i32
    } else {
        CommitSaveStatus::NotSavedNotOwner as i32
    };
    Ok(SaveCoreResult {
        save_status,
        locked: policy.1,
        problem_note: context.problem_note,
    })
}

fn validate_commit_step_sequence(
    conn: &Connection,
    key: &AssignmentKey,
    problem_id: &str,
    step: i64,
) -> AppResult<()> {
    let missing_prior_step = conn.query_row(
        "SELECT MIN(scope.step_number)
         FROM problem_set_step_scope AS scope
         LEFT JOIN passed_commit_steps AS passed
            ON passed.user_id = ?
            AND passed.course_id = ?
            AND passed.problem_set_id = scope.problem_set_id
            AND passed.problem_id = scope.problem_id
            AND passed.step_number = scope.step_number
         WHERE scope.problem_set_id = ?
            AND scope.problem_id = ?
            AND scope.step_number < ?
            AND passed.step_number IS NULL",
        params![
            key.user_id,
            key.course_id,
            key.problem_set_id,
            problem_id,
            step
        ],
        |row| row.get::<_, Option<i64>>(0),
    )?;
    if let Some(missing_step) = missing_prior_step {
        return Err(AppError::BadRequest(format!(
            "cannot save step {step} before passing step {missing_step}"
        )));
    }

    let later_started_step = conn.query_row(
        "SELECT MIN(commits.step_number)
         FROM commits
         JOIN problem_set_step_scope AS scope
            ON scope.problem_set_id = commits.problem_set_id
            AND scope.problem_id = commits.problem_id
            AND scope.step_number = commits.step_number
         WHERE commits.user_id = ?
            AND commits.course_id = ?
            AND commits.problem_set_id = ?
            AND commits.problem_id = ?
            AND commits.step_number > ?",
        params![
            key.user_id,
            key.course_id,
            key.problem_set_id,
            problem_id,
            step
        ],
        |row| row.get::<_, Option<i64>>(0),
    )?;
    if let Some(later_step) = later_started_step {
        return Err(AppError::BadRequest(format!(
            "cannot save step {step} after saved work exists for step {later_step}"
        )));
    }

    Ok(())
}

fn require_student_owned_files(files: &FileMap, whitelist: &BTreeSet<String>) -> AppResult<()> {
    validate_file_map(files)?;
    let bad = files
        .keys()
        .filter(|path| !whitelist.contains(*path))
        .cloned()
        .collect::<Vec<_>>();
    if !bad.is_empty() {
        return Err(AppError::BadRequest(format!(
            "submitted non-student-owned files: {}",
            bad.join(", ")
        )));
    }
    Ok(())
}

fn persist_commit(
    conn: &Connection,
    commit: &Commit,
    persistence: CommitPersistence,
) -> AppResult<()> {
    let key = commit
        .assignment
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("assignment is required".to_owned()))?;
    let now = Utc::now();
    let report_json = commit
        .report_card
        .as_ref()
        .map(|report| {
            let duration = report
                .duration
                .as_ref()
                .map(|duration| duration.seconds * 1_000_000_000 + i64::from(duration.nanos))
                .unwrap_or(0);
            serde_json::json!({
                "passed": report.passed,
                "note": report.note,
                "duration": duration,
                "results": report.results.iter().map(|result| {
                    serde_json::json!({
                        "name": result.name,
                        "outcome": result.outcome,
                        "details": result.details,
                        "context": result.context,
                    })
                }).collect::<Vec<_>>(),
            })
        })
        .unwrap_or(serde_json::Value::Null);
    match persistence {
        CommitPersistence::Full => {
            conn.execute(
                "INSERT INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, course_id, problem_set_id, problem_id, step_number) DO UPDATE SET
                    action = excluded.action,
                    note = excluded.note,
                    transcript = excluded.transcript,
                    report_card = excluded.report_card,
                    score = excluded.score,
                    commit_updated_at = excluded.commit_updated_at",
                params![
                    key.user_id,
                    key.course_id,
                    key.problem_set_id,
                    commit.problem_id,
                    commit.step,
                    commit.action,
                    commit.note,
                    serde_json::to_string(&transcript_json(commit))?,
                    serde_json::to_string(&report_json)?,
                    commit.score,
                    db_time(now),
                    db_time(now),
                ],
            )?;
        }
        CommitPersistence::FilesOnly => {
            conn.execute(
                "INSERT INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at)
                 VALUES (?, ?, ?, ?, ?, '', ?, '[]', 'null', 0.0, ?, ?)
                 ON CONFLICT(user_id, course_id, problem_set_id, problem_id, step_number) DO UPDATE SET
                    note = excluded.note,
                    commit_updated_at = excluded.commit_updated_at",
                params![
                    key.user_id,
                    key.course_id,
                    key.problem_set_id,
                    commit.problem_id,
                    commit.step,
                    commit.note,
                    db_time(now),
                    db_time(now),
                ],
            )?;
        }
    }
    conn.execute(
        "DELETE FROM commit_files WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
        params![key.user_id, key.course_id, key.problem_set_id, commit.problem_id, commit.step],
    )?;
    for (path, content) in &commit.files {
        conn.execute(
            "INSERT INTO commit_files(user_id, course_id, problem_set_id, problem_id, step_number, path, content) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![key.user_id, key.course_id, key.problem_set_id, commit.problem_id, commit.step, path, content],
        )?;
    }
    Ok(())
}

fn transcript_json(commit: &Commit) -> Vec<serde_json::Value> {
    commit
        .transcript
        .iter()
        .map(|event| {
            serde_json::json!({
                "time": event.time.as_ref().map(|time| {
                    serde_json::json!({"seconds": time.seconds, "nanos": time.nanos})
                }),
                "event": event.event,
                "exec_command": event.exec_command,
                "exit_status": event.exit_status,
                "stream_data": String::from_utf8_lossy(&event.stream_data),
                "error": event.error,
                "files": event.files.iter().map(|(path, content)| {
                    (path.clone(), String::from_utf8_lossy(content).to_string())
                }).collect::<BTreeMap<_, _>>(),
            })
        })
        .collect()
}

struct GradingContext {
    problem_note: String,
    problem_options: Vec<String>,
    problem_type: String,
    container: String,
    total_steps: i64,
    whitelist: BTreeSet<String>,
    regular_files: FileMap,
    starter_files: FileMap,
    problem_type_files: FileMap,
}

fn load_grading_context(
    conn: &Connection,
    key: &AssignmentKey,
    problem_id: &str,
    step: i64,
) -> AppResult<GradingContext> {
    let row = conn
        .query_row(
            "SELECT * FROM grading_step_context WHERE problem_set_id = ? AND problem_id = ? AND step_number = ?",
            params![key.problem_set_id, problem_id, step],
            |row| {
                Ok((
                    row.get::<_, String>("problem_note")?,
                    row.get::<_, String>("problem_options")?,
                    row.get::<_, String>("problem_type")?,
                    row.get::<_, String>("container")?,
                    row.get::<_, i64>("total_steps")?,
                    row.get::<_, String>("whitelist")?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("grading step not found".to_owned()))?;
    Ok(GradingContext {
        problem_note: row.0,
        problem_options: serde_json::from_str(&row.1).unwrap_or_default(),
        problem_type: row.2.clone(),
        container: row.3,
        total_steps: row.4,
        whitelist: student_owned_paths_from_whitelist_json(&row.5)?,
        regular_files: crate::store::load_step_files(conn, problem_id, step, "regular", true)?,
        starter_files: crate::store::load_step_files(conn, problem_id, step, "starter", true)?,
        problem_type_files: crate::store::load_problem_type_files(conn, &row.2)?,
    })
}

fn load_action(
    conn: &Connection,
    problem_type: &str,
    action: &str,
) -> AppResult<ProblemTypeAction> {
    conn.query_row(
        "SELECT command, COALESCE(parser, ''), max_cpu, max_fd, max_file_size, max_memory, max_threads FROM problem_type_actions WHERE problem_type = ? AND action = ?",
        params![problem_type, action],
        |row| {
            Ok(ProblemTypeAction {
                command: row.get(0)?,
                parser: row.get(1)?,
                max_cpu: row.get(2)?,
                max_fd: row.get(3)?,
                max_file_size: row.get(4)?,
                max_memory: row.get(5)?,
                max_threads: row.get(6)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::BadRequest(format!("unknown action {action:?} for problem type {problem_type:?}")))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::config::{IpFilterConfig, ServerConfig};
    use crate::db::open_connection;
    use crate::proto::{
        AuthorFile, AuthorProblemStepDraft, ProblemSet, ProblemSetProblem, ReportCard,
        ReportCardResult,
    };

    #[test]
    fn problem_type_action_save_replaces_absent_actions_without_recreating_type() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        let first = BTreeMap::from([
            (
                "grade".to_owned(),
                ProblemTypeAction {
                    command: "make test".to_owned(),
                    parser: "xunit".to_owned(),
                    max_cpu: 10,
                    max_fd: 100,
                    max_file_size: 5,
                    max_memory: 256,
                    max_threads: 16,
                },
            ),
            (
                "demo".to_owned(),
                ProblemTypeAction {
                    command: "make demo".to_owned(),
                    parser: String::new(),
                    max_cpu: 10,
                    max_fd: 100,
                    max_file_size: 5,
                    max_memory: 256,
                    max_threads: 16,
                },
            ),
        ]);
        save_problem_type(&conn, "python", "image:v1", &first).unwrap();
        conn.execute(
            "INSERT INTO problem_type_files(problem_type, path, content) VALUES ('python', 'runner.py', x'01')",
            [],
        )
        .unwrap();

        let second = BTreeMap::from([(
            "grade".to_owned(),
            ProblemTypeAction {
                command: "pytest".to_owned(),
                parser: "xunit".to_owned(),
                max_cpu: 20,
                max_fd: 200,
                max_file_size: 6,
                max_memory: 512,
                max_threads: 32,
            },
        )]);
        let types = save_problem_type(&conn, "python", "image:v2", &second).unwrap();

        let python = types
            .into_iter()
            .find(|problem_type| problem_type.problem_type == "python")
            .unwrap();
        assert_eq!(python.container, "image:v2");
        assert_eq!(
            python.actions.keys().cloned().collect::<Vec<_>>(),
            vec!["grade"]
        );
        assert_eq!(python.actions["grade"].command, "pytest");
        assert_eq!(
            python.files.keys().cloned().collect::<Vec<_>>(),
            vec!["runner.py"]
        );
    }

    #[test]
    fn ungraded_grade_saves_files_without_grade_metadata_and_returns_grade_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_grading_fixture(&conn);
        let current_user = student_user();
        let commit = commit_for_student("grade", "grind grade", b"new");

        let result = save_ungraded_commit(
            &conn,
            &current_user,
            &GradingCommit {
                hostname: String::new(),
                user_id: "u1".to_owned(),
                commit: Some(commit),
            },
            true,
            |_| Ok("daycare".to_owned()),
        )
        .unwrap();

        assert_eq!(result.bundle.action, "grade");
        assert_eq!(result.bundle.commit.as_ref().unwrap().action, "grade");
        let row = stored_commit(&conn);
        assert_eq!(row.0, "");
        assert_eq!(row.1, "null");
        assert_eq!(row.2, 0.0);
        assert_eq!(stored_file(&conn, "answer.txt"), b"new");
    }

    #[test]
    fn ungraded_commit_honors_explicit_daycare_hostname() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_grading_fixture(&conn);
        let current_user = student_user();
        let commit = commit_for_student("grade", "grind grade", b"new");

        let result = save_ungraded_commit(
            &conn,
            &current_user,
            &GradingCommit {
                hostname: "explicit-daycare".to_owned(),
                user_id: "u1".to_owned(),
                commit: Some(commit),
            },
            true,
            |_| {
                Err(AppError::Internal(
                    "registry should not be consulted".to_owned(),
                ))
            },
        )
        .unwrap();

        assert_eq!(result.bundle.hostname, "explicit-daycare");
    }

    #[test]
    fn ungraded_action_preserves_existing_passing_grade_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_grading_fixture(&conn);
        insert_passing_commit(&conn);
        let current_user = student_user();
        let commit = commit_for_student("demo", "grind action demo", b"changed");

        let result = save_ungraded_commit(
            &conn,
            &current_user,
            &GradingCommit {
                hostname: String::new(),
                user_id: "u1".to_owned(),
                commit: Some(commit),
            },
            true,
            |_| Ok("daycare".to_owned()),
        )
        .unwrap();

        assert_eq!(result.bundle.action, "demo");
        let row = stored_commit(&conn);
        assert_eq!(row.0, "grade");
        let report: serde_json::Value = serde_json::from_str(&row.1).unwrap();
        assert_eq!(report["passed"], true);
        assert_eq!(report["note"], "ok");
        assert_eq!(row.2, 1.0);
        assert_eq!(stored_file(&conn, "answer.txt"), b"changed");
    }

    #[test]
    fn locked_ungraded_and_graded_commits_are_saved_for_progress() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_grading_fixture(&conn);
        conn.execute(
            "UPDATE assignments SET lock_at = '2020-01-01T00:00:00Z' WHERE user_id = 'u1'",
            [],
        )
        .unwrap();
        let current_user = student_user();
        let config = test_config();
        let commit = commit_for_student("grade", "grind grade", b"locked");

        let ungraded = save_ungraded_commit(
            &conn,
            &current_user,
            &GradingCommit {
                hostname: String::new(),
                user_id: "u1".to_owned(),
                commit: Some(commit.clone()),
            },
            true,
            |_| Ok("daycare".to_owned()),
        )
        .unwrap();

        assert_eq!(ungraded.save_status, CommitSaveStatus::Saved as i32);
        assert!(ungraded.locked);
        assert_eq!(ungraded.bundle.action, "grade");
        assert_eq!(stored_file(&conn, "answer.txt"), b"locked");

        let mut runtime = ungraded.bundle;
        mark_runtime_passed(&mut runtime);
        let signed = encode_signed_runtime_bundle(&runtime, &config.daycare_secret).unwrap();
        let graded = save_graded_commit(&conn, &current_user, &signed, &config, true).unwrap();

        assert_eq!(graded.save_status, CommitSaveStatus::Saved as i32);
        assert!(graded.locked);
        let row = conn
            .query_row(
                "SELECT action, score FROM commits WHERE user_id = 'u1' AND course_id = 'c1' AND problem_set_id = 'ps1' AND problem_id = 'p1' AND step_number = 1",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)),
            )
            .unwrap();
        assert_eq!(row.0, "grade");
        assert_eq!(row.1, 1.0);
    }

    #[test]
    fn graded_commit_persists_full_report_card_details() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_grading_fixture(&conn);
        let current_user = student_user();
        let config = test_config();
        let mut commit = commit_for_student("grade", "grind grade", b"new");
        commit.report_card = Some(ReportCard {
            passed: false,
            note: "one failed".to_owned(),
            duration: Some(prost_types::Duration {
                seconds: 2,
                nanos: 3,
            }),
            results: vec![ReportCardResult {
                name: "case".to_owned(),
                outcome: "failed".to_owned(),
                details: "details".to_owned(),
                context: "context".to_owned(),
            }],
        });
        commit.score = 0.5;
        let signed = encode_signed_runtime_bundle(
            &RuntimeBundle {
                user_id: "u1".to_owned(),
                commit: Some(commit),
                ..RuntimeBundle::default()
            },
            &config.daycare_secret,
        )
        .unwrap();

        let result = save_graded_commit(&conn, &current_user, &signed, &config, true).unwrap();

        assert_eq!(result.save_status, CommitSaveStatus::Saved as i32);
        let report: String = conn
            .query_row("SELECT report_card FROM commits", [], |row| row.get(0))
            .unwrap();
        let report: serde_json::Value = serde_json::from_str(&report).unwrap();
        assert_eq!(report["passed"], false);
        assert_eq!(report["duration"], 2_000_000_003_i64);
        assert_eq!(report["results"][0]["name"], "case");
        assert_eq!(report["results"][0]["outcome"], "failed");
        assert_eq!(report["results"][0]["details"], "details");
        assert_eq!(report["results"][0]["context"], "context");
    }

    #[test]
    fn instructor_commit_for_student_assignment_is_not_saved_not_owner() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_grading_fixture(&conn);
        seed_instructor(&conn);
        let current_user = load_user(&conn, "instructor");
        let commit = commit_for_student("demo", "inspect", b"instructor changed");

        let result = save_ungraded_commit(
            &conn,
            &current_user,
            &GradingCommit {
                hostname: String::new(),
                user_id: "instructor".to_owned(),
                commit: Some(commit),
            },
            true,
            |_| Ok("daycare".to_owned()),
        )
        .unwrap();

        assert_eq!(
            result.save_status,
            CommitSaveStatus::NotSavedNotOwner as i32
        );
        assert_eq!(result.bundle.user_id, "instructor");
        assert_no_saved_commit(&conn);
    }

    #[test]
    fn submitted_commit_files_must_be_normalized_student_owned_paths() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_grading_fixture(&conn);
        let current_user = student_user();

        for path in ["tests.py", "../answer.txt", "sub\\answer.txt"] {
            let mut commit = commit_for_student("", "sync", b"new");
            commit.files = BTreeMap::from([(path.to_owned(), b"bad".to_vec())]);
            assert!(
                save_workspace_commit(&conn, &current_user, &commit, true).is_err(),
                "{path}"
            );
        }
    }

    #[test]
    fn commit_save_rejects_skipping_unpassed_scoped_steps() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_two_step_problem(&conn);
        insert_problem_set(&conn, "ps1", None, &[("p1", 0, 0)]);
        seed_assignment(&conn, "ps1");
        let current_user = student_user();
        let mut commit = commit_for_student("", "skip", b"step two");
        commit.step = 2;

        let error = save_workspace_commit(&conn, &current_user, &commit, true).unwrap_err();

        assert!(error.to_string().contains("before passing step 1"));
    }

    #[test]
    fn commit_save_rejects_rewriting_prior_step_after_later_work() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_two_step_problem(&conn);
        insert_problem_set(&conn, "ps1", None, &[("p1", 0, 0)]);
        seed_assignment(&conn, "ps1");
        let current_user = student_user();
        insert_passing_commit(&conn);
        let mut later = commit_for_student("", "started step two", b"step two");
        later.step = 2;
        persist_commit(&conn, &later, CommitPersistence::FilesOnly).unwrap();
        let commit = commit_for_student("", "rewrite step one", b"step one rewrite");

        let error = save_workspace_commit(&conn, &current_user, &commit, true).unwrap_err();

        assert!(error.to_string().contains("exists for step 2"));
    }

    #[test]
    fn commit_sequence_uses_problem_set_step_scope() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_two_step_problem(&conn);
        insert_problem_set(&conn, "slice2", None, &[("p1", 2, 2)]);
        seed_assignment(&conn, "slice2");
        let current_user = student_user();
        let mut commit = commit_for_student("", "slice step", b"step two");
        let key = commit.assignment.as_mut().unwrap();
        key.problem_set_id = "slice2".to_owned();
        commit.step = 2;

        let result = save_workspace_commit(&conn, &current_user, &commit, true).unwrap();

        assert_eq!(result.0, CommitSaveStatus::Saved as i32);
    }

    #[test]
    fn graded_commit_rejects_runtime_for_different_user() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_grading_fixture(&conn);
        let config = test_config();
        let current_user = student_user();
        let runtime = RuntimeBundle {
            user_id: "u2".to_owned(),
            commit: Some(commit_for_student("grade", "done", b"ok")),
            ..RuntimeBundle::default()
        };
        let signed = encode_signed_runtime_bundle(&runtime, &config.daycare_secret).unwrap();

        assert!(save_graded_commit(&conn, &current_user, &signed, &config, true).is_err());
    }

    #[test]
    fn save_problem_rejects_validation_with_different_solution_files() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();
        let mut bundle = prepared_author_bundle(&conn, &current_user, &config);
        sign_passing_validations(&mut bundle, &config);
        bundle.solution_commits[0]
            .files
            .insert("answer.txt".to_owned(), b"tampered".to_vec());

        assert!(
            save_problem(
                &conn,
                &current_user,
                SaveMode::Create as i32,
                &bundle,
                &config
            )
            .is_err()
        );
    }

    #[test]
    fn save_problem_rejects_validation_with_different_runtime_files() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();
        let mut bundle = prepared_author_bundle(&conn, &current_user, &config);
        let mut runtime = decode_signed_runtime_bundle(
            &bundle.signed_validation_bundles[0],
            &config.daycare_secret,
        )
        .unwrap();
        runtime
            .files
            .insert("extra.txt".to_owned(), b"extra".to_vec());
        mark_runtime_passed(&mut runtime);
        bundle.signed_validation_bundles[0] =
            encode_signed_runtime_bundle(&runtime, &config.daycare_secret).unwrap();

        assert!(
            save_problem(
                &conn,
                &current_user,
                SaveMode::Create as i32,
                &bundle,
                &config
            )
            .is_err()
        );
    }

    #[test]
    fn save_problem_rejects_extra_or_wrongly_signed_validation_bundles() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();
        let mut bundle = prepared_author_bundle(&conn, &current_user, &config);
        sign_passing_validations(&mut bundle, &config);
        bundle
            .signed_validation_bundles
            .push(bundle.signed_validation_bundles[0].clone());
        assert!(
            save_problem(
                &conn,
                &current_user,
                SaveMode::Create as i32,
                &bundle,
                &config
            )
            .is_err()
        );

        let mut bundle = prepared_author_bundle(&conn, &current_user, &config);
        let mut runtime = decode_signed_runtime_bundle(
            &bundle.signed_validation_bundles[0],
            &config.daycare_secret,
        )
        .unwrap();
        mark_runtime_passed(&mut runtime);
        bundle.signed_validation_bundles[0] =
            encode_signed_runtime_bundle(&runtime, "wrong-secret").unwrap();
        assert!(
            save_problem(
                &conn,
                &current_user,
                SaveMode::Create as i32,
                &bundle,
                &config
            )
            .is_err()
        );
    }

    #[test]
    fn save_problem_rejects_non_grade_or_partial_validation_success() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();

        let mut bundle = prepared_author_bundle(&conn, &current_user, &config);
        let mut runtime = decode_signed_runtime_bundle(
            &bundle.signed_validation_bundles[0],
            &config.daycare_secret,
        )
        .unwrap();
        mark_runtime_passed(&mut runtime);
        runtime.commit.as_mut().unwrap().score = 0.5;
        bundle.signed_validation_bundles[0] =
            encode_signed_runtime_bundle(&runtime, &config.daycare_secret).unwrap();
        assert!(
            save_problem(
                &conn,
                &current_user,
                SaveMode::Create as i32,
                &bundle,
                &config
            )
            .is_err()
        );

        let mut bundle = prepared_author_bundle(&conn, &current_user, &config);
        let mut runtime = decode_signed_runtime_bundle(
            &bundle.signed_validation_bundles[0],
            &config.daycare_secret,
        )
        .unwrap();
        mark_runtime_passed(&mut runtime);
        runtime.action = "demo".to_owned();
        runtime.commit.as_mut().unwrap().action = "demo".to_owned();
        bundle.signed_validation_bundles[0] =
            encode_signed_runtime_bundle(&runtime, &config.daycare_secret).unwrap();
        assert!(
            save_problem(
                &conn,
                &current_user,
                SaveMode::Create as i32,
                &bundle,
                &config
            )
            .is_err()
        );
    }

    #[test]
    fn save_problem_update_replaces_author_material_without_deleting_existing_commits() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();
        let create_draft = AuthorProblemDraft {
            problem_id: "new-problem".to_owned(),
            problem_note: "New problem".to_owned(),
            steps: vec![AuthorProblemStepDraft {
                step_number: 1,
                problem_type: "python".to_owned(),
                note: "step one".to_owned(),
                weight: 1.0,
                files: vec![
                    file("answer.txt", b"solution"),
                    file("tests.py", b"old tests"),
                    file("old.txt", b"remove me"),
                ],
                starter_files: vec![file("answer.txt", b"starter")],
            }],
            ..AuthorProblemDraft::default()
        };
        let mut create =
            prepared_author_bundle_from_draft(&conn, &current_user, &config, create_draft);
        sign_passing_validations(&mut create, &config);
        save_problem(
            &conn,
            &current_user,
            SaveMode::Create as i32,
            &create,
            &config,
        )
        .unwrap();
        let original_created_at: String = conn
            .query_row(
                "SELECT problem_created_at FROM problems WHERE problem_id = 'new-problem'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        conn.execute(
            "INSERT INTO users(user_id, user_name, user_login) VALUES ('u1', 'Student', 'student')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO courses(course_id, course_name) VALUES ('c1', 'Course')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES ('u1', 'c1', 'Learner')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key)
             VALUES ('u1', 'c1', 'new-problem', 'Assignment', 0, 'grade1', 'https://lms.example/outcome', 'text', 'consumer')",
            [],
        )
        .unwrap();
        let mut commit = commit_for_student("grade", "passed", b"student work");
        commit.assignment.as_mut().unwrap().problem_set_id = "new-problem".to_owned();
        commit.problem_id = "new-problem".to_owned();
        commit.report_card = Some(ReportCard {
            passed: true,
            note: "ok".to_owned(),
            duration: None,
            results: Vec::new(),
        });
        commit.score = 1.0;
        persist_commit(&conn, &commit, CommitPersistence::Full).unwrap();

        let update_draft = AuthorProblemDraft {
            problem_id: "new-problem".to_owned(),
            problem_note: "Updated problem".to_owned(),
            steps: vec![AuthorProblemStepDraft {
                step_number: 1,
                problem_type: "python".to_owned(),
                note: "updated step one".to_owned(),
                weight: 2.0,
                files: vec![
                    file("answer.txt", b"updated solution"),
                    file("tests.py", b"new tests"),
                ],
                starter_files: vec![file("answer.txt", b"updated starter")],
            }],
            ..AuthorProblemDraft::default()
        };
        let mut update =
            prepared_author_bundle_from_draft(&conn, &current_user, &config, update_draft);
        sign_passing_validations(&mut update, &config);
        let saved = save_problem(
            &conn,
            &current_user,
            SaveMode::Update as i32,
            &update,
            &config,
        )
        .unwrap();

        assert_eq!(
            saved.problem.unwrap().created_at.unwrap(),
            timestamp(parse_db_time(&original_created_at).unwrap())
        );
        let commit_count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM commits WHERE user_id = 'u1' AND problem_set_id = 'new-problem' AND problem_id = 'new-problem' AND step_number = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(commit_count, 1);
        let saved_work: Vec<u8> = conn
            .query_row(
                "SELECT content FROM commit_files WHERE user_id = 'u1' AND problem_set_id = 'new-problem' AND problem_id = 'new-problem' AND step_number = 1 AND path = 'answer.txt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(saved_work, b"student work");
        let old_file_count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM problem_step_files WHERE problem_id = 'new-problem' AND step_number = 1 AND path = 'old.txt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_file_count, 0);
        let tests: Vec<u8> = conn
            .query_row(
                "SELECT content FROM problem_step_files WHERE problem_id = 'new-problem' AND step_number = 1 AND file_type = 'regular' AND path = 'tests.py'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tests, b"new tests");
        let step_count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM problem_steps WHERE problem_id = 'new-problem'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(step_count, 1);
    }

    #[test]
    fn save_problem_rejects_assigned_step_count_or_type_changes() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        save_problem_type(
            &conn,
            "other",
            "other:latest",
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
        save_problem_type_files(&conn, "other", &BTreeMap::new()).unwrap();
        seed_problem(&conn, "p1", 1);
        insert_problem_set(&conn, "ps1", None, &[("p1", 0, 0)]);
        seed_assignment(&conn, "ps1");
        let current_user = author_user();
        let config = test_config();

        let added_step = AuthorProblemDraft {
            problem_id: "p1".to_owned(),
            problem_note: "Updated problem".to_owned(),
            steps: vec![
                AuthorProblemStepDraft {
                    step_number: 1,
                    problem_type: "python".to_owned(),
                    note: "step one".to_owned(),
                    weight: 1.0,
                    files: vec![file("answer.txt", b"solution")],
                    starter_files: vec![file("answer.txt", b"starter")],
                },
                AuthorProblemStepDraft {
                    step_number: 2,
                    problem_type: "python".to_owned(),
                    note: "step two".to_owned(),
                    weight: 1.0,
                    files: vec![file("answer.txt", b"solution")],
                    starter_files: Vec::new(),
                },
            ],
            ..AuthorProblemDraft::default()
        };
        let added_step_bundle =
            prepared_author_bundle_from_draft(&conn, &current_user, &config, added_step);
        assert!(matches!(
            save_problem(
                &conn,
                &current_user,
                SaveMode::Update as i32,
                &added_step_bundle,
                &config,
            ),
            Err(AppError::Conflict(_))
        ));

        let changed_type = AuthorProblemDraft {
            problem_id: "p1".to_owned(),
            problem_note: "Updated problem".to_owned(),
            steps: vec![AuthorProblemStepDraft {
                step_number: 1,
                problem_type: "other".to_owned(),
                note: "step one".to_owned(),
                weight: 1.0,
                files: vec![file("answer.txt", b"solution")],
                starter_files: vec![file("answer.txt", b"starter")],
            }],
            ..AuthorProblemDraft::default()
        };
        let changed_type_bundle =
            prepared_author_bundle_from_draft(&conn, &current_user, &config, changed_type);
        assert!(matches!(
            save_problem(
                &conn,
                &current_user,
                SaveMode::Update as i32,
                &changed_type_bundle,
                &config,
            ),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn save_problem_set_rejects_assigned_membership_or_slice_changes() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_two_step_problem(&conn);
        seed_problem(&conn, "p2", 1);
        insert_problem_set(&conn, "ps1", None, &[("p1", 1, 1)]);
        seed_assignment(&conn, "ps1");

        let mut weight_only = problem_set_bundle("ps1", "", &[problem_set_problem("p1", 1, 1)]);
        weight_only.problem_set_problems[0].weight = 2.0;
        save_problem_set(&conn, SaveMode::Update as i32, &weight_only).unwrap();

        let slice_change = problem_set_bundle("ps1", "", &[problem_set_problem("p1", 1, 2)]);
        assert!(matches!(
            save_problem_set(&conn, SaveMode::Update as i32, &slice_change),
            Err(AppError::Conflict(_))
        ));

        let membership_change = problem_set_bundle("ps1", "", &[problem_set_problem("p2", 0, 0)]);
        assert!(matches!(
            save_problem_set(&conn, SaveMode::Update as i32, &membership_change),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn prepare_problem_applies_nested_gitignore_rules() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();
        let draft = AuthorProblemDraft {
            problem_id: "ignored".to_owned(),
            problem_note: "Ignored files".to_owned(),
            steps: vec![AuthorProblemStepDraft {
                step_number: 1,
                problem_type: "python".to_owned(),
                note: "step".to_owned(),
                weight: 1.0,
                files: vec![
                    file("answer.txt", b"solution"),
                    file("src/.gitignore", b"*.tmp\n!important.tmp\n"),
                    file("src/drop.tmp", b"drop"),
                    file("src/important.tmp", b"keep"),
                ],
                starter_files: vec![file("answer.txt", b"starter")],
            }],
            ..AuthorProblemDraft::default()
        };

        let bundle = prepare_problem(&conn, &current_user, &draft, "", &config, |_| {
            Ok("daycare".to_owned())
        })
        .unwrap();

        let files = &bundle.problem_steps[0].files;
        assert!(!files.contains_key("src/drop.tmp"));
        assert!(files.contains_key("src/important.tmp"));
    }

    #[test]
    fn prepare_problem_applies_root_gitignore_to_starter_overlay_paths() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();
        let draft = AuthorProblemDraft {
            problem_id: "ignored-starter".to_owned(),
            problem_note: "Ignored starter".to_owned(),
            steps: vec![AuthorProblemStepDraft {
                step_number: 1,
                problem_type: "python".to_owned(),
                note: "step".to_owned(),
                weight: 1.0,
                files: vec![
                    file(".gitignore", b"_starter/*.txt\n"),
                    file("answer.txt", b"solution"),
                ],
                starter_files: vec![file("answer.txt", b"starter")],
            }],
            ..AuthorProblemDraft::default()
        };

        let bundle = prepare_problem(&conn, &current_user, &draft, "", &config, |_| {
            Ok("daycare".to_owned())
        })
        .unwrap();

        assert!(bundle.problem_steps[0].starter_files.is_empty());
        assert!(bundle.problem_steps[0].files.contains_key("answer.txt"));
        assert!(bundle.solution_commits[0].files.is_empty());
    }

    #[test]
    fn prepare_problem_rejects_starter_conflicting_with_problem_type_file() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();
        let draft = AuthorProblemDraft {
            problem_id: "conflict".to_owned(),
            problem_note: "Conflict".to_owned(),
            steps: vec![AuthorProblemStepDraft {
                step_number: 1,
                problem_type: "python".to_owned(),
                note: "step".to_owned(),
                weight: 1.0,
                files: vec![file("answer.txt", b"solution")],
                starter_files: vec![file("runner.py", b"bad")],
            }],
            ..AuthorProblemDraft::default()
        };

        assert!(
            prepare_problem(&conn, &current_user, &draft, "", &config, |_| {
                Ok("daycare".to_owned())
            })
            .is_err()
        );
    }

    #[test]
    fn prepare_problem_action_validation_bundle_has_matching_commit_action() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_problem_type(&conn);
        let current_user = author_user();
        let config = test_config();
        let draft = AuthorProblemDraft {
            problem_id: "new-problem".to_owned(),
            problem_note: "New problem".to_owned(),
            steps: vec![AuthorProblemStepDraft {
                step_number: 1,
                problem_type: "python".to_owned(),
                note: "step".to_owned(),
                weight: 1.0,
                files: vec![file("answer.txt", b"solution"), file("demo.py", b"demo")],
                starter_files: vec![file("answer.txt", b"starter")],
            }],
            ..AuthorProblemDraft::default()
        };

        let bundle = prepare_problem(&conn, &current_user, &draft, "demo", &config, |_| {
            Ok("daycare".to_owned())
        })
        .unwrap();
        let runtime = decode_signed_runtime_bundle(
            &bundle.signed_validation_bundles[0],
            &config.daycare_secret,
        )
        .unwrap();

        assert_eq!(runtime.action, "demo");
        assert_eq!(runtime.commit.unwrap().action, "demo");
    }

    #[test]
    fn save_problem_set_rejects_continuation_without_slice_and_first_slice_continuation() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_two_step_problem(&conn);
        insert_problem_set(&conn, "prior", None, &[("p1", 1, 1)]);

        let unsliced =
            problem_set_bundle("bad-unsliced", "prior", &[problem_set_problem("p1", 0, 0)]);
        assert!(save_problem_set(&conn, SaveMode::Create as i32, &unsliced).is_err());

        let first_slice =
            problem_set_bundle("bad-first", "prior", &[problem_set_problem("p1", 1, 1)]);
        assert!(save_problem_set(&conn, SaveMode::Create as i32, &first_slice).is_err());
    }

    #[test]
    fn save_problem_set_rejects_bad_continuation_predecessors() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_connection(&dir.path().join("db.sqlite")).unwrap();
        seed_two_step_problem(&conn);
        seed_problem(&conn, "p2", 1);
        insert_problem_set(&conn, "multi", None, &[("p1", 1, 1), ("p2", 1, 1)]);
        insert_problem_set(&conn, "unsliced", None, &[("p1", 0, 0)]);
        insert_problem_set(&conn, "wrong-problem", None, &[("p2", 1, 1)]);
        insert_problem_set(&conn, "wrong-step", None, &[("p1", 1, 2)]);

        for predecessor in ["multi", "unsliced", "wrong-problem", "wrong-step"] {
            let bundle =
                problem_set_bundle("next", predecessor, &[problem_set_problem("p1", 2, 2)]);
            assert!(
                save_problem_set(&conn, SaveMode::Create as i32, &bundle).is_err(),
                "{predecessor}"
            );
        }
    }

    fn test_config() -> ServerConfig {
        ServerConfig {
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
            ip_filter: IpFilterConfig::default(),
            tls_cert: None,
            tls_key: None,
            www_root: std::path::PathBuf::new(),
        }
    }

    fn student_user() -> UserRow {
        UserRow {
            user_id: "u1".to_owned(),
            user_name: "Student".to_owned(),
            user_login: "student".to_owned(),
            admin: false,
            author: false,
            instructor: false,
        }
    }

    fn author_user() -> UserRow {
        UserRow {
            user_id: "author".to_owned(),
            user_name: "Author".to_owned(),
            user_login: "author".to_owned(),
            admin: false,
            author: true,
            instructor: false,
        }
    }

    fn seed_problem_type(conn: &Connection) {
        save_problem_type(
            conn,
            "python",
            "python:latest",
            &BTreeMap::from([
                (
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
                ),
                (
                    "demo".to_owned(),
                    ProblemTypeAction {
                        command: "python demo.py".to_owned(),
                        parser: String::new(),
                        max_cpu: 10,
                        max_fd: 20,
                        max_file_size: 30,
                        max_memory: 40,
                        max_threads: 2,
                    },
                ),
            ]),
        )
        .unwrap();
        save_problem_type_files(
            conn,
            "python",
            &BTreeMap::from([("runner.py".to_owned(), b"runner".to_vec())]),
        )
        .unwrap();
    }

    fn seed_grading_fixture(conn: &Connection) {
        seed_problem_type(conn);
        seed_problem(conn, "p1", 1);
        insert_problem_set(conn, "ps1", None, &[("p1", 0, 0)]);
        conn.execute(
            "INSERT INTO users(user_id, user_name, user_login) VALUES ('u1', 'Student', 'student')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO courses(course_id, course_name) VALUES ('c1', 'Course')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES ('u1', 'c1', 'Learner')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key)
             VALUES ('u1', 'c1', 'ps1', 'Assignment', 0, 'grade1', 'https://lms.example/outcome', 'text', 'consumer')",
            [],
        )
        .unwrap();
    }

    fn seed_two_step_problem(conn: &Connection) {
        seed_problem_type(conn);
        seed_problem(conn, "p1", 2);
    }

    fn seed_problem(conn: &Connection, problem_id: &str, steps: i64) {
        conn.execute(
            "INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at)
             VALUES (?, 'Problem', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![problem_id],
        )
        .unwrap();
        for step in 1..=steps {
            conn.execute(
                "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight)
                 VALUES (?, ?, 'python', 'Step', 1)",
                params![problem_id, step],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content)
                 VALUES (?, ?, 'solution', 'answer.txt', x'6f6b')",
                params![problem_id, step],
            )
            .unwrap();
        }
    }

    fn insert_problem_set(
        conn: &Connection,
        problem_set_id: &str,
        continues: Option<&str>,
        problems: &[(&str, i64, i64)],
    ) {
        conn.execute(
            "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, continues_problem_set_id, problem_set_created_at, problem_set_updated_at)
             VALUES (?, 'Set', '[]', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![problem_set_id, continues],
        )
        .unwrap();
        for (problem_id, first_step, last_step) in problems {
            conn.execute(
                "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step)
                 VALUES (?, ?, 1, NULLIF(?, 0), NULLIF(?, 0))",
                params![problem_set_id, problem_id, first_step, last_step],
            )
            .unwrap();
        }
    }

    fn seed_assignment(conn: &Connection, problem_set_id: &str) {
        conn.execute(
            "INSERT INTO users(user_id, user_name, user_login) VALUES ('u1', 'Student', 'student')
             ON CONFLICT(user_id) DO NOTHING",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO courses(course_id, course_name) VALUES ('c1', 'Course')
             ON CONFLICT(course_id) DO NOTHING",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES ('u1', 'c1', 'Learner')
             ON CONFLICT(user_id, course_id) DO NOTHING",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key)
             VALUES ('u1', 'c1', ?, 'Assignment', 0, 'grade1', 'https://lms.example/outcome', 'text', 'consumer')",
            params![problem_set_id],
        )
        .unwrap();
    }

    fn commit_for_student(action: &str, note: &str, content: &[u8]) -> Commit {
        Commit {
            assignment: Some(AssignmentKey {
                user_id: "u1".to_owned(),
                course_id: "c1".to_owned(),
                problem_set_id: "ps1".to_owned(),
            }),
            problem_id: "p1".to_owned(),
            step: 1,
            action: action.to_owned(),
            note: note.to_owned(),
            files: BTreeMap::from([("answer.txt".to_owned(), content.to_vec())]),
            ..Commit::default()
        }
    }

    fn insert_passing_commit(conn: &Connection) {
        let mut commit = commit_for_student("grade", "passed", b"old");
        commit.report_card = Some(ReportCard {
            passed: true,
            note: "ok".to_owned(),
            duration: None,
            results: Vec::new(),
        });
        commit.score = 1.0;
        persist_commit(conn, &commit, CommitPersistence::Full).unwrap();
    }

    fn seed_instructor(conn: &Connection) {
        conn.execute(
            "INSERT INTO users(user_id, user_name, user_login) VALUES ('instructor', 'Instructor', 'instructor')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES ('instructor', 'c1', 'Instructor')",
            [],
        )
        .unwrap();
    }

    fn load_user(conn: &Connection, user_id: &str) -> UserRow {
        crate::store::load_user_by_id(conn, user_id).unwrap()
    }

    fn assert_no_saved_commit(conn: &Connection) {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM commits WHERE user_id = 'u1' AND course_id = 'c1' AND problem_set_id = 'ps1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    fn stored_commit(conn: &Connection) -> (String, String, f64) {
        conn.query_row(
            "SELECT action, report_card, score FROM commits WHERE user_id = 'u1' AND course_id = 'c1' AND problem_set_id = 'ps1' AND problem_id = 'p1' AND step_number = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap()
    }

    fn stored_file(conn: &Connection, path: &str) -> Vec<u8> {
        conn.query_row(
            "SELECT content FROM commit_files WHERE user_id = 'u1' AND course_id = 'c1' AND problem_set_id = 'ps1' AND problem_id = 'p1' AND step_number = 1 AND path = ?",
            params![path],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn prepared_author_bundle(
        conn: &Connection,
        current_user: &UserRow,
        config: &ServerConfig,
    ) -> ProblemBundle {
        let draft = AuthorProblemDraft {
            problem_id: "new-problem".to_owned(),
            problem_note: "New problem".to_owned(),
            steps: vec![AuthorProblemStepDraft {
                step_number: 1,
                problem_type: "python".to_owned(),
                note: "step".to_owned(),
                weight: 1.0,
                files: vec![file("answer.txt", b"solution"), file("tests.py", b"tests")],
                starter_files: vec![file("answer.txt", b"starter")],
            }],
            ..AuthorProblemDraft::default()
        };
        prepared_author_bundle_from_draft(conn, current_user, config, draft)
    }

    fn prepared_author_bundle_from_draft(
        conn: &Connection,
        current_user: &UserRow,
        config: &ServerConfig,
        draft: AuthorProblemDraft,
    ) -> ProblemBundle {
        prepare_problem(conn, current_user, &draft, "", config, |_| {
            Ok("daycare".to_owned())
        })
        .unwrap()
    }

    fn sign_passing_validations(bundle: &mut ProblemBundle, config: &ServerConfig) {
        for signed in &mut bundle.signed_validation_bundles {
            let mut runtime = decode_signed_runtime_bundle(signed, &config.daycare_secret).unwrap();
            mark_runtime_passed(&mut runtime);
            *signed = encode_signed_runtime_bundle(&runtime, &config.daycare_secret).unwrap();
        }
    }

    fn mark_runtime_passed(runtime: &mut RuntimeBundle) {
        let commit = runtime.commit.as_mut().unwrap();
        commit.report_card = Some(ReportCard {
            passed: true,
            note: "ok".to_owned(),
            duration: None,
            results: Vec::new(),
        });
        commit.score = 1.0;
    }

    fn file(path: &str, content: &[u8]) -> AuthorFile {
        AuthorFile {
            path: path.to_owned(),
            content: content.to_vec(),
        }
    }

    fn problem_set_bundle(
        problem_set_id: &str,
        continues: &str,
        problems: &[ProblemSetProblem],
    ) -> ProblemSetBundle {
        ProblemSetBundle {
            problem_set: Some(ProblemSet {
                problem_set_id: problem_set_id.to_owned(),
                problem_set_note: "Set".to_owned(),
                problem_set_tags: Vec::new(),
                continues_problem_set_id: continues.to_owned(),
                ..ProblemSet::default()
            }),
            problem_set_problems: problems.to_vec(),
        }
    }

    fn problem_set_problem(problem_id: &str, first_step: i64, last_step: i64) -> ProblemSetProblem {
        ProblemSetProblem {
            problem_id: problem_id.to_owned(),
            weight: 1.0,
            first_step,
            last_step,
            ..ProblemSetProblem::default()
        }
    }
}
