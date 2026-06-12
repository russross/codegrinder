use crate::client::Session;
use crate::config::{
    ApiTrace, DotFile, ProblemInfo, assignment_key_from_ref, find_dotfile, load_config,
    save_dotfile,
};
use crate::daycare::{
    commit_passed, decode_signed_runtime, handle_daycare_stream, parse_signed_runtime_bundle,
};
use crate::error::{Result, fail};
use crate::files::{
    clean_relative_path, clean_workspace_tree, update_files, workspace_file_map,
    workspace_official_paths,
};
use crate::proto::codegrinder::{
    AssignmentKey, Commit, GetWorkspaceResponse, GradingCommit, WorkspaceFileState,
};
use crate::transcript::dump_transcript;
use prost_types::Timestamp;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct StudentCommandContext {
    pub workspace: GetWorkspaceResponse,
    pub commit: Commit,
    pub dotfile: DotFile,
    pub problem_dir: PathBuf,
    pub problem_info: ProblemInfo,
    pub current_paths: BTreeSet<String>,
}

pub async fn command_sync(extra: Vec<String>, trace: ApiTrace) -> Result<()> {
    if !extra.is_empty() {
        fail("usage: grind sync")?;
    }
    let mut session = connect(trace).await?;
    let student = gather_student_context(&mut session, Path::new(".")).await?;
    save_current_student_files(&mut session, &student, "grind sync").await?;
    clean_workspace_tree(
        &student.problem_dir,
        &workspace_official_paths(&student.workspace)?,
    )?;
    println!(
        "problem {} step {} synced",
        student.workspace.problem_id, student.commit.step
    );
    Ok(())
}

pub async fn command_grade(extra: Vec<String>, trace: ApiTrace) -> Result<()> {
    if !extra.is_empty() {
        fail("usage: grind grade")?;
    }
    let mut session = connect(trace).await?;
    let mut student = gather_student_context(&mut session, Path::new(".")).await?;
    let locked_for_lms = assignment_locked_for_lms(&mut session, &student).await?;
    let unsigned = build_grading_commit(&session.user.user_id, &student, "grade", "grind grade");
    let signed_resp = session.save_ungraded_commit(unsigned).await?;
    let signed = signed_resp.bundle.unwrap_or_default();
    parse_signed_runtime_bundle(
        &signed,
        "server was unable to find a suitable daycare, unable to grade",
    )?;

    println!(
        "submitting {} step {} for grading",
        student.workspace.problem_id, student.commit.step
    );
    let graded = handle_daycare_stream(&mut session, signed, Vec::new(), Path::new(""), false)
        .await?
        .ok_or_else(|| {
            crate::error::CliError::Message(
                "the server ended the connection without sending a report card".to_string(),
            )
        })?;
    session.save_graded_commit(graded.clone()).await?;
    let graded_bundle = decode_signed_runtime(&graded)?;
    let saved_commit = graded_bundle.commit.unwrap_or_default();
    if commit_passed(&saved_commit) {
        println!("step {} passed", saved_commit.step);
        if student.workspace.step_number >= student.workspace.last_step_number {
            println!("you have completed all steps for this problem");
        } else {
            let next_step_number = student.workspace.step_number + 1;
            println!("moving to step {next_step_number}");
            let assignment = student.commit.assignment.clone().unwrap_or_default();
            let next_workspace = session
                .get_workspace(
                    assignment,
                    student.workspace.problem_id.clone(),
                    next_step_number,
                    WorkspaceFileState::Current,
                    true,
                    false,
                )
                .await?;
            let mut files = workspace_file_map(&next_workspace.system_owned_files)?;
            files.extend(workspace_file_map(&next_workspace.student_owned_files)?);
            update_files(
                &PathBuf::from("."),
                &files,
                Some(&student.current_paths),
                false,
            )?;
            student.problem_info.step = next_step_number;
            update_dotfile_problem(&mut student.dotfile, &student.problem_info);
            save_dotfile(&student.dotfile)?;
        }
    } else {
        println!("  solution for step {} failed", saved_commit.step);
        if let Some(report_card) = &saved_commit.report_card {
            println!("  ReportCard: {}", report_card.note);
        }
        let transcript = dump_transcript(&saved_commit);
        print!("{transcript}");
        if !transcript.is_empty() && !transcript.ends_with('\n') && !transcript.ends_with('\r') {
            println!();
        }
    }
    if locked_for_lms {
        println!("grade was not posted to the LMS because the assignment is locked");
    }
    Ok(())
}

