//! Cricket from Cricbuzz. It has no open API, but its pages embed their data
//! as React Server Components payloads (`self.__next_f.push(...)`); this
//! adapter joins those and reads the JSON objects it needs.

use std::collections::HashSet;

use regex::Regex;
use serde_json::Value as JsonValue;

use super::{
    Candidate, Game, Highlight, Kind, PlayerStats, Side, Sport, StatRow, StatTable, follow_id,
    title_from_slug,
};
use crate::error::{Error, Result};
use crate::practice::http::{Http, pause};

const SITE: &str = "https://www.cricbuzz.com";

/// Teams whose player lists seed the search index.
const SQUADS: [(&str, &str); 12] = [
    ("india", "2"),
    ("australia", "4"),
    ("england", "9"),
    ("pakistan", "3"),
    ("south-africa", "11"),
    ("new-zealand", "13"),
    ("sri-lanka", "5"),
    ("west-indies", "10"),
    ("bangladesh", "6"),
    ("afghanistan", "96"),
    ("ireland", "27"),
    ("zimbabwe", "12"),
];

/// The page's embedded payload as one string.
pub fn flight(html: &str) -> String {
    let push = Regex::new(r#"self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)"#).unwrap();
    push.captures_iter(html)
        .filter_map(|c| serde_json::from_str::<String>(&format!("\"{}\"", &c[1])).ok())
        .collect()
}

/// The JSON value starting at byte `at`.
fn value_at(text: &str, at: usize) -> Option<JsonValue> {
    serde_json::Deserializer::from_str(&text[at..])
        .into_iter::<JsonValue>()
        .next()?
        .ok()
}

/// The value of the first `"key":` in the payload.
fn value_of(text: &str, key: &str) -> Option<JsonValue> {
    let needle = format!("\"{key}\":");
    let at = text.find(&needle)? + needle.len();
    value_at(text, at)
}

/// The object that encloses the first `"key":`.
fn object_around(text: &str, key: &str) -> Option<JsonValue> {
    let at = text.find(&format!("\"{key}\":"))?;
    let mut depth = 0;
    for (i, ch) in text[..at].char_indices().rev() {
        match ch {
            '}' => depth += 1,
            '{' if depth == 0 => return value_at(text, i),
            '{' => depth -= 1,
            _ => {}
        }
    }
    None
}

fn page(http: &Http, path: &str) -> Result<String> {
    let (status, body) = http.raw(&format!("{SITE}{path}"))?;
    match status {
        200..=299 => Ok(body),
        404 => Err(Error::Invalid("Cricbuzz has no page for this one".into())),
        _ => Err(Error::Http(format!("Cricbuzz returned {status}"))),
    }
}

/// Teams from a team list page: (id, slug, name).
pub fn parse_teams(html: &str) -> Vec<(String, String, String)> {
    let link = Regex::new(r#"<a href="/cricket-team/([a-z0-9-]+)/(\d+)""#).unwrap();
    let text = Regex::new(r">\s*([^<>\s][^<>]{1,59})<").unwrap();
    let mut seen = HashSet::new();
    link.captures_iter(html)
        .filter_map(|c| {
            let m = c.get(0)?;
            let rest = &html[m.end()..(m.end() + 1500).min(html.len())];
            // Only the link's own text.
            let rest = &rest[..rest.find("</a>").unwrap_or(rest.len())];
            let name = text
                .captures(rest)
                .map(|t| t[1].trim().to_string())
                .unwrap_or_else(|| title_from_slug(&c[1]));
            seen.insert(c[2].to_string())
                .then(|| (c[2].to_string(), c[1].to_string(), name))
        })
        .collect()
}

/// Players linked from a page: (id, name).
pub fn parse_players(html: &str) -> Vec<(String, String)> {
    let link = Regex::new(r#"/profiles/(\d+)/([a-z0-9-]+)(?:"\s+title="([^"]+)")?"#).unwrap();
    let mut seen = HashSet::new();
    link.captures_iter(html)
        .filter_map(|c| {
            let name = c
                .get(3)
                .map(|t| t.as_str().to_string())
                .unwrap_or_else(|| title_from_slug(&c[2]));
            seen.insert(c[1].to_string())
                .then(|| (c[1].to_string(), name))
        })
        .collect()
}

/// Every team and a few hundred current players, for local search.
pub fn index(http: &Http) -> Result<Vec<Candidate>> {
    let mut out = Vec::new();
    let team = |id: &str, slug: &str, name: &str, subtitle: &str| Candidate {
        id: follow_id(Sport::Cricket, Kind::Team, id),
        sport: "cricket".into(),
        kind: "team".into(),
        r#ref: id.to_string(),
        name: name.to_string(),
        subtitle: Some(subtitle.into()),
        // The page slug; team pages need it.
        league: Some(slug.to_string()),
        image: None,
    };
    for (id, slug, name) in parse_teams(&page(http, "/cricket-team")?) {
        out.push(team(&id, &slug, &name, "International"));
    }
    pause(300);
    if let Ok(html) = page(http, "/cricket-team/league") {
        for (id, slug, name) in parse_teams(&html) {
            if !out.iter().any(|c| c.r#ref == id) {
                out.push(team(&id, &slug, &name, "League"));
            }
        }
    }
    let mut players: Vec<(String, String, String)> = Vec::new();
    for (slug, id) in SQUADS {
        pause(300);
        if let Ok(html) = page(http, &format!("/cricket-team/{slug}/{id}/players")) {
            for (pid, name) in parse_players(&html) {
                players.push((pid, name, title_from_slug(slug)));
            }
        }
    }
    pause(300);
    if let Ok(xml) = page(http, "/sitemap/cricket-player-profile.xml") {
        for (pid, name) in parse_players(&xml) {
            players.push((pid, name, "T20 leagues".into()));
        }
    }
    let mut seen = HashSet::new();
    for (pid, name, subtitle) in players {
        if seen.insert(pid.clone()) {
            out.push(Candidate {
                id: follow_id(Sport::Cricket, Kind::Player, &pid),
                sport: "cricket".into(),
                kind: "player".into(),
                r#ref: pid,
                name,
                subtitle: Some(subtitle),
                league: None,
                image: None,
            });
        }
    }
    if out.is_empty() {
        return Err(Error::Invalid("Cricbuzz's team list has changed".into()));
    }
    Ok(out)
}

/// Searches the index; a pasted Cricbuzz profile or team link also works.
pub fn filter(index: &[Candidate], kind: Kind, query: &str) -> Vec<Candidate> {
    let profile = Regex::new(r"cricbuzz\.com/profiles/(\d+)/([a-z0-9-]+)").unwrap();
    let team_link = Regex::new(r"cricbuzz\.com/cricket-team/([a-z0-9-]+)/(\d+)").unwrap();
    if let (Kind::Player, Some(c)) = (kind, profile.captures(query)) {
        return vec![Candidate {
            id: follow_id(Sport::Cricket, Kind::Player, &c[1]),
            sport: "cricket".into(),
            kind: "player".into(),
            r#ref: c[1].to_string(),
            name: title_from_slug(&c[2]),
            ..Default::default()
        }];
    }
    if let (Kind::Team, Some(c)) = (kind, team_link.captures(query)) {
        return vec![Candidate {
            id: follow_id(Sport::Cricket, Kind::Team, &c[2]),
            sport: "cricket".into(),
            kind: "team".into(),
            r#ref: c[2].to_string(),
            name: title_from_slug(&c[1]),
            league: Some(c[1].to_string()),
            ..Default::default()
        }];
    }
    let words: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .map(String::from)
        .collect();
    let mut hits: Vec<(usize, &Candidate)> = index
        .iter()
        .filter(|c| c.kind == kind.id())
        .filter_map(|c| {
            let name = c.name.to_lowercase();
            words.iter().all(|w| name.contains(w.as_str())).then(|| {
                // Whole-word and prefix matches first.
                let rank = if name.starts_with(&words[0]) {
                    0
                } else if name.split_whitespace().any(|n| n.starts_with(&words[0])) {
                    1
                } else {
                    2
                };
                (rank, c)
            })
        })
        .collect();
    hits.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.name.len().cmp(&b.1.name.len())));
    hits.into_iter().take(25).map(|(_, c)| c.clone()).collect()
}

fn innings(v: &JsonValue) -> Option<String> {
    let runs = v["runs"].as_i64()?;
    let wickets = v["wickets"].as_i64().unwrap_or(0);
    let mut s = if wickets >= 10 {
        runs.to_string()
    } else {
        format!("{runs}/{wickets}")
    };
    if v["isDeclared"].as_bool() == Some(true) {
        s.push('d');
    }
    Some(s)
}

fn score(team_score: &JsonValue) -> Option<String> {
    let parts: Vec<String> = ["inngs1", "inngs2"]
        .iter()
        .filter_map(|k| innings(&team_score[*k]))
        .collect();
    (!parts.is_empty()).then(|| parts.join(" & "))
}

fn state(s: &str) -> &'static str {
    match s.to_lowercase().as_str() {
        "preview" | "upcoming" => "pre",
        "complete" | "abandon" | "abandoned" | "cancelled" | "no result" => "post",
        _ => "in",
    }
}

