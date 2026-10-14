//! Encrypted SQLite (SQLCipher) access.
//!
//! The frontend sends SQL through [`Database::query`], which backs Drizzle's
//! `sqlite-proxy` driver.

pub mod migrations;

use std::path::Path;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use serde_json::Value as JsonValue;

use crate::error::{Error, Result};
use crate::vault::DataKey;

pub const DB_FILE: &str = "kaizen.db";

pub struct Database {
    conn: Connection,
}

fn key_pragma(key: &DataKey) -> zeroize::Zeroizing<String> {
    zeroize::Zeroizing::new(format!("\"x'{}'\"", hex::encode(key.as_ref())))
}

/// Applies the raw key to a fresh connection and checks it can read the file.
fn apply_key(conn: &Connection, key: &DataKey) -> Result<()> {
    conn.execute_batch(&format!("PRAGMA key = {};", key_pragma(key).as_str()))?;
    // Fails with "file is not a database" when the key is wrong.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| Error::WrongSecret)?;
    Ok(())
}

impl Database {
    /// Opens (or creates) the encrypted database and runs migrations. When an
    /// existing database needs migrating, a copy is saved to `backup_dir` first.
    pub fn open(path: &Path, key: &DataKey, backup_dir: Option<&Path>) -> Result<Self> {
        let mut conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;
        apply_key(&conn, key)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        let version = migrations::current_version(&conn)?;
        if let Some(dir) = backup_dir.filter(|_| version > 0 && version < migrations::LATEST) {
            std::fs::create_dir_all(dir)?;
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let dest = dir.join(format!("pre-migration-v{version}-{stamp}.db"));
            let db = Self { conn };
            db.export_copy(&dest, key)?;
            tracing::info!(?dest, "saved pre-migration copy");
            conn = db.conn;
        }
        migrations::migrate(&mut conn)?;
        Ok(Self { conn })
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn device_id(&self) -> Result<String> {
        Ok(self.conn.query_row(
            "SELECT value FROM local_meta WHERE key = 'device_id'",
            [],
            |r| r.get(0),
        )?)
    }

    pub fn query(
        &self,
        sql: &str,
        params: &[JsonValue],
        method: QueryMethod,
    ) -> Result<Vec<Vec<JsonValue>>> {
        let mut stmt = self.conn.prepare(sql)?;
        for (i, param) in params.iter().enumerate() {
            stmt.raw_bind_parameter(i + 1, json_to_sql(param)?)?;
        }
        if method == QueryMethod::Run {
            stmt.raw_execute()?;
            return Ok(Vec::new());
        }
        let columns = stmt.column_count();
        let mut rows = stmt.raw_query();
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let mut values = Vec::with_capacity(columns);
            for i in 0..columns {
                values.push(sql_to_json(row.get_ref(i)?));
            }
            out.push(values);
            if method == QueryMethod::Get {
                break;
            }
        }
        Ok(out)
    }

    /// Writes an encrypted copy of the database (same key) to `dest`.
    pub fn export_copy(&self, dest: &Path, key: &DataKey) -> Result<()> {
        if dest.exists() {
            std::fs::remove_file(dest)?;
        }
        let dest = dest
            .to_str()
            .ok_or_else(|| Error::Invalid("non UTF-8 path".into()))?;
        self.conn.execute(
            &format!(
                "ATTACH DATABASE ?1 AS backup KEY {}",
                key_pragma(key).as_str()
            ),
            [dest],
        )?;
        let result = self
            .conn
            .query_row("SELECT sqlcipher_export('backup')", [], |_| Ok(()))
            .and_then(|_| {
                self.conn.execute_batch(&format!(
                    "PRAGMA backup.user_version = {};",
                    migrations::current_version(&self.conn).unwrap_or(0)
                ))
            });
        self.conn.execute("DETACH DATABASE backup", [])?;
        result?;
        Ok(())
    }

