//! GitHub: the contribution calendar (for the activity heatmap), the five
//! repositories pushed to most recently and the issues the user is part of.
//!
//! Everything is read without a token. The REST API then allows 60 requests
//! an hour (search has its own 10 a minute), so a refresh stays at about a
//! dozen requests and skips commits it already knows. The calendar comes
//! from the profile page's contributions fragment, which has no API without
//! a token; it includes private contributions when the user shows them on
//! their profile.

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate};
use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value as JsonValue, json};

use super::codeforces::urlencode;
use super::http::{Http, pause};
use super::{device_id, now_ms};
use crate::error::{Error, Result};

const API: &str = "https://api.github.com";
/// Repositories listed as "latest commits".
const RECENT_REPOS: usize = 5;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Profile {
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub followers: i64,
    pub public_repos: i64,
    /// Year the account was made, for the first calendar fetch.
    pub joined_year: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Repo {
    pub full_name: String,
    pub url: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub stars: i64,
    pub fork: bool,
    pub pushed_at: i64,
    pub head_sha: Option<String>,
    pub commit_message: Option<String>,
    pub commit_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Issue {
    pub id: String,
    pub repo: String,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub author: String,
    /// "author", "assignee" or "involved" (mentioned or commented).
    pub role: String,
    pub labels: Vec<String>,
    pub comments: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Debug, Default)]
pub struct GitHubFetched {
    pub profile: Profile,
    /// Contributions per day, including days with none.
    pub days: Vec<(String, i64)>,
    pub repos: Vec<Repo>,
    pub issues: Vec<Issue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubReport {
    pub contributions: i64,
    pub error: Option<String>,
}

/// The stored account: handle, whether past years were read, known commits.
pub struct Account {
    pub handle: String,
    pub backfilled: bool,
    /// Commit message per head sha already fetched.
    pub known_commits: HashMap<String, (String, String)>,
}

pub fn account(conn: &Connection) -> Result<Option<Account>> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT handle, meta FROM gh_account WHERE id = 'github' AND deleted_at IS NULL AND handle <> ''",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((handle, meta)) = row else {
        return Ok(None);
    };
    let meta: JsonValue = serde_json::from_str(&meta).unwrap_or_default();
    let mut stmt = conn.prepare(
        "SELECT head_sha, commit_message, commit_url FROM gh_repos WHERE head_sha IS NOT NULL AND commit_message IS NOT NULL",
    )?;
    let known_commits = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, String>(1)?, r.get::<_, String>(2)?),
            ))
        })?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?;
    Ok(Some(Account {
        backfilled: meta["backfilledFor"].as_str() == Some(&handle.to_lowercase()),
        handle,
        known_commits,
    }))
}

/// A REST call; a missing user and the rate limit get readable errors.
fn api(http: &Http, path: &str) -> Result<JsonValue> {
    let (status, body) = http.raw(&format!("{API}/{path}"))?;
    match status {
        200..=299 => Ok(serde_json::from_str(&body)?),
        404 => Err(Error::Invalid("Not found on GitHub".into())),
        403 | 429 => Err(Error::Http(
            "rate limit reached, try again within the hour".into(),
        )),
        _ => Err(Error::Http(format!("GitHub returned {status}"))),
    }
}