fn number(v: &JsonValue) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str()?.parse().ok())
}

/// A team's matches on a schedule or results page (which also shows
/// other teams' matches around the list).
pub fn parse_games(text: &str, team: &str) -> Vec<Game> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for (at, _) in text.match_indices("{\"matchInfo\":") {
        let Some(m) = value_at(text, at) else {
            continue;
        };
        let info = &m["matchInfo"];
        let Some(id) = number(&info["matchId"]) else {
            continue;
        };
        let plays = |t: &JsonValue| number(&t["teamId"]).is_some_and(|i| i.to_string() == team);
        if !plays(&info["team1"]) && !plays(&info["team2"]) {
            continue;
        }
        if !seen.insert(id) {
            continue;
        }
        let side = |t: &JsonValue, s: &JsonValue| Side {
            name: t["teamName"].as_str().unwrap_or_default().to_string(),
            short: t["teamSName"].as_str().unwrap_or_default().to_string(),
            logo: number(&t["imageId"])
                .map(|i| format!("https://static.cricbuzz.com/a/img/v1/72x54/i1/c{i}/i.jpg")),
            score: score(s),
        };
        let st = info["state"].as_str().unwrap_or("Upcoming");
        out.push(Game {
            id: id.to_string(),
            start_at: number(&info["startDate"]).unwrap_or(0),
            league: info["seriesName"].as_str().map(String::from),
            title: info["matchDesc"].as_str().map(String::from),
            home: side(&info["team1"], &m["matchScore"]["team1Score"]),
            away: side(&info["team2"], &m["matchScore"]["team2Score"]),
            state: state(st).into(),
            status: info["status"].as_str().unwrap_or(st).to_string(),
            url: Some(format!("{SITE}/live-cricket-scores/{id}")),
        });
    }
    out
}

