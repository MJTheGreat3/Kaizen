//! The Mac's desktop widgets: a WidgetKit extension inside the app
//! (`Contents/PlugIns/KaizenWidgets.appex`, built from `src-tauri/macos`).
//!
//! The extension is sandboxed and can only reach `widgets/` in the data
//! folder. Kaizen writes what the widgets show there (`today.json`: the same
//! snapshot as the phone's widget; `feed.json`: streaks, Up next, debts and
//! goals from the app; `music.json`: what Spotify is playing) and asks
//! WidgetKit to redraw. A tap on a widget leaves a small file in
//! `widgets/actions/`, which Kaizen applies here once the database is
//! unlocked. Links on the widgets open `kaizen://open/<kind>`.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value as JsonValue, json};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::Result;
use crate::{AppState, music, widget};

unsafe extern "C" {
    /// `WidgetCenter.shared.reloadAllTimelines()` (macos/WidgetCenter.swift).
    fn kaizen_reload_widgets();
}

pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("widgets")
}

/// Asks WidgetKit to redraw every Kaizen widget.
pub fn reload() {
    unsafe { kaizen_reload_widgets() }
}

fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<()> {
    // Written whole, then moved into place, so a widget never reads half a file.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec(value)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Rewrites the widgets' data from the database (and the app's `feed`, when
/// given), then redraws them.
pub fn refresh(state: &AppState, feed: Option<&JsonValue>) -> Result<()> {
    let dir = dir(&state.data_dir);
    std::fs::create_dir_all(dir.join("actions"))?;
    if let Some(feed) = feed {
        write_json(&dir.join("feed.json"), feed)?;
    }
    let guard = state.session.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(s) = guard.as_ref() {
        let today = chrono::Local::now().date_naive();
        write_json(
            &dir.join("today.json"),
            &widget::snapshot(s.db.conn(), today, true)?,
        )?;
    }
    drop(guard);
    reload();
    Ok(())
}

/// Applies one action from a widget. `Ok(false)` leaves it for later (the
/// database is locked).
fn apply(app: &AppHandle, action: &str) -> Result<bool> {
    let state = app.state::<AppState>();
    if let Some(what) = action.strip_prefix("music:") {
        music_command(app, what)?;
        return Ok(true);
    }
    let guard = state.session.lock().unwrap_or_else(|e| e.into_inner());
    let Some(s) = guard.as_ref() else {
        return Ok(false);
    };
    let today = chrono::Local::now().date_naive();
    let device = s.db.device_id()?;
    if let Some(id) = action.strip_prefix("task:") {
        widget::complete_task(s.db.conn(), id, today, &device)?;
    } else if let Some(id) = action.strip_prefix("habit:") {
        widget::tap_habit(s.db.conn(), id, today, &device)?;
    }
    Ok(true)
}

/// Plays, pauses or skips on Spotify.
fn music_command(app: &AppHandle, what: &str) -> Result<()> {
    let (method, path) = match what {
        "play" => ("PUT", "/me/player/play"),
        "pause" => ("PUT", "/me/player/pause"),
        "next" => ("POST", "/me/player/next"),
        "prev" => ("POST", "/me/player/previous"),
        _ => return Ok(()),
    };
    let token = crate::commands::music_token(app)?;
    let (status, body) = music::call(&token, method, path, None)?;
    if status == 401 {
        music::drop_access();
    }
    if status >= 400 {
        tracing::info!(status, %body, "widget music command failed");
    }
    Ok(())
}

/// Applies waiting actions, oldest first. Returns whether any changed data.
fn take_actions(app: &AppHandle, data_dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir(data_dir).join("actions")) else {
        return false;
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "txt"))
        .collect();
    files.sort();
    let mut changed = false;
    for file in files {
        let action = std::fs::read_to_string(&file).unwrap_or_default();
        match apply(app, action.trim()) {
            Ok(false) => break,
            Ok(true) => changed = true,
            Err(e) => tracing::warn!(error = %e, action = action.trim(), "widget action failed"),
        }
        let _ = std::fs::remove_file(&file);
    }
    changed
}

