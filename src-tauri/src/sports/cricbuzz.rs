//! Cricket from Cricbuzz. It has no open API, but its pages embed their data
//! as React Server Components payloads (`self.__next_f.push(...)`); this
//! adapter joins those and reads the JSON objects it needs.

use std::collections::HashSet;

use chrono::Datelike;
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

/// The page slug Cricbuzz builds from a name: `M S Dhoni` → `m-s-dhoni`.
pub fn slugify(name: &str) -> String {
    name.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Cricbuzz's blank silhouettes, shown for players without a photo.
const NO_PHOTO: [i64; 2] = [174146, 182026];

fn photo(id: Option<i64>) -> Option<String> {
    id.filter(|i| !NO_PHOTO.contains(i))
        .map(|i| format!("https://static.cricbuzz.com/a/img/v1/152x152/i1/c{i}/i.jpg"))
}

/// Players linked from a page: (id, slug, name).
pub fn parse_players(html: &str) -> Vec<(String, String, String)> {
    let link = Regex::new(r#"/profiles/(\d+)/([a-z0-9-]+)(?:"\s+title="([^"]+)")?"#).unwrap();
    let mut seen = HashSet::new();
    link.captures_iter(html)
        .filter_map(|c| {
            let name = c
                .get(3)
                .map(|t| t.as_str().to_string())
                .unwrap_or_else(|| title_from_slug(&c[2]));
            seen.insert(c[1].to_string())
                .then(|| (c[1].to_string(), c[2].to_string(), name))
        })
        .collect()
}

/// Franchise leagues whose latest squads join the search index, by the
/// start of their series slugs.
const LEAGUES: [&str; 11] = [
    "indian-premier-league-",
    "pakistan-super-league-",
    "big-bash-league-",
    "sa20",
    "the-hundred-mens-competition-",
    "caribbean-premier-league-",
    "major-league-cricket-",
    "international-league-t20-",
    "lanka-premier-league-",
    "bangladesh-premier-league-",
    "super-smash-",
];

/// Series linked from a page: (id, slug), newest (highest id) first.
pub fn parse_series(html: &str) -> Vec<(i64, String)> {
    let link = Regex::new(r"/cricket-series/(\d+)/([a-z0-9-]+)").unwrap();
    let mut out: Vec<(i64, String)> = link
        .captures_iter(html)
        .filter_map(|c| Some((c[1].parse().ok()?, c[2].to_string())))
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out.dedup_by_key(|s| s.0);
    out
}

/// The squads on a series' squads page: (squad id, team name).
pub fn parse_squads(text: &str) -> Vec<(i64, String)> {
    let Some(JsonValue::Array(squads)) = value_of(text, "squads") else {
        return Vec::new();
    };
    squads
        .iter()
        .filter_map(|s| {
            let team = s["squadType"].as_str()?;
            // The Hundred calls them "Welsh Fire Squad".
            let team = team.strip_suffix(" Squad").unwrap_or(team);
            Some((number(&s["squadId"])?, team.to_string()))
        })
        .collect()
}

/// One squad's players from Cricbuzz's squad endpoint, labelled with the team.
pub fn parse_squad(squad: &JsonValue, team: &str) -> Vec<Candidate> {
    squad["player"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let id = p["id"]
                .as_str()
                .map(String::from)
                .or_else(|| number(&p["id"]).map(|i| i.to_string()))?;
            let name = p["name"].as_str()?.to_string();
            let subtitle = [Some(team), p["role"].as_str()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
            Some(Candidate {
                id: follow_id(Sport::Cricket, Kind::Player, &id),
                sport: "cricket".into(),
                kind: "player".into(),
                r#ref: id,
                league: Some(slugify(&name)),
                name,
                subtitle: Some(subtitle),
                image: photo(number(&p["imageId"])),
            })
        })
        .collect()
}

/// Players in a league's latest season with published squads.
fn league_players(http: &Http, series: &[(i64, String)], league: &str) -> Vec<Candidate> {
    let seasons = series
        .iter()
        .filter(|(_, slug)| slug.starts_with(league) && !slug.contains("women"));
    for (id, slug) in seasons.take(2) {
        let Ok(html) = page(http, &format!("/cricket-series/{id}/{slug}/squads")) else {
            continue;
        };
        let mut out = Vec::new();
        for (squad, team) in parse_squads(&flight(&html)) {
            pause(150);
            if let Ok(json) = page(
                http,
                &format!("/api/cricket-series/series-squads/{id}/{squad}"),
            )
            .and_then(|b| Ok(serde_json::from_str::<JsonValue>(&b)?))
            {
                out.extend(parse_squad(&json, &team));
            }
            // A season whose squads are not out yet: try the one before.
            if out.is_empty() {
                break;
            }
        }
        if !out.is_empty() {
            return out;
        }
    }
    Vec::new()
}

const SITEMAP: &str = "T20 leagues";

/// Every team and the players of international and franchise squads, for
/// local search.
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

    let year = chrono::Utc::now().year();
    let mut series = Vec::new();
    for path in [
        "/cricket-schedule/series/league".to_string(),
        format!("/cricket-scorecard-archives/{year}"),
        format!("/cricket-scorecard-archives/{}", year - 1),
    ] {
        pause(300);
        if let Ok(html) = page(http, &path) {
            series.extend(parse_series(&html));
        }
    }
    series.sort_by(|a, b| b.0.cmp(&a.0));
    series.dedup_by_key(|s| s.0);

    let player = |pid: &str, slug: &str, name: &str, subtitle: &str| Candidate {
        id: follow_id(Sport::Cricket, Kind::Player, pid),
        sport: "cricket".into(),
        kind: "player".into(),
        r#ref: pid.to_string(),
        name: name.to_string(),
        subtitle: Some(subtitle.into()),
        // The profile slug; profile pages need it.
        league: Some(slug.to_string()),
        image: None,
    };
    let (national, leagues) = std::thread::scope(|scope| {
        let national = scope.spawn(|| {
            let mut found = Vec::new();
            for (slug, id) in SQUADS {
                if let Ok(html) = page(http, &format!("/cricket-team/{slug}/{id}/players")) {
                    for (pid, pslug, name) in parse_players(&html) {
                        found.push(player(&pid, &pslug, &name, &title_from_slug(slug)));
                    }
                }
                pause(300);
            }
            if let Ok(xml) = page(http, "/sitemap/cricket-player-profile.xml") {
                for (pid, pslug, name) in parse_players(&xml) {
                    found.push(player(&pid, &pslug, &name, SITEMAP));
                }
            }
            found
        });
        let leagues: Vec<_> = LEAGUES
            .iter()
            .map(|league| {
                let series = &series;
                scope.spawn(move || league_players(http, series, league))
            })
            .collect();
        (
            national.join().unwrap_or_default(),
            leagues
                .into_iter()
                .flat_map(|h| h.join().unwrap_or_default())
                .collect::<Vec<_>>(),
        )
    });

    // National squads name a player's country; franchise squads add photos
    // and everyone else.
    let mut players: Vec<Candidate> = Vec::new();
    let mut at = std::collections::HashMap::new();
    for c in national.into_iter().chain(leagues) {
        match at.get(&c.r#ref) {
            Some(&i) => {
                let known: &mut Candidate = &mut players[i];
                if known.image.is_none() {
                    known.image = c.image;
                }
                // The sitemap only knows they play somewhere.
                if known.subtitle.as_deref() == Some(SITEMAP) {
                    known.subtitle = c.subtitle;
                }
            }
            None => {
                at.insert(c.r#ref.clone(), players.len());
                players.push(c);
            }
        }
    }
    out.extend(players);
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
            league: Some(c[2].to_string()),
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
        // Cricbuzz's "T20" column is T20 internationals.
        .filter_map(|h| {
            h.as_str().map(|f| {
                if f == "T20" {
                    "T20I".into()
                } else {
                    f.to_string()
                }
            })
        })
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
        image: photo(value_of(text, "faceImageId").as_ref().and_then(number)),
        season_label: "International career".into(),
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

    // Headline numbers over international formats, or over the league
    // the player has played most in when they have no international caps.
    let sum = |t: &Option<StatTable>, col: &str, formats: &[&str]| -> i64 {
        let Some(t) = t else { return 0 };
        let Some(i) = t.columns.iter().position(|c| c == col) else {
            return 0;
        };
        t.rows
            .iter()
            .filter(|r| formats.contains(&r.label.as_str()))
            .filter_map(|r| r.values.get(i)?.parse::<i64>().ok())
            .sum()
    };
    const INTL: [&str; 4] = ["Test", "ODI", "T20", "T20I"];
    let played = |r: &StatRow| -> i64 {
        bat.as_ref()
            .and_then(|b| b.columns.iter().position(|c| c == "Matches"))
            .and_then(|i| r.values.get(i)?.parse().ok())
            .unwrap_or(0)
    };
    let league = bat.as_ref().and_then(|b| {
        b.rows
            .iter()
            .filter(|r| !INTL.contains(&r.label.as_str()))
            .max_by_key(|r| played(r))
            .map(|r| r.label.clone())
    });
    let (formats, prefix): (Vec<&str>, String) = match &league {
        Some(l) if sum(&bat, "Matches", &INTL) == 0 && sum(&bat, "Matches", &[l]) > 0 => {
            (vec![l.as_str()], l.clone())
        }
        _ => (INTL.to_vec(), "Intl".into()),
    };
    stats.season_label = if prefix == "Intl" {
        "International career".into()
    } else {
        format!("{prefix} career")
    };
    let matches = sum(&bat, "Matches", &formats);
    let runs = sum(&bat, "Runs", &formats);
    let wickets = sum(&bowl, "Wickets", &formats);
    stats.highlights = vec![
        Highlight {
            label: format!("{prefix} matches"),
            value: matches.to_string(),
        },
        Highlight {
            label: format!("{prefix} runs"),
            value: runs.to_string(),
        },
    ];
    let bowler = wickets > runs / 25;
    if bowler {
        stats.highlights.push(Highlight {
            label: format!("{prefix} wickets"),
            value: wickets.to_string(),
        });
    } else {
        stats.highlights.push(Highlight {
            label: format!("{prefix} 100s"),
            value: sum(&bat, "100s", &formats).to_string(),
        });
    }
    // Average in the format they have played most: bowling for bowlers.
    let (table, column, what) = if bowler {
        (&bowl, "Avg", "bowling avg")
    } else {
        (&bat, "Average", "average")
    };
    let most = bat
        .as_ref()
        .and_then(|b| {
            b.rows
                .iter()
                .filter(|r| formats.contains(&r.label.as_str()))
                .max_by_key(|r| played(r))
        })
        .map(|r| r.label.clone());
    if let (Some(t), Some(format)) = (table, most)
        && let Some(i) = t.columns.iter().position(|c| c == column)
        && let Some(row) = t.rows.iter().find(|r| r.label == format)
    {
        stats.highlights.push(Highlight {
            label: format!("{format} {what}"),
            value: row.values.get(i).cloned().unwrap_or_default(),
        });
    }
    stats.career.extend(bat);
    stats.career.extend(bowl);
    Ok(stats)
}

/// A player's profile. Cricbuzz needs the name slug in the address; a
/// made-up one only sometimes works.
pub fn player_stats(http: &Http, player: &str, slug: &str) -> Result<PlayerStats> {
    let path = format!("/profiles/{player}/{slug}");
    let html = page(http, &path).or_else(|_| {
        pause(500);
        page(http, &path)
    })?;
    parse_player(&flight(&html))
}