pub fn team_games(http: &Http, team: &str, slug: Option<&str>) -> Result<Vec<Game>> {
    let base = format!("/cricket-team/{}/{team}", slug.unwrap_or("x"));
    let mut games = parse_games(&flight(&page(http, &format!("{base}/schedule"))?), team);
    pause(300);
    games.extend(parse_games(
        &flight(&page(http, &format!("{base}/results"))?),
        team,
    ));
    Ok(super::espn::pick_games(games))
}

/// Cricbuzz's "row per stat, column per format" table, turned around.
fn by_format(table: &JsonValue, title: &str, keep: &[&str]) -> Option<StatTable> {
    let formats: Vec<String> = table["headers"]
        .as_array()?
        .iter()
        .skip(1)
        .filter_map(|h| h.as_str().map(String::from))
        .collect();
    let stats: Vec<(String, Vec<String>)> = table["values"]
        .as_array()?
        .iter()
        .filter_map(|r| {
            let v: Vec<String> = r["values"]
                .as_array()?
                .iter()
                .map(|x| x.as_str().unwrap_or_default().to_string())
                .collect();
            let (name, rest) = v.split_first()?;
            keep.contains(&name.as_str())
                .then(|| (name.clone(), rest.to_vec()))
        })
        .collect();
    if stats.is_empty() {
        return None;
    }
    Some(StatTable {
        title: title.into(),
        columns: stats.iter().map(|(n, _)| n.clone()).collect(),
        rows: formats
            .iter()
            .enumerate()
            .map(|(i, f)| StatRow {
                label: f.clone(),
                values: stats
                    .iter()
                    .map(|(_, v)| v.get(i).cloned().unwrap_or_default())
                    .collect(),
            })
            .collect(),
    })
}

fn recent(table: &JsonValue, title: &str, what: &str) -> Option<StatTable> {
    let rows: Vec<StatRow> = table["rows"]
        .as_array()?
        .iter()
        .filter_map(|r| {
            let v: Vec<String> = r["values"]
                .as_array()?
                .iter()
                .map(|x| x.as_str().unwrap_or_default().to_string())
                .collect();
            // [match id, figure, against, format, date]
            let [_, figure, against, format, date] = v.as_slice() else {
                return None;
            };
            Some(StatRow {
                label: date.clone(),
                values: vec![figure.clone(), against.clone(), format.clone()],
            })
        })
        .collect();
    (!rows.is_empty()).then(|| StatTable {
        title: title.into(),
        columns: vec![what.into(), "Against".into(), "Format".into()],
        rows,
    })
}

