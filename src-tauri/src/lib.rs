#[cfg(target_os = "android")]
mod android;
mod attachments;
mod backup;
mod commands;
mod db;
mod error;
mod logging;
mod practice;
mod sports;
mod sync;
#[cfg(target_os = "macos")]
mod touchid;
mod vault;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

/// An unlocked database together with its key.
pub(crate) struct Session {
    db: db::Database,
    key: vault::DataKey,
}

pub(crate) struct AppState {
    data_dir: PathBuf,
    log_dir: PathBuf,
    session: Mutex<Option<Session>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(mobile)]
    let builder = builder
        .plugin(tauri_plugin_biometric::init())
        .plugin(tauri_plugin_barcode_scanner::init())
        .plugin(tauri_plugin_focus::init());

    builder
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&log_dir)?;
            logging::init(&log_dir);
            tracing::info!(version = %app.package_info().version, data_dir = %data_dir.display(), "starting Kaizen");
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                let store = sync::lan::store_dir(&data_dir);
                std::thread::spawn(move || {
                    sync::lan::serve(store, move || {
                        let state = handle.state::<AppState>();
                        let guard = state.session.lock().ok()?;
                        let key = sync::group_key(guard.as_ref()?.db.conn()).ok()??;
                        Some((sync::bundle::group_id(&key), sync::lan::auth_token(&key)))
                    })
                });
            }
            app.manage(AppState { data_dir, log_dir, session: Mutex::new(None) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::vault_status,
            commands::vault_setup,
            commands::vault_unlock,
            commands::vault_recover,
            commands::vault_unlock_device,
            commands::vault_set_device_unlock,
            commands::vault_lock,
            commands::db_query,
            commands::backup_create,
            commands::backup_list,
            commands::backup_prune,
            commands::backup_restore,
            commands::data_wipe,
            commands::data_export_json,
            commands::logs_tail,
            commands::log_frontend,
            commands::sync_status,
            commands::sync_pair_code,
            commands::sync_join,
            commands::sync_leave,
            commands::sync_folder,
            commands::sync_lan,
            commands::sync_lan_info,
            commands::sync_background_set,
            commands::practice_refresh,
            commands::practice_contests,
            commands::github_refresh,
            commands::sports_search,
            commands::sports_refresh,
            commands::sports_mute,
            commands::sports_schedule,
            commands::attachment_add,
            commands::attachment_read,
            commands::attachment_remove,
            commands::sync_drive,
            commands::sync_drive_connect,
            commands::sync_drive_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
