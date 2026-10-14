//! Codeforces through its official API (about one request every two seconds).

use serde_json::{Value as JsonValue, json};

use super::http::{Http, pause};
use super::{AccountInfo, Contest, Fetched, ProblemInfo, RatingPoint, Submission};
use crate::error::{Error, Result};

const API: &str = "https://codeforces.com/api";
const PAGE: usize = 500;
const PAUSE_MS: u64 = 2_100;

/// Calls an API method and returns `result`, or the API's own error message.
fn call(http: &Http, method_and_query: &str) -> Result<JsonValue> {
    let (status, body) = http.raw(&format!("{API}/{method_and_query}"))?;
    let value: JsonValue = serde_json::from_str(&body)
        .map_err(|_| Error::Http(format!("Codeforces returned {status}")))?;
    if value["status"] == "OK" {
        return Ok(value["result"].clone());
    }
    let comment = value["comment"].as_str().unwrap_or("request failed");
    if comment.contains("not found") {
        return Err(Error::Invalid("No Codeforces user with that handle".into()));
    }
    Err(Error::Http(comment.to_string()))
}

pub fn fetch(http: &Http, handle: &str, cursor: i64) -> Result<Fetched> {
    let handle = urlencode(handle);
    let info = call(http, &format!("user.info?handles={handle}"))?;
    pause(PAUSE_MS);
    let ratings = call(http, &format!("user.rating?handle={handle}"))?;

    // Newest first: page until submissions are no newer than the cursor.
    let mut submissions = Vec::new();
    let mut from = 1;
    loop {
        pause(PAUSE_MS);
        let page = call(
            http,
            &format!("user.status?handle={handle}&from={from}&count={PAGE}"),
        )?;
        let parsed = parse_submissions(&page);
        let len = page.as_array().map_or(0, Vec::len);
        let reached = parsed.iter().any(|s| s.at <= cursor);
        submissions.extend(parsed.into_iter().filter(|s| s.at > cursor));
        if reached || len < PAGE {
            break;
        }
        from += PAGE;
    }

    let ratings = parse_ratings(&ratings);
    Ok(Fetched {
        account: parse_account(&info[0], ratings.len()),
        submissions,
        ratings,
    })
}

pub fn parse_account(user: &JsonValue, contests: usize) -> AccountInfo {
    AccountInfo {
        rating: user["rating"].as_f64(),
        max_rating: user["maxRating"].as_f64(),
        rank_title: user["rank"].as_str().map(title_case),
        // Counted from the full submission history we store.
        solved: None,
        contests: contests as i64,
        meta: json!({ "maxRank": user["maxRank"].as_str().map(title_case) }),
    }
}

pub fn parse_ratings(list: &JsonValue) -> Vec<RatingPoint> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| {
            Some(RatingPoint {
                contest: r["contestName"].as_str()?.to_string(),
                at: r["ratingUpdateTimeSeconds"].as_i64()? * 1000,
                rating: r["newRating"].as_f64()?,
                rank: r["rank"].as_i64(),
            })
        })
        .collect()
}

pub fn parse_submissions(list: &JsonValue) -> Vec<Submission> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            // Still being judged: count it next time.
            let verdict = s["verdict"].as_str()?;
            if verdict == "TESTING" {
                return None;
            }
            let p = &s["problem"];
            let index = p["index"].as_str()?;
            let contest = p["contestId"].as_i64();
            let code = match contest {
                Some(c) => format!("{c}{index}"),
                None => format!("{}{index}", p["problemsetName"].as_str().unwrap_or("x")),
            };
            let url = contest.map(|c| {
                if c >= 100_000 {
                    format!("https://codeforces.com/gym/{c}/problem/{index}")
                } else {
                    format!("https://codeforces.com/problemset/problem/{c}/{index}")
                }
            });
            let rating = p["rating"].as_f64();
            Some(Submission {
                problem: ProblemInfo {
                    code,
                    name: p["name"].as_str().unwrap_or_default().to_string(),
                    url,
                    rating,
                    difficulty: rating.map(|r| format!("{r:.0}")),
                    tags: p["tags"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|t| t.as_str().map(String::from))
                        .collect(),
                    contest_id: contest.map(|c| c.to_string()),
                },
                at: s["creationTimeSeconds"].as_i64()? * 1000,
                accepted: verdict == "OK",
            })
        })
        .collect()
}

pub fn upcoming(http: &Http) -> Result<Vec<Contest>> {
    Ok(parse_contests(&call(http, "contest.list?gym=false")?))
}

pub fn parse_contests(list: &JsonValue) -> Vec<Contest> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter(|c| c["phase"] == "BEFORE")
        .filter_map(|c| {
            let id = c["id"].as_i64()?;
            Some(Contest {
                code: id.to_string(),
                name: c["name"].as_str()?.to_string(),
                url: format!("https://codeforces.com/contests/{id}"),
                start_at: c["startTimeSeconds"].as_i64()? * 1000,
                duration_min: c["durationSeconds"].as_i64().unwrap_or(0) / 60,
            })
        })
        .collect()
}

fn title_case(s: &str) -> String {
    s.split(' ')
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Percent-encodes a handle for a query string.
pub fn urlencode(s: &str) -> String {
    s.trim()
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}
