use crate::error::{Result, fail};
use crate::proto::codegrinder::GetWorkspaceResponse;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct WorkspacePath {
    path: PathBuf,
}

impl WorkspacePath {
    pub fn as_path(&self) -> &Path {
        &self.path
    }

    pub fn as_posix(&self) -> String {
        self.path
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/")
    }
}

pub fn clean_relative_path(raw: &str) -> Result<WorkspacePath> {
    if raw.trim().is_empty() || raw.contains('\\') || raw.starts_with('/') {
        fail(format!("invalid path from server: {raw:?}"))?;
    }
    let path = PathBuf::from(raw);
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_owned()),
            _ => fail(format!("invalid path from server: {raw:?}"))?,
        }
    }
    if parts.is_empty() {
        fail(format!("invalid path from server: {raw:?}"))?;
    }
    Ok(WorkspacePath { path: parts.into_iter().collect() })
}

pub fn workspace_file_map(
    entries: &BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, Vec<u8>>> {
    entries
        .iter()
        .map(|(path, content)| Ok((clean_relative_path(path)?.as_posix(), content.clone())))
        .collect()
}

pub fn workspace_official_paths(workspace: &GetWorkspaceResponse) -> Result<BTreeSet<String>> {
    workspace
        .system_owned_files
        .keys()
        .chain(workspace.student_owned_files.keys())
        .map(|path| Ok(clean_relative_path(path)?.as_posix()))
        .collect()
}

pub fn update_files(
    directory: &Path,
    files: &BTreeMap<String, Vec<u8>>,
    old_files: Option<&BTreeSet<String>>,
    chatty: bool,
) -> Result<()> {
    for (name, contents) in files {
        let relative_path = clean_relative_path(name)?;
        let path = directory.join(relative_path.as_path());
        if !path.exists() {
            if chatty {
                println!("saving file:   {name}");
            }
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, contents)?;
            continue;
        }
        if fs::read(&path)? != *contents {
            if chatty {
                println!("updating file: {name}");
            }
            fs::write(path, contents)?;
        }
    }

    if let Some(old_files) = old_files {
        for name in old_files {
            if files.contains_key(name) {
                continue;
            }
            let relative_path = clean_relative_path(name)?;
            let path = directory.join(relative_path.as_path());
            if path.exists() {
                if chatty {
                    println!("removing file: {name}");
                }
                fs::remove_file(&path)?;
            }
            if let Some(parent) = path.parent()
                && parent != directory
            {
                let _ignored = fs::remove_dir(parent);
            }
        }
    }
    Ok(())
}

pub fn clean_workspace_tree(directory: &Path, official_paths: &BTreeSet<String>) -> Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    let official: BTreeSet<PathBuf> = official_paths.iter().map(PathBuf::from).collect();
    let mut paths = Vec::new();
    for entry in walkdir(directory)? {
        paths.push(entry);
    }
    paths.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for path in paths {
        let rel = path.strip_prefix(directory).map_err(|error| {
            crate::error::CliError::Io(format!("unable to inspect {}: {error}", path.display()))
        })?;
        if rel.components().any(|component| component.as_os_str() == ".git")
            || rel.as_os_str() == ".grind"
        {
            continue;
        }
        if path.is_dir() {
            let _ignored = fs::remove_dir(&path);
            continue;
        }
        if official.contains(rel) {
            continue;
        }
        println!("removing file: {}", rel.display());
        fs::remove_file(&path)?;
    }
    Ok(())
}

fn walkdir(directory: &Path) -> Result<Vec<PathBuf>> {
    fn visit(path: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let child = entry.path();
            out.push(child.clone());
            if child.is_dir() {
                visit(&child, out)?;
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    visit(directory, &mut out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{clean_relative_path, clean_workspace_tree, update_files, workspace_file_map};
    use std::collections::{BTreeMap, BTreeSet};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn clean_relative_path_rejects_non_workspace_paths() {
        for raw in ["", "/tmp/file.py", "../file.py", "src/../file.py", "src\\file.py", "."] {
            assert!(clean_relative_path(raw).is_err());
        }
    }

    #[test]
    fn workspace_file_map_normalizes_and_preserves_empty_content() {
        let files = workspace_file_map(&BTreeMap::from([
            ("src/main.py".to_string(), b"print('x')\n".to_vec()),
            ("empty.txt".to_string(), Vec::new()),
        ]))
        .expect("map");

        assert_eq!(files["src/main.py"], b"print('x')\n");
        assert_eq!(files["empty.txt"], b"");
    }

    #[test]
    fn update_files_rewrites_changed_content_and_prunes_removed_paths() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src")).expect("mkdir");
        fs::write(dir.path().join("src/old.py"), "old\n").expect("write");
        fs::write(dir.path().join("src/main.py"), "before\n").expect("write");

        update_files(
            dir.path(),
            &BTreeMap::from([
                ("src/main.py".to_string(), b"after\n".to_vec()),
                ("new.txt".to_string(), b"new\n".to_vec()),
            ]),
            Some(&BTreeSet::from(["src/main.py".to_string(), "src/old.py".to_string()])),
            false,
        )
        .expect("update");

        assert_eq!(fs::read_to_string(dir.path().join("src/main.py")).expect("read"), "after\n");
        assert!(dir.path().join("new.txt").exists());
        assert!(!dir.path().join("src/old.py").exists());
    }

    #[test]
    fn clean_workspace_tree_preserves_metadata_and_git_directory() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join(".git")).expect("mkdir");
        fs::write(dir.path().join(".git/config"), "[core]\n").expect("write");
        fs::write(dir.path().join(".grind"), "assignment = {}\n").expect("write");
        fs::write(dir.path().join("scratch.txt"), "scratch").expect("write");

        clean_workspace_tree(dir.path(), &BTreeSet::new()).expect("clean");

        assert!(dir.path().join(".git/config").exists());
        assert!(dir.path().join(".grind").exists());
        assert!(!dir.path().join("scratch.txt").exists());
    }
}
