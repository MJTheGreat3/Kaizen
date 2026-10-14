//! AtCoder: rating history from atcoder.jp's own JSON, submissions and
//! problem names from the community AtCoder Problems API (kenkoooo.com),
//! upcoming contests from the contests page.

use std::collections::{HashMap, HashSet};

use chrono::DateTime;
use regex::Regex;
use serde_json::{Value as JsonValue, json};

use super::codeforces::urlencode;
use super::http::{Http, pause};
use super::{AccountInfo, Contest, Fetched, ProblemInfo, RatingPoint, Submission};
use crate::error::{Error, Result};

const KENKOOO: &str = "https://kenkoooo.com/atcoder";
const PAGE: usize = 500;

pub fn fetch(http: &Http, user: &str, cursor: i64) -> Result<Fetched> {
    let user = urlencode(user);
    // The history of an unknown user is just empty, so check the profile once.
    if cursor == 0 && http.raw(&format!("https://atcoder.jp/users/{user}"))?.0 == 404 {
        return Err(Error::Invalid("No AtCoder user with that name".into()));
    }
    let (status, body) = http.raw(&format!("https://atcoder.jp/users/{user}/history/json"))?;
    if !(200..300).contains(&status) {
        return Err(Error::Http(format!("atcoder.jp returned {status}")));
    }
    let ratings = parse_history(&serde_json::from_str(&body)?);

    // Ascending by time; page from the cursor.
    let mut raw = Vec::new();
    let mut seen = HashSet::new();
    let mut from = cursor / 1000;
    loop {
        pause(1_100);
        let page = http.json(&format!(
            "{KENKOOO}/atcoder-api/v3/user/submissions?user={user}&from_second={from}"
        ))?;
        let items = page.as_array().cloned().unwrap_or_default();
        let len = items.len();
        let before = raw.len();
        for s in items {
            if let Some(id) = s["id"].as_i64()
                && seen.insert(id)
            {
                from = from.max(s["epoch_second"].as_i64().unwrap_or(from));
                raw.push(s);
            }
        }
        if len < PAGE || raw.len() == before {
            break;
        }
    }

    let mut submissions = parse_submissions(&JsonValue::Array(raw));
    submissions.retain(|s| s.at > cursor);
    if !submissions.is_empty() {
        // Names and difficulties for the problems involved.
        pause(1_100);
        let problems = http.json(&format!("{KENKOOO}/resources/merged-problems.json"))?;
        pause(1_100);
        let models = http
            .json(&format!("{KENKOOO}/resources/problem-models.json"))
            .unwrap_or(JsonValue::Null);
        apply_problems(&mut submissions, &problems, &models);
    }

    let account = account_from(&ratings);
    Ok(Fetched {
        account,
        submissions,
        ratings,
    })
}

pub fn parse_history(list: &JsonValue) -> Vec<RatingPoint> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter(|h| h["IsRated"] == true)
        .filter_map(|h| {
            Some(RatingPoint {
                contest: h["ContestName"].as_str()?.to_string(),
                at: DateTime::parse_from_rfc3339(h["EndTime"].as_str()?)
                    .ok()?
                    .timestamp_millis(),
                rating: h["NewRating"].as_f64()?,
                rank: h["Place"].as_i64(),
            })
        })
        .collect()
}

pub fn account_from(ratings: &[RatingPoint]) -> AccountInfo {
    let rating = ratings.last().map(|r| r.rating);
    AccountInfo {
        rating,
        max_rating: ratings.iter().map(|r| r.rating).reduce(f64::max),
        rank_title: rating.map(|r| colour(r).to_string()),
        solved: None,
        contests: ratings.len() as i64,
        meta: json!({}),
    }
}

/// AtCoder's rating colours, which serve as its ranks.
pub fn colour(rating: f64) -> &'static str {
    match rating as i64 {
        ..400 => "Gray",
        400..800 => "Brown",
        800..1200 => "Green",
        1200..1600 => "Cyan",
        1600..2000 => "Blue",
        2000..2400 => "Yellow",
        2400..2800 => "Orange",
        _ => "Red",
    }
}

pub fn parse_submissions(list: &JsonValue) -> Vec<Submission> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let problem = s["problem_id"].as_str()?;
            let contest = s["contest_id"].as_str()?;
            let result = s["result"].as_str()?;
            // Waiting for judgement.
            if result == "WJ" || result == "WR" {
                return None;
            }
            Some(Submission {
                problem: ProblemInfo {
                    code: problem.to_string(),
                    name: String::new(),
                    url: Some(format!(
                        "https://atcoder.jp/contests/{contest}/tasks/{problem}"
                    )),
                    contest_id: Some(contest.to_string()),
                    ..Default::default()
                },
                at: s["epoch_second"].as_i64()? * 1000,
                accepted: result == "AC",
            })
        })
        .collect()
}

/// Fills names from `merged-problems.json` and difficulties from `problem-models.json`.
pub fn apply_problems(submissions: &mut [Submission], problems: &JsonValue, models: &JsonValue) {
    let names: HashMap<&str, &str> = problems
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            Some((
                p["id"].as_str()?,
                p["title"].as_str().or(p["name"].as_str())?,
            ))
        })
        .collect();
    for s in submissions {
        let code = s.problem.code.clone();
        s.problem.name = names
            .get(code.as_str())
            .map(|n| n.to_string())
            .unwrap_or(code.clone());
        if let Some(d) = models[code.as_str()]["difficulty"].as_f64() {
            let d = clip_difficulty(d);
            s.problem.rating = Some(d);
            s.problem.difficulty = Some(format!("{d:.0}"));
        }
    }
}

/// AtCoder Problems shows low difficulties squashed above zero.
pub fn clip_difficulty(d: f64) -> f64 {
    if d >= 400.0 {
        d.round()
    } else {
        (400.0 / ((400.0 - d) / 400.0).exp()).round()
    }
}

pub fn upcoming(http: &Http) -> Result<Vec<Contest>> {
    Ok(parse_upcoming(
        &http.text("https://atcoder.jp/contests/?lang=en")?,
    ))
}

/// Reads the "Upcoming Contests" table of atcoder.jp/contests.
pub fn parse_upcoming(html: &str) -> Vec<Contest> {
    let Some(start) = html.find("contest-table-upcoming") else {
        return Vec::new();
    };
    let section = &html[start..];
    let section = &section[..section.find("</tbody>").unwrap_or(section.len())];
    let row = Regex::new(
        r#"(?s)<time class='fixtime fixtime-full'>([^<]+)</time>.*?<a href="/contests/([^"]+)">([^<]+)</a>.*?<td class="text-center">(\d+):(\d+)</td>"#,
    )
    .unwrap();
    row.captures_iter(section)
        .filter_map(|c| {
            let start = DateTime::parse_from_str(&c[1], "%Y-%m-%d %H:%M:%S%z").ok()?;
            let hours: i64 = c[4].parse().ok()?;
            let minutes: i64 = c[5].parse().ok()?;
            Some(Contest {
                code: c[2].to_string(),
                name: html_unescape(&c[3]),
                url: format!("https://atcoder.jp/contests/{}", &c[2]),
                start_at: start.timestamp_millis(),
                duration_min: hours * 60 + minutes,
            })
        })
        .collect()
}

pub fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'")
}
