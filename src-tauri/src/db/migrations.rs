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
    V1_SYNCED
        .iter()
        .chain(V2_SYNCED)
        .chain(V6_SYNCED)
        .chain(V7_SYNCED)
        .chain(V8_SYNCED)
        .chain(V9_SYNCED)
        .chain(V10_SYNCED)
        .chain(V11_SYNCED)
        .chain(V12_SYNCED)
        .chain(V15_SYNCED)
        .chain(V16_SYNCED)
        .copied()
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

const V7_SYNCED: &[&str] = &["goals", "goal_links", "goal_entries"];

/// One module's rows in the search index. Each expression reads the row
/// through `R.`, which becomes `NEW.` in triggers and the table name when
/// backfilling.
struct SearchSource {
    table: &'static str,
    module: &'static str,
    title: &'static str,
    body: &'static str,
    tags: &'static str,
    date: &'static str,
    amount: &'static str,
    status: &'static str,
}

const LOCAL_DAY: &str = "date(R.created_at / 1000, 'unixepoch', 'localtime')";

fn search_sources() -> Vec<SearchSource> {
    let tags = "(SELECT group_concat(value, ' ') FROM json_each(R.tags))";
    let first_line = "CASE WHEN instr(R.body, char(10)) > 0 THEN substr(R.body, 1, instr(R.body, char(10)) - 1) ELSE R.body END";
    vec![
        SearchSource {
            table: "tasks",
            module: "R.list",
            title: "R.title",
            body: "concat_ws(' ', R.notes, json_extract(R.meta, '$.author'), json_extract(R.meta, '$.medium'))",
            tags,
            date: "coalesce(R.due_date, date(R.created_at / 1000, 'unixepoch', 'localtime'))",
            amount: "NULL",
            status: "R.status",
        },
        SearchSource {
            table: "ideas",
            module: "'ideas'",
            title: first_line,
            body: "R.body",
            tags,
            date: LOCAL_DAY,
            amount: "NULL",
            status: "CASE WHEN R.pinned THEN 'pinned' END",
        },
        SearchSource {
            table: "habits",
            module: "'habits'",
            title: "R.name",
            body: "R.unit",
            tags: "NULL",
            date: "R.start_date",
            amount: "NULL",
            status: "CASE WHEN R.archived THEN 'archived' ELSE 'active' END",
        },
        SearchSource {
            table: "important_dates",
            module: "'dates'",
            title: "R.title",
            body: "concat_ws(' ', R.kind, R.notes)",
            tags: "NULL",
            date: "R.date",
            amount: "NULL",
            status: "R.kind",
        },
        SearchSource {
            table: "subjects",
            module: "'subjects'",
            title: "R.name",
            body: "concat_ws(' ', R.code, R.professor)",
            tags: "NULL",
            date: "NULL",
            amount: "NULL",
            status: "NULL",
        },
        SearchSource {
            table: "people",
            module: "'people'",
            title: "R.name",
            body: "concat_ws(' ', R.phone, R.notes)",
            tags: "NULL",
            date: "NULL",
            amount: "NULL",
            status: "NULL",
        },
        SearchSource {
            table: "debts",
            module: "'debts'",
            title: "coalesce(nullif(R.reason, ''), 'Debt')",
            body: "concat_ws(' ', (SELECT name FROM people WHERE id = R.person_id), R.notes)",
            tags: "NULL",
            date: "R.occurred_on",
            amount: "R.amount_paise / 100.0",
            status: "R.direction",
        },
        SearchSource {
            table: "goals",
            module: "'goals'",
            title: "R.title",
            body: "R.notes",
            tags: "NULL",
            date: "R.target_date",
            amount: "NULL",
            status: "R.status",
        },
    ]
}

impl SearchSource {
    fn select(&self, row: &str) -> String {
        let r = |expr: &str| expr.replace("R.", &format!("{row}."));
        format!(
            "SELECT '{table}', {row}.id, {module}, {title}, coalesce({body}, ''), coalesce({tags}, ''), {date}, {amount}, {status}",
            table = self.table,
            module = r(self.module),
            title = r(self.title),
            body = r(self.body),
            tags = r(self.tags),
            date = r(self.date),
            amount = r(self.amount),
            status = r(self.status),
        )
    }
}

const SEARCH_COLUMNS: &str = "src, ref_id, module, title, body, tags, date, amount, status";

