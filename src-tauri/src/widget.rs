//! The phone's home-screen widget: today's tasks and habits, tickable from
//! the widget.
//!
//! Rust keeps a snapshot (`widget.json` in the data folder) for the Kotlin
//! widget to draw: the app writes it after changes, and the widget asks for
//! a fresh one (and applies its ticks) by opening the database with the
//! fingerprint-unlock key kept on the phone. Without that key the widget
//! shows the last snapshot and taps open the app.

use std::path::Path;

use chrono::{Datelike, Duration, Local, Months, NaiveDate};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::error::Result;

pub const FILE: &str = "widget.json";
const MAX_TASKS: usize = 12;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetTask {
    pub id: String,
    pub title: String,
    /// "Overdue", "5:00 pm" or "" (due today, no time).
    pub when: String,
    pub overdue: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetHabit {
    pub id: String,
    pub name: String,
    pub color: String,
    pub done: bool,
    /// "2 / 8 glasses" for counted habits.
    pub progress: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub date: String,
    /// "Thu 15 Oct".
    pub label: String,
    pub tasks: Vec<WidgetTask>,
    /// Due today or earlier, beyond the ones listed.
    pub more_tasks: usize,
    pub habits: Vec<WidgetHabit>,
    /// The widget can tick things itself (fingerprint unlock is set up).
    pub live: bool,
    pub at: i64,
}

fn clock(time: &str) -> String {
    let Some((h, m)) = time.split_once(':') else {
        return time.to_string();
    };
    let (h, m): (u32, u32) = (h.parse().unwrap_or(0), m.parse().unwrap_or(0));
    let suffix = if h >= 12 { "pm" } else { "am" };
    let h12 = if h % 12 == 0 { 12 } else { h % 12 };
    if m == 0 {
        format!("{h12} {suffix}")
    } else {
        format!("{h12}:{m:02} {suffix}")
    }
}

/// Whether a habit is expected today (weekly habits count every day).
fn scheduled(schedule: &str, weekday: u32) -> bool {
    let v: serde_json::Value = serde_json::from_str(schedule).unwrap_or_default();
    match v["type"].as_str() {
        Some("weekdays") => v["days"]
            .as_array()
            .is_some_and(|d| d.iter().any(|x| x.as_u64() == Some(weekday as u64))),
        _ => true,
    }
}

pub fn snapshot(conn: &Connection, today: NaiveDate, live: bool) -> Result<Snapshot> {
    let day = today.format("%Y-%m-%d").to_string();
    let mut stmt = conn.prepare(
        "SELECT id, title, due_date, due_time FROM tasks
         WHERE list = 'todo' AND status != 'done' AND deleted_at IS NULL
           AND due_date IS NOT NULL AND due_date <= ?1
         ORDER BY due_date < ?1 DESC, due_time IS NULL, due_time, priority DESC, sort_order",
    )?;
    let all: Vec<WidgetTask> = stmt
        .query_map([&day], |r| {
            let due: String = r.get(2)?;
            let time: Option<String> = r.get(3)?;
            let overdue = due < day;
            Ok(WidgetTask {
                id: r.get(0)?,
                title: r.get(1)?,
                when: if overdue {
                    "Overdue".into()
                } else {
                    time.as_deref().map(clock).unwrap_or_default()
                },
                overdue,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let more_tasks = all.len().saturating_sub(MAX_TASKS);
    let tasks = all.into_iter().take(MAX_TASKS).collect();

    let weekday = today.weekday().number_from_monday();
    let mut stmt = conn.prepare(
        "SELECT h.id, h.name, h.color, h.kind, h.target, h.unit, h.schedule, coalesce(l.value, 0)
         FROM habits h
         LEFT JOIN habit_logs l ON l.habit_id = h.id AND l.date = ?1 AND l.deleted_at IS NULL
         WHERE h.deleted_at IS NULL AND h.archived = 0 AND h.start_date <= ?1
         ORDER BY h.sort_order, h.created_at",
    )?;
    let habits = stmt
        .query_map([&day], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, f64>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, f64>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter(|h| scheduled(&h.6, weekday))
        .map(|(id, name, color, kind, target, unit, _, value)| {
            let counted = kind == "count";
            WidgetHabit {
                id,
                name,
                color,
                done: value >= if counted { target } else { 1.0 },
                progress: counted.then(|| {
                    format!(
                        "{} / {}{}",
                        value,
                        target,
                        unit.map(|u| format!(" {u}")).unwrap_or_default()
                    )
                }),
            }
        })
        .collect();

    Ok(Snapshot {
        label: today.format("%a %-d %b").to_string(),
        date: day,
        tasks,
        more_tasks,
        habits,
        live,
        at: chrono::Utc::now().timestamp_millis(),
    })
}

pub fn write(data_dir: &Path, snap: &Snapshot) -> Result<String> {
    let json = serde_json::to_string(snap)?;
    std::fs::write(data_dir.join(FILE), &json)?;
    Ok(json)
}

/// The next due date after completing a recurring task (as the app does):
/// counted from the due date, never today or earlier.
pub fn next_due(recurrence: &str, due: Option<NaiveDate>, today: NaiveDate) -> Option<NaiveDate> {
    let step = |d: NaiveDate| -> Option<NaiveDate> {
        Some(match recurrence {
            "daily" => d + Duration::days(1),
            "weekdays" => {
                let mut n = d + Duration::days(1);
                while n.weekday().number_from_monday() > 5 {
                    n += Duration::days(1);
                }
                n
            }
            "weekly" => d + Duration::days(7),
            "monthly" => d.checked_add_months(Months::new(1))?,
            "yearly" => d.checked_add_months(Months::new(12))?,
            _ => return None,
        })
    };
    let mut next = step(due.unwrap_or(today))?;
    while next <= today {
        next = step(next)?;
    }
    Some(next)
}

fn record_activity(
    conn: &Connection,
    type_id: &str,
    day: &str,
    table: &str,
    source: &str,
    device: &str,
    now: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO activity_events (id, type_id, date, occurred_at, quantity, source_table, source_id, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?4, ?4, ?7)
         ON CONFLICT (id) DO UPDATE SET type_id = excluded.type_id, date = excluded.date, occurred_at = excluded.occurred_at,
           quantity = 1, deleted_at = NULL, updated_at = excluded.updated_at",
        params![format!("ae:{table}:{source}"), type_id, day, now, table, source, device],
    )?;
    Ok(())
}

fn clear_activity(conn: &Connection, table: &str, source: &str, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE activity_events SET deleted_at = ?1 WHERE source_table = ?2 AND source_id = ?3 AND deleted_at IS NULL",
        params![now, table, source],
    )?;
    Ok(())
}

/// Completes a task from the widget, scheduling the next one for a
/// recurring task, as the app does.
pub fn complete_task(conn: &Connection, id: &str, today: NaiveDate, device: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let day = today.format("%Y-%m-%d").to_string();
    type Row = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        i64,
        String,
    );
    let row: Option<Row> = conn
        .query_row(
            "SELECT list, title, notes, due_date, due_time, remind, recurrence, priority, tags FROM tasks
             WHERE id = ?1 AND status != 'done' AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
        )
        .optional()?;
    let Some((list, title, notes, due, time, remind, recurrence, priority, tags)) = row else {
        return Ok(());
    };
    conn.execute(
        "UPDATE tasks SET status = 'done', completed_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    if list == "todo" {
        record_activity(conn, "tasks", &day, "tasks", id, device, now)?;
    }
    if let Some(rule) = recurrence {
        let due_date = due
            .as_deref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
        if let Some(next) = next_due(&rule, due_date, today) {
            conn.execute(
                "INSERT INTO tasks (id, list, title, notes, due_date, due_time, remind, recurrence, priority, tags, created_at, updated_at, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)",
                params![
                    uuid::Uuid::now_v7().to_string(),
                    list,
                    title,
                    notes,
                    next.format("%Y-%m-%d").to_string(),
                    time,
                    remind,
                    rule,
                    priority,
                    tags,
                    now,
                    device
                ],
            )?;
        }
    }
    Ok(())
}

/// Ticks a habit for today from the widget: a check habit toggles, a
/// counted one goes up by one (and back to zero once past its target).
pub fn tap_habit(conn: &Connection, id: &str, today: NaiveDate, device: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let day = today.format("%Y-%m-%d").to_string();
    let Some((kind, target)): Option<(String, f64)> = conn
        .query_row(
            "SELECT kind, target FROM habits WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
    else {
        return Ok(());
    };
    let log_id = format!("hl:{id}:{day}");
    let current: f64 = conn
        .query_row(
            "SELECT value FROM habit_logs WHERE habit_id = ?1 AND date = ?2 AND deleted_at IS NULL",
            params![id, day],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0.0);
    let goal = if kind == "count" { target } else { 1.0 };
    let value = if current >= goal {
        0.0
    } else if kind == "count" {
        current + 1.0
    } else {
        1.0
    };
    if value <= 0.0 {
        conn.execute(
            "UPDATE habit_logs SET deleted_at = ?1, updated_at = ?1 WHERE habit_id = ?2 AND date = ?3 AND deleted_at IS NULL",
            params![now, id, day],
        )?;
    } else {
        let updated = conn.execute(
            "UPDATE habit_logs SET value = ?1, deleted_at = NULL, updated_at = ?2 WHERE habit_id = ?3 AND date = ?4",
            params![value, now, id, day],
        )?;
        if updated == 0 {
            conn.execute(
                "INSERT INTO habit_logs (id, habit_id, date, value, created_at, updated_at, device_id) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
                params![log_id, id, day, value, now, device],
            )?;
        }
    }
    let source = format!("{id}:{day}");
    if value >= goal {
        record_activity(conn, "habits", &day, "habit_logs", &source, device, now)?;
    } else {
        clear_activity(conn, "habit_logs", &source, now)?;
    }
    Ok(())
}

/// Applies a widget action (`refresh`, `task:<id>`, `habit:<id>`) with the
/// database open, then writes and returns the new snapshot.
pub fn act(
    conn: &Connection,
    data_dir: &Path,
    device: &str,
    action: &str,
    live: bool,
) -> Result<String> {
    let today = Local::now().date_naive();
    if let Some(id) = action.strip_prefix("task:") {
        complete_task(conn, id, today, device)?;
    } else if let Some(id) = action.strip_prefix("habit:") {
        tap_habit(conn, id, today, device)?;
    }
    write(data_dir, &snapshot(conn, today, live)?)
}

/// Opens the database with the phone's fingerprint-unlock key and applies
/// `action`; without the key, returns the last snapshot unchanged.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn background(data_dir: &Path, action: &str) -> Result<String> {
    use crate::db::{DB_FILE, Database};
    let last = || std::fs::read_to_string(data_dir.join(FILE)).unwrap_or_default();
    if !crate::vault::exists(data_dir) {
        return Ok(last());
    }
    let Some(key) = crate::vault::load_device_key(data_dir)? else {
        return Ok(last());
    };
    let db = Database::open(
        &data_dir.join(DB_FILE),
        &key,
        Some(&crate::backup::default_dir(data_dir)),
    )?;
    let device = db.device_id()?;
    act(db.conn(), data_dir, &device, action, true)
}

/// Entry point for `TodayWidget.nativeWidget(dataDir, action)`: the new
/// snapshot as JSON (empty when there is none yet).
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_matt_kaizen_TodayWidget_nativeWidget<'local>(
    mut env: jni::JNIEnv<'local>,
    _class: jni::objects::JClass<'local>,
    data_dir: jni::objects::JString<'local>,
    action: jni::objects::JString<'local>,
) -> jni::sys::jstring {
    let dir: Option<String> = env.get_string(&data_dir).map(String::from).ok();
    let action: String = env
        .get_string(&action)
        .map(String::from)
        .unwrap_or_default();
    let json = dir
        .and_then(|dir| {
            let dir = std::path::PathBuf::from(dir);
            crate::logging::init(&dir.join("logs"));
            match std::panic::catch_unwind(|| background(&dir, &action)) {
                Ok(Ok(json)) => Some(json),
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, action, "widget action failed");
                    std::fs::read_to_string(dir.join(FILE)).ok()
                }
                Err(_) => None,
            }
        })
        .unwrap_or_default();
    env.new_string(json)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn lists_due_tasks_and_todays_habits() {
        let conn = db();
        conn.execute_batch(
            "INSERT INTO tasks (id, list, title, due_date, due_time, created_at, updated_at, device_id) VALUES
               ('a', 'todo', 'Later today', '2026-10-15', '17:30', 1, 1, 'd'),
               ('b', 'todo', 'Old one', '2026-10-13', NULL, 1, 1, 'd'),
               ('c', 'todo', 'Tomorrow', '2026-10-16', NULL, 1, 1, 'd'),
               ('e', 'watch', 'A film', '2026-10-15', NULL, 1, 1, 'd');
             INSERT INTO habits (id, name, color, kind, target, unit, schedule, start_date, created_at, updated_at, device_id) VALUES
               ('h1', 'Read', '#f00', 'check', 1, NULL, '{\"type\":\"daily\"}', '2026-01-01', 1, 1, 'd'),
               ('h2', 'Water', '#00f', 'count', 8, 'glasses', '{\"type\":\"daily\"}', '2026-01-01', 2, 2, 'd'),
               ('h3', 'Gym', '#0f0', 'check', 1, NULL, '{\"type\":\"weekdays\",\"days\":[1,3]}', '2026-01-01', 3, 3, 'd');",
        )
        .unwrap();
        let s = snapshot(&conn, d("2026-10-15"), true).unwrap();
        assert_eq!(s.label, "Thu 15 Oct");
        let tasks: Vec<_> = s
            .tasks
            .iter()
            .map(|t| (t.title.as_str(), t.when.as_str()))
            .collect();
        assert_eq!(
            tasks,
            vec![("Old one", "Overdue"), ("Later today", "5:30 pm")]
        );
        let habits: Vec<_> = s.habits.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(habits, vec!["Read", "Water"]);
        assert_eq!(s.habits[1].progress.as_deref(), Some("0 / 8 glasses"));
    }

    #[test]
    fn completes_tasks_and_schedules_the_next_one() {
        let conn = db();
        conn.execute(
            "INSERT INTO tasks (id, list, title, due_date, recurrence, created_at, updated_at, device_id) VALUES ('r', 'todo', 'Gym', '2026-10-15', 'weekdays', 1, 1, 'd')",
            [],
        )
        .unwrap();
        complete_task(&conn, "r", d("2026-10-16"), "d").unwrap();
        let next: String = conn
            .query_row(
                "SELECT due_date FROM tasks WHERE id != 'r' AND status = 'open'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(next, "2026-10-19");
        let events: i64 = conn
            .query_row("SELECT count(*) FROM activity_events WHERE id = 'ae:tasks:r' AND deleted_at IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 1);
        // A second tap does nothing more.
        complete_task(&conn, "r", d("2026-10-16"), "d").unwrap();
        let open: i64 = conn
            .query_row(
                "SELECT count(*) FROM tasks WHERE status = 'open'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(open, 1);
    }

    #[test]
    fn ticks_check_and_counted_habits() {
        let conn = db();
        conn.execute_batch(
            "INSERT INTO habits (id, name, color, kind, target, schedule, start_date, created_at, updated_at, device_id) VALUES
               ('h1', 'Read', '#f00', 'check', 1, '{\"type\":\"daily\"}', '2026-01-01', 1, 1, 'd'),
               ('h2', 'Water', '#00f', 'count', 2, '{\"type\":\"daily\"}', '2026-01-01', 2, 2, 'd');",
        )
        .unwrap();
        let today = d("2026-10-15");
        let done = |conn: &Connection| {
            snapshot(conn, today, true)
                .unwrap()
                .habits
                .iter()
                .map(|h| h.done)
                .collect::<Vec<_>>()
        };
        tap_habit(&conn, "h1", today, "d").unwrap();
        tap_habit(&conn, "h2", today, "d").unwrap();
        assert_eq!(done(&conn), vec![true, false]);
        tap_habit(&conn, "h2", today, "d").unwrap();
        assert_eq!(done(&conn), vec![true, true]);
        let events: i64 = conn
            .query_row("SELECT count(*) FROM activity_events WHERE type_id = 'habits' AND deleted_at IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 2);
        tap_habit(&conn, "h1", today, "d").unwrap();
        assert_eq!(done(&conn), vec![false, true]);
        let events: i64 = conn
            .query_row("SELECT count(*) FROM activity_events WHERE type_id = 'habits' AND deleted_at IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 1);
    }

    #[test]
    fn steps_recurring_dates_like_the_app() {
        assert_eq!(
            next_due("daily", Some(d("2026-10-10")), d("2026-10-15")),
            Some(d("2026-10-16"))
        );
        assert_eq!(
            next_due("monthly", Some(d("2026-01-31")), d("2026-01-31")),
            Some(d("2026-02-28"))
        );
        assert_eq!(
            next_due("weekly", None, d("2026-10-15")),
            Some(d("2026-10-22"))
        );
    }
}
