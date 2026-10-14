//! NBA and football from ESPN's public site API: search, team schedules and
//! player stats (season and career).

use std::collections::BTreeMap;

use serde_json::Value as JsonValue;

use super::{
    Candidate, Game, Highlight, Kind, PlayerStats, Side, Sport, StatRow, StatTable, follow_id,
};
use crate::error::{Error, Result};
use crate::practice::codeforces::urlencode;
use crate::practice::http::{Http, pause};

const SEARCH: &str = "https://site.web.api.espn.com/apis/common/v3/search";
const SITE: &str = "https://site.api.espn.com/apis/site/v2/sports";
const COMMON: &str = "https://site.web.api.espn.com/apis/common/v3/sports";

/// Games kept per team: the last few results and the next fixtures.
const RESULTS: usize = 6;
const FIXTURES: usize = 8;

fn path(sport: Sport) -> &'static str {
    match sport {
        Sport::Nba => "basketball/nba",
        _ => "soccer",
    }
}

fn get(http: &Http, url: &str) -> Result<JsonValue> {
    let (status, body) = http.raw(url)?;
    match status {
        200..=299 => Ok(serde_json::from_str(&body)?),
        404 => Err(Error::Invalid("ESPN has no data for this one".into())),
        _ => Err(Error::Http(format!("ESPN returned {status}"))),
    }
}

pub fn search(http: &Http, sport: Sport, kind: Kind, query: &str) -> Result<Vec<Candidate>> {
    let url = format!(
        "{SEARCH}?query={}&limit=25&type={}",
        urlencode(query),
        kind.id()
    );
    Ok(parse_search(&get(http, &url)?, sport, kind))
}

pub fn parse_search(found: &JsonValue, sport: Sport, kind: Kind) -> Vec<Candidate> {
    found["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|it| match sport {
            Sport::Nba => it["sport"] == "basketball" && it["league"] == "nba",
            _ => it["sport"] == "soccer",
        })
        .filter_map(|it| {
            let r = it["id"].as_str()?.to_string();
            let league = it["defaultLeagueSlug"]
                .as_str()
                .or(it["league"].as_str())
                .map(String::from);
            let image = match kind {
                Kind::Team => it["logos"][0]["href"].as_str().map(String::from),
                Kind::Player => Some(format!(
                    "https://a.espncdn.com/i/headshots/{}/players/full/{r}.png",
                    if sport == Sport::Nba { "nba" } else { "soccer" }
                )),
            };
            let subtitle = it["leagueRelationships"][0]["core"]["displayName"]
                .as_str()
                .or(it["location"].as_str())
                .map(String::from)
                .or_else(|| league.clone());
            Some(Candidate {
                id: follow_id(sport, kind, &r),
                sport: sport.id().into(),
                kind: kind.id().into(),
                name: it["displayName"].as_str()?.to_string(),
                subtitle,
                league,
                image,
                r#ref: r,
            })
        })
        .collect()
}

pub fn team_games(
    http: &Http,
    sport: Sport,
    team: &str,
    league: Option<&str>,
) -> Result<Vec<Game>> {
    let mut events = Vec::new();
    match sport {
        Sport::Nba => {
            let base = format!("{SITE}/basketball/nba/teams/{team}/schedule");
            // The default season type is whichever is current (often the
            // preseason); the regular season and playoffs are separate.
            for query in ["", "?seasontype=2", "?seasontype=3"] {
                if let Ok(data) = get(http, &format!("{base}{query}")) {
                    events.extend(parse_schedule(&data));
                }
                pause(150);
            }
        }
        _ => {
            // "all" spans every competition the club plays in.
            let base = format!("{SITE}/soccer/all/teams/{team}/schedule");
            events.extend(parse_schedule(&get(http, &format!("{base}?fixture=true"))?));
            pause(150);
            events.extend(parse_schedule(&get(http, &base)?));
            if events.is_empty()
                && let Some(league) = league
            {
                let base = format!("{SITE}/soccer/{league}/teams/{team}/schedule");
                events.extend(parse_schedule(&get(http, &format!("{base}?fixture=true"))?));
                events.extend(parse_schedule(&get(http, &base)?));
            }
        }
    }
    Ok(pick_games(events))
}

