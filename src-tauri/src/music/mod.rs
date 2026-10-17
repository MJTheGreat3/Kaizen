//! Spotify: Kaizen is a remote control for Spotify Connect (audio plays in
//! the Spotify app), plus a local listening history and lyrics.
//!
//! Sign-in is OAuth with PKCE (no client secret) and a fixed loopback
//! redirect, [`REDIRECT_URI`], which must be registered on the Spotify app.
//! The Client ID comes from `KAIZEN_SPOTIFY_CLIENT_ID` at build time. The
//! refresh token is kept per device in `local_meta` (inside the encrypted
//! database); access tokens live only in memory.

pub mod lyrics;
#[cfg(test)]
mod tests;

use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value as JsonValue, json};

use crate::error::{Error, Result};
use crate::oauth::{self, percent_encode, random_token};

const AUTH_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const API_URL: &str = "https://api.spotify.com/v1";
pub const REDIRECT_PORT: u16 = 43821;
pub const REDIRECT_URI: &str = "http://127.0.0.1:43821/callback";
const SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing \
user-read-recently-played user-top-read user-library-read user-library-modify \
playlist-read-private playlist-read-collaborative user-read-private";

const REFRESH_META: &str = "music.spotify.refresh";
const NAME_META: &str = "music.spotify.name";
const HISTORY_META: &str = "music.history.after";

/// The current access token and when it stops working.
static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn client_id() -> Result<String> {
    crate::keys::spotify().ok_or_else(|| {
        Error::Invalid("add a Spotify client ID in Settings → Connections first".into())
    })
}

pub fn configured() -> bool {
    client_id().is_ok()
}

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .user_agent("Kaizen (personal life tracker; github.com/MJTheGreat3)")
        .build()
        .into()
}

fn http_err(e: ureq::Error) -> Error {
    Error::Http(e.to_string())
}

/// Spotify's error message from a failed response.
fn message(body: &JsonValue) -> String {
    body["error"]["message"]
        .as_str()
        .or_else(|| body["error_description"].as_str())
        .or_else(|| body["error"].as_str())
        .unwrap_or("request failed")
        .to_string()
}

/// A started sign-in: open `url` in the browser, then call [`finish_sign_in`].
pub struct SignIn {
    pub url: String,
    listener: TcpListener,
    verifier: String,
    state: String,
}

pub fn start_sign_in() -> Result<SignIn> {
    let id = client_id()?;
    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).map_err(|e| {
        Error::Invalid(format!(
            "port {REDIRECT_PORT} is busy ({e}); close whatever uses it and try again"
        ))
    })?;
    let verifier = random_token();
    let state = random_token();
    let url = format!(
        "{AUTH_URL}?client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge_method=S256&code_challenge={}&state={state}",
        percent_encode(&id),
        percent_encode(REDIRECT_URI),
        percent_encode(SCOPES),
        oauth::challenge(&verifier),
    );
    Ok(SignIn {
        url,
        listener,
        verifier,
        state,
    })
}

/// Tokens from the token endpoint: (access, expires in seconds, refresh if rotated).
fn read_tokens(resp: ureq::http::Response<ureq::Body>) -> Result<(String, u64, Option<String>)> {
    let mut resp = resp;
    let status = resp.status();
    let body: JsonValue = resp.body_mut().read_json().unwrap_or(JsonValue::Null);
    if !status.is_success() {
        return Err(Error::Http(format!(
            "Spotify returned {}: {}",
            status.as_u16(),
            message(&body)
        )));
    }
    let access = body["access_token"]
        .as_str()
        .ok_or_else(|| Error::Http("Spotify did not return a token".into()))?
        .to_string();
    Ok((
        access,
        body["expires_in"].as_u64().unwrap_or(3600),
        body["refresh_token"].as_str().map(str::to_string),
    ))
}

fn remember(access: &str, expires_in: u64) {
    let until = Instant::now() + Duration::from_secs(expires_in.saturating_sub(60));
    *ACCESS.lock().unwrap_or_else(|e| e.into_inner()) = Some((access.to_string(), until));
}

