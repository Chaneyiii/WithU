//! T15: replaceable, authorization-gated derived semantic index.
//!
//! The index is a *derivative* of canonical memory (SQLite behind
//! [`crate::PersistentMemoryStore`]); it is never a second source of truth.
//! Every search hit carries `memory_id` + `version` and is re-verified
//! against the authoritative store (version, status, tombstone, scope)
//! before any content is assembled into a bounded context projection
//! (spec §4.2.1 resolution 1, §4.3 deletion races).
//!
//! Reference alignment (evidence in the T15 agent report):
//! - WeKnora `client/retrieval.go`: hybrid-search stages recall plus
//!   re-scoring and reports honest per-stage outcomes beside the results ->
//!   staged scoring plus explicit `status`/`reason` here.
//! - OpenViking `docs/en/concepts/03-context-layers.md`: L0 abstract-first
//!   bounded loading -> summary-first rows under a character budget; the
//!   full record (L2) is only included when the budget allows.
//! - claude-code-best `src/memdir/findRelevantMemories.ts` /
//!   `memoryScan.ts`: manifest-first selective recall with small caps;
//!   recall failure degrades to empty instead of blocking.
//!
//! Architecture thought only; no third-party code is copied in.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{json, Value};
use withu_storage::StoreError;

use crate::persistent::{
    is_memory_kind, value_to_memory, visible_memory, MemoryRecord, PersistentMemoryStore,
};

/// Honest identity of the default adapter: a *lexical approximation*, not an
/// embedding semantic index. Never rename this into something implying
/// vector/embedding retrieval.
pub const LEXICAL_INDEX_KIND: &str = "lexical_char_ngram";
pub const SEMANTIC_INDEX_UNAVAILABLE: &str = "semantic_index_unavailable";

/// Char n-gram width used by the default lexical adapter.
const GRAM_SIZE: usize = 3;
/// Hybrid weight: exact token coverage vs fuzzy char-gram similarity.
const TOKEN_WEIGHT: f64 = 0.6;
/// Hits below this relevance floor are excluded as noise.
const MIN_RELEVANCE: f64 = 0.2;

/// One authorization-gated projection of a canonical memory record into a
/// derived index. Carries only retrieval text; the canonical record stays
/// the single source of truth for content, evidence and status.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryIndexEntry {
    pub memory_id: String,
    pub scope: String,
    pub version: u64,
    pub subject: String,
    pub content: String,
}

impl MemoryIndexEntry {
    /// Authorization gate: only user-confirmed, explicitly permissioned,
    /// active records may enter a derived index. Anything else returns
    /// `None` and is never indexed. Canonical saves enforce the same rule;
    /// this gate keeps the boundary explicit at the index surface so
    /// unconfirmed background candidates cannot leak through a custom
    /// adapter.
    pub fn authorized_from_record(scope: &str, record: &MemoryRecord) -> Option<Self> {
        if record.status != "active"
            || !record.confirmed
            || !record.save_permission
            || record.version == 0
        {
            return None;
        }
        Some(Self {
            memory_id: record.id.clone(),
            scope: scope.to_owned(),
            version: record.version,
            subject: record.subject.clone(),
            content: record.content.clone(),
        })
    }

    fn indexed_text(&self) -> String {
        format!("{} {}", self.subject, self.content)
    }
}

/// A derived-index candidate. Hits are references (`memory_id` + `version`),
/// never authoritative content; consumers must re-verify against canonical
/// memory before use.
#[derive(Clone, Debug, PartialEq)]
pub struct MemoryIndexHit {
    pub memory_id: String,
    pub scope: String,
    pub version: u64,
    pub score: f64,
}

/// Honest capability report for an index adapter.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MemoryIndexStatus {
    pub kind: String,
    pub available: bool,
    pub embedding: bool,
    pub note: String,
    pub entries: usize,
}

