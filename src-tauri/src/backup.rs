//! Backups are plain folders:
//!
//! ```text
//! kaizen-backup-20261013-201500/
//!   manifest.json   app, format, schema version, timestamps
//!   kaizen.db       encrypted copy of the database (same key)
//!   vault.json      wrapped keys, so the backup opens with its passphrase
//!   attachments/    attached files
//! ```

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::{DB_FILE, Database, migrations};
use crate::error::{Error, Result};
use crate::vault::{self, DataKey, VAULT_FILE};

pub const ATTACHMENTS_DIR: &str = "attachments";
const MANIFEST: &str = "manifest.json";
const PREFIX: &str = "kaizen-backup-";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    app: String,
    format: u32,
    schema_version: i64,
    device_id: String,
    created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub name: String,
    pub created_at: i64,
    pub schema_version: i64,
    pub size_bytes: u64,
}

fn copy_dir(src: &Path, dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)?;
    if !src.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn dir_size(path: &Path) -> u64 {
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| match e.metadata() {
                    Ok(m) if m.is_dir() => dir_size(&e.path()),
                    Ok(m) => m.len(),
                    Err(_) => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

fn read_manifest(dir: &Path) -> Result<Manifest> {
    let manifest: Manifest = serde_json::from_slice(&std::fs::read(dir.join(MANIFEST))?)?;
    if manifest.app != "kaizen" || manifest.format != 1 {
        return Err(Error::Invalid("not a Kaizen backup".into()));
    }
    Ok(manifest)
}

fn info(dir: &Path, manifest: &Manifest) -> BackupInfo {
    BackupInfo {
        path: dir.to_string_lossy().into_owned(),
        name: dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        created_at: manifest.created_at,
        schema_version: manifest.schema_version,
        size_bytes: dir_size(dir),
    }
}

pub fn create(
    db: &Database,
    key: &DataKey,
    data_dir: &Path,
    dest_root: &Path,
) -> Result<BackupInfo> {
    let now = chrono::Local::now();
    let dir = dest_root.join(format!("{PREFIX}{}", now.format("%Y%m%d-%H%M%S-%3f")));
    let tmp = dest_root.join(format!(".tmp-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&tmp)?;

    let result = (|| {
        db.export_copy(&tmp.join(DB_FILE), key)?;
        std::fs::copy(vault::vault_path(data_dir), tmp.join(VAULT_FILE))?;
        copy_dir(&data_dir.join(ATTACHMENTS_DIR), &tmp.join(ATTACHMENTS_DIR))?;
        let manifest = Manifest {
            app: "kaizen".into(),
            format: 1,
            schema_version: migrations::current_version(db.conn())?,
            device_id: db.device_id()?,
            created_at: now.timestamp_millis(),
        };
        std::fs::write(tmp.join(MANIFEST), serde_json::to_vec_pretty(&manifest)?)?;
        std::fs::rename(&tmp, &dir)?;
        Ok(info(&dir, &manifest))
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    if let Ok(backup) = &result {
        tracing::info!(path = %backup.path, "backup created");
    }
    result
}

pub fn list(dest_root: &Path) -> Result<Vec<BackupInfo>> {
    if !dest_root.exists() {
        return Ok(Vec::new());
    }
    let mut backups: Vec<BackupInfo> = std::fs::read_dir(dest_root)?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(PREFIX))
        .filter_map(|e| read_manifest(&e.path()).ok().map(|m| info(&e.path(), &m)))
        .collect();
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

/// Deletes all but the newest `keep` backups in `dest_root`.
pub fn prune(dest_root: &Path, keep: usize) -> Result<usize> {
    let backups = list(dest_root)?;
    let mut removed = 0;
    for old in backups.iter().skip(keep.max(1)) {
        std::fs::remove_dir_all(&old.path)?;
        removed += 1;
    }
    Ok(removed)
}

fn remove_db_files(data_dir: &Path) -> Result<()> {
    for name in [
        DB_FILE.to_string(),
        format!("{DB_FILE}-wal"),
        format!("{DB_FILE}-shm"),
    ] {
        let path = data_dir.join(name);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

/// Replaces the local data with a backup. The database must be closed first.
pub fn restore(data_dir: &Path, backup_dir: &Path) -> Result<()> {
    read_manifest(backup_dir)?;
    for required in [DB_FILE, VAULT_FILE] {
        if !backup_dir.join(required).exists() {
            return Err(Error::Invalid(format!("backup is missing {required}")));
        }
    }
    std::fs::create_dir_all(data_dir)?;
    remove_db_files(data_dir)?;
    std::fs::copy(backup_dir.join(DB_FILE), data_dir.join(DB_FILE))?;
    std::fs::copy(backup_dir.join(VAULT_FILE), vault::vault_path(data_dir))?;
    let attachments = data_dir.join(ATTACHMENTS_DIR);
    if attachments.exists() {
        std::fs::remove_dir_all(&attachments)?;
    }
    copy_dir(&backup_dir.join(ATTACHMENTS_DIR), &attachments)?;
    // The restored data may use a different key.
    vault::clear_device_key(data_dir)?;
    tracing::info!(backup = %backup_dir.display(), "backup restored");
    Ok(())
}

/// Erases all local data on this device. The database must be closed first.
pub fn wipe(data_dir: &Path) -> Result<()> {
    remove_db_files(data_dir)?;
    let vault_file = vault::vault_path(data_dir);
    if vault_file.exists() {
        std::fs::remove_file(vault_file)?;
    }
    let attachments = data_dir.join(ATTACHMENTS_DIR);
    if attachments.exists() {
        std::fs::remove_dir_all(attachments)?;
    }
    vault::clear_device_key(data_dir)?;
    tracing::warn!("local data wiped");
    Ok(())
}

pub fn default_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::QueryMethod;
    use serde_json::json;

    #[test]
    fn backup_wipe_restore_round_trip() {
        let data = tempfile::tempdir().unwrap();
        let backups = tempfile::tempdir().unwrap();
        let (key, _recovery) = vault::create(data.path(), "round trip pass").unwrap();

        let db = Database::open(&data.path().join(DB_FILE), &key, None).unwrap();
        let device = db.device_id().unwrap();
        db.query(
            "INSERT INTO settings (id, value, created_at, updated_at, device_id) VALUES ('k', '1', 1, 1, ?)",
            &[json!(device)],
            QueryMethod::Run,
        )
        .unwrap();
        std::fs::create_dir_all(data.path().join(ATTACHMENTS_DIR)).unwrap();
        std::fs::write(data.path().join(ATTACHMENTS_DIR).join("a.txt"), b"hello").unwrap();

        let first = create(&db, &key, data.path(), backups.path()).unwrap();
        create(&db, &key, data.path(), backups.path()).unwrap();
        assert_eq!(list(backups.path()).unwrap().len(), 2);
        drop(db);

        wipe(data.path()).unwrap();
        assert!(!vault::exists(data.path()));

        restore(data.path(), Path::new(&first.path)).unwrap();
        let key = vault::unlock_with_passphrase(data.path(), "round trip pass").unwrap();
        let db = Database::open(&data.path().join(DB_FILE), &key, None).unwrap();
        let rows = db
            .query(
                "SELECT value FROM settings WHERE id = 'k'",
                &[],
                QueryMethod::Get,
            )
            .unwrap();
        assert_eq!(rows[0][0], json!("1"));
        assert!(data.path().join(ATTACHMENTS_DIR).join("a.txt").exists());

        assert_eq!(prune(backups.path(), 1).unwrap(), 1);
        assert_eq!(list(backups.path()).unwrap().len(), 1);
    }
}
