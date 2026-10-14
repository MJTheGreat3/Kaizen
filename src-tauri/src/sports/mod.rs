//! Following teams and players: NBA and football through ESPN's public site
//! API, cricket through Cricbuzz's pages.
//!
//! Each adapter turns its source into the same shapes: search candidates,
//! games (fixtures and results) for a team, and stat tables for a player.
//! Follows are synced; games and stats are caches each device fetches for
//! itself. Neither source needs a key; Cricbuzz has no open API, so its
//! adapter reads the data its pages embed and fails with a readable error
//! when that changes.

pub mod alerts;
pub mod cricbuzz;
pub mod espn;
pub mod photo;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::practice::http::Http;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sport {
    Nba,
    Football,
    Cricket,
}

impl Sport {
    pub fn id(self) -> &'static str {
        match self {
            Sport::Nba => "nba",
            Sport::Football => "football",
            Sport::Cricket => "cricket",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        [Sport::Nba, Sport::Football, Sport::Cricket]
            .into_iter()
            .find(|s| s.id() == id)
    }

    fn site(self) -> &'static str {
        match self {
            Sport::Cricket => "Cricbuzz",
            _ => "ESPN",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Team,
    Player,
}

impl Kind {
    pub fn id(self) -> &'static str {
        match self {
            Kind::Team => "team",
            Kind::Player => "player",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "team" => Some(Kind::Team),
            "player" => Some(Kind::Player),
            _ => None,
        }
    }
}

/// A team or player found by a search, ready to follow.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// The follow id: `{sport}:{kind}:{ref}`.
    pub id: String,
    pub sport: String,
    pub kind: String,
    /// The source's own id.
    pub r#ref: String,
    pub name: String,
    pub subtitle: Option<String>,
    /// ESPN league slug (football teams play in several).
    pub league: Option<String>,
    pub image: Option<String>,
}

pub fn follow_id(sport: Sport, kind: Kind, r: &str) -> String {
    format!("{}:{}:{r}", sport.id(), kind.id())
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Side {
    pub name: String,
    pub short: String,
    pub logo: Option<String>,
    pub score: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Game {
    /// The source's match id.
    pub id: String,
    pub start_at: i64,
    pub league: Option<String>,
    /// "4th T20I", "Group stage" and the like.
    pub title: Option<String>,
    pub home: Side,
    pub away: Side,
    /// "pre", "in" or "post".
    pub state: String,
    pub status: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct StatRow {
    pub label: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct StatTable {
    pub title: String,
    pub columns: Vec<String>,
    pub rows: Vec<StatRow>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Highlight {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    pub name: String,
    pub team: Option<String>,
    pub position: Option<String>,
    pub image: Option<String>,
    /// "2025-26", "Recent form".
    pub season_label: String,
    /// A few headline numbers for the showcase card.
    pub highlights: Vec<Highlight>,
    pub season: Vec<StatTable>,
    pub career: Vec<StatTable>,
    /// The player's latest finished game, for the after-game notification.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_game: Option<LastGame>,
}

/// How a player did in one game.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastGame {
    /// The source's game id.
    pub id: String,
    /// When it was played (ms).
    pub at: i64,
    /// "35 pts, 4 reb, 4 ast", "74 (60) and 1-13".
    pub line: String,
    /// "L 111-96 @ Phoenix Suns", "vs ENG, ODI".
    pub game: String,
    pub url: Option<String>,
}

/// One followed team or player, as stored.
#[derive(Debug, Clone)]
pub struct Follow {
    pub id: String,
    pub sport: Sport,
    pub kind: Kind,
    pub r#ref: String,
    pub name: String,
    /// ESPN league slug, or the Cricbuzz page slug.
    pub league: Option<String>,
    pub stats_at: Option<i64>,
}

pub fn follows(conn: &Connection) -> Result<Vec<Follow>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.sport, f.kind, f.ref, f.league, s.fetched_at, f.name
         FROM sport_follows f LEFT JOIN sport_stats s ON s.id = f.id
         WHERE f.deleted_at IS NULL ORDER BY f.sort",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, String>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, sport, kind, r, league, stats_at, name)| {
            Some(Follow {
                id,
                sport: Sport::from_id(&sport)?,
                kind: Kind::from_id(&kind)?,
                r#ref: r,
                name,
                league,
                stats_at,
            })
        })
        .collect())
}

pub enum Fetched {
    Games(Vec<Game>),
    Stats(Box<PlayerStats>),
    /// Only a player's latest game (ESPN), between full stats refreshes.
    LastGame(Option<LastGame>),
}

/// A team's games, or a player's stats; with `full` false an ESPN player
/// only gets their latest game (Cricbuzz has it on the same page anyway).
pub fn fetch(http: &Http, follow: &Follow, full: bool) -> Result<Fetched> {
    if !full && follow.kind == Kind::Player && follow.sport != Sport::Cricket {
        return Ok(Fetched::LastGame(espn::last_game(
            http,
            follow.sport,
            &follow.r#ref,
        )?));
    }
    let mut fetched = fetch_from_source(http, follow)?;
    if let Fetched::Stats(stats) = &mut fetched
        && stats.image.is_none()
    {
        let name = if stats.name.is_empty() {
            &follow.name
        } else {
            &stats.name
        };
        stats.image = photo::wikipedia(http, name, follow.sport);
    }
    Ok(fetched)
}