pub fn fetch(http: &Http, account: &Account) -> Result<GitHubFetched> {
    let user = urlencode(&account.handle);
    let profile = match api(http, &format!("users/{user}")) {
        Err(Error::Invalid(_)) => {
            return Err(Error::Invalid("No GitHub user with that name".into()));
        }
        other => parse_profile(&other?),
    };

    // The first refresh reads every year; later ones the last twelve months.
    let mut days = Vec::new();
    if account.backfilled {
        days =
            parse_calendar(&http.text(&format!("https://github.com/users/{user}/contributions"))?);
    } else {
        let this_year = chrono::Utc::now().year();
        for year in profile.joined_year.min(this_year)..=this_year {
            pause(400);
            days.extend(parse_calendar(&http.text(&format!(
                "https://github.com/users/{user}/contributions?from={year}-01-01&to={year}-12-31"
            ))?));
        }
    }

    let events = api(http, &format!("users/{user}/events/public?per_page=100"))?;
    let owned = api(
        http,
        &format!("users/{user}/repos?sort=pushed&per_page={RECENT_REPOS}"),
    )?;
    let mut repos = recent_repos(&events, &owned);
    for repo in &mut repos {
        let cached = repo
            .head_sha
            .as_ref()
            .and_then(|sha| account.known_commits.get(sha));
        if let Some((message, url)) = cached {
            repo.commit_message = Some(message.clone());
            repo.commit_url = Some(url.clone());
            continue;
        }
        // Owned repos come with details; others need their own request.
        if repo.url.is_empty()
            && let Ok(details) = api(http, &format!("repos/{}", repo.full_name))
        {
            fill_details(repo, &details);
        }
        let path = match &repo.head_sha {
            Some(sha) => format!("repos/{}/commits/{sha}", repo.full_name),
            None => format!("repos/{}/commits?author={user}&per_page=1", repo.full_name),
        };
        if let Ok(commit) = api(http, &path) {
            let commit = if commit.is_array() {
                &commit[0]
            } else {
                &commit
            };
            fill_commit(repo, commit);
        }
    }
    for repo in &mut repos {
        if repo.url.is_empty() {
            repo.url = format!("https://github.com/{}", repo.full_name);
        }
    }

    let found = api(
        http,
        &format!("search/issues?q=involves:{user}+is:issue&sort=updated&order=desc&per_page=50"),
    )?;
    let issues = parse_issues(&found, &account.handle);

    Ok(GitHubFetched {
        profile,
        days,
        repos,
        issues,
    })
}

fn ms(value: &JsonValue) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|t| t.timestamp_millis())
}

pub fn parse_profile(user: &JsonValue) -> Profile {
    Profile {
        name: user["name"].as_str().map(String::from),
        avatar_url: user["avatar_url"].as_str().map(String::from),
        followers: user["followers"].as_i64().unwrap_or(0),
        public_repos: user["public_repos"].as_i64().unwrap_or(0),
        joined_year: user["created_at"]
            .as_str()
            .and_then(|s| s.get(..4))
            .and_then(|y| y.parse().ok())
            .unwrap_or_else(|| chrono::Utc::now().year()),
    }
}

