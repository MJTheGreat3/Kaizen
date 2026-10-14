//! Lyrics from LRCLIB (lrclib.net), an open database of synced (LRC) and
//! plain lyrics; Spotify's own lyrics are not available to other apps.
//! Results, including "none found", are cached per device in `lyrics`.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::error::{Error, Result};
use crate::oauth::percent_encode;

const API: &str = "https://lrclib.net/api";
/// "None found" is asked again after this long.
const RETRY_MISSING_MS: i64 = 7 * 86_400_000;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// LRC text (`[mm:ss.xx] line`), when timed lyrics exist.
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub instrumental: bool,
}

impl Lyrics {
    fn found(&self) -> bool {
        self.synced.is_some() || self.plain.is_some() || self.instrumental
    }
}

pub struct Query<'a> {
    pub track: &'a str,
    pub artist: &'a str,
    pub album: &'a str,
    pub duration_ms: i64,
}

fn key(q: &Query) -> String {
    format!(
        "{}|{}|{}",
        q.artist.to_lowercase(),
        q.track.to_lowercase(),
        q.duration_ms / 1000
    )
}

fn text(v: &JsonValue) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn from_record(v: &JsonValue) -> Lyrics {
    Lyrics {
        synced: text(&v["syncedLyrics"]),
        plain: text(&v["plainLyrics"]),
        instrumental: v["instrumental"].as_bool().unwrap_or(false),
    }
}

/// The best search result: within 4 s of the track's length, preferring
/// timed lyrics.
pub fn best_match(results: &JsonValue, duration_ms: i64) -> Option<Lyrics> {
    let secs = duration_ms as f64 / 1000.0;
    results
        .as_array()?
        .iter()
        .filter(|r| (r["duration"].as_f64().unwrap_or(0.0) - secs).abs() <= 4.0)
        .map(from_record)
        .filter(Lyrics::found)
        .max_by_key(|l| (l.synced.is_some(), l.plain.is_some()))
}

fn get_json(url: &str) -> Result<Option<JsonValue>> {
    let mut resp = super::agent()
        .get(url)
        .call()
        .map_err(|e| Error::Http(e.to_string()))?;
    match resp.status().as_u16() {
        404 => Ok(None),
        s if (200..300).contains(&s) => Ok(Some(
            resp.body_mut()
                .read_json()
                .map_err(|e| Error::Http(e.to_string()))?,
        )),
        s => Err(Error::Http(format!("LRCLIB returned {s}"))),
    }
}

fn fetch(q: &Query) -> Result<Lyrics> {
    let exact = format!(
        "{API}/get?track_name={}&artist_name={}&album_name={}&duration={}",
        percent_encode(q.track),
        percent_encode(q.artist),
        percent_encode(q.album),
        (q.duration_ms + 500) / 1000
    );
    if let Some(v) = get_json(&exact)? {
        let l = from_record(&v);
        if l.found() {
            return Ok(l);
        }
    }
    let search = format!(
        "{API}/search?track_name={}&artist_name={}",
        percent_encode(q.track),
        percent_encode(q.artist)
    );
    Ok(get_json(&search)?
        .and_then(|v| best_match(&v, q.duration_ms))
        .unwrap_or_default())
}

pub fn cached(conn: &Connection, q: &Query, now: i64) -> Result<Option<Lyrics>> {
    let row: Option<(Option<String>, Option<String>, bool, i64)> = conn
        .query_row(
            "SELECT synced, plain, instrumental, at FROM lyrics WHERE key = ?1",
            [key(q)],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    Ok(row.and_then(|(synced, plain, instrumental, at)| {
        let l = Lyrics {
            synced,
            plain,
            instrumental,
        };
        (l.found() || now - at < RETRY_MISSING_MS).then_some(l)
    }))
}

pub fn store(conn: &Connection, q: &Query, l: &Lyrics, now: i64) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO lyrics (key, synced, plain, instrumental, at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![key(q), l.synced, l.plain, l.instrumental, now],
    )?;
    Ok(())
}

/// Network part only, for callers that hold no database lock meanwhile.
pub fn lookup(q: &Query) -> Result<Lyrics> {
    fetch(q)
}
