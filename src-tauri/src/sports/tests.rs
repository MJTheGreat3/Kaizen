use rusqlite::Connection;
use serde_json::json;

use super::*;
use crate::db::migrations::migrate;

/// A page with its data split across two payload chunks, as Cricbuzz sends it.
fn page(payload: &str) -> String {
    let encoded = serde_json::to_string(payload).unwrap();
    let inner = &encoded[1..encoded.len() - 1];
    let mid = inner.len() / 2;
    // Split away from an escape sequence.
    let mid = (mid..inner.len())
        .find(|&i| !inner[..i].ends_with('\\'))
        .unwrap();
    format!(
        r#"<html><script>self.__next_f.push([1,"{}"])</script><script>self.__next_f.push([1,"{}"])</script></html>"#,
        &inner[..mid],
        &inner[mid..]
    )
}

#[test]
fn reads_cricbuzz_payloads() {
    let payload = r#"1f:["$","div",null,{"children":[{"matchDetailsMap":{"key":"Wed","match":[{"matchInfo":{"matchId":151598,"seriesName":"West Indies tour of India, 2026","matchDesc":"4th T20I","matchFormat":"T20","startDate":"1791984600000","state":"Preview","status":"Match starts at 13:30 GMT","team1":{"teamId":2,"teamName":"India","teamSName":"IND","imageId":776162},"team2":{"teamId":10,"teamName":"West Indies","teamSName":"WI","imageId":776191}}},{"matchInfo":{"matchId":151587,"seriesName":"West Indies tour of India, 2026","matchDesc":"3rd T20I","startDate":1791725400000,"state":"Complete","status":"India won by 14 runs","team1":{"teamId":2,"teamName":"India","teamSName":"IND"},"team2":{"teamId":10,"teamName":"West Indies","teamSName":"WI"}},"matchScore":{"team1Score":{"inngs1":{"runs":172,"wickets":10,"overs":19.5}},"team2Score":{"inngs1":{"runs":158,"wickets":7},"inngs2":{"runs":20,"wickets":1}}}},{"matchInfo":{"matchId":9,"team1":{"teamId":128,"teamName":"Karnataka"},"team2":{"teamId":129,"teamName":"Andhra"}}}]}}]}]"#;
    let text = cricbuzz::flight(&page(payload));
    assert_eq!(text, payload);
    let games = cricbuzz::parse_games(&text, "2");
    assert_eq!(games.len(), 2);
    assert_eq!(games[0].state, "pre");
    assert_eq!(games[0].start_at, 1_791_984_600_000);
    assert_eq!(games[0].home.short, "IND");
    assert!(games[0].home.score.is_none());
    assert_eq!(games[1].state, "post");
    assert_eq!(games[1].home.score.as_deref(), Some("172"));
    assert_eq!(games[1].away.score.as_deref(), Some("158/7 & 20/1"));

    let profile = r#"a:{"playerInfo":{"id":"1413","bat":"Right Handed Bat","name":"Virat Kohli","role":"Batsman","intlTeam":"India","rankings":{"bat":{"testRank":"14","odiRank":"3"}}},"faceImageId":616517,"recentBatting":{"headers":["Score","OPPN.","Format","Date"],"rows":[{"values":["151554","0(1)","WI","ODI","03 Oct 26"]},{"values":["151532","139*(88)","WI","ODI","27 Sep 26"]}]},"battingStats":{"headers":["ROWHEADER","Test","ODI","T20","IPL"],"values":[{"values":["Matches","123","317","125","283"]},{"values":["Runs","9230","15109","4188","9336"]},{"values":["Average","46.85","58.79","48.7","40.42"]},{"values":["100s","30","55","1","9"]},{"values":["Balls","1","2","3","4"]}]},"bowlingStats":{"headers":["ROWHEADER","Test","ODI","T20","IPL"],"values":[{"values":["Wickets","0","5","4","4"]}]}}"#;
    let stats = cricbuzz::parse_player(&cricbuzz::flight(&page(profile))).unwrap();
    assert_eq!(stats.name, "Virat Kohli");
    assert_eq!(stats.team.as_deref(), Some("India"));
    assert!(stats.image.unwrap().contains("c616517"));
    let bat = &stats.career[0];
    assert_eq!(bat.columns, ["Matches", "Runs", "Average", "100s"]);
    assert_eq!(bat.rows[1].label, "ODI");
    assert_eq!(bat.rows[1].values, ["317", "15109", "58.79", "55"]);
    assert_eq!(stats.season[0].rows[1].values, ["139*(88)", "WI", "ODI"]);
    let rankings = stats
        .season
        .iter()
        .find(|t| t.title == "ICC rankings")
        .unwrap();
    assert_eq!(rankings.rows[0].values, ["14", "3", "–"]);
    let get = |label: &str| {
        stats
            .highlights
            .iter()
            .find(|h| h.label == label)
            .map(|h| h.value.clone())
    };
    assert_eq!(get("Intl runs").as_deref(), Some("28527"));
    assert_eq!(get("Intl 100s").as_deref(), Some("86"));
    assert_eq!(get("ODI average").as_deref(), Some("58.79"));
    assert_eq!(stats.season_label, "International career");

    // A player without caps gets their league's numbers instead.
    let uncapped = r#"a:{"playerInfo":{"bat":"Right Handed Bat","name":"Ayush Mhatre","role":"Batsman"},"faceImageId":174146,"battingStats":{"headers":["ROWHEADER","Test","ODI","T20","IPL"],"values":[{"values":["Matches","0","0","0","13"]},{"values":["Runs","0","0","0","412"]},{"values":["Average","0","0","0","31.69"]},{"values":["100s","0","0","0","1"]}]}}"#;
    let stats = cricbuzz::parse_player(&cricbuzz::flight(&page(uncapped))).unwrap();
    assert!(stats.image.is_none());
    assert_eq!(stats.season_label, "IPL career");
    let labels: Vec<_> = stats
        .highlights
        .iter()
        .map(|h| (h.label.as_str(), h.value.as_str()))
        .collect();
    assert_eq!(
        labels,
        [
            ("IPL matches", "13"),
            ("IPL runs", "412"),
            ("IPL 100s", "1"),
            ("IPL average", "31.69")
        ]
    );
}