/// Waits for the browser (blocking), trades the code for tokens and returns
/// the refresh token.
pub fn finish_sign_in(sign_in: SignIn) -> Result<String> {
    let id = client_id()?;
    let code = oauth::wait_for_code(&sign_in.listener, &sign_in.state, "Spotify")?;
    drop(sign_in.listener);
    // Android blocks the network for background apps while the browser is
    // in front; keep trying until the user comes back (codes last minutes).
    let agent = agent();
    let retry_until = Instant::now() + Duration::from_secs(300);
    let resp = loop {
        match agent.post(TOKEN_URL).send_form([
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", REDIRECT_URI),
            ("client_id", id.as_str()),
            ("code_verifier", sign_in.verifier.as_str()),
        ]) {
            Ok(resp) => break resp,
            Err(e) if Instant::now() < retry_until => {
                tracing::info!(error = %e, "Spotify token exchange not possible yet; retrying");
                std::thread::sleep(Duration::from_secs(2));
            }
            Err(e) => return Err(http_err(e)),
        }
    };
    let (access, expires, refresh) = read_tokens(resp)?;
    remember(&access, expires);
    refresh.ok_or_else(|| Error::Http("Spotify did not return a refresh token".into()))
}

fn meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM local_meta WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO local_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn save_account(conn: &Connection, refresh: &str) -> Result<()> {
    set_meta(conn, REFRESH_META, refresh)?;
    tracing::info!("Spotify connected");
    Ok(())
}

pub fn forget_account(conn: &Connection) -> Result<()> {
    conn.execute(
        "DELETE FROM local_meta WHERE key IN (?1, ?2)",
        params![REFRESH_META, NAME_META],
    )?;
    *ACCESS.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub configured: bool,
    pub connected: bool,
    /// Display name, once known.
    pub name: Option<String>,
    pub redirect_uri: &'static str,
}

pub fn status(conn: &Connection) -> Result<Status> {
    Ok(Status {
        configured: configured(),
        connected: meta(conn, REFRESH_META)?.is_some(),
        name: meta(conn, NAME_META)?.filter(|n| !n.is_empty()),
        redirect_uri: REDIRECT_URI,
    })
}

pub fn remember_name(conn: &Connection, name: &str) -> Result<()> {
    set_meta(conn, NAME_META, name)
}

/// The access token in memory, while it still works.
pub fn cached_access() -> Option<String> {
    ACCESS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .filter(|(_, until)| Instant::now() < *until)
        .map(|(token, _)| token)
}

pub fn refresh_token(conn: &Connection) -> Result<String> {
    meta(conn, REFRESH_META)?.ok_or_else(|| Error::Invalid("Spotify is not connected".into()))
}

/// Trades the refresh token for an access token (network only, no
/// database). Returns the new refresh token when Spotify rotated it.
pub fn refresh_access(refresh: &str) -> Result<(String, Option<String>)> {
    let resp = agent()
        .post(TOKEN_URL)
        .send_form([
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh),
            ("client_id", client_id()?.as_str()),
        ])
        .map_err(http_err)?;
    let (access, expires, rotated) = read_tokens(resp)?;
    remember(&access, expires);
    Ok((access, rotated))
}

