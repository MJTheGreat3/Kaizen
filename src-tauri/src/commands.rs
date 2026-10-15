use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value as JsonValue;
use tauri::{Emitter, Manager, State};

use crate::attachments;
use crate::backup::{self, BackupInfo};
use crate::db::{DB_FILE, Database, QueryMethod};
use crate::error::{Error, Result};
use crate::music;
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
    /// Results and performances to announce (already shown on Android).
    alerts: Vec<sports::alerts::Alert>,
}

/// One sports refresh at a time.
static SPORTS_RUNNING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Fetches games for followed teams and stats for followed players (only
/// those `ids` when given; full player stats at most every six hours unless
/// named, their latest game every time).
#[tauri::command]
pub async fn sports_refresh(
    app: tauri::AppHandle,
    ids: Option<Vec<String>>,
) -> Result<SportsReport> {
    blocking(move || {
        let _running = SPORTS_RUNNING.lock().unwrap_or_else(|e| e.into_inner());
        let state = app.state::<AppState>();
        let now = chrono::Utc::now().timestamp_millis();
        let follows = with_session(&state, |s| {
            sports::alerts::apply_pending_mutes(s.db.conn(), &state.data_dir)?;
            sports::follows(s.db.conn())
        })?;
        let plan = sports::plan(follows, ids.as_deref(), now);
        let http = practice::http::Http::new();
        let results = sports::fetch_all(&http, &plan);
        let mut report = SportsReport {
            updated: 0,
            errors: Vec::new(),
            alerts: Vec::new(),
        };
        for ((follow, _), result) in plan.iter().zip(results) {
            with_session(&state, |s| {
                match &result {
                    Ok(fetched) => {
                        report
                            .alerts
                            .extend(sports::store(s.db.conn(), follow, fetched)?);
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
            alerts = report.alerts.len(),
            "sports refreshed"
        );
        // Android shows them natively, with a Mute button.
        #[cfg(target_os = "android")]
        if !report.alerts.is_empty() {
            crate::android::sports_notifier("postAll", &serde_json::to_string(&report.alerts)?)?;
            report.alerts.clear();
        }
        Ok(report)
    })
    .await
}

/// Mutes or unmutes a game (`game:{sport}:{id}`) or a follow (`follow:{id}`).
#[tauri::command]
pub async fn sports_mute(
    app: tauri::AppHandle,
    id: String,
    title: Option<String>,
    on: bool,
) -> Result<()> {
    blocking(move || {
        let state = app.state::<AppState>();
        with_session(&state, |s| {
            sports::alerts::set_muted(s.db.conn(), &id, title.as_deref(), on)
        })
    })
    .await
}

/// A reminder before a followed team's game, scheduled natively on Android.
#[derive(serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameReminder {
    key: String,
    at: i64,
    title: String,
    body: String,
    mute_id: Option<String>,
    url: Option<String>,
}

/// Replaces the scheduled game reminders (Android; elsewhere they run as
/// timers in the app). Returns whether they were scheduled here.
#[tauri::command]
pub async fn sports_schedule(app: tauri::AppHandle, reminders: Vec<GameReminder>) -> Result<bool> {
    blocking(move || {
        let state = app.state::<AppState>();
        with_session(&state, |s| {
            sports::alerts::apply_pending_mutes(s.db.conn(), &state.data_dir)
        })?;
        #[cfg(target_os = "android")]
        {
            crate::android::sports_notifier("scheduleAll", &serde_json::to_string(&reminders)?)?;
            Ok(true)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = reminders;
            Ok(false)
        }
    })
    .await
}

/// Stores a file (base64) for a row, encrypted; returns its attachment id.
#[tauri::command]
pub async fn attachment_add(
    app: tauri::AppHandle,
    owner_table: String,
    owner_id: String,
    file_name: String,
    mime: Option<String>,
    data: String,
) -> Result<String> {
    use base64::Engine;
    blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|_| Error::Invalid("the file could not be read".into()))?;
        let state = app.state::<AppState>();
        with_session(&state, |s| {
            attachments::add(
                &state.data_dir,
                &s.key,
                s.db.conn(),
                &attachments::NewFile {
                    owner_table: &owner_table,
                    owner_id: &owner_id,
                    file_name: &file_name,
                    mime: mime.as_deref(),
                    bytes: &bytes,
                },
            )
        })
    })
    .await
}

/// A stored file as base64.
#[tauri::command]
pub async fn attachment_read(app: tauri::AppHandle, id: String) -> Result<String> {
    use base64::Engine;
    blocking(move || {
        let state = app.state::<AppState>();
        let bytes = with_session(&state, |s| {
            attachments::read(&state.data_dir, &s.key, s.db.conn(), &id)
        })?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
}

#[tauri::command]
pub async fn attachment_remove(app: tauri::AppHandle, id: String) -> Result<()> {
    blocking(move || {
        let state = app.state::<AppState>();
        with_session(&state, |s| {
            attachments::remove(&state.data_dir, s.db.conn(), &id)
        })
    })
    .await
}

/// Saves an exported file (a board as PNG or SVG) to Downloads, under a
/// name not already taken, and returns its path. On Android that is the
/// shared Download folder, which apps may add their own files to.
#[tauri::command]
pub async fn export_save(app: tauri::AppHandle, name: String, data: String) -> Result<String> {
    use base64::Engine;
    blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|e| Error::Invalid(format!("bad export data: {e}")))?;
        let dir = if cfg!(target_os = "android") {
            PathBuf::from("/storage/emulated/0/Download/Kaizen")
        } else {
            app.path().download_dir()?
        };
        std::fs::create_dir_all(&dir)?;
        let clean: String = name
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || " -_.".contains(c) {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        let path = Path::new(clean.trim());
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("board");
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("png");
        let mut target = dir.join(format!("{stem}.{ext}"));
        let mut n = 2;
        while target.exists() {
            target = dir.join(format!("{stem} ({n}).{ext}"));
            n += 1;
        }
        std::fs::write(&target, bytes)?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
}

// ---------------------------------------------------------------------------
// Music (Spotify)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn music_status(state: State<'_, AppState>) -> Result<music::Status> {
    with_session(&state, |s| music::status(s.db.conn()))
}

/// A working access token. Network calls happen without holding the
/// database, which is only touched to read or rotate the refresh token.
fn music_token(app: &tauri::AppHandle) -> Result<String> {
    if let Some(token) = music::cached_access() {
        return Ok(token);
    }
    let state = app.state::<AppState>();
    let refresh = with_session(&state, |s| music::refresh_token(s.db.conn()))?;
    let (access, rotated) = music::refresh_access(&refresh)?;
    if let Some(r) = rotated {
        with_session(&state, |s| music::save_account(s.db.conn(), &r))?;
    }
    Ok(access)
}

/// Signs in with Spotify in the browser; returns the display name.
#[tauri::command]
pub async fn music_connect(app: tauri::AppHandle) -> Result<String> {
    use tauri_plugin_opener::OpenerExt;
    let sign_in = music::start_sign_in()?;
    app.opener()
        .open_url(sign_in.url.clone(), None::<&str>)
        .map_err(|e| Error::Invalid(format!("could not open the browser: {e}")))?;
    let refresh = blocking(move || music::finish_sign_in(sign_in))
        .await
        .inspect_err(|e| tracing::warn!(error = %e, "Spotify sign-in failed"))?;
    let state = app.state::<AppState>();
    with_session(&state, |s| music::save_account(s.db.conn(), &refresh))?;
    let handle = app.clone();
    let me = blocking(move || {
        let token = music_token(&handle)?;
        music::call(&token, "GET", "/me", None)
    })
    .await?;
    let name = me.1["display_name"].as_str().unwrap_or("").to_string();
    with_session(&state, |s| music::remember_name(s.db.conn(), &name))?;
    Ok(name)
}

#[tauri::command]
pub async fn music_disconnect(state: State<'_, AppState>) -> Result<()> {
    with_session(&state, |s| music::forget_account(s.db.conn()))
}

/// Calls the Spotify Web API (`path` like `/me/player`), refreshing the
/// token once if Spotify rejects it.
#[tauri::command]
pub async fn music_api(
    app: tauri::AppHandle,
    method: String,
    path: String,
    body: Option<JsonValue>,
) -> Result<JsonValue> {
    blocking(move || {
        let mut retried = false;
        loop {
            let token = music_token(&app)?;
            let (status, json) = music::call(&token, &method, &path, body.as_ref())?;
            if status == 401 && !retried {
                music::drop_access();
                retried = true;
                continue;
            }
            if status >= 400 {
                return Err(music::api_error(status, &json));
            }
            return Ok(json);
        }
    })
    .await
}

/// Adds Spotify's recently played to the local history; returns how many
/// plays were new.
#[tauri::command]
pub async fn music_history_sync(app: tauri::AppHandle) -> Result<usize> {
    blocking(move || {
        let state = app.state::<AppState>();
        let after = with_session(&state, |s| music::history_after(s.db.conn()))?;
        let token = music_token(&app)?;
        let path = match after {
            Some(ms) => format!("/me/player/recently-played?limit=50&after={ms}"),
            None => "/me/player/recently-played?limit=50".to_string(),
        };
        let (status, json) = music::call(&token, "GET", &path, None)?;
        if status >= 400 {
            return Err(music::api_error(status, &json));
        }
        let plays = music::parse_recent(&json);
        with_session(&state, |s| {
            let device = s.db.device_id()?;
            music::store_plays(s.db.conn(), &plays, &device)
        })
    })
    .await
}

/// Lyrics for a track, from the cache or LRCLIB.
#[tauri::command]
pub async fn music_lyrics(
    app: tauri::AppHandle,
    track: String,
    artist: String,
    album: String,
    duration_ms: i64,
) -> Result<music::lyrics::Lyrics> {
    use music::lyrics::{self, Query};
    blocking(move || {
        let state = app.state::<AppState>();
        let q = Query {
            track: &track,
            artist: &artist,
            album: &album,
            duration_ms,
        };
        let now = chrono::Utc::now().timestamp_millis();
        if let Some(hit) = with_session(&state, |s| lyrics::cached(s.db.conn(), &q, now))? {
            return Ok(hit);
        }
        let found = lyrics::lookup(&q)?;
        with_session(&state, |s| lyrics::store(s.db.conn(), &q, &found, now))?;
        Ok(found)
    })
    .await
}

/// Starts Spotify so it can play: `background` tries without showing it
/// (hidden on the laptop; a play button press on the phone), `foreground`
/// opens it (phone). Returns false when Spotify is not installed.
#[tauri::command]
pub async fn music_wake(mode: String) -> Result<bool> {
    blocking(move || {
        #[cfg(target_os = "android")]
        {
            Ok(crate::android::call("Native", "wakeSpotify", &mode)? != "no")
        }
        #[cfg(target_os = "macos")]
        {
            let _ = mode;
            let status = std::process::Command::new("open")
                .args(["-g", "-a", "Spotify"])
                .status()?;
            Ok(status.success())
        }
        #[cfg(not(any(target_os = "android", target_os = "macos")))]
        {
            let _ = mode;
            Ok(false)
        }
    })
    .await
}

/// Brings Kaizen back in front (phone), after opening Spotify to wake it.
/// Also returns what was shared into Kaizen, or asked of it by a shortcut,
/// the Quick Settings tile or a widget, since the last call (JSON list).
#[tauri::command]
pub async fn intake_take(return_to_app: bool) -> Result<JsonValue> {
    blocking(move || {
        #[cfg(target_os = "android")]
        {
            if return_to_app {
                crate::android::call("Native", "returnToApp", "")?;
            }
            let text = crate::android::call("Native", "takeIntake", "")?;
            Ok(serde_json::from_str(&text).unwrap_or(JsonValue::Array(vec![])))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = return_to_app;
            Ok(JsonValue::Array(vec![]))
        }
    })
    .await
}

/// Rewrites the phone widget's snapshot after changes in the app and
/// redraws the widgets. Does nothing elsewhere.
#[tauri::command]
pub async fn widget_refresh(app: tauri::AppHandle) -> Result<()> {
    blocking(move || {
        #[cfg(target_os = "android")]
        {
            let state = app.state::<AppState>();
            let live = vault::load_device_key(&state.data_dir)
                .ok()
                .flatten()
                .is_some();
            with_session(&state, |s| {
                let device = s.db.device_id()?;
                crate::widget::act(s.db.conn(), &state.data_dir, &device, "refresh", live)
            })?;
            crate::android::call("Native", "updateWidgets", "")?;
        }
        #[cfg(not(target_os = "android"))]
        let _ = app;
        Ok(())
    })
    .await
}
