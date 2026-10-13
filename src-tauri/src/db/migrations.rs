//! Versioned schema migrations, tracked with `PRAGMA user_version`.
//!
//! Every synced table has the shared columns `id`, `created_at`, `updated_at`,
//! `deleted_at` and `device_id`. From v3, triggers stamp every changed cell in
//! `sync_clock` (see `crate::sync`). A migration that adds a synced table or a
//! column to one must call [`install_clock_triggers`] for it. Keep
//! `src/core/db/schema.ts` in step with this file.

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

/// Every synced table, parents before children so rows referencing other
/// rows can be applied in order.
pub fn synced_tables() -> impl Iterator<Item = &'static str> {
    V1_SYNCED.iter().chain(V2_SYNCED).chain(V6_SYNCED).copied()
}

/// Synced tables that existed when v3/v4 ran; those migrations must not see
/// tables created later.
fn tables_until_v5() -> impl Iterator<Item = &'static str> {
    V1_SYNCED.iter().chain(V2_SYNCED).copied()
}

/// Columns of `table`, in declaration order.
pub fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM pragma_table_info(?1)")?;
    let cols = stmt
        .query_map([table], |r| r.get(0))?
        .collect::<std::result::Result<Vec<String>, _>>()?;
    Ok(cols)
}

/// (Re)creates the triggers that stamp each changed cell of `table` in
/// `sync_clock`. A cell's new timestamp is never below its previous one, so a
/// local edit always beats the value it replaces even if this device's clock
/// is behind. Nothing is stamped while remote changes are being applied
/// (`sync.applying` set in `local_meta`); hard deletes are not synced.
///
/// The stamp is an upsert rather than `INSERT OR REPLACE`: when the change
/// comes from an `INSERT ... ON CONFLICT DO UPDATE`, SQLite applies the outer
/// statement's conflict handling to the trigger and `OR REPLACE` is ignored.
pub fn install_clock_triggers(conn: &Connection, table: &str) -> Result<()> {
    let cols: Vec<String> = table_columns(conn, table)?
        .into_iter()
        .filter(|c| c != "id")
        .collect();
    let stamp = |col: &str, row: &str, condition: &str| {
        format!(
            "  INSERT INTO sync_clock (table_name, row_id, col, ts, device_id, seq)
  SELECT '{table}', {row}.id, '{col}',
    MAX({NOW_MS}, COALESCE((SELECT ts + 1 FROM sync_clock WHERE table_name = '{table}' AND row_id = {row}.id AND col = '{col}'), 0)),
    (SELECT value FROM local_meta WHERE key = 'device_id'),
    COALESCE((SELECT MAX(seq) FROM sync_clock), 0) + 1
  WHERE {condition}
  ON CONFLICT (table_name, row_id, col) DO UPDATE SET ts = excluded.ts, device_id = excluded.device_id, seq = excluded.seq;
"
        )
    };
    let not_applying = "NOT EXISTS (SELECT 1 FROM local_meta WHERE key = 'sync.applying')";
    let mut sql = format!(
        "DROP TRIGGER IF EXISTS {table}_clock_insert;
DROP TRIGGER IF EXISTS {table}_clock_update;
CREATE TRIGGER {table}_clock_insert AFTER INSERT ON {table} WHEN {not_applying} BEGIN
"
    );
    for col in &cols {
        sql.push_str(&stamp(col, "NEW", "true"));
    }
    sql.push_str(&format!(
        "END;
CREATE TRIGGER {table}_clock_update AFTER UPDATE ON {table} WHEN {not_applying} BEGIN
"
    ));
    for col in &cols {
        sql.push_str(&stamp(
            col,
            "NEW",
            &format!("OLD.\"{col}\" IS NOT NEW.\"{col}\""),
        ));
    }
    sql.push_str("END;\n");
    conn.execute_batch(&sql)?;
    Ok(())
}

/// Phase 2: per-cell clocks for sync (replacing the row-level
/// `sync_changes` log), plus device-local sync bookkeeping. Existing cells
/// are stamped with their row's `updated_at` so data entered before pairing
/// merges too.
fn v3(conn: &Connection) -> Result<()> {
    let mut drop = String::new();
    for table in tables_until_v5() {
        for op in ["insert", "update", "delete"] {
            drop.push_str(&format!("DROP TRIGGER IF EXISTS {table}_sync_{op};\n"));
        }
    }
    conn.execute_batch(&format!(
        "{drop}
DROP TABLE sync_changes;

-- Last-writer-wins clock for every synced cell. `seq` orders this device's
-- writes so it can send only what changed since the last sync.
CREATE TABLE sync_clock (
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  col        TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  device_id  TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (table_name, row_id, col)
) STRICT, WITHOUT ROWID;
CREATE INDEX sync_clock_seq ON sync_clock (seq);

-- Per source device: the highest of its `seq` values applied here.
CREATE TABLE sync_peers (
  device_id   TEXT PRIMARY KEY,
  applied_seq INTEGER NOT NULL DEFAULT 0,
  last_at     INTEGER
) STRICT;

-- Device-local history of sync runs.
CREATE TABLE sync_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  transport TEXT NOT NULL,
  sent      INTEGER NOT NULL DEFAULT 0,
  received  INTEGER NOT NULL DEFAULT 0,
  error     TEXT
) STRICT;
"
    ))?;
    let device: String = conn.query_row(
        "SELECT value FROM local_meta WHERE key = 'device_id'",
        [],
        |r| r.get(0),
    )?;
    let mut seq: i64 = 0;
    for table in tables_until_v5() {
        let cols = table_columns(conn, table)?;
        let mut rows = conn.prepare(&format!("SELECT id, updated_at FROM {table}"))?;
        let rows = rows
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut insert = conn.prepare(
            "INSERT INTO sync_clock (table_name, row_id, col, ts, device_id, seq) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for (id, updated_at) in rows {
            for col in cols.iter().filter(|c| *c != "id") {
                seq += 1;
                insert.execute(rusqlite::params![table, id, col, updated_at, device, seq])?;
            }
        }
        install_clock_triggers(conn, table)?;
    }
    Ok(())
}

