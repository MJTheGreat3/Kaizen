//! Following teams and players: NBA and football through ESPN's public site
//! API, cricket through Cricbuzz's pages.
//!
//! Each adapter turns its source into the same shapes: search candidates,
//! games (fixtures and results) for a team, and stat tables for a player.
//! Follows are synced; games and stats are caches each device fetches for
//! itself. Neither source needs a key; Cricbuzz has no open API, so its
//! adapter reads the data its pages embed and fails with a readable error
//! when that changes.

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
}

pub fn fetch(http: &Http, follow: &Follow) -> Result<Fetched> {
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

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Replaces a team's games, or a player's stats (also refreshing the
/// follow's picture and team line when they changed).
pub fn store(conn: &Connection, follow: &Follow, fetched: &Fetched) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    match fetched {
        Fetched::Games(games) => {
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
    }
    tx.execute(
        "UPDATE sport_follows SET error = NULL WHERE id = ?1 AND error IS NOT NULL",
        [&follow.id],
    )?;
    tx.commit()?;
    Ok(())
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
