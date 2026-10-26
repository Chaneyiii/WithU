use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;
use withu_audit::AuditFact;

mod memory;
pub use memory::{
    MemoryDeleteInput, MemoryDerivativeInput, MemoryDerivativeRow, MemoryEvidenceInput,
    MemoryEvidenceRow, MemoryLink, MemoryMutation, MemoryObjectInput, MemoryObjectRow,
    MemorySnapshot, MemoryTombstoneRow, STORAGE_SCHEMA_VERSION,
};

pub struct Store {
    db: Connection,
    fail_next: bool,
}

#[derive(Debug)]
pub struct StoreError(pub &'static str);
pub type Result<T> = std::result::Result<T, StoreError>;
impl From<rusqlite::Error> for StoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self("storage_failure")
    }
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| StoreError("storage_failure"))?;
        }
        let db = Connection::open(path)?;
        // Exclusive lifetime ownership: a second server cannot share this user's DB.
        let schema_version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if schema_version > memory::STORAGE_SCHEMA_VERSION {
            return Err(StoreError("storage_schema_unsupported"));
        }
        db.execute_batch("PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS objects(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS tombstones(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT NOT NULL);")?;
        memory::initialize_memory_schema(&db, schema_version)?;
        db.execute_batch("BEGIN EXCLUSIVE; COMMIT;")?;
        let integrity: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if integrity != "ok" {
            return Err(StoreError("storage_corrupt"));
        }
        let store = Self {
            db,
            fail_next: false,
        };
        // JSON corruption is a startup failure, never silently reset user data.
        for kind in [
            "conversation",
            "project",
            "draft",
            "message",
            "goals",
            "ideas",
            "library",
            "view",
            "identity",
            "config",
            "assistant-message",
        ] {
            store.list(kind)?;
        }
        store.validate_memory_graph()?;
        Ok(store)
    }

    pub fn list(&self, kind: &str) -> Result<Vec<Value>> {
        let mut stmt = self
            .db
            .prepare("SELECT body FROM objects WHERE kind=? ORDER BY rowid")?;
        let rows = stmt.query_map([kind], |r| r.get::<_, String>(0))?;
        rows.map(|row| serde_json::from_str(&row?).map_err(|_| StoreError("storage_corrupt")))
            .collect()
    }
    pub fn get(&self, kind: &str, id: &str) -> Result<Option<Value>> {
        let body: Option<String> = self
            .db
            .query_row(
                "SELECT body FROM objects WHERE kind=? AND id=?",
                [kind, id],
                |r| r.get(0),
            )
            .optional()?;
        body.map(|s| serde_json::from_str(&s).map_err(|_| StoreError("storage_corrupt")))
            .transpose()
    }
    pub fn fail_next_commit(&mut self) {
        self.fail_next = true;
    }

    // All mutations use compare-and-swap, and persist the audit in the SAME commit.
    pub fn put(
        &mut self,
        kind: &str,
        id: &str,
        expected: u64,
        body: &Value,
        fact: &AuditFact,
    ) -> Result<()> {
        let expected = i64::try_from(expected).map_err(|_| StoreError("version_conflict"))?;
        let tx = self.db.transaction()?;
        let deleted: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM tombstones WHERE kind=? AND id=?)",
            [kind, id],
            |r| r.get(0),
        )?;
        if deleted {
            return Err(StoreError("deleted"));
        }
        let version: Option<i64> = tx
            .query_row(
                "SELECT version FROM objects WHERE kind=? AND id=?",
                [kind, id],
                |r| r.get(0),
            )
            .optional()?;
        if version.unwrap_or(0) != expected {
            return Err(StoreError("version_conflict"));
        }
        tx.execute("INSERT INTO objects VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,body=excluded.body", params![kind,id,expected+1,body.to_string()])?;
        tx.execute(
            "INSERT INTO audit(body) VALUES(?)",
            [serde_json::to_string(fact).map_err(|_| StoreError("storage_failure"))?],
        )?;
        if self.fail_next {
            self.fail_next = false;
            return Err(StoreError("storage_failure"));
        }
        tx.commit()?;
        Ok(())
    }
    pub fn delete(&mut self, kind: &str, id: &str, expected: u64, fact: &AuditFact) -> Result<()> {
        let expected = i64::try_from(expected).map_err(|_| StoreError("version_conflict"))?;
        let tx = self.db.transaction()?;
        let version: Option<i64> = tx
            .query_row(
                "SELECT version FROM objects WHERE kind=? AND id=?",
                [kind, id],
                |r| r.get(0),
            )
            .optional()?;
        if version != Some(expected) {
            return Err(StoreError("version_conflict"));
        }
        // Projects keep their conversations, detached to the valid no-project scope.
        if kind == "project" {
            let mut stmt =
                tx.prepare("SELECT id,version,body FROM objects WHERE kind='conversation'")?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(stmt);
            for (cid, cv, raw) in rows {
                let mut body: Value =
                    serde_json::from_str(&raw).map_err(|_| StoreError("storage_corrupt"))?;
                if body["project_id"] == id {
                    body["project_id"] = Value::Null;
                    body["version"] = (cv + 1).into();
                    tx.execute(
                        "UPDATE objects SET version=?,body=? WHERE kind='conversation' AND id=?",
                        params![cv + 1, body.to_string(), cid],
                    )?;
                }
            }
        }
        // Removing a conversation removes its submitted input and draft atomically.
        if kind == "conversation" {
            let mut stmt = tx.prepare(
                "SELECT kind,id,version,body FROM objects WHERE kind IN ('draft','message','assistant-message','reply-receipt')",
            )?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(stmt);
            for (ck, ci, cv, raw) in rows {
                let body: Value =
                    serde_json::from_str(&raw).map_err(|_| StoreError("storage_corrupt"))?;
                if body["conversation_id"] == id {
                    tx.execute("DELETE FROM objects WHERE kind=? AND id=?", [&ck, &ci])?;
                    tx.execute(
                        "INSERT INTO tombstones VALUES(?,?,?)",
                        params![ck, ci, cv + 1],
                    )?;
                }
            }
        }
        tx.execute("DELETE FROM objects WHERE kind=? AND id=?", [kind, id])?;
        tx.execute(
            "INSERT INTO tombstones VALUES(?,?,?)",
            params![kind, id, expected + 1],
        )?;
        tx.execute(
            "INSERT INTO audit(body) VALUES(?)",
            [serde_json::to_string(fact).map_err(|_| StoreError("storage_failure"))?],
        )?;
        if self.fail_next {
            self.fail_next = false;
            return Err(StoreError("storage_failure"));
        }
        tx.commit()?;
        Ok(())
    }
    pub fn audit(&self) -> Result<Vec<Value>> {
        let mut stmt = self
            .db
            .prepare("SELECT body FROM audit ORDER BY sequence")?;
        let result = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|s| serde_json::from_str(&s?).map_err(|_| StoreError("storage_corrupt")))
            .collect();
        result
    }
}
