use std::collections::{HashMap, HashSet};
pub use withu_runtime::{AffectHypothesis, EvidenceVersion, MemoryCandidate, MemoryKind};
mod persistent;
pub use persistent::{
    BackgroundMemoryCandidate, DerivedReferenceCache, EvidenceRecord, LocalMemoryIndex,
    MemoryExport, MemoryIndex, MemoryRecord, PersistentMemoryStore, EVIDENCE_RECORD_SCHEMA_VERSION,
    MEMORY_RECORD_SCHEMA_VERSION,
};
pub mod semantic;
pub use semantic::{SemanticMemoryIndex, SemanticSearchOptions};
#[derive(Default)]
/// Current-turn hypotheses are not long-term candidates, even when confirmed.
/// ```compile_fail
/// use withu_memory::{MemoryStore, AffectHypothesis};
/// let mut store = MemoryStore::default();
/// store.commit(AffectHypothesis { hypothesis_id: "h".into(), confirmed: true }, 0);
/// ```
pub struct MemoryStore {
    version: u64,
    evidence: HashMap<String, u64>,
    objects: HashMap<String, MemoryCandidate>,
    tombstones: HashSet<String>,
    derivatives: HashMap<String, Vec<String>>,
}
impl MemoryStore {
    pub fn version(&self) -> u64 {
        self.version
    }
    pub fn register_evidence(&mut self, id: &str, version: u64) -> bool {
        if version == 0
            || self.tombstones.contains(id)
            || self.evidence.get(id).is_some_and(|old| version <= *old)
        {
            return false;
        }
        self.evidence.insert(id.into(), version);
        self.version += 1;
        true
    }
    fn sources_valid(&self, c: &MemoryCandidate) -> bool {
        !c.source_evidence.is_empty()
            && c.source_evidence.iter().all(|s| {
                !self.tombstones.contains(&s.id) && self.evidence.get(&s.id) == Some(&s.version)
            })
    }
    pub fn commit(&mut self, c: MemoryCandidate, read_version: u64) -> bool {
        if read_version != self.version
            || self.tombstones.contains(&c.id)
            || !c.eligible_for_long_term()
            || !self.sources_valid(&c)
        {
            return false;
        }
        let expected = self.objects.get(&c.id).map_or(1, |old| old.version + 1);
        if c.version != expected {
            return false;
        }
        self.objects.insert(c.id.clone(), c);
        self.version += 1;
        true
    }
    pub fn add_derivative(&mut self, id: &str, sources: Vec<String>, read_version: u64) -> bool {
        if read_version != self.version
            || sources.is_empty()
            || self.derivatives.contains_key(id)
            || self.objects.contains_key(id)
            || self.evidence.contains_key(id)
            || sources.iter().any(|source| source == id)
            || self.tombstones.contains(id)
            || sources.iter().any(|s| !self.visible(s))
        {
            return false;
        }
        self.derivatives.insert(id.into(), sources);
        true
    }
    pub fn delete(&mut self, id: &str) {
        // A saved object deletion includes its corresponding evidence scope.
        // Unrelated evidence is retained; shared evidence dependants are invalidated.
        let sources: Vec<String> = self
            .objects
            .get(id)
            .map(|c| c.source_evidence.iter().map(|e| e.id.clone()).collect())
            .unwrap_or_default();
        for source in sources {
            self.tombstones.insert(source.clone());
            self.evidence.remove(&source);
        }
        if self.tombstones.insert(id.into()) {
            self.version += 1;
        }
        self.evidence.remove(id);
        self.objects.remove(id);
        self.derivatives.remove(id);
        loop {
            let invalid: Vec<String> = self
                .objects
                .iter()
                .filter(|(_, c)| !self.sources_valid(c))
                .map(|(id, _)| id.clone())
                .chain(
                    self.derivatives
                        .iter()
                        .filter(|(_, sources)| sources.iter().any(|s| !self.visible(s)))
                        .map(|(id, _)| id.clone()),
                )
                .collect();
            if invalid.is_empty() {
                break;
            }
            for id in invalid {
                self.tombstones.insert(id.clone());
                self.objects.remove(&id);
                self.derivatives.remove(&id);
            }
        }
    }
    pub fn visible(&self, id: &str) -> bool {
        self.visible_with_path(id, &mut HashSet::new())
    }
    fn visible_with_path(&self, id: &str, path: &mut HashSet<String>) -> bool {
        if self.tombstones.contains(id) || !path.insert(id.into()) {
            return false;
        }
        let result = self.objects.get(id).is_some_and(|c| self.sources_valid(c))
            || self.derivatives.get(id).is_some_and(|sources| {
                !sources.is_empty()
                    && sources
                        .iter()
                        .all(|source| self.visible_with_path(source, path))
            });
        path.remove(id);
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn candidate(id: &str) -> MemoryCandidate {
        MemoryCandidate {
            schema_version: 1,
            id: id.into(),
            kind: MemoryKind::ExplicitExperience,
            confirmed: true,
            save_permission: true,
            source_evidence: vec![EvidenceVersion {
                id: "user-turn".into(),
                version: 1,
            }],
            version: 1,
        }
    }
    fn store() -> MemoryStore {
        let mut s = MemoryStore::default();
        assert!(s.register_evidence("user-turn", 1));
        s
    }
    #[test]
    fn confirmed_without_save_permission_is_rejected() {
        let mut s = store();
        let mut c = candidate("memory");
        c.save_permission = false;
        assert!(!s.commit(c, s.version()));
    }
    #[test]
    fn missing_and_stale_sources_are_rejected() {
        let mut s = store();
        let mut c = candidate("memory");
        c.source_evidence.clear();
        assert!(!s.commit(c, s.version()));
        let mut c = candidate("memory");
        c.source_evidence[0].id = "missing".into();
        assert!(!s.commit(c, s.version()));
        assert!(s.register_evidence("user-turn", 2));
        assert!(!s.commit(candidate("memory"), s.version()));
    }
    #[test]
    fn permission_and_valid_source_allow_explicit_experience() {
        let mut s = store();
        assert!(s.commit(candidate("memory"), s.version()));
        assert!(s.visible("memory"));
    }
    #[test]
    fn deleted_source_cannot_revive_under_new_id_or_derivatives() {
        let mut s = store();
        assert!(s.commit(candidate("memory"), s.version()));
        assert!(s.add_derivative("cache", vec!["memory".into()], s.version()));
        assert!(s.add_derivative("summary", vec!["cache".into()], s.version()));
        s.delete("user-turn");
        for id in ["memory", "cache", "summary"] {
            assert!(!s.visible(id));
        }
        assert!(!s.commit(candidate("new-id"), s.version()));
        assert!(!s.add_derivative("late-summary", vec!["memory".into()], s.version()));
        assert!(!s.register_evidence("user-turn", 2));
    }
    #[test]
    fn stale_state_and_deleted_target_are_rejected() {
        let mut s = store();
        assert!(!s.commit(candidate("memory"), 0));
        s.delete("memory");
        assert!(!s.commit(candidate("memory"), s.version()));
    }
    #[test]
    fn deleting_saved_memory_blocks_source_reuse_but_preserves_unrelated_sources() {
        let mut s = store();
        assert!(s.register_evidence("unrelated-turn", 1));
        assert!(s.commit(candidate("memory"), s.version()));
        let mut unrelated = candidate("unrelated-memory");
        unrelated.source_evidence[0].id = "unrelated-turn".into();
        assert!(s.commit(unrelated.clone(), s.version()));
        assert!(s.add_derivative("cache", vec!["memory".into()], s.version()));
        assert!(s.add_derivative("summary", vec!["cache".into()], s.version()));
        s.delete("memory");
        let deleted_version = s.version();
        s.delete("memory");
        assert_eq!(s.version(), deleted_version);
        assert!(!s.commit(candidate("new-id"), s.version()));
        assert!(!s.register_evidence("user-turn", 2));
        assert!(!s.add_derivative("late-cache", vec!["memory".into()], s.version()));
        for id in ["memory", "cache", "summary"] {
            assert!(!s.visible(id));
        }
        assert!(s.visible("unrelated-memory"));
        unrelated.id = "another-unrelated-memory".into();
        assert!(s.commit(unrelated, s.version()));
    }
    #[test]
    fn self_and_two_node_cycle_overwrites_are_rejected_without_damaging_layers() {
        let mut s = store();
        assert!(s.commit(candidate("memory"), s.version()));
        assert!(!s.add_derivative("self", vec!["self".into()], s.version()));
        assert!(s.add_derivative("a", vec!["memory".into()], s.version()));
        assert!(s.add_derivative("b", vec!["a".into()], s.version()));
        assert!(s.add_derivative("c", vec!["a".into(), "b".into()], s.version()));
        assert!(!s.add_derivative("a", vec!["a".into()], s.version()));
        assert!(!s.add_derivative("a", vec!["b".into()], s.version()));
        for id in ["a", "b", "c"] {
            assert!(s.visible(id));
        }
        s.delete("memory");
        for id in ["a", "b", "c"] {
            assert!(!s.visible(id));
        }
    }
    #[test]
    fn query_guard_rejects_corrupt_cycles_without_recursing_forever() {
        let mut s = store();
        // Defensive read path also handles malformed internal fixtures.
        s.derivatives.insert("self".into(), vec!["self".into()]);
        s.derivatives.insert("a".into(), vec!["b".into()]);
        s.derivatives.insert("b".into(), vec!["a".into()]);
        assert!(!s.visible("self"));
        assert!(!s.visible("a"));
        assert!(!s.visible("b"));
        s.delete("unrelated-target");
        assert!(!s.derivatives.contains_key("self"));
        assert!(!s.derivatives.contains_key("a"));
        assert!(!s.derivatives.contains_key("b"));
    }
}