fn fetch_from_source(http: &Http, follow: &Follow) -> Result<Fetched> {
    Ok(match (follow.sport, follow.kind) {
        (Sport::Cricket, Kind::Team) => Fetched::Games(cricbuzz::team_games(
            http,
            &follow.r#ref,
            follow.league.as_deref(),
        )?),
        (Sport::Cricket, Kind::Player) => {
            // Follows from before slugs were kept fall back to the name's.
            let slug = follow
                .league
                .clone()
                .unwrap_or_else(|| cricbuzz::slugify(&follow.name));
            Fetched::Stats(Box::new(cricbuzz::player_stats(
                http,
                &follow.r#ref,
                &slug,
            )?))
        }
        (sport, Kind::Team) => Fetched::Games(espn::team_games(
            http,
            sport,
            &follow.r#ref,
            follow.league.as_deref(),
        )?),
        (sport, Kind::Player) => {
            Fetched::Stats(Box::new(espn::player_stats(http, sport, &follow.r#ref)?))
        }
    })
}

/// Stats are refetched in full at most this often; in between, ESPN
/// players only get their latest game.
pub const STATS_MS: i64 = 6 * 3_600_000;

/// What a refresh fetches: the follows (only `ids` when given), each with
/// whether a player gets full stats.
pub fn plan(follows: Vec<Follow>, ids: Option<&[String]>, now: i64) -> Vec<(Follow, bool)> {
    follows
        .into_iter()
        .filter(|f| ids.is_none_or(|ids| ids.contains(&f.id)))
        .map(|f| {
            let full = ids.is_some() || f.stats_at.is_none_or(|t| now - t > STATS_MS);
            (f, full)
        })
        .collect()
}

/// Fetches a plan in parallel.
pub fn fetch_all(http: &Http, plan: &[(Follow, bool)]) -> Vec<Result<Fetched>> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = plan
            .iter()
            .map(|(f, full)| scope.spawn(move || fetch(http, f, *full)))
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("sports fetch panicked"))
            .collect()
    })
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// The stored latest game of a player: None without stats, Some(None)
/// when the stats predate last games being kept.
fn stored_last_game(conn: &Connection, follow: &str) -> Result<Option<Option<String>>> {
    let data: Option<String> = conn
        .query_row(
            "SELECT data FROM sport_stats WHERE id = ?1",
            [follow],
            |r| r.get(0),
        )
        .optional()?;
    Ok(data.map(|d| {
        serde_json::from_str::<serde_json::Value>(&d)
            .ok()
            .and_then(|v| v["lastGame"]["id"].as_str().map(String::from))
    }))
}

/// The announcement for a player's newer game, if there is one. The first
/// game seen for a player only sets the baseline.
fn performance(
    conn: &Connection,
    follow: &Follow,
    name: &str,
    game: &Option<LastGame>,
) -> Result<Option<alerts::Alert>> {
    let Some(game) = game else { return Ok(None) };
    match stored_last_game(conn, &follow.id)? {
        Some(Some(prev)) if prev != game.id && alerts::fresh(game.at) => alerts::keep(
            conn,
            alerts::performance_alert(follow, name, game),
            &[alerts::follow_mute_id(&follow.id)],
            "notify.performances",
        ),
        _ => Ok(None),
    }
}

