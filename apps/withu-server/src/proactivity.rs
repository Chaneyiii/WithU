use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use withu_audit::AuditFact;
use withu_proactivity::{FeedItem, Policy, PolicyConfig, PolicyState, QuietHours};
use withu_storage::{Store, StoreError};

const KIND: &str = "proactivity";
const ID: &str = "comfort";
const FEED_LIMIT: usize = 100;
const CANDIDATE_TTL_SECONDS: u64 = 24 * 60 * 60;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateOffer {
    pub schema_version: u16,
    pub id: String,
    pub source: String,
    pub scope: String,
    pub dedupe_key: String,
    pub title: String,
    pub body: String,
}

impl CandidateOffer {
    pub fn into_candidate(self, now: u64) -> withu_proactivity::Candidate {
        withu_proactivity::Candidate {
            schema_version: self.schema_version,
            id: self.id,
            source: self.source,
            scope: self.scope,
            dedupe_key: self.dedupe_key,
            created_at: now,
            expires_at: now.saturating_add(CANDIDATE_TTL_SECONDS),
            title: self.title,
            body: self.body,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeedEntry {
    pub schema_version: u16,
    pub item: FeedItem,
    pub notification_status: String,
    pub notification_version: u64,
    pub notification_updated_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProactivityState {
    pub schema_version: u16,
    pub storage_version: u64,
    pub policy: PolicyConfig,
    pub policy_state: PolicyState,
    pub feed: Vec<FeedEntry>,
}

impl Default for ProactivityState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            storage_version: 0,
            policy: PolicyConfig {
                schema_version: 1,
                version: 1,
                enabled: false,
                scope: "comfort".into(),
                timezone: "Etc/UTC".into(),
                utc_offset_minutes: 0,
                quiet_hours: Some(QuietHours {
                    start_minute: 22 * 60,
                    end_minute: 8 * 60,
                }),
                paused: false,
                rate_limit: 2,
                rate_window_seconds: 86_400,
            },
            policy_state: PolicyState::default(),
            feed: Vec::new(),
        }
    }
}

impl ProactivityState {
    pub fn load(store: &Store) -> Result<Self, StoreError> {
        match store.get(KIND, ID)? {
            Some(value) => serde_json::from_value(value).map_err(|_| StoreError("storage_corrupt")),
            None => Ok(Self::default()),
        }
    }

    pub fn policy(&self) -> Result<Policy, withu_proactivity::PolicyError> {
        Policy::new_with_state(self.policy.clone(), self.policy_state.clone())
    }

    pub fn save(
        &mut self,
        store: &mut Store,
        session: &str,
        operation: &str,
    ) -> Result<(), StoreError> {
        let expected = self.storage_version;
        self.storage_version = expected
            .checked_add(1)
            .ok_or(StoreError("version_conflict"))?;
        let fact = AuditFact {
            schema_version: 1,
            operation: operation.into(),
            object_id: ID.into(),
            occurred_at: unix_now().to_string(),
            actor: session.into(),
            result: "committed".into(),
        };
        if let Err(error) = store.put(KIND, ID, expected, &json!(self), &fact) {
            self.storage_version = expected;
            return Err(error);
        }
        Ok(())
    }

    pub fn add_feed_item(&mut self, item: FeedItem) {
        self.feed.push(FeedEntry {
            schema_version: 1,
            item,
            notification_status: "pending".into(),
            notification_version: 0,
            notification_updated_at: None,
        });
        if self.feed.len() > FEED_LIMIT {
            self.feed.drain(..self.feed.len() - FEED_LIMIT);
        }
    }

    pub fn feed_value(&self, now: u64) -> Value {
        let items: Vec<_> = self
            .feed
            .iter()
            .filter(|entry| entry.item.expires_at > now)
            .map(|entry| {
                let mut item = json!(entry.item);
                item["notification_status"] = entry.notification_status.clone().into();
                item["notification_version"] = entry.notification_version.into();
                if let Some(updated) = entry.notification_updated_at {
                    item["notification_updated_at"] = updated.into();
                }
                item
            })
            .collect();
        json!({"scope":"comfort","items":items})
    }
}

pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