/// Forgets the access token, e.g. after Spotify rejected it.
pub fn drop_access() {
    *ACCESS.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Calls the Web API. `path` starts with `/` (e.g. `/me/player`). Returns
/// `null` for empty responses (204, or 202 from player commands).
pub fn call(
    token: &str,
    method: &str,
    path: &str,
    body: Option<&JsonValue>,
) -> Result<(u16, JsonValue)> {
    if !path.starts_with('/') || path.contains("://") {
        return Err(Error::Invalid("bad Spotify path".into()));
    }
    // A dropped connection (Android cuts the network of apps in the
    // background, e.g. while Spotify is opened to wake it) is retried for a
    // moment; answers from Spotify, errors included, are not.
    let mut attempt = 0;
    loop {
        match call_once(token, method, path, body) {
            Err(Error::Http(e)) if attempt < 2 => {
                attempt += 1;
                tracing::info!(error = %e, attempt, "Spotify request failed; retrying");
                std::thread::sleep(Duration::from_millis(500 * attempt));
            }
            other => return other,
        }
    }
}

fn call_once(
    token: &str,
    method: &str,
    path: &str,
    body: Option<&JsonValue>,
) -> Result<(u16, JsonValue)> {
    let url = format!("{API_URL}{path}");
    let agent = agent();
    let auth = format!("Bearer {token}");
    let resp = match method {
        "GET" => agent.get(&url).header("Authorization", &auth).call(),
        "DELETE" => match body {
            Some(b) => agent
                .delete(&url)
                .header("Authorization", &auth)
                .force_send_body()
                .send_json(b),
            None => agent.delete(&url).header("Authorization", &auth).call(),
        },
        "PUT" | "POST" => {
            let req = if method == "PUT" {
                agent.put(&url)
            } else {
                agent.post(&url)
            }
            .header("Authorization", &auth);
            match body {
                Some(b) => req.send_json(b),
                None => req.header("Content-Length", "0").send_empty(),
            }
        }
        _ => return Err(Error::Invalid(format!("unsupported method {method}"))),
    };
    let mut resp = resp.map_err(http_err)?;
    let status = resp.status().as_u16();
    let text = resp.body_mut().read_to_string().unwrap_or_default();
    let json: JsonValue = if text.trim().is_empty() {
        JsonValue::Null
    } else {
        serde_json::from_str(&text).unwrap_or(JsonValue::String(text))
    };
    Ok((status, json))
}

/// The error a failed call becomes. 429 carries no body worth showing.
pub fn api_error(status: u16, body: &JsonValue) -> Error {
    let reason = body["error"]["reason"].as_str().unwrap_or("");
    let text =
        if status == 404 && (reason == "NO_ACTIVE_DEVICE" || message(body).contains("device")) {
            "No Spotify device is active. Open Spotify on your phone or laptop, then try again."
                .to_string()
        } else if status == 403 && reason == "PREMIUM_REQUIRED" {
            "Playback control needs Spotify Premium.".to_string()
        } else if status == 429 {
            "Spotify is rate limiting Kaizen; try again in a minute.".to_string()
        } else {
            format!("Spotify returned {status}: {}", message(body))
        };
    Error::Http(text)
}

/// One played track from recently played, as stored in `music_plays`.
#[derive(Debug, Clone, PartialEq)]
pub struct Play {
    pub id: String,
    pub played_at: i64,
    pub track_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub artist_ids: Vec<String>,
    pub album: String,
    pub album_id: String,
    pub image: Option<String>,
    pub duration_ms: i64,
    pub context: Option<String>,
}

/// Plays from a recently-played response, oldest first.
pub fn parse_recent(body: &JsonValue) -> Vec<Play> {
    let mut out: Vec<Play> = body["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let t = &item["track"];
            let track_id = t["id"].as_str()?.to_string();
            let played_at = chrono::DateTime::parse_from_rfc3339(item["played_at"].as_str()?)
                .ok()?
                .timestamp_millis();
            let artists = t["artists"].as_array().cloned().unwrap_or_default();
            let images = t["album"]["images"].as_array().cloned().unwrap_or_default();
            // The smallest image at least 250 px wide, else the largest.
            let image = images
                .iter()
                .filter(|i| i["width"].as_i64().unwrap_or(0) >= 250)
                .min_by_key(|i| i["width"].as_i64().unwrap_or(0))
                .or_else(|| images.first())
                .and_then(|i| i["url"].as_str())
                .map(str::to_string);
            Some(Play {
                id: format!("{played_at}:{track_id}"),
                played_at,
                title: t["name"].as_str().unwrap_or("").to_string(),
                artists: artists
                    .iter()
                    .filter_map(|a| a["name"].as_str().map(str::to_string))
                    .collect(),
                artist_ids: artists
                    .iter()
                    .filter_map(|a| a["id"].as_str().map(str::to_string))
                    .collect(),
                album: t["album"]["name"].as_str().unwrap_or("").to_string(),
                album_id: t["album"]["id"].as_str().unwrap_or("").to_string(),
                image,
                duration_ms: t["duration_ms"].as_i64().unwrap_or(0),
                context: item["context"]["uri"].as_str().map(str::to_string),
                track_id,
            })
        })
        .collect();
    out.sort_by_key(|p| p.played_at);
    out
}

/// Stores new plays (both devices may store the same ones; ids match) and
/// moves the `after` cursor. Returns how many were new.
pub fn store_plays(conn: &Connection, plays: &[Play], device: &str) -> Result<usize> {
    let now = chrono::Utc::now().timestamp_millis();
    let mut added = 0;
    for p in plays {
        added += conn.execute(
            "INSERT INTO music_plays (id, played_at, track_id, title, artists, artist_ids, album, album_id, image, duration_ms, context, created_at, updated_at, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13)
             ON CONFLICT (id) DO NOTHING",
            params![
                p.id,
                p.played_at,
                p.track_id,
                p.title,
                json!(p.artists).to_string(),
                json!(p.artist_ids).to_string(),
                p.album,
                p.album_id,
                p.image,
                p.duration_ms,
                p.context,
                now,
                device
            ],
        )?;
    }
    if let Some(last) = plays.iter().map(|p| p.played_at).max() {
        set_meta(conn, HISTORY_META, &last.to_string())?;
    }
    Ok(added)
}

/// Where the next recently-played fetch starts (ms), if any.
pub fn history_after(conn: &Connection) -> Result<Option<i64>> {
    Ok(meta(conn, HISTORY_META)?.and_then(|v| v.parse().ok()))
}
