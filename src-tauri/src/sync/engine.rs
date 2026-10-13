//! Exporting and merging changes.
//!
//! Every synced cell has a clock in `sync_clock`: a timestamp and the device
//! that wrote it. Merging keeps, per cell, the value with the greater
//! `(ts, device_id)`, so devices converge whatever order changes arrive in.
//! A device only sends cells it wrote itself, in batches covering a range of
//! its local `seq` numbers; receivers remember the highest `seq` applied per
//! device and apply the next batch only if it continues from there.

use std::collections::{BTreeMap, HashMap};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::db::migrations::{synced_tables, table_columns};
use crate::db::{json_to_sql, sql_to_json};
use crate::error::{Error, Result};

/// A cell's value with its timestamp; the writer is the batch's `from`.
pub type Cell = (JsonValue, i64);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RowChange {
    #[serde(rename = "t")]
    pub table: String,
    pub id: String,
    #[serde(rename = "c")]
    pub cells: BTreeMap<String, Cell>,
}

/// One device's own changes for `seq` in `from_seq..=to_seq`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Changes {
    pub from: String,
    pub from_seq: i64,
    pub to_seq: i64,
    pub rows: Vec<RowChange>,
}

/// Rows whose identity is a natural key: two devices may create the same
/// logical row with different ids, which are then merged into one.
const NATURAL_KEYS: &[(&str, &[&str])] = &[
    ("habit_logs", &["habit_id", "date"]),
    ("attendance", &["class_key"]),
];

fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub fn device_id(conn: &Connection) -> Result<String> {
    Ok(conn.query_row(
        "SELECT value FROM local_meta WHERE key = 'device_id'",
        [],
        |r| r.get(0),
    )?)
}

pub fn max_seq(conn: &Connection) -> Result<i64> {
    Ok(
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM sync_clock", [], |r| {
            r.get(0)
        })?,
    )
}

/// This device's changes after `after_seq`, or `None` if it wrote nothing
/// since. The batch covers every `seq` up to now, so the next one starts
/// right after it.
pub fn export(conn: &Connection, after_seq: i64) -> Result<Option<Changes>> {
    let me = device_id(conn)?;
    let to_seq = max_seq(conn)?;
    if to_seq <= after_seq {
        return Ok(None);
    }
    let mut stmt = conn.prepare(
        "SELECT table_name, row_id, col, ts FROM sync_clock
         WHERE seq > ?1 AND seq <= ?2 AND device_id = ?3
         ORDER BY table_name, row_id",
    )?;
    let mut grouped: BTreeMap<(String, String), BTreeMap<String, i64>> = BTreeMap::new();
    for row in stmt.query_map(params![after_seq, to_seq, me], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })? {
        let (table, id, col, ts) = row?;
        grouped.entry((table, id)).or_default().insert(col, ts);
    }
    if grouped.is_empty() {
        return Ok(None);
    }

    let order: HashMap<&str, usize> = synced_tables().enumerate().map(|(i, t)| (t, i)).collect();
    let mut rows = Vec::new();
    for ((table, id), clocks) in grouped {
        if !order.contains_key(table.as_str()) {
            continue;
        }
        let cols: Vec<&String> = clocks.keys().collect();
        let select = cols.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", ");
        let values: Option<Vec<JsonValue>> = conn
            .query_row(
                &format!("SELECT {select} FROM {} WHERE id = ?1", quote(&table)),
                [&id],
                |r| {
                    (0..cols.len())
                        .map(|i| r.get_ref(i).map(sql_to_json))
                        .collect()
                },
            )
            .optional()?;
        // Hard-deleted rows are not synced.
        let Some(values) = values else { continue };
        let cells = cols
            .into_iter()
            .zip(values)
            .map(|(col, value)| (col.clone(), (value, clocks[col])))
            .collect();
        rows.push(RowChange { table, id, cells });
    }
    rows.sort_by_key(|r| order[r.table.as_str()]);
    Ok(Some(Changes {
        from: me,
        from_seq: after_seq + 1,
        to_seq,
        rows,
    }))
}