/// Replaceable derived-index surface (spec §4.2.1 resolution 1). An index is
/// a derivative: it must be fully rebuildable from the authoritative store
/// alone, receives only authorization-gated canonical text, and never
/// credentials, audio, or current-turn affect candidates.
pub trait MemoryIndex {
    fn upsert(&mut self, entry: MemoryIndexEntry) -> Result<(), StoreError>;
    fn remove(&mut self, scope: &str, memory_id: &str) -> Result<(), StoreError>;
    /// Drop every entry of one scope. Used by the sync path to rebuild a
    /// scope partition from canonical memory in one honest pass.
    fn clear_scope(&mut self, scope: &str) -> Result<(), StoreError>;
    fn search(
        &self,
        scope: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryIndexHit>, StoreError>;
    fn status(&self) -> MemoryIndexStatus;
}

#[derive(Clone, Debug)]
struct LexicalEntry {
    entry: MemoryIndexEntry,
    tokens: HashSet<String>,
    grams: HashSet<String>,
}

/// Default local adapter: lightweight **lexical semantic approximation**
/// (token overlap + character n-gram similarity, WeKnora hybrid-recall
/// idea localized). No network service, no model download, no new
/// dependencies. In-memory by design: it is a derivative rebuilt from the
/// authoritative SQLite snapshot, so it cannot drift into a second source
/// of truth and cannot survive process death with stale state.
#[derive(Default)]
pub struct LexicalMemoryIndex {
    scopes: HashMap<String, HashMap<String, LexicalEntry>>,
}

impl LexicalMemoryIndex {
    fn shape_of(entry: MemoryIndexEntry) -> LexicalEntry {
        let text = entry.indexed_text();
        LexicalEntry {
            tokens: tokenize(&text),
            grams: char_grams(&text, GRAM_SIZE),
            entry,
        }
    }
}

impl MemoryIndex for LexicalMemoryIndex {
    fn upsert(&mut self, entry: MemoryIndexEntry) -> Result<(), StoreError> {
        if entry.memory_id.is_empty() || entry.scope.is_empty() || entry.version == 0 {
            return Err(StoreError("validation_error"));
        }
        let id = entry.memory_id.clone();
        let scope = entry.scope.clone();
        let shaped = Self::shape_of(entry);
        self.scopes.entry(scope).or_default().insert(id, shaped);
        Ok(())
    }

    fn remove(&mut self, scope: &str, memory_id: &str) -> Result<(), StoreError> {
        if let Some(partition) = self.scopes.get_mut(scope) {
            partition.remove(memory_id);
        }
        Ok(())
    }

    fn clear_scope(&mut self, scope: &str) -> Result<(), StoreError> {
        self.scopes.remove(scope);
        Ok(())
    }

    fn search(
        &self,
        scope: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryIndexHit>, StoreError> {
        if query.trim().is_empty() || limit == 0 {
            return Err(StoreError("validation_error"));
        }
        let Some(partition) = self.scopes.get(scope) else {
            return Ok(Vec::new());
        };
        let query_tokens = tokenize(query);
        let query_grams = char_grams(query, GRAM_SIZE);
        let mut hits: Vec<MemoryIndexHit> = partition
            .values()
            .filter_map(|indexed| {
                let score = relevance(&query_tokens, &query_grams, indexed);
                (score >= MIN_RELEVANCE).then(|| MemoryIndexHit {
                    memory_id: indexed.entry.memory_id.clone(),
                    scope: indexed.entry.scope.clone(),
                    version: indexed.entry.version,
                    score,
                })
            })
            .collect();
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| a.memory_id.cmp(&b.memory_id))
        });
        hits.truncate(limit);
        Ok(hits)
    }

    fn status(&self) -> MemoryIndexStatus {
        MemoryIndexStatus {
            kind: LEXICAL_INDEX_KIND.into(),
            available: true,
            embedding: false,
            note: "lightweight lexical semantic approximation (token + char n-gram); not an embedding index".into(),
            entries: self.scopes.values().map(HashMap::len).sum(),
        }
    }
}

/// Honest null adapter: reports unavailable and refuses every operation.
/// Used when no semantic index is configured; the honest "unavailable"
/// state is an acceptance point of T15.
#[derive(Default)]
pub struct UnavailableMemoryIndex;

