//! Background sync on Android: a WorkManager job (`SyncWorker.kt`) calls
//! into Rust every ~15 minutes, even when Kaizen is closed. It opens the
//! database with the key kept on the device, so it only
//! runs when the user turned it on and that key is there.

use std::path::Path;
use std::sync::Mutex;

use super::{Report, drive, lan, mailbox::Mailbox, sync_mailbox};
use crate::Session;
use crate::db::{DB_FILE, Database};
use crate::error::{Error, Result};
use crate::{backup, vault};

const MARKER: &str = "background-sync.enabled";

pub fn enabled(data_dir: &Path) -> bool {
    data_dir.join(MARKER).exists()
}

pub fn set_enabled(data_dir: &Path, on: bool) -> Result<()> {
    let marker = data_dir.join(MARKER);
    if on {
        std::fs::write(marker, b"1")?;
    } else if marker.exists() {
        std::fs::remove_file(marker)?;
    }
    tracing::info!(on, "background sync changed");
    Ok(())
}

/// One background round: Drive if connected, then the laptop if reachable.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn run(data_dir: &Path) -> Result<Report> {
    if !enabled(data_dir) || !vault::exists(data_dir) {
        return Ok(Report::default());
    }
    let key = vault::load_device_key(data_dir)?.ok_or(Error::DeviceUnlockUnavailable)?;
    let db = Database::open(
        &data_dir.join(DB_FILE),
        &key,
        Some(&backup::default_dir(data_dir)),
    )?;
    let (paired, refresh, hosts) = {
        let conn = db.conn();
        (
            super::group_key(conn)?,
            drive::refresh_token(conn)?,
            super::lan_candidates(conn)?,
        )
    };
    let Some(group_key) = paired else {
        return Ok(Report::default());
    };
    let session = Mutex::new(Some(Session {
        db,
        key,
        private_until: std::sync::atomic::AtomicI64::new(0),
    }));
    let _running = super::RUNNING.lock().unwrap_or_else(|e| e.into_inner());

    let mut mailboxes: Vec<Box<dyn Mailbox>> = Vec::new();
    if let Some(refresh) = refresh {
        mailboxes.push(Box::new(drive::DriveMailbox::connect(&refresh)?));
    }
    if let Some(host) = hosts
        .into_iter()
        .find(|h| lan::HttpMailbox::new(h, &group_key).reachable())
    {
        mailboxes.push(Box::new(lan::HttpMailbox::new(&host, &group_key)));
    }
    let mut total = Report::default();
    for mailbox in mailboxes {
        let r = sync_mailbox(&session, mailbox.as_ref())?;
        total.sent += r.sent;
        total.received += r.received;
        total.peers = total.peers.max(r.peers);
        total.waiting |= r.waiting;
    }
    Ok(total)
}

/// Follows worth checking with the app closed: teams with a game under way
/// (or due to have started), and players (ESPN ones only for their latest
/// game; Cricbuzz pages at most hourly).
fn background_plan(
    conn: &rusqlite::Connection,
    now: i64,
) -> Result<Vec<(crate::sports::Follow, bool)>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT follow_id FROM sport_games
         WHERE state = 'in' OR (state = 'pre' AND start_at BETWEEN ?1 AND ?2)",
    )?;
    let busy: Vec<String> = stmt
        .query_map([now - 8 * 3_600_000, now], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(crate::sports::follows(conn)?
        .into_iter()
        .filter_map(|f| match (f.kind, f.sport) {
            (crate::sports::Kind::Team, _) => busy.contains(&f.id).then_some((f, true)),
            (_, crate::sports::Sport::Cricket) => f
                .stats_at
                .is_none_or(|t| now - t > 3_600_000)
                .then_some((f, true)),
            _ => Some((f, false)),
        })
        .collect())
}

/// One background sports round: results and performances to announce.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn sports_round(data_dir: &Path) -> Result<Vec<crate::sports::alerts::Alert>> {
    if !enabled(data_dir) || !vault::exists(data_dir) {
        return Ok(Vec::new());
    }
    let key = vault::load_device_key(data_dir)?.ok_or(Error::DeviceUnlockUnavailable)?;
    let db = Database::open(
        &data_dir.join(DB_FILE),
        &key,
        Some(&backup::default_dir(data_dir)),
    )?;
    let conn = db.conn();
    crate::sports::alerts::apply_pending_mutes(conn, data_dir)?;
    let plan = background_plan(conn, chrono::Utc::now().timestamp_millis())?;
    if plan.is_empty() {
        return Ok(Vec::new());
    }
    let http = crate::practice::http::Http::new();
    let mut alerts = Vec::new();
    for ((follow, _), result) in plan.iter().zip(crate::sports::fetch_all(&http, &plan)) {
        match result {
            Ok(fetched) => alerts.extend(crate::sports::store(conn, follow, &fetched)?),
            Err(e) => {
                tracing::warn!(follow = follow.id, error = %e, "background sports check failed")
            }
        }
    }
    tracing::info!(
        checked = plan.len(),
        alerts = alerts.len(),
        "background sports round"
    );
    Ok(alerts)
}

/// Entry point for `SyncWorker.nativeSports(dataDir)`: the alerts to show,
/// as JSON (an empty list when there are none or the round failed).
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_matt_kaizen_SyncWorker_nativeSports<'local>(
    mut env: jni::JNIEnv<'local>,
    _class: jni::objects::JClass<'local>,
    data_dir: jni::objects::JString<'local>,
) -> jni::sys::jstring {
    let json = env
        .get_string(&data_dir)
        .map(String::from)
        .ok()
        .and_then(|dir| {
            let dir = std::path::PathBuf::from(dir);
            match std::panic::catch_unwind(|| sports_round(&dir)) {
                Ok(Ok(alerts)) => serde_json::to_string(&alerts).ok(),
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, "background sports round failed");
                    None
                }
                Err(_) => None,
            }
        })
        .unwrap_or_else(|| "[]".into());
    env.new_string(json)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// Entry point for `SyncWorker.nativeSync(dataDir)`. Returns 0 on success.
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_matt_kaizen_SyncWorker_nativeSync<'local>(
    mut env: jni::JNIEnv<'local>,
    _class: jni::objects::JClass<'local>,
    data_dir: jni::objects::JString<'local>,
) -> jni::sys::jint {
    let Ok(dir) = env.get_string(&data_dir).map(String::from) else {
        return 2;
    };
    let dir = std::path::PathBuf::from(dir);
    crate::logging::init(&dir.join("logs"));
    match std::panic::catch_unwind(|| run(&dir)) {
        Ok(Ok(report)) => {
            tracing::info!(
                sent = report.sent,
                received = report.received,
                "background sync done"
            );
            0
        }
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "background sync failed");
            1
        }
        Err(_) => 3,
    }
}
