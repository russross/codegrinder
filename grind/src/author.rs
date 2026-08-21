use crate::assignment::download_assignment_to_root;
use crate::author_config::{
    AuthorProblemConfig, PROBLEM_CONFIG_NAME, parse_author_problem_config,
    parse_author_problem_set_config,
};
use crate::client::{Session, login as client_login};
use crate::config::{ApiTrace, Config, home_dir, load_config, program_name, write_login_config};
use crate::daycare::{commit_passed, decode_signed_runtime, handle_daycare_stream};
use crate::error::{CliError, Result, fail};
use crate::files::{update_files, workspace_file_map};
use crate::presentation::{print_problem_catalog, sorted_student_assignment_items};
use crate::proto::codegrinder::{
    AuthorFile, AuthorProblemDraft, AuthorProblemStepDraft, ProblemBundle, ProblemSet,
    ProblemSetBundle, ProblemSetProblem, SaveMode, WorkspaceFileState,
};
use crate::student::resolve_student_problem;
use crate::transcript::dump_transcript;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::tempdir_in;

#[derive(Clone, Debug)]
pub struct AuthorProblemLayout {
    pub root_dir: PathBuf,
    pub active_step_dir: PathBuf,
    pub active_step_number: i64,
    pub config: AuthorProblemConfig,
}

#[derive(Clone, Debug)]
pub struct PreparedAuthorStep {
    pub directory: PathBuf,
    pub problem_type_files: BTreeSet<String>,
}

pub async fn command_login(login_args: Vec<String>, trace: ApiTrace) -> Result<()> {
    if login_args.len() != 2 {
        let program = program_name();
        println!(
            "To log in, click on an assignment in Canvas and follow the\ninstructions given. You should run a command of the form:\n\n{program} login <hostname> <token>\n\nwhere <hostname> and <token> are given in the instructions.\n\nYou should normally only need to do this once per semester.\n"
        );
        fail(format!("Usage: {program} login <hostname> <token>"))?;
    }
    let host = login_args[0].clone();
    let token = login_args[1].clone();
    let response = client_login(&host, &token, trace)
        .await
        .map_err(|error| CliError::Message(format!("failed to login: {error}")))?;
    let config = Config {
        host,
        session_key: response.session_key.clone(),
        workspace_root: home_dir(),
        roles: crate::config::Roles {
            is_author: response.is_author,
            is_instructor: response.is_instructor,
            is_admin: response.is_admin,
        },
        trace,
        rpc_timeout: trace.rpc_timeout,
    };
    write_login_config(&config)?;
    println!("login successful; welcome {}", response.user_name);
    Ok(())
}

pub async fn command_problem(search: Vec<String>, trace: ApiTrace) -> Result<()> {
    if search.is_empty() {
        let program = program_name();
        fail(format!(
            "you must specify search terms to find the problem set\n  terms will match against the problem set name, note,\n  and tags, or against the same attributes of a problem\n  in the problem set. All searches are case-insensitive.\n  e.g.: '{program} problem cs2810 formula'"
        ))?;
    }
    let mut session = connect(trace).await?;
    let mut problem_sets = session.search_problem_catalog(search).await?.problem_sets;
    problem_sets.sort_by_cached_key(|pset| pset.problem_set_id.to_lowercase());
    if problem_sets.is_empty() {
        fail("no problem sets found matching the terms you gave")?;
    }
    print_problem_catalog(&problem_sets, &session.config.host);
    Ok(())
}

pub async fn command_solve(extra: Vec<String>, trace: ApiTrace) -> Result<()> {
    if !extra.is_empty() {
        fail("usage: grind solve")?;
    }
    let mut session = connect(trace).await?;
    let (dotfile, problem_dir, problem_id, info) = resolve_student_problem(Path::new("."))?;
    let workspace = session
        .get_workspace(
            crate::config::assignment_key_from_ref(&dotfile.assignment),
            problem_id,
            info.step,
            WorkspaceFileState::Current,
            true,
            true,
        )
        .await?;
    if workspace.solution_files.is_empty() {
        fail("no solution files found")?;
    }
    update_files(
        &problem_dir,
        &workspace_file_map(&workspace.solution_files)?,
        None,
        true,
    )?;
    Ok(())
}

