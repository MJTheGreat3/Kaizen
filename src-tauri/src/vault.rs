//! Key management.
//!
//! The database is encrypted with a random 256-bit data key (DEK). The DEK is
//! stored in `vault.json` twice, each copy wrapped (XChaCha20-Poly1305) with a
//! key derived by Argon2id: once from the passphrase and once from the recovery
//! key. The raw DEK is also kept in device storage so the app opens without
//! the passphrase (OS keychain on desktop, app-private storage on Android);
//! the passphrase still guards private files, backups and recovery.

use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::error::{Error, Result};

pub const VAULT_FILE: &str = "vault.json";
const KEY_LEN: usize = 32;

/// Raw database key; wiped from memory when dropped.
pub type DataKey = Zeroizing<[u8; KEY_LEN]>;

#[derive(Serialize, Deserialize, Clone)]
struct KdfParams {
    m_cost_kib: u32,
    t_cost: u32,
    p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            m_cost_kib: 64 * 1024,
            t_cost: 3,
            p_cost: 1,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct WrappedKey {
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultFile {
    version: u32,
    kdf: KdfParams,
    passphrase: WrappedKey,
    recovery: WrappedKey,
    created_at: i64,
}

fn random<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    OsRng.fill_bytes(&mut buf);
    buf
}

fn derive(secret: &[u8], salt: &[u8], kdf: &KdfParams) -> Result<Zeroizing<[u8; KEY_LEN]>> {
    let params = Params::new(kdf.m_cost_kib, kdf.t_cost, kdf.p_cost, Some(KEY_LEN))
        .map_err(|_| Error::Crypto)?;
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, salt, out.as_mut())
        .map_err(|_| Error::Crypto)?;
    Ok(out)
}

fn wrap(dek: &DataKey, secret: &[u8], kdf: &KdfParams) -> Result<WrappedKey> {
    let salt: [u8; 16] = random();
    let nonce: [u8; 24] = random();
    let kek = derive(secret, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new(kek.as_ref().into());
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), dek.as_ref())
        .map_err(|_| Error::Crypto)?;
    Ok(WrappedKey {
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        ciphertext: hex::encode(ciphertext),
    })
}

fn unwrap(wrapped: &WrappedKey, secret: &[u8], kdf: &KdfParams) -> Result<DataKey> {
    let salt = hex::decode(&wrapped.salt).map_err(|_| Error::Crypto)?;
    let nonce = hex::decode(&wrapped.nonce).map_err(|_| Error::Crypto)?;
    let ciphertext = hex::decode(&wrapped.ciphertext).map_err(|_| Error::Crypto)?;
    if nonce.len() != 24 {
        return Err(Error::Crypto);
    }
    let kek = derive(secret, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new(kek.as_ref().into());
    let mut plain = cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| Error::WrongSecret)?;
    if plain.len() != KEY_LEN {
        plain.zeroize();
        return Err(Error::Crypto);
    }
    let mut dek = Zeroizing::new([0u8; KEY_LEN]);
    dek.copy_from_slice(&plain);
    plain.zeroize();
    Ok(dek)
}

