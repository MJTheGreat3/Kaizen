use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value as JsonValue;
use tauri::{Emitter, Manager, State};

use crate::backup::{self, BackupInfo};
use crate::db::{DB_FILE, Database, QueryMethod};
use crate::error::{Error, Result};
use crate::practice;
use crate::sports;
use crate::sync::{
    self, Report, Status, drive,
    mailbox::{FolderMailbox, Mailbox},
};
use crate::vault::{self, DataKey};
use crate::{AppState, Session, logging};

const DEVICE_UNLOCK_MARKER: &str = "device-unlock.enabled";
/// Left by a restore: the restored database must take a new device id.
const RESTORED_MARKER: &str = "restored.pending";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    platform: &'static str,
    data_dir: String,
    log_dir: String,
    default_backup_dir: String,
    /// Touch ID is set up (macOS); quick unlock then asks for it.
    touch_id: bool,
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
    let restored = state.data_dir.join(RESTORED_MARKER);
    if restored.exists() {
        sync::rotate_device_id(db.conn())?;
        std::fs::remove_file(restored)?;
    }
    sync::register_device(db.conn(), std::env::consts::OS, &own_addresses())?;
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
        touch_id: touch_id_available(),
    }
}

fn touch_id_available() -> bool {
    #[cfg(target_os = "macos")]
    return crate::touchid::available();
    #[cfg(not(target_os = "macos"))]
    false
}

/// On macOS, asks for Touch ID (or the login password) before the quick
/// unlock key is used or stored. Elsewhere this is a no-op: Android shows
/// its biometric prompt from the frontend.
async fn confirm_owner(reason: &'static str) -> Result<()> {
    #[cfg(target_os = "macos")]
    if !blocking(move || Ok(crate::touchid::prompt(reason))).await? {
        return Err(Error::Cancelled);
    }
    let _ = reason;
    Ok(())
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
    confirm_owner("unlock your data").await?;
    let key = vault::load_device_key(&state.data_dir)?.ok_or(Error::DeviceUnlockUnavailable)?;
    open_session(&state, key, None)
}