/// Highest `seq` of `device` applied here.
pub fn applied_seq(conn: &Connection, device: &str) -> Result<i64> {
    Ok(conn
        .query_row(
            "SELECT applied_seq FROM sync_peers WHERE device_id = ?1",
            [device],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0))
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Applied {
    /// Cells whose value changed here.
    pub cells: usize,
    /// Rows that could not be applied (logged).
    pub skipped_rows: usize,
}

/// Why a batch was not applied.
#[derive(Debug, PartialEq, Eq)]
pub enum NotApplied {
    /// Everything in it was applied before.
    AlreadyApplied,
    /// An earlier batch from the same device is still missing.
    Gap { expected_from: i64 },
}

/// Merges another device's batch, in one transaction.
pub fn apply(
    conn: &Connection,
    changes: &Changes,
) -> Result<std::result::Result<Applied, NotApplied>> {
    let me = device_id(conn)?;
    if changes.from == me {
        return Err(Error::Invalid("batch comes from this device".into()));
    }
    let applied = applied_seq(conn, &changes.from)?;
    if changes.to_seq <= applied {
        return Ok(Err(NotApplied::AlreadyApplied));
    }
    if changes.from_seq > applied + 1 {
        return Ok(Err(NotApplied::Gap {
            expected_from: applied + 1,
        }));
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "PRAGMA defer_foreign_keys = ON;
         INSERT OR REPLACE INTO local_meta (key, value) VALUES ('sync.applying', '1');",
    )?;
    let mut columns: HashMap<String, Vec<String>> = HashMap::new();
    for table in synced_tables() {
        columns.insert(table.to_string(), table_columns(&tx, table)?);
    }
    let mut seq = max_seq(&tx)?;
    let mut result = Applied::default();
    for row in &changes.rows {
        let Some(known) = columns.get(&row.table) else {
            tracing::warn!(table = %row.table, "sync: unknown table");
            result.skipped_rows += 1;
            continue;
        };
        if let Some(col) = row.cells.keys().find(|c| !known.contains(c) || *c == "id") {
            tracing::warn!(table = %row.table, col = %col, "sync: unknown column");
            result.skipped_rows += 1;
            continue;
        }
        tx.execute_batch("SAVEPOINT sync_row")?;
        match apply_row(&tx, row, &changes.from, &mut seq) {
            Ok(n) => {
                tx.execute_batch("RELEASE sync_row")?;
                result.cells += n;
            }
            Err(e) => {
                tx.execute_batch("ROLLBACK TO sync_row; RELEASE sync_row")?;
                tracing::warn!(table = %row.table, id = %row.id, error = %e, "sync: row not applied");
                result.skipped_rows += 1;
            }
        }
    }
    tx.execute(
        "INSERT INTO sync_peers (device_id, applied_seq, last_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (device_id) DO UPDATE SET applied_seq = MAX(applied_seq, excluded.applied_seq), last_at = excluded.last_at",
        params![changes.from, changes.to_seq, chrono::Utc::now().timestamp_millis()],
    )?;
    tx.execute("DELETE FROM local_meta WHERE key = 'sync.applying'", [])?;
    tx.commit()?;
    Ok(Ok(result))
}

/// Finds the local id for an incoming row: the same id, or a row with the
/// same natural key.
fn local_id(conn: &Connection, row: &RowChange) -> Result<Option<String>> {
    let table = quote(&row.table);
    let found: Option<String> = conn
        .query_row(
            &format!("SELECT id FROM {table} WHERE id = ?1"),
            [&row.id],
            |r| r.get(0),
        )
        .optional()?;
    if found.is_some() {
        return Ok(found);
    }
    let Some((_, key)) = NATURAL_KEYS.iter().find(|(t, _)| *t == row.table) else {
        return Ok(None);
    };
    let mut values = Vec::new();
    for col in *key {
        match row.cells.get(*col) {
            Some((v, _)) => values.push(json_to_sql(v)?),
            None => return Ok(None),
        }
    }
    let condition = key
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{} = ?{}", quote(c), i + 1))
        .collect::<Vec<_>>()
        .join(" AND ");
    Ok(conn
        .query_row(
            &format!("SELECT id FROM {table} WHERE {condition}"),
            rusqlite::params_from_iter(values),
            |r| r.get(0),
        )
        .optional()?)
}

fn set_clock(
    conn: &Connection,
    table: &str,
    id: &str,
    col: &str,
    ts: i64,
    device: &str,
    seq: &mut i64,
) -> Result<()> {
    *seq += 1;
    conn.execute(
        "INSERT OR REPLACE INTO sync_clock (table_name, row_id, col, ts, device_id, seq) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![table, id, col, ts, device, *seq],
    )?;
    Ok(())
}

fn apply_row(conn: &Connection, row: &RowChange, from: &str, seq: &mut i64) -> Result<usize> {
    let table = quote(&row.table);
    let Some(id) = local_id(conn, row)? else {
        let cols: Vec<&String> = row.cells.keys().collect();
        let names = std::iter::once("id".to_string())
            .chain(cols.iter().map(|c| quote(c)))
            .collect::<Vec<_>>()
            .join(", ");
        let marks = (1..=cols.len() + 1)
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let mut values = vec![rusqlite::types::Value::Text(row.id.clone())];
        for col in &cols {
            values.push(json_to_sql(&row.cells[*col].0)?);
        }
        conn.execute(
            &format!("INSERT INTO {table} ({names}) VALUES ({marks})"),
            rusqlite::params_from_iter(values),
        )?;
        for (col, (_, ts)) in &row.cells {
            set_clock(conn, &row.table, &row.id, col, *ts, from, seq)?;
        }
        return Ok(row.cells.len());
    };

    let mut changed = 0;
    for (col, (value, ts)) in &row.cells {
        let local: Option<(i64, String)> = conn
            .query_row(
                "SELECT ts, device_id FROM sync_clock WHERE table_name = ?1 AND row_id = ?2 AND col = ?3",
                params![row.table, id, col],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let wins = match &local {
            Some((lts, ldev)) => (*ts, from) > (*lts, ldev.as_str()),
            None => true,
        };
        if !wins {
            continue;
        }
        conn.execute(
            &format!("UPDATE {table} SET {} = ?1 WHERE id = ?2", quote(col)),
            params![json_to_sql(value)?, id],
        )?;
        set_clock(conn, &row.table, &id, col, *ts, from, seq)?;
        changed += 1;
    }
    Ok(changed)
}