/// The latest results and the next fixtures, without duplicates.
pub fn pick_games(mut games: Vec<Game>) -> Vec<Game> {
    games.sort_by(|a, b| a.start_at.cmp(&b.start_at).then(a.id.cmp(&b.id)));
    games.dedup_by(|a, b| a.id == b.id);
    let (done, rest): (Vec<_>, Vec<_>) = games.into_iter().partition(|g| g.state == "post");
    let skip = done.len().saturating_sub(RESULTS);
    done.into_iter()
        .skip(skip)
        .chain(rest.into_iter().take(FIXTURES))
        .collect()
}

fn score(v: &JsonValue) -> Option<String> {
    v["displayValue"]
        .as_str()
        .or(v.as_str())
        .map(String::from)
        .or_else(|| v.as_f64().map(|n| format!("{n}")))
}

/// ESPN dates come with or without seconds: `2026-10-04T23:00Z`.
pub fn parse_date(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|t| t.timestamp_millis())
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%MZ")
                .ok()
                .map(|t| t.and_utc().timestamp_millis())
        })
}

pub fn parse_schedule(data: &JsonValue) -> Vec<Game> {
    data["events"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let c = &e["competitions"][0];
            let side = |which: &str| -> Option<Side> {
                let x = c["competitors"]
                    .as_array()?
                    .iter()
                    .find(|x| x["homeAway"] == which)?;
                let t = &x["team"];
                Some(Side {
                    name: t["displayName"].as_str()?.to_string(),
                    short: t["abbreviation"]
                        .as_str()
                        .or(t["shortDisplayName"].as_str())
                        .unwrap_or_default()
                        .to_string(),
                    logo: t["logos"][0]["href"]
                        .as_str()
                        .or(t["logo"].as_str())
                        .map(String::from),
                    score: score(&x["score"]),
                })
            };
            let status = &c["status"]["type"];
            let state = status["state"].as_str().unwrap_or("pre").to_string();
            let mut home = side("home")?;
            let mut away = side("away")?;
            if state == "pre" {
                home.score = None;
                away.score = None;
            }
            Some(Game {
                id: e["id"].as_str()?.to_string(),
                start_at: parse_date(e["date"].as_str()?)?,
                league: e["league"]["abbreviation"]
                    .as_str()
                    .or(e["league"]["name"].as_str())
                    .or(e["seasonType"]["name"].as_str())
                    .map(String::from),
                title: c["notes"][0]["headline"].as_str().map(String::from),
                home,
                away,
                status: status["shortDetail"]
                    .as_str()
                    .or(status["description"].as_str())
                    .unwrap_or_default()
                    .to_string(),
                state,
                url: e["links"][0]["href"].as_str().map(String::from),
            })
        })
        .collect()
}

pub fn player_stats(http: &Http, sport: Sport, player: &str) -> Result<PlayerStats> {
    let info = get(http, &format!("{COMMON}/{}/athletes/{player}", path(sport)))?;
    let a = &info["athlete"];
    let mut stats = PlayerStats {
        name: a["displayName"].as_str().unwrap_or_default().to_string(),
        team: a["team"]["displayName"].as_str().map(String::from),
        position: a["position"]["displayName"].as_str().map(String::from),
        image: a["headshot"]["href"].as_str().map(String::from),
        ..Default::default()
    };
    pause(150);
    match sport {
        Sport::Nba => {
            let data = get(
                http,
                &format!("{COMMON}/basketball/nba/athletes/{player}/stats"),
            )?;
            nba_tables(&data, &mut stats);
        }
        _ => soccer_stats(http, player, &mut stats)?,
    }
    Ok(stats)
}

