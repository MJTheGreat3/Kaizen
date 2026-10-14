//! Files attached to rows (progress photos), kept in the data folder's
//! `attachments/` directory, each encrypted with the database key.
//!
//! The `attachments` rows sync; the files do not, so a file taken on one
//! device shows as missing on the others.

use std::path::Path;

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use rand::rngs::OsRng;
use rusqlite::{Connection, OptionalExtension, params};

use crate::backup::ATTACHMENTS_DIR;
use crate::error::{Error, Result};
use crate::vault::DataKey;

const MAGIC: &[u8; 4] = b"KZA1";
const NONCE_LEN: usize = 24;

fn seal(key: &DataKey, id: &str, bytes: &[u8]) -> Result<Vec<u8>> {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let sealed = XChaCha20Poly1305::new(key.as_ref().into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: bytes,
                aad: id.as_bytes(),
            },
        )
        .map_err(|_| Error::Crypto)?;
    Ok([MAGIC.as_slice(), &nonce, &sealed].concat())
}

fn open(key: &DataKey, id: &str, bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < MAGIC.len() + NONCE_LEN || &bytes[..MAGIC.len()] != MAGIC {
        return Err(Error::Invalid("not a Kaizen attachment".into()));
    }
    let (nonce, sealed) = bytes[MAGIC.len()..].split_at(NONCE_LEN);
    XChaCha20Poly1305::new(key.as_ref().into())
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: sealed,
                aad: id.as_bytes(),
            },
        )
        .map_err(|_| Error::Crypto)
}

/// A file to attach to a row.
pub struct NewFile<'a> {
    pub owner_table: &'a str,
    pub owner_id: &'a str,
    pub file_name: &'a str,
    pub mime: Option<&'a str>,
    pub bytes: &'a [u8],
}

/// Encrypts and stores a file for a row; returns the attachment id.
pub fn add(data_dir: &Path, key: &DataKey, conn: &Connection, file: &NewFile) -> Result<String> {
    let NewFile {
        owner_table,
        owner_id,
        file_name,
        mime,
        bytes,
    } = *file;
    let id = uuid::Uuid::now_v7().to_string();
    let rel = format!("{ATTACHMENTS_DIR}/{id}.kza");
    let path = data_dir.join(&rel);
    std::fs::create_dir_all(data_dir.join(ATTACHMENTS_DIR))?;
    std::fs::write(&path, seal(key, &id, bytes)?)?;
    let now = chrono::Utc::now().timestamp_millis();
    let inserted = conn.execute(
        "INSERT INTO attachments
           (id, owner_table, owner_id, file_name, mime_type, size_bytes, rel_path, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, (SELECT value FROM local_meta WHERE key = 'device_id'))",
        params![id, owner_table, owner_id, file_name, mime, bytes.len() as i64, rel, now],
    );
    if let Err(e) = inserted {
        let _ = std::fs::remove_file(&path);
        return Err(e.into());
    }
    Ok(id)
}

/// The decrypted file, or an error saying it lives on another device.
pub fn read(data_dir: &Path, key: &DataKey, conn: &Connection, id: &str) -> Result<Vec<u8>> {
    let rel: String = conn
        .query_row(
            "SELECT rel_path FROM attachments WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| Error::Invalid("This file was removed".into()))?;
    let path = data_dir.join(rel);
    if !path.exists() {
        return Err(Error::Invalid("This file is on another device".into()));
    }
    open(key, id, &std::fs::read(path)?)
}

/// Removes the row (synced) and this device's copy of the file.
pub fn remove(data_dir: &Path, conn: &Connection, id: &str) -> Result<()> {
    let rel: Option<String> = conn
        .query_row(
            "SELECT rel_path FROM attachments WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    conn.execute(
        "UPDATE attachments SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, chrono::Utc::now().timestamp_millis()],
    )?;
    if let Some(rel) = rel {
        let _ = std::fs::remove_file(data_dir.join(rel));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;

    #[test]
    fn stores_files_encrypted() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        let key: DataKey = zeroize::Zeroizing::new([7u8; 32]);
        let file = NewFile {
            owner_table: "body_metrics",
            owner_id: "bm:2026-10-14",
            file_name: "a.jpg",
            mime: Some("image/jpeg"),
            bytes: b"photo bytes",
        };
        let id = add(dir, &key, &conn, &file).unwrap();
        let rel: String = conn
            .query_row(
                "SELECT rel_path FROM attachments WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        let raw = std::fs::read(dir.join(&rel)).unwrap();
        assert!(!raw.windows(5).any(|w| w == b"photo"));
        assert_eq!(read(dir, &key, &conn, &id).unwrap(), b"photo bytes");
        let other: DataKey = zeroize::Zeroizing::new([8u8; 32]);
        assert!(read(dir, &other, &conn, &id).is_err());
        remove(dir, &conn, &id).unwrap();
        assert!(!dir.join(&rel).exists());
        assert!(read(dir, &key, &conn, &id).is_err());
    }
}
