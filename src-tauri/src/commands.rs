use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value as JsonValue;
use tauri::State;

use crate::backup::{self, BackupInfo};
use crate::db::{DB_FILE, Database, QueryMethod};
use crate::error::{Error, Result};
use crate::vault::{self, DataKey};
use crate::{AppState, Session, logging};

const DEVICE_UNLOCK_MARKER: &str = "device-unlock.enabled";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    platform: &'static str,
    data_dir: String,
    log_dir: String,
    default_backup_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    initialized: bool,
    unlocked: bool,
    device_unlock: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unlocked {
    device_id: String,
    recovery_key: Option<String>,
}

fn device_unlock_enabled(data_dir: &Path) -> bool {
    data_dir.join(DEVICE_UNLOCK_MARKER).exists()
}

fn open_session(state: &AppState, key: DataKey, recovery_key: Option<String>) -> Result<Unlocked> {
    let db = Database::open(
        &state.data_dir.join(DB_FILE),
        &key,
        Some(&backup::default_dir(&state.data_dir)),
    )?;
    let device_id = db.device_id()?;
    *state.session.lock().unwrap() = Some(Session { db, key });
    tracing::info!("unlocked");
    Ok(Unlocked {
        device_id,
        recovery_key,
    })
}

fn with_session<T>(state: &AppState, f: impl FnOnce(&Session) -> Result<T>) -> Result<T> {
    let guard = state.session.lock().unwrap();
    let session = guard.as_ref().ok_or(Error::Locked)?;
    f(session)
}

fn backup_root(state: &AppState, dir: Option<String>) -> PathBuf {
    dir.filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| backup::default_dir(&state.data_dir))
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        log_dir: state.log_dir.to_string_lossy().into_owned(),
        default_backup_dir: backup::default_dir(&state.data_dir)
            .to_string_lossy()
            .into_owned(),
    }
}

#[tauri::command]
pub fn vault_status(state: State<'_, AppState>) -> VaultStatus {
    VaultStatus {
        initialized: vault::exists(&state.data_dir),
        unlocked: state.session.lock().unwrap().is_some(),
        device_unlock: device_unlock_enabled(&state.data_dir),
    }
}

#[tauri::command]
pub async fn vault_setup(state: State<'_, AppState>, passphrase: String) -> Result<Unlocked> {
    let (key, recovery_key) = vault::create(&state.data_dir, &passphrase)?;
    open_session(&state, key, Some(recovery_key))
}

#[tauri::command]
pub async fn vault_unlock(state: State<'_, AppState>, passphrase: String) -> Result<Unlocked> {
    let key = vault::unlock_with_passphrase(&state.data_dir, &passphrase)?;
    open_session(&state, key, None)
}

#[tauri::command]
pub async fn vault_recover(
    state: State<'_, AppState>,
    recovery_key: String,
    new_passphrase: String,
) -> Result<Unlocked> {
    let key = vault::reset_passphrase(&state.data_dir, &recovery_key, &new_passphrase)?;
    open_session(&state, key, None)
}

/// Quick unlock with the key kept on this device. On Android the frontend
/// calls this only after a successful biometric prompt.
#[tauri::command]
pub async fn vault_unlock_device(state: State<'_, AppState>) -> Result<Unlocked> {
    if !device_unlock_enabled(&state.data_dir) {
        return Err(Error::DeviceUnlockUnavailable);
    }
    let key = vault::load_device_key(&state.data_dir)?.ok_or(Error::DeviceUnlockUnavailable)?;
    open_session(&state, key, None)
}

#[tauri::command]
pub async fn vault_set_device_unlock(state: State<'_, AppState>, enabled: bool) -> Result<()> {
    let marker = state.data_dir.join(DEVICE_UNLOCK_MARKER);
    if enabled {
        with_session(&state, |s| vault::save_device_key(&state.data_dir, &s.key))?;
        std::fs::write(marker, b"1")?;
    } else {
        vault::clear_device_key(&state.data_dir)?;
        if marker.exists() {
            std::fs::remove_file(marker)?;
        }
    }
    tracing::info!(enabled, "device unlock changed");
    Ok(())
}

#[tauri::command]
pub fn vault_lock(state: State<'_, AppState>) {
    state.session.lock().unwrap().take();
    tracing::info!("locked");
}

#[tauri::command]
pub async fn db_query(
    state: State<'_, AppState>,
    sql: String,
    params: Vec<JsonValue>,
    method: QueryMethod,
) -> Result<Vec<Vec<JsonValue>>> {
    with_session(&state, |s| s.db.query(&sql, &params, method)).inspect_err(|e| {
        tracing::warn!(error = %e, sql = %sql, "query failed");
    })
}

#[tauri::command]
pub async fn backup_create(state: State<'_, AppState>, dir: Option<String>) -> Result<BackupInfo> {
    let root = backup_root(&state, dir);
    with_session(&state, |s| {
        backup::create(&s.db, &s.key, &state.data_dir, &root)
    })
}

#[tauri::command]
pub async fn backup_list(
    state: State<'_, AppState>,
    dir: Option<String>,
) -> Result<Vec<BackupInfo>> {
    backup::list(&backup_root(&state, dir))
}

#[tauri::command]
pub async fn backup_prune(
    state: State<'_, AppState>,
    dir: Option<String>,
    keep: usize,
) -> Result<usize> {
    backup::prune(&backup_root(&state, dir), keep)
}

/// Replaces local data with a backup and locks; unlock with that backup's passphrase.
#[tauri::command]
pub async fn backup_restore(state: State<'_, AppState>, path: String) -> Result<()> {
    let mut session = state.session.lock().unwrap();
    session.take();
    backup::restore(&state.data_dir, Path::new(&path))?;
    let marker = state.data_dir.join(DEVICE_UNLOCK_MARKER);
    if marker.exists() {
        std::fs::remove_file(marker)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn data_wipe(state: State<'_, AppState>) -> Result<()> {
    let mut session = state.session.lock().unwrap();
    session.take();
    backup::wipe(&state.data_dir)?;
    let marker = state.data_dir.join(DEVICE_UNLOCK_MARKER);
    if marker.exists() {
        std::fs::remove_file(marker)?;
    }
    Ok(())
}

/// Writes every table as plain JSON and returns the file path.
#[tauri::command]
pub async fn data_export_json(state: State<'_, AppState>, dir: Option<String>) -> Result<String> {
    let root = dir
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.data_dir.join("exports"));
    std::fs::create_dir_all(&root)?;
    let path = root.join(format!(
        "kaizen-export-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    let dump = with_session(&state, |s| s.db.export_json())?;
    std::fs::write(&path, serde_json::to_vec_pretty(&dump)?)?;
    tracing::info!(path = %path.display(), "exported JSON");
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn logs_tail(state: State<'_, AppState>, lines: usize) -> Result<String> {
    logging::tail(&state.log_dir, lines)
}

#[tauri::command]
pub fn log_frontend(level: String, message: String) {
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", "{message}"),
        "warn" => tracing::warn!(target: "frontend", "{message}"),
        "debug" => tracing::debug!(target: "frontend", "{message}"),
        _ => tracing::info!(target: "frontend", "{message}"),
    }
}
