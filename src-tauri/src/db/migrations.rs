//! Versioned schema migrations, tracked with `PRAGMA user_version`.
//!
//! Every synced table has the shared columns `id`, `created_at`, `updated_at`,
//! `deleted_at` and `device_id`, plus triggers that record each change in
//! `sync_changes` for LAN sync (Phase 2). Keep `src/core/db/schema.ts` in step
//! with this file.

use rusqlite::Connection;

use crate::error::Result;

/// Tables created in v1 whose changes are recorded in `sync_changes`.
/// Each migration lists its own tables so older migrations never change.
const V1_SYNCED: &[&str] = &[
    "settings",
    "devices",
    "activity_types",
    "activity_events",
    "reminders",
    "attachments",
];

const NOW_MS: &str = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

fn sync_triggers(table: &str) -> String {
    let device = "(SELECT value FROM local_meta WHERE key = 'device_id')";
    format!(
        "
CREATE TRIGGER {table}_sync_insert AFTER INSERT ON {table} BEGIN
  INSERT INTO sync_changes (table_name, row_id, op, changed_at, device_id)
  VALUES ('{table}', NEW.id, 'insert', {NOW_MS}, {device});
END;
CREATE TRIGGER {table}_sync_update AFTER UPDATE ON {table} BEGIN
  INSERT INTO sync_changes (table_name, row_id, op, changed_at, device_id)
  VALUES ('{table}', NEW.id, 'update', {NOW_MS}, {device});
END;
CREATE TRIGGER {table}_sync_delete AFTER DELETE ON {table} BEGIN
  INSERT INTO sync_changes (table_name, row_id, op, changed_at, device_id)
  VALUES ('{table}', OLD.id, 'delete', {NOW_MS}, {device});
END;
"
    )
}

const BASE_COLUMNS: &str = "
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  device_id  TEXT NOT NULL";

fn v1() -> String {
    let mut sql = format!(
        "
-- Device-local values, never synced.
CREATE TABLE local_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE sync_changes (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  op         TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  changed_at INTEGER NOT NULL,
  device_id  TEXT
) STRICT;
CREATE INDEX sync_changes_row ON sync_changes (table_name, row_id);

-- Synced key/value settings; `id` is the setting key, `value` is JSON.
CREATE TABLE settings (
  id    TEXT PRIMARY KEY,
  value TEXT NOT NULL,{BASE_COLUMNS}
) STRICT;

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  platform     TEXT NOT NULL,
  last_seen_at INTEGER,{BASE_COLUMNS}
) STRICT;

CREATE TABLE activity_types (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL,
  unit            TEXT,
  active_day_rule TEXT NOT NULL DEFAULT '{{}}',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_builtin      INTEGER NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;

CREATE TABLE activity_events (
  id           TEXT PRIMARY KEY,
  type_id      TEXT NOT NULL REFERENCES activity_types (id),
  date         TEXT NOT NULL,
  occurred_at  INTEGER NOT NULL,
  quantity     REAL NOT NULL DEFAULT 1,
  unit         TEXT,
  source_table TEXT,
  source_id    TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX activity_events_date ON activity_events (date, type_id);
CREATE INDEX activity_events_source ON activity_events (source_table, source_id);

CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  target_type TEXT,
  target_id   TEXT,
  title       TEXT NOT NULL,
  body        TEXT,
  fire_at     INTEGER NOT NULL,
  recurrence  TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled',{BASE_COLUMNS}
) STRICT;
CREATE INDEX reminders_fire_at ON reminders (status, fire_at);

CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  owner_table TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  mime_type   TEXT,
  size_bytes  INTEGER NOT NULL,
  rel_path    TEXT NOT NULL,{BASE_COLUMNS}
) STRICT;
CREATE INDEX attachments_owner ON attachments (owner_table, owner_id);

-- Full-text index over every module (filled from Phase 1 onwards).
CREATE VIRTUAL TABLE search_index USING fts5 (
  module,
  ref_id UNINDEXED,
  title,
  body,
  tags,
  tokenize = 'trigram'
);
"
    );
    for table in V1_SYNCED {
        sql.push_str(&sync_triggers(table));
    }
    sql
}

