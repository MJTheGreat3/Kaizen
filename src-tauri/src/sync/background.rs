//! Background sync on Android: a WorkManager job (`SyncWorker.kt`) calls
//! into Rust every ~15 minutes, even when Kaizen is closed. It opens the
//! database with the fingerprint-unlock key kept on the device, so it only
//! runs when the user turned it on and fingerprint unlock is set up.

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
    let session = Mutex::new(Some(Session { db, key }));
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