#[tauri::command]
pub async fn vault_set_device_unlock(state: State<'_, AppState>, enabled: bool) -> Result<()> {
    let marker = state.data_dir.join(DEVICE_UNLOCK_MARKER);
    if enabled {
        confirm_owner("turn on quick unlock").await?;
        with_session(&state, |s| vault::save_device_key(&state.data_dir, &s.key))?;
        std::fs::write(marker, b"1")?;
    } else {
        vault::clear_device_key(&state.data_dir)?;
        // Background sync relies on the device key.
        sync::background::set_enabled(&state.data_dir, false)?;
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
    std::fs::write(state.data_dir.join(RESTORED_MARKER), b"1")?;
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

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> Result<Status> {
    let mut status = with_session(&state, |s| sync::status(s.db.conn()))?;
    status.background = sync::background::enabled(&state.data_dir);
    status.background_available =
        cfg!(target_os = "android") && device_unlock_enabled(&state.data_dir);
    Ok(status)
}

/// Turns Android background sync on or off. It needs fingerprint unlock,
/// whose on-device key lets the background job open the database.
#[tauri::command]
pub async fn sync_background_set(state: State<'_, AppState>, enabled: bool) -> Result<()> {
    if enabled && !device_unlock_enabled(&state.data_dir) {
        return Err(Error::Invalid("turn on fingerprint unlock first".into()));
    }
    sync::background::set_enabled(&state.data_dir, enabled)
}

/// Starts a sync group (or reuses this device's) and returns its pairing code.
#[tauri::command]
pub async fn sync_pair_code(state: State<'_, AppState>) -> Result<String> {
    with_session(&state, |s| {
        sync::create_group(s.db.conn(), &own_addresses())
    })
}

#[tauri::command]
pub async fn sync_join(state: State<'_, AppState>, code: String) -> Result<()> {
    with_session(&state, |s| sync::join_group(s.db.conn(), &code))
}

#[tauri::command]
pub async fn sync_leave(state: State<'_, AppState>) -> Result<()> {
    with_session(&state, |s| sync::leave_group(s.db.conn()))
}

/// Tells the frontend to reload its data after other devices' changes landed.
fn announce(app: &tauri::AppHandle, report: &Report) {
    if report.received > 0 {
        let _ = app.emit("sync://changed", report.received);
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::Invalid(e.to_string()))?
}

async fn run_mailbox(
    app: tauri::AppHandle,
    connect: impl FnOnce(&AppState) -> Result<Box<dyn Mailbox>> + Send + 'static,
) -> Result<Report> {
    let handle = app.clone();
    let report = blocking(move || {
        let _running = sync::RUNNING.lock().unwrap_or_else(|e| e.into_inner());
        let state = handle.state::<AppState>();
        let mailbox = connect(&state)?;
        sync::sync_mailbox(&state.session, mailbox.as_ref())
    })
    .await?;
    announce(&app, &report);
    Ok(report)
}

/// Syncs through a shared folder (e.g. kept in step by Syncthing).
#[tauri::command]
pub async fn sync_folder(app: tauri::AppHandle, path: String) -> Result<Report> {
    run_mailbox(app, move |_| {
        Ok(Box::new(FolderMailbox {
            root: PathBuf::from(path),
        }))
    })
    .await
}

#[tauri::command]
pub async fn sync_drive(app: tauri::AppHandle) -> Result<Report> {
    run_mailbox(app, |state| {
        let refresh = with_session(state, |s| drive::refresh_token(s.db.conn()))?
            .ok_or_else(|| Error::Invalid("Google Drive is not connected".into()))?;
        Ok(Box::new(drive::DriveMailbox::connect(&refresh)?))
    })
    .await
}

/// Addresses this device can be reached at for direct sync (laptops only).
fn own_addresses() -> Vec<String> {
    #[cfg(desktop)]
    return sync::lan::local_addresses();
    #[cfg(mobile)]
    Vec::new()
}

/// Direct sync with the laptop. On the laptop this syncs with the folder it
/// serves (and refreshes the addresses it publishes). On the phone it tries
/// `host` if given, then the addresses from pairing and the laptop's
/// published ones. An unreachable laptop is not an error: the report just
/// has no peers.
#[tauri::command]
pub async fn sync_lan(app: tauri::AppHandle, host: Option<String>) -> Result<Report> {
    if cfg!(desktop) {
        let state = app.state::<AppState>();
        with_session(&state, |s| {
            sync::refresh_addresses(s.db.conn(), &own_addresses())
        })?;
        return run_mailbox(app, |state| {
            Ok(Box::new(sync::lan::LocalStore(FolderMailbox {
                root: sync::lan::store_dir(&state.data_dir),
            })))
        })
        .await;
    }
    let state = app.state::<AppState>();
    let (key, mut hosts) = with_session(&state, |s| {
        let key = sync::group_key(s.db.conn())?
            .ok_or_else(|| Error::Invalid("this device is not paired".into()))?;
        Ok((key, sync::lan_candidates(s.db.conn())?))
    })?;
    if let Some(host) = host.filter(|h| !h.trim().is_empty()) {
        hosts.insert(0, host);
    }
    let found = blocking(move || {
        Ok(hosts
            .into_iter()
            .find(|h| sync::lan::HttpMailbox::new(h, &key).reachable()))
    })
    .await?;
    let Some(host) = found else {
        return Ok(Report::default());
    };
    tracing::info!(%host, "laptop reachable for direct sync");
    run_mailbox(app, move |state| {
        let key = with_session(state, |s| sync::group_key(s.db.conn()))?
            .ok_or_else(|| Error::Invalid("this device is not paired".into()))?;
        Ok(Box::new(sync::lan::HttpMailbox::new(&host, &key)))
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanInfo {
    /// Whether this device serves direct sync (desktop only).
    serving: bool,
    port: u16,
    addresses: Vec<String>,
}

#[tauri::command]
pub fn sync_lan_info() -> LanInfo {
    #[cfg(desktop)]
    return LanInfo {
        serving: true,
        port: sync::lan::PORT,
        addresses: sync::lan::local_addresses(),
    };
    #[cfg(mobile)]
    LanInfo {
        serving: false,
        port: sync::lan::PORT,
        addresses: Vec::new(),
    }
}

/// Opens Google sign-in in the browser and waits for it to finish.
/// Returns the account's email.
#[tauri::command]
pub async fn sync_drive_connect(app: tauri::AppHandle) -> Result<String> {
    use tauri_plugin_opener::OpenerExt;
    let sign_in = drive::start_sign_in()?;
    app.opener()
        .open_url(sign_in.url.clone(), None::<&str>)
        .map_err(|e| Error::Invalid(format!("could not open the browser: {e}")))?;
    let (refresh, email) = blocking(move || drive::finish_sign_in(sign_in))
        .await
        .inspect_err(|e| tracing::warn!(error = %e, "Google sign-in failed"))?;
    let state = app.state::<AppState>();
    with_session(&state, |s| {
        drive::save_account(s.db.conn(), &refresh, email.as_deref())
    })?;
    Ok(email.unwrap_or_default())
}

#[tauri::command]
pub async fn sync_drive_disconnect(state: State<'_, AppState>) -> Result<()> {
    with_session(&state, |s| drive::forget_account(s.db.conn()))
}

// ---------------------------------------------------------------------------
// Practice (competitive programming)
// ---------------------------------------------------------------------------

/// One practice refresh at a time.
static PRACTICE_RUNNING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Fetches new solves, ratings and totals for the given platforms (all
/// accounts when empty). Sites are fetched in parallel without holding the
/// database; each result is stored as it is merged.
#[tauri::command]
pub async fn practice_refresh(
    app: tauri::AppHandle,
    platforms: Option<Vec<String>>,
) -> Result<Vec<practice::RefreshReport>> {
    blocking(move || {
        let _running = PRACTICE_RUNNING.lock().unwrap_or_else(|e| e.into_inner());
        let state = app.state::<AppState>();
        let jobs = with_session(&state, |s| {
            let conn = s.db.conn();
            let mut jobs = Vec::new();
            for (platform, handle, cursor) in practice::accounts(conn)? {
                if platforms
                    .as_ref()
                    .is_some_and(|p| !p.iter().any(|x| x == platform.id()))
                {
                    continue;
                }
                jobs.push((
                    platform,
                    handle,
                    cursor,
                    practice::known_codes(conn, platform)?,
                ));
            }
            Ok(jobs)
        })?;
        let http = practice::http::Http::new();
        let results: Vec<_> = std::thread::scope(|scope| {
            let handles: Vec<_> = jobs
                .iter()
                .map(|(platform, handle, cursor, known)| {
                    let http = &http;
                    scope.spawn(move || {
                        (
                            *platform,
                            *cursor,
                            platform.fetch(http, handle, *cursor, known),
                        )
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("practice fetch panicked"))
                .collect()
        });
        let mut reports = Vec::new();
        for (platform, cursor, result) in results {
            let report = with_session(&state, |s| match result {
                Ok(fetched) => {
                    let new_solves = practice::store(s.db.conn(), platform, &fetched, cursor)?;
                    tracing::info!(platform = platform.id(), new_solves, "practice refreshed");
                    Ok(practice::RefreshReport {
                        platform: platform.id(),
                        new_solves,
                        error: None,
                    })
                }
                Err(e) => {
                    let message = practice::describe(platform, &e);
                    tracing::warn!(platform = platform.id(), %message, "practice refresh failed");
                    practice::store_error(s.db.conn(), platform, &message)?;
                    Ok(practice::RefreshReport {
                        platform: platform.id(),
                        new_solves: 0,
                        error: Some(message),
                    })
                }
            })?;
            reports.push(report);
        }
        Ok(reports)
    })
    .await
}

/// Refreshes upcoming contests on every platform; returns how many there are.
#[tauri::command]
pub async fn practice_contests(app: tauri::AppHandle) -> Result<usize> {
    blocking(move || {
        let http = practice::http::Http::new();
        let results: Vec<_> = std::thread::scope(|scope| {
            let handles: Vec<_> = practice::Platform::ALL
                .iter()
                .map(|p| {
                    let http = &http;
                    scope.spawn(move || (*p, p.upcoming(http)))
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("contest fetch panicked"))
                .collect()
        });
        let state = app.state::<AppState>();
        let mut total = 0;
        for (platform, result) in results {
            match result {
                Ok(contests) => {
                    total += contests.len();
                    with_session(&state, |s| {
                        practice::store_contests(s.db.conn(), platform, &contests)
                    })?;
                }
                // Keep the last list for a site that is down.
                Err(e) => {
                    tracing::warn!(platform = platform.id(), error = %e, "contest list failed")
                }
            }
        }
        Ok(total)
    })
    .await
}

/// One GitHub refresh at a time.
static GITHUB_RUNNING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Fetches the GitHub contribution calendar, recent repositories and
/// issues; `None` when no account is connected.
#[tauri::command]
pub async fn github_refresh(
    app: tauri::AppHandle,
) -> Result<Option<practice::github::GitHubReport>> {
    blocking(move || {
        let _running = GITHUB_RUNNING.lock().unwrap_or_else(|e| e.into_inner());
        let state = app.state::<AppState>();
        let Some(account) = with_session(&state, |s| practice::github::account(s.db.conn()))?
        else {
            return Ok(None);
        };
        let http = practice::http::Http::new();
        let result = practice::github::fetch(&http, &account);
        with_session(&state, |s| {
            let conn = s.db.conn();
            Ok(Some(match result {
                Ok(fetched) => {
                    let contributions = practice::github::store(conn, &account.handle, &fetched)?;
                    tracing::info!(contributions, "github refreshed");
                    practice::github::GitHubReport {
                        contributions,
                        error: None,
                    }
                }
                Err(e) => {
                    let message = practice::github::describe(&e);
                    tracing::warn!(%message, "github refresh failed");
                    practice::github::store_error(conn, &message)?;
                    practice::github::GitHubReport {
                        contributions: 0,
                        error: Some(message),
                    }
                }
            }))
        })
    })
    .await
}

/// Teams or players matching a search, ready to follow.
#[tauri::command]
pub async fn sports_search(
    app: tauri::AppHandle,
    sport: String,
    kind: String,
    query: String,
) -> Result<Vec<sports::Candidate>> {
    blocking(move || {
        let (Some(sport), Some(kind)) =
            (sports::Sport::from_id(&sport), sports::Kind::from_id(&kind))
        else {
            return Err(Error::Invalid("unknown sport".into()));
        };
        let query = query.trim().to_string();
        if query.chars().count() < 2 {
            return Ok(Vec::new());
        }
        let http = practice::http::Http::new();
        let found = if sport == sports::Sport::Cricket {
            let state = app.state::<AppState>();
            // Building the index takes a dozen page loads, once a week.
            let mut index = with_session(&state, |s| sports::cricket_index(s.db.conn()))?;
            if index.is_empty() {
                index = sports::cricbuzz::index(&http)?;
                with_session(&state, |s| sports::store_index(s.db.conn(), &index))?;
            }
            sports::cricbuzz::filter(&index, kind, &query)
        } else {
            sports::espn::search(&http, sport, kind, &query)?
        };
        Ok(found)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SportsReport {
    updated: usize,
    errors: Vec<String>,
}

/// One sports refresh at a time.
static SPORTS_RUNNING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Fetches games for followed teams and stats for followed players (only
/// those `ids` when given; player stats at most every six hours unless
/// named).
#[tauri::command]
pub async fn sports_refresh(
    app: tauri::AppHandle,
    ids: Option<Vec<String>>,
) -> Result<SportsReport> {
    blocking(move || {
        let _running = SPORTS_RUNNING.lock().unwrap_or_else(|e| e.into_inner());
        let state = app.state::<AppState>();
        let now = chrono::Utc::now().timestamp_millis();
        let follows: Vec<_> = with_session(&state, |s| sports::follows(s.db.conn()))?
            .into_iter()
            .filter(|f| match &ids {
                Some(ids) => ids.contains(&f.id),
                None => {
                    f.kind == sports::Kind::Team
                        || f.stats_at.is_none_or(|t| now - t > 6 * 3_600_000)
                }
            })
            .collect();
        let http = practice::http::Http::new();
        let results: Vec<_> = std::thread::scope(|scope| {
            let handles: Vec<_> = follows
                .iter()
                .map(|f| {
                    let http = &http;
                    scope.spawn(move || sports::fetch(http, f))
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("sports fetch panicked"))
                .collect()
        });
        let mut report = SportsReport {
            updated: 0,
            errors: Vec::new(),
        };
        for (follow, result) in follows.iter().zip(results) {
            with_session(&state, |s| {
                match &result {
                    Ok(fetched) => {
                        sports::store(s.db.conn(), follow, fetched)?;
                        report.updated += 1;
                    }
                    Err(e) => {
                        let message = sports::describe(follow.sport, e);
                        tracing::warn!(follow = follow.id, %message, "sports refresh failed");
                        sports::store_error(s.db.conn(), follow, &message)?;
                        report.errors.push(message);
                    }
                }
                Ok(())
            })?;
        }
        tracing::info!(
            updated = report.updated,
            failed = report.errors.len(),
            "sports refreshed"
        );
        Ok(report)
    })
    .await
}
