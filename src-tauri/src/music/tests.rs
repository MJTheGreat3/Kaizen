use rusqlite::Connection;
use serde_json::json;

use super::lyrics::{self, Lyrics, Query};
use super::*;
use crate::db::migrations::migrate;

fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn recent() -> JsonValue {
    json!({ "items": [
        { "played_at": "2026-10-15T08:30:00.000Z", "context": { "uri": "spotify:playlist:p1" },
          "track": { "id": "t2", "name": "Yellow", "duration_ms": 266000,
            "artists": [{ "id": "a1", "name": "Coldplay" }],
            "album": { "id": "al1", "name": "Parachutes", "images": [
              { "url": "big", "width": 640 }, { "url": "mid", "width": 300 }, { "url": "small", "width": 64 } ] } } },
        { "played_at": "2026-10-15T08:25:00Z", "context": null,
          "track": { "id": "t1", "name": "Clocks", "duration_ms": 307000,
            "artists": [{ "id": "a1", "name": "Coldplay" }, { "id": "a2", "name": "Guest" }],
            "album": { "id": "al2", "name": "A Rush of Blood", "images": [] } } },
        { "played_at": "bad", "track": { "id": "t3" } }
    ]})
}

#[test]
fn parses_recently_played_oldest_first() {
    let plays = parse_recent(&recent());
    assert_eq!(plays.len(), 2);
    assert_eq!(plays[0].title, "Clocks");
    assert_eq!(plays[0].artists, vec!["Coldplay", "Guest"]);
    assert_eq!(plays[0].image, None);
    assert_eq!(plays[1].image.as_deref(), Some("mid"));
    assert_eq!(plays[1].context.as_deref(), Some("spotify:playlist:p1"));
    assert_eq!(plays[1].id, format!("{}:t2", plays[1].played_at));
}

#[test]
fn stores_each_play_once_and_moves_the_cursor() {
    let conn = db();
    let plays = parse_recent(&recent());
    assert_eq!(store_plays(&conn, &plays, "d").unwrap(), 2);
    assert_eq!(store_plays(&conn, &plays, "d").unwrap(), 0);
    assert_eq!(history_after(&conn).unwrap(), Some(plays[1].played_at));
    let artists: String = conn
        .query_row(
            "SELECT artists FROM music_plays WHERE track_id = 't1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(artists, r#"["Coldplay","Guest"]"#);
}

#[test]
fn picks_lyrics_close_to_the_track_length() {
    let results = json!([
        { "duration": 200.0, "syncedLyrics": "[00:01.00] wrong song" },
        { "duration": 265.0, "plainLyrics": "plain only" },
        { "duration": 268.0, "syncedLyrics": "[00:02.00] right", "plainLyrics": "right" }
    ]);
    let best = lyrics::best_match(&results, 266_000).unwrap();
    assert_eq!(best.synced.as_deref(), Some("[00:02.00] right"));
    assert!(
        lyrics::best_match(&json!([{ "duration": 100.0, "plainLyrics": "x" }]), 266_000).is_none()
    );
}

#[test]
fn caches_lyrics_and_retries_missing_ones_later() {
    let conn = db();
    let q = Query {
        track: "Yellow",
        artist: "Coldplay",
        album: "Parachutes",
        duration_ms: 266_000,
    };
    assert_eq!(lyrics::cached(&conn, &q, 0).unwrap(), None);
    lyrics::store(&conn, &q, &Lyrics::default(), 0).unwrap();
    assert_eq!(
        lyrics::cached(&conn, &q, 1000).unwrap(),
        Some(Lyrics::default())
    );
    assert_eq!(lyrics::cached(&conn, &q, 8 * 86_400_000).unwrap(), None);
    let found = Lyrics {
        plain: Some("Look at the stars".into()),
        ..Default::default()
    };
    lyrics::store(&conn, &q, &found, 0).unwrap();
    assert_eq!(
        lyrics::cached(&conn, &q, 30 * 86_400_000).unwrap(),
        Some(found)
    );
}

#[test]
fn turns_spotify_errors_into_plain_messages() {
    let e = api_error(
        404,
        &json!({ "error": { "status": 404, "message": "Player command failed: No active device found", "reason": "NO_ACTIVE_DEVICE" } }),
    );
    assert!(e.to_string().contains("Open Spotify"));
    let e = api_error(
        403,
        &json!({ "error": { "message": "Premium required", "reason": "PREMIUM_REQUIRED" } }),
    );
    assert!(e.to_string().contains("Premium"));
}

/// Hits LRCLIB for real: `cargo test --lib live_lyrics -- --ignored --nocapture`.
#[test]
#[ignore]
fn live_lyrics() {
    let q = Query {
        track: "Yellow",
        artist: "Coldplay",
        album: "Parachutes",
        duration_ms: 266_773,
    };
    let l = lyrics::lookup(&q).unwrap();
    println!("{:?}", l.synced.as_deref().map(|s| &s[..80.min(s.len())]));
    assert!(l.plain.is_some());
}
