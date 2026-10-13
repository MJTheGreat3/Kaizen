//! Google Drive transport: bundles live in the hidden app-data folder of a
//! dedicated Google account (scope `drive.appdata`, so Kaizen cannot see any
//! other file). Each file is tagged with its group and device in
//! `appProperties`.
//!
//! Sign-in uses OAuth with PKCE and a loopback redirect on every platform:
//! the system browser sends the code back to a one-off listener on
//! 127.0.0.1. The OAuth client (a Google Cloud "Desktop app" client) is
//! supplied at build time through `KAIZEN_GOOGLE_CLIENT_ID` and
//! `KAIZEN_GOOGLE_CLIENT_SECRET`; for installed apps the "secret" is not
//! confidential, but it is kept out of the repository anyway.

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngCore;
use rand::rngs::OsRng;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value as JsonValue, json};
use sha2::{Digest, Sha256};

use super::mailbox::Mailbox;
use crate::error::{Error, Result};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const SCOPES: &str = "openid email https://www.googleapis.com/auth/drive.appdata";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(600);

const REFRESH_META: &str = "sync.drive.refresh";
const EMAIL_META: &str = "sync.drive.email";

struct Client {
    id: &'static str,
    secret: &'static str,
}

fn client() -> Result<Client> {
    match (
        option_env!("KAIZEN_GOOGLE_CLIENT_ID"),
        option_env!("KAIZEN_GOOGLE_CLIENT_SECRET"),
    ) {
        (Some(id), Some(secret)) if !id.is_empty() => Ok(Client { id, secret }),
        _ => Err(Error::Invalid(
            "Google Drive sync is not configured in this build".into(),
        )),
    }
}

pub fn configured() -> bool {
    client().is_ok()
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(60)))
        .http_status_as_error(false)
        .build()
        .into()
}

fn http_err(e: ureq::Error) -> Error {
    Error::Http(e.to_string())
}

/// Reads a JSON response, turning error statuses into errors with Google's message.
fn json_response(mut resp: ureq::http::Response<ureq::Body>) -> Result<JsonValue> {
    let status = resp.status();
    let body: JsonValue = resp.body_mut().read_json().unwrap_or(JsonValue::Null);
    if !status.is_success() {
        let message = body["error_description"]
            .as_str()
            .or_else(|| body["error"]["message"].as_str())
            .or_else(|| body["error"].as_str())
            .unwrap_or("request failed");
        return Err(Error::Http(format!(
            "Google returned {}: {message}",
            status.as_u16()
        )));
    }
    Ok(body)
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Email from an ID token's payload (already trusted: it came straight from
/// Google's token endpoint over TLS).
fn email_from_id_token(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let claims: JsonValue = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    claims["email"].as_str().map(str::to_string)
}

/// A started sign-in: open `url` in the browser, then call [`finish_sign_in`].
pub struct SignIn {
    pub url: String,
    listener: TcpListener,
    redirect_uri: String,
    verifier: String,
    state: String,
}

pub fn start_sign_in() -> Result<SignIn> {
    let client = client()?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let redirect_uri = format!("http://127.0.0.1:{}", listener.local_addr()?.port());
    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_token();
    let url = format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={challenge}&code_challenge_method=S256&access_type=offline&prompt=consent&state={state}",
        percent_encode(client.id),
        percent_encode(&redirect_uri),
        percent_encode(SCOPES),
    );
    Ok(SignIn {
        url,
        listener,
        redirect_uri,
        verifier,
        state,
    })
}

const DONE_PAGE: &str = "<!doctype html><meta name=viewport content='width=device-width'><title>Kaizen</title>\
<body style='font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0'>\
<div style='text-align:center'><h2>Kaizen is connected</h2><p>You can close this tab and go back to the app.</p></div>";