/// Keeps `search_index` in step with each indexed table, including rows
/// written by sync. Soft-deleted rows leave the index. Trigger names start
/// with `search_index` so the schema dump for the browser preview skips
/// them along with the FTS5 table.
fn install_search_triggers(conn: &Connection, s: &SearchSource) -> Result<()> {
    let t = s.table;
    let remove = format!("DELETE FROM search_index WHERE src = '{t}' AND ref_id = OLD.id;");
    let add = format!(
        "INSERT INTO search_index ({SEARCH_COLUMNS}) {} WHERE NEW.deleted_at IS NULL;",
        s.select("NEW")
    );
    conn.execute_batch(&format!(
        "
CREATE TRIGGER search_index_{t}_insert AFTER INSERT ON {t} BEGIN
  {add}
END;
CREATE TRIGGER search_index_{t}_update AFTER UPDATE ON {t} BEGIN
  {remove}
  {add}
END;
CREATE TRIGGER search_index_{t}_delete AFTER DELETE ON {t} BEGIN
  {remove}
END;
"
    ))?;
    conn.execute_batch(&format!(
        "INSERT INTO search_index ({SEARCH_COLUMNS}) {} FROM {t} WHERE {t}.deleted_at IS NULL;",
        s.select(t)
    ))?;
    Ok(())
}

/// Phase 3: goals, and the universal search index.
///
/// A goal's progress comes from its `kind`: `manual` from logged
/// `goal_entries` (e.g. a rating or a lift), `activity` from the total of an
/// activity type since `start_date`, `habits` from days its linked habits
/// were done, `tasks` from its linked tasks being completed.
///
/// `search_index` (empty until now) is rebuilt with filter columns and kept
/// filled by triggers.
fn v7(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE goals (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  notes         TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('manual', 'activity', 'habits', 'tasks')),
  unit          TEXT,
  start_value   REAL NOT NULL DEFAULT 0,
  target_value  REAL NOT NULL DEFAULT 1,
  start_date    TEXT NOT NULL,
  target_date   TEXT,
  activity_type TEXT,
  activity_tag  TEXT,
  color         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'archived')),
  completed_at  INTEGER,
  sort_order    REAL NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;

-- Habits or tasks a goal is made of.
CREATE TABLE goal_links (
  id      TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals (id),
  kind    TEXT NOT NULL CHECK (kind IN ('habit', 'task')),
  ref_id  TEXT NOT NULL,{BASE_COLUMNS}
) STRICT;
CREATE INDEX goal_links_goal ON goal_links (goal_id);

-- Logged values for manual goals.
CREATE TABLE goal_entries (
  id      TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals (id),
  date    TEXT NOT NULL,
  value   REAL NOT NULL,
  note    TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX goal_entries_goal ON goal_entries (goal_id, date);

DROP TABLE search_index;
CREATE VIRTUAL TABLE search_index USING fts5 (
  src UNINDEXED,
  ref_id UNINDEXED,
  module UNINDEXED,
  title,
  body,
  tags,
  date UNINDEXED,
  amount UNINDEXED,
  status UNINDEXED,
  tokenize = 'trigram'
);
"
    ))?;
    for table in V7_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    for source in search_sources() {
        install_search_triggers(conn, &source)?;
    }
    Ok(())
}

const V8_SYNCED: &[&str] = &["cp_accounts", "cp_problems", "cp_revisit"];

/// Phase 4: competitive programming.
///
/// `cp_accounts` holds one row per platform (`id` is the platform), so the
/// handle set on one device reaches the other. `cp_problems` keeps one row per
/// problem rather than every submission: attempts, first solve and the
/// user's notes, with ids derived from the platform's problem id so both
/// devices fetching the same history agree. `cursor` is the time of the
/// newest submission already counted. Rating history and upcoming contests
/// are caches each device fetches for itself, so they are not synced.
///
/// Manual goals can follow a platform's rating (`goals.metric`).
fn v8(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE cp_accounts (
  id         TEXT PRIMARY KEY CHECK (id IN ('codeforces', 'leetcode', 'atcoder', 'codechef')),
  handle     TEXT NOT NULL,
  rating     REAL,
  max_rating REAL,
  rank_title TEXT,
  solved     INTEGER NOT NULL DEFAULT 0,
  contests   INTEGER NOT NULL DEFAULT 0,
  meta       TEXT NOT NULL DEFAULT '{{}}',
  cursor     INTEGER NOT NULL DEFAULT 0,
  synced_at  INTEGER,
  error      TEXT,{BASE_COLUMNS}
) STRICT;

CREATE TABLE cp_problems (
  id            TEXT PRIMARY KEY,
  platform      TEXT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  url           TEXT,
  rating        REAL,
  difficulty    TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  contest_id    TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  first_at      INTEGER,
  last_at       INTEGER,
  solved_at     INTEGER,
  notes         TEXT,
  minutes       INTEGER,
  solution_url  TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX cp_problems_solved ON cp_problems (solved_at);

-- Spaced repetition; `id` is the problem id.
CREATE TABLE cp_revisit (
  id         TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL,
  stage      INTEGER NOT NULL DEFAULT 0,
  due_date   TEXT NOT NULL,
  reviewed_at INTEGER,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),{BASE_COLUMNS}
) STRICT;

-- Device-local caches.
CREATE TABLE cp_ratings (
  id       TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  contest  TEXT NOT NULL,
  at       INTEGER NOT NULL,
  rating   REAL NOT NULL,
  rank     INTEGER
) STRICT;
CREATE INDEX cp_ratings_platform ON cp_ratings (platform, at);

CREATE TABLE cp_contests (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  start_at     INTEGER NOT NULL,
  duration_min INTEGER NOT NULL
) STRICT;
CREATE INDEX cp_contests_start ON cp_contests (start_at);

ALTER TABLE goals ADD COLUMN metric TEXT;
"
    ))?;
    for table in V8_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    install_clock_triggers(conn, "goals")?;
    install_search_triggers(
        conn,
        &SearchSource {
            table: "cp_problems",
            module: "'problems'",
            title: "R.name",
            body: "concat_ws(' ', R.platform, R.code, R.difficulty, R.notes)",
            tags: "(SELECT group_concat(value, ' ') FROM json_each(R.tags))",
            date: "date(coalesce(R.solved_at, R.last_at, R.created_at) / 1000, 'unixepoch', 'localtime')",
            amount: "R.rating",
            status: "CASE WHEN R.solved_at IS NOT NULL THEN 'solved' ELSE 'attempted' END",
        },
    )
}

