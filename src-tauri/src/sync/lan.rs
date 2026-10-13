//! Direct transport over the local network or a tailnet (Tailscale).
//!
//! The laptop keeps a mailbox folder and serves it over HTTP on
//! [`PORT`]; it syncs with that folder directly, and the phone syncs with it
//! through [`HttpMailbox`] whenever it can reach the laptop (same Wi-Fi,
//! hotspot, or Tailscale). Bundles are already encrypted and authenticated;
//! requests also carry a token derived from the sync key so strangers on the
//! network cannot list or add files. Plain HTTP means someone on the same
//! network could see that token and the encrypted bundles, but never read
//! them.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use blake2::{Blake2s256, Digest};

use super::bundle::SyncKey;
use super::mailbox::{FolderMailbox, Mailbox};
use crate::error::{Error, Result};

pub const PORT: u16 = 47913;
const MAX_BUNDLE: usize = 32 * 1024 * 1024;
const AUTH_HEADER: &str = "x-kaizen-auth";

/// Where the laptop keeps the bundles it serves.
pub fn store_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("lan-mailbox")
}

pub fn auth_token(key: &SyncKey) -> String {
    let mut hasher = Blake2s256::new();
    hasher.update(b"kaizen-lan-auth");
    hasher.update(key.as_ref());
    hex::encode(&hasher.finalize()[..16])
}

/// Ids and bundle names only ever contain these characters.
fn safe_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && !s.starts_with('.')
}

/// The laptop's own side: the served folder, under the same name as the
/// phone's client so both count as the same mailbox.
pub struct LocalStore(pub FolderMailbox);

impl Mailbox for LocalStore {
    fn name(&self) -> &str {
        "lan"
    }
    fn devices(&self, group: &str) -> Result<Vec<String>> {
        self.0.devices(group)
    }
    fn list(&self, group: &str, device: &str) -> Result<Vec<String>> {
        self.0.list(group, device)
    }
    fn get(&self, group: &str, device: &str, file: &str) -> Result<Vec<u8>> {
        self.0.get(group, device, file)
    }
    fn put(&self, group: &str, device: &str, file: &str, bytes: &[u8]) -> Result<()> {
        self.0.put(group, device, file, bytes)
    }
}

/// Serves the store folder until the process exits. `auth` returns the
/// expected `(group, token)` while unlocked and paired.
pub fn serve(store: PathBuf, auth: impl Fn() -> Option<(String, String)> + Send + 'static) {
    let server = match tiny_http::Server::http(("0.0.0.0", PORT)) {
        Ok(server) => server,
        Err(e) => {
            tracing::warn!(error = %e, port = PORT, "LAN sync server not started");
            return;
        }
    };
    tracing::info!(port = PORT, "LAN sync server listening");
    serve_on(server, store, auth);
}

pub(crate) fn serve_on(
    server: tiny_http::Server,
    store: PathBuf,
    auth: impl Fn() -> Option<(String, String)>,
) {
    let folder = FolderMailbox { root: store };
    for mut request in server.incoming_requests() {
        let response = handle(&folder, &auth, &mut request);
        let (status, body, json) = match response {
            Ok((body, json)) => (200, body, json),
            Err((status, message)) => (status, message.into_bytes(), false),
        };
        let mut resp = tiny_http::Response::from_data(body).with_status_code(status);
        if json {
            resp.add_header(
                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .unwrap(),
            );
        }
        let _ = request.respond(resp);
    }
}

type Handled = std::result::Result<(Vec<u8>, bool), (u16, String)>;

fn handle(
    folder: &FolderMailbox,
    auth: &impl Fn() -> Option<(String, String)>,
    request: &mut tiny_http::Request,
) -> Handled {
    let url = request.url().to_string();
    let path: Vec<&str> = url.trim_start_matches('/').split('/').collect();
    if path == ["v1", "ping"] {
        return Ok((b"kaizen".to_vec(), false));
    }
    let Some((group, token)) = auth() else {
        return Err((503, "not available".into()));
    };
    let given = request
        .headers()
        .iter()
        .find(|h| h.field.equiv(AUTH_HEADER))
        .map(|h| h.value.as_str().to_string())
        .unwrap_or_default();
    let matches = given.len() == token.len()
        && given
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0;
    if !matches {
        return Err((401, "unauthorised".into()));
    }
    if path.len() < 2
        || path[0] != "v1"
        || path[1] != group
        || !path.iter().skip(1).all(|s| safe_segment(s))
    {
        return Err((404, "not found".into()));
    }
    let internal = |e: Error| (500, e.to_string());
    let json = |v: Vec<String>| {
        serde_json::to_vec(&v)
            .map(|b| (b, true))
            .map_err(|e| (500, e.to_string()))
    };
    match (request.method(), &path[2..]) {
        (tiny_http::Method::Get, ["devices"]) => json(folder.devices(&group).map_err(internal)?),
        (tiny_http::Method::Get, [device]) => json(folder.list(&group, device).map_err(internal)?),
        (tiny_http::Method::Get, [device, file]) => Ok((
            folder
                .get(&group, device, file)
                .map_err(|_| (404, "not found".to_string()))?,
            false,
        )),
        (tiny_http::Method::Put, [device, file]) if file.ends_with(".kzb") => {
            if request.body_length().unwrap_or(0) > MAX_BUNDLE {
                return Err((413, "too large".into()));
            }
            let mut body = Vec::new();
            request
                .as_reader()
                .take(MAX_BUNDLE as u64 + 1)
                .read_to_end(&mut body)
                .map_err(|e| (400, e.to_string()))?;
            if body.len() > MAX_BUNDLE {
                return Err((413, "too large".into()));
            }
            folder.put(&group, device, file, &body).map_err(internal)?;
            Ok((Vec::new(), false))
        }
        _ => Err((404, "not found".into())),
    }
}