#[test]
fn matches_wikipedia_titles() {
    assert!(photo::names("Luka Dončić", "Luka Doncic"));
    assert!(photo::names("Lamine Yamal", "Lamine Yamal"));
    assert!(!photo::names("Ayush Badoni", "Ayush Mhatre"));
}

#[test]
fn reads_cricbuzz_lists_and_searches_them() {
    let html = r#"<a href="/cricket-team/india/2"><div><img alt="india"/></div><span>India</span></a>
        <a href="/cricket-team/royal-challengers-bengaluru/59"><div class="x"></div></a>
        <a href="/profiles/11808/shubman-gill" title="Shubman Gill"><img/></a>
        <loc>https://www.cricbuzz.com/profiles/1413/virat-kohli</loc>"#;
    let teams = cricbuzz::parse_teams(html);
    assert_eq!(teams[0], ("2".into(), "india".into(), "India".into()));
    assert_eq!(teams[1].2, "Royal Challengers Bengaluru");
    let players = cricbuzz::parse_players(html);
    assert_eq!(
        players,
        vec![
            ("11808".into(), "shubman-gill".into(), "Shubman Gill".into()),
            ("1413".into(), "virat-kohli".into(), "Virat Kohli".into())
        ]
    );

    let index: Vec<Candidate> = players
        .iter()
        .map(|(id, _, name)| Candidate {
            id: follow_id(Sport::Cricket, Kind::Player, id),
            kind: "player".into(),
            r#ref: id.clone(),
            name: name.clone(),
            ..Default::default()
        })
        .collect();
    let names = |q: &str| {
        cricbuzz::filter(&index, Kind::Player, q)
            .into_iter()
            .map(|c| c.name)
            .collect::<Vec<_>>()
    };
    assert_eq!(names("kohli"), ["Virat Kohli"]);
    assert_eq!(names("gill shub"), ["Shubman Gill"]);
    assert!(names("dhoni").is_empty());
    let pasted = cricbuzz::filter(
        &[],
        Kind::Player,
        "https://www.cricbuzz.com/profiles/265/ms-dhoni",
    );
    assert_eq!(
        (pasted[0].id.as_str(), pasted[0].name.as_str()),
        ("cricket:player:265", "Ms Dhoni")
    );
    assert_eq!(pasted[0].league.as_deref(), Some("ms-dhoni"));
    assert_eq!(cricbuzz::slugify("M S Dhoni"), "m-s-dhoni");

    // Franchise squads, from the series list down to the players.
    let series = cricbuzz::parse_series(
        r#"<a href="/cricket-series/9241/indian-premier-league-2026">IPL</a><a href="/cricket-series/9249/indian-premier-league-2027">"#,
    );
    assert_eq!(series[0], (9249, "indian-premier-league-2027".into()));
    let squads = cricbuzz::parse_squads(
        r#"26:[{"data":{"squads":[{"squadType":"T20","isHeader":true},{"squadId":99705,"squadType":"Chennai Super Kings","imageId":860038,"teamId":58}]}}]"#,
    );
    assert_eq!(squads, [(99705, "Chennai Super Kings".to_string())]);
    let squad = cricbuzz::parse_squad(
        &json!({ "player": [
            { "name": "BATTERS", "isHeader": true },
            { "id": "20538", "name": "Dewald Brevis", "role": "Batsman", "imageId": 846104 },
            { "id": "50444", "name": "Dian Forrester", "role": "Batting Allrounder", "imageId": 174146 }
        ]}),
        "Chennai Super Kings",
    );
    assert_eq!(squad.len(), 2);
    assert_eq!(
        squad[0].subtitle.as_deref(),
        Some("Chennai Super Kings · Batsman")
    );
    assert_eq!(squad[0].league.as_deref(), Some("dewald-brevis"));
    assert!(squad[0].image.as_deref().unwrap().contains("c846104"));
    // The blank silhouette counts as no photo.
    assert!(squad[1].image.is_none());
}