const V9_SYNCED: &[&str] = &["gh_account"];

/// GitHub, shown on the Practice page and the heatmap.
///
/// `gh_account` is synced so the username set on one device reaches the
/// other. Contributions are stored as `github` activity events (one per day,
/// `ae:github:{date}`), so the heatmap and streaks need nothing new. The
/// recent repositories and issues are caches each device fetches itself.
fn v9(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE gh_account (
  id            TEXT PRIMARY KEY CHECK (id = 'github'),
  handle        TEXT NOT NULL,
  contributions INTEGER NOT NULL DEFAULT 0,
  meta          TEXT NOT NULL DEFAULT '{{}}',
  synced_at     INTEGER,
  error         TEXT,{BASE_COLUMNS}
) STRICT;

-- Device-local caches.
CREATE TABLE gh_repos (
  id             TEXT PRIMARY KEY,
  url            TEXT NOT NULL,
  description    TEXT,
  language       TEXT,
  stars          INTEGER NOT NULL DEFAULT 0,
  fork           INTEGER NOT NULL DEFAULT 0,
  pushed_at      INTEGER NOT NULL,
  head_sha       TEXT,
  commit_message TEXT,
  commit_url     TEXT,
  sort           INTEGER NOT NULL
) STRICT;

CREATE TABLE gh_issues (
  id         TEXT PRIMARY KEY,
  repo       TEXT NOT NULL,
  number     INTEGER NOT NULL,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  state      TEXT NOT NULL,
  author     TEXT NOT NULL,
  role       TEXT NOT NULL,
  labels     TEXT NOT NULL DEFAULT '[]',
  comments   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at  INTEGER
) STRICT;
"
    ))?;
    for table in V9_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    // Both devices add the same row, so the id is fixed.
    let device: String = conn.query_row(
        "SELECT value FROM local_meta WHERE key = 'device_id'",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO activity_types
           (id, name, color, unit, sort_order, is_builtin, created_at, updated_at, device_id)
         VALUES ('github', 'GitHub', '#5a6ad0', 'contributions',
                 (SELECT coalesce(max(sort_order), 0) + 1 FROM activity_types), 1, ?1, ?1, ?2)",
        rusqlite::params![chrono::Utc::now().timestamp_millis(), device],
    )?;
    Ok(())
}

const V10_SYNCED: &[&str] = &["sport_sessions", "sport_follows"];

