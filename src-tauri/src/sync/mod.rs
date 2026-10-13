//! Sync between paired devices (Phase 2). See `engine` for how changes
//! merge, `bundle` for encryption and `mailbox` for transports.

pub mod bundle;
pub mod drive;
pub mod engine;
pub mod lan;
pub mod mailbox;

use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::Session;
use crate::error::{Error, Result};
use bundle::SyncKey;
use engine::NotApplied;
use mailbox::Mailbox;

const KEY_META: &str = "sync.key";

pub fn group_key(conn: &Connection) -> Result<Option<SyncKey>> {
    let hex: Option<zeroize::Zeroizing<String>> = conn
        .query_row(
            "SELECT value FROM local_meta WHERE key = ?1",
            [KEY_META],
            |r| r.get(0),
        )
        .optional()?
        .map(zeroize::Zeroizing::new);
    let Some(hex) = hex else { return Ok(None) };
    let bytes = zeroize::Zeroizing::new(hex::decode(hex.as_bytes()).map_err(|_| Error::Crypto)?);
    let mut key = zeroize::Zeroizing::new([0u8; 32]);
    if bytes.len() != 32 {
        return Err(Error::Crypto);
    }
    key.copy_from_slice(&bytes);
    Ok(Some(key))
}

fn set_group_key(conn: &Connection, key: Option<&SyncKey>) -> Result<()> {
    match key {
        Some(key) => conn.execute(
            "INSERT OR REPLACE INTO local_meta (key, value) VALUES (?1, ?2)",
            params![
                KEY_META,
                zeroize::Zeroizing::new(hex::encode(key.as_ref())).as_str()
            ],
        )?,
        None => conn.execute("DELETE FROM local_meta WHERE key = ?1", [KEY_META])?,
    };
    Ok(())
}

/// Starts a group with this device in it and returns the pairing code. An
/// existing group is kept.
pub fn create_group(conn: &Connection) -> Result<String> {
    let key = match group_key(conn)? {
        Some(key) => key,
        None => {
            let key = bundle::new_key();
            set_group_key(conn, Some(&key))?;
            tracing::info!(group = %bundle::group_id(&key), "created sync group");
            key
        }
    };
    Ok(bundle::pairing_code(&key))
}

pub fn join_group(conn: &Connection, code: &str) -> Result<()> {
    let key = bundle::parse_pairing_code(code)?;
    set_group_key(conn, Some(&key))?;
    tracing::info!(group = %bundle::group_id(&key), "joined sync group");
    Ok(())
}

/// Leaves the group. Data stays; send cursors reset so rejoining resends.
pub fn leave_group(conn: &Connection) -> Result<()> {
    set_group_key(conn, None)?;
    conn.execute("DELETE FROM local_meta WHERE key LIKE 'sync.sent.%'", [])?;
    tracing::info!("left sync group");
    Ok(())
}

fn sent_key(mailbox: &str, group: &str, device: &str) -> String {
    format!("sync.sent.{mailbox}.{group}.{device}")
}

fn get_meta_i64(conn: &Connection, key: &str) -> Result<i64> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM local_meta WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(value.and_then(|v| v.parse().ok()).unwrap_or(0))
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO local_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Rows sent in this run.
    pub sent: usize,
    /// Cells changed here by other devices' bundles.
    pub received: usize,
    /// Other devices seen in the mailbox.
    pub peers: usize,
    /// Some bundles could not be read yet (e.g. still uploading).
    pub waiting: bool,
}

fn with_conn<T>(
    session: &Mutex<Option<Session>>,
    f: impl FnOnce(&Connection) -> Result<T>,
) -> Result<T> {
    let guard = session.lock().unwrap();
    let session = guard.as_ref().ok_or(Error::Locked)?;
    f(session.db.conn())
}

/// One round with a mailbox: upload this device's new changes, then apply
/// every other device's bundles that continue where we left off. The
/// database is only locked between network calls.
pub fn sync_mailbox(session: &Mutex<Option<Session>>, mailbox: &dyn Mailbox) -> Result<Report> {
    let result = run_mailbox(session, mailbox);
    let (sent, received, error) = match &result {
        Ok(r) => (r.sent, r.received, None),
        Err(e) => (0, 0, Some(e.to_string())),
    };
    let logged = with_conn(session, |conn| {
        conn.execute(
            "INSERT INTO sync_log (at, transport, sent, received, error) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![chrono::Utc::now().timestamp_millis(), mailbox.name(), sent as i64, received as i64, error],
        )?;
        Ok(())
    });
    if let Err(e) = logged {
        tracing::warn!(error = %e, "could not write sync log");
    }
    match &result {
        Ok(r) => tracing::info!(
            transport = mailbox.name(),
            sent = r.sent,
            received = r.received,
            peers = r.peers,
            "synced"
        ),
        Err(e) => tracing::warn!(transport = mailbox.name(), error = %e, "sync failed"),
    }
    result
}

