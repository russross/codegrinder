use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub fn checked_relative_path(raw: &str) -> AppResult<PathBuf> {
    if raw.is_empty() {
        return Err(AppError::BadRequest("empty workspace path".to_owned()));
    }
    if raw.contains('\\') {
        return Err(AppError::BadRequest(format!(
            "bad workspace path {raw:?}: backslashes are not allowed"
        )));
    }
    let path = Path::new(raw);
    if path.is_absolute() {
        return Err(AppError::BadRequest(format!(
            "bad workspace path {raw:?}: absolute paths are not allowed"
        )));
    }
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::CurDir
                | std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err(AppError::BadRequest(format!(
            "bad workspace path {raw:?}: dot path components are not allowed"
        )));
    }
    Ok(path.to_owned())
}

pub fn validate_file_map(files: &BTreeMap<String, Vec<u8>>) -> AppResult<()> {
    for path in files.keys() {
        checked_relative_path(path)?;
    }
    Ok(())
}

pub fn ordered_paths(files: &BTreeMap<String, Vec<u8>>) -> BTreeSet<String> {
    files.keys().cloned().collect()
}

pub fn split_system_and_student(
    regular_files: BTreeMap<String, Vec<u8>>,
    starter_files: BTreeMap<String, Vec<u8>>,
    include_contents: bool,
) -> (BTreeMap<String, Vec<u8>>, BTreeMap<String, Vec<u8>>) {
    let student_paths = ordered_paths(&starter_files);
    let system = regular_files
        .into_iter()
        .filter(|(path, _)| !student_paths.contains(path))
        .map(|(path, content)| {
            (
                path,
                if include_contents {
                    content
                } else {
                    Vec::new()
                },
            )
        })
        .collect();
    let student = starter_files
        .into_iter()
        .map(|(path, content)| {
            (
                path,
                if include_contents {
                    content
                } else {
                    Vec::new()
                },
            )
        })
        .collect();
    (system, student)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_that_escape_workspace() {
        for path in ["", "/tmp/x", "../x", "a/../x", "a\\b", "."] {
            assert!(checked_relative_path(path).is_err(), "{path}");
        }
        assert!(checked_relative_path("src/main.rs").is_ok());
    }
}
