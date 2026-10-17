//! OAuth clients for Google Drive sync and Spotify.
//!
//! A build can bake clients in (`KAIZEN_GOOGLE_CLIENT_ID`,
//! `KAIZEN_GOOGLE_CLIENT_SECRET`, `KAIZEN_SPOTIFY_CLIENT_ID` at compile
//! time). Published builds leave them out, so whoever installs Kaizen
//! enters their own in Settings. Those are kept in this device's
//! `local_meta` (inside the encrypted database, never synced) and win over
//! built-in ones.

use std::sync::RwLock;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::Result;

const GOOGLE_ID: &str = "keys.google.id";
const GOOGLE_SECRET: &str = "keys.google.secret";
const SPOTIFY_ID: &str = "keys.spotify.id";

struct Own {
    google_id: Option<String>,
    google_secret: Option<String>,
    spotify_id: Option<String>,
}

static OWN: RwLock<Own> = RwLock::new(Own {
    google_id: None,
    google_secret: None,
    spotify_id: None,
});

fn non_empty(v: Option<&str>) -> Option<String> {
    v.map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

fn read(conn: &Connection, key: &str) -> Result<Option<String>> {
    let v: Option<String> = conn
        .query_row("SELECT value FROM local_meta WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(non_empty(v.as_deref()))
}

/// Loads this device's own clients; call once the database is open.
pub fn load(conn: &Connection) -> Result<()> {
    let own = Own {
        google_id: read(conn, GOOGLE_ID)?,
        google_secret: read(conn, GOOGLE_SECRET)?,
        spotify_id: read(conn, SPOTIFY_ID)?,
    };
    *OWN.write().unwrap_or_else(|e| e.into_inner()) = own;
    Ok(())
}

fn built_in_google() -> Option<(String, String)> {
    Some((
        non_empty(option_env!("KAIZEN_GOOGLE_CLIENT_ID"))?,
        non_empty(option_env!("KAIZEN_GOOGLE_CLIENT_SECRET"))?,
    ))
}

fn built_in_spotify() -> Option<String> {
    non_empty(option_env!("KAIZEN_SPOTIFY_CLIENT_ID"))
}

/// The Google client (id, secret) to use, if any.
pub fn google() -> Option<(String, String)> {
    let own = OWN.read().unwrap_or_else(|e| e.into_inner());
    match (&own.google_id, &own.google_secret) {
        (Some(id), Some(secret)) => Some((id.clone(), secret.clone())),
        _ => built_in_google(),
    }
}

/// The Spotify client id to use, if any.
pub fn spotify() -> Option<String> {
    let own = OWN.read().unwrap_or_else(|e| e.into_inner());
    own.spotify_id.clone().or_else(built_in_spotify)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeysStatus {
    /// This device's own Google client id, if entered.
    pub google_id: String,
    pub google_secret_set: bool,
    pub spotify_id: String,
    /// Whether this build carries its own clients.
    pub google_built_in: bool,
    pub spotify_built_in: bool,
}

pub fn status() -> KeysStatus {
    let own = OWN.read().unwrap_or_else(|e| e.into_inner());
    KeysStatus {
        google_id: own.google_id.clone().unwrap_or_default(),
        google_secret_set: own.google_secret.is_some(),
        spotify_id: own.spotify_id.clone().unwrap_or_default(),
        google_built_in: built_in_google().is_some(),
        spotify_built_in: built_in_spotify().is_some(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeysInput {
    pub google_id: String,
    /// `None` keeps the stored secret; an empty string removes it.
    pub google_secret: Option<String>,
    pub spotify_id: String,
}

/// Stores this device's own clients (empty values remove them).
pub fn save(conn: &Connection, input: &KeysInput) -> Result<()> {
    let put = |key: &str, value: Option<&str>| -> Result<()> {
        match non_empty(value) {
            Some(v) => conn.execute(
                "INSERT INTO local_meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                [key, v.as_str()],
            )?,
            None => conn.execute("DELETE FROM local_meta WHERE key = ?1", [key])?,
        };
        Ok(())
    };
    put(GOOGLE_ID, Some(&input.google_id))?;
    if let Some(secret) = &input.google_secret {
        put(GOOGLE_SECRET, Some(secret))?;
    }
    put(SPOTIFY_ID, Some(&input.spotify_id))?;
    load(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_clients_are_stored_and_win() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrations::migrate(&mut conn).unwrap();
        save(
            &conn,
            &KeysInput {
                google_id: " id.apps.googleusercontent.com ".into(),
                google_secret: Some("shh".into()),
                spotify_id: "spot".into(),
            },
        )
        .unwrap();
        assert_eq!(
            google(),
            Some(("id.apps.googleusercontent.com".into(), "shh".into()))
        );
        assert_eq!(spotify().as_deref(), Some("spot"));
        // Leaving the secret out keeps it; clearing the id removes the client.
        save(
            &conn,
            &KeysInput {
                google_id: "".into(),
                google_secret: None,
                spotify_id: "".into(),
            },
        )
        .unwrap();
        let s = status();
        assert!(s.google_id.is_empty() && s.google_secret_set);
        assert_eq!(google(), built_in_google());
        assert_eq!(spotify(), built_in_spotify());
    }
}