/// Waits for the browser to come back with the code (blocking), then trades
/// it for tokens. Returns `(refresh_token, email)`.
pub fn finish_sign_in(sign_in: SignIn) -> Result<(String, Option<String>)> {
    let client = client()?;
    sign_in.listener.set_nonblocking(true)?;
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    let code = loop {
        if Instant::now() > deadline {
            return Err(Error::Invalid("sign-in timed out".into()));
        }
        let (mut stream, _) = match sign_in.listener.accept() {
            Ok(conn) => conn,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.split_whitespace().nth(1).unwrap_or("");
        let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
        let param = |name: &str| {
            query.split('&').find_map(|pair| {
                let (k, v) = pair.split_once('=')?;
                (k == name).then(|| v.to_string())
            })
        };
        // Browsers also ask for /favicon.ico and the like.
        if param("state").is_none() {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            continue;
        }
        let page = if param("code").is_some() {
            DONE_PAGE
        } else {
            "Sign-in was cancelled. You can close this tab."
        };
        let _ = stream.write_all(
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes(),
        );
        if param("state").as_deref() != Some(sign_in.state.as_str()) {
            return Err(Error::Invalid("sign-in response did not match".into()));
        }
        match param("code") {
            Some(code) => break code,
            None => {
                return Err(Error::Invalid(format!(
                    "sign-in failed: {}",
                    param("error").unwrap_or_default()
                )));
            }
        }
    };

    // The browser hands the code back while it is still in front, and
    // Android blocks network access for background apps; keep trying until
    // the user switches back to Kaizen (the code stays valid ~10 minutes).
    let agent = agent();
    let retry_until = Instant::now() + Duration::from_secs(300);
    let resp = loop {
        let attempt = agent.post(TOKEN_URL).send_form([
            ("code", code.as_str()),
            ("client_id", client.id),
            ("client_secret", client.secret),
            ("redirect_uri", sign_in.redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", sign_in.verifier.as_str()),
        ]);
        match attempt {
            Ok(resp) => break resp,
            Err(e) if Instant::now() < retry_until => {
                tracing::info!(error = %e, "token exchange not possible yet; retrying");
                std::thread::sleep(Duration::from_secs(2));
            }
            Err(e) => return Err(http_err(e)),
        }
    };
    let body = json_response(resp)?;
    let refresh = body["refresh_token"]
        .as_str()
        .ok_or_else(|| Error::Http("Google did not return a refresh token".into()))?
        .to_string();
    let email = body["id_token"].as_str().and_then(email_from_id_token);
    Ok((refresh, email))
}

pub fn save_account(conn: &Connection, refresh: &str, email: Option<&str>) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO local_meta (key, value) VALUES (?1, ?2)",
        params![REFRESH_META, refresh],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO local_meta (key, value) VALUES (?1, ?2)",
        params![EMAIL_META, email.unwrap_or("")],
    )?;
    tracing::info!("Google Drive connected");
    Ok(())
}

pub fn forget_account(conn: &Connection) -> Result<()> {
    conn.execute(
        "DELETE FROM local_meta WHERE key IN (?1, ?2)",
        params![REFRESH_META, EMAIL_META],
    )?;
    conn.execute(
        "DELETE FROM local_meta WHERE key LIKE 'sync.sent.drive.%'",
        [],
    )?;
    Ok(())
}

pub fn refresh_token(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM local_meta WHERE key = ?1",
            [REFRESH_META],
            |r| r.get(0),
        )
        .optional()?)
}

