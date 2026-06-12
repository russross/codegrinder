use crate::author::{active_problem_type, resolve_author_problem_layout};
use crate::author_config::PROBLEM_CONFIG_NAME;
use crate::client::Session;
use crate::config::{ApiTrace, load_config};
use crate::error::{CliError, Result, fail};
use crate::files::{clean_relative_path, workspace_file_map};
use crate::proto::codegrinder::{ProblemType, ProblemTypeAction};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
struct ResolvedProblemType {
    problem_type: String,
    directory: PathBuf,
}

pub async fn command_files(
    explicit_problem_type: String,
    set_files: bool,
    trace: ApiTrace,
) -> Result<()> {
    let resolved = resolve_problem_type(&explicit_problem_type)?;
    let mut session = connect(trace).await?;
    if !set_files {
        let response = session.get_problem_type(resolved.problem_type).await?;
        print_file_statuses(
            &resolved.directory,
            &workspace_file_map(&response.problem_type.unwrap_or_default().files)?,
        )?;
        return Ok(());
    }
    let files = collect_file_set(&resolved.directory)?;
    let file_count = files.len();
    session
        .save_problem_type_files(resolved.problem_type.clone(), files)
        .await?;
    println!(
        "set {} files for problem type: {}",
        file_count, resolved.problem_type
    );
    Ok(())
}

pub async fn command_problemtype_list(trace: ApiTrace) -> Result<()> {
    let mut session = connect(trace).await?;
    print_problem_type_list(session.get_problem_types().await?.problem_types);
    Ok(())
}

pub async fn command_problemtype_show(problem_type: String, trace: ApiTrace) -> Result<()> {
    let mut session = connect(trace).await?;
    let response = session.get_problem_type(problem_type).await?;
    print_problem_type(&response.problem_type.unwrap_or_default());
    Ok(())
}

pub async fn command_problemtype_action_set(
    problem_type: String,
    container: String,
    actions: Vec<String>,
    actions_file: String,
    trace: ApiTrace,
) -> Result<()> {
    let mut session = connect(trace).await?;
    let specs = action_specs_from_args(actions, &actions_file)?;
    let parsed = parse_action_specs(&specs)?;
    let action_count = parsed.len();
    session
        .save_problem_type(problem_type.clone(), container, parsed)
        .await?;
    println!(
        "set {} actions for problem type: {problem_type}",
        action_count
    );
    Ok(())
}

fn resolve_problem_type(explicit_problem_type: &str) -> Result<ResolvedProblemType> {
    if !explicit_problem_type.is_empty() {
        return Ok(ResolvedProblemType {
            problem_type: explicit_problem_type.to_string(),
            directory: PathBuf::from("."),
        });
    }
    let layout = resolve_author_problem_layout(Path::new("."))?.ok_or_else(|| {
        CliError::Message(format!(
            "you must supply --type or have a valid {PROBLEM_CONFIG_NAME} file already in place"
        ))
    })?;
    if !layout.config.single_step_layout && layout.active_step_number < 1 {
        fail("you must run this from within a step directory")?;
    }
    Ok(ResolvedProblemType {
        problem_type: active_problem_type(&layout)?,
        directory: layout.active_step_dir,
    })
}

fn collect_file_set(directory: &Path) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut files = BTreeMap::new();
    for local_path in recursive_files(directory)? {
        let rel = local_path
            .strip_prefix(directory)
            .map_err(|error| CliError::Message(error.to_string()))?;
        if rel
            .components()
            .any(|component| component.as_os_str() == ".git")
        {
            continue;
        }
        let path = clean_relative_path(&rel.to_string_lossy().replace('\\', "/"))?.as_posix();
        if files.insert(path.clone(), fs::read(local_path)?).is_some() {
            fail(format!("multiple local files resolve to {path:?}"))?;
        }
    }
    Ok(files)
}

fn print_file_statuses(directory: &Path, server_files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    if server_files.is_empty() {
        println!("no problem type files found");
        return Ok(());
    }
    for (path, expected) in server_files {
        let local_path = directory.join(Path::new(path));
        let status = if !local_path.exists() {
            "missing"
        } else if fs::read(local_path)? == *expected {
            "unchanged"
        } else {
            "changed"
        };
        println!("{status}: {path}");
    }
    Ok(())
}

fn parse_action_specs(specs: &[String]) -> Result<BTreeMap<String, ProblemTypeAction>> {
    let mut actions = BTreeMap::new();
    for spec in specs {
        let parts = spec.split('|').collect::<Vec<_>>();
        if parts.len() != 8 {
            fail(
                "action must use: NAME|COMMAND|PARSER|MAX_CPU|MAX_FD|MAX_FILE_SIZE|MAX_MEMORY|MAX_THREADS",
            )?;
        }
        let action_name = parts[0].trim();
        if action_name.is_empty() {
            fail("action name is required")?;
        }
        if actions.contains_key(action_name) {
            fail(format!("multiple definitions for action {action_name:?}"))?;
        }
        actions.insert(
            action_name.to_string(),
            ProblemTypeAction {
                command: parts[1].to_string(),
                parser: if parts[2] == "none" {
                    String::new()
                } else {
                    parts[2].to_string()
                },
                max_cpu: parse_int(parts[3], &format!("{action_name} max_cpu"))?,
                max_fd: parse_int(parts[4], &format!("{action_name} max_fd"))?,
                max_file_size: parse_int(parts[5], &format!("{action_name} max_file_size"))?,
                max_memory: parse_int(parts[6], &format!("{action_name} max_memory"))?,
                max_threads: parse_int(parts[7], &format!("{action_name} max_threads"))?,
            },
        );
    }
    Ok(actions)
}