fn run_mailbox(session: &Mutex<Option<Session>>, mailbox: &dyn Mailbox) -> Result<Report> {
    let mut report = Report::default();
    let (key, me, sent_meta, outgoing) = with_conn(session, |conn| {
        let key =
            group_key(conn)?.ok_or_else(|| Error::Invalid("this device is not paired".into()))?;
        let me = engine::device_id(conn)?;
        let sent_meta = sent_key(mailbox.name(), &bundle::group_id(&key), &me);
        let outgoing = engine::export(conn, get_meta_i64(conn, &sent_meta)?)?;
        Ok((key, me, sent_meta, outgoing))
    })?;
    let group = bundle::group_id(&key);

    if let Some(changes) = outgoing {
        mailbox.put(
            &group,
            &me,
            &bundle::file_name(&changes),
            &bundle::seal(&key, &changes)?,
        )?;
        with_conn(session, |conn| {
            set_meta(conn, &sent_meta, &changes.to_seq.to_string())
        })?;
        report.sent = changes.rows.len();
    }

    for device in mailbox.devices(&group)? {
        if device == me {
            continue;
        }
        report.peers += 1;
        let mut files: Vec<(i64, i64, String)> = mailbox
            .list(&group, &device)?
            .into_iter()
            .filter_map(|name| bundle::parse_file_name(&name).map(|(from, to)| (from, to, name)))
            .collect();
        files.sort();
        let mut applied = with_conn(session, |conn| engine::applied_seq(conn, &device))?;
        for (from, to, name) in files {
            if to <= applied {
                continue;
            }
            if from > applied + 1 {
                report.waiting = true;
                break;
            }
            let changes = bundle::open(&key, &mailbox.get(&group, &device, &name)?)?;
            if changes.from != device || changes.from_seq != from || changes.to_seq != to {
                return Err(Error::Invalid(format!(
                    "bundle {device}/{name} does not match its name"
                )));
            }
            match with_conn(session, |conn| engine::apply(conn, &changes))? {
                Ok(done) => {
                    report.received += done.cells;
                    applied = to;
                }
                Err(NotApplied::AlreadyApplied) => applied = applied.max(to),
                Err(NotApplied::Gap { .. }) => {
                    report.waiting = true;
                    break;
                }
            }
        }
    }
    Ok(report)
}

/// Records this device in the synced `devices` table so others can name it.
pub fn register_device(conn: &Connection, platform: &str) -> Result<()> {
    let me = engine::device_id(conn)?;
    let now = chrono::Utc::now().timestamp_millis();
    let name = match platform {
        "android" | "ios" => "Phone",
        _ => "Laptop",
    };
    conn.execute(
        "INSERT INTO devices (id, name, platform, last_seen_at, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?4, ?4, ?1)
         ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at",
        params![me, name, platform, now],
    )?;
    Ok(())
}

/// Gives this database a new device id. Needed after restoring a backup:
/// the restored copy would otherwise reuse sequence numbers other devices
/// have already seen, and they would skip its new changes.
pub fn rotate_device_id(conn: &Connection) -> Result<()> {
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "UPDATE local_meta SET value = ?1 WHERE key = 'device_id'",
        [&id],
    )?;
    tracing::info!(device = %id, "new device id after restore");
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub device_id: String,
    pub name: String,
    pub platform: String,
    /// When changes from this device were last applied here.
    pub last_received_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub at: i64,
    pub transport: String,
    pub sent: i64,
    pub received: i64,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub device_id: String,
    pub group_id: Option<String>,
    /// Whether this build can sync through Google Drive.
    pub drive_available: bool,
    /// Connected Google account (`""` if its email is unknown).
    pub drive_account: Option<String>,
    pub peers: Vec<Peer>,
    pub log: Vec<LogEntry>,
}

pub fn status(conn: &Connection) -> Result<Status> {
    let me = engine::device_id(conn)?;
    let group_id = group_key(conn)?.map(|k| bundle::group_id(&k));
    let peers = conn
        .prepare(
            "SELECT d.id, d.name, d.platform, p.last_at FROM devices d
             LEFT JOIN sync_peers p ON p.device_id = d.id
             WHERE d.id != ?1 AND d.deleted_at IS NULL ORDER BY d.created_at",
        )?
        .query_map([&me], |r| {
            Ok(Peer {
                device_id: r.get(0)?,
                name: r.get(1)?,
                platform: r.get(2)?,
                last_received_at: r.get(3)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    let log = conn
        .prepare(
            "SELECT at, transport, sent, received, error FROM sync_log ORDER BY id DESC LIMIT 30",
        )?
        .query_map([], |r| {
            Ok(LogEntry {
                at: r.get(0)?,
                transport: r.get(1)?,
                sent: r.get(2)?,
                received: r.get(3)?,
                error: r.get(4)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(Status {
        device_id: me,
        group_id,
        drive_available: drive::configured(),
        drive_account: drive::account(conn)?,
        peers,
        log,
    })
}

#[cfg(test)]
mod tests;