pub async fn command_type(
    type_args: Vec<String>,
    remove: bool,
    list: bool,
    trace: ApiTrace,
) -> Result<()> {
    let mut session = connect(trace).await?;
    if list {
        if !type_args.is_empty() || remove {
            println!("warning: for a list request, other options will be ignored");
        }
        println!("Problem types:");
        let response = session.get_problem_types().await?;
        if response.problem_types.is_empty() {
            fail("no problem types found")?;
        }
        let width = response
            .problem_types
            .iter()
            .map(|problem_type| problem_type.problem_type.len())
            .max()
            .unwrap_or(0);
        for problem_type in response.problem_types {
            let actions = problem_type
                .actions
                .keys()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            println!(
                "    {:<width$}  actions: {actions}",
                problem_type.problem_type
            );
        }
        return Ok(());
    }
    let (problem_type_name, directory) = match type_args.as_slice() {
        [] => {
            let layout = resolve_author_problem_layout(Path::new("."))?.ok_or_else(|| {
                CliError::Message(format!(
                    "you must supply the problem type or have a valid {PROBLEM_CONFIG_NAME} file already in place"
                ))
            })?;
            if !layout.config.single_step_layout && layout.active_step_number < 1 {
                fail("you must run this from within a step directory")?;
            }
            let problem_type = active_problem_type(&layout)?;
            (problem_type, layout.active_step_dir)
        }
        [problem_type_name] => (problem_type_name.clone(), PathBuf::from(".")),
        _ => fail("usage: grind type [--remove] [--list] [TYPE]")?,
    };
    let response = session.get_problem_type(problem_type_name).await?;
    let problem_type = response.problem_type.unwrap_or_default();
    if remove {
        let old_files = problem_type.files.keys().cloned().collect::<BTreeSet<_>>();
        update_files(&directory, &BTreeMap::new(), Some(&old_files), true)?;
    } else {
        update_files(
            &directory,
            &workspace_file_map(&problem_type.files)?,
            None,
            true,
        )?;
    }
    Ok(())
}

pub async fn command_student(search: Vec<String>, trace: ApiTrace) -> Result<()> {
    if search.is_empty() {
        let program = program_name();
        fail(format!(
            "you must specify the assignment to download\n   either give the student's assignment number\n   or give search terms to find the assignment\n   where terms search assignment name, course name,\n   problem set name, problem set tags, user name, and user email\n   e.g.: '{program} student alice loops'"
        ))?;
    }
    let mut session = connect(trace).await?;
    let items =
        sorted_student_assignment_items(session.list_assignments(search, true).await?.items);
    if items.is_empty() {
        fail("no assignments found matching the terms you gave")?;
    }
    validate_student_assignment_items(&items)?;
    let user_ids = items
        .iter()
        .filter_map(|item| {
            item.assignment
                .as_ref()
                .map(|assignment| assignment.user_id.clone())
        })
        .collect::<BTreeSet<_>>();
    let longest_num = items.len().to_string().len();
    let mut prev_user_id = String::new();
    for (index, item) in items.iter().enumerate() {
        let Some(assignment) = item.assignment.as_ref() else {
            return fail("server returned a student assignment without an assignment key");
        };
        if assignment.user_id != prev_user_id {
            if !prev_user_id.is_empty() {
                println!();
            }
            prev_user_id = assignment.user_id.clone();
            println!("{} ({})", item.user_name, item.user_login);
            println!(
                "{}",
                "-".repeat(item.user_name.len() + item.user_login.len() + 3)
            );
        }
        let when = item
            .due_at
            .as_ref()
            .map(|ts| format_utc_timestamp(ts.seconds))
            .unwrap_or_else(|| "no due date".to_string());
        println!(
            "{:>longest_num$}. {} ({}) [{when}]",
            index + 1,
            assignment.problem_set_id,
            item.course_name
        );
    }
    println!();
    if user_ids.len() == 1 {
        let Some(item) = items.last().cloned() else {
            return fail("no assignments found matching the terms you gave");
        };
        download_student_assignment(&mut session, item).await
    } else {
        fail(
            "the search found assignments for more than one user\n   repeat the search with additional terms\n   to narrow the results to a single student",
        )
    }
}