impl MemoryIndex for UnavailableMemoryIndex {
    fn upsert(&mut self, _: MemoryIndexEntry) -> Result<(), StoreError> {
        Err(StoreError(SEMANTIC_INDEX_UNAVAILABLE))
    }
    fn remove(&mut self, _: &str, _: &str) -> Result<(), StoreError> {
        Err(StoreError(SEMANTIC_INDEX_UNAVAILABLE))
    }
    fn clear_scope(&mut self, _: &str) -> Result<(), StoreError> {
        Err(StoreError(SEMANTIC_INDEX_UNAVAILABLE))
    }
    fn search(&self, _: &str, _: &str, _: usize) -> Result<Vec<MemoryIndexHit>, StoreError> {
        Err(StoreError(SEMANTIC_INDEX_UNAVAILABLE))
    }
    fn status(&self) -> MemoryIndexStatus {
        MemoryIndexStatus {
            kind: "unavailable".into(),
            available: false,
            embedding: false,
            note: "no semantic index configured".into(),
            entries: 0,
        }
    }
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF)
}

/// Word tokens for latin scripts; per-character tokens for CJK (no word
/// segmentation). This keeps Chinese queries matchable by character overlap,
/// the standard lexical baseline, without any segmentation dependency.
fn tokenize(text: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let mut word = String::new();
    for ch in text.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            word.push(ch);
        } else {
            if !word.is_empty() {
                tokens.insert(std::mem::take(&mut word));
            }
            if is_cjk(ch) {
                tokens.insert(ch.to_string());
            }
        }
    }
    if !word.is_empty() {
        tokens.insert(word);
    }
    tokens
}

fn char_grams(text: &str, width: usize) -> HashSet<String> {
    let normalized: Vec<char> = text
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    if normalized.is_empty() {
        return HashSet::new();
    }
    if normalized.len() < width {
        return HashSet::from([normalized.into_iter().collect()]);
    }
    normalized
        .windows(width)
        .map(|window| window.iter().collect())
        .collect()
}

fn relevance(
    query_tokens: &HashSet<String>,
    query_grams: &HashSet<String>,
    doc: &LexicalEntry,
) -> f64 {
    let token_coverage = if query_tokens.is_empty() {
        0.0
    } else {
        query_tokens.intersection(&doc.tokens).count() as f64 / query_tokens.len() as f64
    };
    let gram_similarity = if query_grams.is_empty() || doc.grams.is_empty() {
        0.0
    } else {
        let shared = query_grams.intersection(&doc.grams).count() as f64;
        shared / ((query_grams.len() as f64).sqrt() * (doc.grams.len() as f64).sqrt())
    };
    TOKEN_WEIGHT * token_coverage + (1.0 - TOKEN_WEIGHT) * gram_similarity
}

/// Bounded-loading knobs for semantic retrieval. Defaults mirror the exact
/// path's demo budget (`load_context` 6 rows / server 6 000 chars).
#[derive(Clone, Copy, Debug)]
pub struct SemanticSearchOptions {
    pub limit: usize,
    pub max_chars: usize,
}

impl Default for SemanticSearchOptions {
    fn default() -> Self {
        Self {
            limit: 6,
            max_chars: 6_000,
        }
    }
}

/// Honest result of a semantic retrieval call. `items` are bounded,
/// re-verified, scope-bound context rows; `dropped` counts candidates the
/// canonical recheck discarded (stale version, tombstone, foreign scope).
#[derive(Clone, Debug, Serialize)]
pub struct SemanticSearchOutcome {
    pub scope: String,
    pub state_version: u64,
    pub mode: String,
    pub status: String,
    pub reason: String,
    pub index_kind: String,
    pub embedding: bool,
    pub dropped: usize,
    pub items: Vec<Value>,
}