/// Phase 5, sports: my own sessions, and teams and players I follow.
///
/// Sessions write `sports` activity events (minutes). Follows are synced,
/// ids are `{sport}:{kind}:{source id}` so both devices agree; followed
/// players are the favourites showcase (five at most, in `sort` order).
/// Games, player stats and the cricket search index are device caches.
fn v10(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE sport_sessions (
  id        TEXT PRIMARY KEY,
  sport     TEXT NOT NULL,
  date      TEXT NOT NULL,
  minutes   INTEGER NOT NULL,
  intensity INTEGER,
  notes     TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX sport_sessions_date ON sport_sessions (date);

CREATE TABLE sport_follows (
  id       TEXT PRIMARY KEY,
  sport    TEXT NOT NULL CHECK (sport IN ('nba', 'football', 'cricket')),
  kind     TEXT NOT NULL CHECK (kind IN ('team', 'player')),
  ref      TEXT NOT NULL,
  name     TEXT NOT NULL,
  subtitle TEXT,
  league   TEXT,
  image    TEXT,
  sort     INTEGER NOT NULL DEFAULT 0,
  error    TEXT,{BASE_COLUMNS}
) STRICT;

-- Device-local caches.
CREATE TABLE sport_games (
  id         TEXT PRIMARY KEY,
  follow_id  TEXT NOT NULL,
  sport      TEXT NOT NULL,
  start_at   INTEGER NOT NULL,
  league     TEXT,
  title      TEXT,
  home       TEXT NOT NULL,
  home_short TEXT NOT NULL,
  home_logo  TEXT,
  home_score TEXT,
  away       TEXT NOT NULL,
  away_short TEXT NOT NULL,
  away_logo  TEXT,
  away_score TEXT,
  state      TEXT NOT NULL,
  status     TEXT NOT NULL,
  url        TEXT
) STRICT;
CREATE INDEX sport_games_start ON sport_games (start_at);

CREATE TABLE sport_stats (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sport_index (
  id         TEXT PRIMARY KEY,
  sport      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL,
  name       TEXT NOT NULL,
  subtitle   TEXT,
  league     TEXT,
  image      TEXT,
  fetched_at INTEGER NOT NULL
) STRICT;
"
    ))?;
    for table in V10_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    install_search_triggers(
        conn,
        &SearchSource {
            table: "sport_sessions",
            module: "'sports'",
            title: "R.sport",
            body: "R.notes",
            tags: "''",
            date: "R.date",
            amount: "R.minutes",
            status: "NULL",
        },
    )?;
    install_search_triggers(
        conn,
        &SearchSource {
            table: "sport_follows",
            module: "'sports'",
            title: "R.name",
            body: "concat_ws(' ', R.sport, R.kind, R.subtitle)",
            tags: "''",
            date: "NULL",
            amount: "NULL",
            status: "R.kind",
        },
    )
}

const V11_SYNCED: &[&str] = &[
    "exercises",
    "workout_templates",
    "workouts",
    "workout_sets",
    "body_metrics",
];

