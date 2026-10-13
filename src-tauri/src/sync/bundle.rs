//! Sync groups and encrypted bundles.
//!
//! Devices that share a sync key form a group. Changes travel as bundles:
//! compressed JSON encrypted with XChaCha20-Poly1305 under that key, so a
//! transport (Google Drive, a folder, the network) only sees opaque bytes.

use std::io::{Read, Write};

use blake2::{Blake2s256, Digest};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use rand::rngs::OsRng;
use zeroize::Zeroizing;

use super::engine::Changes;
use crate::error::{Error, Result};

const MAGIC: &[u8; 4] = b"KZB1";
const NONCE_LEN: usize = 24;
const CODE_PREFIX: &str = "KZ1-";

pub type SyncKey = Zeroizing<[u8; 32]>;

pub fn new_key() -> SyncKey {
    let mut key = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(key.as_mut());
    key
}

/// Public name of the group, used for folder names; reveals nothing about the key.
pub fn group_id(key: &SyncKey) -> String {
    let mut hasher = Blake2s256::new();
    hasher.update(b"kaizen-sync-group");
    hasher.update(key.as_ref());
    hex::encode(&hasher.finalize()[..8])
}

/// Pairing code carried by the QR code (or typed): `KZ1-` + base32 key.
/// Optionally followed by `~` and the inviting laptop's addresses for direct
/// sync: `KZ1-<key>~192.168.1.20,100.101.7.42`.
pub fn pairing_code(key: &SyncKey, hosts: &[String]) -> String {
    let mut code = format!(
        "{CODE_PREFIX}{}",
        base32::encode(base32::Alphabet::Rfc4648 { padding: false }, key.as_ref())
    );
    if !hosts.is_empty() {
        code.push('~');
        code.push_str(&hosts.join(","));
    }
    code
}

/// The key and any laptop addresses in a pairing code.
pub fn parse_pairing_code(code: &str) -> Result<(SyncKey, Vec<String>)> {
    let invalid = || Error::Invalid("not a Kaizen pairing code".into());
    let compact: String = code.trim().chars().filter(|c| !c.is_whitespace()).collect();
    let (key_part, hosts_part) = compact.split_once('~').unwrap_or((&compact, ""));
    let hosts = hosts_part
        .split(',')
        .filter(|h| {
            !h.is_empty()
                && h.len() <= 253
                && h.chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c))
        })
        .map(str::to_string)
        .collect();
    let cleaned = key_part.to_uppercase();
    let body = cleaned.strip_prefix(CODE_PREFIX).ok_or_else(invalid)?;
    let bytes = Zeroizing::new(
        base32::decode(base32::Alphabet::Rfc4648 { padding: false }, body).ok_or_else(invalid)?,
    );
    let mut key = Zeroizing::new([0u8; 32]);
    if bytes.len() != key.len() {
        return Err(invalid());
    }
    key.copy_from_slice(&bytes);
    Ok((key, hosts))
}

fn aad(group: &str) -> Vec<u8> {
    [MAGIC.as_slice(), group.as_bytes()].concat()
}

pub fn seal(key: &SyncKey, changes: &Changes) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(changes)?;
    let mut encoder =
        flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&json)?;
    let compressed = encoder.finish()?;

    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let sealed = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &compressed,
                aad: &aad(&group_id(key)),
            },
        )
        .map_err(|_| Error::Crypto)?;
    Ok([MAGIC.as_slice(), &nonce, &sealed].concat())
}

pub fn open(key: &SyncKey, bytes: &[u8]) -> Result<Changes> {
    if bytes.len() < MAGIC.len() + NONCE_LEN || &bytes[..MAGIC.len()] != MAGIC {
        return Err(Error::Invalid("not a Kaizen sync bundle".into()));
    }
    let (nonce, sealed) = bytes[MAGIC.len()..].split_at(NONCE_LEN);
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let compressed = cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: sealed,
                aad: &aad(&group_id(key)),
            },
        )
        .map_err(|_| Error::Crypto)?;
    let mut json = Vec::new();
    flate2::read::DeflateDecoder::new(compressed.as_slice()).read_to_end(&mut json)?;
    Ok(serde_json::from_slice(&json)?)
}

/// Bundle file name; zero-padded so names sort in order.
pub fn file_name(changes: &Changes) -> String {
    format!("{:012}-{:012}.kzb", changes.from_seq, changes.to_seq)
}

/// `(from_seq, to_seq)` from a bundle file name.
pub fn parse_file_name(name: &str) -> Option<(i64, i64)> {
    let (from, to) = name.strip_suffix(".kzb")?.split_once('-')?;
    Some((from.parse().ok()?, to.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_other_keys() {
        let key = new_key();
        let changes = Changes {
            from: "a".into(),
            from_seq: 1,
            to_seq: 9,
            rows: vec![],
        };
        let sealed = seal(&key, &changes).unwrap();
        assert_eq!(open(&key, &sealed).unwrap(), changes);
        assert!(matches!(open(&new_key(), &sealed), Err(Error::Crypto)));

        let code = pairing_code(&key, &[]);
        assert_eq!(*parse_pairing_code(&code.to_lowercase()).unwrap().0, *key);
        let with_hosts = pairing_code(&key, &["192.168.1.20".into(), "100.101.7.42".into()]);
        let (parsed, hosts) = parse_pairing_code(&with_hosts).unwrap();
        assert_eq!(*parsed, *key);
        assert_eq!(hosts, vec!["192.168.1.20", "100.101.7.42"]);
        assert!(parse_pairing_code("KZ1-ABC").is_err());
        assert_eq!(parse_file_name(&file_name(&changes)), Some((1, 9)));
    }
}