/// `Some(email)` (possibly empty) when an account is connected.
pub fn account(conn: &Connection) -> Result<Option<String>> {
    if refresh_token(conn)?.is_none() {
        return Ok(None);
    }
    Ok(Some(
        conn.query_row(
            "SELECT value FROM local_meta WHERE key = ?1",
            [EMAIL_META],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_default(),
    ))
}

#[derive(Debug, Clone, Deserialize)]
struct DriveFile {
    id: String,
    name: String,
    #[serde(rename = "appProperties", default)]
    props: std::collections::HashMap<String, String>,
}

pub struct DriveMailbox {
    agent: ureq::Agent,
    access_token: String,
    /// Group listing, fetched once per sync round.
    listing: RefCell<Option<(String, Vec<DriveFile>)>>,
}

impl DriveMailbox {
    /// Exchanges the stored refresh token for a fresh access token.
    pub fn connect(refresh: &str) -> Result<Self> {
        let client = client()?;
        let agent = agent();
        let resp = agent
            .post(TOKEN_URL)
            .send_form([
                ("refresh_token", refresh),
                ("client_id", client.id),
                ("client_secret", client.secret),
                ("grant_type", "refresh_token"),
            ])
            .map_err(http_err)?;
        let body = json_response(resp).map_err(|e| match e {
            Error::Http(m)
                if m.contains("invalid_grant")
                    || m.contains("expired")
                    || m.contains("revoked") =>
            {
                Error::Http("Google sign-in expired; connect Google Drive again".into())
            }
            other => other,
        })?;
        let access_token = body["access_token"]
            .as_str()
            .ok_or_else(|| Error::Http("Google did not return an access token".into()))?
            .to_string();
        Ok(Self {
            agent,
            access_token,
            listing: RefCell::new(None),
        })
    }

    fn auth(&self) -> String {
        format!("Bearer {}", self.access_token)
    }

    fn files(&self, group: &str) -> Result<Vec<DriveFile>> {
        if let Some((cached, files)) = self.listing.borrow().as_ref()
            && cached == group
        {
            return Ok(files.clone());
        }
        let query = format!(
            "appProperties has {{ key='kz_group' and value='{group}' }} and trashed = false"
        );
        let mut files = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut req = self
                .agent
                .get(FILES_URL)
                .header("Authorization", &self.auth())
                .query("spaces", "appDataFolder")
                .query("q", &query)
                .query("pageSize", "1000")
                .query("fields", "nextPageToken,files(id,name,appProperties)");
            if let Some(token) = &page {
                req = req.query("pageToken", token);
            }
            let body = json_response(req.call().map_err(http_err)?)?;
            let batch: Vec<DriveFile> = serde_json::from_value(body["files"].clone())?;
            files.extend(batch);
            match body["nextPageToken"].as_str() {
                Some(token) => page = Some(token.to_string()),
                None => break,
            }
        }
        *self.listing.borrow_mut() = Some((group.to_string(), files.clone()));
        Ok(files)
    }
}

impl Mailbox for DriveMailbox {
    fn name(&self) -> &str {
        "drive"
    }

    fn devices(&self, group: &str) -> Result<Vec<String>> {
        // A new round: list again.
        self.listing.borrow_mut().take();
        let devices: BTreeSet<String> = self
            .files(group)?
            .into_iter()
            .filter_map(|f| f.props.get("kz_device").cloned())
            .collect();
        Ok(devices.into_iter().collect())
    }

    fn list(&self, group: &str, device: &str) -> Result<Vec<String>> {
        Ok(self
            .files(group)?
            .into_iter()
            .filter(|f| f.props.get("kz_device").map(String::as_str) == Some(device))
            .map(|f| f.name)
            .collect())
    }

    fn get(&self, group: &str, device: &str, file: &str) -> Result<Vec<u8>> {
        let found = self
            .files(group)?
            .into_iter()
            .find(|f| {
                f.name == file && f.props.get("kz_device").map(String::as_str) == Some(device)
            })
            .ok_or_else(|| Error::Invalid(format!("{file} is no longer in Drive")))?;
        let mut resp = self
            .agent
            .get(&format!("{FILES_URL}/{}", found.id))
            .header("Authorization", &self.auth())
            .query("alt", "media")
            .call()
            .map_err(http_err)?;
        if !resp.status().is_success() {
            return Err(Error::Http(format!(
                "download failed ({})",
                resp.status().as_u16()
            )));
        }
        resp.body_mut()
            .with_config()
            .limit(64 * 1024 * 1024)
            .read_to_vec()
            .map_err(http_err)
    }

    fn put(&self, group: &str, device: &str, file: &str, bytes: &[u8]) -> Result<()> {
        let boundary = format!("kaizen-{}", random_token());
        let metadata = json!({
            "name": file,
            "parents": ["appDataFolder"],
            "appProperties": { "kz_group": group, "kz_device": device },
        });
        let mut body = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .into_bytes();
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let resp = self
            .agent
            .post(UPLOAD_URL)
            .header("Authorization", &self.auth())
            .content_type(&format!("multipart/related; boundary={boundary}"))
            .send(&body[..])
            .map_err(http_err)?;
        json_response(resp)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_reads_tokens() {
        assert_eq!(percent_encode("a b/c:d"), "a%20b%2Fc%3Ad");
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"me@example.com"}"#);
        assert_eq!(
            email_from_id_token(&format!("h.{payload}.s")).as_deref(),
            Some("me@example.com")
        );
    }
}