const V2_SYNCED: &[&str] = &[
    "tasks",
    "habits",
    "habit_logs",
    "ideas",
    "important_dates",
    "semesters",
    "subjects",
    "timetable_slots",
    "timetable_exceptions",
    "attendance",
    "people",
    "debts",
    "debt_payments",
];

/// Phase 1: lists, habits, ideas, important dates, timetable with
/// attendance, and debts. Dates are local `YYYY-MM-DD`, times are minutes
/// after midnight, money is in paise.
fn v2() -> String {
    let mut sql = format!(
        "
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  list         TEXT NOT NULL CHECK (list IN ('todo', 'watch', 'read')),
  title        TEXT NOT NULL,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  due_date     TEXT,
  due_time     TEXT,
  remind       INTEGER NOT NULL DEFAULT 0,
  recurrence   TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,
  tags         TEXT NOT NULL DEFAULT '[]',
  meta         TEXT NOT NULL DEFAULT '{{}}',
  completed_at INTEGER,
  sort_order   REAL NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;
CREATE INDEX tasks_list ON tasks (list, status, due_date);

CREATE TABLE habits (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'check' CHECK (kind IN ('check', 'count')),
  target        REAL NOT NULL DEFAULT 1,
  unit          TEXT,
  schedule      TEXT NOT NULL DEFAULT '{{\"type\":\"daily\"}}',
  reminder_time TEXT,
  start_date    TEXT NOT NULL,
  archived      INTEGER NOT NULL DEFAULT 0,
  sort_order    REAL NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;

CREATE TABLE habit_logs (
  id       TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits (id),
  date     TEXT NOT NULL,
  value    REAL NOT NULL DEFAULT 1,{BASE_COLUMNS}
) STRICT;
CREATE UNIQUE INDEX habit_logs_day ON habit_logs (habit_id, date);

CREATE TABLE ideas (
  id     TEXT PRIMARY KEY,
  body   TEXT NOT NULL,
  tags   TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  color  TEXT,{BASE_COLUMNS}
) STRICT;

CREATE TABLE important_dates (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'other',
  date           TEXT NOT NULL,
  recurrence     TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'monthly', 'yearly')),
  remind_offsets TEXT NOT NULL DEFAULT '[0, 1]',
  notes          TEXT,{BASE_COLUMNS}
) STRICT;

CREATE TABLE semesters (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  start_date       TEXT NOT NULL,
  end_date         TEXT NOT NULL,
  target           REAL NOT NULL DEFAULT 80,
  separate_labs    INTEGER NOT NULL DEFAULT 0,
  separate_tutorials INTEGER NOT NULL DEFAULT 0,
  unmarked_default TEXT NOT NULL DEFAULT 'unmarked' CHECK (unmarked_default IN ('present', 'unmarked')),
  reminder_minutes INTEGER NOT NULL DEFAULT 10,
  is_active        INTEGER NOT NULL DEFAULT 1,{BASE_COLUMNS}
) STRICT;

CREATE TABLE subjects (
  id          TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters (id),
  name        TEXT NOT NULL,
  code        TEXT,
  professor   TEXT,
  color       TEXT NOT NULL,
  target      REAL,{BASE_COLUMNS}
) STRICT;

CREATE TABLE timetable_slots (
  id          TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters (id),
  subject_id  TEXT NOT NULL REFERENCES subjects (id),
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min   INTEGER NOT NULL,
  end_min     INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'lecture' CHECK (kind IN ('lecture', 'lab', 'tutorial')),
  room        TEXT,
  week_parity TEXT NOT NULL DEFAULT 'all' CHECK (week_parity IN ('all', 'odd', 'even')),{BASE_COLUMNS}
) STRICT;

-- Changes to the weekly schedule: extra classes, cancelled classes,
-- single-day holidays and vacation ranges.
CREATE TABLE timetable_exceptions (
  id          TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters (id),
  kind        TEXT NOT NULL CHECK (kind IN ('extra', 'cancel', 'holiday', 'vacation')),
  date        TEXT NOT NULL,
  end_date    TEXT,
  slot_id     TEXT,
  subject_id  TEXT,
  class_kind  TEXT,
  start_min   INTEGER,
  end_min     INTEGER,
  room        TEXT,
  title       TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX timetable_exceptions_date ON timetable_exceptions (semester_id, date);

-- One row per marked class; `class_key` identifies the occurrence
-- (`date:slot_id` or `date:x:exception_id`).
CREATE TABLE attendance (
  id          TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters (id),
  subject_id  TEXT NOT NULL REFERENCES subjects (id),
  class_key   TEXT NOT NULL,
  date        TEXT NOT NULL,
  class_kind  TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),{BASE_COLUMNS}
) STRICT;
CREATE UNIQUE INDEX attendance_class ON attendance (class_key);

CREATE TABLE people (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  phone TEXT,
  notes TEXT,{BASE_COLUMNS}
) STRICT;

CREATE TABLE debts (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES people (id),
  direction    TEXT NOT NULL CHECK (direction IN ('owed_to_me', 'i_owe')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  occurred_on  TEXT NOT NULL,
  reason       TEXT,
  due_on       TEXT,
  notes        TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX debts_person ON debts (person_id);

-- Repayments against a person's running balance.
CREATE TABLE debt_payments (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES people (id),
  direction    TEXT NOT NULL CHECK (direction IN ('to_me', 'from_me')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  paid_on      TEXT NOT NULL,
  note         TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX debt_payments_person ON debt_payments (person_id);
"
    );
    for table in V2_SYNCED {
        sql.push_str(&sync_triggers(table));
    }
    sql
}

/// Default activity types, inserted once for a new database.
fn seed_activity_types(conn: &Connection) -> Result<()> {
    let types = [
        ("cp", "DSA / CP", "#3fa66b", "problems"),
        ("gym", "Gym", "#e8833a", "sessions"),
        ("sports", "Sports", "#3d8bd9", "minutes"),
        ("focus", "Focus", "#2fa5a0", "minutes"),
        ("habits", "Habits", "#8e6bd8", "percent"),
        ("reading", "Reading", "#d9a62e", "pages"),
        ("tasks", "Tasks", "#8a8f98", "tasks"),
        ("classes", "Classes", "#d9608f", "percent"),
    ];
    let now = chrono::Utc::now().timestamp_millis();
    let device: String = conn.query_row(
        "SELECT value FROM local_meta WHERE key = 'device_id'",
        [],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO activity_types
           (id, name, color, unit, sort_order, is_builtin, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7)",
    )?;
    for (i, (id, name, color, unit)) in types.iter().enumerate() {
        stmt.execute(rusqlite::params![
            id, name, color, unit, i as i64, now, device
        ])?;
    }
    Ok(())
}

pub const LATEST: i64 = 2;

pub fn current_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Applies pending migrations, each in its own transaction.
pub fn migrate(conn: &mut Connection) -> Result<()> {
    let mut version = current_version(conn)?;
    while version < LATEST {
        let next = version + 1;
        let tx = conn.transaction()?;
        match next {
            1 => {
                tx.execute_batch(&v1())?;
                tx.execute(
                    "INSERT INTO local_meta (key, value) VALUES ('device_id', ?1)",
                    [uuid::Uuid::now_v7().to_string()],
                )?;
                tx.execute(
                    "INSERT INTO local_meta (key, value) VALUES ('created_at', ?1)",
                    [chrono::Utc::now().timestamp_millis().to_string()],
                )?;
                seed_activity_types(&tx)?;
            }
            2 => tx.execute_batch(&v2())?,
            _ => unreachable!(),
        }
        tx.pragma_update(None, "user_version", next)?;
        tx.commit()?;
        tracing::info!(version = next, "applied migration");
        version = next;
    }
    Ok(())
}