pub async fn command_create(
    create_args: Vec<String>,
    is_update: bool,
    action: String,
    trace: ApiTrace,
) -> Result<()> {
    let pset = match create_args.as_slice() {
        [] => String::new(),
        [path] => path.clone(),
        _ => fail("usage: grind create [--update] [--action ACTION] [PSET.cfg]")?,
    };
    let mut session = connect(trace).await?;
    if !pset.is_empty() {
        if !action.is_empty() {
            fail("you cannot specify an action when creating a problem set")?;
        }
        save_problem_set(&mut session, Path::new(&pset), is_update).await?;
        return Ok(());
    }
    if is_update && !action.is_empty() {
        fail("you specified --update, which is not valid when running an action")?;
    }
    let layout = resolve_author_problem_layout(Path::new("."))?.ok_or_else(|| {
        CliError::Message(format!(
            "unable to find {PROBLEM_CONFIG_NAME} in current directory or one of its ancestors\n   you must run this in a problem directory"
        ))
    })?;
    let prepared_steps = prepare_author_steps(&mut session, &layout).await?;
    let (draft, step_dir, step_num) =
        gather_author(&action, Path::new("."), Some(&prepared_steps))?;
    let mut bundle = session.prepare_problem(draft, action.clone()).await?;
    if bundle.hostname.is_empty() {
        fail("server was unable to find a suitable daycare, unable to validate")?;
    }
    if !action.is_empty() {
        if step_num < 1 {
            fail("to use --action, you must run from within a step directory")?;
        }
        println!("running interactive session for action {action:?} on step {step_num}");
        let signed = bundle
            .signed_validation_bundles
            .get((step_num - 1) as usize)
            .cloned()
            .ok_or_else(|| {
                CliError::Message(
                    "server returned no validation bundle for the active step".to_string(),
                )
            })?;
        handle_daycare_stream(&mut session, signed, Vec::new(), &step_dir, true).await?;
        return Ok(());
    }
    validate_author_solution_bundle(&mut session, &mut bundle).await?;
    let response = session
        .save_problem(
            if is_update {
                SaveMode::Update
            } else {
                SaveMode::Create
            },
            bundle,
        )
        .await?;
    let final_bundle = response.bundle.unwrap_or_default();
    let problem_id = final_bundle
        .problem
        .map(|problem| problem.problem_id)
        .unwrap_or_default();
    let verb = if is_update { "saved" } else { "created" };
    println!("problem {problem_id:?} {verb} and ready to use");
    Ok(())
}

pub fn resolve_author_problem_layout(start_dir: &Path) -> Result<Option<AuthorProblemLayout>> {
    let mut directory = start_dir.canonicalize()?;
    let mut step_dir = directory.clone();
    while !directory.join(PROBLEM_CONFIG_NAME).exists() {
        step_dir = directory.clone();
        let Some(parent) = directory.parent() else {
            return Ok(None);
        };
        if parent == directory {
            return Ok(None);
        }
        directory = parent.to_path_buf();
    }
    let config = parse_author_problem_config(&directory.join(PROBLEM_CONFIG_NAME))?;
    let step_num = if config.single_step_layout {
        1
    } else if step_dir != directory {
        step_dir
            .file_name()
            .and_then(|name| name.to_string_lossy().parse::<i64>().ok())
            .filter(|n| *n >= 1 && *n <= config.steps.len() as i64)
            .unwrap_or(0)
    } else {
        0
    };
    Ok(Some(AuthorProblemLayout {
        root_dir: directory,
        active_step_dir: step_dir,
        active_step_number: step_num,
        config,
    }))
}

pub async fn prepare_author_steps(
    session: &mut Session,
    layout: &AuthorProblemLayout,
) -> Result<BTreeMap<i64, PreparedAuthorStep>> {
    let mut prepared = BTreeMap::new();
    for (index, step) in layout.config.steps.iter().enumerate() {
        let step_number = index as i64 + 1;
        let step_directory = if layout.config.single_step_layout {
            layout.root_dir.clone()
        } else {
            layout.root_dir.join(step_number.to_string())
        };
        if !step_directory.is_dir() {
            fail(format!(
                "missing step directory {}",
                step_directory.display()
            ))?;
        }
        println!("refreshing problem type files for step {step_number}");
        let response = session.get_problem_type(step.problem_type.clone()).await?;
        let problem_type = response.problem_type.unwrap_or_default();
        let files = workspace_file_map(&problem_type.files)?;
        update_files(&step_directory, &files, None, true)?;

        println!("running make clean for step {step_number}");
        let status = Command::new("make")
            .arg("clean")
            .current_dir(&step_directory)
            .status();
        match status {
            Ok(status) if status.success() => {}
            Ok(status) => fail(format!(
                "error running make clean in {}: {status}",
                step_directory.display()
            ))?,
            Err(error) => fail(format!(
                "error running make clean in {}: {error}",
                step_directory.display()
            ))?,
        }

        prepared.insert(
            step_number,
            PreparedAuthorStep {
                directory: step_directory,
                problem_type_files: files.keys().cloned().collect(),
            },
        );
    }
    Ok(prepared)
}