impl PersistentMemoryStore<'_> {
    /// Authorized, scope-bound semantic-approximation retrieval: sync the
    /// derived index from the authoritative snapshot, search it, re-verify
    /// every hit against canonical memory (version/status/tombstone/scope),
    /// then assemble a bounded L0-summary-first context projection.
    ///
    /// This is the server-facing seam for T15; see the agent report for the
    /// suggested `apps/withu-server` wiring points.
    pub fn search_semantic(
        &self,
        index: &mut dyn MemoryIndex,
        scope: &str,
        query: &str,
        options: SemanticSearchOptions,
    ) -> Result<SemanticSearchOutcome, StoreError> {
        if scope.trim().is_empty()
            || query.trim().is_empty()
            || options.limit == 0
            || options.limit > 100
            || options.max_chars == 0
            || options.max_chars > 1_000_000
        {
            return Err(StoreError("validation_error"));
        }
        let state_version = self.state_version()?;
        if !index.status().available {
            return Ok(unavailable_outcome(scope, state_version));
        }
        // Sync: rebuild this scope's partition from the authoritative
        // snapshot. Only visible, active, confirmed, permissioned records
        // pass the gate, so tombstoned rows cannot survive a rebuild and
        // deleted memories can never revive through the index.
        let snapshot = self.snapshot()?;
        let entries: Vec<MemoryIndexEntry> = snapshot
            .objects
            .iter()
            .filter(|row| {
                row.scope == scope && is_memory_kind(&row.kind) && visible_memory(row, &snapshot)
            })
            .filter_map(|row| value_to_memory(&row.body).ok())
            .filter_map(|record| MemoryIndexEntry::authorized_from_record(scope, &record))
            .collect();
        let fetch_limit = options.limit.saturating_mul(2).min(100);
        let hits = (|| -> Result<Vec<MemoryIndexHit>, StoreError> {
            index.clear_scope(scope)?;
            for entry in entries {
                index.upsert(entry)?;
            }
            index.search(scope, query, fetch_limit)
        })();
        let hits = match hits {
            Ok(hits) => hits,
            Err(error) if error.0 == SEMANTIC_INDEX_UNAVAILABLE => {
                return Ok(unavailable_outcome(scope, state_version))
            }
            Err(error) => return Err(error),
        };
        // Canonical recheck: a hit is only a *hint*. The authoritative store
        // decides existence, version, status, and scope membership.
        let mut verified: Vec<(MemoryIndexHit, MemoryRecord)> = Vec::new();
        let mut dropped = 0usize;
        for hit in hits {
            match self.get_memory(scope, &hit.memory_id) {
                Ok(Some(record))
                    if record.version == hit.version
                        && record.status == "active"
                        && record.confirmed
                        && record.save_permission =>
                {
                    verified.push((hit, record));
                }
                Ok(_) => dropped += 1,
                Err(error) => return Err(error),
            }
        }
        verified.sort_by(|a, b| {
            b.0.score
                .partial_cmp(&a.0.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| a.0.memory_id.cmp(&b.0.memory_id))
        });
        // Bounded L0-first assembly: each row always carries a small
        // summary; the full record and evidence (L2) are included only
        // while the character budget allows, mirroring the server's exact
        // context budgeting.
        let mut items: Vec<Value> = Vec::new();
        let mut remaining = options.max_chars;
        for (hit, record) in verified.into_iter().take(options.limit) {
            let summary = json!({
                "id": record.id,
                "version": record.version,
                "subject": record.subject,
            });
            let mut full = self.management_row(scope, &record)?;
            full["score"] = json!(hit.score);
            full["summary"] = summary.clone();
            let full_size = full.to_string().chars().count();
            if full_size <= remaining {
                remaining -= full_size;
                items.push(full);
                continue;
            }
            let light = json!({
                "scope": scope,
                "object_version": record.version,
                "score": hit.score,
                "summary": summary,
            });
            let light_size = light.to_string().chars().count();
            if light_size <= remaining {
                remaining -= light_size;
                items.push(light);
            }
        }
        let status = index.status();
        Ok(SemanticSearchOutcome {
            scope: scope.to_owned(),
            state_version,
            mode: "semantic".into(),
            status: "supported".into(),
            reason: String::new(),
            index_kind: status.kind,
            embedding: status.embedding,
            dropped,
            items,
        })
    }
}

fn unavailable_outcome(scope: &str, state_version: u64) -> SemanticSearchOutcome {
    SemanticSearchOutcome {
        scope: scope.to_owned(),
        state_version,
        mode: "semantic".into(),
        status: "unavailable".into(),
        reason: SEMANTIC_INDEX_UNAVAILABLE.into(),
        index_kind: "unavailable".into(),
        embedding: false,
        dropped: 0,
        items: Vec::new(),
    }
}

