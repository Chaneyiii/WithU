use std::collections::HashSet;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use withu_audit::AuditFact;
use withu_runtime::{EvidenceVersion, MemoryKind};
use withu_storage::{
    MemoryDeleteInput, MemoryDerivativeInput, MemoryEvidenceInput, MemoryLink, MemoryMutation,
    MemoryObjectInput, MemorySnapshot, Store, StoreError,
};

pub const MEMORY_RECORD_SCHEMA_VERSION: u16 = 1;
pub const EVIDENCE_RECORD_SCHEMA_VERSION: u16 = 1;
const MAX_EVIDENCE_CHARS: usize = 2_000;

#[derive(Clone, Debug, PartialEq)]
pub struct MemoryRecord {
    pub schema_version: u16,
    pub id: String,
    pub kind: MemoryKind,
    pub subject: String,
    pub content: String,
    pub observed_at: String,
    pub confidence: f64,
    pub valid_from: String,
    pub valid_to: Option<String>,
    pub status: String,
    pub version: u64,
    pub confirmed: bool,
    pub save_permission: bool,
    pub source_evidence: Vec<EvidenceVersion>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRecord {
    pub schema_version: u16,
    pub id: String,
    pub scope: String,
    pub turn_id: String,
    pub speaker: String,
    pub captured_at: String,
    pub text_excerpt: String,
    pub text_ref: String,
    pub redaction: String,
    pub deleted_at: Option<String>,
    pub version: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DerivedReferenceCache {
    pub id: String,
    pub scope: String,
    pub version: u64,
    pub sources: Vec<EvidenceVersion>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BackgroundMemoryCandidate {
    pub scope: String,
    pub read_state_version: u64,
    pub record: MemoryRecord,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationshipSummaryRecord {
    pub schema_version: u16,
    pub id: String,
    pub time_from: String,
    pub time_to: String,
    pub source_evidence_ids: Vec<String>,
    pub valid_to: String,
    pub version: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoverableItemRecord {
    pub schema_version: u16,
    pub id: String,
    pub accepted_goal: String,
    pub acceptance_evidence_ids: Vec<String>,
    pub conditions: Vec<String>,
    pub status: String,
    pub version: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MemoryExport {
    pub schema_version: u16,
    pub scope: Option<String>,
    pub state_version: u64,
    pub memories: Vec<Value>,
    pub evidence: Vec<Value>,
    pub derivatives: Vec<Value>,
    pub tombstones: Vec<Value>,
}

enum StoreHandle<'a> {
    Owned(Store),
    Borrowed(&'a mut Store),
}

impl std::ops::Deref for StoreHandle<'_> {
    type Target = Store;
    fn deref(&self) -> &Store {
        match self {
            Self::Owned(store) => store,
            Self::Borrowed(store) => store,
        }
    }
}
impl std::ops::DerefMut for StoreHandle<'_> {
    fn deref_mut(&mut self) -> &mut Store {
        match self {
            Self::Owned(store) => store,
            Self::Borrowed(store) => store,
        }
    }
}

pub struct PersistentMemoryStore<'a> {
    store: StoreHandle<'a>,
}

/// Replaceable retrieval boundary. Index adapters receive only scoped canonical
/// memory, never credentials, audio, or current-turn affect candidates.
pub trait MemoryIndex {
    fn retrieve(
        &self,
        store: &PersistentMemoryStore<'_>,
        scope: &str,
        phrase: Option<&str>,
        limit: usize,
        semantic: bool,
    ) -> Result<Vec<Value>, StoreError>;
}

pub struct LocalMemoryIndex;
impl MemoryIndex for LocalMemoryIndex {
    fn retrieve(
        &self,
        store: &PersistentMemoryStore<'_>,
        scope: &str,
        phrase: Option<&str>,
        limit: usize,
        semantic: bool,
    ) -> Result<Vec<Value>, StoreError> {
        if semantic {
            return Err(StoreError("semantic_index_unavailable"));
        }
        store.list_management(scope, phrase, limit)
    }
}

impl<'a> PersistentMemoryStore<'a> {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        Self::from_store(Store::open(path)?)
    }

    pub fn from_store(store: Store) -> Result<Self, StoreError> {
        let result = Self {
            store: StoreHandle::Owned(store),
        };
        result.snapshot()?;
        Ok(result)
    }

    pub fn into_store(self) -> Store {
        match self.store {
            StoreHandle::Owned(store) => store,
            StoreHandle::Borrowed(_) => panic!("cannot take a borrowed store"),
        }
    }

    /// Use the server's exclusive SQLite connection instead of reopening its
    /// locked database. All memory writes retain the same transaction/audit CAS.
    pub fn borrow(store: &'a mut Store) -> Result<Self, StoreError> {
        let result = Self {
            store: StoreHandle::Borrowed(store),
        };
        result.snapshot()?;
        Ok(result)
    }

    pub(crate) fn snapshot(&self) -> Result<MemorySnapshot, StoreError> {
        let snapshot = self.store.memory_snapshot()?;
        validate_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    pub fn state_version(&self) -> Result<u64, StoreError> {
        Ok(self.snapshot()?.state_version)
    }

    /// Persist a short, explicitly permitted evidence excerpt.  Live speech
    /// transcripts and audio are not inputs to this type.
    pub fn save_evidence(
        &mut self,
        record: EvidenceRecord,
        explicit_save_permission: bool,
        expected_state_version: u64,
    ) -> Result<u64, StoreError> {
        validate_evidence(&record, explicit_save_permission)?;
        let body = serde_json::to_string(&record).map_err(|_| StoreError("validation_error"))?;
        self.apply(
            expected_state_version,
            MemoryMutation::RegisterEvidence(MemoryEvidenceInput {
                id: record.id.clone(),
                scope: record.scope.clone(),
                version: record.version,
                expected_version: record.version.saturating_sub(1),
                body,
            }),
            "memory.evidence.save",
            &record.id,
            "user",
        )
    }

    /// Save or correct one canonical fact with global and object-level CAS.
    pub fn save_memory(
        &mut self,
        scope: &str,
        record: MemoryRecord,
        expected_object_version: u64,
        expected_state_version: u64,
    ) -> Result<u64, StoreError> {
        validate_memory(&record, expected_object_version)?;
        let sources = to_storage_links(&record.source_evidence);
        let body = memory_to_value(&record).to_string();
        let mutation = MemoryMutation::UpsertObject(MemoryObjectInput {
            id: record.id.clone(),
            kind: memory_kind_name(record.kind).into(),
            scope: scope.into(),
            expected_version: expected_object_version,
            version: record.version,
            body,
            sources,
        });
        let fact = self.fact(
            if expected_object_version == 0 {
                "memory.save"
            } else {
                "memory.correct"
            },
            &record.id,
            "user",
        );
        self.store
            .memory_apply(expected_state_version, mutation, &fact)
    }

    /// Persist a confirmed evidence fragment and the canonical object in one
    /// SQL transaction. This is the preferred boundary for a UI confirmation.
    pub fn save_memory_with_evidence(
        &mut self,
        evidence: EvidenceRecord,
        record: MemoryRecord,
        explicit_save_permission: bool,
        expected_object_version: u64,
        expected_state_version: u64,
    ) -> Result<u64, StoreError> {
        validate_evidence(&evidence, explicit_save_permission)?;
        if record.source_evidence.len() != 1
            || record.source_evidence[0].id != evidence.id
            || record.source_evidence[0].version != evidence.version
        {
            return Err(StoreError("evidence_version_conflict"));
        }
        validate_memory(&record, expected_object_version)?;
        let facts = [
            self.fact("memory.evidence.save", &evidence.id, "user"),
            self.fact(
                if expected_object_version == 0 {
                    "memory.save"
                } else {
                    "memory.correct"
                },
                &record.id,
                "user",
            ),
        ];
        self.store.memory_apply_batch(
            expected_state_version,
            vec![
                MemoryMutation::RegisterEvidence(MemoryEvidenceInput {
                    id: evidence.id.clone(),
                    scope: evidence.scope.clone(),
                    version: evidence.version,
                    expected_version: evidence.version.saturating_sub(1),
                    body: serde_json::to_string(&evidence)
                        .map_err(|_| StoreError("validation_error"))?,
                }),
                MemoryMutation::UpsertObject(MemoryObjectInput {
                    id: record.id.clone(),
                    kind: memory_kind_name(record.kind).into(),
                    scope: evidence.scope,
                    expected_version: expected_object_version,
                    version: record.version,
                    body: memory_to_value(&record).to_string(),
                    sources: to_storage_links(&record.source_evidence),
                }),
            ],
            &facts,
        )
    }

    pub fn prepare_background_candidate(
        &self,
        scope: &str,
        record: MemoryRecord,
    ) -> Result<BackgroundMemoryCandidate, StoreError> {
        validate_memory(&record, record.version.saturating_sub(1))?;
        Ok(BackgroundMemoryCandidate {
            scope: scope.into(),
            read_state_version: self.state_version()?,
            record,
        })
    }

    pub fn commit_background_candidate(
        &mut self,
        candidate: BackgroundMemoryCandidate,
    ) -> Result<u64, StoreError> {
        self.save_memory(
            &candidate.scope,
            candidate.record.clone(),
            candidate.record.version.saturating_sub(1),
            candidate.read_state_version,
        )
    }

    /// Persist a cache of references only. No unconfirmed text or arbitrary
    /// payload can enter canonical memory through a derived index.
    pub fn add_reference_cache(
        &mut self,
        scope: &str,
        id: &str,
        sources: Vec<EvidenceVersion>,
        expected_state_version: u64,
    ) -> Result<u64, StoreError> {
        unique_links(&sources)?;
        let body = json!({
            "schema_version": 1,
            "id": id,
            "kind": "derived_context_cache",
            "version": 1,
            "source_evidence": evidence_links_value(&sources),
        });
        self.apply(
            expected_state_version,
            MemoryMutation::AddDerivative(MemoryDerivativeInput {
                id: id.into(),
                scope: scope.into(),
                expected_version: 0,
                version: 1,
                body: body.to_string(),
                sources: to_storage_links(&sources),
            }),
            "memory.derive",
            id,
            "rules",
        )
    }

    pub fn save_relationship_summary(
        &mut self,
        scope: &str,
        record: RelationshipSummaryRecord,
        sources: Vec<EvidenceVersion>,
        explicit_save_permission: bool,
        expected_object_version: u64,
        expected_state_version: u64,
    ) -> Result<u64, StoreError> {
        if !explicit_save_permission {
            return Err(StoreError("memory_not_eligible"));
        }
        validate_summary(&record, &sources)?;
        self.apply(
            expected_state_version,
            MemoryMutation::UpsertObject(MemoryObjectInput {
                id: record.id.clone(),
                kind: "relationship_summary".into(),
                scope: scope.into(),
                expected_version: expected_object_version,
                version: record.version,
                body: serde_json::to_string(&record).map_err(|_| StoreError("validation_error"))?,
                sources: to_storage_links(&sources),
            }),
            "memory.summary.save",
            &record.id,
            "user",
        )
    }

    pub fn save_recoverable_item(
        &mut self,
        scope: &str,
        record: RecoverableItemRecord,
        sources: Vec<EvidenceVersion>,
        explicit_save_permission: bool,
        expected_object_version: u64,
        expected_state_version: u64,
    ) -> Result<u64, StoreError> {
        if !explicit_save_permission {
            return Err(StoreError("memory_not_eligible"));
        }
        validate_recoverable(&record, &sources)?;
        self.apply(
            expected_state_version,
            MemoryMutation::UpsertObject(MemoryObjectInput {
                id: record.id.clone(),
                kind: "recoverable_item".into(),
                scope: scope.into(),
                expected_version: expected_object_version,
                version: record.version,
                body: serde_json::to_string(&record).map_err(|_| StoreError("validation_error"))?,
                sources: to_storage_links(&sources),
            }),
            "memory.recoverable.save",
            &record.id,
            "user",
        )
    }

    pub fn get_memory(&self, scope: &str, id: &str) -> Result<Option<MemoryRecord>, StoreError> {
        let snapshot = self.snapshot()?;
        let row = snapshot
            .objects
            .iter()
            .find(|row| row.id == id && row.scope == scope && is_memory_kind(&row.kind));
        let Some(row) = row else { return Ok(None) };
        if !visible_memory(row, &snapshot) {
            return Ok(None);
        }
        value_to_memory(&row.body).map(Some)
    }

    pub fn list_memories(&self, scope: &str) -> Result<Vec<MemoryRecord>, StoreError> {
        let snapshot = self.snapshot()?;
        snapshot
            .objects
            .iter()
            .filter(|row| {
                row.scope == scope && is_memory_kind(&row.kind) && visible_memory(row, &snapshot)
            })
            .map(|row| value_to_memory(&row.body))
            .collect()
    }

    pub fn get_relationship_summary(
        &self,
        scope: &str,
        id: &str,
    ) -> Result<Option<RelationshipSummaryRecord>, StoreError> {
        let snapshot = self.snapshot()?;
        let Some(row) = snapshot
            .objects
            .iter()
            .find(|row| row.id == id && row.scope == scope && row.kind == "relationship_summary")
        else {
            return Ok(None);
        };
        if !visible_memory(row, &snapshot) {
            return Ok(None);
        }
        let summary: RelationshipSummaryRecord =
            serde_json::from_str(&row.body).map_err(|_| StoreError("storage_corrupt"))?;
        validate_summary(&summary, &to_evidence_links(&row.sources))
            .map_err(|_| StoreError("storage_corrupt"))?;
        Ok(Some(summary))
    }

    pub fn get_recoverable_item(
        &self,
        scope: &str,
        id: &str,
    ) -> Result<Option<RecoverableItemRecord>, StoreError> {
        let snapshot = self.snapshot()?;
        let Some(row) = snapshot
            .objects
            .iter()
            .find(|row| row.id == id && row.scope == scope && row.kind == "recoverable_item")
        else {
            return Ok(None);
        };
        if !visible_memory(row, &snapshot) {
            return Ok(None);
        }
        let item: RecoverableItemRecord =
            serde_json::from_str(&row.body).map_err(|_| StoreError("storage_corrupt"))?;
        validate_recoverable(&item, &to_evidence_links(&row.sources))
            .map_err(|_| StoreError("storage_corrupt"))?;
        Ok(Some(item))
    }

    /// Exact phrase lookup is intentionally local and scope-bound; it makes no
    /// semantic inference and is suitable for user review/manage flows.
    pub fn find_exact(&self, scope: &str, phrase: &str) -> Result<Vec<MemoryRecord>, StoreError> {
        if phrase.trim().is_empty() {
            return Err(StoreError("validation_error"));
        }
        let needle = phrase.to_lowercase();
        Ok(self
            .list_memories(scope)?
            .into_iter()
            .filter(|record| {
                record.subject.to_lowercase().contains(&needle)
                    || record.content.to_lowercase().contains(&needle)
            })
            .collect())
    }

    /// Return the management projection used by the server/UI. The projection
    /// keeps the canonical record, object version, scope and its typed evidence
    /// together so a caller cannot accidentally display an unscoped source.
    pub fn list_management(
        &self,
        scope: &str,
        phrase: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Value>, StoreError> {
        if scope.trim().is_empty() || limit == 0 || limit > 100 {
            return Err(StoreError("validation_error"));
        }
        let records = match phrase.map(str::trim).filter(|value| !value.is_empty()) {
            Some(phrase) => self.find_exact(scope, phrase)?,
            None => self.list_memories(scope)?,
        };
        records
            .into_iter()
            .take(limit)
            .map(|record| self.management_row(scope, &record))
            .collect()
    }

    /// The canonical management-context row for one record: scope, version,
    /// record body and its evidence chain. Shared by the exact path and the
    /// derived semantic index so both always project identical row shapes.
    pub(crate) fn management_row(
        &self,
        scope: &str,
        record: &MemoryRecord,
    ) -> Result<Value, StoreError> {
        let evidence = record
            .source_evidence
            .iter()
            .filter_map(|source| self.get_evidence(scope, &source.id).transpose())
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|item| serde_json::to_value(item).map_err(|_| StoreError("storage_corrupt")))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(json!({
            "scope": scope,
            "object_version": record.version,
            "record": memory_to_value(&record),
            "evidence": evidence,
        }))
    }

    /// Load a bounded context projection. This is deliberately exact/local;
    /// semantic indexing is a replaceable future service and is not implied by
    /// this method.
    pub fn load_context(
        &self,
        scope: &str,
        phrase: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Value>, StoreError> {
        self.load_index_context(&LocalMemoryIndex, scope, phrase, limit, false)
    }

    pub fn load_index_context(
        &self,
        index: &dyn MemoryIndex,
        scope: &str,
        phrase: Option<&str>,
        limit: usize,
        semantic: bool,
    ) -> Result<Vec<Value>, StoreError> {
        if scope.trim().is_empty() || limit == 0 || limit > 100 {
            return Err(StoreError("validation_error"));
        }
        index.retrieve(self, scope, phrase, limit, semantic)
    }

    /// Compute the rows that would lose visibility if a node is tombstoned.
    /// Deletion itself remains an atomic storage operation.
    pub fn deletion_impact(
        &self,
        scope: &str,
        target_type: &str,
        id: &str,
    ) -> Result<Value, StoreError> {
        if scope.trim().is_empty() || id.trim().is_empty() {
            return Err(StoreError("validation_error"));
        }
        if !["memory", "evidence", "derivative"].contains(&target_type) {
            return Err(StoreError("validation_error"));
        }
        let snapshot = self.snapshot()?;
        let mut invalid = HashSet::from([id.to_owned()]);
        if target_type == "memory" {
            if let Some(row) = snapshot
                .objects
                .iter()
                .find(|row| row.id == id && row.scope == scope)
            {
                invalid.extend(row.sources.iter().map(|source| source.id.clone()));
            }
        }
        loop {
            let before = invalid.len();
            for row in &snapshot.objects {
                if row.scope == scope
                    && row
                        .sources
                        .iter()
                        .any(|source| invalid.contains(&source.id))
                {
                    invalid.insert(row.id.clone());
                }
            }
            for row in &snapshot.derivatives {
                if row.scope == scope
                    && row
                        .sources
                        .iter()
                        .any(|source| invalid.contains(&source.id))
                {
                    invalid.insert(row.id.clone());
                }
            }
            if before == invalid.len() {
                break;
            }
        }
        let mut impacted = Vec::new();
        for row in &snapshot.objects {
            if row.scope == scope && invalid.contains(&row.id) {
                impacted
                    .push(json!({"target_type":"memory","id":row.id,"object_version":row.version}));
            }
        }
        for row in &snapshot.evidence {
            if row.scope == scope && invalid.contains(&row.id) {
                impacted.push(
                    json!({"target_type":"evidence","id":row.id,"object_version":row.version}),
                );
            }
        }
        for row in &snapshot.derivatives {
            if row.scope == scope && invalid.contains(&row.id) {
                impacted.push(
                    json!({"target_type":"derivative","id":row.id,"object_version":row.version}),
                );
            }
        }
        Ok(json!({
            "scope": scope,
            "target_type": target_type,
            "target_id": id,
            "items": impacted,
            "count": impacted.len(),
        }))
    }

    pub fn memory_value(record: &MemoryRecord) -> Value {
        memory_to_value(record)
    }

    pub fn memory_from_value(value: &Value) -> Result<MemoryRecord, StoreError> {
        value_to_memory(&value.to_string())
    }

    pub fn evidence_value(record: &EvidenceRecord) -> Result<Value, StoreError> {
        serde_json::to_value(record).map_err(|_| StoreError("validation_error"))
    }

    pub fn evidence_from_value(value: &Value) -> Result<EvidenceRecord, StoreError> {
        serde_json::from_value(value.clone()).map_err(|_| StoreError("validation_error"))
    }

    pub fn get_evidence(
        &self,
        scope: &str,
        id: &str,
    ) -> Result<Option<EvidenceRecord>, StoreError> {
        let snapshot = self.snapshot()?;
        let Some(row) = snapshot
            .evidence
            .iter()
            .find(|row| row.id == id && row.scope == scope)
        else {
            return Ok(None);
        };
        serde_json::from_str(&row.body)
            .map(Some)
            .map_err(|_| StoreError("storage_corrupt"))
    }

    pub fn list_reference_cache(
        &self,
        scope: &str,
    ) -> Result<Vec<DerivedReferenceCache>, StoreError> {
        let snapshot = self.snapshot()?;
        snapshot
            .derivatives
            .iter()
            .filter(|row| {
                row.scope == scope
                    && visible_node(row.id.as_str(), scope, &snapshot, &mut HashSet::new())
            })
            .filter_map(|row| {
                let body = match parse_safe_value(&row.body) {
                    Ok(body) => body,
                    Err(error) => return Some(Err(error)),
                };
                if body["kind"].as_str() != Some("derived_context_cache") {
                    return None;
                }
                let sources = match value_to_links(&body["source_evidence"]) {
                    Ok(sources) => sources,
                    Err(error) => return Some(Err(error)),
                };
                Some(Ok(DerivedReferenceCache {
                    id: row.id.clone(),
                    scope: row.scope.clone(),
                    version: row.version,
                    sources,
                }))
            })
            .collect()
    }

    pub fn delete(
        &mut self,
        scope: &str,
        id: &str,
        target_type: &str,
        expected_object_version: u64,
        expected_state_version: u64,
        sync_protection_token: &str,
    ) -> Result<u64, StoreError> {
        if sync_protection_token.is_empty() {
            return Err(StoreError("validation_error"));
        }
        self.apply(
            expected_state_version,
            MemoryMutation::Delete(MemoryDeleteInput {
                target_type: target_type.into(),
                id: id.into(),
                scope: scope.into(),
                expected_version: expected_object_version,
                created_at: timestamp(),
                source: "user_request".into(),
                sync_protection_token: sync_protection_token.into(),
            }),
            "memory.delete",
            id,
            "user",
        )
    }

    /// Export only typed canonical memory/evidence/derived rows.  The record
    /// schemas have no credential or audio fields; a recursive deny-list is a
    /// second guard at the export boundary.
    pub fn export(&self) -> Result<MemoryExport, StoreError> {
        self.export_inner(None)
    }

    pub fn export_scope(&self, scope: &str) -> Result<MemoryExport, StoreError> {
        if scope.is_empty() {
            return Err(StoreError("validation_error"));
        }
        self.export_inner(Some(scope))
    }

    fn export_inner(&self, scope: Option<&str>) -> Result<MemoryExport, StoreError> {
        let snapshot = self.snapshot()?;
        let memories =
            snapshot
                .objects
                .iter()
                .filter(|row| {
                    scope.is_none_or(|scope| row.scope == scope)
                        && visible_memory(row, &snapshot)
                        && row.kind != "derived_context_cache"
                })
                .map(|row| {
                    parse_safe_value(&row.body).map(|record| json!({
                    "scope": row.scope,
                    "object_version": row.version,
                    "source_evidence": evidence_links_value(&to_evidence_links(&row.sources)),
                    "record": record
                }))
                })
                .collect::<Result<_, _>>()?;
        let evidence = snapshot
            .evidence
            .iter()
            .filter(|row| scope.is_none_or(|scope| row.scope == scope))
            .map(|row| parse_safe_value(&row.body))
            .collect::<Result<_, _>>()?;
        let derivatives = snapshot
            .derivatives
            .iter()
            .filter(|row| {
                scope.is_none_or(|scope| row.scope == scope)
                    && visible_node(row.id.as_str(), &row.scope, &snapshot, &mut HashSet::new())
            })
            .map(|row| {
                parse_safe_value(&row.body).map(|record| json!({"scope":row.scope,"record":record}))
            })
            .collect::<Result<_, _>>()?;
        let tombstones = snapshot
            .tombstones
            .iter()
            .filter(|row| scope.is_none_or(|scope| row.scope == scope))
            .map(|row| {
                json!({
                    "schema_version": 1,
                    "target_type": row.target_type,
                    "target_id": row.id,
                    "scope": row.scope,
                    "deleted_version": row.deleted_version,
                    "created_at": row.created_at,
                    "source": row.source,
                    "sync_protection_token": row.sync_protection_token,
                })
            })
            .collect();
        let result = MemoryExport {
            schema_version: 1,
            scope: scope.map(str::to_owned),
            state_version: snapshot.state_version,
            memories,
            evidence,
            derivatives,
            tombstones,
        };
        let value = serde_json::to_value(&result).map_err(|_| StoreError("storage_corrupt"))?;
        if has_protected_fields(&value) {
            return Err(StoreError("export_sensitive_field"));
        }
        Ok(result)
    }

    pub fn fail_next_commit(&mut self) {
        self.store.fail_next_commit();
    }

    fn apply(
        &mut self,
        expected_state_version: u64,
        mutation: MemoryMutation,
        operation: &str,
        id: &str,
        actor: &str,
    ) -> Result<u64, StoreError> {
        self.store.memory_apply(
            expected_state_version,
            mutation,
            &AuditFact {
                schema_version: 1,
                operation: operation.into(),
                object_id: id.into(),
                occurred_at: timestamp(),
                actor: actor.into(),
                result: "committed".into(),
            },
        )
    }

    fn fact(&self, operation: &str, id: &str, actor: &str) -> AuditFact {
        AuditFact {
            schema_version: 1,
            operation: operation.into(),
            object_id: id.into(),
            occurred_at: timestamp(),
            actor: actor.into(),
            result: "committed".into(),
        }
    }
}

fn validate_memory(record: &MemoryRecord, expected_version: u64) -> Result<(), StoreError> {
    if expected_version.checked_add(1) != Some(record.version) {
        return Err(StoreError("version_conflict"));
    }
    if record.schema_version != MEMORY_RECORD_SCHEMA_VERSION
        || record.id.is_empty()
        || record.subject.trim().is_empty()
        || record.content.trim().is_empty()
        || record.observed_at.is_empty()
        || record.valid_from.is_empty()
        || record.status != "active"
        || record.version == 0
        || !record.confirmed
        || !record.save_permission
        || !record.confidence.is_finite()
        || !(0.0..=1.0).contains(&record.confidence)
        || record.source_evidence.is_empty()
    {
        return Err(StoreError("memory_not_eligible"));
    }
    unique_links(&record.source_evidence)?;
    if has_protected_fields(&memory_to_value(record)) {
        return Err(StoreError("memory_sensitive_field"));
    }
    Ok(())
}

fn validate_evidence(record: &EvidenceRecord, permission: bool) -> Result<(), StoreError> {
    if record.schema_version != EVIDENCE_RECORD_SCHEMA_VERSION
        || !permission
        || record.id.is_empty()
        || record.scope.is_empty()
        || record.turn_id.is_empty()
        || record.speaker != "user"
        || record.captured_at.is_empty()
        || record.text_excerpt.trim().is_empty()
        || record.text_excerpt.chars().count() > MAX_EVIDENCE_CHARS
        || record.text_ref.is_empty()
        || record.text_ref.to_ascii_lowercase().contains("audio")
        || record.text_ref.to_ascii_lowercase().contains("pcm")
        || record.text_ref.to_ascii_lowercase().contains("wav")
        || record.redaction.is_empty()
        || record.deleted_at.is_some()
        || record.version == 0
    {
        return Err(StoreError("evidence_not_eligible"));
    }
    let value = serde_json::to_value(record).map_err(|_| StoreError("validation_error"))?;
    if has_protected_fields(&value) {
        return Err(StoreError("evidence_sensitive_field"));
    }
    Ok(())
}

fn validate_summary(
    record: &RelationshipSummaryRecord,
    sources: &[EvidenceVersion],
) -> Result<(), StoreError> {
    if record.schema_version != 1
        || record.id.is_empty()
        || record.time_from.is_empty()
        || record.time_to.is_empty()
        || record.valid_to.is_empty()
        || record.version == 0
        || record.source_evidence_ids
            != sources
                .iter()
                .map(|source| source.id.clone())
                .collect::<Vec<_>>()
    {
        return Err(StoreError("relationship_summary_invalid"));
    }
    unique_links(sources)?;
    if has_protected_fields(
        &serde_json::to_value(record).map_err(|_| StoreError("validation_error"))?,
    ) {
        return Err(StoreError("memory_sensitive_field"));
    }
    Ok(())
}

fn validate_recoverable(
    record: &RecoverableItemRecord,
    sources: &[EvidenceVersion],
) -> Result<(), StoreError> {
    if record.schema_version != 1
        || record.id.is_empty()
        || record.accepted_goal.trim().is_empty()
        || record.acceptance_evidence_ids
            != sources
                .iter()
                .map(|source| source.id.clone())
                .collect::<Vec<_>>()
        || record.acceptance_evidence_ids.is_empty()
        || !matches!(
            record.status.as_str(),
            "accepted" | "paused" | "cancelled" | "completed"
        )
        || record.version == 0
    {
        return Err(StoreError("recoverable_item_invalid"));
    }
    unique_links(sources)?;
    if has_protected_fields(
        &serde_json::to_value(record).map_err(|_| StoreError("validation_error"))?,
    ) {
        return Err(StoreError("memory_sensitive_field"));
    }
    Ok(())
}

fn validate_snapshot(snapshot: &MemorySnapshot) -> Result<(), StoreError> {
    for row in &snapshot.evidence {
        let evidence: EvidenceRecord =
            serde_json::from_str(&row.body).map_err(|_| StoreError("storage_corrupt"))?;
        if evidence.id != row.id || evidence.scope != row.scope || evidence.version != row.version {
            return Err(StoreError("storage_corrupt"));
        }
        validate_evidence(&evidence, true).map_err(|_| StoreError("storage_corrupt"))?;
    }
    for row in &snapshot.objects {
        let links = to_evidence_links(&row.sources);
        match row.kind.as_str() {
            "stable_fact" | "explicit_preference" | "explicit_experience" => {
                let record = value_to_memory(&row.body)?;
                if record.id != row.id
                    || record.version != row.version
                    || record.source_evidence != links
                {
                    return Err(StoreError("storage_corrupt"));
                }
                validate_memory(&record, row.version.saturating_sub(1))?;
            }
            "relationship_summary" => {
                let record: RelationshipSummaryRecord =
                    serde_json::from_str(&row.body).map_err(|_| StoreError("storage_corrupt"))?;
                if record.id != row.id || record.version != row.version {
                    return Err(StoreError("storage_corrupt"));
                }
                validate_summary(&record, &links).map_err(|_| StoreError("storage_corrupt"))?;
            }
            "recoverable_item" => {
                let record: RecoverableItemRecord =
                    serde_json::from_str(&row.body).map_err(|_| StoreError("storage_corrupt"))?;
                if record.id != row.id || record.version != row.version {
                    return Err(StoreError("storage_corrupt"));
                }
                validate_recoverable(&record, &links).map_err(|_| StoreError("storage_corrupt"))?;
            }
            _ => return Err(StoreError("storage_corrupt")),
        }
    }
    for row in &snapshot.derivatives {
        let body = parse_safe_value(&row.body)?;
        if body["id"].as_str() != Some(row.id.as_str())
            || body["kind"].as_str() != Some("derived_context_cache")
            || row.version != 1
        {
            return Err(StoreError("storage_corrupt"));
        }
        if value_to_links(&body["source_evidence"])? != to_evidence_links(&row.sources) {
            return Err(StoreError("storage_corrupt"));
        }
    }
    Ok(())
}

fn unique_links(links: &[EvidenceVersion]) -> Result<(), StoreError> {
    let mut ids = HashSet::new();
    if links.is_empty()
        || links
            .iter()
            .any(|link| link.id.is_empty() || link.version == 0 || !ids.insert(link.id.as_str()))
    {
        return Err(StoreError("evidence_invalid"));
    }
    Ok(())
}

fn to_evidence_links(links: &[MemoryLink]) -> Vec<EvidenceVersion> {
    links
        .iter()
        .map(|link| EvidenceVersion {
            id: link.id.clone(),
            version: link.version,
        })
        .collect()
}

pub(crate) fn is_memory_kind(kind: &str) -> bool {
    matches!(
        kind,
        "stable_fact" | "explicit_preference" | "explicit_experience"
    )
}

fn memory_kind_name(kind: MemoryKind) -> &'static str {
    match kind {
        MemoryKind::StableFact => "stable_fact",
        MemoryKind::ExplicitPreference => "explicit_preference",
        MemoryKind::ExplicitExperience => "explicit_experience",
    }
}

fn parse_memory_kind(value: &str) -> Result<MemoryKind, StoreError> {
    match value {
        "stable_fact" => Ok(MemoryKind::StableFact),
        "explicit_preference" => Ok(MemoryKind::ExplicitPreference),
        "explicit_experience" => Ok(MemoryKind::ExplicitExperience),
        _ => Err(StoreError("storage_corrupt")),
    }
}

fn evidence_links_value(links: &[EvidenceVersion]) -> Value {
    Value::Array(
        links
            .iter()
            .map(|link| json!({"id":link.id,"version":link.version}))
            .collect(),
    )
}

fn to_storage_links(links: &[EvidenceVersion]) -> Vec<MemoryLink> {
    links
        .iter()
        .map(|link| MemoryLink {
            id: link.id.clone(),
            version: link.version,
        })
        .collect()
}

pub(crate) fn memory_to_value(record: &MemoryRecord) -> Value {
    json!({
        "schema_version": record.schema_version,
        "id": record.id,
        "kind": memory_kind_name(record.kind),
        "subject": record.subject,
        "content": record.content,
        "observed_at": record.observed_at,
        "confidence": record.confidence,
        "valid_from": record.valid_from,
        "valid_to": record.valid_to,
        "status": record.status,
        "version": record.version,
        "confirmed": record.confirmed,
        "save_permission": record.save_permission,
        "source_evidence": evidence_links_value(&record.source_evidence),
    })
}

pub(crate) fn value_to_memory(raw: &str) -> Result<MemoryRecord, StoreError> {
    let value: Value = serde_json::from_str(raw).map_err(|_| StoreError("storage_corrupt"))?;
    if has_protected_fields(&value) {
        return Err(StoreError("storage_corrupt"));
    }
    let source_evidence = value["source_evidence"]
        .as_array()
        .ok_or(StoreError("storage_corrupt"))?
        .iter()
        .map(|link| {
            Ok(EvidenceVersion {
                id: link["id"]
                    .as_str()
                    .ok_or(StoreError("storage_corrupt"))?
                    .into(),
                version: link["version"]
                    .as_u64()
                    .ok_or(StoreError("storage_corrupt"))?,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    Ok(MemoryRecord {
        schema_version: value["schema_version"]
            .as_u64()
            .ok_or(StoreError("storage_corrupt"))? as u16,
        id: value["id"]
            .as_str()
            .ok_or(StoreError("storage_corrupt"))?
            .into(),
        kind: parse_memory_kind(
            value["kind"]
                .as_str()
                .ok_or(StoreError("storage_corrupt"))?,
        )?,
        subject: value["subject"]
            .as_str()
            .ok_or(StoreError("storage_corrupt"))?
            .into(),
        content: value["content"]
            .as_str()
            .ok_or(StoreError("storage_corrupt"))?
            .into(),
        observed_at: value["observed_at"]
            .as_str()
            .ok_or(StoreError("storage_corrupt"))?
            .into(),
        confidence: value["confidence"]
            .as_f64()
            .ok_or(StoreError("storage_corrupt"))?,
        valid_from: value["valid_from"]
            .as_str()
            .ok_or(StoreError("storage_corrupt"))?
            .into(),
        valid_to: value["valid_to"].as_str().map(str::to_owned),
        status: value["status"]
            .as_str()
            .ok_or(StoreError("storage_corrupt"))?
            .into(),
        version: value["version"]
            .as_u64()
            .ok_or(StoreError("storage_corrupt"))?,
        confirmed: value["confirmed"]
            .as_bool()
            .ok_or(StoreError("storage_corrupt"))?,
        save_permission: value["save_permission"]
            .as_bool()
            .ok_or(StoreError("storage_corrupt"))?,
        source_evidence,
    })
}

fn value_to_links(value: &Value) -> Result<Vec<EvidenceVersion>, StoreError> {
    value
        .as_array()
        .ok_or(StoreError("storage_corrupt"))?
        .iter()
        .map(|link| {
            Ok(EvidenceVersion {
                id: link["id"]
                    .as_str()
                    .ok_or(StoreError("storage_corrupt"))?
                    .into(),
                version: link["version"]
                    .as_u64()
                    .ok_or(StoreError("storage_corrupt"))?,
            })
        })
        .collect()
}

fn parse_safe_value(raw: &str) -> Result<Value, StoreError> {
    let value: Value = serde_json::from_str(raw).map_err(|_| StoreError("storage_corrupt"))?;
    if has_protected_fields(&value) {
        return Err(StoreError("storage_corrupt"));
    }
    Ok(value)
}

fn has_protected_fields(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            let key = key.to_ascii_lowercase().replace(['-', ' '], "_");
            matches!(
                key.as_str(),
                "credential"
                    | "credentials"
                    | "credential_ref"
                    | "credential_refs"
                    | "api_key"
                    | "secret"
                    | "access_token"
                    | "refresh_token"
                    | "raw_audio"
                    | "audio"
                    | "audio_base64"
                    | "audio_bytes"
                    | "pcm"
                    | "wav"
            ) || has_protected_fields(value)
        }),
        Value::Array(values) => values.iter().any(has_protected_fields),
        _ => false,
    }
}

pub(crate) fn visible_memory(
    row: &withu_storage::MemoryObjectRow,
    snapshot: &MemorySnapshot,
) -> bool {
    if snapshot
        .tombstones
        .iter()
        .any(|tombstone| tombstone.id == row.id)
    {
        return false;
    }
    !row.sources.is_empty()
        && row.sources.iter().all(|source| {
            snapshot.evidence.iter().any(|evidence| {
                evidence.id == source.id
                    && evidence.version == source.version
                    && evidence.scope == row.scope
            })
        })
}

fn visible_node(
    id: &str,
    scope: &str,
    snapshot: &MemorySnapshot,
    path: &mut HashSet<String>,
) -> bool {
    if !path.insert(id.into())
        || snapshot
            .tombstones
            .iter()
            .any(|tombstone| tombstone.id == id)
    {
        return false;
    }
    let visible = if let Some(evidence) = snapshot.evidence.iter().find(|row| row.id == id) {
        evidence.scope == scope
    } else if let Some(memory) = snapshot.objects.iter().find(|row| row.id == id) {
        memory.scope == scope
            && !memory.sources.is_empty()
            && memory.sources.iter().all(|source| {
                snapshot
                    .evidence
                    .iter()
                    .find(|row| row.id == source.id)
                    .is_some_and(|evidence| {
                        evidence.scope == scope && evidence.version == source.version
                    })
            })
    } else if let Some(derived) = snapshot.derivatives.iter().find(|row| row.id == id) {
        derived.scope == scope
            && !derived.sources.is_empty()
            && derived.sources.iter().all(|source| {
                let current_version = snapshot
                    .evidence
                    .iter()
                    .find(|row| row.id == source.id)
                    .map(|row| (row.scope.as_str(), row.version))
                    .or_else(|| {
                        snapshot
                            .objects
                            .iter()
                            .find(|row| row.id == source.id)
                            .map(|row| (row.scope.as_str(), row.version))
                    })
                    .or_else(|| {
                        snapshot
                            .derivatives
                            .iter()
                            .find(|row| row.id == source.id)
                            .map(|row| (row.scope.as_str(), row.version))
                    });
                current_version.is_some_and(|(current_scope, version)| {
                    current_scope == scope && version == source.version
                }) && visible_node(source.id.as_str(), scope, snapshot, path)
            })
    } else {
        false
    };
    path.remove(id);
    visible
}

fn timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("unix-ms:{millis}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn borrowed_owner_connection_and_replaceable_local_index_preserve_canonical_guards() {
        let file = path("borrowed-index");
        let mut owner = Store::open(&file).unwrap();
        {
            let mut memory = PersistentMemoryStore::borrow(&mut owner).unwrap();
            let revision = seed(&mut memory, "comfort", "borrowed-evidence");
            memory
                .save_memory(
                    "comfort",
                    record("borrowed-memory", "borrowed-evidence", 1, 1),
                    0,
                    revision,
                )
                .unwrap();
            let index: &dyn MemoryIndex = &LocalMemoryIndex;
            let result = memory
                .load_index_context(index, "comfort", Some("river"), 1, false)
                .unwrap();
            assert_eq!(result.len(), 1);
            assert_eq!(result[0]["evidence"][0]["scope"], "comfort");
            assert!(memory
                .load_index_context(index, "cowork:other", None, 1, false)
                .unwrap()
                .is_empty());
            assert_eq!(
                memory
                    .load_index_context(index, "comfort", Some("river"), 1, true)
                    .unwrap_err()
                    .0,
                "semantic_index_unavailable"
            );
        }
        assert_eq!(owner.memory_snapshot().unwrap().objects.len(), 1);
    }

    fn path(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("withu-memory-{name}-{stamp}.sqlite"))
    }

    fn evidence(id: &str, scope: &str, version: u64, text: &str) -> EvidenceRecord {
        EvidenceRecord {
            schema_version: 1,
            id: id.into(),
            scope: scope.into(),
            turn_id: format!("turn-{id}"),
            speaker: "user".into(),
            captured_at: "2030-01-01T00:00:00Z".into(),
            text_excerpt: text.into(),
            text_ref: format!("evidence://{id}"),
            redaction: "none".into(),
            deleted_at: None,
            version,
        }
    }

    fn record(id: &str, evidence_id: &str, evidence_version: u64, version: u64) -> MemoryRecord {
        MemoryRecord {
            schema_version: 1,
            id: id.into(),
            kind: MemoryKind::ExplicitExperience,
            subject: "weekend walk".into(),
            content: "User enjoys a quiet walk by the river.".into(),
            observed_at: "2030-01-01T00:00:00Z".into(),
            confidence: 1.0,
            valid_from: "2030-01-01".into(),
            valid_to: None,
            status: "active".into(),
            version,
            confirmed: true,
            save_permission: true,
            source_evidence: vec![EvidenceVersion {
                id: evidence_id.into(),
                version: evidence_version,
            }],
        }
    }

    fn seed(store: &mut PersistentMemoryStore, scope: &str, id: &str) -> u64 {
        let current = store.state_version().unwrap();
        store
            .save_evidence(
                evidence(id, scope, 1, "I enjoy a river walk."),
                true,
                current,
            )
            .unwrap()
    }

    #[test]
    fn saves_reads_and_exact_search_are_scope_bound_and_recover_after_restart() {
        let file = path("read-restart");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(&mut store, "comfort", "evidence-a");
        let revision = store
            .save_memory(
                "comfort",
                record("memory-a", "evidence-a", 1, 1),
                0,
                revision,
            )
            .unwrap();
        assert_eq!(
            store
                .get_memory("comfort", "memory-a")
                .unwrap()
                .unwrap()
                .content,
            "User enjoys a quiet walk by the river."
        );
        assert_eq!(store.find_exact("comfort", "river").unwrap().len(), 1);
        assert!(store
            .get_memory("cowork:project-1", "memory-a")
            .unwrap()
            .is_none());
        drop(store);
        let reopened = PersistentMemoryStore::open(&file).unwrap();
        assert_eq!(reopened.state_version().unwrap(), revision);
        assert_eq!(reopened.list_memories("comfort").unwrap().len(), 1);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn confirmed_memory_and_evidence_commit_as_one_transaction() {
        let file = path("joint-save");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let evidence = evidence("evidence-joint", "comfort", 1, "I like quiet mornings.");
        let revision = store.state_version().unwrap();
        let next = store
            .save_memory_with_evidence(
                evidence,
                record("memory-joint", "evidence-joint", 1, 1),
                true,
                0,
                revision,
            )
            .unwrap();
        assert_eq!(next, 1);
        assert!(store
            .get_evidence("comfort", "evidence-joint")
            .unwrap()
            .is_some());
        assert!(store
            .get_memory("comfort", "memory-joint")
            .unwrap()
            .is_some());
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn fixed_summary_and_recoverable_dtos_round_trip_without_arbitrary_payloads() {
        let file = path("derived-dtos");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(&mut store, "comfort", "evidence-dto");
        let source = vec![EvidenceVersion {
            id: "evidence-dto".into(),
            version: 1,
        }];
        let revision = store
            .save_relationship_summary(
                "comfort",
                RelationshipSummaryRecord {
                    schema_version: 1,
                    id: "summary-dto".into(),
                    time_from: "2030-01-01".into(),
                    time_to: "2030-01-02".into(),
                    source_evidence_ids: vec!["evidence-dto".into()],
                    valid_to: "2030-02-01".into(),
                    version: 1,
                },
                source.clone(),
                true,
                0,
                revision,
            )
            .unwrap();
        assert!(store
            .get_relationship_summary("comfort", "summary-dto")
            .unwrap()
            .is_some());
        let _revision = store
            .save_recoverable_item(
                "comfort",
                RecoverableItemRecord {
                    schema_version: 1,
                    id: "item-dto".into(),
                    accepted_goal: "remember the next check-in".into(),
                    acceptance_evidence_ids: vec!["evidence-dto".into()],
                    conditions: vec!["user asks to resume".into()],
                    status: "accepted".into(),
                    version: 1,
                },
                source,
                true,
                0,
                revision,
            )
            .unwrap();
        assert!(store
            .get_recoverable_item("comfort", "item-dto")
            .unwrap()
            .is_some());
        assert!(store.list_memories("comfort").unwrap().is_empty());
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn rejects_missing_permission_hypothesis_shape_and_stale_background_revision() {
        let file = path("permission-stale");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(&mut store, "comfort", "evidence-a");
        let mut denied = record("denied", "evidence-a", 1, 1);
        denied.save_permission = false;
        assert_eq!(
            store
                .save_memory("comfort", denied, 0, revision)
                .unwrap_err()
                .0,
            "memory_not_eligible"
        );
        let mut hypothesis = record("hypothesis", "evidence-a", 1, 1);
        hypothesis.kind = MemoryKind::StableFact;
        hypothesis.confirmed = false;
        assert!(store
            .save_memory("comfort", hypothesis, 0, revision)
            .is_err());
        store
            .save_memory(
                "comfort",
                record("memory-a", "evidence-a", 1, 1),
                0,
                revision,
            )
            .unwrap();
        let candidate = store
            .prepare_background_candidate("comfort", record("background", "evidence-a", 1, 1))
            .unwrap();
        let current = store.state_version().unwrap();
        store
            .save_memory(
                "comfort",
                record("background-late", "evidence-a", 1, 1),
                0,
                current,
            )
            .unwrap();
        assert_eq!(
            store.commit_background_candidate(candidate).unwrap_err().0,
            "version_conflict"
        );
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn correction_uses_both_versions_and_old_evidence_links_go_stale() {
        let file = path("correct");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(&mut store, "comfort", "evidence-a");
        let revision = store
            .save_memory(
                "comfort",
                record("memory-a", "evidence-a", 1, 1),
                0,
                revision,
            )
            .unwrap();
        assert_eq!(
            store
                .save_memory(
                    "comfort",
                    record("memory-a", "evidence-a", 1, 2),
                    0,
                    revision
                )
                .unwrap_err()
                .0,
            "version_conflict"
        );
        let revision = store
            .save_evidence(
                evidence(
                    "evidence-a",
                    "comfort",
                    2,
                    "I now prefer a short river walk.",
                ),
                true,
                revision,
            )
            .unwrap();
        assert!(store.get_memory("comfort", "memory-a").unwrap().is_none());
        let revision = store
            .save_memory(
                "comfort",
                record("memory-a", "evidence-a", 2, 2),
                1,
                revision,
            )
            .unwrap();
        assert_eq!(
            store
                .get_memory("comfort", "memory-a")
                .unwrap()
                .unwrap()
                .version,
            2
        );
        assert_eq!(revision, 4);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn deletion_cascades_shared_evidence_summaries_and_blocks_restart_revival() {
        let file = path("delete-revive");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(&mut store, "comfort", "shared-evidence");
        let revision = store
            .save_memory(
                "comfort",
                record("memory-a", "shared-evidence", 1, 1),
                0,
                revision,
            )
            .unwrap();
        let revision = store
            .save_memory(
                "comfort",
                record("memory-b", "shared-evidence", 1, 1),
                0,
                revision,
            )
            .unwrap();
        let revision = store
            .add_reference_cache(
                "comfort",
                "summary-a",
                vec![EvidenceVersion {
                    id: "memory-a".into(),
                    version: 1,
                }],
                revision,
            )
            .unwrap();
        store
            .delete(
                "comfort",
                "memory-a",
                "memory",
                1,
                revision,
                "sync-token-test",
            )
            .unwrap();
        assert!(store.get_memory("comfort", "memory-a").unwrap().is_none());
        assert!(store.get_memory("comfort", "memory-b").unwrap().is_none());
        assert!(store
            .get_evidence("comfort", "shared-evidence")
            .unwrap()
            .is_none());
        drop(store);
        let mut reopened = PersistentMemoryStore::open(&file).unwrap();
        let current = reopened.state_version().unwrap();
        assert_eq!(
            reopened
                .save_evidence(
                    evidence("shared-evidence", "comfort", 2, "recreated text"),
                    true,
                    current
                )
                .unwrap_err()
                .0,
            "deleted"
        );
        assert_eq!(
            reopened
                .save_memory(
                    "comfort",
                    record("memory-c", "shared-evidence", 1, 1),
                    0,
                    current
                )
                .unwrap_err()
                .0,
            "evidence_missing"
        );
        assert_eq!(
            reopened
                .delete(
                    "comfort",
                    "memory-a",
                    "memory",
                    1,
                    current,
                    "sync-token-test"
                )
                .unwrap_err()
                .0,
            "deleted"
        );
        assert!(reopened.export().unwrap().tombstones.len() >= 4);
        let _ = revision;
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn source_version_and_shared_scope_are_required() {
        let file = path("source-version");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(&mut store, "comfort", "evidence-a");
        assert_eq!(
            store
                .save_memory(
                    "comfort",
                    record("memory-a", "evidence-a", 9, 1),
                    0,
                    revision
                )
                .unwrap_err()
                .0,
            "evidence_version_conflict"
        );
        assert_eq!(
            store
                .save_memory(
                    "cowork:project",
                    record("memory-a", "evidence-a", 1, 1),
                    0,
                    revision
                )
                .unwrap_err()
                .0,
            "evidence_version_conflict"
        );
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn data_export_omits_credentials_and_audio_and_rejects_sensitive_payloads() {
        let file = path("export");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(&mut store, "comfort", "evidence-a");
        let exported = serde_json::to_string(&store.export().unwrap()).unwrap();
        assert!(!exported.contains("credential"));
        assert!(!exported.contains("raw_audio"));
        let mut bad = evidence("evidence-b", "comfort", 1, "synthetic");
        // The fixed evidence DTO cannot carry an audio or credential property.
        let mut value = serde_json::to_value(&bad).unwrap();
        value["api_key"] = json!("synthetic-not-a-real-key");
        assert!(has_protected_fields(&value));
        bad.text_excerpt = "synthetic excerpt".into();
        assert!(store.save_evidence(bad, true, revision).is_ok());
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn rollback_replay_does_not_publish_partial_memory_or_advance_revision() {
        let file = path("rollback-replay");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(&mut store, "comfort", "evidence-a");
        store.fail_next_commit();
        assert_eq!(
            store
                .save_memory(
                    "comfort",
                    record("memory-a", "evidence-a", 1, 1),
                    0,
                    revision
                )
                .unwrap_err()
                .0,
            "storage_failure"
        );
        assert_eq!(store.state_version().unwrap(), revision);
        drop(store);
        let mut reopened = PersistentMemoryStore::open(&file).unwrap();
        assert!(reopened
            .get_memory("comfort", "memory-a")
            .unwrap()
            .is_none());
        reopened
            .save_memory(
                "comfort",
                record("memory-a", "evidence-a", 1, 1),
                0,
                revision,
            )
            .unwrap();
        let _ = std::fs::remove_file(file);
    }
}