/// Basketball: the latest season's averages and totals, and career ones.
pub fn nba_tables(data: &JsonValue, stats: &mut PlayerStats) {
    let category = |name: &str| {
        data["categories"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|c| c["name"] == name)
    };
    let labels = |c: &JsonValue| -> Vec<String> {
        c["labels"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|l| l.as_str().map(String::from))
            .collect()
    };
    let values = |v: &JsonValue| -> Vec<String> {
        v.as_array()
            .into_iter()
            .flatten()
            .map(|x| x.as_str().unwrap_or_default().to_string())
            .collect()
    };
    let (Some(avg), totals) = (category("averages"), category("totals")) else {
        return;
    };
    let latest = avg["statistics"].as_array().and_then(|s| s.last());
    let season_name = latest
        .and_then(|s| s["season"]["displayName"].as_str())
        .unwrap_or_default()
        .to_string();
    stats.season_label = season_name.clone();
    let columns = labels(avg);

    // Every season, newest first, for the season table.
    let mut seasons: Vec<StatRow> = avg["statistics"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|s| StatRow {
            label: s["season"]["displayName"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            values: values(&s["stats"]),
        })
        .collect();
    seasons.reverse();
    if let Some(row) = seasons.first() {
        let at = |label: &str| {
            columns
                .iter()
                .position(|c| c == label)
                .and_then(|i| row.values.get(i).cloned())
        };
        for (label, key) in [
            ("Points", "PTS"),
            ("Rebounds", "REB"),
            ("Assists", "AST"),
            ("Games", "GP"),
        ] {
            if let Some(value) = at(key) {
                stats.highlights.push(super::Highlight {
                    label: label.into(),
                    value,
                });
            }
        }
        stats.season.push(StatTable {
            title: format!("{season_name} per game"),
            columns: columns.clone(),
            rows: vec![row.clone()],
        });
    }
    if let Some(t) = totals
        && let Some(last) = t["statistics"].as_array().and_then(|s| s.last())
    {
        stats.season.push(StatTable {
            title: format!("{season_name} totals"),
            columns: labels(t),
            rows: vec![StatRow {
                label: season_name.clone(),
                values: values(&last["stats"]),
            }],
        });
    }
    stats.career.push(StatTable {
        title: "Career per game".into(),
        columns: columns.clone(),
        rows: vec![StatRow {
            label: "Career".into(),
            values: values(&avg["totals"]),
        }],
    });
    if let Some(t) = totals {
        stats.career.push(StatTable {
            title: "Career totals".into(),
            columns: labels(t),
            rows: vec![StatRow {
                label: "Career".into(),
                values: values(&t["totals"]),
            }],
        });
    }
    stats.career.push(StatTable {
        title: "By season (per game)".into(),
        columns,
        rows: seasons,
    });
}

/// Football columns shown, from ESPN's labels.
const SOCCER_COLUMNS: [(&str, &str); 7] = [
    ("STRT", "Starts"),
    ("G", "Goals"),
    ("A", "Assists"),
    ("SHOT", "Shots"),
    ("SOG", "On target"),
    ("YC", "Yellow"),
    ("RC", "Red"),
];

/// One competition's rows for a player at one team: (season, numbers).
pub fn soccer_rows(data: &JsonValue) -> Vec<(String, Vec<f64>)> {
    let Some(cat) = data["categories"].as_array().and_then(|c| c.first()) else {
        return Vec::new();
    };
    let labels: Vec<&str> = cat["labels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|l| l.as_str())
        .collect();
    cat["statistics"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let raw: Vec<f64> = s["stats"]
                .as_array()?
                .iter()
                .map(|v| v.as_str().and_then(|x| x.parse().ok()).unwrap_or(0.0))
                .collect();
            let picked = SOCCER_COLUMNS
                .iter()
                .map(|(key, _)| {
                    labels
                        .iter()
                        .position(|l| l == key)
                        .and_then(|i| raw.get(i).copied())
                        .unwrap_or(0.0)
                })
                .collect();
            Some((s["season"]["displayName"].as_str()?.to_string(), picked))
        })
        .collect()
}

fn options<'a>(data: &'a JsonValue, filter: &str) -> Vec<(&'a str, &'a str)> {
    data["filters"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|f| f["name"] == filter)
        .and_then(|f| f["options"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|o| Some((o["value"].as_str()?, o["displayValue"].as_str()?)))
        .collect()
}

fn selected<'a>(data: &'a JsonValue, filter: &str) -> Option<&'a str> {
    data["filters"]
        .as_array()?
        .iter()
        .find(|f| f["name"] == filter)?["value"]
        .as_str()
}

fn is_youth(team: &str) -> bool {
    let t = team.to_lowercase();
    t.contains(" u1")
        || t.contains(" u2")
        || t.contains(" u-")
        || t.ends_with(" ii")
        || t.ends_with(" b")
}

fn fmt(n: f64) -> String {
    format!("{n:.0}")
}

