use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("vault is not set up")]
    VaultMissing,
    #[error("vault is already set up")]
    VaultExists,
    #[error("app is locked")]
    Locked,
    #[error("wrong passphrase or recovery key")]
    WrongSecret,
    #[error("enter your passphrase to see this")]
    PrivateLocked,
    #[error("device unlock is not enabled on this device")]
    DeviceUnlockUnavailable,
    #[error("{0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("crypto error")]
    Crypto,
    #[error("keychain error: {0}")]
    #[cfg_attr(mobile, allow(dead_code))]
    Keychain(String),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Http(String),
}

impl Error {
    fn code(&self) -> &'static str {
        match self {
            Error::VaultMissing => "vault_missing",
            Error::VaultExists => "vault_exists",
            Error::Locked => "locked",
            Error::WrongSecret => "wrong_secret",
            Error::PrivateLocked => "private_locked",
            Error::DeviceUnlockUnavailable => "device_unlock_unavailable",
            Error::Invalid(_) => "invalid",
            Error::Db(_) => "db",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
            Error::Crypto => "crypto",
            Error::Keychain(_) => "keychain",
            Error::Tauri(_) => "tauri",
            Error::Http(_) => "http",
        }
    }
}

/// Errors reach the frontend as `{ code, message }`.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("Error", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type Result<T> = std::result::Result<T, Error>;