pub async fn command_action(action_args: Vec<String>, trace: ApiTrace) -> Result<()> {
    if action_args.len() > 1 {
        fail("usage: grind action [action]")?;
    }
    let action = action_args.first().cloned().unwrap_or_default();
    if action == "grade" {
        let program = crate::config::program_name();
        fail(format!(
            "'{program} action' is for testing code, not for grading\n  to submit your code for grading, use '{program} grade'"
        ))?;
    }
    let mut session = connect(trace).await?;
    let student = gather_student_context(&mut session, Path::new(".")).await?;
    let non_grade_actions = student
        .workspace
        .actions
        .iter()
        .filter(|name| *name != "grade")
        .cloned()
        .collect::<Vec<_>>();
    if !student.workspace.actions.contains(&action) {
        println!("available actions for this step:");
        for name in non_grade_actions {
            println!("   {name}");
        }
        let program = crate::config::program_name();
        fail(format!(
            "use '{program} action [action]' to initiate an action"
        ))?;
    }
    let unsigned = build_grading_commit(
        &session.user.user_id,
        &student,
        &action,
        &format!("grind action {action}"),
    );
    let signed_resp = session.save_ungraded_commit(unsigned).await?;
    let signed = signed_resp.bundle.unwrap_or_default();
    parse_signed_runtime_bundle(
        &signed,
        "server was unable to find a suitable daycare, unable to run action",
    )?;
    println!(
        "starting interactive session for {} step {}",
        student.workspace.problem_id, student.commit.step
    );
    handle_daycare_stream(&mut session, signed, Vec::new(), Path::new("."), true).await?;
    Ok(())
}

async fn assignment_locked_for_lms(
    session: &mut Session,
    student: &StudentCommandContext,
) -> Result<bool> {
    let assignment = student.commit.assignment.clone().unwrap_or_default();
    let response = session.list_assignments(Vec::new(), false).await?;
    Ok(response
        .items
        .iter()
        .find(|item| item.assignment.as_ref() == Some(&assignment))
        .and_then(|item| item.lock_at.as_ref())
        .is_some_and(timestamp_has_passed))
}

fn timestamp_has_passed(timestamp: &Timestamp) -> bool {
    let Ok(now) = SystemTime::now().duration_since(UNIX_EPOCH) else {
        return false;
    };
    timestamp.seconds < now.as_secs() as i64
        || (timestamp.seconds == now.as_secs() as i64
            && timestamp.nanos <= i32::try_from(now.subsec_nanos()).unwrap_or_default())
}

pub async fn command_reset(reset_args: Vec<String>, trace: ApiTrace) -> Result<()> {
    let mut session = connect(trace).await?;
    let (dotfile, problem_dir, problem_id, info) = resolve_student_problem(Path::new("."))?;
    let workspace = session
        .get_workspace(
            assignment_key_from_ref(&dotfile.assignment),
            problem_id,
            info.step,
            WorkspaceFileState::StepStart,
            true,
            false,
        )
        .await?;
    let expected_student = workspace_file_map(&workspace.student_owned_files)?;
    let student_paths = expected_student.keys().cloned().collect::<Vec<_>>();
    let exact_matches = student_paths
        .iter()
        .map(|path| (path.clone(), BTreeSet::from([path.clone()])))
        .collect::<BTreeMap<_, _>>();
    let mut basename_matches: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for path in &student_paths {
        if let Some(name) = Path::new(path).file_name() {
            basename_matches
                .entry(name.to_string_lossy().to_string())
                .or_default()
                .insert(path.clone());
        }
    }
    let mut requested_paths = BTreeSet::new();
    for requested in &reset_args {
        let matches = reset_matches(requested, &exact_matches, &basename_matches);
        if matches.is_empty() {
            fail(format!(
                "no file matching {requested:?} in the list of student files for this step"
            ))?;
        }
        requested_paths.extend(matches);
    }
    let mut files = workspace_file_map(&workspace.system_owned_files)?;
    files.extend(expected_student.clone());
    let mut modified_paths = BTreeSet::new();
    for (path, expected) in &expected_student {
        let local_path = problem_dir.join(clean_relative_path(path)?.as_path());
        if !local_path.exists() || fs::read(local_path)? != *expected {
            modified_paths.insert(path.clone());
        }
    }
    for path in modified_paths.difference(&requested_paths) {
        println!("file {path} has been modified");
        files.remove(path);
    }
    update_files(&problem_dir, &files, None, true)?;
    if modified_paths.is_empty() {
        println!("no student files have been modified since the beginning of this step");
    }
    Ok(())
}

pub fn resolve_student_problem(start: &Path) -> Result<(DotFile, PathBuf, String, ProblemInfo)> {
    let (dotfile, problem_set_dir, maybe_problem_dir) = find_dotfile(start)?;
    let (unique, problem_dir) = if dotfile.problems.len() == 1 {
        let unique = dotfile.problems.keys().next().cloned().unwrap_or_default();
        (unique, problem_set_dir)
    } else {
        let problem_dir = maybe_problem_dir.ok_or_else(|| {
            crate::error::CliError::Message(
                "you must run this from within a specific problem directory".to_string(),
            )
        })?;
        let unique = problem_dir
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        (unique, problem_dir)
    };
    let info = dotfile.problems.get(&unique).cloned().ok_or_else(|| {
        crate::error::CliError::Message(format!(
            "unable to recognize the problem based on the directory name of {unique:?}"
        ))
    })?;
    Ok((dotfile, problem_dir, info.problem_id.clone(), info))
}