    /// Dumps every table (except the FTS index) as JSON.
    pub fn export_json(&self) -> Result<JsonValue> {
        let mut tables = serde_json::Map::new();
        let names: Vec<String> = self
            .conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index%'
                 ORDER BY name",
            )?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        for name in names {
            let mut stmt = self.conn.prepare(&format!("SELECT * FROM \"{name}\""))?;
            let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
            let mut rows = stmt.query([])?;
            let mut list = Vec::new();
            while let Some(row) = rows.next()? {
                let mut obj = serde_json::Map::new();
                for (i, col) in columns.iter().enumerate() {
                    obj.insert(col.clone(), sql_to_json(row.get_ref(i)?));
                }
                list.push(JsonValue::Object(obj));
            }
            tables.insert(name, JsonValue::Array(list));
        }
        Ok(JsonValue::Object(tables))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueryMethod {
    Run,
    All,
    Values,
    Get,
}

pub(crate) fn json_to_sql(value: &JsonValue) -> Result<SqlValue> {
    Ok(match value {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(*b as i64),
        JsonValue::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        // Byte arrays arrive as plain number arrays.
        JsonValue::Array(items) => SqlValue::Blob(
            items
                .iter()
                .map(|v| v.as_u64().filter(|b| *b <= 255).map(|b| b as u8))
                .collect::<Option<Vec<u8>>>()
                .ok_or_else(|| Error::Invalid("unsupported array parameter".into()))?,
        ),
        JsonValue::Object(_) => SqlValue::Text(value.to_string()),
    })
}

pub(crate) fn sql_to_json(value: ValueRef<'_>) -> JsonValue {
    match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(i) => JsonValue::from(i),
        ValueRef::Real(f) => JsonValue::from(f),
        ValueRef::Text(t) => JsonValue::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => JsonValue::Array(b.iter().map(|x| JsonValue::from(*x)).collect()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use zeroize::Zeroizing;

    fn key(byte: u8) -> DataKey {
        Zeroizing::new([byte; 32])
    }

    #[test]
    fn migrates_and_records_changes() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join(DB_FILE), &key(1), None).unwrap();
        let device = db.device_id().unwrap();

        let types = db
            .query("SELECT count(*) FROM activity_types", &[], QueryMethod::Get)
            .unwrap();
        assert_eq!(types[0][0], json!(9));

        db.query(
            "INSERT INTO settings (id, value, created_at, updated_at, device_id) VALUES (?, ?, ?, ?, ?)",
            &[json!("theme"), json!("\"dark\""), json!(1), json!(1), json!(device)],
            QueryMethod::Run,
        )
        .unwrap();
        db.query(
            "UPDATE settings SET deleted_at = 2 WHERE id = 'theme'",
            &[],
            QueryMethod::Run,
        )
        .unwrap();

        let cells = db
            .query(
                "SELECT col, ts, device_id FROM sync_clock WHERE table_name = 'settings' AND row_id = 'theme' ORDER BY col",
                &[],
                QueryMethod::All,
            )
            .unwrap();
        let cols: Vec<_> = cells.iter().map(|c| c[0].clone()).collect();
        assert_eq!(
            cols,
            vec![
                json!("created_at"),
                json!("deleted_at"),
                json!("device_id"),
                json!("updated_at"),
                json!("value")
            ]
        );
        assert!(cells.iter().all(|c| c[2] == json!(device)));

        // FTS5 with the trigram tokenizer is available.
        db.query(
            "INSERT INTO search_index (module, ref_id, title, body, tags) VALUES ('ideas', '1', 'Kaizen sync', '', '')",
            &[],
            QueryMethod::Run,
        )
        .unwrap();
        let hits = db
            .query(
                "SELECT ref_id FROM search_index WHERE search_index MATCH 'aize'",
                &[],
                QueryMethod::All,
            )
            .unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn wrong_key_is_rejected_and_copy_is_encrypted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DB_FILE);
        let copy = dir.path().join("copy.db");
        {
            let db = Database::open(&path, &key(7), None).unwrap();
            db.export_copy(&copy, &key(7)).unwrap();
        }
        assert!(matches!(
            Database::open(&path, &key(8), None),
            Err(Error::WrongSecret)
        ));

        let restored = Database::open(&copy, &key(7), None).unwrap();
        let types = restored
            .query("SELECT count(*) FROM activity_types", &[], QueryMethod::Get)
            .unwrap();
        assert_eq!(types[0][0], json!(9));
        assert_eq!(
            migrations::current_version(restored.conn()).unwrap(),
            migrations::LATEST
        );
    }
}

/// Dev tool: writes the full schema as SQL for the browser preview.
/// Run with `KAIZEN_SCHEMA_OUT=path cargo test dump_schema -- --ignored`.
#[cfg(test)]
mod dump {
    use super::*;

    #[test]
    #[ignore]
    fn dump_schema() {
        let Ok(out) = std::env::var("KAIZEN_SCHEMA_OUT") else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let key = zeroize::Zeroizing::new([3u8; 32]);
        let db = Database::open(&dir.path().join(DB_FILE), &key, None).unwrap();
        let mut sql = String::new();
        let mut stmt = db
            .conn()
            .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'search_index%' ORDER BY rowid")
            .unwrap();
        for row in stmt.query_map([], |r| r.get::<_, String>(0)).unwrap() {
            sql.push_str(&row.unwrap());
            sql.push_str(";\n");
        }
        // Clock triggers need a device id before any row is inserted.
        sql.push_str("INSERT INTO local_meta VALUES ('device_id', '01mock-device-0000');\n");
        let mut stmt = db.conn().prepare("SELECT * FROM activity_types").unwrap();
        let cols = stmt.column_count();
        let mut rows = stmt.query([]).unwrap();
        while let Some(r) = rows.next().unwrap() {
            let vals: Vec<String> = (0..cols)
                .map(|i| match r.get_ref(i).unwrap() {
                    rusqlite::types::ValueRef::Null => "NULL".into(),
                    rusqlite::types::ValueRef::Integer(n) => n.to_string(),
                    rusqlite::types::ValueRef::Real(f) => f.to_string(),
                    rusqlite::types::ValueRef::Text(t) => {
                        format!("'{}'", String::from_utf8_lossy(t).replace('\'', "''"))
                    }
                    rusqlite::types::ValueRef::Blob(_) => "NULL".into(),
                })
                .collect();
            sql.push_str(&format!(
                "INSERT INTO activity_types VALUES ({});\n",
                vals.join(", ")
            ));
        }
        std::fs::write(out, sql).unwrap();
    }
}