/// What Spotify is playing, for the music widget.
fn now_playing(app: &AppHandle) -> Result<JsonValue> {
    let token = crate::commands::music_token(app)?;
    let (status, body) = music::call(&token, "GET", "/me/player?additional_types=episode", None)?;
    if status == 401 {
        music::drop_access();
    }
    let item = &body["item"];
    if status >= 400 || item.is_null() {
        return Ok(json!({ "connected": true }));
    }
    let images = item["album"]["images"]
        .as_array()
        .or(item["images"].as_array());
    // The smallest cover that is at least 300 px.
    let art = images.and_then(|list| {
        list.iter()
            .filter(|i| i["width"].as_i64().unwrap_or(640) >= 300)
            .min_by_key(|i| i["width"].as_i64().unwrap_or(640))
            .or(list.first())
            .and_then(|i| i["url"].as_str())
    });
    let artist = item["artists"].as_array().map(|a| {
        a.iter()
            .filter_map(|x| x["name"].as_str())
            .collect::<Vec<_>>()
            .join(", ")
    });
    Ok(json!({
        "connected": true,
        "title": item["name"],
        "artist": artist.or_else(|| item["show"]["name"].as_str().map(String::from)),
        "art": art,
        "uri": item["uri"],
        "playing": body["is_playing"],
        "progressMs": body["progress_ms"],
        "durationMs": item["duration_ms"],
        "at": chrono::Utc::now().timestamp_millis(),
    }))
}

/// Whether two music states differ in what the widget shows (not position).
fn music_changed(a: &JsonValue, b: &JsonValue) -> bool {
    ["title", "artist", "art", "playing", "connected"]
        .iter()
        .any(|k| a[k] != b[k])
}

/// Runs for the life of the app: applies widget taps and keeps the music
/// widget in step with Spotify.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let data_dir = app.state::<AppState>().data_dir.clone();
        let _ = std::fs::create_dir_all(dir(&data_dir).join("actions"));
        let mut last_music = JsonValue::Null;
        let mut next_music = Instant::now();
        loop {
            if take_actions(&app, &data_dir) {
                let state = app.state::<AppState>();
                if let Err(e) = refresh(&state, None) {
                    tracing::warn!(error = %e, "widget refresh failed");
                }
                let _ = app.emit("widget://changed", ());
                // A music button: show the result soon.
                next_music = Instant::now() + Duration::from_millis(700);
            }
            if Instant::now() >= next_music {
                next_music = Instant::now() + Duration::from_secs(10);
                let connected = {
                    let state = app.state::<AppState>();
                    let guard = state.session.lock().unwrap_or_else(|e| e.into_inner());
                    guard
                        .as_ref()
                        .is_some_and(|s| music::refresh_token(s.db.conn()).is_ok())
                };
                let current = if connected && music::configured() {
                    now_playing(&app).unwrap_or_else(|_| last_music.clone())
                } else {
                    json!({ "connected": false })
                };
                if (music_changed(&current, &last_music) || last_music.is_null())
                    && write_json(&dir(&data_dir).join("music.json"), &current).is_ok()
                {
                    reload();
                }
                last_music = current;
            }
            std::thread::sleep(Duration::from_millis(800));
        }
    });
}

/// `kaizen://open/<kind>` from a widget: the same kinds as the phone's
/// shortcuts and widgets (`task`, `expense`, `page:goals`, ...).
pub fn open_url(app: &AppHandle, url: &str) {
    let Some(kind) = url.strip_prefix("kaizen://open/") else {
        return;
    };
    let kind = kind.trim_end_matches('/').to_string();
    crate::desktop::show(app);
    let _ = app.emit("widget://open", kind);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn music_changes_ignore_position() {
        let a = json!({ "title": "A", "playing": true, "progressMs": 1 });
        let b = json!({ "title": "A", "playing": true, "progressMs": 9000 });
        assert!(!music_changed(&a, &b));
        assert!(music_changed(
            &a,
            &json!({ "title": "A", "playing": false })
        ));
    }
}
