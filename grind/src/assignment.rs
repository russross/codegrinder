use crate::client::Session;
use crate::config::{
    ApiTrace, DotFile, ProblemInfo, assignment_ref_from_key, load_config, load_dotfile,
    save_dotfile,
};
use crate::error::{Result, fail};
use crate::files::{update_files, workspace_file_map};
use crate::presentation::{
    assignment_directory, assignment_label, course_directory, print_assignment_list,
    sorted_assignment_items,
};
use crate::proto::codegrinder::{
    AssignmentDownloadStatus, AssignmentKey, AssignmentListItem, AssignmentListProblem,
    AssignmentProblemProgress, GetAssignmentResponse, WorkspaceFileState,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::Builder;

pub async fn command_list(extra: Vec<String>, trace: ApiTrace) -> Result<()> {
    if !extra.is_empty() {
        fail("usage: grind list")?;
    }
    let mut config = load_config()?;
    config.trace = trace;
    let mut session = Session::connect(config, trace).await?;
    let items = sorted_assignment_items(session.list_assignments(Vec::new(), false).await?.items);
    if items.is_empty() {
        fail(
            "no assignments found\nyou must start each assignment through Canvas before you can access it here",
        )?;
    }
    print_assignment_list(&items, &session.config.workspace_root);
    Ok(())
}

pub async fn command_get(extra: Vec<String>, trace: ApiTrace) -> Result<()> {
    if !extra.is_empty() {
        fail("usage: grind get")?;
    }
    let mut config = load_config()?;
    config.trace = trace;
    let mut session = Session::connect(config, trace).await?;
    let root_dir = session.config.workspace_root.clone();
    let items = sorted_assignment_items(session.list_assignments(Vec::new(), false).await?.items);
    for item in items {
        let Some(assignment) = item.assignment.clone() else {
            continue;
        };
        if assignment.user_id != session.user.user_id {
            continue;
        }
        match item.download_status() {
            AssignmentDownloadStatus::Available => {}
            AssignmentDownloadStatus::PrereqNotReady => {
                let label = format!(
                    "{}/{}",
                    course_directory(&item.course_name),
                    assignment.problem_set_id
                );
                println!(
                    "warning: assignment {label} is waiting for {}; skipping",
                    item.prerequisite_problem_set_id
                );
                continue;
            }
            _ => continue,
        }
        let target_dir =
            assignment_directory(&root_dir, &item.course_name, &assignment.problem_set_id);
        let pretty_full = crate::config::abbreviate_home(&target_dir);
        if target_dir.exists() {
            let info = session.get_assignment(assignment).await?;
            if let Some(warning) = existing_assignment_warning(&item, &target_dir, Some(&info)) {
                println!("{warning}");
            }
            continue;
        }
        download_assignment(
            &mut session,
            item.assignment.unwrap_or_default(),
            &target_dir,
            &pretty_full,
        )
        .await?;
    }
    Ok(())
}

pub async fn download_assignment(
    session: &mut Session,
    assignment: AssignmentKey,
    root_dir: &Path,
    pretty_full: &str,
) -> Result<PathBuf> {
    let info = session.get_assignment(assignment).await?;
    download_assignment_summary(session, &info, root_dir, pretty_full).await
}

pub async fn download_assignment_to_root(
    session: &mut Session,
    assignment: AssignmentKey,
    root_dir: &Path,
    pretty_root: &str,
) -> Result<PathBuf> {
    let info = session.get_assignment(assignment).await?;
    let assignment = info.assignment.clone().unwrap_or_default();
    let target_dir = assignment_directory(root_dir, &info.course_name, &assignment.problem_set_id);
    let pretty_full = crate::config::abbreviate_home(
        &PathBuf::from(pretty_root)
            .join(course_directory(&info.course_name))
            .join(&assignment.problem_set_id),
    );
    if target_dir.exists() {
        fail(format!(
            "directory {pretty_full} already exists\ndelete it first if you want to re-download the assignment"
        ))?;
    }
    download_assignment_summary(session, &info, &target_dir, &pretty_full).await
}

pub async fn download_assignment_summary(
    session: &mut Session,
    info: &GetAssignmentResponse,
    root_dir: &Path,
    pretty_full: &str,
) -> Result<PathBuf> {
    match info.download_status() {
        AssignmentDownloadStatus::Available => {}
        AssignmentDownloadStatus::PrereqNotReady => fail(format!(
            "assignment {pretty_full} prerequisite is not ready"
        ))?,
        _ => fail(format!("assignment {pretty_full} is not open yet"))?,
    }
    let parent = root_dir.parent().ok_or_else(|| {
        crate::error::CliError::Message(format!("invalid assignment path {}", root_dir.display()))
    })?;
    fs::create_dir_all(parent)?;
    let staging = Builder::new()
        .prefix(&format!(
            ".{}.",
            root_dir.file_name().unwrap_or_default().to_string_lossy()
        ))
        .tempdir_in(parent)?;
    let staging_path = staging.path().to_path_buf();
    let change_to = unpack_assignment(session, info, &staging_path, pretty_full).await?;
    if root_dir.exists() {
        fail(format!(
            "directory {pretty_full} already exists\ndelete it first if you want to re-download the assignment"
        ))?;
    }
    fs::rename(&staging_path, root_dir)?;
    let _kept = staging.keep();
    if change_to == staging_path {
        Ok(root_dir.to_path_buf())
    } else {
        Ok(root_dir.join(
            change_to
                .strip_prefix(&staging_path)
                .unwrap_or(Path::new("")),
        ))
    }
}

async fn unpack_assignment(
    session: &mut Session,
    info: &GetAssignmentResponse,
    root_dir: &Path,
    pretty_full: &str,
) -> Result<PathBuf> {
    println!("unpacking problem set in {pretty_full}");
    let total_problems = info.problems.len();
    let mut infos = BTreeMap::new();
    let assignment = info.assignment.clone().unwrap_or_default();
    for problem in &info.problems {
        infos.insert(
            problem.problem_id.clone(),
            ProblemInfo {
                problem_id: problem.problem_id.clone(),
                step: problem.current_step_number,
            },
        );
        let target = if total_problems == 1 {
            root_dir.to_path_buf()
        } else {
            root_dir.join(&problem.problem_id)
        };
        if total_problems > 1 {
            if problem.current_step_number > 1 {
                println!(
                    "unpacking problem {} step {}",
                    problem.problem_id, problem.current_step_number
                );
            } else {
                println!("unpacking problem {}", problem.problem_id);
            }
        } else if problem.current_step_number > 1 {
            println!("unpacking step {}", problem.current_step_number);
        }
        let workspace = session
            .get_workspace(
                assignment.clone(),
                problem.problem_id.clone(),
                problem.current_step_number,
                WorkspaceFileState::Current,
                true,
                false,
            )
            .await?;
        let mut files = workspace_file_map(&workspace.system_owned_files)?;
        files.extend(workspace_file_map(&workspace.student_owned_files)?);
        update_files(&target, &files, None, false)?;
    }
    save_dotfile(&DotFile {
        assignment: assignment_ref_from_key(&assignment),
        problems: infos,
        path: root_dir.join(".grind"),
    })?;
    Ok(root_dir.to_path_buf())
}

pub fn existing_assignment_warning(
    item: &AssignmentListItem,
    target_dir: &Path,
    info: Option<&GetAssignmentResponse>,
) -> Option<String> {
    let assignment = item.assignment.as_ref()?;
    let label = assignment_label(&item.course_name, &assignment.problem_set_id);
    let dotfile_path = target_dir.join(".grind");
    if !dotfile_path.exists() {
        return Some(format!(
            "warning: assignment {label} directory exists but has no .grind metadata; skipping"
        ));
    }
    let dotfile = match load_dotfile(&dotfile_path) {
        Ok(dotfile) => dotfile,
        Err(_) => {
            return Some(format!(
                "warning: assignment {label} has invalid .grind metadata; skipping"
            ));
        }
    };
    if !dotfile_matches_assignment(&dotfile, assignment) {
        return Some(format!(
            "warning: assignment {label} directory belongs to a different assignment; skipping"
        ));
    }
    if let Some(info) = info {
        if !dotfile_matches_assignment_summary(&dotfile, info) {
            return Some(format!(
                "warning: assignment {label} has different problem metadata; skipping"
            ));
        }
    } else if !dotfile_matches_problems(&dotfile, &item.problems) {
        return Some(format!(
            "warning: assignment {label} has different problem metadata; skipping"
        ));
    }
    None
}

fn dotfile_matches_assignment(dotfile: &DotFile, assignment: &AssignmentKey) -> bool {
    dotfile.assignment.user_id == assignment.user_id
        && dotfile.assignment.course_id == assignment.course_id
        && dotfile.assignment.problem_set_id == assignment.problem_set_id
}

fn dotfile_matches_problems(dotfile: &DotFile, problems: &[AssignmentListProblem]) -> bool {
    let actual = dotfile
        .problems
        .values()
        .map(|info| info.problem_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let expected = problems
        .iter()
        .map(|problem| problem.problem_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    actual == expected
}

fn dotfile_matches_assignment_summary(dotfile: &DotFile, info: &GetAssignmentResponse) -> bool {
    let expected = info
        .problems
        .iter()
        .map(|problem: &AssignmentProblemProgress| {
            (
                problem.problem_id.clone(),
                ProblemInfo {
                    problem_id: problem.problem_id.clone(),
                    step: problem.current_step_number,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    dotfile.problems == expected
}
