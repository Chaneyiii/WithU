use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::{HashMap, HashSet};
use std::convert::TryFrom;

use super::{Result, Store, StoreError};
use withu_audit::AuditFact;

/// The first durable memory migration is additive to the P0 object tables.
/// A newer value is rejected instead of being opened by an older binary.
pub const STORAGE_SCHEMA_VERSION: i64 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryLink {
    pub id: String,
    pub version: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryObjectRow {
    pub id: String,
    pub kind: String,
    pub scope: String,
    pub version: u64,
    pub body: String,
    pub sources: Vec<MemoryLink>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryEvidenceRow {
    pub id: String,
    pub scope: String,
    pub version: u64,
    pub body: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryDerivativeRow {
    pub id: String,
    pub scope: String,
    pub version: u64,
    pub body: String,
    pub sources: Vec<MemoryLink>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryTombstoneRow {
    pub target_type: String,
    pub id: String,
    pub scope: String,
    pub deleted_version: u64,
    pub created_at: String,
    pub source: String,
    pub sync_protection_token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemorySnapshot {
    pub state_version: u64,
    pub objects: Vec<MemoryObjectRow>,
    pub evidence: Vec<MemoryEvidenceRow>,
    pub derivatives: Vec<MemoryDerivativeRow>,
    pub tombstones: Vec<MemoryTombstoneRow>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryEvidenceInput {
    pub id: String,
    pub scope: String,
    pub version: u64,
    pub expected_version: u64,
    pub body: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryObjectInput {
    pub id: String,
    pub kind: String,
    pub scope: String,
    pub expected_version: u64,
    pub version: u64,
    pub body: String,
    pub sources: Vec<MemoryLink>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryDerivativeInput {
    pub id: String,
    pub scope: String,
    pub expected_version: u64,
    pub version: u64,
    pub body: String,
    pub sources: Vec<MemoryLink>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryDeleteInput {
    pub target_type: String,
    pub id: String,
    pub scope: String,
    pub expected_version: u64,
    pub created_at: String,
    pub source: String,
    pub sync_protection_token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemoryMutation {
    RegisterEvidence(MemoryEvidenceInput),
    UpsertObject(MemoryObjectInput),
    AddDerivative(MemoryDerivativeInput),
    Delete(MemoryDeleteInput),
}

pub(crate) fn initialize_memory_schema(db: &Connection, current: i64) -> Result<()> {
    if current > STORAGE_SCHEMA_VERSION {
        return Err(StoreError("storage_schema_unsupported"));
    }
    if current == STORAGE_SCHEMA_VERSION {
        return Ok(());
    }
    // DDL and the version marker commit together. Existing P0/P1 objects are
    // preserved; a damaged database already marked v2 is never reset/repaired.
    let tx = db.unchecked_transaction()?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS memory_state(
            id INTEGER PRIMARY KEY CHECK(id=1),
            state_version INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO memory_state(id,state_version) VALUES(1,0);
        CREATE TABLE IF NOT EXISTS memory_evidence(
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            version INTEGER NOT NULL,
            body TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_objects(
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            scope TEXT NOT NULL,
            version INTEGER NOT NULL,
            body TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_derivatives(
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            version INTEGER NOT NULL,
            body TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_links(
            parent_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_version INTEGER NOT NULL,
            PRIMARY KEY(parent_id,source_id)
        );
        CREATE INDEX IF NOT EXISTS memory_links_source ON memory_links(source_id);
        CREATE INDEX IF NOT EXISTS memory_objects_scope ON memory_objects(scope);
        CREATE INDEX IF NOT EXISTS memory_evidence_scope ON memory_evidence(scope);
        CREATE INDEX IF NOT EXISTS memory_derivatives_scope ON memory_derivatives(scope);
        CREATE TABLE IF NOT EXISTS memory_tombstones(
            target_type TEXT NOT NULL,
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            deleted_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            source TEXT NOT NULL,
            sync_protection_token TEXT NOT NULL
        );",
    )?;
    tx.execute_batch("PRAGMA user_version=2;")?;
    tx.commit()?;
    Ok(())
}

impl Store {
    /// Read all memory rows in one consistent SQLite snapshot.  The memory
    /// crate performs typed decoding and exact-scope filtering above this
    /// boundary.
    pub fn memory_snapshot(&self) -> Result<MemorySnapshot> {
        let tx = self.db.unchecked_transaction()?;
        let result = memory_snapshot_tx(&tx);
        tx.rollback()?;
        result
    }

    /// Apply one memory operation and its audit record atomically.  The
    /// expected state version is a global CAS token for offline candidates.
    pub fn memory_apply(
        &mut self,
        expected_state_version: u64,
        mutation: MemoryMutation,
        fact: &AuditFact,
    ) -> Result<u64> {
        self.memory_apply_batch(
            expected_state_version,
            vec![mutation],
            std::slice::from_ref(fact),
        )
    }

    /// A save may create its necessary evidence and canonical object in the
    /// same transaction. Audits are supplied only by the domain authority.
    pub fn memory_apply_batch(
        &mut self,
        expected_state_version: u64,
        mutations: Vec<MemoryMutation>,
        facts: &[AuditFact],
    ) -> Result<u64> {
        if mutations.is_empty() || mutations.len() != facts.len() {
            return Err(StoreError("validation_error"));
        }
        let expected =
            i64::try_from(expected_state_version).map_err(|_| StoreError("version_conflict"))?;
        let inject_failure = self.fail_next;
        self.fail_next = false;
        let tx = self.db.transaction()?;
        let current = current_state(&tx)?;
        if current != expected {
            return Err(StoreError("version_conflict"));
        }
        validate_graph(&memory_snapshot_tx(&tx)?)?;
        for mutation in mutations {
            match mutation {
                MemoryMutation::RegisterEvidence(input) => apply_evidence(&tx, input)?,
                MemoryMutation::UpsertObject(input) => apply_object(&tx, input)?,
                MemoryMutation::AddDerivative(input) => apply_derivative(&tx, input)?,
                MemoryMutation::Delete(input) => apply_delete(&tx, input)?,
            };
        }
        validate_graph(&memory_snapshot_tx(&tx)?)?;
        let next = current
            .checked_add(1)
            .ok_or(StoreError("storage_corrupt"))?;
        tx.execute("UPDATE memory_state SET state_version=? WHERE id=1", [next])?;
        for fact in facts {
            tx.execute(
                "INSERT INTO audit(body) VALUES(?)",
                [serde_json::to_string(fact).map_err(|_| StoreError("storage_failure"))?],
            )?;
        }
        if inject_failure {
            // Dropping the transaction rolls back rows, links, state, and
            // audit together.  The injection is deliberately test-only.
            return Err(StoreError("storage_failure"));
        }
        tx.commit()?;
        to_u64(next)
    }

    pub fn validate_memory_graph(&self) -> Result<()> {
        let snapshot = self.memory_snapshot()?;
        validate_graph(&snapshot)
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 512 && !id.contains('\0')
}

fn validate_id(id: &str) -> Result<()> {
    if valid_id(id) {
        Ok(())
    } else {
        Err(StoreError("validation_error"))
    }
}

fn to_u64(value: i64) -> Result<u64> {
    u64::try_from(value).map_err(|_| StoreError("storage_corrupt"))
}

fn current_state(tx: &Transaction<'_>) -> Result<i64> {
    tx.query_row(
        "SELECT state_version FROM memory_state WHERE id=1",
        [],
        |r| r.get(0),
    )
    .map_err(Into::into)
}

fn exists(tx: &Transaction<'_>, table: &str, id: &str) -> Result<bool> {
    let sql = match table {
        "memory_evidence" | "memory_objects" | "memory_derivatives" | "memory_tombstones" => {
            format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?)")
        }
        _ => return Err(StoreError("storage_failure")),
    };
    tx.query_row(&sql, [id], |r| r.get(0)).map_err(Into::into)
}

fn scope_for(tx: &Transaction<'_>, id: &str) -> Result<Option<String>> {
    if let Some(scope) = tx
        .query_row("SELECT scope FROM memory_evidence WHERE id=?", [id], |r| {
            r.get(0)
        })
        .optional()?
    {
        return Ok(Some(scope));
    }
    if let Some(scope) = tx
        .query_row("SELECT scope FROM memory_objects WHERE id=?", [id], |r| {
            r.get(0)
        })
        .optional()?
    {
        return Ok(Some(scope));
    }
    tx.query_row(
        "SELECT scope FROM memory_derivatives WHERE id=?",
        [id],
        |r| r.get(0),
    )
    .optional()
    .map_err(Into::into)
}

fn version_for(tx: &Transaction<'_>, id: &str) -> Result<Option<u64>> {
    for table in ["memory_evidence", "memory_objects", "memory_derivatives"] {
        let sql = format!("SELECT version FROM {table} WHERE id=?");
        if let Some(version) = tx
            .query_row(&sql, [id], |r| r.get::<_, i64>(0))
            .optional()?
        {
            return Ok(Some(to_u64(version)?));
        }
    }
    Ok(None)
}

fn links_for(tx: &Transaction<'_>, parent_id: &str) -> Result<Vec<MemoryLink>> {
    let mut stmt = tx.prepare(
        "SELECT source_id,source_version FROM memory_links
         WHERE parent_id=? ORDER BY rowid",
    )?;
    let rows = stmt.query_map([parent_id], |r| {
        let version: i64 = r.get(1)?;
        Ok(MemoryLink {
            id: r.get(0)?,
            version: u64::try_from(version).map_err(|_| rusqlite::Error::InvalidQuery)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn memory_snapshot_tx(tx: &Transaction<'_>) -> Result<MemorySnapshot> {
    let state_version = to_u64(current_state(tx)?)?;
    let mut stmt =
        tx.prepare("SELECT id,kind,scope,version,body FROM memory_objects ORDER BY rowid")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    let objects = rows
        .into_iter()
        .map(|(id, kind, scope, version, body)| {
            Ok(MemoryObjectRow {
                sources: links_for(tx, &id)?,
                id,
                kind,
                scope,
                version: to_u64(version)?,
                body,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let mut stmt =
        tx.prepare("SELECT id,scope,version,body FROM memory_evidence ORDER BY rowid")?;
    let evidence = stmt
        .query_map([], |r| {
            let version: i64 = r.get(2)?;
            Ok(MemoryEvidenceRow {
                id: r.get(0)?,
                scope: r.get(1)?,
                version: u64::try_from(version).map_err(|_| rusqlite::Error::InvalidQuery)?,
                body: r.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let mut stmt =
        tx.prepare("SELECT id,scope,version,body FROM memory_derivatives ORDER BY rowid")?;
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
    let derivatives = rows
        .into_iter()
        .map(|(id, scope, version, body)| {
            Ok(MemoryDerivativeRow {
                sources: links_for(tx, &id)?,
                id,
                scope,
                version: to_u64(version)?,
                body,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let mut stmt = tx.prepare(
        "SELECT target_type,id,scope,deleted_version,created_at,source,sync_protection_token
         FROM memory_tombstones ORDER BY rowid",
    )?;
    let tombstones = stmt
        .query_map([], |r| {
            let version: i64 = r.get(3)?;
            Ok(MemoryTombstoneRow {
                target_type: r.get(0)?,
                id: r.get(1)?,
                scope: r.get(2)?,
                deleted_version: u64::try_from(version)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                created_at: r.get(4)?,
                source: r.get(5)?,
                sync_protection_token: r.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(MemorySnapshot {
        state_version,
        objects,
        evidence,
        derivatives,
        tombstones,
    })
}

fn ensure_links(sources: &[MemoryLink]) -> Result<()> {
    if sources.is_empty()
        || sources
            .iter()
            .any(|source| !valid_id(&source.id) || source.version == 0)
    {
        return Err(StoreError("validation_error"));
    }
    let mut ids = HashSet::new();
    if sources.iter().any(|source| !ids.insert(source.id.as_str())) {
        return Err(StoreError("duplicate_dependency"));
    }
    Ok(())
}

fn insert_links(tx: &Transaction<'_>, parent_id: &str, sources: &[MemoryLink]) -> Result<()> {
    for source in sources {
        tx.execute(
            "INSERT INTO memory_links(parent_id,source_id,source_version) VALUES(?,?,?)",
            params![
                parent_id,
                source.id,
                i64::try_from(source.version).map_err(|_| StoreError("version_conflict"))?
            ],
        )?;
    }
    Ok(())
}

fn apply_evidence(tx: &Transaction<'_>, input: MemoryEvidenceInput) -> Result<bool> {
    validate_id(&input.id)?;
    if input.scope.is_empty()
        || input.version == 0
        || input.expected_version.checked_add(1) != Some(input.version)
        || input.body.is_empty()
    {
        return Err(StoreError("validation_error"));
    }
    if exists(tx, "memory_tombstones", &input.id)? {
        return Err(StoreError("deleted"));
    }
    if exists(tx, "memory_objects", &input.id)? || exists(tx, "memory_derivatives", &input.id)? {
        return Err(StoreError("id_conflict"));
    }
    let old: Option<(String, u64)> = tx
        .query_row(
            "SELECT scope,version FROM memory_evidence WHERE id=?",
            [&input.id],
            |r| {
                let version: i64 = r.get(1)?;
                Ok((
                    r.get(0)?,
                    u64::try_from(version).map_err(|_| rusqlite::Error::InvalidQuery)?,
                ))
            },
        )
        .optional()?;
    if let Some((scope, version)) = old {
        if scope != input.scope || input.expected_version != version {
            return Err(StoreError("version_conflict"));
        }
        tx.execute(
            "UPDATE memory_evidence SET version=?,body=? WHERE id=?",
            params![
                i64::try_from(input.version).map_err(|_| StoreError("version_conflict"))?,
                input.body,
                input.id
            ],
        )?;
    } else {
        if input.expected_version != 0 {
            return Err(StoreError("version_conflict"));
        }
        tx.execute(
            "INSERT INTO memory_evidence(id,scope,version,body) VALUES(?,?,?,?)",
            params![
                input.id,
                input.scope,
                i64::try_from(input.version).map_err(|_| StoreError("version_conflict"))?,
                input.body
            ],
        )?;
    }
    Ok(true)
}

fn apply_object(tx: &Transaction<'_>, input: MemoryObjectInput) -> Result<bool> {
    validate_id(&input.id)?;
    if input.kind.is_empty()
        || !matches!(
            input.kind.as_str(),
            "stable_fact"
                | "explicit_preference"
                | "explicit_experience"
                | "relationship_summary"
                | "recoverable_item"
        )
        || input.scope.is_empty()
        || input.version == 0
        || input.body.is_empty()
    {
        return Err(StoreError("validation_error"));
    }
    ensure_links(&input.sources)?;
    if exists(tx, "memory_tombstones", &input.id)? {
        return Err(StoreError("deleted"));
    }
    if exists(tx, "memory_evidence", &input.id)? || exists(tx, "memory_derivatives", &input.id)? {
        return Err(StoreError("id_conflict"));
    }
    let old: Option<(String, String, u64)> = tx
        .query_row(
            "SELECT kind,scope,version FROM memory_objects WHERE id=?",
            [&input.id],
            |r| {
                let version: i64 = r.get(2)?;
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    u64::try_from(version).map_err(|_| rusqlite::Error::InvalidQuery)?,
                ))
            },
        )
        .optional()?;
    if let Some((kind, scope, version)) = old {
        if kind != input.kind || scope != input.scope || version != input.expected_version {
            return Err(StoreError("version_conflict"));
        }
        if input.version != input.expected_version.saturating_add(1) {
            return Err(StoreError("version_conflict"));
        }
    } else {
        if input.expected_version != 0 {
            return Err(StoreError("version_conflict"));
        }
        if input.version != 1 {
            return Err(StoreError("validation_error"));
        }
    }
    for source in &input.sources {
        let (scope, version): (String, u64) = tx
            .query_row(
                "SELECT scope,version FROM memory_evidence WHERE id=?",
                [&source.id],
                |r| {
                    let version: i64 = r.get(1)?;
                    Ok((
                        r.get(0)?,
                        u64::try_from(version).map_err(|_| rusqlite::Error::InvalidQuery)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError("evidence_missing"))?;
        if scope != input.scope || version != source.version {
            return Err(StoreError("evidence_version_conflict"));
        }
    }
    tx.execute(
        "INSERT INTO memory_objects(id,kind,scope,version,body) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,scope=excluded.scope,
         version=excluded.version,body=excluded.body",
        params![
            input.id,
            input.kind,
            input.scope,
            i64::try_from(input.version).map_err(|_| StoreError("version_conflict"))?,
            input.body
        ],
    )?;
    tx.execute("DELETE FROM memory_links WHERE parent_id=?", [&input.id])?;
    insert_links(tx, &input.id, &input.sources)?;
    Ok(true)
}

fn apply_derivative(tx: &Transaction<'_>, input: MemoryDerivativeInput) -> Result<bool> {
    validate_id(&input.id)?;
    if input.scope.is_empty() || input.version == 0 || input.body.is_empty() {
        return Err(StoreError("validation_error"));
    }
    let body: serde_json::Value =
        serde_json::from_str(&input.body).map_err(|_| StoreError("validation_error"))?;
    if body["kind"] != "derived_context_cache" || body["id"].as_str() != Some(input.id.as_str()) {
        return Err(StoreError("validation_error"));
    }
    ensure_links(&input.sources)?;
    if input.sources.iter().any(|source| source.id == input.id) {
        return Err(StoreError("dependency_cycle"));
    }
    if exists(tx, "memory_tombstones", &input.id)? {
        return Err(StoreError("deleted"));
    }
    if exists(tx, "memory_evidence", &input.id)? || exists(tx, "memory_objects", &input.id)? {
        return Err(StoreError("id_conflict"));
    }
    let old: Option<(String, u64, String)> = tx
        .query_row(
            "SELECT scope,version,body FROM memory_derivatives WHERE id=?",
            [&input.id],
            |r| {
                let version: i64 = r.get(1)?;
                Ok((
                    r.get(0)?,
                    u64::try_from(version).map_err(|_| rusqlite::Error::InvalidQuery)?,
                    r.get(2)?,
                ))
            },
        )
        .optional()?;
    if let Some((scope, version, old_body)) = old {
        let old_value: serde_json::Value =
            serde_json::from_str(&old_body).map_err(|_| StoreError("storage_corrupt"))?;
        let new_value = &body;
        if scope != input.scope
            || version != input.expected_version
            || new_value["kind"] != old_value["kind"]
            || input.version != input.expected_version.saturating_add(1)
        {
            return Err(StoreError("version_conflict"));
        }
    } else if input.expected_version != 0 || input.version != 1 {
        return Err(StoreError("version_conflict"));
    }
    for source in &input.sources {
        let scope = scope_for(tx, &source.id)?.ok_or(StoreError("dependency_missing"))?;
        let version = version_for(tx, &source.id)?.ok_or(StoreError("dependency_missing"))?;
        if scope != input.scope || version != source.version {
            return Err(StoreError("dependency_version_conflict"));
        }
        if !node_visible(tx, &source.id, &mut HashSet::new())? {
            return Err(StoreError("dependency_stale"));
        }
    }
    tx.execute(
        "INSERT INTO memory_derivatives(id,scope,version,body) VALUES(?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,version=excluded.version,body=excluded.body",
        params![
            input.id,
            input.scope,
            i64::try_from(input.version).map_err(|_| StoreError("version_conflict"))?,
            input.body
        ],
    )?;
    tx.execute("DELETE FROM memory_links WHERE parent_id=?", [&input.id])?;
    insert_links(tx, &input.id, &input.sources)?;
    validate_graph(&memory_snapshot_tx(tx)?)?;
    Ok(true)
}

fn node_visible(tx: &Transaction<'_>, id: &str, path: &mut HashSet<String>) -> Result<bool> {
    if !path.insert(id.to_owned()) {
        return Err(StoreError("dependency_cycle"));
    }
    if exists(tx, "memory_tombstones", id)? {
        path.remove(id);
        return Ok(false);
    }
    let mut visible = true;
    let evidence_row: Option<(String, i64)> = tx
        .query_row(
            "SELECT scope,version FROM memory_evidence WHERE id=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((scope, version)) = evidence_row {
        let _ = (scope, version);
    } else if exists(tx, "memory_objects", id)? || exists(tx, "memory_derivatives", id)? {
        let sources = links_for(tx, id)?;
        if sources.is_empty() {
            visible = false;
        }
        for source in sources {
            let version = version_for(tx, &source.id)?;
            if version != Some(source.version) || !node_visible(tx, &source.id, path)? {
                visible = false;
                break;
            }
        }
    } else {
        visible = false;
    }
    path.remove(id);
    Ok(visible)
}

fn apply_delete(tx: &Transaction<'_>, input: MemoryDeleteInput) -> Result<bool> {
    validate_id(&input.id)?;
    if input.target_type.is_empty()
        || input.scope.is_empty()
        || input.expected_version == 0
        || input.created_at.is_empty()
        || input.source.is_empty()
        || input.sync_protection_token.is_empty()
    {
        return Err(StoreError("validation_error"));
    }
    let existing_tombstone: Option<(String, u64)> = tx
        .query_row(
            "SELECT scope,deleted_version FROM memory_tombstones WHERE id=?",
            [&input.id],
            |r| {
                let version: i64 = r.get(1)?;
                Ok((
                    r.get(0)?,
                    u64::try_from(version).map_err(|_| rusqlite::Error::InvalidQuery)?,
                ))
            },
        )
        .optional()?;
    if existing_tombstone.is_some() {
        return Err(StoreError("deleted"));
    }
    let snapshot = memory_snapshot_tx(tx)?;
    let root_scope = scope_for(tx, &input.id)?.ok_or(StoreError("not_found"))?;
    let root_version = version_for(tx, &input.id)?.ok_or(StoreError("not_found"))?;
    if root_scope != input.scope || root_version != input.expected_version {
        return Err(StoreError("version_conflict"));
    }
    let actual_type = if snapshot.evidence.iter().any(|row| row.id == input.id) {
        "evidence"
    } else if snapshot.objects.iter().any(|row| row.id == input.id) {
        "memory"
    } else {
        "derivative"
    };
    if actual_type != input.target_type {
        return Err(StoreError("target_type_conflict"));
    }
    let mut invalid = HashSet::from([input.id.clone()]);
    if actual_type == "memory" {
        if let Some(row) = snapshot.objects.iter().find(|row| row.id == input.id) {
            invalid.extend(row.sources.iter().map(|source| source.id.clone()));
        }
    }
    loop {
        let before = invalid.len();
        let invalid_objects: Vec<String> = snapshot
            .objects
            .iter()
            .filter(|row| {
                row.sources
                    .iter()
                    .any(|source| invalid.contains(&source.id))
            })
            .map(|row| row.id.clone())
            .collect();
        let invalid_derivatives: Vec<String> = snapshot
            .derivatives
            .iter()
            .filter(|row| {
                row.sources
                    .iter()
                    .any(|source| invalid.contains(&source.id))
            })
            .map(|row| row.id.clone())
            .collect();
        invalid.extend(invalid_objects);
        invalid.extend(invalid_derivatives);
        if invalid.len() == before {
            break;
        }
    }
    for id in invalid {
        let Some(scope) = scope_for(tx, &id)? else {
            continue;
        };
        let version = version_for(tx, &id)?.ok_or(StoreError("storage_corrupt"))?;
        let target_type = if snapshot.evidence.iter().any(|row| row.id == id) {
            "evidence"
        } else if snapshot.objects.iter().any(|row| row.id == id) {
            "memory"
        } else {
            "derivative"
        };
        tx.execute("DELETE FROM memory_evidence WHERE id=?", [&id])?;
        tx.execute("DELETE FROM memory_objects WHERE id=?", [&id])?;
        tx.execute("DELETE FROM memory_derivatives WHERE id=?", [&id])?;
        tx.execute("DELETE FROM memory_links WHERE parent_id=?", [&id])?;
        tx.execute(
            "INSERT INTO memory_tombstones(target_type,id,scope,deleted_version,created_at,source,sync_protection_token)
             VALUES(?,?,?,?,?,?,?)",
            params![target_type, id, scope, i64::try_from(version.saturating_add(1)).map_err(|_| StoreError("version_conflict"))?, input.created_at, input.source, input.sync_protection_token],
        )?;
    }
    Ok(true)
}

fn validate_graph(snapshot: &MemorySnapshot) -> Result<()> {
    let mut scopes = HashMap::new();
    let tombstones: HashSet<&str> = snapshot
        .tombstones
        .iter()
        .map(|row| row.id.as_str())
        .collect();
    let mut all_ids = HashSet::new();
    for row in &snapshot.evidence {
        if !valid_id(&row.id) || !all_ids.insert(row.id.as_str()) {
            return Err(StoreError("storage_corrupt"));
        }
        scopes.insert(row.id.as_str(), row.scope.as_str());
    }
    for row in &snapshot.objects {
        if !valid_id(&row.id) || !all_ids.insert(row.id.as_str()) {
            return Err(StoreError("storage_corrupt"));
        }
        scopes.insert(row.id.as_str(), row.scope.as_str());
    }
    for row in &snapshot.derivatives {
        if !valid_id(&row.id) || !all_ids.insert(row.id.as_str()) {
            return Err(StoreError("storage_corrupt"));
        }
        scopes.insert(row.id.as_str(), row.scope.as_str());
    }
    for tombstone in &snapshot.tombstones {
        if !valid_id(&tombstone.id)
            || !all_ids.insert(tombstone.id.as_str())
            || tombstone.deleted_version == 0
        {
            return Err(StoreError("storage_corrupt"));
        }
    }
    for row in &snapshot.objects {
        for source in &row.sources {
            match scopes.get(source.id.as_str()) {
                Some(scope) if *scope == row.scope.as_str() => {}
                None if tombstones.contains(source.id.as_str()) => {}
                _ => return Err(StoreError("storage_corrupt")),
            }
        }
    }
    for row in &snapshot.derivatives {
        if row.sources.is_empty() {
            return Err(StoreError("storage_corrupt"));
        }
        for source in &row.sources {
            match scopes.get(source.id.as_str()) {
                Some(scope) if *scope == row.scope.as_str() => {}
                None if tombstones.contains(source.id.as_str()) => {}
                _ => return Err(StoreError("storage_corrupt")),
            }
        }
    }
    let mut done = HashSet::new();
    for row in &snapshot.derivatives {
        validate_acyclic(row.id.as_str(), snapshot, &mut HashSet::new(), &mut done)?;
    }
    Ok(())
}

fn validate_acyclic(
    id: &str,
    snapshot: &MemorySnapshot,
    path: &mut HashSet<String>,
    done: &mut HashSet<String>,
) -> Result<()> {
    if done.contains(id) {
        return Ok(());
    }
    if !path.insert(id.to_owned()) {
        return Err(StoreError("dependency_cycle"));
    }
    if let Some(row) = snapshot.derivatives.iter().find(|row| row.id == id) {
        for source in &row.sources {
            validate_acyclic(source.id.as_str(), snapshot, path, done)?;
        }
    }
    path.remove(id);
    done.insert(id.to_owned());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn path(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("withu-storage-{name}-{stamp}.sqlite"))
    }
    fn fact(operation: &str, id: &str) -> AuditFact {
        AuditFact {
            schema_version: 1,
            operation: operation.into(),
            object_id: id.into(),
            occurred_at: "2030-01-01T00:00:00Z".into(),
            actor: "synthetic-test".into(),
            result: "accepted".into(),
        }
    }
    fn evidence() -> MemoryEvidenceInput {
        MemoryEvidenceInput {
            id: "evidence-1".into(),
            scope: "scope-a".into(),
            version: 1,
            expected_version: 0,
            body: "{\"schema_version\":1}".into(),
        }
    }

    #[test]
    fn migration_and_atomic_rollback_survive_reopen() {
        let file = path("rollback");
        let mut store = Store::open(&file).unwrap();
        store
            .memory_apply(
                0,
                MemoryMutation::RegisterEvidence(evidence()),
                &fact("evidence.save", "evidence-1"),
            )
            .unwrap();
        store.fail_next_commit();
        let failed = store.memory_apply(
            1,
            MemoryMutation::RegisterEvidence(MemoryEvidenceInput {
                version: 2,
                expected_version: 1,
                body: "{\"revision\":2}".into(),
                ..evidence()
            }),
            &fact("evidence.correct", "evidence-1"),
        );
        assert_eq!(failed.unwrap_err().0, "storage_failure");
        assert_eq!(store.memory_snapshot().unwrap().evidence[0].version, 1);
        drop(store);
        let reopened = Store::open(&file).unwrap();
        assert_eq!(reopened.memory_snapshot().unwrap().state_version, 1);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn newer_schema_fails_closed_without_rewriting_the_file() {
        let file = path("future-schema");
        let db = Connection::open(&file).unwrap();
        db.execute_batch("PRAGMA user_version=99;").unwrap();
        drop(db);
        let error = Store::open(&file).err().expect("future schema must fail");
        assert_eq!(error.0, "storage_schema_unsupported");
        let db = Connection::open(&file).unwrap();
        let version: i64 = db
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 99);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn self_cycle_is_rejected() {
        let file = path("cycle");
        let mut store = Store::open(&file).unwrap();
        store
            .memory_apply(
                0,
                MemoryMutation::RegisterEvidence(evidence()),
                &fact("evidence.save", "evidence-1"),
            )
            .unwrap();
        let result = store.memory_apply(
            1,
            MemoryMutation::AddDerivative(MemoryDerivativeInput {
                id: "cache".into(),
                scope: "scope-a".into(),
                expected_version: 0,
                version: 1,
                body: "{\"schema_version\":1,\"id\":\"cache\",\"kind\":\"derived_context_cache\",\"version\":1,\"source_evidence\":[{\"id\":\"cache\",\"version\":1}]}".into(),
                sources: vec![MemoryLink {
                    id: "cache".into(),
                    version: 1,
                }],
            }),
            &fact("memory.derive", "cache"),
        );
        assert_eq!(result.unwrap_err().0, "dependency_cycle");
        assert!(store.memory_snapshot().unwrap().derivatives.is_empty());
        let _ = std::fs::remove_file(file);
    }
}