/// The built-in exercise library: (slug, name, muscle, equipment, measure).
/// Ids are `ex:{slug}` on every device, so they never need syncing.
const EXERCISES: &[(&str, &str, &str, &str, &str)] = &[
    ("bench-press", "Bench Press", "chest", "barbell", "weight"),
    (
        "incline-bench-press",
        "Incline Bench Press",
        "chest",
        "barbell",
        "weight",
    ),
    (
        "decline-bench-press",
        "Decline Bench Press",
        "chest",
        "barbell",
        "weight",
    ),
    (
        "dumbbell-bench-press",
        "Dumbbell Bench Press",
        "chest",
        "dumbbell",
        "weight",
    ),
    (
        "incline-dumbbell-press",
        "Incline Dumbbell Press",
        "chest",
        "dumbbell",
        "weight",
    ),
    (
        "dumbbell-fly",
        "Dumbbell Fly",
        "chest",
        "dumbbell",
        "weight",
    ),
    (
        "cable-crossover",
        "Cable Crossover",
        "chest",
        "cable",
        "weight",
    ),
    ("pec-deck", "Pec Deck", "chest", "machine", "weight"),
    (
        "chest-press-machine",
        "Chest Press (Machine)",
        "chest",
        "machine",
        "weight",
    ),
    ("push-up", "Push-up", "chest", "bodyweight", "reps"),
    ("dips", "Dips", "chest", "bodyweight", "reps"),
    ("deadlift", "Deadlift", "back", "barbell", "weight"),
    ("barbell-row", "Barbell Row", "back", "barbell", "weight"),
    ("pendlay-row", "Pendlay Row", "back", "barbell", "weight"),
    ("t-bar-row", "T-Bar Row", "back", "barbell", "weight"),
    ("dumbbell-row", "Dumbbell Row", "back", "dumbbell", "weight"),
    (
        "seated-cable-row",
        "Seated Cable Row",
        "back",
        "cable",
        "weight",
    ),
    ("lat-pulldown", "Lat Pulldown", "back", "cable", "weight"),
    ("pull-up", "Pull-up", "back", "bodyweight", "reps"),
    ("chin-up", "Chin-up", "back", "bodyweight", "reps"),
    (
        "straight-arm-pulldown",
        "Straight-arm Pulldown",
        "back",
        "cable",
        "weight",
    ),
    (
        "back-extension",
        "Back Extension",
        "back",
        "bodyweight",
        "reps",
    ),
    ("shrug", "Shrug", "back", "dumbbell", "weight"),
    (
        "overhead-press",
        "Overhead Press",
        "shoulders",
        "barbell",
        "weight",
    ),
    (
        "dumbbell-shoulder-press",
        "Dumbbell Shoulder Press",
        "shoulders",
        "dumbbell",
        "weight",
    ),
    (
        "arnold-press",
        "Arnold Press",
        "shoulders",
        "dumbbell",
        "weight",
    ),
    (
        "lateral-raise",
        "Lateral Raise",
        "shoulders",
        "dumbbell",
        "weight",
    ),
    (
        "cable-lateral-raise",
        "Cable Lateral Raise",
        "shoulders",
        "cable",
        "weight",
    ),
    (
        "front-raise",
        "Front Raise",
        "shoulders",
        "dumbbell",
        "weight",
    ),
    (
        "rear-delt-fly",
        "Rear Delt Fly",
        "shoulders",
        "dumbbell",
        "weight",
    ),
    ("face-pull", "Face Pull", "shoulders", "cable", "weight"),
    (
        "upright-row",
        "Upright Row",
        "shoulders",
        "barbell",
        "weight",
    ),
    (
        "barbell-curl",
        "Barbell Curl",
        "biceps",
        "barbell",
        "weight",
    ),
    (
        "dumbbell-curl",
        "Dumbbell Curl",
        "biceps",
        "dumbbell",
        "weight",
    ),
    ("hammer-curl", "Hammer Curl", "biceps", "dumbbell", "weight"),
    (
        "preacher-curl",
        "Preacher Curl",
        "biceps",
        "barbell",
        "weight",
    ),
    (
        "incline-dumbbell-curl",
        "Incline Dumbbell Curl",
        "biceps",
        "dumbbell",
        "weight",
    ),
    ("cable-curl", "Cable Curl", "biceps", "cable", "weight"),
    (
        "triceps-pushdown",
        "Triceps Pushdown",
        "triceps",
        "cable",
        "weight",
    ),
    (
        "overhead-triceps-extension",
        "Overhead Triceps Extension",
        "triceps",
        "cable",
        "weight",
    ),
    (
        "skull-crusher",
        "Skull Crusher",
        "triceps",
        "barbell",
        "weight",
    ),
    (
        "close-grip-bench-press",
        "Close-grip Bench Press",
        "triceps",
        "barbell",
        "weight",
    ),
    (
        "triceps-kickback",
        "Triceps Kickback",
        "triceps",
        "dumbbell",
        "weight",
    ),
    ("wrist-curl", "Wrist Curl", "forearms", "dumbbell", "weight"),
    (
        "farmers-walk",
        "Farmer's Walk",
        "forearms",
        "dumbbell",
        "weight",
    ),
    ("squat", "Squat", "quads", "barbell", "weight"),
    ("front-squat", "Front Squat", "quads", "barbell", "weight"),
    ("leg-press", "Leg Press", "quads", "machine", "weight"),
    ("hack-squat", "Hack Squat", "quads", "machine", "weight"),
    (
        "leg-extension",
        "Leg Extension",
        "quads",
        "machine",
        "weight",
    ),
    (
        "bulgarian-split-squat",
        "Bulgarian Split Squat",
        "quads",
        "dumbbell",
        "weight",
    ),
    ("lunge", "Lunge", "quads", "dumbbell", "weight"),
    (
        "goblet-squat",
        "Goblet Squat",
        "quads",
        "dumbbell",
        "weight",
    ),
    (
        "romanian-deadlift",
        "Romanian Deadlift",
        "hamstrings",
        "barbell",
        "weight",
    ),
    (
        "lying-leg-curl",
        "Lying Leg Curl",
        "hamstrings",
        "machine",
        "weight",
    ),
    (
        "seated-leg-curl",
        "Seated Leg Curl",
        "hamstrings",
        "machine",
        "weight",
    ),
    (
        "good-morning",
        "Good Morning",
        "hamstrings",
        "barbell",
        "weight",
    ),
    ("hip-thrust", "Hip Thrust", "glutes", "barbell", "weight"),
    (
        "glute-bridge",
        "Glute Bridge",
        "glutes",
        "bodyweight",
        "reps",
    ),
    (
        "cable-kickback",
        "Cable Kickback",
        "glutes",
        "cable",
        "weight",
    ),
    (
        "hip-abduction",
        "Hip Abduction",
        "glutes",
        "machine",
        "weight",
    ),
    (
        "standing-calf-raise",
        "Standing Calf Raise",
        "calves",
        "machine",
        "weight",
    ),
    (
        "seated-calf-raise",
        "Seated Calf Raise",
        "calves",
        "machine",
        "weight",
    ),
    ("crunch", "Crunch", "abs", "bodyweight", "reps"),
    (
        "hanging-leg-raise",
        "Hanging Leg Raise",
        "abs",
        "bodyweight",
        "reps",
    ),
    ("cable-crunch", "Cable Crunch", "abs", "cable", "weight"),
    ("plank", "Plank", "abs", "bodyweight", "time"),
    (
        "russian-twist",
        "Russian Twist",
        "abs",
        "bodyweight",
        "reps",
    ),
    (
        "ab-wheel-rollout",
        "Ab Wheel Rollout",
        "abs",
        "other",
        "reps",
    ),
    (
        "clean-and-press",
        "Clean and Press",
        "full_body",
        "barbell",
        "weight",
    ),
    (
        "power-clean",
        "Power Clean",
        "full_body",
        "barbell",
        "weight",
    ),
    (
        "kettlebell-swing",
        "Kettlebell Swing",
        "full_body",
        "kettlebell",
        "weight",
    ),
    ("burpee", "Burpee", "full_body", "bodyweight", "reps"),
    ("running", "Running", "cardio", "other", "cardio"),
    ("treadmill", "Treadmill", "cardio", "machine", "cardio"),
    ("cycling", "Cycling", "cardio", "machine", "cardio"),
    (
        "rowing-machine",
        "Rowing Machine",
        "cardio",
        "machine",
        "cardio",
    ),
    ("elliptical", "Elliptical", "cardio", "machine", "cardio"),
    (
        "stair-climber",
        "Stair Climber",
        "cardio",
        "machine",
        "cardio",
    ),
    ("jump-rope", "Jump Rope", "cardio", "other", "time"),
];