pub fn parse_player(text: &str) -> Result<PlayerStats> {
    let batting = value_of(text, "battingStats");
    let bowling = value_of(text, "bowlingStats");
    if batting.is_none() && bowling.is_none() {
        return Err(Error::Invalid(
            "Cricbuzz has no stats for this player".into(),
        ));
    }
    let info = object_around(text, "bat").unwrap_or_default();
    let mut stats = PlayerStats {
        name: info["name"].as_str().unwrap_or_default().to_string(),
        team: info["intlTeam"].as_str().map(String::from),
        position: info["role"].as_str().map(String::from),
        image: value_of(text, "faceImageId")
            .as_ref()
            .and_then(number)
            .map(|i| format!("https://static.cricbuzz.com/a/img/v1/152x152/i1/c{i}/i.jpg")),
        season_label: "Recent form".into(),
        ..Default::default()
    };

    if let Some(t) =
        value_of(text, "recentBatting").and_then(|t| recent(&t, "Recent batting", "Runs"))
    {
        stats.season.push(t);
    }
    if let Some(t) =
        value_of(text, "recentBowling").and_then(|t| recent(&t, "Recent bowling", "Figures"))
    {
        stats.season.push(t);
    }
    if let Some(r) = info.get("rankings").filter(|r| r.is_object()) {
        let rank = |kind: &str, fmt: &str| {
            r[kind][format!("{fmt}Rank")]
                .as_str()
                .unwrap_or("–")
                .to_string()
        };
        let rows: Vec<StatRow> = [
            ("bat", "Batting"),
            ("bowl", "Bowling"),
            ("all", "All-round"),
        ]
        .iter()
        .filter(|(k, _)| r[*k].is_object())
        .map(|(k, label)| StatRow {
            label: label.to_string(),
            values: ["test", "odi", "t20"].iter().map(|f| rank(k, f)).collect(),
        })
        .collect();
        if !rows.is_empty() {
            stats.season.push(StatTable {
                title: "ICC rankings".into(),
                columns: vec!["Test".into(), "ODI".into(), "T20I".into()],
                rows,
            });
        }
    }

    let bat = batting.as_ref().and_then(|b| {
        by_format(
            b,
            "Batting",
            &[
                "Matches", "Innings", "Runs", "Highest", "Average", "SR", "Not Out", "100s", "50s",
                "Fours", "Sixes",
            ],
        )
    });
    let bowl = bowling.as_ref().and_then(|b| {
        by_format(
            b,
            "Bowling",
            &["Innings", "Wickets", "Avg", "Eco", "SR", "BBI", "5w", "10w"],
        )
    });

    // Headline numbers over international formats.
    let sum = |t: &Option<StatTable>, col: &str| -> i64 {
        let Some(t) = t else { return 0 };
        let Some(i) = t.columns.iter().position(|c| c == col) else {
            return 0;
        };
        t.rows
            .iter()
            .filter(|r| matches!(r.label.as_str(), "Test" | "ODI" | "T20" | "T20I"))
            .filter_map(|r| r.values.get(i)?.parse::<i64>().ok())
            .sum()
    };
    let matches = sum(&bat, "Matches");
    let runs = sum(&bat, "Runs");
    let wickets = sum(&bowl, "Wickets");
    stats.highlights = vec![
        Highlight {
            label: "Intl matches".into(),
            value: matches.to_string(),
        },
        Highlight {
            label: "Intl runs".into(),
            value: runs.to_string(),
        },
    ];
    if wickets > runs / 25 {
        stats.highlights.push(Highlight {
            label: "Intl wickets".into(),
            value: wickets.to_string(),
        });
    } else {
        stats.highlights.push(Highlight {
            label: "Intl 100s".into(),
            value: sum(&bat, "100s").to_string(),
        });
    }
    if let Some(b) = &bat
        && let Some(i) = b.columns.iter().position(|c| c == "Average")
        && let Some(odi) = b.rows.iter().find(|r| r.label == "ODI")
    {
        stats.highlights.push(Highlight {
            label: "ODI average".into(),
            value: odi.values.get(i).cloned().unwrap_or_default(),
        });
    }
    stats.career.extend(bat);
    stats.career.extend(bowl);
    Ok(stats)
}

pub fn player_stats(http: &Http, player: &str) -> Result<PlayerStats> {
    parse_player(&flight(&page(http, &format!("/profiles/{player}/x"))?))
}