/// Days of the calendar fragment with their counts. Each day cell has an id
/// that a `<tool-tip>` names, reading "3 contributions on …" or "No
/// contributions on …"; the colour level is the fallback.
pub fn parse_calendar(html: &str) -> Vec<(String, i64)> {
    let cell = Regex::new(r"<td\b[^>]*\bdata-date=[^>]*>").unwrap();
    let attr = |tag: &str, name: &str| {
        Regex::new(&format!(r#"\b{name}="([^"]*)""#))
            .unwrap()
            .captures(tag)
            .map(|c| c[1].to_string())
    };
    let tips: HashMap<String, String> =
        Regex::new(r#"<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)"#)
            .unwrap()
            .captures_iter(html)
            .map(|c| (c[1].to_string(), c[2].trim().to_string()))
            .collect();
    let count = Regex::new(r"^([\d,]+) contributions?").unwrap();
    let mut days: Vec<(String, i64)> = cell
        .find_iter(html)
        .filter_map(|m| {
            let tag = m.as_str();
            let date = attr(tag, "data-date")?;
            NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok()?;
            let tip = attr(tag, "id").and_then(|id| tips.get(&id));
            let n = match tip {
                Some(t) if t.starts_with("No contributions") => 0,
                Some(t) => count
                    .captures(t)
                    .and_then(|c| c[1].replace(',', "").parse().ok())
                    .unwrap_or(0),
                None => attr(tag, "data-level")
                    .and_then(|l| l.parse().ok())
                    .unwrap_or(0),
            };
            Some((date, n))
        })
        .collect();
    days.sort();
    days
}

/// The repositories pushed to most recently: from push events (which
/// include other people's repositories), topped up with the user's own.
pub fn recent_repos(events: &JsonValue, owned: &JsonValue) -> Vec<Repo> {
    let mut repos: Vec<Repo> = Vec::new();
    for e in events.as_array().into_iter().flatten() {
        if e["type"] != "PushEvent" {
            continue;
        }
        let (Some(name), Some(at)) = (e["repo"]["name"].as_str(), ms(&e["created_at"])) else {
            continue;
        };
        match repos.iter_mut().find(|r| r.full_name == name) {
            // Events are newest first, but not strictly.
            Some(r) if at > r.pushed_at => {
                r.pushed_at = at;
                r.head_sha = e["payload"]["head"].as_str().map(String::from);
            }
            Some(_) => {}
            None => repos.push(Repo {
                full_name: name.to_string(),
                url: String::new(),
                description: None,
                language: None,
                stars: 0,
                fork: false,
                pushed_at: at,
                head_sha: e["payload"]["head"].as_str().map(String::from),
                commit_message: None,
                commit_url: None,
            }),
        }
    }
    for r in owned.as_array().into_iter().flatten() {
        let Some(name) = r["full_name"].as_str() else {
            continue;
        };
        let pushed = ms(&r["pushed_at"]).unwrap_or(0);
        match repos.iter_mut().find(|x| x.full_name == name) {
            Some(x) => fill_details(x, r),
            None => {
                let mut repo = Repo {
                    full_name: name.to_string(),
                    url: String::new(),
                    description: None,
                    language: None,
                    stars: 0,
                    fork: false,
                    pushed_at: pushed,
                    head_sha: None,
                    commit_message: None,
                    commit_url: None,
                };
                fill_details(&mut repo, r);
                repos.push(repo);
            }
        }
    }
    repos.sort_by(|a, b| b.pushed_at.cmp(&a.pushed_at));
    repos.truncate(RECENT_REPOS);
    repos
}

fn fill_details(repo: &mut Repo, r: &JsonValue) {
    repo.url = r["html_url"].as_str().unwrap_or_default().to_string();
    repo.description = r["description"].as_str().map(String::from);
    repo.language = r["language"].as_str().map(String::from);
    repo.stars = r["stargazers_count"].as_i64().unwrap_or(0);
    repo.fork = r["fork"].as_bool().unwrap_or(false);
}

fn fill_commit(repo: &mut Repo, c: &JsonValue) {
    if let Some(message) = c["commit"]["message"].as_str() {
        repo.commit_message = Some(message.lines().next().unwrap_or_default().to_string());
        repo.commit_url = c["html_url"].as_str().map(String::from);
        repo.head_sha = repo
            .head_sha
            .take()
            .or_else(|| c["sha"].as_str().map(String::from));
    }
}

pub fn parse_issues(found: &JsonValue, handle: &str) -> Vec<Issue> {
    found["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| i.get("pull_request").is_none())
        .filter_map(|i| {
            let author = i["user"]["login"].as_str().unwrap_or_default().to_string();
            let assigned = i["assignees"].as_array().into_iter().flatten().any(|a| {
                a["login"]
                    .as_str()
                    .is_some_and(|l| l.eq_ignore_ascii_case(handle))
            });
            let role = if author.eq_ignore_ascii_case(handle) {
                "author"
            } else if assigned {
                "assignee"
            } else {
                "involved"
            };
            let repo = i["repository_url"]
                .as_str()?
                .trim_start_matches("https://api.github.com/repos/")
                .to_string();
            Some(Issue {
                id: i["id"].as_i64()?.to_string(),
                repo,
                number: i["number"].as_i64()?,
                title: i["title"].as_str()?.to_string(),
                url: i["html_url"].as_str()?.to_string(),
                state: i["state"].as_str().unwrap_or("open").to_string(),
                author,
                role: role.into(),
                labels: i["labels"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|l| l["name"].as_str().map(String::from))
                    .collect(),
                comments: i["comments"].as_i64().unwrap_or(0),
                created_at: ms(&i["created_at"]).unwrap_or(0),
                updated_at: ms(&i["updated_at"]).unwrap_or(0),
                closed_at: ms(&i["closed_at"]),
            })
        })
        .collect()
}

/// Saves a fetch: contributions become `github` activity events (one per
/// day, with deterministic ids so both devices agree), repos and issues
/// replace the device's cache. Returns the contributions of the last year.
pub fn store(conn: &Connection, handle: &str, fetched: &GitHubFetched) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    let device = device_id(&tx)?;

    for (date, n) in &fetched.days {
        let id = format!("ae:github:{date}");
        if *n > 0 {
            let at = NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(12, 0, 0))
                .map_or(now, |t| t.and_utc().timestamp_millis());
            // Unchanged days are left alone so they do not sync again.
            tx.execute(
                "INSERT INTO activity_events (id, type_id, date, occurred_at, quantity, unit, source_table, source_id, created_at, updated_at, device_id)
                 VALUES (?1, 'github', ?2, ?3, ?4, 'contributions', 'github', ?2, ?5, ?5, ?6)
                 ON CONFLICT (id) DO UPDATE SET quantity = excluded.quantity, deleted_at = NULL, updated_at = excluded.updated_at
                 WHERE quantity IS NOT excluded.quantity OR deleted_at IS NOT NULL",
                params![id, date, at, n, now, device],
            )?;
        } else {
            tx.execute(
                "UPDATE activity_events SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
                params![id, now],
            )?;
        }
    }

    tx.execute("DELETE FROM gh_repos", [])?;
    for (i, r) in fetched.repos.iter().enumerate() {
        tx.execute(
            "INSERT INTO gh_repos (id, url, description, language, stars, fork, pushed_at, head_sha, commit_message, commit_url, sort)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                r.full_name,
                r.url,
                r.description,
                r.language,
                r.stars,
                r.fork,
                r.pushed_at,
                r.head_sha,
                r.commit_message,
                r.commit_url,
                i as i64
            ],
        )?;
    }
    tx.execute("DELETE FROM gh_issues", [])?;
    for i in &fetched.issues {
        tx.execute(
            "INSERT INTO gh_issues (id, repo, number, title, url, state, author, role, labels, comments, created_at, updated_at, closed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                i.id,
                i.repo,
                i.number,
                i.title,
                i.url,
                i.state,
                i.author,
                i.role,
                serde_json::to_string(&i.labels)?,
                i.comments,
                i.created_at,
                i.updated_at,
                i.closed_at
            ],
        )?;
    }

    let cutoff = (chrono::Local::now().date_naive() - chrono::Days::new(365)).to_string();
    let year: i64 = fetched
        .days
        .iter()
        .filter(|(d, _)| *d > cutoff)
        .map(|(_, n)| n)
        .sum();
    let p = &fetched.profile;
    let meta = json!({
        "name": p.name,
        "avatarUrl": p.avatar_url,
        "followers": p.followers,
        "publicRepos": p.public_repos,
        "backfilledFor": handle.to_lowercase(),
    });
    tx.execute(
        "UPDATE gh_account SET contributions = ?1, meta = ?2, synced_at = ?3, error = NULL, updated_at = ?3 WHERE id = 'github'",
        params![year, serde_json::to_string(&meta)?, now],
    )?;
    tx.commit()?;
    Ok(year)
}

pub fn store_error(conn: &Connection, error: &str) -> Result<()> {
    conn.execute(
        "UPDATE gh_account SET error = ?1, updated_at = ?2 WHERE id = 'github' AND error IS NOT ?1",
        params![error, now_ms()],
    )?;
    Ok(())
}

pub fn describe(e: &Error) -> String {
    match e {
        Error::Invalid(m) => m.clone(),
        Error::Http(m) => format!("GitHub could not be reached: {m}"),
        Error::Json(_) => "GitHub answered in an unexpected format".into(),
        other => other.to_string(),
    }
}