/// Phase 5, gym: an exercise library (built in and my own), routines,
/// workouts with their sets, and body metrics.
///
/// Weights are kilograms, distances kilometres, times seconds. An exercise's
/// `measure` says what its sets record: `weight` (weight and reps), `reps`
/// (bodyweight reps, optionally with added weight), `time`, or `cardio`
/// (time and distance). A workout is in progress while `ended_at` is NULL.
/// A routine's exercises are JSON: `[{"exerciseId", "sets", "reps"}]`.
/// Body metrics are one row per day (`bm:{date}`), so both devices merge
/// a day's entries; progress photos are `attachments` of that row, stored
/// encrypted on the device that took them.
fn v11(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE exercises (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  muscle     TEXT NOT NULL,
  equipment  TEXT NOT NULL DEFAULT 'other',
  measure    TEXT NOT NULL DEFAULT 'weight' CHECK (measure IN ('weight', 'reps', 'time', 'cardio')),
  notes      TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;

CREATE TABLE workout_templates (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  notes     TEXT,
  exercises TEXT NOT NULL DEFAULT '[]',
  sort      INTEGER NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;

CREATE TABLE workouts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  template_id TEXT,
  date        TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  notes       TEXT,
  volume      REAL NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;
CREATE INDEX workouts_date ON workouts (date);

CREATE TABLE workout_sets (
  id          TEXT PRIMARY KEY,
  workout_id  TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  -- The exercise's place in the workout, then the set's place in it.
  position    INTEGER NOT NULL,
  set_index   INTEGER NOT NULL,
  warmup      INTEGER NOT NULL DEFAULT 0,
  weight      REAL,
  reps        INTEGER,
  seconds     INTEGER,
  distance    REAL,
  rpe         REAL,
  done        INTEGER NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;
CREATE INDEX workout_sets_workout ON workout_sets (workout_id, position, set_index);
CREATE INDEX workout_sets_exercise ON workout_sets (exercise_id);

CREATE TABLE body_metrics (
  id        TEXT PRIMARY KEY,
  date      TEXT NOT NULL,
  weight    REAL,
  body_fat  REAL,
  waist     REAL,
  chest     REAL,
  arms      REAL,
  thighs    REAL,
  hips      REAL,
  neck      REAL,
  notes     TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX body_metrics_date ON body_metrics (date);
"
    ))?;
    // The library goes in before the clock triggers, so it is never sent.
    let device: String = conn.query_row(
        "SELECT value FROM local_meta WHERE key = 'device_id'",
        [],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO exercises
           (id, name, muscle, equipment, measure, is_builtin, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, 0, 0, ?6)",
    )?;
    for (slug, name, muscle, equipment, measure) in EXERCISES {
        stmt.execute(rusqlite::params![
            format!("ex:{slug}"),
            name,
            muscle,
            equipment,
            measure,
            device
        ])?;
    }
    for table in V11_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    install_search_triggers(
        conn,
        &SearchSource {
            table: "workouts",
            module: "'fitness'",
            title: "R.name",
            body: "concat_ws(' ', R.notes, (SELECT group_concat(DISTINCT e.name) FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id WHERE s.workout_id = R.id AND s.deleted_at IS NULL))",
            tags: "''",
            date: "R.date",
            amount: "R.volume",
            status: "CASE WHEN R.ended_at IS NULL THEN 'open' ELSE 'done' END",
        },
    )?;
    install_search_triggers(
        conn,
        &SearchSource {
            table: "exercises",
            module: "'fitness'",
            title: "R.name",
            body: "concat_ws(' ', replace(R.muscle, '_', ' '), R.equipment, R.notes)",
            tags: "''",
            date: "NULL",
            amount: "NULL",
            status: "NULL",
        },
    )?;
    install_search_triggers(
        conn,
        &SearchSource {
            table: "workout_templates",
            module: "'fitness'",
            title: "R.name",
            body: "R.notes",
            tags: "''",
            date: "NULL",
            amount: "NULL",
            status: "NULL",
        },
    )
}

const V12_SYNCED: &[&str] = &["sport_mutes"];

/// Phase 5: muted games and follows (synced), and which results and
/// performances this device has already announced (device-local).
///
/// A mute id is `game:{sport}:{game id}` (that game's reminder and result)
/// or `follow:{follow id}` (everything about a team or player).
fn v12(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE sport_mutes (
  id    TEXT PRIMARY KEY,
  title TEXT,{BASE_COLUMNS}
) STRICT;

CREATE TABLE sport_alerts (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
) STRICT;
"
    ))?;
    for table in V12_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    Ok(())
}