/// The phone's side: the laptop's store over HTTP.
pub struct HttpMailbox {
    agent: ureq::Agent,
    base: String,
    token: String,
}

impl HttpMailbox {
    /// `host` is an IP address or name, optionally with `:port`.
    pub fn new(host: &str, key: &SyncKey) -> Self {
        let host = host
            .trim()
            .trim_start_matches("http://")
            .trim_end_matches('/');
        let base = if host.contains(':') && !host.starts_with('[') && host.matches(':').count() == 1
        {
            format!("http://{host}")
        } else {
            format!("http://{host}:{PORT}")
        };
        let agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(3)))
            .timeout_global(Some(Duration::from_secs(60)))
            .http_status_as_error(false)
            .build()
            .into();
        Self {
            agent,
            base,
            token: auth_token(key),
        }
    }

    /// True if a Kaizen laptop answers at this address.
    pub fn reachable(&self) -> bool {
        self.agent
            .get(&format!("{}/v1/ping", self.base))
            .config()
            .timeout_global(Some(Duration::from_secs(3)))
            .build()
            .call()
            .map(|mut r| {
                r.status().is_success()
                    && r.body_mut()
                        .read_to_string()
                        .map(|b| b == "kaizen")
                        .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    fn fetch(&self, path: &str) -> Result<Vec<u8>> {
        let mut resp = self
            .agent
            .get(&format!("{}/v1/{path}", self.base))
            .header(AUTH_HEADER, &self.token)
            .call()
            .map_err(|e| Error::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        let body = resp
            .body_mut()
            .with_config()
            .limit(MAX_BUNDLE as u64)
            .read_to_vec()
            .map_err(|e| Error::Http(e.to_string()))?;
        match status {
            200 => Ok(body),
            401 => Err(Error::Http(
                "the laptop is paired with a different sync group".into(),
            )),
            503 => Err(Error::Http(
                "Kaizen on the laptop is locked or not paired".into(),
            )),
            other => Err(Error::Http(format!("laptop returned {other}"))),
        }
    }
}

impl Mailbox for HttpMailbox {
    fn name(&self) -> &str {
        "lan"
    }

    fn devices(&self, group: &str) -> Result<Vec<String>> {
        Ok(serde_json::from_slice(
            &self.fetch(&format!("{group}/devices"))?,
        )?)
    }

    fn list(&self, group: &str, device: &str) -> Result<Vec<String>> {
        Ok(serde_json::from_slice(
            &self.fetch(&format!("{group}/{device}"))?,
        )?)
    }

    fn get(&self, group: &str, device: &str, file: &str) -> Result<Vec<u8>> {
        self.fetch(&format!("{group}/{device}/{file}"))
    }

    fn put(&self, group: &str, device: &str, file: &str, bytes: &[u8]) -> Result<()> {
        let resp = self
            .agent
            .put(&format!("{}/v1/{group}/{device}/{file}", self.base))
            .header(AUTH_HEADER, &self.token)
            .send(bytes)
            .map_err(|e| Error::Http(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(Error::Http(format!(
                "upload to laptop failed ({})",
                resp.status().as_u16()
            )));
        }
        Ok(())
    }
}

/// This machine's IPv4 addresses worth typing into the phone (LAN and
/// Tailscale), loopback excluded.
#[cfg(desktop)]
pub fn local_addresses() -> Vec<String> {
    let mut out: Vec<String> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(ip) if !ip.is_link_local() => Some(ip.to_string()),
            _ => None,
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_path_segments() {
        assert!(safe_segment("019a1b2c-3d4e-7f00-8000-000000000000"));
        assert!(safe_segment("000000000001-000000000009.kzb"));
        assert!(!safe_segment(".."));
        assert!(!safe_segment("a/b"));
        assert!(!safe_segment(""));
    }
}