pub async fn gather_student_context(
    session: &mut Session,
    start: &Path,
) -> Result<StudentCommandContext> {
    let (dotfile, problem_dir, problem_id, info) = resolve_student_problem(start)?;
    let workspace = session
        .get_workspace(
            assignment_key_from_ref(&dotfile.assignment),
            problem_id,
            info.step,
            WorkspaceFileState::Current,
            true,
            false,
        )
        .await?;
    let system_files = workspace_file_map(&workspace.system_owned_files)?;
    update_files(&problem_dir, &system_files, None, true)?;
    let student_owned_paths = workspace
        .student_owned_files
        .keys()
        .map(|path| clean_relative_path(path).map(|clean| clean.as_posix()))
        .collect::<Result<Vec<_>>>()?;
    let commit = build_commit_from_disk(
        &problem_dir,
        &student_owned_paths,
        workspace.assignment.clone().unwrap_or_default(),
        &workspace.problem_id,
        workspace.step_number,
    )?;
    let current_paths = workspace_official_paths(&workspace)?;
    Ok(StudentCommandContext {
        workspace,
        commit,
        dotfile,
        problem_dir,
        problem_info: info,
        current_paths,
    })
}

pub fn build_commit_from_disk(
    problem_dir: &Path,
    student_owned_paths: &[String],
    assignment: AssignmentKey,
    problem_id: &str,
    step_number: i64,
) -> Result<Commit> {
    let mut files = BTreeMap::new();
    let mut missing = Vec::new();
    for name in student_owned_paths {
        let relative = clean_relative_path(name)?;
        let path = problem_dir.join(relative.as_path());
        if !path.exists() {
            missing.push(name.clone());
            continue;
        }
        files.insert(relative.as_posix(), fs::read(path)?);
    }
    if !missing.is_empty() {
        let mut lines = vec!["did not find all the expected files".to_string()];
        lines.extend(
            missing
                .into_iter()
                .map(|name| format!("  {name} not found")),
        );
        lines.push("all expected files must be present".to_string());
        fail(lines.join("\n"))?;
    }
    let now = timestamp_now()?;
    Ok(Commit {
        id: 0,
        assignment: Some(assignment),
        problem_id: problem_id.to_string(),
        step: step_number,
        files,
        created_at: Some(now),
        updated_at: Some(now),
        ..Commit::default()
    })
}

pub fn build_grading_commit(
    user_id: &str,
    student: &StudentCommandContext,
    action: &str,
    note: &str,
) -> GradingCommit {
    GradingCommit {
        hostname: String::new(),
        user_id: user_id.to_string(),
        commit: Some(commit_with_metadata(&student.commit, action, note)),
    }
}

async fn save_current_student_files(
    session: &mut Session,
    student: &StudentCommandContext,
    note: &str,
) -> Result<crate::proto::codegrinder::SaveWorkspaceCommitResponse> {
    session
        .save_workspace_commit(commit_with_metadata(&student.commit, "", note))
        .await
}

fn commit_with_metadata(commit: &Commit, action: &str, note: &str) -> Commit {
    let mut updated = commit.clone();
    updated.action = action.to_string();
    updated.note = note.to_string();
    updated
}

fn reset_matches(
    requested: &str,
    exact_matches: &BTreeMap<String, BTreeSet<String>>,
    basename_matches: &BTreeMap<String, BTreeSet<String>>,
) -> BTreeSet<String> {
    let clean = Path::new(requested).to_string_lossy().to_string();
    if Path::new(&clean)
        .file_name()
        .is_some_and(|name| name == clean.as_str())
    {
        basename_matches
            .get(&clean)
            .or_else(|| exact_matches.get(&clean))
            .cloned()
            .unwrap_or_default()
    } else {
        exact_matches.get(&clean).cloned().unwrap_or_default()
    }
}

fn update_dotfile_problem(dotfile: &mut DotFile, info: &ProblemInfo) {
    if let Some(value) = dotfile
        .problems
        .values_mut()
        .find(|value| value.problem_id == info.problem_id)
    {
        value.step = info.step;
    }
}

fn timestamp_now() -> Result<Timestamp> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| crate::error::CliError::Message(error.to_string()))?;
    Ok(Timestamp {
        seconds: now.as_secs() as i64,
        nanos: now.subsec_nanos() as i32,
    })
}

async fn connect(trace: ApiTrace) -> Result<Session> {
    let mut config = load_config()?;
    config.trace = trace;
    Session::connect(config, trace).await
}
