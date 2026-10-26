use crate::client::Session;
use crate::error::{CliError, Result, fail};
use crate::files::clean_relative_path;
use crate::proto::codegrinder::{
    AssignmentActionResult, AuthorProblemResult, Commit, EventMessage, RunAssignmentActionRequest,
    RunAuthorProblemRequest, author_problem_progress, run_assignment_action_response,
    run_author_problem_response,
};
use crate::transcript::{dump_event, dump_transcript};
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use tokio::time::Instant;

pub fn commit_passed(commit: &Commit) -> bool {
    commit.report_card.as_ref().is_some_and(|report| report.passed) && commit.score == 1.0
}

pub async fn run_assignment_action(
    session: &mut Session,
    request: RunAssignmentActionRequest,
    directory: &Path,
    process_events: bool,
) -> Result<AssignmentActionResult> {
    let deadline = Instant::now() + session.config.trace.daycare_timeout;
    let mut stream = session.run_assignment_action(request).await?;
    while let Some(reply) = tokio::time::timeout_at(deadline, stream.message())
        .await
        .map_err(|_| CliError::Message("execution request timed out".to_owned()))??
    {
        match reply.response {
            Some(run_assignment_action_response::Response::Event(event)) => {
                if process_events {
                    process_event(event, directory)?;
                }
            }
            Some(run_assignment_action_response::Response::Result(result)) => return Ok(result),
            None => return fail("unexpected reply from server"),
        }
    }
    fail("server ended execution without a result")
}

pub async fn run_author_problem(
    session: &mut Session,
    request: RunAuthorProblemRequest,
    directory: &Path,
    process_events: bool,
) -> Result<AuthorProblemResult> {
    // One deadline covers preparation, all validation steps, and persistence.
    let deadline = Instant::now() + session.config.trace.daycare_timeout;
    let mut stream = session.run_author_problem(request).await?;
    let mut active_step = None;
    while let Some(reply) = tokio::time::timeout_at(deadline, stream.message())
        .await
        .map_err(|_| CliError::Message("author validation request timed out".to_owned()))??
    {
        match reply.response {
            Some(run_author_problem_response::Response::Progress(progress)) => {
                if !process_events && active_step != Some(progress.step) {
                    println!("validating solution for step {}", progress.step);
                    active_step = Some(progress.step);
                }
                match progress.response {
                    Some(author_problem_progress::Response::Event(event)) => {
                        if process_events {
                            process_event(event, directory)?;
                        }
                    }
                    Some(author_problem_progress::Response::Validation(commit)) => {
                        if !process_events {
                            if commit_passed(&commit) {
                                println!("  solution for step {} passed", progress.step);
                            } else {
                                let note = commit
                                    .report_card
                                    .as_ref()
                                    .map(|report| report.note.as_str())
                                    .unwrap_or_default();
                                println!("  solution for step {} failed: {note}", progress.step);
                                print!("{}", dump_transcript(&commit));
                                io::stdout().flush()?;
                            }
                        }
                    }
                    None => return fail("unexpected author progress from server"),
                }
            }
            Some(run_author_problem_response::Response::Result(result)) => return Ok(result),
            None => return fail("unexpected reply from server"),
        }
    }
    fail("server ended author validation without a result")
}

// Action artifacts use the same normalized relative paths as workspace files.
// Grade output is replayed from the final commit only when grading fails.
fn process_event(event: EventMessage, directory: &Path) -> Result<()> {
    match event.event.as_str() {
        "exec" | "stdin" | "stdout" | "exit" | "error" | "stderr" => {
            print!("{}", dump_event(&event));
            io::stdout().flush()?;
        }
        "files" if !directory.as_os_str().is_empty() => {
            for (name, contents) in event.files {
                let relative = clean_relative_path(&name)?;
                let path = directory.join(relative.as_path());
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(path, contents)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{commit_passed, process_event};
    use crate::proto::codegrinder::{Commit, EventMessage, ReportCard};
    use std::collections::BTreeMap;

    #[test]
    fn commit_passed_requires_report_card_and_perfect_score() {
        assert!(commit_passed(&Commit {
            report_card: Some(ReportCard { passed: true, ..ReportCard::default() }),
            score: 1.0,
            ..Commit::default()
        }));
        assert!(!commit_passed(&Commit {
            report_card: Some(ReportCard { passed: true, ..ReportCard::default() }),
            score: 0.5,
            ..Commit::default()
        }));
    }

    #[test]
    fn action_artifacts_create_directories_and_reject_parent_paths() {
        let directory = tempfile::tempdir().unwrap();
        let files = |path: &str| EventMessage {
            event: "files".to_owned(),
            files: BTreeMap::from([(path.to_owned(), b"artifact".to_vec())]),
            ..EventMessage::default()
        };
        process_event(files("nested/output.txt"), directory.path()).unwrap();
        assert_eq!(std::fs::read(directory.path().join("nested/output.txt")).unwrap(), b"artifact");
        assert!(process_event(files("../escape.txt"), directory.path()).is_err());
    }
}
