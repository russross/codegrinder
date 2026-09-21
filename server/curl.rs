use std::io;
use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use http::{HeaderMap, StatusCode};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const CURL_PROGRAM: &str = "curl";

#[derive(Clone, Copy, Debug)]
pub enum CurlHttpVersion {
    Any,
    Http1_1,
}

#[derive(Debug)]
pub struct CurlPostRequest<'a> {
    pub url: &'a str,
    pub headers: &'a HeaderMap,
    pub body: &'a [u8],
    pub timeout: Duration,
    pub http_version: CurlHttpVersion,
}

#[derive(Debug)]
pub struct CurlResponse {
    pub status: StatusCode,
    pub body: Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum CurlError {
    #[error("failed to run curl: {0}")]
    Io(#[from] io::Error),
    #[error("curl failed with {status}: {stderr}")]
    Process { status: ExitStatus, stderr: String },
    #[error("curl request header is not text: {0}")]
    Header(#[from] http::header::ToStrError),
    #[error("invalid curl response: {0}")]
    Response(String),
}

pub async fn require_available() -> Result<(), CurlError> {
    let status = Command::new(CURL_PROGRAM)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await?;
    if status.success() {
        return Ok(());
    }
    Err(CurlError::Process { status, stderr: String::new() })
}

pub async fn post(request: CurlPostRequest<'_>) -> Result<CurlResponse, CurlError> {
    post_with_program(Path::new(CURL_PROGRAM), request).await
}

async fn post_with_program(
    program: &Path,
    request: CurlPostRequest<'_>,
) -> Result<CurlResponse, CurlError> {
    let timeout = request.timeout.as_secs_f64().to_string();
    let mut command = Command::new(program);
    command
        .arg("--silent")
        .arg("--show-error")
        .arg("--request")
        .arg("POST")
        .arg("--proto")
        .arg("=http,https")
        .arg("--connect-timeout")
        .arg(&timeout)
        .arg("--max-time")
        .arg(&timeout)
        .arg("--write-out")
        .arg("\n%{http_code}")
        .arg("--data-binary")
        .arg("@-");
    if matches!(request.http_version, CurlHttpVersion::Http1_1) {
        command.arg("--http1.1");
    }
    for (name, value) in request.headers {
        command.arg("--header").arg(format!("{name}: {}", value.to_str()?));
    }
    let mut child = command
        .arg("--url")
        .arg(request.url)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| CurlError::Response("curl stdin was not piped".to_owned()))?;
    let write_body = async move {
        stdin.write_all(request.body).await?;
        stdin.shutdown().await
    };
    let (write_result, output_result) = tokio::join!(write_body, child.wait_with_output());
    let output = output_result?;
    if !output.status.success() {
        return Err(CurlError::Process {
            status: output.status,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    write_result?;
    parse_response(output.stdout)
}

fn parse_response(mut output: Vec<u8>) -> Result<CurlResponse, CurlError> {
    if output.len() < 4 || output[output.len() - 4] != b'\n' {
        return Err(CurlError::Response("curl output did not end with an HTTP status".to_owned()));
    }
    let status_start = output.len() - 3;
    let status = StatusCode::from_bytes(&output[status_start..])
        .map_err(|err| CurlError::Response(format!("invalid HTTP status: {err}")))?;
    output.truncate(output.len() - 4);
    Ok(CurlResponse { status, body: output })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[cfg(unix)]
    fn write_program(contents: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        let program = directory.path().join("curl");
        fs::write(&program, contents).unwrap();
        let mut permissions = fs::metadata(&program).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&program, permissions).unwrap();
        (directory, program)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn keeps_response_bytes_separate_from_the_appended_status() {
        let (_directory, program) = write_program("#!/bin/sh\ncat\nprintf '\\n207'\n");
        let body = b"response ending like a status\n418";
        let headers = HeaderMap::new();
        let response = post_with_program(
            &program,
            CurlPostRequest {
                url: "https://example.test/",
                headers: &headers,
                body,
                timeout: Duration::from_secs(1),
                http_version: CurlHttpVersion::Any,
            },
        )
        .await
        .unwrap();

        assert_eq!(response.status, StatusCode::MULTI_STATUS);
        assert_eq!(response.body, body);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_transport_stderr_without_mistaking_it_for_http_output() {
        let (_directory, program) =
            write_program("#!/bin/sh\ncat >/dev/null\nprintf 'connection failed\\n' >&2\nexit 7\n");
        let headers = HeaderMap::new();
        let error = post_with_program(
            &program,
            CurlPostRequest {
                url: "https://example.test/",
                headers: &headers,
                body: b"request",
                timeout: Duration::from_secs(1),
                http_version: CurlHttpVersion::Any,
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(
            error,
            CurlError::Process { stderr, .. } if stderr == "connection failed"
        ));
    }
}
