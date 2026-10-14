//! Competitive programming: fetching solves, ratings and upcoming contests
//! from Codeforces, LeetCode, AtCoder and CodeChef, and storing them.
//!
//! Each platform adapter turns the site's data into the same shapes: the
//! account (rating, rank, totals), submissions newer than a cursor, rating
//! history and upcoming contests. [`store`] merges submissions into one row
//! per problem and records a `cp` activity event for each first solve, so
//! fetching the same history twice (or on two devices) changes nothing.
//!
//! The sites are reached without logging in, so only public data is used.
//! LeetCode and CodeChef have no official API; their adapters read what the
//! websites themselves use and fail with a readable error when that changes.

pub mod atcoder;
pub mod codechef;
pub mod codeforces;
pub mod http;
pub mod leetcode;

use std::collections::{HashMap, HashSet};

use chrono::{Local, TimeZone};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::error::{Error, Result};
use http::Http;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Platform {
    Codeforces,
    LeetCode,
    AtCoder,
    CodeChef,
}

impl Platform {
    pub const ALL: [Platform; 4] = [
        Platform::Codeforces,
        Platform::LeetCode,
        Platform::AtCoder,
        Platform::CodeChef,
    ];

    /// The account id and `cp_problems.platform` value.
    pub fn id(self) -> &'static str {
        match self {
            Platform::Codeforces => "codeforces",
            Platform::LeetCode => "leetcode",
            Platform::AtCoder => "atcoder",
            Platform::CodeChef => "codechef",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.id() == id)
    }

    /// Prefix of problem ids, e.g. `cf:1520A`.
    fn prefix(self) -> &'static str {
        match self {
            Platform::Codeforces => "cf",
            Platform::LeetCode => "lc",
            Platform::AtCoder => "ac",
            Platform::CodeChef => "cc",
        }
    }

    pub fn problem_id(self, code: &str) -> String {
        format!("{}:{code}", self.prefix())
    }

    pub fn fetch(
        self,
        http: &Http,
        handle: &str,
        cursor: i64,
        known: &HashSet<String>,
    ) -> Result<Fetched> {
        match self {
            Platform::Codeforces => codeforces::fetch(http, handle, cursor),
            Platform::LeetCode => leetcode::fetch(http, handle, cursor, known),
            Platform::AtCoder => atcoder::fetch(http, handle, cursor),
            Platform::CodeChef => codechef::fetch(http, handle, cursor),
        }
    }

    pub fn upcoming(self, http: &Http) -> Result<Vec<Contest>> {
        match self {
            Platform::Codeforces => codeforces::upcoming(http),
            Platform::LeetCode => leetcode::upcoming(http),
            Platform::AtCoder => atcoder::upcoming(http),
            Platform::CodeChef => codechef::upcoming(http),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct AccountInfo {
    pub rating: Option<f64>,
    pub max_rating: Option<f64>,
    pub rank_title: Option<String>,
    /// Solved count reported by the site; when `None` it is counted from
    /// the stored problems (sites whose full history we read).
    pub solved: Option<i64>,
    pub contests: i64,
    pub meta: JsonValue,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ProblemInfo {
    /// The platform's own id, e.g. `1520A`, `two-sum`, `abc300_a`.
    pub code: String,
    pub name: String,
    pub url: Option<String>,
    pub rating: Option<f64>,
    pub difficulty: Option<String>,
    pub tags: Vec<String>,
    pub contest_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Submission {
    pub problem: ProblemInfo,
    /// Milliseconds since the epoch.
    pub at: i64,
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RatingPoint {
    pub contest: String,
    pub at: i64,
    pub rating: f64,
    pub rank: Option<i64>,
}

#[derive(Debug, Default)]
pub struct Fetched {
    pub account: AccountInfo,
    /// Submissions newer than the cursor that was passed in.
    pub submissions: Vec<Submission>,
    pub ratings: Vec<RatingPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Contest {
    pub code: String,
    pub name: String,
    pub url: String,
    pub start_at: i64,
    pub duration_min: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshReport {
    pub platform: &'static str,
    pub new_solves: usize,
    pub error: Option<String>,
}

/// Accounts to refresh: platform, handle and cursor.
pub fn accounts(conn: &Connection) -> Result<Vec<(Platform, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT id, handle, cursor FROM cp_accounts WHERE deleted_at IS NULL AND handle <> ''",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, handle, cursor)| Platform::from_id(&id).map(|p| (p, handle, cursor)))
        .collect())
}

/// Problem codes already stored for a platform (to skip metadata lookups).
pub fn known_codes(conn: &Connection, platform: Platform) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT code FROM cp_problems WHERE platform = ?1")?;
    let codes = stmt
        .query_map([platform.id()], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    Ok(codes)
}

fn local_day(ms: i64) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|t| t.date_naive().to_string())
        .unwrap_or_default()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn device_id(conn: &Connection) -> Result<String> {
    Ok(conn.query_row(
        "SELECT value FROM local_meta WHERE key = 'device_id'",
        [],
        |r| r.get(0),
    )?)
}

struct Stored {
    attempts: i64,
    first_at: Option<i64>,
    last_at: Option<i64>,
    solved_at: Option<i64>,
}

/// Merges a fetch into the database; returns how many problems were newly solved.
pub fn store(
    conn: &Connection,
    platform: Platform,
    fetched: &Fetched,
    cursor: i64,
) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    let device = device_id(&tx)?;

    // Group the new submissions by problem.
    let mut by_problem: HashMap<&str, Vec<&Submission>> = HashMap::new();
    for s in fetched.submissions.iter().filter(|s| s.at > cursor) {
        by_problem
            .entry(s.problem.code.as_str())
            .or_default()
            .push(s);
    }

    let mut new_solves = 0;
    for (code, subs) in &by_problem {
        let id = platform.problem_id(code);
        // The newest submission carries the freshest metadata.
        let info = &subs.iter().max_by_key(|s| s.at).unwrap().problem;
        let old: Option<Stored> = tx
            .query_row(
                "SELECT attempts, first_at, last_at, solved_at FROM cp_problems WHERE id = ?1",
                [&id],
                |r| {
                    Ok(Stored {
                        attempts: r.get(0)?,
                        first_at: r.get(1)?,
                        last_at: r.get(2)?,
                        solved_at: r.get(3)?,
                    })
                },
            )
            .optional()?;
        let first = subs.iter().map(|s| s.at).min();
        let last = subs.iter().map(|s| s.at).max();
        let first_ac = subs.iter().filter(|s| s.accepted).map(|s| s.at).min();
        let attempts = old.as_ref().map_or(0, |o| o.attempts) + subs.len() as i64;
        let min_opt = |a: Option<i64>, b: Option<i64>| match (a, b) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        let first_at = min_opt(old.as_ref().and_then(|o| o.first_at), first);
        let last_at = old.as_ref().and_then(|o| o.last_at).max(last);
        let solved_at = min_opt(old.as_ref().and_then(|o| o.solved_at), first_ac);
        let tags = serde_json::to_string(&info.tags)?;

        // Only fetched columns are written, so notes and time taken stay.
        tx.execute(
            "INSERT INTO cp_problems (id, platform, code, name, url, rating, difficulty, tags, contest_id,
                                      attempts, first_at, last_at, solved_at, created_at, updated_at, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15)
             ON CONFLICT (id) DO UPDATE SET
               -- A fetch without a name sends the code; keep the stored name then.
               name = CASE WHEN excluded.name <> excluded.code THEN excluded.name ELSE name END,
               url = coalesce(excluded.url, url),
               rating = coalesce(excluded.rating, rating),
               difficulty = coalesce(excluded.difficulty, difficulty),
               tags = CASE WHEN excluded.tags <> '[]' THEN excluded.tags ELSE tags END,
               contest_id = coalesce(excluded.contest_id, contest_id),
               attempts = excluded.attempts,
               first_at = excluded.first_at,
               last_at = excluded.last_at,
               solved_at = excluded.solved_at,
               updated_at = excluded.updated_at",
            params![
                id,
                platform.id(),
                code,
                if info.name.is_empty() { *code } else { info.name.as_str() },
                info.url,
                info.rating,
                info.difficulty,
                tags,
                info.contest_id,
                attempts,
                first_at,
                last_at,
                solved_at,
                now,
                device,
            ],
        )?;

        let was_solved = old.as_ref().and_then(|o| o.solved_at);
        if let Some(at) = solved_at.filter(|at| Some(*at) != was_solved) {
            if was_solved.is_none() {
                new_solves += 1;
            }
            tx.execute(
                "INSERT INTO activity_events (id, type_id, date, occurred_at, quantity, unit, source_table, source_id, created_at, updated_at, device_id)
                 VALUES (?1, 'cp', ?2, ?3, 1, 'problems', 'cp_problems', ?4, ?5, ?5, ?6)
                 ON CONFLICT (id) DO UPDATE SET date = excluded.date, occurred_at = excluded.occurred_at,
                   deleted_at = NULL, updated_at = excluded.updated_at",
                params![format!("ae:cp_problems:{id}"), local_day(at), at, id, now, device],
            )?;
        }
    }

    // Rating history is a cache: replace it.
    if !fetched.ratings.is_empty() {
        tx.execute(
            "DELETE FROM cp_ratings WHERE platform = ?1",
            [platform.id()],
        )?;
        for r in &fetched.ratings {
            tx.execute(
                "INSERT OR REPLACE INTO cp_ratings (id, platform, contest, at, rating, rank) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![format!("{}:{}:{}", platform.prefix(), r.contest, r.at), platform.id(), r.contest, r.at, r.rating, r.rank],
            )?;
        }
    }

    let a = &fetched.account;
    let solved = match a.solved {
        Some(n) => n,
        None => tx.query_row(
            "SELECT count(*) FROM cp_problems WHERE platform = ?1 AND solved_at IS NOT NULL AND deleted_at IS NULL",
            [platform.id()],
            |r| r.get(0),
        )?,
    };
    let new_cursor = fetched
        .submissions
        .iter()
        .map(|s| s.at)
        .max()
        .unwrap_or(cursor)
        .max(cursor);
    tx.execute(
        "UPDATE cp_accounts SET rating = ?2, max_rating = ?3, rank_title = ?4, solved = ?5, contests = ?6, meta = ?7,
                                cursor = ?8, synced_at = ?9, error = NULL, updated_at = ?9
         WHERE id = ?1",
        params![
            platform.id(),
            a.rating,
            a.max_rating,
            a.rank_title,
            solved,
            a.contests,
            serde_json::to_string(&a.meta)?,
            new_cursor,
            now,
        ],
    )?;
    tx.commit()?;
    Ok(new_solves)
}

pub fn store_error(conn: &Connection, platform: Platform, error: &str) -> Result<()> {
    conn.execute(
        "UPDATE cp_accounts SET error = ?2, updated_at = ?3 WHERE id = ?1 AND error IS NOT ?2",
        params![platform.id(), error, now_ms()],
    )?;
    Ok(())
}

/// Replaces one platform's upcoming contests.
pub fn store_contests(conn: &Connection, platform: Platform, contests: &[Contest]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM cp_contests WHERE platform = ?1",
        [platform.id()],
    )?;
    for c in contests {
        tx.execute(
            "INSERT OR REPLACE INTO cp_contests (id, platform, name, url, start_at, duration_min) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![format!("{}:{}", platform.prefix(), c.code), platform.id(), c.name, c.url, c.start_at, c.duration_min],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Readable message for a failed fetch.
pub fn describe(platform: Platform, e: &Error) -> String {
    let site = match platform {
        Platform::Codeforces => "Codeforces",
        Platform::LeetCode => "LeetCode",
        Platform::AtCoder => "AtCoder",
        Platform::CodeChef => "CodeChef",
    };
    match e {
        Error::Invalid(m) => m.clone(),
        Error::Http(m) => format!("{site} could not be reached: {m}"),
        Error::Json(_) => format!("{site} answered in an unexpected format"),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests;