#[test]
fn reads_espn() {
    let found = espn::parse_search(
        &json!({ "items": [
            { "id": "3975", "displayName": "Stephen Curry", "sport": "basketball", "league": "nba" },
            { "id": "1", "displayName": "John Curry", "sport": "football", "league": "college-football" },
            { "id": "83", "displayName": "Barcelona", "sport": "soccer", "league": "esp.1", "defaultLeagueSlug": "esp.1",
              "logos": [{ "href": "https://x/83.png" }] },
        ]}),
        Sport::Nba,
        Kind::Player,
    );
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].id, "nba:player:3975");
    let teams = espn::parse_search(
        &json!({ "items": [
        { "id": "83", "displayName": "Barcelona", "sport": "soccer", "league": "esp.1", "defaultLeagueSlug": "esp.1",
          "logos": [{ "href": "https://x/83.png" }] }]}),
        Sport::Football,
        Kind::Team,
    );
    assert_eq!(
        (teams[0].league.as_deref(), teams[0].image.as_deref()),
        (Some("esp.1"), Some("https://x/83.png"))
    );

    let side = |id: &str, home: &str, score: serde_json::Value| {
        json!({
            "homeAway": home, "score": score, "team": { "displayName": id, "abbreviation": id }
        })
    };
    let games = espn::parse_schedule(&json!({ "events": [
        { "id": "1", "date": "2026-10-04T23:00Z", "competitions": [{ "competitors": [side("LAC", "home", json!({ "displayValue": "104" })), side("GS", "away", json!("101"))],
          "status": { "type": { "state": "post", "shortDetail": "Final" } } }] },
        { "id": "2", "date": "2026-10-17T02:00Z", "competitions": [{ "competitors": [side("GS", "home", json!(null)), side("POR", "away", json!(null))],
          "status": { "type": { "state": "pre", "shortDetail": "Fri 7:30 PM" } } }] },
    ]}));
    assert_eq!(games[0].start_at, 1_791_154_800_000);
    assert_eq!(
        (
            games[0].home.score.as_deref(),
            games[0].away.score.as_deref()
        ),
        (Some("104"), Some("101"))
    );
    assert_eq!(games[1].state, "pre");

    // Six latest results and eight next fixtures.
    let many: Vec<Game> = (0..20)
        .map(|i| Game {
            id: i.to_string(),
            start_at: i,
            state: if i < 10 { "post" } else { "pre" }.into(),
            ..Default::default()
        })
        .collect();
    let picked = espn::pick_games(many);
    assert_eq!(picked.first().unwrap().start_at, 4);
    assert_eq!(picked.len(), 14);

    let mut stats = PlayerStats::default();
    espn::nba_tables(
        &json!({ "categories": [
            { "name": "averages", "labels": ["GP", "REB", "AST", "PTS"],
              "statistics": [
                { "season": { "displayName": "2024-25" }, "stats": ["70", "4.4", "6.0", "24.5"] },
                { "season": { "displayName": "2025-26" }, "stats": ["43", "3.6", "4.7", "26.6"] }],
              "totals": ["1069", "4.7", "6.3", "24.8"] },
            { "name": "totals", "labels": ["PTS"], "statistics": [{ "season": { "displayName": "2025-26" }, "stats": ["1142"] }], "totals": ["26528"] }
        ]}),
        &mut stats,
    );
    assert_eq!(stats.season_label, "2025-26");
    assert_eq!(stats.highlights[0].value, "26.6");
    assert_eq!(stats.season[0].rows[0].label, "2025-26");
    assert_eq!(stats.career[1].rows[0].values, ["26528"]);
    assert_eq!(stats.career[2].rows[0].label, "2025-26");

    let rows = espn::soccer_rows(
        &json!({ "categories": [{ "labels": ["STRT", "FC", "G", "A"],
        "statistics": [{ "season": { "displayName": "2025-26 English Premier League" }, "stats": ["34", "24", "27", "8"] }] }]}),
    );
    assert_eq!(rows[0].1, [34.0, 27.0, 8.0, 0.0, 0.0, 0.0, 0.0]);
}

