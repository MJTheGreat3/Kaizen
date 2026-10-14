//! Notifications after games: a followed team's result, and a favourite
//! player's performance. Each is announced once per device, unless muted
//! (synced `sport_mutes`) or turned off in this device's settings.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use super::{Follow, Game, LastGame, Sport};
use crate::error::Result;

/// Kotlin's Mute button writes here (one `id\ttitle` per line) so it needs
/// no unlocked database; [`apply_pending_mutes`] moves them into the table.
pub const PENDING_MUTES: &str = "pending-mutes";

/// Only games and performances this recent are announced.
const FRESH_MS: i64 = 36 * 3_600_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    /// Once per device: `result:{sport}:{game}` or `perf:{follow}:{game}`.
    pub key: String,
    pub title: String,
    pub body: String,
    /// What the notification's Mute button mutes.
    pub mute_id: Option<String>,
    pub url: Option<String>,
}

pub fn game_mute_id(sport: Sport, game: &str) -> String {
    format!("game:{}:{game}", sport.id())
}

pub fn follow_mute_id(follow: &str) -> String {
    format!("follow:{follow}")
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// "IND 172 v WI 158/7 & 20/1".
fn scoreline(g: &Game) -> String {
    let side = |s: &super::Side| {
        let name = if s.short.is_empty() {
            &s.name
        } else {
            &s.short
        };
        match &s.score {
            Some(score) => format!("{name} {score}"),
            None => name.clone(),
        }
    };
    format!("{} v {}", side(&g.home), side(&g.away))
}

pub fn result_alert(follow: &Follow, g: &Game) -> Alert {
    let (title, body) = if follow.sport == Sport::Cricket {
        (
            g.status.clone(),
            [Some(scoreline(g)), g.title.clone(), g.league.clone()],
        )
    } else {
        let score = |s: &super::Side| s.score.clone().unwrap_or_default();
        (
            format!(
                "{} {}–{} {}",
                g.home.name,
                score(&g.home),
                score(&g.away),
                g.away.name
            ),
            [g.title.clone(), g.league.clone(), None],
        )
    };
    Alert {
        key: format!("result:{}:{}", follow.sport.id(), g.id),
        title,
        body: body
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · "),
        mute_id: Some(follow_mute_id(&follow.id)),
        url: g.url.clone(),
    }
}

pub fn performance_alert(follow: &Follow, name: &str, game: &LastGame) -> Alert {
    Alert {
        key: format!("perf:{}:{}", follow.id, game.id),
        title: format!("{name}: {}", game.line),
        body: game.game.clone(),
        mute_id: Some(follow_mute_id(&follow.id)),
        url: game.url.clone(),
    }
}

/// Whether a game finished recently enough to announce.
pub fn fresh(at: i64) -> bool {
    at > now_ms() - FRESH_MS
}

fn pref_on(conn: &Connection, key: &str) -> Result<bool> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM local_meta WHERE key = ?1",
            [format!("pref.{key}")],
            |r| r.get(0),
        )
        .optional()?;
    Ok(value.as_deref() != Some("false"))
}

fn muted(conn: &Connection, ids: &[String]) -> Result<bool> {
    for id in ids {
        let hit: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM sport_mutes WHERE id = ?1 AND deleted_at IS NULL",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        if hit.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Records an alert as handled; false when it already was.
fn claim(conn: &Connection, key: &str) -> Result<bool> {
    Ok(conn.execute(
        "INSERT OR IGNORE INTO sport_alerts (key, at) VALUES (?1, ?2)",
        params![key, now_ms()],
    )? > 0)
}

/// Keeps the alerts to show: not yet announced on this device, not muted
/// (by any of `mutes`), and their kind (`notify.results` or
/// `notify.performances`) turned on.
pub fn keep(
    conn: &Connection,
    alert: Alert,
    mutes: &[String],
    pref: &str,
) -> Result<Option<Alert>> {
    if !claim(conn, &alert.key)? || !pref_on(conn, pref)? || muted(conn, mutes)? {
        return Ok(None);
    }
    Ok(Some(alert))
}

/// Mutes a game or follow (synced). Unmuting soft-deletes the row.
pub fn set_muted(conn: &Connection, id: &str, title: Option<&str>, on: bool) -> Result<()> {
    let now = now_ms();
    if on {
        conn.execute(
            "INSERT INTO sport_mutes (id, title, created_at, updated_at, device_id)
             VALUES (?1, ?2, ?3, ?3, (SELECT value FROM local_meta WHERE key = 'device_id'))
             ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, title = coalesce(excluded.title, title), updated_at = excluded.updated_at
             WHERE deleted_at IS NOT NULL",
            params![id, title, now],
        )?;
    } else {
        conn.execute(
            "UPDATE sport_mutes SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
    }
    Ok(())
}

/// Moves mutes tapped in notifications into the database.
pub fn apply_pending_mutes(conn: &Connection, data_dir: &Path) -> Result<usize> {
    let path = data_dir.join(PENDING_MUTES);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(0);
    };
    let mut n = 0;
    for line in text.lines() {
        let (id, title) = line.split_once('\t').unwrap_or((line, ""));
        if !id.is_empty() {
            set_muted(conn, id, (!title.is_empty()).then_some(title), true)?;
            n += 1;
        }
    }
    std::fs::remove_file(path)?;
    Ok(n)
}