/// Reinstalls the clock triggers with upserts (see [`install_clock_triggers`]);
/// v3's `INSERT OR REPLACE` failed inside upserts on synced tables.
fn v4(conn: &Connection) -> Result<()> {
    for table in tables_until_v5() {
        install_clock_triggers(conn, table)?;
    }
    Ok(())
}

/// Laptops publish the addresses phones can reach them at for direct sync.
fn v5(conn: &Connection) -> Result<()> {
    conn.execute_batch("ALTER TABLE devices ADD COLUMN addresses TEXT NOT NULL DEFAULT '[]';")?;
    install_clock_triggers(conn, "devices")
}

const V6_SYNCED: &[&str] = &["focus_sessions", "focus_unlocks"];

/// Phase 3: focus sessions (Forest-style) and the tree species bought with
/// focus coins. A session's `status` moves from running/paused to
/// completed, withered (left during strict mode) or given_up.
fn v6(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE focus_sessions (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes > 0),
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'paused', 'completed', 'withered', 'given_up')),
  paused_at       INTEGER,
  paused_ms       INTEGER NOT NULL DEFAULT 0,
  ended_at        INTEGER,
  focused_minutes REAL NOT NULL DEFAULT 0,
  tag             TEXT,
  task_id         TEXT,
  species         TEXT NOT NULL DEFAULT 'oak',
  strict          INTEGER NOT NULL DEFAULT 0,
  note            TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX focus_sessions_date ON focus_sessions (date);

-- One row per unlocked species; `id` is the species key.
CREATE TABLE focus_unlocks (
  id TEXT PRIMARY KEY,{BASE_COLUMNS}
) STRICT;
"
    ))?;
    for table in V6_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    Ok(())
}

pub const LATEST: i64 = 6;

pub fn current_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Applies pending migrations, each in its own transaction.
pub fn migrate(conn: &mut Connection) -> Result<()> {
    migrate_to(conn, LATEST)
}

pub(crate) fn migrate_to(conn: &mut Connection, target: i64) -> Result<()> {
    let mut version = current_version(conn)?;
    while version < target {
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
            3 => v3(&tx)?,
            4 => v4(&tx)?,
            5 => v5(&tx)?,
            6 => v6(&tx)?,
            _ => unreachable!(),
        }
        tx.pragma_update(None, "user_version", next)?;
        tx.commit()?;
        tracing::info!(version = next, "applied migration");
        version = next;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v3_stamps_existing_rows_and_keeps_tracking_changes() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate_to(&mut conn, 2).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, list, title, created_at, updated_at, device_id) VALUES ('t', 'todo', 'Old task', 5, 7, 'd')",
            [],
        )
        .unwrap();
        migrate_to(&mut conn, LATEST).unwrap();

        let (count, ts): (i64, i64) = conn
            .query_row("SELECT count(*), MIN(ts) FROM sync_clock WHERE table_name = 'tasks' AND row_id = 't'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(
            count,
            table_columns(&conn, "tasks").unwrap().len() as i64 - 1
        );
        assert_eq!(ts, 7);

        conn.execute("UPDATE tasks SET title = 'New' WHERE id = 't'", [])
            .unwrap();
        let title_ts: i64 = conn
            .query_row(
                "SELECT ts FROM sync_clock WHERE row_id = 't' AND col = 'title'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(title_ts > 7);
        let old: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name LIKE '%_sync_insert'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old, 0);
    }

    /// Upserts on synced tables (device registration, activity events) must
    /// stamp clocks without tripping the clock's primary key.
    #[test]
    fn upserts_on_synced_tables_update_clocks() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        for name in ["first", "second", "third"] {
            conn.execute(
                "INSERT INTO devices (id, name, platform, created_at, updated_at, device_id) VALUES ('d', ?1, 'macos', 1, 1, 'd')
                 ON CONFLICT (id) DO UPDATE SET name = excluded.name",
                [name],
            )
            .unwrap();
        }
        let name: String = conn
            .query_row("SELECT name FROM devices WHERE id = 'd'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "third");
        let stamps: i64 = conn
            .query_row(
                "SELECT count(*) FROM sync_clock WHERE row_id = 'd' AND col = 'name'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stamps, 1);
    }
}
