//! Versioned schema migrations, tracked with `PRAGMA user_version`.
//!
//! Every synced table has the shared columns `id`, `created_at`, `updated_at`,
//! `deleted_at` and `device_id`, plus triggers that record each change in
//! `sync_changes` for LAN sync (Phase 2). Keep `src/core/db/schema.ts` in step
//! with this file.

use rusqlite::Connection;

use crate::error::Result;

/// Tables whose changes are recorded in `sync_changes`.
pub const SYNCED_TABLES: &[&str] = &[
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
    for table in SYNCED_TABLES {
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

pub const LATEST: i64 = 1;

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
            _ => unreachable!(),
        }
        tx.pragma_update(None, "user_version", next)?;
        tx.commit()?;
        tracing::info!(version = next, "applied migration");
        version = next;
    }
    Ok(())
}
