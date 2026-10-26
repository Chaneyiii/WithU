use std::collections::BTreeMap;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderConfig {
    pub version: u64,
    pub providers: BTreeMap<String, String>,
    pub credential_refs: Vec<String>,
}
pub struct ConfigStore {
    pub current: ProviderConfig,
}
impl ConfigStore {
    pub fn commit(&mut self, expected: u64, mut next: ProviderConfig) -> Result<(), &'static str> {
        if expected != self.current.version {
            return Err("conflict");
        }
        if next.providers.values().any(|s| s.is_empty()) {
            return Err("validation");
        }
        next.version = expected + 1;
        self.current = next;
        Ok(())
    }
    pub fn pin(&self) -> ProviderConfig {
        self.current.clone()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_unconfigured_state_is_valid() {
        let empty = ProviderConfig {
            version: 1,
            providers: BTreeMap::new(),
            credential_refs: vec![],
        };
        let mut store = ConfigStore {
            current: empty.clone(),
        };
        assert!(store.commit(1, empty).is_ok());
        assert!(store.current.providers.is_empty());
    }
    #[test]
    fn config_commit_is_atomic_and_running_task_is_pinned() {
        let original = ProviderConfig {
            version: 1,
            providers: BTreeMap::from([("llm".into(), "provider-a".into())]),
            credential_refs: vec!["os-key-ref".into()],
        };
        let mut s = ConfigStore {
            current: original.clone(),
        };
        let running = s.pin();
        let invalid = ProviderConfig {
            version: 2,
            providers: BTreeMap::from([("llm".into(), String::new())]),
            credential_refs: vec![],
        };
        assert_eq!(s.commit(1, invalid), Err("validation"));
        assert_eq!(s.current, original);
        let mut next = original.clone();
        next.providers.insert("llm".into(), "provider-b".into());
        assert!(s.commit(1, next.clone()).is_ok());
        assert_eq!(s.current.version, 2);
        assert_eq!(running, original);
        assert_eq!(s.commit(1, next), Err("conflict"));
    }
}
