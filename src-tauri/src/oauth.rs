//! Pieces shared by the OAuth sign-ins (Google Drive, Spotify): PKCE
//! values and waiting for the browser to bring the code back to a loopback
//! listener on 127.0.0.1.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngCore;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(600);

pub fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// The PKCE challenge for a verifier.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn page(title: &str, text: &str) -> String {
    format!(
        "<!doctype html><meta name=viewport content='width=device-width'><title>Kaizen</title>\
<body style='font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0'>\
<div style='text-align:center'><h2>{title}</h2><p>{text}</p></div>"
    )
}

/// Waits (blocking) for the browser to come back to `listener` with `state`
/// and returns the authorisation code. `service` names the account in the
/// page shown when it does.
pub fn wait_for_code(listener: &TcpListener, state: &str, service: &str) -> Result<String> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err(Error::Invalid("sign-in timed out".into()));
        }
        let (mut stream, _) = match listener.accept() {
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
        let body = if param("code").is_some() {
            page(
                &format!("Kaizen is connected to {service}"),
                "You can close this tab and go back to the app.",
            )
        } else {
            page("Sign-in was cancelled", "You can close this tab.")
        };
        let _ = stream.write_all(
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes(),
        );
        if param("state").as_deref() != Some(state) {
            return Err(Error::Invalid("sign-in response did not match".into()));
        }
        return match param("code") {
            Some(code) => Ok(code),
            None => Err(Error::Invalid(format!(
                "sign-in failed: {}",
                param("error").unwrap_or_default()
            ))),
        };
    }
}
