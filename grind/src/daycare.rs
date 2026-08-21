use crate::client::{Session, decode_runtime};
use crate::error::{Result, fail};
use crate::files::clean_relative_path;
use crate::proto::codegrinder::{Commit, DaycareRequest, SignedRuntimeBundle};
use crate::transcript::dump_event;
use prost::Message;
use std::fs;
use std::path::Path;
use tonic::Streaming;

pub fn parse_signed_runtime_bundle(
    bundle: &SignedRuntimeBundle,
    missing_host_message: &str,
) -> Result<crate::proto::codegrinder::RuntimeBundle> {
    let runtime = decode_runtime(bundle)?;
    if runtime.hostname.is_empty() {
        fail(missing_host_message)
    } else {
        Ok(runtime)
    }
}

pub fn commit_passed(commit: &Commit) -> bool {
    commit
        .report_card
        .as_ref()
        .is_some_and(|report| report.passed)
        && commit.score == 1.0
}

pub async fn handle_daycare_stream(
    session: &mut Session,
    bundle: SignedRuntimeBundle,
    args: Vec<String>,
    directory: &Path,
    process_events: bool,
) -> Result<Option<SignedRuntimeBundle>> {
    let request = DaycareRequest {
        bundle: Some(bundle),
        args,
    };
    let stream = session.daycare(request).await?;
    consume_stream(stream, directory, process_events).await
}

async fn consume_stream(
    mut stream: Streaming<crate::proto::codegrinder::DaycareResponse>,
    directory: &Path,
    process_events: bool,
) -> Result<Option<SignedRuntimeBundle>> {
    while let Some(reply) = stream.message().await? {
        let Some(response) = reply.response else {
            return fail("unexpected reply from server");
        };
        match response {
            crate::proto::codegrinder::daycare_response::Response::Error(error) => {
                fail(format!("server returned an error: {error}"))?;
            }
            crate::proto::codegrinder::daycare_response::Response::Bundle(bundle) => {
                return Ok(Some(bundle));
            }
            crate::proto::codegrinder::daycare_response::Response::Event(event)
                if matches!(
                    event.event.as_str(),
                    "exec" | "stdin" | "stdout" | "exit" | "error" | "stderr"
                ) =>
            {
                if process_events {
                    print!("{}", dump_event(&event));
                }
            }
            crate::proto::codegrinder::daycare_response::Response::Event(event)
                if event.event == "files"
                    && process_events
                    && !directory.as_os_str().is_empty() =>
            {
                for (name, contents) in event.files {
                    let relative = clean_relative_path(&name)?;
                    let path = directory.join(relative.as_path());
                    if let Some(parent) = path.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::write(path, contents)?;
                }
            }
            crate::proto::codegrinder::daycare_response::Response::Event(_) => {}
        }
    }
    eprintln!("session closed by server");
    Ok(None)
}

pub fn decode_signed_runtime(
    bundle: &SignedRuntimeBundle,
) -> Result<crate::proto::codegrinder::RuntimeBundle> {
    crate::proto::codegrinder::RuntimeBundle::decode(bundle.bundle.as_slice()).map_err(|error| {
        crate::error::CliError::Message(format!("failed to decode runtime bundle: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::{commit_passed, parse_signed_runtime_bundle};
    use crate::proto::codegrinder::{Commit, ReportCard, RuntimeBundle, SignedRuntimeBundle};
    use prost::Message;

    fn signed_bundle(hostname: &str) -> SignedRuntimeBundle {
        let runtime = RuntimeBundle {
            hostname: hostname.to_string(),
            problem_id: "p1".to_string(),
            step_number: 1,
            ..RuntimeBundle::default()
        };
        SignedRuntimeBundle {
            bundle: runtime.encode_to_vec(),
            signature: "signed".to_string(),
        }
    }

    #[test]
    fn parse_signed_runtime_bundle_rejects_missing_daycare_host() {
        assert!(parse_signed_runtime_bundle(&signed_bundle(""), "missing host").is_err());
    }

    #[test]
    fn commit_passed_requires_report_card_and_perfect_score() {
        assert!(commit_passed(&Commit {
            report_card: Some(ReportCard {
                passed: true,
                ..ReportCard::default()
            }),
            score: 1.0,
            ..Commit::default()
        }));
        assert!(!commit_passed(&Commit {
            report_card: Some(ReportCard {
                passed: true,
                ..ReportCard::default()
            }),
            score: 0.5,
            ..Commit::default()
        }));
    }
}
