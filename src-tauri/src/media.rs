//! Details for the watch and read lists: books from Open Library, films
//! and shows from IMDb's search suggestions, and anime from AniList. None
//! of them needs an account or key.

use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::error::{Error, Result};
use crate::oauth::percent_encode;
use crate::practice::http::Http;

/// One match, in the shape a list item's details take.
#[derive(Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// `openlibrary:/works/OL1W`, `imdb:tt1160419` or `anilist:20`.
    pub source_id: String,
    pub title: String,
    /// Author, lead actors or studio.
    pub creator: Option<String>,
    pub year: Option<i32>,
    /// book, movie, show or anime.
    pub medium: String,
    pub pages: Option<i64>,
    pub episodes: Option<i64>,
    pub runtime_minutes: Option<i64>,
    pub genres: Vec<String>,
    pub cover: Option<String>,
}

fn text(v: &JsonValue) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// The year at the start of a date such as `2010-07-16T07:00:00Z`.
fn year_of(v: &JsonValue) -> Option<i32> {
    v.as_i64()
        .map(|y| y as i32)
        .or_else(|| v.as_str().and_then(|s| s.get(..4)?.parse().ok()))
}

pub fn parse_books(body: &JsonValue) -> Vec<Found> {
    let docs = body["docs"].as_array().cloned().unwrap_or_default();
    docs.iter()
        .filter_map(|d| {
            Some(Found {
                source_id: format!("openlibrary:{}", text(&d["key"])?),
                title: text(&d["title"])?,
                creator: d["author_name"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(text)
                            .take(2)
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .filter(|s| !s.is_empty()),
                year: year_of(&d["first_publish_year"]),
                medium: "book".into(),
                pages: d["number_of_pages_median"].as_i64(),
                genres: d["subject"]
                    .as_array()
                    .map(|a| a.iter().filter_map(text).take(3).collect())
                    .unwrap_or_default(),
                cover: d["cover_i"]
                    .as_i64()
                    .map(|id| format!("https://covers.openlibrary.org/b/id/{id}-M.jpg")),
                ..Default::default()
            })
        })
        .collect()
}

/// Films and shows; other titles (games, people, podcasts) are skipped.
pub fn parse_imdb(body: &JsonValue) -> Vec<Found> {
    let results = body["d"].as_array().cloned().unwrap_or_default();
    results
        .iter()
        .filter_map(|m| {
            let medium = match m["qid"].as_str()? {
                "movie" | "tvMovie" => "movie",
                "tvSeries" | "tvMiniSeries" => "show",
                _ => return None,
            };
            let id = text(&m["id"]).filter(|id| id.starts_with("tt"))?;
            Some(Found {
                source_id: format!("imdb:{id}"),
                title: text(&m["l"])?,
                creator: text(&m["s"]),
                year: year_of(&m["y"]),
                medium: medium.into(),
                // A smaller rendition of the poster.
                cover: text(&m["i"]["imageUrl"]).map(|u| u.replace("._V1_.", "._V1_UX300_.")),
                ..Default::default()
            })
        })
        .collect()
}

pub const ANILIST_QUERY: &str = "query ($q: String) { Page(perPage: 5) { media(search: $q, type: ANIME, isAdult: false) { id title { romaji english } seasonYear startDate { year } episodes duration format genres studios(isMain: true) { nodes { name } } coverImage { medium } } } }";

pub fn parse_anime(body: &JsonValue) -> Vec<Found> {
    let media = body["data"]["Page"]["media"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    media
        .iter()
        .filter_map(|a| {
            let studios: Vec<String> = a["studios"]["nodes"]
                .as_array()
                .map(|l| l.iter().filter_map(|x| text(&x["name"])).collect())
                .unwrap_or_default();
            Some(Found {
                source_id: format!("anilist:{}", a["id"].as_i64()?),
                title: text(&a["title"]["english"]).or_else(|| text(&a["title"]["romaji"]))?,
                creator: Some(studios.join(", ")).filter(|s| !s.is_empty()),
                year: year_of(&a["seasonYear"]).or_else(|| year_of(&a["startDate"]["year"])),
                medium: if a["format"].as_str() == Some("MOVIE") {
                    "movie".into()
                } else {
                    "anime".into()
                },
                episodes: a["episodes"]
                    .as_i64()
                    .filter(|_| a["format"].as_str() != Some("MOVIE")),
                runtime_minutes: a["duration"].as_i64(),
                genres: a["genres"]
                    .as_array()
                    .map(|l| l.iter().filter_map(text).take(3).collect())
                    .unwrap_or_default(),
                cover: text(&a["coverImage"]["medium"]),
                ..Default::default()
            })
        })
        .collect()
}

/// Puts exact title matches first, otherwise keeping the order given.
fn rank(mut found: Vec<Found>, query: &str) -> Vec<Found> {
    let q = query.trim().to_lowercase();
    found.sort_by_key(|f| f.title.to_lowercase() != q);
    found
}

/// Takes from each list in turn, so every source shows near the top.
fn interleave(lists: Vec<Vec<Found>>) -> Vec<Found> {
    let mut iters: Vec<_> = lists.into_iter().map(Vec::into_iter).collect();
    let mut out = Vec::new();
    loop {
        let before = out.len();
        for it in iters.iter_mut() {
            out.extend(it.next());
        }
        if out.len() == before {
            return out;
        }
    }
}

/// Matches for a title on the `read` or `watch` list.
pub fn search(list: &str, query: &str) -> Result<Vec<Found>> {
    let q = percent_encode(query.trim());
    let http = Http::new();
    if list == "read" {
        let url = format!(
            "https://openlibrary.org/search.json?q={q}&limit=6&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject"
        );
        return Ok(rank(parse_books(&http.json(&url)?), query));
    }
    let query_text = query.trim().to_string();
    let (films, anime) = std::thread::scope(|scope| {
        let http = &http;
        // IMDb wants the path in lower case, spaces as underscores.
        let slug = percent_encode(&query_text.to_lowercase().replace(' ', "_"));
        let films = scope.spawn(move || {
            let first = slug.chars().next().unwrap_or('x');
            http.json(&format!(
                "https://v3.sg.media-imdb.com/suggestion/{first}/{slug}.json"
            ))
            .map(|body| parse_imdb(&body))
        });
        let anime = scope.spawn(|| {
            http.post_json(
                "https://graphql.anilist.co",
                serde_json::json!({ "query": ANILIST_QUERY, "variables": { "q": query_text } }),
            )
            .map(|body| parse_anime(&body))
        });
        let join = |h: std::thread::ScopedJoinHandle<'_, Result<Vec<Found>>>| {
            h.join()
                .unwrap_or_else(|_| Err(Error::Http("lookup failed".into())))
        };
        (join(films), join(anime))
    });
    let results = [films, anime];
    if let Some(Err(e)) = results.iter().find(|r| r.is_err())
        && results.iter().all(|r| r.is_err())
    {
        return Err(Error::Http(e.to_string()));
    }
    let lists = results
        .into_iter()
        .map(|r| r.unwrap_or_default().into_iter().take(5).collect())
        .collect();
    Ok(rank(interleave(lists), query))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_books() {
        let body = json!({ "docs": [{
            "key": "/works/OL27448W", "title": "The Lord of the Rings",
            "author_name": ["J.R.R. Tolkien"], "first_publish_year": 1954,
            "number_of_pages_median": 1193, "cover_i": 14625765,
            "subject": ["Fantasy", "Fiction", "Middle Earth", "Quests"]
        }, { "title": "No key" }] });
        let found = parse_books(&body);
        assert_eq!(found.len(), 1);
        let b = &found[0];
        assert_eq!(b.source_id, "openlibrary:/works/OL27448W");
        assert_eq!(b.creator.as_deref(), Some("J.R.R. Tolkien"));
        assert_eq!((b.year, b.pages), (Some(1954), Some(1193)));
        assert_eq!(b.genres, ["Fantasy", "Fiction", "Middle Earth"]);
        assert_eq!(
            b.cover.as_deref(),
            Some("https://covers.openlibrary.org/b/id/14625765-M.jpg")
        );
    }

    #[test]
    fn reads_films_shows_and_anime() {
        let found = parse_imdb(&json!({ "d": [
            { "id": "tt1160419", "l": "Dune", "qid": "movie", "s": "Timothée Chalamet, Rebecca Ferguson", "y": 2021,
              "i": { "imageUrl": "https://m.media-amazon.com/images/M/abc._V1_.jpg" } },
            { "id": "tt0903747", "l": "Breaking Bad", "qid": "tvSeries", "s": "Bryan Cranston", "y": 2008 },
            { "id": "tt9", "l": "Dune game", "qid": "videoGame" },
            { "id": "nm1", "l": "Someone" }
        ] }));
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].medium, "movie");
        assert_eq!(
            found[0].creator.as_deref(),
            Some("Timothée Chalamet, Rebecca Ferguson")
        );
        assert_eq!(
            found[0].cover.as_deref(),
            Some("https://m.media-amazon.com/images/M/abc._V1_UX300_.jpg")
        );
        assert_eq!(
            (found[1].medium.as_str(), found[1].year),
            ("show", Some(2008))
        );

        let anime = parse_anime(&json!({ "data": { "Page": { "media": [{
            "id": 5114, "title": { "romaji": "Hagane no Renkinjutsushi", "english": "Fullmetal Alchemist: Brotherhood" },
            "seasonYear": 2009, "episodes": 64, "duration": 24, "format": "TV", "genres": ["Action", "Adventure"],
            "studios": { "nodes": [{ "name": "Bones" }] }, "coverImage": { "medium": "https://s4.anilist.co/a.jpg" }
        }, {
            "id": 1, "title": { "romaji": "Kimi no Na wa.", "english": null }, "seasonYear": null,
            "startDate": { "year": 2016 }, "episodes": 1, "duration": 106, "format": "MOVIE", "genres": [],
            "studios": { "nodes": [] }, "coverImage": { "medium": null }
        }] } } }));
        assert_eq!(anime[0].title, "Fullmetal Alchemist: Brotherhood");
        assert_eq!((anime[0].year, anime[0].episodes), (Some(2009), Some(64)));
        assert_eq!(anime[0].creator.as_deref(), Some("Bones"));
        assert_eq!(
            (anime[1].medium.as_str(), anime[1].year, anime[1].episodes),
            ("movie", Some(2016), None)
        );
        assert_eq!(anime[1].title, "Kimi no Na wa.");
    }

    /// Hits the real services; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn looks_up_live() {
        assert!(!search("read", "dune").unwrap().is_empty());
        let watch = search("watch", "naruto").unwrap();
        assert!(watch.iter().any(|f| f.medium == "anime"), "{watch:?}");
        assert!(
            watch.iter().any(|f| f.source_id.starts_with("imdb:")),
            "{watch:?}"
        );
    }

    #[test]
    fn mixes_sources_with_exact_titles_first() {
        let f = |id: &str, title: &str| Found {
            source_id: id.into(),
            title: title.into(),
            ..Default::default()
        };
        let mixed = interleave(vec![
            vec![f("m1", "Dune Part Two"), f("m2", "Dune")],
            vec![f("s1", "Dune Prophecy")],
        ]);
        let ids: Vec<_> = rank(mixed, "dune")
            .into_iter()
            .map(|f| f.source_id)
            .collect();
        assert_eq!(ids, ["m2", "m1", "s1"]);
    }
}