/// Bridge between the derived lexical index and the crate's retrieval seam
/// ([`crate::persistent::MemoryIndex`]). Plugging this into
/// `load_index_context` turns the server's `semantic` retrieval mode from an
/// honest "unavailable" into actual bounded semantic-approximation results,
/// with no new server API: the exact path (semantic=false) is delegated
/// unchanged to the authoritative management listing.
pub struct SemanticMemoryIndex {
    inner: std::cell::RefCell<LexicalMemoryIndex>,
}

impl Default for SemanticMemoryIndex {
    fn default() -> Self {
        Self {
            inner: std::cell::RefCell::new(LexicalMemoryIndex::default()),
        }
    }
}

impl crate::persistent::MemoryIndex for SemanticMemoryIndex {
    fn retrieve(
        &self,
        store: &PersistentMemoryStore<'_>,
        scope: &str,
        phrase: Option<&str>,
        limit: usize,
        semantic: bool,
    ) -> Result<Vec<Value>, StoreError> {
        if !semantic {
            return store.list_management(scope, phrase, limit);
        }
        let query = phrase
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| StoreError("validation_error"))?;
        let options = SemanticSearchOptions {
            limit,
            ..SemanticSearchOptions::default()
        };
        Ok(store
            .search_semantic(&mut *self.inner.borrow_mut(), scope, query, options)?
            .items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistent::EvidenceRecord;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use withu_runtime::{EvidenceVersion, MemoryKind};

    fn path(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("withu-semantic-{name}-{stamp}.sqlite"))
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

    fn record(id: &str, subject: &str, content: &str) -> MemoryRecord {
        MemoryRecord {
            schema_version: 1,
            id: id.into(),
            kind: MemoryKind::ExplicitExperience,
            subject: subject.into(),
            content: content.into(),
            observed_at: "2030-01-01T00:00:00Z".into(),
            confidence: 1.0,
            valid_from: "2030-01-01".into(),
            valid_to: None,
            status: "active".into(),
            version: 1,
            confirmed: true,
            save_permission: true,
            source_evidence: vec![EvidenceVersion {
                id: format!("evidence-{id}"),
                version: 1,
            }],
        }
    }

    fn seed(store: &mut PersistentMemoryStore, scope: &str, record: &MemoryRecord) -> u64 {
        let revision = store.state_version().unwrap();
        // Evidence is an excerpt, never the full content: bound it the same
        // way the live pipeline does (MAX_EVIDENCE_CHARS is 2000).
        let excerpt: String = record.content.chars().take(500).collect();
        store
            .save_memory_with_evidence(
                evidence(&format!("evidence-{}", record.id), scope, 1, &excerpt),
                record.clone(),
                true,
                0,
                revision,
            )
            .unwrap()
    }

    #[test]
    fn lexical_search_is_scope_bound_and_ranks_relevant_memories() {
        let file = path("scope-rank");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        seed(
            &mut store,
            "comfort",
            &record(
                "memory-river",
                "weekend river walk",
                "User enjoys a quiet walk by the river bank.",
            ),
        );
        seed(
            &mut store,
            "comfort",
            &record(
                "memory-coffee",
                "coffee grinding",
                "User grinds dark roast coffee beans each morning.",
            ),
        );
        seed(
            &mut store,
            "cowork:p1",
            &record(
                "memory-work-river",
                "release checklist",
                "The river deployment gate blocks the release.",
            ),
        );
        let mut index = LexicalMemoryIndex::default();
        let outcome = store
            .search_semantic(
                &mut index,
                "comfort",
                "quiet river walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(outcome.status, "supported");
        assert_eq!(outcome.index_kind, LEXICAL_INDEX_KIND);
        assert!(!outcome.embedding);
        let ids: Vec<&str> = outcome
            .items
            .iter()
            .map(|item| item["record"]["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["memory-river"]);
        // Sync indexes the whole queried scope partition (river + coffee),
        // never other scopes.
        assert_eq!(
            index.status().entries,
            2,
            "only the queried scope is synced"
        );
        let cowork = store
            .search_semantic(
                &mut index,
                "cowork:p1",
                "river deployment",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(
            cowork
                .items
                .iter()
                .filter(|item| item["record"]["id"] == "memory-work-river")
                .count(),
            1
        );
        assert!(
            !cowork
                .items
                .iter()
                .any(|item| item["record"]["id"] == "memory-river"),
            "comfort memories must never leak into a cowork scope search"
        );
        assert!(store
            .search_semantic(
                &mut index,
                "comfort",
                "  ",
                SemanticSearchOptions::default()
            )
            .is_err());
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn deleted_memory_never_returns_and_does_not_revive_after_rebuild() {
        let file = path("delete-rebuild");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(
            &mut store,
            "comfort",
            &record(
                "memory-river",
                "weekend river walk",
                "User enjoys a quiet walk by the river bank.",
            ),
        );
        let revision = seed(
            &mut store,
            "comfort",
            &record(
                "memory-coffee",
                "coffee grinding",
                "User grinds dark roast coffee beans each morning.",
            ),
        );
        let mut index = LexicalMemoryIndex::default();
        let before = store
            .search_semantic(
                &mut index,
                "comfort",
                "river walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert!(before
            .items
            .iter()
            .any(|item| item["record"]["id"] == "memory-river"));
        assert_eq!(index.status().entries, 2);
        store
            .delete(
                "comfort",
                "memory-river",
                "memory",
                1,
                revision,
                "sync-token-t15",
            )
            .unwrap();
        assert!(store
            .get_memory("comfort", "memory-river")
            .unwrap()
            .is_none());
        // Same (possibly stale) index instance: sync clears the tombstoned row.
        let after = store
            .search_semantic(
                &mut index,
                "comfort",
                "river walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert!(
            !after
                .items
                .iter()
                .any(|item| item["record"]["id"] == "memory-river"),
            "tombstoned memory must not be returned after deletion"
        );
        assert_eq!(index.status().entries, 1);
        // Fresh rebuild from canonical memory alone: still no revival.
        let mut rebuilt = LexicalMemoryIndex::default();
        let rebuilt_outcome = store
            .search_semantic(
                &mut rebuilt,
                "comfort",
                "river walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert!(rebuilt_outcome.items.is_empty());
        assert_eq!(rebuilt.status().entries, 1);
        // Canonical recheck also discards a rigged stale hit for the deleted id.
        let rigged = RiggedIndex::new(vec![MemoryIndexHit {
            memory_id: "memory-river".into(),
            scope: "comfort".into(),
            version: 1,
            score: 0.9,
        }]);
        let mut rigged = rigged;
        let guarded = store
            .search_semantic(
                &mut rigged,
                "comfort",
                "river walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert!(guarded.items.is_empty());
        assert_eq!(guarded.dropped, 1);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn canonical_recheck_drops_stale_foreign_and_deleted_hits() {
        let file = path("recheck");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        seed(
            &mut store,
            "comfort",
            &record(
                "memory-river",
                "weekend river walk",
                "User enjoys a quiet walk by the river bank.",
            ),
        );
        seed(
            &mut store,
            "cowork:p1",
            &record(
                "memory-work",
                "release checklist",
                "The deployment gate blocks the release.",
            ),
        );
        let rigged = RiggedIndex::new(vec![
            MemoryIndexHit {
                memory_id: "memory-river".into(),
                scope: "comfort".into(),
                version: 99,
                score: 0.99,
            }, // stale version
            MemoryIndexHit {
                memory_id: "memory-work".into(),
                scope: "comfort".into(),
                version: 1,
                score: 0.95,
            }, // foreign scope
            MemoryIndexHit {
                memory_id: "memory-gone".into(),
                scope: "comfort".into(),
                version: 1,
                score: 0.9,
            }, // never existed / deleted
            MemoryIndexHit {
                memory_id: "memory-river".into(),
                scope: "comfort".into(),
                version: 1,
                score: 0.5,
            }, // valid
        ]);
        let mut rigged = rigged;
        let outcome = store
            .search_semantic(
                &mut rigged,
                "comfort",
                "river walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(outcome.dropped, 3);
        assert_eq!(outcome.items.len(), 1);
        assert_eq!(outcome.items[0]["record"]["id"], "memory-river");
        assert_eq!(outcome.items[0]["record"]["version"], 1);
        assert!(outcome.items[0]["evidence"].is_array());
        assert!(outcome.items[0]["summary"]["subject"].is_string());
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn authorization_gate_never_indexes_unconfirmed_or_inactive_records() {
        let file = path("authorization");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let mut unconfirmed = record("memory-candidate", "topic", "content");
        unconfirmed.confirmed = false;
        let mut unpermitted = record("memory-candidate", "topic", "content");
        unpermitted.save_permission = false;
        let mut inactive = record("memory-candidate", "topic", "content");
        inactive.status = "superseded".into();
        for rejected in [&unconfirmed, &unpermitted, &inactive] {
            assert!(MemoryIndexEntry::authorized_from_record("comfort", rejected).is_none());
        }
        let revision = store.state_version().unwrap();
        assert_eq!(
            store
                .save_memory("comfort", unconfirmed, 0, revision)
                .unwrap_err()
                .0,
            "memory_not_eligible"
        );
        // A prepared (uncommitted) background candidate is not in the
        // authoritative snapshot, so sync cannot index it. The referenced
        // evidence is committed first; the candidate's read-state-version
        // must be taken after that write.
        let revision = store.state_version().unwrap();
        store
            .save_evidence(
                evidence("evidence-memory-later", "comfort", 1, "later topic content"),
                true,
                revision,
            )
            .unwrap();
        let candidate = store
            .prepare_background_candidate("comfort", record("memory-later", "topic", "content"))
            .unwrap();
        let mut index = LexicalMemoryIndex::default();
        let outcome = store
            .search_semantic(
                &mut index,
                "comfort",
                "topic",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(index.status().entries, 0);
        assert!(outcome.items.is_empty());
        // Only after the candidate itself is explicitly committed does it
        // become indexable.
        store.commit_background_candidate(candidate).unwrap();
        let committed = store
            .search_semantic(
                &mut index,
                "comfort",
                "topic",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(index.status().entries, 1);
        assert_eq!(committed.items.len(), 1);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn bounded_assembly_prefers_summary_when_budget_is_tight() {
        let file = path("bounded");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let huge = format!("rivers and bridges {}", "x".repeat(9_000));
        seed(
            &mut store,
            "comfort",
            &record("memory-big", "long river story", &huge),
        );
        seed(
            &mut store,
            "comfort",
            &record(
                "memory-small",
                "short river note",
                "User likes the small river.",
            ),
        );
        let mut index = LexicalMemoryIndex::default();
        let options = SemanticSearchOptions::default();
        let outcome = store
            .search_semantic(&mut index, "comfort", "river story note", options)
            .unwrap();
        assert!(!outcome.items.is_empty());
        let mut total = 0usize;
        for item in &outcome.items {
            let size = item.to_string().chars().count();
            assert!(size <= options.max_chars, "every row must fit the budget");
            total += size;
        }
        assert!(total <= options.max_chars);
        let big = outcome
            .items
            .iter()
            .find(|item| item["summary"]["id"] == "memory-big")
            .expect("summary row for the oversized memory");
        assert!(
            big.get("record").is_none(),
            "oversized record degrades to L0 summary only"
        );
        assert!(big["summary"]["subject"].is_string());
        let small = outcome
            .items
            .iter()
            .find(|item| item["summary"]["id"] == "memory-small")
            .expect("small memory present");
        assert!(
            small["record"].is_object(),
            "budget allows the full row for small memories"
        );
        // Count cap is respected independently of the byte budget.
        let capped = store
            .search_semantic(
                &mut index,
                "comfort",
                "river story note",
                SemanticSearchOptions {
                    limit: 1,
                    ..options
                },
            )
            .unwrap();
        assert_eq!(capped.items.len(), 1);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn unavailable_index_reports_honest_unavailable_outcome() {
        let file = path("unavailable");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        seed(
            &mut store,
            "comfort",
            &record(
                "memory-river",
                "weekend river walk",
                "User enjoys a quiet walk by the river bank.",
            ),
        );
        let mut index = UnavailableMemoryIndex;
        let outcome = store
            .search_semantic(
                &mut index,
                "comfort",
                "river walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(outcome.status, "unavailable");
        assert_eq!(outcome.reason, "semantic_index_unavailable");
        assert_eq!(outcome.index_kind, "unavailable");
        assert!(outcome.items.is_empty());
        assert!(!index.status().available);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn cjk_queries_match_by_character_overlap() {
        let file = path("cjk");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        seed(
            &mut store,
            "comfort",
            &record("memory-tea", "茶饮偏好", "我喜欢无糖乌龙茶。"),
        );
        seed(
            &mut store,
            "comfort",
            &record("memory-walk", "散步习惯", "我喜欢傍晚在河边散步。"),
        );
        let mut index = LexicalMemoryIndex::default();
        let outcome = store
            .search_semantic(
                &mut index,
                "comfort",
                "乌龙茶 茶饮",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        let ids: Vec<&str> = outcome
            .items
            .iter()
            .filter_map(|item| item["record"]["id"].as_str())
            .collect();
        assert_eq!(
            ids,
            vec!["memory-tea"],
            "CJK query ranks the tea memory first and only"
        );
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn semantic_bridge_plugs_into_the_existing_retrieval_seam() {
        // This is the exact call shape the server uses for retrieval mode
        // "semantic"; before T15 it returned semantic_index_unavailable.
        let file = path("bridge");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        seed(
            &mut store,
            "comfort",
            &record(
                "memory-river",
                "weekend river walk",
                "User enjoys a quiet walk by the river bank.",
            ),
        );
        let semantic = SemanticMemoryIndex::default();
        let rows = store
            .load_index_context(&semantic, "comfort", Some("quiet river walk"), 5, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["record"]["id"], "memory-river");
        assert!(rows[0]["evidence"].is_array());
        // Exact path through the same bridge is delegated unchanged.
        let exact = store
            .load_index_context(&semantic, "comfort", Some("river"), 5, false)
            .unwrap();
        assert!(exact
            .iter()
            .any(|row| row["record"]["id"] == "memory-river"));
        // Semantic without a phrase fails validation instead of guessing.
        assert!(store
            .load_index_context(&semantic, "comfort", Some("  "), 5, true)
            .is_err());
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn correction_replaces_index_entry_and_returns_new_version() {
        let file = path("correction");
        let mut store = PersistentMemoryStore::open(&file).unwrap();
        let revision = seed(
            &mut store,
            "comfort",
            &record(
                "memory-river",
                "weekend river walk",
                "User enjoys a quiet walk by the river bank.",
            ),
        );
        let mut index = LexicalMemoryIndex::default();
        let v1 = store
            .search_semantic(
                &mut index,
                "comfort",
                "river walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(v1.items[0]["record"]["version"], 1);
        let revision = store
            .save_evidence(
                evidence(
                    "evidence-memory-river",
                    "comfort",
                    2,
                    "We now walk the city park instead.",
                ),
                true,
                revision,
            )
            .unwrap();
        let mut corrected = record(
            "memory-river",
            "weekend park walk",
            "User now prefers walking in the city park.",
        );
        corrected.version = 2;
        corrected.source_evidence[0].version = 2;
        store
            .save_memory("comfort", corrected, 1, revision)
            .unwrap();
        let v2 = store
            .search_semantic(
                &mut index,
                "comfort",
                "park walk",
                SemanticSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(v2.items.len(), 1);
        assert_eq!(v2.items[0]["record"]["version"], 2);
        assert_eq!(v2.items[0]["record"]["subject"], "weekend park walk");
        assert_eq!(
            index.status().entries,
            1,
            "correction replaces, not duplicates"
        );
        let _ = std::fs::remove_file(file);
    }

    /// Test double simulating a stale/corrupt adapter whose sync hooks are
    /// unresponsive and whose search returns rigged hits.
    struct RiggedIndex {
        hits: Vec<MemoryIndexHit>,
    }

    impl RiggedIndex {
        fn new(hits: Vec<MemoryIndexHit>) -> Self {
            Self { hits }
        }
    }

    impl MemoryIndex for RiggedIndex {
        fn upsert(&mut self, _: MemoryIndexEntry) -> Result<(), StoreError> {
            Ok(())
        }
        fn remove(&mut self, _: &str, _: &str) -> Result<(), StoreError> {
            Ok(())
        }
        fn clear_scope(&mut self, _: &str) -> Result<(), StoreError> {
            Ok(())
        }
        fn search(&self, _: &str, _: &str, _: usize) -> Result<Vec<MemoryIndexHit>, StoreError> {
            Ok(self.hits.clone())
        }
        fn status(&self) -> MemoryIndexStatus {
            LexicalMemoryIndex::default().status()
        }
    }
}