pub fn gather_author(
    action: &str,
    start_dir: &Path,
    prepared_steps: Option<&BTreeMap<i64, PreparedAuthorStep>>,
) -> Result<(AuthorProblemDraft, PathBuf, i64)> {
    let layout = resolve_author_problem_layout(start_dir)?.ok_or_else(|| {
        CliError::Message(format!(
            "unable to find {PROBLEM_CONFIG_NAME} in current directory or one of its ancestors\n   you must run this in a problem directory"
        ))
    })?;
    let directory = layout.root_dir.clone();
    if layout.config.single_step_layout && directory.join("1").is_dir() {
        fail(format!(
            "{PROBLEM_CONFIG_NAME} is set up for a single-step problem with the step files in\n  the same directory as {PROBLEM_CONFIG_NAME}, but there is also a directory named '1'\n  Please add a [step \"1\"] entry to {PROBLEM_CONFIG_NAME} or move the step files\n  into the main directory and delete the '1' directory"
        ))?;
    }
    if directory.file_name().map(|name| name.to_string_lossy())
        != Some(layout.config.problem_id.clone().into())
    {
        fail("the problem directory name must match the problem unique ID")?;
    }
    let mut draft = AuthorProblemDraft {
        problem_id: layout.config.problem_id.clone(),
        problem_note: layout.config.note.clone(),
        problem_tags: layout.config.tags.clone(),
        problem_options: layout.config.options.clone(),
        steps: Vec::new(),
    };
    for (index, step) in layout.config.steps.iter().enumerate() {
        let step_number = index as i64 + 1;
        println!("gathering step {step_number}");
        let prepared = prepared_steps.and_then(|map| map.get(&step_number));
        let step_directory = prepared.map_or_else(
            || {
                if layout.config.single_step_layout {
                    directory.clone()
                } else {
                    directory.join(step_number.to_string())
                }
            },
            |prepared| prepared.directory.clone(),
        );
        let problem_type_files = prepared
            .map(|prepared| prepared.problem_type_files.clone())
            .unwrap_or_default();
        let (files, starter_files) = gather_step_tree(
            &layout.config,
            &step_directory,
            step_number,
            &problem_type_files,
        )?;
        let step_draft = AuthorProblemStepDraft {
            step_number,
            problem_type: step.problem_type.clone(),
            note: step.note.clone(),
            weight: step.weight,
            files,
            starter_files,
        };
        println!(
            "  found {} authored file{} and {} starter file{}",
            step_draft.files.len(),
            plural(step_draft.files.len()),
            step_draft.starter_files.len(),
            plural(step_draft.starter_files.len())
        );
        draft.steps.push(step_draft);
    }
    if !action.is_empty() && !layout.config.single_step_layout && layout.active_step_number < 1 {
        fail("to run an action, you must be in a step directory")?;
    }
    Ok((draft, layout.active_step_dir, layout.active_step_number))
}

pub async fn save_problem_set(session: &mut Session, path: &Path, is_update: bool) -> Result<()> {
    let cfg = parse_author_problem_set_config(path)?;
    if path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        != Some(format!("{}.cfg", cfg.problem_set_id))
    {
        fail("the problem set file name must match the problem set unique ID")?;
    }
    if cfg.problems.is_empty() {
        fail("a problem set must contain at least one problem")?;
    }
    let bundle = ProblemSetBundle {
        problem_set: Some(ProblemSet {
            problem_set_id: cfg.problem_set_id,
            problem_set_note: cfg.note,
            problem_set_tags: cfg.tags,
            continues_problem_set_id: cfg.continues_problem_set_id,
            ..ProblemSet::default()
        }),
        problem_set_problems: cfg
            .problems
            .into_iter()
            .map(|problem| ProblemSetProblem {
                problem_id: problem.problem_id,
                weight: if problem.weight > 0.0 {
                    problem.weight
                } else {
                    1.0
                },
                first_step: problem.first_step,
                last_step: problem.last_step,
                ..ProblemSetProblem::default()
            })
            .collect(),
    };
    let response = session
        .save_problem_set(
            if is_update {
                SaveMode::Update
            } else {
                SaveMode::Create
            },
            bundle,
        )
        .await?;
    let id = response
        .bundle
        .and_then(|bundle| bundle.problem_set)
        .map(|pset| pset.problem_set_id)
        .unwrap_or_default();
    let verb = if is_update { "saved" } else { "created" };
    println!("problem set {id:?} {verb} and ready to use");
    Ok(())
}

