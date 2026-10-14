//! CodeChef has no public API any more. Ratings and totals come from the
//! profile page, submissions from the "recent activity" feed the profile
//! loads, and contests from the JSON the contests page uses. Times on
//! CodeChef are Indian Standard Time.

use chrono::{FixedOffset, NaiveDateTime, TimeZone};
use regex::Regex;
use serde_json::{Value as JsonValue, json};

use super::atcoder::html_unescape;
use super::codeforces::urlencode;
use super::http::{Http, pause};
use super::{AccountInfo, Contest, Fetched, ProblemInfo, RatingPoint, Submission};
use crate::error::{Error, Result};

/// Recent-activity pages read on the first refresh (12 submissions each).
const FIRST_PAGES: i64 = 25;

fn ist() -> FixedOffset {
    FixedOffset::east_opt(5 * 3600 + 30 * 60).unwrap()
}

pub fn fetch(http: &Http, user: &str, cursor: i64) -> Result<Fetched> {
    let user = urlencode(user);
    let html = http.text(&format!("https://www.codechef.com/users/{user}"))?;
    let (account, ratings) = parse_profile(&html)?;

    let now = chrono::Utc::now().timestamp_millis();
    let mut submissions = Vec::new();
    let mut page = 0;
    loop {
        pause(1_500);
        let data = http.json(&format!(
            "https://www.codechef.com/recent/user?page={page}&user_handle={user}"
        ))?;
        let parsed = parse_recent(data["content"].as_str().unwrap_or_default(), now);
        let reached = parsed.is_empty() || parsed.iter().any(|s| s.at <= cursor);
        submissions.extend(parsed.into_iter().filter(|s| s.at > cursor));
        page += 1;
        let last = data["max_page"].as_i64().unwrap_or(0);
        if reached || page >= last || (cursor == 0 && page >= FIRST_PAGES) {
            break;
        }
    }
    Ok(Fetched {
        account,
        submissions,
        ratings,
    })
}

pub fn parse_profile(html: &str) -> Result<(AccountInfo, Vec<RatingPoint>)> {
    // An unknown user redirects to the home page.
    let solved = Regex::new(r"Total Problems Solved:\s*(\d+)")
        .unwrap()
        .captures(html);
    if !html.contains("rating-number") && solved.is_none() {
        return Err(Error::Invalid("No CodeChef user with that handle".into()));
    }
    let number = |pattern: &str| {
        Regex::new(pattern)
            .unwrap()
            .captures(html)
            .and_then(|c| c[1].parse::<f64>().ok())
    };
    let rating = number(r#"(?s)<div class="rating-number">\s*(\d+)"#);
    let highest = number(r"Highest Rating (\d+)");
    let stars = html
        .find(r#"class="rating-star""#)
        .map(|i| {
            let block = &html[i..];
            let end = block.find("</div>").unwrap_or(block.len());
            block[..end].matches("&#9733;").count()
        })
        .unwrap_or(0);

    let history = html
        .find("var all_rating = ")
        .and_then(|i| {
            let rest = &html[i + "var all_rating = ".len()..];
            rest.find("];").map(|end| &rest[..=end])
        })
        .and_then(|s| serde_json::from_str::<JsonValue>(s).ok())
        .unwrap_or(JsonValue::Null);
    let ratings: Vec<RatingPoint> = history
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let at =
                NaiveDateTime::parse_from_str(r["end_date"].as_str()?, "%Y-%m-%d %H:%M:%S").ok()?;
            Some(RatingPoint {
                contest: r["name"].as_str().or(r["code"].as_str())?.to_string(),
                at: ist().from_local_datetime(&at).single()?.timestamp_millis(),
                rating: r["rating"].as_str()?.parse().ok()?,
                rank: r["rank"].as_str().and_then(|x| x.parse().ok()),
            })
        })
        .collect();

    let account = AccountInfo {
        rating,
        max_rating: highest.or(rating),
        rank_title: (stars > 0).then(|| format!("{stars}★")),
        solved: solved.and_then(|c| c[1].parse().ok()),
        contests: ratings.len() as i64,
        meta: json!({ "stars": stars }),
    };
    Ok((account, ratings))
}

/// Rows of the recent-activity table: time, problem, result.
pub fn parse_recent(html: &str, now: i64) -> Vec<Submission> {
    let row = Regex::new(
        r#"(?s)<tr\s*>\s*<td\s+title='([^']*)'.*?href='(?:/([A-Za-z0-9_]+))?/problems/([^']+)'.*?<span title='([^']*)'"#,
    )
    .unwrap();
    row.captures_iter(html)
        .filter_map(|c| {
            let at = parse_time(&c[1], now)?;
            let code = c[3].to_string();
            Some(Submission {
                problem: ProblemInfo {
                    url: Some(format!("https://www.codechef.com/problems/{code}")),
                    name: code.clone(),
                    contest_id: c.get(2).map(|m| m.as_str().to_string()),
                    code,
                    ..Default::default()
                },
                at,
                accepted: c[4].eq_ignore_ascii_case("accepted"),
            })
        })
        .collect()
}

/// "01:52 AM 06/08/24" (IST), or relative times like "5 min ago".
pub fn parse_time(text: &str, now: i64) -> Option<i64> {
    let text = html_unescape(text.trim());
    if let Ok(t) = NaiveDateTime::parse_from_str(&text, "%I:%M %p %d/%m/%y") {
        return Some(ist().from_local_datetime(&t).single()?.timestamp_millis());
    }
    let rel = Regex::new(r"(\d+)\s*(sec|min|hour|hr|day)")
        .unwrap()
        .captures(&text)?;
    let n: i64 = rel[1].parse().ok()?;
    let unit = match &rel[2] {
        "sec" => 1_000,
        "min" => 60_000,
        "hour" | "hr" => 3_600_000,
        _ => 86_400_000,
    };
    Some(now - n * unit)
}

pub fn upcoming(http: &Http) -> Result<Vec<Contest>> {
    let data = http.json("https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all")?;
    Ok(parse_contests(&data))
}

pub fn parse_contests(data: &JsonValue) -> Vec<Contest> {
    ["present_contests", "future_contests"]
        .iter()
        .flat_map(|key| data[*key].as_array().into_iter().flatten())
        .filter_map(|c| {
            let code = c["contest_code"].as_str()?;
            let start =
                chrono::DateTime::parse_from_rfc3339(c["contest_start_date_iso"].as_str()?).ok()?;
            Some(Contest {
                code: code.to_string(),
                name: c["contest_name"].as_str()?.to_string(),
                url: format!("https://www.codechef.com/{code}"),
                start_at: start.timestamp_millis(),
                duration_min: c["contest_duration"]
                    .as_str()
                    .and_then(|d| d.parse().ok())
                    .unwrap_or(0),
            })
        })
        .collect()
}