/// Practice keeps only its 30 most recent problems (solves stay on the
/// heatmap, totals come from the sites), and the revisit queue is gone.
/// `crate::practice::prune_problems` keeps it that way after each fetch.
fn v13(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "DELETE FROM cp_problems WHERE id NOT IN (
           SELECT id FROM cp_problems WHERE deleted_at IS NULL
           ORDER BY coalesce(solved_at, last_at, first_at, 0) DESC LIMIT 30);
         DELETE FROM sync_clock WHERE table_name = 'cp_problems' AND row_id NOT IN (SELECT id FROM cp_problems);
         DELETE FROM cp_revisit;
         DELETE FROM sync_clock WHERE table_name = 'cp_revisit';",
    )?;
    Ok(())
}

/// Gym: sets of finished workouts all count. Ticking matters only while a
/// workout is live (unticked sets are dropped when it is finished), but
/// past workouts logged by hand could keep unticked sets that then counted
/// for nothing; they are ticked and their volume recomputed.
fn v14(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "UPDATE workout_sets SET done = 1
         WHERE done = 0 AND deleted_at IS NULL
           AND workout_id IN (SELECT id FROM workouts WHERE ended_at IS NOT NULL);
         UPDATE workouts SET volume = (
           SELECT coalesce(sum(coalesce(s.weight, 0) * coalesce(s.reps, 0)), 0) FROM workout_sets s
           WHERE s.workout_id = workouts.id AND s.done = 1 AND s.warmup = 0 AND s.deleted_at IS NULL)
         WHERE ended_at IS NOT NULL;",
    )?;
    Ok(())
}

const V15_SYNCED: &[&str] = &["boards", "board_files"];

/// Phase 6: whiteboards (Excalidraw).
///
/// A board keeps its scene as JSON: `elements` (Excalidraw elements,
/// deleted ones included for a while so two devices' edits merge by element
/// version) and `app_state` (background colour and grid). `preview` is a
/// small PNG for the board list. `idea_id` links a board made from an idea.
/// Images placed on a board are `board_files` rows (the Excalidraw file id
/// and its data URL), written once and never changed.
fn v15(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE boards (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  elements  TEXT NOT NULL DEFAULT '[]',
  app_state TEXT NOT NULL DEFAULT '{{}}',
  preview   TEXT,
  idea_id   TEXT,
  pinned    INTEGER NOT NULL DEFAULT 0,{BASE_COLUMNS}
) STRICT;
CREATE INDEX boards_idea ON boards (idea_id);

CREATE TABLE board_files (
  id       TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  mime     TEXT NOT NULL,
  data     TEXT NOT NULL,{BASE_COLUMNS}
) STRICT;
CREATE INDEX board_files_board ON board_files (board_id);
"
    ))?;
    for table in V15_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    install_search_triggers(
        conn,
        &SearchSource {
            table: "boards",
            module: "'canvas'",
            title: "R.title",
            body: "(SELECT group_concat(json_extract(e.value, '$.text'), ' ') FROM json_each(R.elements) e WHERE json_extract(e.value, '$.type') = 'text' AND NOT coalesce(json_extract(e.value, '$.isDeleted'), 0))",
            tags: "''",
            date: LOCAL_DAY,
            amount: "NULL",
            status: "CASE WHEN R.pinned THEN 'pinned' END",
        },
    )?;
    Ok(())
}

const V16_SYNCED: &[&str] = &["music_plays"];

