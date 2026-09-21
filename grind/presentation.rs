use crate::config::{abbreviate_home, home_dir};
use crate::proto::codegrinder::{AssignmentDownloadStatus, AssignmentListItem, ProblemCatalogSet};
use std::path::{Path, PathBuf};

pub fn course_directory(label: &str) -> String {
    let bytes = label.as_bytes();
    let mut letters = String::new();
    let mut index = 0;
    while index < bytes.len() && bytes[index].is_ascii_alphabetic() {
        letters.push(bytes[index] as char);
        index += 1;
    }
    while index < bytes.len() && (bytes[index] == b'-' || bytes[index] == b' ') {
        index += 1;
    }
    let mut digits = String::new();
    while index < bytes.len() && bytes[index].is_ascii_alphanumeric() {
        digits.push(bytes[index] as char);
        index += 1;
    }
    if !letters.is_empty() && !digits.is_empty() {
        format!("{letters}{digits}").to_lowercase()
    } else {
        label.to_string()
    }
}

pub fn sorted_assignment_items(mut items: Vec<AssignmentListItem>) -> Vec<AssignmentListItem> {
    items.sort_by(|left, right| assignment_sort_key(left).cmp(&assignment_sort_key(right)));
    items
}

pub fn sorted_student_assignment_items(
    mut items: Vec<AssignmentListItem>,
) -> Vec<AssignmentListItem> {
    items.sort_by(|left, right| {
        student_assignment_sort_key(left).cmp(&student_assignment_sort_key(right))
    });
    items
}

pub fn print_assignment_list(items: &[AssignmentListItem], workspace_root: &Path) {
    let titles: Vec<String> = items.iter().map(assignment_title).collect();
    let longest_title = titles.iter().map(String::len).max().unwrap_or(0);
    let mut current_course_id = String::new();
    for (item, title) in items.iter().zip(titles.iter()) {
        let assignment = item.assignment.as_ref();
        let course_id = assignment.map_or("", |assignment| assignment.course_id.as_str());
        if course_id != current_course_id {
            if !current_course_id.is_empty() {
                println!();
            }
            current_course_id = course_id.to_owned();
            println!("{}", item.course_name);
            println!("{}", "-".repeat(item.course_name.len()));
        }
        let percent = (item.assignment_score * 100.0).round() as i64;
        let pretty_path = pretty_assignment_path(workspace_root, item);
        let suffix = if item.download_status() == AssignmentDownloadStatus::PrereqNotReady {
            format!(" waiting for {}", item.prerequisite_problem_set_id)
        } else {
            String::new()
        };
        println!("{title:<longest_title$}  {percent:>3}% ({pretty_path}){suffix}");
    }
}

pub fn print_problem_catalog(problem_sets: &[ProblemCatalogSet], host: &str) {
    for (index, pset) in problem_sets.iter().enumerate() {
        if index > 0 {
            println!();
        }
        println!("{}", pset.problem_set_note);
        for problem in &pset.problems {
            if problem.problem_weight == 1 {
                println!("  * {} ({})", problem.problem_note, problem.problem_id);
            } else {
                println!(
                    "  * {} ({}, weight {})",
                    problem.problem_note, problem.problem_id, problem.problem_weight
                );
            }
            for step in &problem.steps {
                let text = step.step_note.replace('\n', "\n       ");
                let suffix = if step.step_weight == 1 {
                    String::new()
                } else {
                    format!(" (weight {})", step.step_weight)
                };
                println!("    {}. {text}{suffix}", step.step_number);
            }
        }
        println!();
        println!("  -> {}/lti/problem_sets/cli/{}", server_base_url(host), pset.problem_set_id);
    }
}

fn server_base_url(host: &str) -> String {
    let host = host.trim_end_matches('/');
    if host.starts_with("http://") || host.starts_with("https://") {
        host.to_string()
    } else {
        format!("https://{host}")
    }
}

pub fn assignment_label(course_name: &str, problem_set_id: &str) -> String {
    format!("{}/{}", course_directory(course_name), problem_set_id)
}

pub fn assignment_directory(root: &Path, course_name: &str, problem_set_id: &str) -> PathBuf {
    root.join(course_directory(course_name)).join(problem_set_id)
}

fn assignment_title(item: &AssignmentListItem) -> String {
    if !item.assignment_title.is_empty() {
        item.assignment_title.clone()
    } else if !item.problem_set_note.is_empty() {
        item.problem_set_note.clone()
    } else {
        item.assignment
            .as_ref()
            .map(|assignment| assignment.problem_set_id.clone())
            .unwrap_or_default()
    }
}

fn pretty_assignment_path(workspace_root: &Path, item: &AssignmentListItem) -> String {
    let assignment = item.assignment.as_ref();
    let root = if workspace_root.as_os_str().is_empty() {
        home_dir()
    } else {
        workspace_root.to_path_buf()
    };
    abbreviate_home(
        &root
            .join(course_directory(&item.course_name))
            .join(assignment.map_or("", |assignment| assignment.problem_set_id.as_str())),
    )
}

fn assignment_sort_key(item: &AssignmentListItem) -> (&str, i64, i64, &str, &str) {
    let assignment = item.assignment.as_ref();
    (
        assignment.map_or("", |assignment| assignment.course_id.as_str()),
        item.due_at.as_ref().map_or(0, |ts| ts.seconds),
        item.lock_at.as_ref().map_or(0, |ts| ts.seconds),
        assignment.map_or("", |assignment| assignment.user_id.as_str()),
        assignment.map_or("", |assignment| assignment.problem_set_id.as_str()),
    )
}

fn student_assignment_sort_key(item: &AssignmentListItem) -> (&str, &str, i64, &str) {
    let assignment = item.assignment.as_ref();
    (
        assignment.map_or("", |assignment| assignment.user_id.as_str()),
        assignment.map_or("", |assignment| assignment.course_id.as_str()),
        item.due_at.as_ref().map_or(0, |ts| ts.seconds),
        assignment.map_or("", |assignment| assignment.problem_set_id.as_str()),
    )
}

#[cfg(test)]
mod tests {
    use super::{course_directory, print_assignment_list};
    use crate::proto::codegrinder::{AssignmentKey, AssignmentListItem};
    use std::path::Path;

    #[test]
    fn course_directory_normalizes_common_course_names() {
        assert_eq!(course_directory("CS-2810 Fall 2026"), "cs2810");
        assert_eq!(course_directory("CS 101"), "cs101");
        assert_eq!(course_directory("CS3520A Section 1"), "cs3520a");
    }

    #[test]
    fn assignment_list_formatting_does_not_panic() {
        let items = vec![AssignmentListItem {
            assignment: Some(AssignmentKey {
                user_id: "u1".to_string(),
                course_id: "c1".to_string(),
                problem_set_id: "sorting".to_string(),
            }),
            course_name: "CS 2810".to_string(),
            assignment_title: "Sorting lab".to_string(),
            assignment_score: 1.0,
            ..AssignmentListItem::default()
        }];
        print_assignment_list(&items, Path::new("/tmp"));
    }
}