/// Football: ESPN reports per team and competition, so the season adds up
/// the current team's competitions and the career every team's.
fn soccer_stats(http: &Http, player: &str, stats: &mut PlayerStats) -> Result<()> {
    let base = format!("{COMMON}/soccer/athletes/{player}/stats");
    let first = get(http, &base)?;
    let current_team = selected(&first, "team").unwrap_or_default().to_string();
    let season = first["categories"][0]["statistics"][0]["season"]["displayName"]
        .as_str()
        .and_then(|s| s.split_whitespace().next())
        .unwrap_or_default()
        .to_string();
    stats.season_label = season.clone();

    // team name -> competition -> season -> numbers
    let mut by_team: BTreeMap<String, BTreeMap<String, BTreeMap<String, Vec<f64>>>> =
        BTreeMap::new();
    let mut calls = 0;
    for (team, team_name) in options(&first, "team") {
        if is_youth(team_name) {
            continue;
        }
        let team_data = if team == current_team {
            first.clone()
        } else {
            pause(150);
            calls += 1;
            match get(http, &format!("{base}?team={team}")) {
                Ok(d) => d,
                Err(_) => continue,
            }
        };
        let default_league = selected(&team_data, "league")
            .unwrap_or_default()
            .to_string();
        for (league, league_name) in options(&team_data, "league") {
            let data = if league == default_league {
                team_data.clone()
            } else {
                // Keep a refresh to a few dozen requests.
                if calls >= 30 {
                    continue;
                }
                pause(150);
                calls += 1;
                match get(http, &format!("{base}?team={team}&league={league}")) {
                    Ok(d) => d,
                    Err(_) => continue,
                }
            };
            let entry = by_team.entry(team_name.to_string()).or_default();
            for (season_name, numbers) in soccer_rows(&data) {
                entry
                    .entry(league_name.to_string())
                    .or_default()
                    .insert(season_name, numbers);
            }
        }
    }

    let columns: Vec<String> = SOCCER_COLUMNS.iter().map(|(_, l)| l.to_string()).collect();
    let add = |a: &mut Vec<f64>, b: &[f64]| {
        a.resize(b.len().max(a.len()), 0.0);
        for (x, y) in a.iter_mut().zip(b) {
            *x += y;
        }
    };
    let row = |label: String, n: &[f64]| StatRow {
        label,
        values: n.iter().map(|x| fmt(*x)).collect(),
    };

    // This season: the current team, one row per competition.
    let current_name = options(&first, "team")
        .into_iter()
        .find(|(id, _)| *id == current_team)
        .map(|(_, n)| n.to_string());
    let mut season_rows = Vec::new();
    let mut season_total = Vec::new();
    for (league, seasons) in current_name
        .as_ref()
        .and_then(|n| by_team.get(n))
        .into_iter()
        .flatten()
    {
        for (name, n) in seasons {
            if !season.is_empty() && name.starts_with(&season) {
                add(&mut season_total, n);
                season_rows.push(row(league.clone(), n));
            }
        }
    }
    if season_rows.len() > 1 {
        season_rows.push(row("All competitions".into(), &season_total));
    }
    if !season_rows.is_empty() {
        stats.season.push(StatTable {
            title: format!("{season} by competition"),
            columns: columns.clone(),
            rows: season_rows,
        });
    }

    // Career: one row per team, all competitions.
    let mut career_rows = Vec::new();
    let mut career_total = Vec::new();
    for (team, leagues) in &by_team {
        let mut t = Vec::new();
        for seasons in leagues.values() {
            for n in seasons.values() {
                add(&mut t, n);
            }
        }
        add(&mut career_total, &t);
        career_rows.push(row(team.clone(), &t));
    }
    if !career_rows.is_empty() {
        career_rows.push(row("Total".into(), &career_total));
        stats.career.push(StatTable {
            title: "Career by team".into(),
            columns: columns.clone(),
            rows: career_rows,
        });
    }

    let at = |n: &[f64], i: usize| n.get(i).copied().unwrap_or(0.0);
    stats.highlights = vec![
        Highlight {
            label: "Goals".into(),
            value: fmt(at(&season_total, 1)),
        },
        Highlight {
            label: "Assists".into(),
            value: fmt(at(&season_total, 2)),
        },
        Highlight {
            label: "Starts".into(),
            value: fmt(at(&season_total, 0)),
        },
        Highlight {
            label: "Career goals".into(),
            value: fmt(at(&career_total, 1)),
        },
    ];
    if stats.season.is_empty() && stats.career.is_empty() {
        return Err(Error::Invalid("ESPN has no stats for this player".into()));
    }
    Ok(())
}