fn action_specs_from_args(actions: Vec<String>, actions_file: &str) -> Result<Vec<String>> {
    let mut specs = actions;
    if !actions_file.is_empty() {
        let path = Path::new(actions_file);
        if !path.is_file() {
            fail(format!("actions file {actions_file:?} does not exist"))?;
        }
        for line in fs::read_to_string(path)?.lines() {
            let stripped = line.trim();
            if stripped.is_empty() || stripped.starts_with('#') {
                continue;
            }
            specs.push(stripped.to_string());
        }
    }
    Ok(specs)
}

fn parse_int(value: &str, label: &str) -> Result<i64> {
    value
        .parse::<i64>()
        .map_err(|_| CliError::Message(format!("{label} must be an integer")))
}

fn print_problem_type_list(mut problem_types: Vec<ProblemType>) {
    if problem_types.is_empty() {
        println!("no problem types found");
        return;
    }
    problem_types.sort_by_cached_key(|problem_type| problem_type.problem_type.clone());
    let width = problem_types
        .iter()
        .map(|problem_type| problem_type.problem_type.len())
        .max()
        .unwrap_or(0);
    for problem_type in problem_types {
        let actions = problem_type
            .actions
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        println!(
            "{:<width$}  container: {}  actions: {actions}",
            problem_type.problem_type, problem_type.container
        );
    }
}

fn print_problem_type(problem_type: &ProblemType) {
    println!("problem type: {}", problem_type.problem_type);
    println!("container:    {}", problem_type.container);
    println!("actions:");
    if problem_type.actions.is_empty() {
        println!("  none");
    } else {
        for (index, (action_name, action)) in problem_type.actions.iter().enumerate() {
            if index > 0 {
                println!();
            }
            println!("  {action_name}");
            print_problem_type_action(action);
        }
        println!();
        println!("action set command:");
        println!("  grind problemtype action set \\");
        println!(
            "    --problem-type  {} \\",
            quote(&problem_type.problem_type)
        );
        println!("    --container     {} \\", quote(&problem_type.container));
        let action_specs = problem_type
            .actions
            .iter()
            .map(|(action_name, action)| action_spec(action_name, action))
            .collect::<Vec<_>>();
        for (index, spec) in action_specs.iter().enumerate() {
            let suffix = if index < action_specs.len() - 1 {
                " \\"
            } else {
                ""
            };
            println!("    --action        {}{suffix}", quote(spec));
        }
        println!();
    }
    println!("canonical files:");
    if problem_type.files.is_empty() {
        println!("  none");
    } else {
        for path in problem_type.files.keys() {
            println!("  {path}");
        }
    }
}

fn print_problem_type_action(action: &ProblemTypeAction) {
    let parser = if action.parser.is_empty() {
        "none"
    } else {
        &action.parser
    };
    println!("    command:        {}", action.command);
    println!("    parser:         {parser}");
    println!("    max_cpu:        {}", action.max_cpu);
    println!("    max_fd:         {}", action.max_fd);
    println!("    max_file_size:  {}", action.max_file_size);
    println!("    max_memory:     {}", action.max_memory);
    println!("    max_threads:    {}", action.max_threads);
}

fn action_spec(action_name: &str, action: &ProblemTypeAction) -> String {
    let parser = if action.parser.is_empty() {
        "none"
    } else {
        &action.parser
    };
    format!(
        "{action_name}|{}|{parser}|{}|{}|{}|{}|{}",
        action.command,
        action.max_cpu,
        action.max_fd,
        action.max_file_size,
        action.max_memory,
        action.max_threads
    )
}

fn quote(raw: &str) -> String {
    if raw
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '/' | ':' | '.'))
    {
        raw.to_string()
    } else {
        format!("'{}'", raw.replace('\'', "'\\''"))
    }
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

async fn connect(trace: ApiTrace) -> Result<Session> {
    let mut config = load_config()?;
    config.trace = trace;
    Session::connect(config, trace).await
}

#[cfg(test)]
mod tests {
    use super::{parse_action_specs, quote};

    #[test]
    fn parse_action_specs_rejects_duplicate_actions() {
        assert!(
            parse_action_specs(&[
                "grade|make grade|xunit|10|100|10|256|20".to_string(),
                "grade|make test|xunit|10|100|10|256|20".to_string(),
            ])
            .is_err()
        );
    }

    #[test]
    fn quote_leaves_simple_values_unquoted() {
        assert_eq!(quote("codegrinder/python:3.12"), "codegrinder/python:3.12");
        assert_eq!(quote("make grade"), "'make grade'");
    }
}