/// Recovery keys look like `ABCD-EFGH-...` (32 base32 characters, 160 bits).
fn new_recovery_key() -> String {
    let bytes: [u8; 20] = random();
    let encoded = base32::encode(base32::Alphabet::Rfc4648 { padding: false }, &bytes);
    encoded
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

/// Accepts recovery keys typed with any case, spaces or dashes.
fn normalize_recovery_key(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

pub fn validate_passphrase(passphrase: &str) -> Result<()> {
    if passphrase.chars().count() < 8 {
        return Err(Error::Invalid(
            "passphrase must be at least 8 characters".into(),
        ));
    }
    Ok(())
}

pub fn vault_path(data_dir: &Path) -> PathBuf {
    data_dir.join(VAULT_FILE)
}

pub fn exists(data_dir: &Path) -> bool {
    vault_path(data_dir).exists()
}

fn read(data_dir: &Path) -> Result<VaultFile> {
    let path = vault_path(data_dir);
    if !path.exists() {
        return Err(Error::VaultMissing);
    }
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

fn write(data_dir: &Path, vault: &VaultFile) -> Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let tmp = data_dir.join(format!("{VAULT_FILE}.tmp"));
    std::fs::write(&tmp, serde_json::to_vec_pretty(vault)?)?;
    std::fs::rename(tmp, vault_path(data_dir))?;
    Ok(())
}

/// Creates a new vault. Returns the data key and the recovery key to show once.
pub fn create(data_dir: &Path, passphrase: &str) -> Result<(DataKey, String)> {
    if exists(data_dir) {
        return Err(Error::VaultExists);
    }
    validate_passphrase(passphrase)?;
    let kdf = KdfParams::default();
    let dek: DataKey = Zeroizing::new(random());
    let recovery_key = new_recovery_key();
    let vault = VaultFile {
        version: 1,
        passphrase: wrap(&dek, passphrase.as_bytes(), &kdf)?,
        recovery: wrap(&dek, normalize_recovery_key(&recovery_key).as_bytes(), &kdf)?,
        kdf,
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    write(data_dir, &vault)?;
    Ok((dek, recovery_key))
}

pub fn unlock_with_passphrase(data_dir: &Path, passphrase: &str) -> Result<DataKey> {
    let vault = read(data_dir)?;
    unwrap(&vault.passphrase, passphrase.as_bytes(), &vault.kdf)
}

/// Unlocks with the recovery key and replaces the passphrase.
pub fn reset_passphrase(
    data_dir: &Path,
    recovery_key: &str,
    new_passphrase: &str,
) -> Result<DataKey> {
    validate_passphrase(new_passphrase)?;
    let mut vault = read(data_dir)?;
    let dek = unwrap(
        &vault.recovery,
        normalize_recovery_key(recovery_key).as_bytes(),
        &vault.kdf,
    )?;
    vault.passphrase = wrap(&dek, new_passphrase.as_bytes(), &vault.kdf)?;
    write(data_dir, &vault)?;
    Ok(dek)
}

// ---------------------------------------------------------------------------
// Device key store (quick unlock)
// ---------------------------------------------------------------------------

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod device_store {
    use super::*;

    const SERVICE: &str = "com.matt.kaizen";
    const ACCOUNT: &str = "database-key";

    fn entry() -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| Error::Keychain(e.to_string()))
    }

    pub fn save(_data_dir: &Path, dek: &DataKey) -> Result<()> {
        let encoded = Zeroizing::new(hex::encode(dek.as_ref()));
        entry()?
            .set_password(&encoded)
            .map_err(|e| Error::Keychain(e.to_string()))
    }

    pub fn load(_data_dir: &Path) -> Result<Option<DataKey>> {
        match entry()?.get_password() {
            Ok(encoded) => {
                let encoded = Zeroizing::new(encoded);
                decode(&encoded).map(Some)
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Keychain(e.to_string())),
        }
    }

    pub fn clear(_data_dir: &Path) -> Result<()> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Keychain(e.to_string())),
        }
    }
}

/// On Android the key is kept in app-private storage, which other apps cannot
/// read.
/// TODO: wrap it with an Android Keystore key once a Kotlin plugin exists.
#[cfg(any(target_os = "android", target_os = "ios"))]
mod device_store {
    use super::*;

    const FILE: &str = "device.key";

    pub fn save(data_dir: &Path, dek: &DataKey) -> Result<()> {
        let encoded = Zeroizing::new(hex::encode(dek.as_ref()));
        std::fs::write(data_dir.join(FILE), encoded.as_bytes())?;
        Ok(())
    }

    pub fn load(data_dir: &Path) -> Result<Option<DataKey>> {
        let path = data_dir.join(FILE);
        if !path.exists() {
            return Ok(None);
        }
        let encoded = Zeroizing::new(std::fs::read_to_string(path)?);
        decode(encoded.trim()).map(Some)
    }

    pub fn clear(data_dir: &Path) -> Result<()> {
        let path = data_dir.join(FILE);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}

fn decode(encoded: &str) -> Result<DataKey> {
    let mut bytes = hex::decode(encoded).map_err(|_| Error::Crypto)?;
    if bytes.len() != KEY_LEN {
        bytes.zeroize();
        return Err(Error::Crypto);
    }
    let mut dek = Zeroizing::new([0u8; KEY_LEN]);
    dek.copy_from_slice(&bytes);
    bytes.zeroize();
    Ok(dek)
}

pub use device_store::{
    clear as clear_device_key, load as load_device_key, save as save_device_key,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_unlock_and_reset() {
        let dir = tempfile::tempdir().unwrap();
        let (dek, recovery) = create(dir.path(), "correct horse").unwrap();
        assert_eq!(recovery.len(), 32 + 7);

        let unlocked = unlock_with_passphrase(dir.path(), "correct horse").unwrap();
        assert_eq!(dek.as_ref(), unlocked.as_ref());

        assert!(matches!(
            unlock_with_passphrase(dir.path(), "wrong passphrase"),
            Err(Error::WrongSecret)
        ));

        let lowercase = recovery.to_lowercase().replace('-', " ");
        let reset = reset_passphrase(dir.path(), &lowercase, "new passphrase").unwrap();
        assert_eq!(dek.as_ref(), reset.as_ref());
        assert!(unlock_with_passphrase(dir.path(), "new passphrase").is_ok());
        assert!(unlock_with_passphrase(dir.path(), "correct horse").is_err());
    }

    #[test]
    fn rejects_short_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            create(dir.path(), "short"),
            Err(Error::Invalid(_))
        ));
    }
}