#[test]
fn stores_games_and_stats() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO sport_follows (id, sport, kind, ref, name, created_at, updated_at, device_id)
         VALUES ('nba:team:9', 'nba', 'team', '9', 'Warriors', 1, 1, 'd'), ('nba:player:3975', 'nba', 'player', '3975', 'Curry', 1, 1, 'd')",
        [],
    )
    .unwrap();
    let all = follows(&conn).unwrap();
    assert_eq!(all.len(), 2);
    let team = all.iter().find(|f| f.kind == Kind::Team).unwrap();
    let game = |id: &str| Game {
        id: id.into(),
        state: "pre".into(),
        ..Default::default()
    };
    store(&conn, team, &Fetched::Games(vec![game("1"), game("2")])).unwrap();
    store(&conn, team, &Fetched::Games(vec![game("2")])).unwrap();
    let n: i64 = conn
        .query_row("SELECT count(*) FROM sport_games", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);

    let player = all.iter().find(|f| f.kind == Kind::Player).unwrap();
    let stats = PlayerStats {
        team: Some("Golden State Warriors".into()),
        position: Some("Point Guard".into()),
        image: Some("https://img".into()),
        ..Default::default()
    };
    store(&conn, player, &Fetched::Stats(Box::new(stats))).unwrap();
    let (subtitle, image): (String, String) = conn
        .query_row(
            "SELECT subtitle, image FROM sport_follows WHERE id = 'nba:player:3975'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(subtitle, "Golden State Warriors · Point Guard");
    assert_eq!(image, "https://img");
    assert!(follows(&conn).unwrap().iter().any(|f| f.stats_at.is_some()));

    // Sessions and follows are searchable.
    let found: i64 = conn
        .query_row(
            "SELECT count(*) FROM search_index WHERE module = 'sports'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(found, 2);
}

/// Hits the real sites: `cargo test --lib sports::tests::live -- --ignored --nocapture`.
#[test]
#[ignore]
fn live() {
    let http = crate::practice::http::Http::new();
    for (sport, kind, q) in [
        (Sport::Nba, Kind::Team, "warriors"),
        (Sport::Nba, Kind::Player, "curry"),
        (Sport::Football, Kind::Team, "manchester city"),
        (Sport::Football, Kind::Player, "haaland"),
        (Sport::Football, Kind::Player, "lamine yamal"),
    ] {
        let found = espn::search(&http, sport, kind, q).unwrap();
        let first = found.first().unwrap();
        println!(
            "{} {}: {} ({:?}, {:?})",
            sport.id(),
            kind.id(),
            first.name,
            first.subtitle,
            first.league
        );
        let follow = Follow {
            id: first.id.clone(),
            sport,
            kind,
            r#ref: first.r#ref.clone(),
            name: first.name.clone(),
            league: first.league.clone(),
            stats_at: None,
        };
        report(fetch(&http, &follow, true));
    }
    let index = cricbuzz::index(&http).unwrap();
    let mut teams = std::collections::BTreeMap::new();
    for c in index.iter().filter(|c| c.kind == "player") {
        let team = c.subtitle.clone().unwrap_or_default();
        *teams
            .entry(team.split(" · ").next().unwrap_or_default().to_string())
            .or_insert(0) += 1;
    }
    println!("cricket squads: {teams:?}");
    println!(
        "cricket index: {} teams, {} players",
        index.iter().filter(|c| c.kind == "team").count(),
        index.iter().filter(|c| c.kind == "player").count()
    );
    for (kind, q) in [
        (Kind::Team, "india"),
        (Kind::Team, "royal challengers"),
        (Kind::Player, "kohli"),
        (Kind::Player, "bumrah"),
        (Kind::Player, "ayush mhatre"),
        (Kind::Player, "tim david"),
        (Kind::Team, "lahore qalandars"),
    ] {
        let found = cricbuzz::filter(&index, kind, q);
        let first = found.first().unwrap();
        println!(
            "cricket {}: {} ({:?})",
            kind.id(),
            first.name,
            first.subtitle
        );
        let follow = Follow {
            id: first.id.clone(),
            sport: Sport::Cricket,
            kind,
            r#ref: first.r#ref.clone(),
            name: first.name.clone(),
            league: first.league.clone(),
            stats_at: None,
        };
        report(fetch(&http, &follow, true));
    }
}

#[cfg(test)]
fn report(result: crate::error::Result<Fetched>) {
    match result {
        Ok(Fetched::Games(games)) => {
            for g in &games {
                println!(
                    "    {} {} {:?} v {} {:?} [{}] {:?}",
                    g.state,
                    g.home.short,
                    g.home.score,
                    g.away.short,
                    g.away.score,
                    g.status,
                    g.league
                );
            }
        }
        Ok(Fetched::LastGame(g)) => println!("    last game {g:?}"),
        Ok(Fetched::Stats(s)) => {
            println!(
                "    {} · {:?} · {:?} · {} · {:?}",
                s.name, s.team, s.position, s.season_label, s.image
            );
            println!("    last game {:?}", s.last_game);
            println!(
                "    {:?}",
                s.highlights
                    .iter()
                    .map(|h| format!("{} {}", h.label, h.value))
                    .collect::<Vec<_>>()
            );
            for t in s.season.iter().chain(&s.career) {
                println!("    [{}] {:?}", t.title, t.columns);
                for r in t.rows.iter().take(4) {
                    println!("      {}: {:?}", r.label, r.values);
                }
            }
        }
        Err(e) => println!("    ERROR {e}"),
    }
}

#[test]
fn reads_last_games() {
    let log = json!({
        "labels": ["MIN", "REB", "AST", "PTS"],
        "events": {
            "1": { "gameDate": "2026-04-18T02:00:00.000+00:00", "score": "111-96", "atVs": "@", "gameResult": "L", "opponent": { "displayName": "Phoenix Suns" },
                   "links": [{ "rel": ["summary", "desktop", "event"], "href": "https://espn.com/1" }] },
            "2": { "gameDate": "2026-04-10T02:00:00.000+00:00", "score": "100-90", "atVs": "vs", "gameResult": "W", "opponent": { "displayName": "Kings" } }
        },
        "seasonTypes": [{ "categories": [{ "events": [
            { "eventId": "1", "stats": ["36", "4", "8", "35"] },
            { "eventId": "2", "stats": ["30", "2", "3", "20"] }
        ]}]}]
    });
    let g = espn::parse_gamelog(&log, Sport::Nba).unwrap();
    assert_eq!(g.id, "1");
    assert_eq!(g.line, "35 pts, 4 reb, 8 ast");
    assert_eq!(g.game, "L 111-96 @ Phoenix Suns");
    assert_eq!(g.url.as_deref(), Some("https://espn.com/1"));

    let soccer = json!({
        "labels": ["G", "A", "SHOT"],
        "events": { "9": { "gameDate": "2026-10-11T15:30:00.000+00:00", "score": "3-0", "atVs": "@", "gameResult": "W", "opponent": { "displayName": "Liverpool" } } },
        "seasonTypes": [{ "categories": [{ "events": [{ "eventId": "9", "stats": ["1", "0", "2"] }] }] }]
    });
    assert_eq!(
        espn::parse_gamelog(&soccer, Sport::Football).unwrap().line,
        "1 goal"
    );

    let batting = json!({ "rows": [{ "values": ["151554", "0(1)", "WI", "ODI", "03 Oct 26"] }, { "values": ["151532", "139*(88)", "WI", "ODI", "27 Sep 26"] }] });
    let bowling = json!({ "rows": [{ "values": ["151554", "1-13", "WI", "ODI", "03 Oct 26"] }] });
    let g = cricbuzz::last_game(Some(&batting), Some(&bowling)).unwrap();
    assert_eq!(
        (g.id.as_str(), g.line.as_str(), g.game.as_str()),
        ("151554", "0 (1) and 1-13", "vs WI, ODI")
    );
}

#[test]
fn announces_results_and_performances_once() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn.execute_batch(
        "INSERT INTO sport_follows (id, sport, kind, ref, name, created_at, updated_at, device_id)
         VALUES ('cricket:team:2', 'cricket', 'team', '2', 'India', 1, 1, 'd'),
                ('nba:player:3975', 'nba', 'player', '3975', 'Stephen Curry', 1, 1, 'd');",
    )
    .unwrap();
    let all = follows(&conn).unwrap();
    let team = all.iter().find(|f| f.kind == Kind::Team).unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    let game = |id: &str, state: &str| Game {
        id: id.into(),
        start_at: now - 3_600_000,
        state: state.into(),
        status: if state == "post" {
            "India won by 14 runs".into()
        } else {
            "Live".into()
        },
        home: Side {
            name: "India".into(),
            short: "IND".into(),
            score: Some("172".into()),
            ..Default::default()
        },
        away: Side {
            name: "West Indies".into(),
            short: "WI".into(),
            score: Some("158/7".into()),
            ..Default::default()
        },
        ..Default::default()
    };
    // Seen finished the first time: no alert.
    assert!(
        store(&conn, team, &Fetched::Games(vec![game("old", "post")]))
            .unwrap()
            .is_empty()
    );
    // Live, then finished: one alert, once.
    assert!(
        store(&conn, team, &Fetched::Games(vec![game("1", "in")]))
            .unwrap()
            .is_empty()
    );
    let alerts = store(&conn, team, &Fetched::Games(vec![game("1", "post")])).unwrap();
    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].title, "India won by 14 runs");
    assert_eq!(alerts[0].body, "IND 172 v WI 158/7");
    assert_eq!(alerts[0].mute_id.as_deref(), Some("follow:cricket:team:2"));
    store(&conn, team, &Fetched::Games(vec![game("1", "in")])).unwrap();
    assert!(
        store(&conn, team, &Fetched::Games(vec![game("1", "post")]))
            .unwrap()
            .is_empty()
    );

    // A muted game stays quiet.
    alerts::set_muted(
        &conn,
        &alerts::game_mute_id(Sport::Cricket, "2"),
        Some("India v WI"),
        true,
    )
    .unwrap();
    store(&conn, team, &Fetched::Games(vec![game("2", "in")])).unwrap();
    assert!(
        store(&conn, team, &Fetched::Games(vec![game("2", "post")]))
            .unwrap()
            .is_empty()
    );

    // Players: the first game seen is the baseline, a newer one is announced.
    let player = all.iter().find(|f| f.kind == Kind::Player).unwrap();
    let last = |id: &str| LastGame {
        id: id.into(),
        at: now,
        line: "35 pts, 4 reb, 8 ast".into(),
        game: "W 111-96 vs PHX".into(),
        url: None,
    };
    let stats = PlayerStats {
        name: "Stephen Curry".into(),
        last_game: Some(last("a")),
        ..Default::default()
    };
    assert!(
        store(&conn, player, &Fetched::Stats(Box::new(stats)))
            .unwrap()
            .is_empty()
    );
    assert!(
        store(&conn, player, &Fetched::LastGame(Some(last("a"))))
            .unwrap()
            .is_empty()
    );
    let alerts = store(&conn, player, &Fetched::LastGame(Some(last("b")))).unwrap();
    assert_eq!(alerts[0].title, "Stephen Curry: 35 pts, 4 reb, 8 ast");
    // Its latest game was saved, so it is not announced again.
    assert!(
        store(&conn, player, &Fetched::LastGame(Some(last("b"))))
            .unwrap()
            .is_empty()
    );

    // Muting from a notification goes through the pending file.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(alerts::PENDING_MUTES),
        "follow:nba:player:3975\tStephen Curry\n",
    )
    .unwrap();
    assert_eq!(alerts::apply_pending_mutes(&conn, dir.path()).unwrap(), 1);
    assert!(
        store(&conn, player, &Fetched::LastGame(Some(last("c"))))
            .unwrap()
            .is_empty()
    );
    alerts::set_muted(&conn, "follow:nba:player:3975", None, false).unwrap();
    assert_eq!(
        store(&conn, player, &Fetched::LastGame(Some(last("d"))))
            .unwrap()
            .len(),
        1
    );

    // Turned off on this device.
    conn.execute(
        "INSERT INTO local_meta VALUES ('pref.notify.performances', 'false')",
        [],
    )
    .unwrap();
    assert!(
        store(&conn, player, &Fetched::LastGame(Some(last("e"))))
            .unwrap()
            .is_empty()
    );
}
