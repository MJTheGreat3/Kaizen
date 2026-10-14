use std::collections::HashSet;

use rusqlite::Connection;
use serde_json::json;

use super::*;
use crate::db::migrations::migrate;

fn sub(code: &str, at: i64, accepted: bool) -> Submission {
    Submission {
        problem: ProblemInfo {
            code: code.into(),
            name: format!("Problem {code}"),
            rating: Some(1200.0),
            tags: vec!["dp".into()],
            ..Default::default()
        },
        at,
        accepted,
    }
}

fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO cp_accounts (id, handle, created_at, updated_at, device_id) VALUES ('codeforces', 'me', 1, 1, 'd')",
        [],
    )
    .unwrap();
    conn
}

#[test]
fn store_merges_submissions_into_problems_and_records_first_solves() {
    let conn = db();
    let fetched = Fetched {
        account: AccountInfo {
            rating: Some(1450.0),
            ..Default::default()
        },
        submissions: vec![
            sub("1A", 1_000, false),
            sub("1A", 2_000, true),
            sub("1A", 3_000, true),
            sub("2B", 4_000, false),
        ],
        ratings: vec![RatingPoint {
            contest: "Round 1".into(),
            at: 500,
            rating: 1450.0,
            rank: Some(10),
        }],
    };
    assert_eq!(store(&conn, Platform::Codeforces, &fetched, 0).unwrap(), 1);

    let (attempts, solved_at, first_at): (i64, Option<i64>, i64) = conn
        .query_row(
            "SELECT attempts, solved_at, first_at FROM cp_problems WHERE id = 'cf:1A'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((attempts, solved_at, first_at), (3, Some(2_000), 1_000));
    let (solved, cursor, rating): (i64, i64, f64) = conn
        .query_row(
            "SELECT solved, cursor, rating FROM cp_accounts WHERE id = 'codeforces'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((solved, cursor, rating), (1, 4_000, 1450.0));
    let events: i64 = conn
        .query_row(
            "SELECT count(*) FROM activity_events WHERE type_id = 'cp' AND source_id = 'cf:1A'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(events, 1);

    // Notes survive refreshes; a later fetch only adds what is newer than the cursor.
    conn.execute(
        "UPDATE cp_problems SET notes = 'knapsack trick' WHERE id = 'cf:2B'",
        [],
    )
    .unwrap();
    let later = Fetched {
        submissions: vec![sub("2B", 4_000, false), sub("2B", 5_000, true)],
        ..Default::default()
    };
    assert_eq!(
        store(&conn, Platform::Codeforces, &later, 4_000).unwrap(),
        1
    );
    let (attempts, notes): (i64, String) = conn
        .query_row(
            "SELECT attempts, notes FROM cp_problems WHERE id = 'cf:2B'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((attempts, notes.as_str()), (2, "knapsack trick"));

    // Fetching nothing new changes no problem rows.
    let before: i64 = conn
        .query_row(
            "SELECT count(*) FROM sync_clock WHERE table_name = 'cp_problems'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    store(&conn, Platform::Codeforces, &Fetched::default(), 5_000).unwrap();
    let after: i64 = conn
        .query_row(
            "SELECT count(*) FROM sync_clock WHERE table_name = 'cp_problems'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, after);

    // Solved problems are searchable.
    let hits: i64 = conn
        .query_row("SELECT count(*) FROM search_index WHERE src = 'cp_problems' AND search_index MATCH 'knapsack'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(hits, 1);
}

#[test]
fn a_fetch_without_names_keeps_the_stored_ones() {
    let conn = db();
    store(
        &conn,
        Platform::Codeforces,
        &Fetched {
            submissions: vec![sub("1A", 1_000, true)],
            ..Default::default()
        },
        0,
    )
    .unwrap();
    let mut nameless = sub("1A", 2_000, true);
    nameless.problem.name = "1A".into();
    nameless.problem.tags.clear();
    store(
        &conn,
        Platform::Codeforces,
        &Fetched {
            submissions: vec![nameless],
            ..Default::default()
        },
        1_000,
    )
    .unwrap();
    let (name, tags): (String, String) = conn
        .query_row(
            "SELECT name, tags FROM cp_problems WHERE id = 'cf:1A'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((name.as_str(), tags.as_str()), ("Problem 1A", "[\"dp\"]"));
}

#[test]
fn parses_codeforces() {
    let subs = codeforces::parse_submissions(&json!([
        { "id": 3, "creationTimeSeconds": 300, "verdict": "OK",
          "problem": { "contestId": 1520, "index": "A", "name": "Do Not Be Distracted!", "rating": 800, "tags": ["brute force", "implementation"] } },
        { "id": 2, "creationTimeSeconds": 200, "verdict": "WRONG_ANSWER",
          "problem": { "contestId": 102000, "index": "B", "name": "Gym one", "tags": [] } },
        { "id": 1, "creationTimeSeconds": 100, "verdict": "TESTING", "problem": { "contestId": 1, "index": "A", "name": "x" } }
    ]));
    assert_eq!(subs.len(), 2);
    assert_eq!(subs[0].problem.code, "1520A");
    assert_eq!(
        subs[0].problem.url.as_deref(),
        Some("https://codeforces.com/problemset/problem/1520/A")
    );
    assert_eq!(subs[0].problem.difficulty.as_deref(), Some("800"));
    assert!(subs[0].accepted && !subs[1].accepted);
    assert_eq!(
        subs[1].problem.url.as_deref(),
        Some("https://codeforces.com/gym/102000/problem/B")
    );
    assert_eq!(subs[0].at, 300_000);

    let account = codeforces::parse_account(
        &json!({ "rating": 1500, "maxRating": 1620, "rank": "specialist", "maxRank": "expert" }),
        12,
    );
    assert_eq!(account.rank_title.as_deref(), Some("Specialist"));
    assert_eq!(
        (account.rating, account.max_rating, account.contests),
        (Some(1500.0), Some(1620.0), 12)
    );

    let contests = codeforces::parse_contests(&json!([
        { "id": 2100, "name": "Codeforces Round 1000 (Div. 2)", "phase": "BEFORE", "startTimeSeconds": 1_800_000_000, "durationSeconds": 7200 },
        { "id": 2000, "name": "Old", "phase": "FINISHED", "startTimeSeconds": 1, "durationSeconds": 7200 }
    ]));
    assert_eq!(contests.len(), 1);
    assert_eq!(
        (contests[0].duration_min, contests[0].url.as_str()),
        (120, "https://codeforces.com/contests/2100")
    );
}

#[test]
fn parses_leetcode() {
    let data = json!({
        "matchedUser": { "username": "me", "profile": { "ranking": 12345 },
          "submitStatsGlobal": { "acSubmissionNum": [
            { "difficulty": "All", "count": 300 }, { "difficulty": "Easy", "count": 120 },
            { "difficulty": "Medium", "count": 150 }, { "difficulty": "Hard", "count": 30 } ] } },
        "userContestRanking": { "rating": 1834.62, "attendedContestsCount": 15, "topPercentage": 9.1, "badge": null },
        "userContestRankingHistory": [
          { "attended": false, "rating": 1500, "ranking": 0, "contest": { "title": "Weekly 1", "startTime": 100 } },
          { "attended": true, "rating": 1650.4, "ranking": 900, "contest": { "title": "Weekly 2", "startTime": 200 } },
          { "attended": true, "rating": 1834.6, "ranking": 400, "contest": { "title": "Weekly 3", "startTime": 300 } } ],
        "recentAcSubmissionList": [ { "title": "Two Sum", "titleSlug": "two-sum", "timestamp": "1700000000" } ]
    });
    let f = leetcode::parse_profile(&data).unwrap();
    assert_eq!(f.account.solved, Some(300));
    assert_eq!(f.account.meta["medium"], 150);
    assert_eq!(
        (f.account.rating, f.account.max_rating),
        (Some(1835.0), Some(1835.0))
    );
    assert_eq!(f.ratings.len(), 2);
    assert_eq!(f.submissions[0].at, 1_700_000_000_000);

    let mut p = f.submissions[0].problem.clone();
    leetcode::apply_question(
        &mut p,
        &json!({ "questionFrontendId": "1", "difficulty": "Easy", "topicTags": [{ "name": "Array" }, { "name": "Hash Table" }] }),
    );
    assert_eq!(p.name, "1. Two Sum");
    assert_eq!(p.tags, vec!["array", "hash table"]);

    assert!(matches!(
        leetcode::parse_profile(&json!({ "matchedUser": null })),
        Err(Error::Invalid(_))
    ));
    let _ = HashSet::<String>::new();
}

#[test]
fn parses_atcoder() {
    let history = atcoder::parse_history(&json!([
        { "IsRated": true, "Place": 812, "NewRating": 820, "ContestName": "AtCoder Beginner Contest 300", "EndTime": "2023-04-29T22:40:00+09:00" },
        { "IsRated": false, "Place": 1, "NewRating": 820, "ContestName": "Unrated", "EndTime": "2023-05-01T22:40:00+09:00" }
    ]));
    assert_eq!(history.len(), 1);
    let account = atcoder::account_from(&history);
    assert_eq!(account.rank_title.as_deref(), Some("Green"));

    let mut subs = atcoder::parse_submissions(&json!([
        { "id": 1, "epoch_second": 1_682_773_000, "problem_id": "abc300_a", "contest_id": "abc300", "result": "AC" },
        { "id": 2, "epoch_second": 1_682_773_100, "problem_id": "abc300_b", "contest_id": "abc300", "result": "WA" },
        { "id": 3, "epoch_second": 1_682_773_200, "problem_id": "abc300_c", "contest_id": "abc300", "result": "WJ" }
    ]));
    assert_eq!(subs.len(), 2);
    atcoder::apply_problems(
        &mut subs,
        &json!([{ "id": "abc300_a", "title": "A. N-choice question" }]),
        &json!({ "abc300_a": { "difficulty": -500.0 }, "abc300_b": { "difficulty": 612.4 } }),
    );
    assert_eq!(subs[0].problem.name, "A. N-choice question");
    assert_eq!(subs[0].problem.rating, Some(42.0));
    assert_eq!(subs[1].problem.name, "abc300_b");
    assert_eq!(subs[1].problem.rating, Some(612.0));
    assert_eq!(
        subs[0].problem.url.as_deref(),
        Some("https://atcoder.jp/contests/abc300/tasks/abc300_a")
    );

    let upcoming = atcoder::parse_upcoming(include_str!("fixtures/atcoder_upcoming.html"));
    assert!(upcoming.len() >= 2, "{upcoming:?}");
    let ahc = &upcoming[0];
    assert_eq!(ahc.code, "ahc073");
    assert_eq!(ahc.duration_min, 240);
    // 2026-10-17 15:00 JST.
    assert_eq!(ahc.start_at, 1_792_216_800_000);
}

#[test]
fn parses_codechef() {
    let (account, ratings) =
        codechef::parse_profile(include_str!("fixtures/codechef_profile.html")).unwrap();
    assert_eq!(account.rating, Some(3355.0));
    assert_eq!(account.max_rating, Some(3445.0));
    assert_eq!(account.rank_title.as_deref(), Some("7★"));
    assert_eq!(account.solved, Some(632));
    assert_eq!(ratings.len(), 3);
    assert!(matches!(
        codechef::parse_profile("<html>home</html>"),
        Err(Error::Invalid(_))
    ));

    let subs = codechef::parse_recent(include_str!("fixtures/codechef_recent.html"), 0);
    assert_eq!(subs.len(), 3);
    assert_eq!(subs[0].problem.code, "BEAUTY_SUM");
    assert!(subs[0].accepted);
    // 01:52 AM 06/08/24 IST.
    assert_eq!(subs[0].at, 1_722_889_320_000);
    assert_eq!(codechef::parse_time("5 min ago", 600_000), Some(300_000));
    assert_eq!(
        codechef::parse_time("2 hours ago", 10_000_000),
        Some(2_800_000)
    );

    let contests = codechef::parse_contests(&json!({
        "present_contests": [],
        "future_contests": [{ "contest_code": "START260", "contest_name": "Starters 260",
          "contest_start_date_iso": "2026-10-14T20:00:00+05:30", "contest_duration": "120" }]
    }));
    assert_eq!(contests[0].url, "https://www.codechef.com/START260");
    assert_eq!(contests[0].duration_min, 120);
}

/// Hits the real sites: `cargo test --lib practice::tests::live -- --ignored --nocapture`.
#[test]
#[ignore]
fn live() {
    let http = Http::new();
    for (platform, handle) in [
        (Platform::Codeforces, "tourist"),
        (Platform::LeetCode, "lee215"),
        (Platform::AtCoder, "tourist"),
        (Platform::CodeChef, "gennady.korotkevich"),
    ] {
        let cursor = chrono::Utc::now().timestamp_millis() - 400 * 86_400_000;
        match platform.fetch(&http, handle, cursor, &HashSet::new()) {
            Ok(f) => println!(
                "{}: rating {:?} max {:?} {:?} solved {:?}, {} new submissions, {} ratings",
                platform.id(),
                f.account.rating,
                f.account.max_rating,
                f.account.rank_title,
                f.account.solved,
                f.submissions.len(),
                f.ratings.len()
            ),
            Err(e) => println!("{}: ERROR {e}", platform.id()),
        }
        match platform.upcoming(&http) {
            Ok(c) => println!(
                "  upcoming: {:?}",
                c.iter().map(|c| &c.name).take(3).collect::<Vec<_>>()
            ),
            Err(e) => println!("  upcoming ERROR {e}"),
        }
    }
}
