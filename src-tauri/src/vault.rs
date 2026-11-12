use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub path: String,
    pub content: String,
    pub mtime_ms: u64,
}

pub fn lexical_inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Ok(root.to_path_buf());
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("path escapes vault".into());
    }
    let mut out = root.to_path_buf();
    for component in rel_path.components() {
        match component {
            Component::Normal(part) => {
                if part.to_string_lossy().contains('\0') {
                    return Err("path escapes vault".into());
                }
                out.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("path escapes vault".into());
            }
        }
    }
    Ok(out)
}

fn root_canon(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize()
        .map_err(|err| format!("vault root: {err}"))
}

fn ensure_inside(root_canon: &Path, candidate: &Path) -> Result<(), String> {
    let canon = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|err| format!("path: {err}"))?
    } else if let Some(parent) = candidate.parent() {
        if !parent.exists() {
            return Err("parent folder does not exist".into());
        }
        let parent_canon = parent
            .canonicalize()
            .map_err(|err| format!("parent: {err}"))?;
        if !parent_canon.starts_with(root_canon) {
            return Err("path escapes vault".into());
        }
        let name = candidate
            .file_name()
            .ok_or_else(|| "missing file name".to_string())?;
        parent_canon.join(name)
    } else {
        return Err("path escapes vault".into());
    };
    if canon.starts_with(root_canon) {
        Ok(())
    } else {
        Err("path escapes vault".into())
    }
}

pub fn resolve_in(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let root_canon = root_canon(root)?;
    let lexical = lexical_inside(&root_canon, rel)?;
    ensure_inside(&root_canon, &lexical)?;
    if lexical.exists() {
        lexical
            .canonicalize()
            .map_err(|err| format!("path: {err}"))
    } else {
        Ok(lexical)
    }
}

fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis() as u64)
        .unwrap_or(0)
}

fn rel_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn hidden_name(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

pub fn list_tree(root: &Path) -> Result<Vec<FsEntry>, String> {
    let root = root_canon(root)?;
    let mut out = Vec::new();
    walk(&root, &root, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<FsEntry>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|err| format!("read dir: {err}"))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("read dir: {err}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if hidden_name(&name) {
            continue;
        }
        let path = entry.path();
        let meta = fs::symlink_metadata(&path).map_err(|err| format!("metadata: {err}"))?;
        if meta.file_type().is_symlink() {
            continue;
        }
        let is_dir = meta.is_dir();
        out.push(FsEntry {
            path: rel_string(root, &path),
            name,
            is_dir,
            mtime_ms: mtime_ms(&path),
        });
        if is_dir {
            walk(root, &path, out)?;
        }
    }
    Ok(())
}

pub fn read_notes(root: &Path) -> Result<Vec<NoteFile>, String> {
    let entries = list_tree(root)?;
    let mut notes = Vec::new();
    for entry in entries {
        if entry.is_dir {
            continue;
        }
        let lower = entry.path.to_ascii_lowercase();
        if !(lower.ends_with(".md") || lower.ends_with(".markdown")) {
            continue;
        }
        let full = resolve_in(root, &entry.path)?;
        let bytes = fs::read(&full).map_err(|err| format!("read {}: {err}", entry.path))?;
        if bytes.len() > 1_000_000 {
            continue;
        }
        notes.push(NoteFile {
            path: entry.path,
            content: String::from_utf8_lossy(&bytes).into_owned(),
            mtime_ms: entry.mtime_ms,
        });
    }
    Ok(notes)
}

pub fn read_text(root: &Path, rel: &str) -> Result<String, String> {
    let path = resolve_in(root, rel)?;
    if !path.is_file() {
        return Err("not a file".into());
    }
    fs::read_to_string(&path).map_err(|err| format!("read: {err}"))
}

pub fn read_bytes(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let path = resolve_in(root, rel)?;
    if !path.is_file() {
        return Err("not a file".into());
    }
    let bytes = fs::read(&path).map_err(|err| format!("read: {err}"))?;
    if bytes.len() > 20_000_000 {
        return Err("file is too large".into());
    }
    Ok(bytes)
}

pub fn write_text(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let path = resolve_in(root, rel)?;
    if path.exists() && !path.is_file() {
        return Err("not a file".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "missing parent".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "missing file name".to_string())?
        .to_string_lossy();
    let tmp = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));
    fs::write(&tmp, content).map_err(|err| format!("write: {err}"))?;
    fs::rename(&tmp, &path).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        format!("rename: {err}")
    })?;
    Ok(())
}

pub fn create_dir(root: &Path, rel: &str) -> Result<(), String> {
    let root_canon = root_canon(root)?;
    let path = lexical_inside(&root_canon, rel)?;
    if let Some(parent) = path.parent() {
        if parent.exists() {
            ensure_inside(&root_canon, parent)?;
        }
    }
    fs::create_dir_all(&path).map_err(|err| format!("mkdir: {err}"))?;
    ensure_inside(&root_canon, &path)?;
    Ok(())
}

pub fn delete_path(root: &Path, rel: &str) -> Result<(), String> {
    if rel.is_empty() {
        return Err("refusing to delete the vault root".into());
    }
    let path = resolve_in(root, rel)?;
    let root_canon = root_canon(root)?;
    if path == root_canon {
        return Err("refusing to delete the vault root".into());
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|err| format!("delete: {err}"))?;
    } else {
        fs::remove_file(&path).map_err(|err| format!("delete: {err}"))?;
    }
    Ok(())
}

pub fn rename_path(root: &Path, from: &str, to: &str) -> Result<(), String> {
    if from.is_empty() {
        return Err("refusing to rename the vault root".into());
    }
    let src = resolve_in(root, from)?;
    let dst = resolve_in(root, to)?;
    if dst.exists() {
        return Err("destination already exists".into());
    }
    if let Some(parent) = dst.parent() {
        if !parent.exists() {
            return Err("destination folder does not exist".into());
        }
    }
    fs::rename(&src, &dst).map_err(|err| format!("rename: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "local-notes-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn rejects_paths_outside_the_vault() {
        let root = temp_root();
        assert!(lexical_inside(&root, "../secret").is_err());
        assert!(lexical_inside(&root, "a/../../secret").is_err());
        assert!(lexical_inside(&root, "/etc/passwd").is_err());
        assert!(write_text(&root, "../escape.md", "nope").is_err());
        assert!(read_text(&root, "../escape.md").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writes_atomically_inside_the_vault() {
        let root = temp_root();
        write_text(&root, "notes/today.md", "hello").unwrap_err();
        create_dir(&root, "notes").unwrap();
        write_text(&root, "notes/today.md", "hello").unwrap();
        assert_eq!(read_text(&root, "notes/today.md").unwrap(), "hello");
        let listed = list_tree(&root).unwrap();
        assert!(listed.iter().any(|entry| entry.path == "notes/today.md"));
        let notes = read_notes(&root).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].content, "hello");
        let _ = fs::remove_dir_all(&root);
    }
}
