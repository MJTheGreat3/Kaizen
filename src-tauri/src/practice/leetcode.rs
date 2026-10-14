//! LeetCode through the GraphQL endpoint its website uses (unofficial).
//!
//! Without logging in, only the 20 most recent accepted submissions are
//! visible, so the history here grows from the first refresh on; the
//! account's solved totals (all time, by difficulty) come from the profile.

use std::collections::HashSet;

use serde_json::{Value as JsonValue, json};

use super::http::{Http, pause};
use super::{AccountInfo, Contest, Fetched, ProblemInfo, RatingPoint, Submission};
use crate::error::{Error, Result};

const URL: &str = "https://leetcode.com/graphql";

const PROFILE: &str = "query($u: String!) {
  matchedUser(username: $u) {
    username
    profile { ranking }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
  userContestRanking(username: $u) { rating attendedContestsCount topPercentage badge { name } }
  userContestRankingHistory(username: $u) { attended rating ranking contest { title startTime } }
  recentAcSubmissionList(username: $u, limit: 20) { title titleSlug timestamp }
}";

const QUESTION: &str = "query($s: String!) {
  question(titleSlug: $s) { questionFrontendId difficulty topicTags { name } }
}";

pub fn fetch(http: &Http, username: &str, cursor: i64, known: &HashSet<String>) -> Result<Fetched> {
    let data = http.graphql(URL, PROFILE, json!({ "u": username.trim() }))?;
    let mut fetched = parse_profile(&data)?;
    // Difficulty and topics for problems seen for the first time.
    fetched.submissions.retain(|s| s.at > cursor);
    for s in &mut fetched.submissions {
        if known.contains(&s.problem.code) {
            // Keep the stored name, which has the problem number.
            s.problem.name.clear();
            continue;
        }
        pause(400);
        if let Ok(q) = http.graphql(URL, QUESTION, json!({ "s": s.problem.code })) {
            apply_question(&mut s.problem, &q["question"]);
        }
    }
    Ok(fetched)
}

pub fn parse_profile(data: &JsonValue) -> Result<Fetched> {
    let user = &data["matchedUser"];
    if user.is_null() {
        return Err(Error::Invalid("No LeetCode user with that username".into()));
    }
    let count = |difficulty: &str| {
        user["submitStatsGlobal"]["acSubmissionNum"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|d| d["difficulty"] == difficulty)
            .and_then(|d| d["count"].as_i64())
            .unwrap_or(0)
    };
    let ranking = &data["userContestRanking"];
    let ratings: Vec<RatingPoint> = data["userContestRankingHistory"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|h| h["attended"] == true)
        .filter_map(|h| {
            Some(RatingPoint {
                contest: h["contest"]["title"].as_str()?.to_string(),
                at: h["contest"]["startTime"].as_i64()? * 1000,
                rating: h["rating"].as_f64()?.round(),
                rank: h["ranking"].as_i64(),
            })
        })
        .collect();
    let account = AccountInfo {
        rating: ranking["rating"].as_f64().map(f64::round),
        max_rating: ratings.iter().map(|r| r.rating).reduce(f64::max),
        rank_title: ranking["badge"]["name"].as_str().map(String::from),
        solved: Some(count("All")),
        contests: ranking["attendedContestsCount"].as_i64().unwrap_or(0),
        meta: json!({
            "easy": count("Easy"),
            "medium": count("Medium"),
            "hard": count("Hard"),
            "ranking": user["profile"]["ranking"],
            "topPercentage": ranking["topPercentage"],
        }),
    };
    let submissions = data["recentAcSubmissionList"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let slug = s["titleSlug"].as_str()?;
            Some(Submission {
                problem: ProblemInfo {
                    code: slug.to_string(),
                    name: s["title"].as_str().unwrap_or(slug).to_string(),
                    url: Some(format!("https://leetcode.com/problems/{slug}/")),
                    ..Default::default()
                },
                // Timestamps arrive as strings of seconds.
                at: s["timestamp"].as_str()?.parse::<i64>().ok()? * 1000,
                accepted: true,
            })
        })
        .collect();
    Ok(Fetched {
        account,
        submissions,
        ratings,
    })
}

pub fn apply_question(problem: &mut ProblemInfo, q: &JsonValue) {
    if q.is_null() {
        return;
    }
    if let Some(id) = q["questionFrontendId"].as_str() {
        problem.name = format!("{id}. {}", problem.name);
    }
    problem.difficulty = q["difficulty"].as_str().map(String::from);
    problem.tags = q["topicTags"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| t["name"].as_str().map(|n| n.to_lowercase()))
        .collect();
}

pub fn upcoming(http: &Http) -> Result<Vec<Contest>> {
    let data = http.graphql(
        URL,
        "{ topTwoContests { title titleSlug startTime duration } }",
        json!({}),
    )?;
    Ok(parse_contests(&data["topTwoContests"]))
}

pub fn parse_contests(list: &JsonValue) -> Vec<Contest> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let slug = c["titleSlug"].as_str()?;
            Some(Contest {
                code: slug.to_string(),
                name: c["title"].as_str()?.to_string(),
                url: format!("https://leetcode.com/contest/{slug}"),
                start_at: c["startTime"].as_i64()? * 1000,
                duration_min: c["duration"].as_i64().unwrap_or(0) / 60,
            })
        })
        .collect()
}
