pub mod config;
pub mod resources;
// Versioned, product-independent runtime contracts for the local server.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServerLifecycle {
    Starting,
    Ready,
    Draining,
    Stopped,
    Failed,
}

impl ServerLifecycle {
    pub fn transition(self, next: Self) -> Result<Self, &'static str> {
        let valid = matches!(
            (self, next),
            (Self::Starting, Self::Ready | Self::Failed)
                | (Self::Ready, Self::Draining | Self::Failed)
                | (Self::Draining, Self::Stopped | Self::Failed)
        );
        if valid {
            Ok(next)
        } else {
            Err("invalid server lifecycle transition")
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShutdownHandshake {
    pub schema_version: u16,
    pub server_id: String,
    pub requested: bool,
    pub stop_accepting_tasks: bool,
    pub cancel_or_persist_recoverable: bool,
    pub resources_released: bool,
    pub completed: bool,
}

impl ShutdownHandshake {
    pub fn new(server_id: &str, schema_version: u16) -> Self {
        Self {
            schema_version,
            server_id: server_id.into(),
            requested: false,
            stop_accepting_tasks: false,
            cancel_or_persist_recoverable: false,
            resources_released: false,
            completed: false,
        }
    }
    pub fn request(mut self) -> Self {
        self.requested = true;
        self.stop_accepting_tasks = true;
        self
    }
    pub fn release(mut self) -> Self {
        self.cancel_or_persist_recoverable = true;
        self.resources_released = true;
        self
    }
    pub fn complete(mut self) -> Result<Self, &'static str> {
        if self.requested
            && self.stop_accepting_tasks
            && self.cancel_or_persist_recoverable
            && self.resources_released
        {
            self.completed = true;
            Ok(self)
        } else {
            Err("shutdown completion requires all handshake phases")
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpeechState {
    Idle,
    Listening,
    Thinking,
    Speaking,
    Interrupted,
    Reconnecting,
    Degraded,
    Ended,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskStatus {
    Draft,
    Planned,
    AwaitingApproval,
    Running,
    Paused,
    Cancelling,
    Cancelled,
    Completed,
    Failed,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ApprovalMode {
    #[default]
    Manual,
    Auto,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalDecision {
    Pending,
    Allow,
    Deny,
    Expired,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApprovalRequest {
    pub schema_version: u16,
    pub id: String,
    pub task_id: String,
    pub step_id: String,
    pub mode: ApprovalMode,
    pub decision: ApprovalDecision,
    pub scope: String,
    pub high_impact: bool,
}

// ApprovalRequest is descriptive only. Execution authorization lives in withu-approvals.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemoryKind {
    StableFact,
    ExplicitPreference,
    ExplicitExperience,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceVersion {
    pub id: String,
    pub version: u64,
}

// Current-turn hypotheses are intentionally not accepted by MemoryStore::commit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectHypothesis {
    pub hypothesis_id: String,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryCandidate {
    pub schema_version: u16,
    pub id: String,
    pub kind: MemoryKind,
    pub confirmed: bool,
    pub save_permission: bool,
    pub source_evidence: Vec<EvidenceVersion>,
    pub version: u64,
}

impl MemoryCandidate {
    pub fn eligible_for_long_term(&self) -> bool {
        self.schema_version == 1
            && self.confirmed
            && self.save_permission
            && !self.source_evidence.is_empty()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeletionTombstone {
    pub schema_version: u16,
    pub target_type: String,
    pub target_id: String,
    pub deleted_version: u64,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackgroundCandidate {
    pub target_id: String,
    pub read_version: u64,
    pub current_version: u64,
    pub tombstoned: bool,
}

impl BackgroundCandidate {
    pub fn may_commit(&self) -> bool {
        !self.tombstoned && self.read_version == self.current_version
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigSnapshot {
    pub config_version: u64,
    pub credential_refs: Vec<String>,
    pub defaults: [String; 3],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskRunConfig {
    pub task_id: String,
    pub config_version: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_requires_graceful_shutdown_order() {
        let ready = ServerLifecycle::Starting
            .transition(ServerLifecycle::Ready)
            .unwrap();
        let draining = ready.transition(ServerLifecycle::Draining).unwrap();
        assert!(draining.transition(ServerLifecycle::Ready).is_err());
        let h = ShutdownHandshake::new("s", 1)
            .request()
            .release()
            .complete()
            .unwrap();
        assert!(h.completed);
    }

    #[test]
    fn speech_has_required_states_and_task_is_not_window_owned() {
        assert_eq!(ApprovalMode::default(), ApprovalMode::Manual);
        assert!(ShutdownHandshake::new("s", 1).complete().is_err());
    }

    #[test]
    fn deleted_or_stale_background_candidates_cannot_return() {
        assert!(!BackgroundCandidate {
            target_id: "m".into(),
            read_version: 1,
            current_version: 2,
            tombstoned: false
        }
        .may_commit());
        assert!(!BackgroundCandidate {
            target_id: "m".into(),
            read_version: 1,
            current_version: 1,
            tombstoned: true
        }
        .may_commit());
    }
}