/// Replaces a team's games, or a player's stats (also refreshing the
/// follow's picture and team line when they changed). Returns what to
/// announce: games that finished since the last refresh, a player's new game.
pub fn store(conn: &Connection, follow: &Follow, fetched: &Fetched) -> Result<Vec<alerts::Alert>> {
    let tx = conn.unchecked_transaction()?;
    let mut out = Vec::new();
    match fetched {
        Fetched::Games(games) => {
            // Games seen before and not finished then.
            let mut stmt = tx.prepare("SELECT id, state FROM sport_games WHERE follow_id = ?1")?;
            let before: std::collections::HashMap<String, String> = stmt
                .query_map([&follow.id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<_>>()?;
            drop(stmt);
            for g in games {
                let was = before.get(&format!("{}:{}", follow.id, g.id));
                if g.state == "post"
                    && was.is_some_and(|s| s != "post")
                    && alerts::fresh(g.start_at)
                {
                    let mutes = [
                        alerts::game_mute_id(follow.sport, &g.id),
                        alerts::follow_mute_id(&follow.id),
                    ];
                    out.extend(alerts::keep(
                        &tx,
                        alerts::result_alert(follow, g),
                        &mutes,
                        "notify.results",
                    )?);
                }
            }
            tx.execute("DELETE FROM sport_games WHERE follow_id = ?1", [&follow.id])?;
            for g in games {
                tx.execute(
                    "INSERT OR REPLACE INTO sport_games
                       (id, follow_id, sport, start_at, league, title, home, home_short, home_logo, home_score,
                        away, away_short, away_logo, away_score, state, status, url)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                    params![
                        format!("{}:{}", follow.id, g.id),
                        follow.id,
                        follow.sport.id(),
                        g.start_at,
                        g.league,
                        g.title,
                        g.home.name,
                        g.home.short,
                        g.home.logo,
                        g.home.score,
                        g.away.name,
                        g.away.short,
                        g.away.logo,
                        g.away.score,
                        g.state,
                        g.status,
                        g.url
                    ],
                )?;
            }
            // Cricbuzz teams come without a logo; take it from their games.
            let logo = games.iter().find_map(|g| {
                [&g.home, &g.away]
                    .into_iter()
                    .find(|s| s.name == follow.name)
                    .and_then(|s| s.logo.clone())
            });
            if let Some(logo) = logo {
                tx.execute(
                    "UPDATE sport_follows SET image = ?2, updated_at = ?3 WHERE id = ?1 AND image IS NULL",
                    params![follow.id, logo, now_ms()],
                )?;
            }
        }
        Fetched::Stats(stats) => {
            let name = if stats.name.is_empty() {
                follow.name.clone()
            } else {
                stats.name.clone()
            };
            out.extend(performance(&tx, follow, &name, &stats.last_game)?);
            tx.execute(
                "INSERT OR REPLACE INTO sport_stats (id, data, fetched_at) VALUES (?1, ?2, ?3)",
                params![follow.id, serde_json::to_string(stats)?, now_ms()],
            )?;
            // Keep the synced row's picture and team current, without
            // touching it when nothing changed.
            let subtitle = [stats.team.as_deref(), stats.position.as_deref()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
            tx.execute(
                "UPDATE sport_follows SET image = coalesce(?2, image), subtitle = ?3, updated_at = ?4
                 WHERE id = ?1 AND (image IS NOT coalesce(?2, image) OR subtitle IS NOT ?3)",
                params![
                    follow.id,
                    stats.image,
                    (!subtitle.is_empty()).then_some(subtitle),
                    now_ms()
                ],
            )?;
        }
        Fetched::LastGame(game) => {
            out.extend(performance(&tx, follow, &follow.name, game)?);
            if let Some(game) = game {
                tx.execute(
                    "UPDATE sport_stats SET data = json_set(data, '$.lastGame', json(?2)) WHERE id = ?1",
                    params![follow.id, serde_json::to_string(game)?],
                )?;
            }
        }
    }
    tx.execute(
        "UPDATE sport_follows SET error = NULL WHERE id = ?1 AND error IS NOT NULL",
        [&follow.id],
    )?;
    tx.commit()?;
    Ok(out)
}

pub fn store_error(conn: &Connection, follow: &Follow, error: &str) -> Result<()> {
    conn.execute(
        "UPDATE sport_follows SET error = ?2 WHERE id = ?1 AND error IS NOT ?2",
        params![follow.id, error],
    )?;
    Ok(())
}

/// Saves the cricket search index (Cricbuzz has no search API).
pub fn store_index(conn: &Connection, index: &[Candidate]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM sport_index WHERE sport = 'cricket'", [])?;
    for c in index {
        tx.execute(
            "INSERT OR REPLACE INTO sport_index (id, sport, kind, ref, name, subtitle, league, image, fetched_at)
             VALUES (?1, 'cricket', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![c.id, c.kind, c.r#ref, c.name, c.subtitle, c.league, c.image, now_ms()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// The stored cricket index; empty when missing or over a week old.
pub fn cricket_index(conn: &Connection) -> Result<Vec<Candidate>> {
    let fetched_at: Option<i64> = conn
        .query_row(
            "SELECT min(fetched_at) FROM sport_index WHERE sport = 'cricket'",
            [],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    // Indexes from before franchise squads were added have no photos.
    let photos: i64 = conn.query_row(
        "SELECT count(*) FROM sport_index WHERE sport = 'cricket' AND kind = 'player' AND image IS NOT NULL",
        [],
        |r| r.get(0),
    )?;
    if photos == 0 || fetched_at.is_none_or(|t| now_ms() - t > 7 * 86_400_000) {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT id, kind, ref, name, subtitle, league, image FROM sport_index WHERE sport = 'cricket'",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Candidate {
                id: r.get(0)?,
                sport: "cricket".into(),
                kind: r.get(1)?,
                r#ref: r.get(2)?,
                name: r.get(3)?,
                subtitle: r.get(4)?,
                league: r.get(5)?,
                image: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Readable message for a failed fetch.
pub fn describe(sport: Sport, e: &Error) -> String {
    match e {
        Error::Invalid(m) => m.clone(),
        Error::Http(m) => format!("{} could not be reached: {m}", sport.site()),
        Error::Json(_) => format!("{} answered in an unexpected format", sport.site()),
        other => other.to_string(),
    }
}

/// Title-cases a slug: `royal-challengers-bengaluru` → `Royal Challengers Bengaluru`.
pub fn title_from_slug(slug: &str) -> String {
    slug.split('-')
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests;