pub fn active_problem_type(layout: &AuthorProblemLayout) -> Result<String> {
    if layout.config.single_step_layout {
        Ok(layout.config.steps[0].problem_type.clone())
    } else if layout.active_step_number >= 1 {
        Ok(
            layout.config.steps[(layout.active_step_number - 1) as usize]
                .problem_type
                .clone(),
        )
    } else {
        fail("you must run this from within a step directory")
    }
}

async fn validate_author_solution_bundle(
    session: &mut Session,
    bundle: &mut ProblemBundle,
) -> Result<()> {
    if bundle.hostname.is_empty() {
        fail("server was unable to find a suitable daycare, unable to validate")?;
    }
    for step_number in 1..=bundle.problem_steps.len() {
        println!("validating solution for step {step_number}");
        let prepared = bundle
            .signed_validation_bundles
            .get(step_number - 1)
            .cloned()
            .ok_or_else(|| {
                CliError::Message(format!("missing validation bundle for step {step_number}"))
            })?;
        let validated = handle_daycare_stream(session, prepared, Vec::new(), Path::new(""), false)
            .await?
            .ok_or_else(|| {
                CliError::Message(
                    "the server ended the connection without sending a report card".to_string(),
                )
            })?;
        let validated_runtime = decode_signed_runtime(&validated)?;
        let validated_commit = validated_runtime.commit.unwrap_or_default();
        println!("  finished validating solution");
        if !commit_passed(&validated_commit) {
            let note = validated_commit
                .report_card
                .as_ref()
                .map(|report| report.note.clone())
                .unwrap_or_default();
            println!("  solution for step {step_number} failed: {note}");
            print!("{}", dump_transcript(&validated_commit));
            fail("please fix solution and try again")?;
        }
        if let Some(slot) = bundle.solution_commits.get_mut(step_number - 1) {
            *slot = validated_commit;
        }
        if let Some(slot) = bundle.signed_validation_bundles.get_mut(step_number - 1) {
            *slot = validated;
        }
    }
    println!("problem and solution confirmed successfully");
    Ok(())
}

async fn download_student_assignment(
    session: &mut Session,
    item: crate::proto::codegrinder::AssignmentListItem,
) -> Result<()> {
    let Some(assignment) = item.assignment.clone() else {
        return fail("server returned a student assignment without an assignment key");
    };
    println!(
        "[{}] assignment {}/{}",
        item.user_name, assignment.course_id, assignment.problem_set_id
    );
    let root = tempdir_in("/tmp")?;
    let root_dir = root.path().to_path_buf();
    let change_to =
        download_assignment_to_root(session, assignment, &root_dir, &root_dir.to_string_lossy())
            .await?;
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    println!("exit shell when finished");
    println!("deleting {}", root_dir.display());
    let status = Command::new(shell).current_dir(change_to).status()?;
    if status.success() {
        Ok(())
    } else {
        fail(format!("error waiting for shell to terminate: {status}"))
    }
}

fn validate_student_assignment_items(
    items: &[crate::proto::codegrinder::AssignmentListItem],
) -> Result<()> {
    if items.iter().any(|item| item.assignment.is_none()) {
        return fail("server returned a student assignment without an assignment key");
    }
    Ok(())
}

