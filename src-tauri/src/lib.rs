mod vault;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    ticket: Arc<AtomicU64>,
}

fn current_root(state: &AppState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|err| err.to_string())?
        .clone()
        .ok_or_else(|| "no vault open".to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join("settings.json"))
}

fn relative_event_path(root: &PathBuf, path: &std::path::Path) -> Option<String> {
    let candidate = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let rel = candidate.strip_prefix(root).ok()?;
    let text = rel.to_string_lossy().replace('\\', "/");
    if text.is_empty() {
        return None;
    }
    if text.split('/').any(|part| part.starts_with('.') || part == "node_modules") {
        return None;
    }
    if text.ends_with(".tmp") {
        return None;
    }
    Some(text)
}

fn start_watcher(app: &AppHandle, state: &AppState, root: PathBuf) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|err| err.to_string())?;

    let ticket_no = state.ticket.fetch_add(1, Ordering::Relaxed) + 1;
    let ticket = Arc::clone(&state.ticket);
    let app = app.clone();
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            if ticket.load(Ordering::Relaxed) != ticket_no {
                break;
            }
            let mut batch = Vec::new();
            if let Ok(event) = first {
                push_event(&root, event, &mut batch);
            }
            loop {
                match rx.recv_timeout(Duration::from_millis(150)) {
                    Ok(Ok(event)) => push_event(&root, event, &mut batch),
                    Ok(Err(_)) => {}
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        emit_changes(&app, &ticket, ticket_no, &batch);
                        return;
                    }
                }
            }
            emit_changes(&app, &ticket, ticket_no, &batch);
        }
    });

    *state.watcher.lock().map_err(|err| err.to_string())? = Some(watcher);
    Ok(())
}

fn push_event(root: &PathBuf, event: Event, batch: &mut Vec<String>) {
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    for path in event.paths {
        if let Some(rel) = relative_event_path(root, &path) {
            if !batch.contains(&rel) {
                batch.push(rel);
            }
        }
    }
}

#[derive(Clone, Serialize)]
struct ChangePayload {
    paths: Vec<String>,
}

fn emit_changes(app: &AppHandle, ticket: &AtomicU64, ticket_no: u64, paths: &[String]) {
    if ticket.load(Ordering::Relaxed) != ticket_no || paths.is_empty() {
        return;
    }
    let _ = app.emit(
        "vault-change",
        ChangePayload {
            paths: paths.to_vec(),
        },
    );
}

#[tauri::command]
fn open_vault(app: AppHandle, state: State<AppState>, path: String) -> Result<Vec<vault::FsEntry>, String> {
    let raw = PathBuf::from(&path);
    if !raw.is_dir() {
        return Err("folder does not exist".into());
    }
    let root = raw.canonicalize().map_err(|err| err.to_string())?;
    let entries = vault::list_tree(&root)?;
    *state.root.lock().map_err(|err| err.to_string())? = Some(root.clone());
    start_watcher(&app, &state, root)?;
    Ok(entries)
}

#[tauri::command]
fn vault_entries(state: State<AppState>) -> Result<Vec<vault::FsEntry>, String> {
    vault::list_tree(&current_root(&state)?)
}

#[tauri::command]
fn read_notes(state: State<AppState>) -> Result<Vec<vault::NoteFile>, String> {
    vault::read_notes(&current_root(&state)?)
}

#[tauri::command]
fn read_text(state: State<AppState>, path: String) -> Result<String, String> {
    vault::read_text(&current_root(&state)?, &path)
}

#[tauri::command]
fn read_bytes(state: State<AppState>, path: String) -> Result<String, String> {
    let bytes = vault::read_bytes(&current_root(&state)?, &path)?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn write_text(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    vault::write_text(&current_root(&state)?, &path, &content)
}

#[tauri::command]
fn create_dir(state: State<AppState>, path: String) -> Result<(), String> {
    vault::create_dir(&current_root(&state)?, &path)
}

#[tauri::command]
fn delete_path(state: State<AppState>, path: String) -> Result<(), String> {
    vault::delete_path(&current_root(&state)?, &path)
}

#[tauri::command]
fn rename_path(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    vault::rename_path(&current_root(&state)?, &from, &to)
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let text = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
    match serde_json::from_str(&text) {
        Ok(value) => Ok(value),
        Err(_) => Ok(serde_json::json!({})),
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    let text = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|err| err.to_string())?;
    std::fs::rename(&tmp, path).map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            root: Mutex::new(None),
            watcher: Mutex::new(None),
            ticket: Arc::new(AtomicU64::new(0)),
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            vault_entries,
            read_notes,
            read_text,
            read_bytes,
            write_text,
            create_dir,
            delete_path,
            rename_path,
            load_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