/// Phase 7: music. `music_plays` is the listening history read from
/// Spotify's recently played (which only goes back 50 tracks), so it grows
/// richer than Spotify's own; ids are `{played_at ms}:{track id}`, so both
/// devices store the same play under the same id. `lyrics` caches LRCLIB
/// answers on this device, "none found" included.
fn v16(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "
CREATE TABLE music_plays (
  id          TEXT PRIMARY KEY,
  played_at   INTEGER NOT NULL,
  track_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  artists     TEXT NOT NULL DEFAULT '[]',
  artist_ids  TEXT NOT NULL DEFAULT '[]',
  album       TEXT NOT NULL DEFAULT '',
  album_id    TEXT NOT NULL DEFAULT '',
  image       TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  context     TEXT,{BASE_COLUMNS}
) STRICT;
CREATE INDEX music_plays_at ON music_plays (played_at);

CREATE TABLE lyrics (
  key          TEXT PRIMARY KEY,
  synced       TEXT,
  plain        TEXT,
  instrumental INTEGER NOT NULL DEFAULT 0,
  at           INTEGER NOT NULL
) STRICT;
"
    ))?;
    for table in V16_SYNCED {
        install_clock_triggers(conn, table)?;
    }
    Ok(())
}

/// Goals are short or long term, and a goal can simply be done or not
/// (`metric = 'check'` on a manual goal; the kind check cannot be widened
/// without rebuilding the table).
fn v17(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "ALTER TABLE goals ADD COLUMN horizon TEXT NOT NULL DEFAULT 'long' CHECK (horizon IN ('short', 'long'));",
    )?;
    install_clock_triggers(conn, "goals")?;
    Ok(())
}

pub const LATEST: i64 = 17;

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
            7 => v7(&tx)?,
            8 => v8(&tx)?,
            9 => v9(&tx)?,
            10 => v10(&tx)?,
            11 => v11(&tx)?,
            12 => v12(&tx)?,
            13 => v13(&tx)?,
            14 => v14(&tx)?,
            15 => v15(&tx)?,
            16 => v16(&tx)?,
            17 => v17(&tx)?,
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

    #[test]
    fn search_index_follows_rows() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        let find = |conn: &Connection, q: &str| -> Vec<(String, String, String)> {
            conn.prepare("SELECT module, title, tags FROM search_index WHERE search_index MATCH ?1")
                .unwrap()
                .query_map([q], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        conn.execute_batch(
            "INSERT INTO tasks (id, list, title, notes, tags, created_at, updated_at, device_id)
               VALUES ('t1', 'read', 'Dune', 'by Frank Herbert', '[\"scifi\",\"novel\"]', 1, 1, 'd');
             INSERT INTO people (id, name, created_at, updated_at, device_id) VALUES ('p1', 'Rahul', 1, 1, 'd');
             INSERT INTO debts (id, person_id, direction, amount_paise, occurred_on, reason, created_at, updated_at, device_id)
               VALUES ('d1', 'p1', 'owed_to_me', 45000, '2026-10-01', 'Swiggy dinner', 1, 1, 'd');",
        )
        .unwrap();
        assert_eq!(
            find(&conn, "herbert"),
            vec![("read".into(), "Dune".into(), "scifi novel".into())]
        );
        let amount: f64 = conn
            .query_row(
                "SELECT amount FROM search_index WHERE ref_id = 'd1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(amount, 450.0);
        assert_eq!(find(&conn, "rahul").len(), 2);

        conn.execute(
            "UPDATE tasks SET title = 'Dune Messiah' WHERE id = 't1'",
            [],
        )
        .unwrap();
        assert_eq!(find(&conn, "messiah").len(), 1);
        assert_eq!(find(&conn, "dune").len(), 1);
        conn.execute("UPDATE tasks SET deleted_at = 2 WHERE id = 't1'", [])
            .unwrap();
        assert!(find(&conn, "dune").is_empty());
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

    /// Boards are found by their title and the text written on them, not by
    /// text that was deleted; their cells are clocked for sync.
    #[test]
    fn boards_are_searchable_and_synced() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO local_meta (key, value) VALUES ('device_id', 'd') ON CONFLICT DO NOTHING",
            [],
        )
        .unwrap();
        let elements = r#"[{"id":"a","type":"text","text":"login flow"},{"id":"b","type":"rectangle"},{"id":"c","type":"text","text":"gone","isDeleted":true}]"#;
        conn.execute(
            "INSERT INTO boards (id, title, elements, created_at, updated_at, device_id) VALUES ('b1', 'App sketch', ?1, 1, 1, 'd')",
            [elements],
        )
        .unwrap();
        let (module, title, body): (String, String, String) = conn
            .query_row(
                "SELECT module, title, body FROM search_index WHERE ref_id = 'b1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (module.as_str(), title.as_str(), body.as_str()),
            ("canvas", "App sketch", "login flow")
        );
        let clocked: i64 = conn
            .query_row(
                "SELECT count(*) FROM sync_clock WHERE table_name = 'boards' AND row_id = 'b1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(clocked >= 3);
    }
}