fn gather_step_tree(
    config: &AuthorProblemConfig,
    step_directory: &Path,
    step_index: i64,
    problem_type_files: &BTreeSet<String>,
) -> Result<(Vec<AuthorFile>, Vec<AuthorFile>)> {
    if !step_directory.is_dir() {
        fail(format!(
            "missing step directory {}",
            step_directory.display()
        ))?;
    }
    let mut gathered = BTreeMap::new();
    for path in recursive_files(step_directory)? {
        let rel = path
            .strip_prefix(step_directory)
            .map_err(|error| CliError::Message(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        if rel.split('/').any(|part| part == ".git") {
            continue;
        }
        if config.single_step_layout && rel == PROBLEM_CONFIG_NAME {
            continue;
        }
        if problem_type_files.contains(&rel) {
            continue;
        }
        gathered.insert(rel, fs::read(path)?);
    }
    let filtered = filter_ignored_paths(&gathered)?;
    let mut files = Vec::new();
    let mut starter_files = Vec::new();
    for (rel, content) in filtered {
        let parts = rel.split('/').collect::<Vec<_>>();
        if parts.first() == Some(&"_solution") {
            fail("the _solution authoring layout is not supported")?;
        }
        if parts.first() == Some(&"_starter") {
            if parts.len() == 1 {
                fail("_starter must be a directory")?;
            }
            let logical_path = parts[1..].join("/");
            report_whitespace_issues(
                &format!("step {step_index} file _starter/{logical_path}"),
                &content,
            );
            starter_files.push(AuthorFile {
                path: logical_path,
                content,
            });
        } else {
            report_whitespace_issues(&format!("step {step_index} file {rel}"), &content);
            files.push(AuthorFile { path: rel, content });
        }
    }
    Ok((files, starter_files))
}

pub fn filter_ignored_paths(tree: &BTreeMap<String, Vec<u8>>) -> Result<BTreeMap<String, Vec<u8>>> {
    let ignore = gitignore_spec(tree)?;
    Ok(tree
        .iter()
        .filter(|(path, _)| {
            !ignore
                .matched_path_or_any_parents(Path::new(path), false)
                .is_ignore()
        })
        .map(|(path, content)| (path.clone(), content.clone()))
        .collect())
}

fn gitignore_spec(tree: &BTreeMap<String, Vec<u8>>) -> Result<Gitignore> {
    let mut builder = GitignoreBuilder::new("");
    for (path, content) in tree {
        if Path::new(path)
            .file_name()
            .is_none_or(|name| name != ".gitignore")
        {
            continue;
        }
        let parent = Path::new(path).parent().unwrap_or(Path::new(""));
        let prefix = if parent.as_os_str().is_empty() {
            String::new()
        } else {
            format!("{}/", parent.to_string_lossy())
        };
        let text = String::from_utf8_lossy(content);
        for raw_line in text.lines() {
            let line = raw_line.trim_end_matches('\r');
            let adjusted = if !prefix.is_empty() && line.starts_with('/') {
                format!("{prefix}{}", &line[1..])
            } else if !prefix.is_empty() && line.starts_with('!') {
                format!("!{prefix}{}", &line[1..])
            } else if !prefix.is_empty() {
                format!("{prefix}{line}")
            } else {
                line.to_string()
            };
            builder
                .add_line(None, &adjusted)
                .map_err(|error| CliError::Message(error.to_string()))?;
        }
    }
    builder
        .build()
        .map_err(|error| CliError::Message(error.to_string()))
}

fn recursive_files(directory: &Path) -> Result<Vec<PathBuf>> {
    fn visit(path: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let child = entry.path();
            if child.is_dir() {
                visit(&child, files)?;
            } else if child.is_file() {
                files.push(child);
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    visit(directory, &mut files)?;
    files.sort();
    Ok(files)
}

fn report_whitespace_issues(label: &str, content: &[u8]) {
    let Ok(text) = std::str::from_utf8(content) else {
        return;
    };
    let mut issues = Vec::new();
    if text.contains('\r') {
        issues.push("non-Unix line endings");
    }
    if !text.is_empty() && !text.ends_with('\n') {
        issues.push("missing final newline");
    }
    if !issues.is_empty() {
        println!("warning: {label} has {}", issues.join(", "));
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

fn format_utc_timestamp(seconds: i64) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    format!(
        "{day:02} {} {:02} {hour:02}:{minute:02} UTC",
        MONTHS[(month - 1) as usize],
        year.rem_euclid(100)
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let days = days_since_epoch + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

async fn connect(trace: ApiTrace) -> Result<Session> {
    let mut config = load_config()?;
    config.trace = trace;
    Session::connect(config, trace).await
}

#[cfg(test)]
mod tests {
    use super::validate_student_assignment_items;
    use crate::proto::codegrinder::{AssignmentKey, AssignmentListItem};

    #[test]
    fn student_assignment_items_require_assignment_keys() {
        let items = vec![AssignmentListItem {
            assignment: Some(AssignmentKey {
                user_id: "u1".to_string(),
                course_id: "c1".to_string(),
                problem_set_id: "ps1".to_string(),
            }),
            ..AssignmentListItem::default()
        }];

        assert!(validate_student_assignment_items(&items).is_ok());
        assert!(validate_student_assignment_items(&[AssignmentListItem::default()]).is_err());
    }
}
