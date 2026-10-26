use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use withu_approvals::{
    action_needs_explicit_allow, ActionGrant, ApprovalAuthority, ApprovalCard, ApprovalError,
};
use withu_connectors::{
    ActionCatalog, ActionCatalogError, ActionResult, ActionSpec, Cancellation, ConnectorRegistry,
    LocalActionAdapter, ReceiptErrorCode,
};
use withu_runtime::ApprovalMode;

pub use withu_connectors::ActionImpact;
pub use withu_connectors::{
    ActionSpecBuilder, ActionTarget, ParameterKind, ParameterRule, ParameterValue,
};

pub const PRIMARY_ONLY_CAPABILITIES: &[&str] = &[
    "relationship_memory_read",
    "relationship_memory_write",
    "approval_decide",
    "user_output",
];
pub const SPECIALIST_DENIED_CAPABILITIES: &[&str] = &[
    "relationship_memory_read",
    "relationship_memory_write",
    "approval_decide",
    "user_output",
    "external_side_effect",
];

pub fn specialist_can(capability: &str, allowlist: &[&str]) -> bool {
    allowlist.contains(&capability)
        && !SPECIALIST_DENIED_CAPABILITIES.contains(&capability)
        && ![
            ".write",
            ".delete",
            ".send",
            ".publish",
            ".purchase",
            ".pay",
            ".confirm",
        ]
        .iter()
        .any(|suffix| capability.ends_with(suffix))
}

/// Constructed by the trusted server from a user delegation, never inferred
/// from an emotion, model plan, connector response, or media audio.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DelegatedGoal {
    pub description: String,
    pub user_evidence_ref: String,
}

impl DelegatedGoal {
    pub fn new(description: &str, user_evidence_ref: &str) -> Self {
        Self {
            description: description.into(),
            user_evidence_ref: user_evidence_ref.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanPreview {
    pub schema_version: u16,
    pub task_id: String,
    pub goal: DelegatedGoal,
    pub actions: Vec<ActionSpec>,
    pub cancel_token: String,
    pub external_effects: bool,
    pub policy_version: u64,
    pub authorization_version: u64,
    pub created_at: u64,
}

impl PlanPreview {
    pub fn new(
        goal: DelegatedGoal,
        actions: Vec<ActionSpec>,
        policy_version: u64,
        authorization_version: u64,
        created_at: u64,
    ) -> Result<Self, ChainError> {
        if goal.description.trim().is_empty()
            || goal.user_evidence_ref.trim().is_empty()
            || policy_version == 0
            || authorization_version == 0
        {
            return Err(ChainError::Validation(
                "goal and versions are required".into(),
            ));
        }
        if actions.is_empty() {
            return Err(ChainError::Validation("plan must contain an action".into()));
        }
        let mut ids = HashSet::new();
        let mut idempotency = HashSet::new();
        let task_id = actions[0].task_id.clone();
        let cancel_token = actions[0].cancel_token.clone();
        for action in &actions {
            action
                .validate()
                .map_err(|error| ChainError::Validation(format!("invalid action: {error:?}")))?;
            if action.policy_version != policy_version
                || action.authorization_version != authorization_version
                || action.task_id != task_id
                || action.cancel_token != cancel_token
            {
                return Err(ChainError::VersionMismatch);
            }
            if !ids.insert(action.action_id.clone())
                || !idempotency.insert(action.idempotency_key.clone())
            {
                return Err(ChainError::Duplicate);
            }
        }
        Ok(Self {
            schema_version: 1,
            task_id,
            goal,
            actions,
            cancel_token,
            external_effects: false,
            policy_version,
            authorization_version,
            created_at,
        })
    }

    pub fn action(&self, action_id: &str) -> Option<&ActionSpec> {
        self.actions
            .iter()
            .find(|action| action.action_id == action_id)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptStatus {
    Applied,
    Failed,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorReceipt {
    pub schema_version: u16,
    pub action_id: String,
    pub code: ReceiptErrorCode,
    pub message: String,
    pub retryable: bool,
    pub committed_targets: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResultReceipt {
    pub summary: String,
    pub affected_targets: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionReceipt {
    pub schema_version: u16,
    pub action_id: String,
    pub idempotency_key: String,
    pub status: ReceiptStatus,
    pub result: Option<ResultReceipt>,
    pub error: Option<ErrorReceipt>,
    pub effect_committed: bool,
    pub observed_at: u64,
}

impl ActionReceipt {
    fn rejected(
        action: &ActionSpec,
        code: ReceiptErrorCode,
        message: impl Into<String>,
        now: u64,
    ) -> Self {
        Self {
            schema_version: 1,
            action_id: action.action_id.clone(),
            idempotency_key: action.idempotency_key.clone(),
            status: ReceiptStatus::Rejected,
            result: None,
            error: Some(ErrorReceipt {
                schema_version: 1,
                action_id: action.action_id.clone(),
                code,
                message: message.into(),
                retryable: false,
                committed_targets: vec![],
            }),
            effect_committed: false,
            observed_at: now,
        }
    }

    fn failed(action: &ActionSpec, error: ErrorReceipt, now: u64) -> Self {
        let effect_committed = !error.committed_targets.is_empty();
        Self {
            schema_version: 1,
            action_id: action.action_id.clone(),
            idempotency_key: action.idempotency_key.clone(),
            status: ReceiptStatus::Failed,
            result: None,
            error: Some(error),
            effect_committed,
            observed_at: now,
        }
    }

    fn applied(action: &ActionSpec, result: ActionResult, now: u64) -> Self {
        Self {
            schema_version: 1,
            action_id: action.action_id.clone(),
            idempotency_key: action.idempotency_key.clone(),
            status: ReceiptStatus::Applied,
            result: Some(ResultReceipt {
                summary: result.summary,
                affected_targets: result.affected_targets,
            }),
            error: None,
            effect_committed: !action.impact.is_read_only(),
            observed_at: now,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanReport {
    pub goal: DelegatedGoal,
    pub receipts: Vec<ActionReceipt>,
    pub completed_effects: Vec<String>,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ChainError {
    Validation(String),
    VersionMismatch,
    Duplicate,
    MissingAction,
    MissingApproval,
    Approval(ApprovalError),
    Connector(ReceiptErrorCode),
}

/// The minimal Comfort execution chain.  It only accepts a fake/local adapter;
/// a real network connector must be introduced behind a separately reviewed
/// adapter that preserves this validation and receipt boundary.
pub struct ActionChain<A: LocalActionAdapter> {
    pub approvals: ApprovalAuthority,
    pub connectors: ConnectorRegistry,
    pub adapter: A,
    pub catalog: ActionCatalog,
    receipts: HashMap<String, ActionReceipt>,
    idempotency: HashMap<String, String>,
    cancellations: HashMap<String, Cancellation>,
    audit_receipts: Vec<ActionReceipt>,
    app_running: bool,
}

impl<A: LocalActionAdapter> ActionChain<A> {
    pub fn new(connectors: ConnectorRegistry, catalog: ActionCatalog, adapter: A) -> Self {
        Self {
            approvals: ApprovalAuthority::default(),
            connectors,
            adapter,
            catalog,
            receipts: HashMap::new(),
            idempotency: HashMap::new(),
            cancellations: HashMap::new(),
            audit_receipts: Vec::new(),
            app_running: true,
        }
    }

    pub fn preview(
        &self,
        goal: DelegatedGoal,
        actions: Vec<ActionSpec>,
        policy_version: u64,
        authorization_version: u64,
        now: u64,
    ) -> Result<PlanPreview, ChainError> {
        // This method is intentionally read-only: no connector or adapter is
        // touched while the user is only inspecting a plan.
        let plan = PlanPreview::new(goal, actions, policy_version, authorization_version, now)?;
        if policy_version != self.catalog.policy_version() {
            return Err(ChainError::VersionMismatch);
        }
        for action in &plan.actions {
            self.catalog.validate(action).map_err(map_catalog_error)?;
        }
        Ok(plan)
    }

    pub fn request_approval(
        &mut self,
        plan: &PlanPreview,
        action_id: &str,
        mode: ApprovalMode,
        now: u64,
    ) -> Result<ApprovalCard, ChainError> {
        let action = plan
            .action(action_id)
            .ok_or(ChainError::MissingAction)?
            .clone();
        if now >= action.expires_at {
            return Err(ChainError::Connector(ReceiptErrorCode::Expired));
        }
        let permission = self
            .connectors
            .authorize(&action)
            .map_err(ChainError::Connector)?;
        self.catalog.validate(&action).map_err(map_catalog_error)?;
        let needs_allow = self.catalog.is_always_explicit(&action.operation)
            || action_needs_explicit_allow(mode, &action, permission);
        let card = ApprovalCard {
            schema_version: 1,
            approval_id: format!("approval:{}", action.action_id),
            action: action.clone(),
            mode,
            decision: if needs_allow {
                withu_runtime::ApprovalDecision::Pending
            } else {
                withu_runtime::ApprovalDecision::Allow
            },
            policy_version: action.policy_version,
            authorization_version: action.authorization_version,
            expires_at: action.expires_at,
            explicit_user_allow: false,
            decided_at: if needs_allow { None } else { Some(now) },
        };
        self.approvals
            .record_card(card.clone())
            .map_err(ChainError::Approval)?;
        Ok(card)
    }

    pub fn decide(
        &mut self,
        approval_id: &str,
        decision: withu_runtime::ApprovalDecision,
        explicit_user_allow: bool,
        now: u64,
    ) -> Result<ApprovalCard, ChainError> {
        self.approvals
            .decide_card(approval_id, decision, explicit_user_allow, now)
            .map_err(ChainError::Approval)
    }

    pub fn cancel(&mut self, cancel_token: &str) {
        if !cancel_token.is_empty() {
            self.cancellation(cancel_token).cancel();
        }
    }

    pub fn cancellation(&mut self, cancel_token: &str) -> Cancellation {
        self.cancellations
            .entry(cancel_token.into())
            .or_default()
            .clone()
    }

    pub fn cancel_plan(&mut self, plan: &PlanPreview) {
        for action in &plan.actions {
            self.cancel(&action.cancel_token);
        }
    }

    pub fn stop_accepting_work(&mut self) {
        self.app_running = false;
        for cancellation in self.cancellations.values() {
            cancellation.cancel();
        }
    }

    pub fn execute(
        &mut self,
        plan: &PlanPreview,
        action_id: &str,
        now: u64,
    ) -> Result<ActionReceipt, ChainError> {
        let action = plan
            .action(action_id)
            .ok_or(ChainError::MissingAction)?
            .clone();
        if self.idempotency.contains_key(&action.idempotency_key) {
            return Ok(ActionReceipt::rejected(
                &action,
                ReceiptErrorCode::Duplicate,
                "idempotency key was already submitted",
                now,
            ));
        }
        if !self.app_running {
            return Ok(self.store_receipt(ActionReceipt::rejected(
                &action,
                ReceiptErrorCode::Lifecycle,
                "application is shutting down",
                now,
            )));
        }
        let cancellation = self.cancellation(&action.cancel_token);
        if cancellation.is_cancelled() {
            return Ok(self.store_receipt(ActionReceipt::rejected(
                &action,
                ReceiptErrorCode::Cancelled,
                "cancelled before connector submission",
                now,
            )));
        }
        if now >= action.expires_at {
            return Ok(self.store_receipt(ActionReceipt::rejected(
                &action,
                ReceiptErrorCode::Expired,
                "approval card expired",
                now,
            )));
        }
        if let Err(error) = action.validate() {
            return Ok(ActionReceipt::rejected(
                &action,
                ReceiptErrorCode::Validation,
                format!("invalid action: {error:?}"),
                now,
            ));
        }
        if let Err(error) = self.catalog.validate(&action) {
            let code = match error {
                ActionCatalogError::PolicyVersionMismatch => ReceiptErrorCode::Version,
                _ => ReceiptErrorCode::Scope,
            };
            return Ok(ActionReceipt::rejected(
                &action,
                code,
                "action does not match server policy",
                now,
            ));
        }
        if plan.policy_version != self.catalog.policy_version() {
            return Ok(self.store_receipt(ActionReceipt::rejected(
                &action,
                ReceiptErrorCode::Version,
                "policy version changed after preview",
                now,
            )));
        }
        if let Err(code) = self.connectors.authorize(&action) {
            return Ok(ActionReceipt::rejected(
                &action,
                code,
                "connector scope or authorization rejected",
                now,
            ));
        }
        let grant = self.approvals.issue_for_action(
            &action,
            now,
            plan.policy_version,
            plan.authorization_version,
        );
        let grant: ActionGrant = match grant {
            Ok(grant) => grant,
            Err(error) => {
                return Ok(ActionReceipt::rejected(
                    &action,
                    error.code(),
                    format!("approval did not authorize this action: {error:?}"),
                    now,
                ))
            }
        };
        self.approvals
            .consume_action(
                &grant,
                &action,
                now,
                plan.policy_version,
                plan.authorization_version,
            )
            .map_err(ChainError::Approval)?;
        if self.idempotency.contains_key(&action.idempotency_key) {
            return Ok(ActionReceipt::rejected(
                &action,
                ReceiptErrorCode::Duplicate,
                "idempotency key was already submitted",
                now,
            ));
        }
        self.idempotency
            .insert(action.idempotency_key.clone(), action.action_id.clone());
        let allowed_targets = action
            .targets
            .iter()
            .map(|target| target.object_id.as_str())
            .collect::<HashSet<_>>();
        let receipt = match self.adapter.execute(&action, &cancellation) {
            Ok(result)
                if result
                    .affected_targets
                    .iter()
                    .all(|target| allowed_targets.contains(target.as_str())) =>
            {
                ActionReceipt::applied(&action, result, now)
            }
            Ok(result) => ActionReceipt::failed(
                &action,
                ErrorReceipt {
                    schema_version: 1,
                    action_id: action.action_id.clone(),
                    code: ReceiptErrorCode::Scope,
                    message: "adapter reported targets outside the approved scope".into(),
                    retryable: false,
                    committed_targets: result.affected_targets,
                },
                now,
            ),
            Err(error) => ActionReceipt::failed(
                &action,
                ErrorReceipt {
                    schema_version: 1,
                    action_id: action.action_id.clone(),
                    code: error.code,
                    message: error.message,
                    retryable: matches!(error.code, ReceiptErrorCode::ConnectorFailure),
                    committed_targets: error.committed_targets,
                },
                now,
            ),
        };
        Ok(self.store_receipt(receipt))
    }

    pub fn run_plan(&mut self, plan: &PlanPreview, now: u64) -> PlanReport {
        let mut receipts = Vec::with_capacity(plan.actions.len());
        let mut completed_effects = Vec::new();
        for action in &plan.actions {
            match self.execute(plan, &action.action_id, now) {
                Ok(receipt) => {
                    if receipt.effect_committed {
                        completed_effects.push(receipt.action_id.clone());
                    }
                    receipts.push(receipt);
                }
                Err(error) => receipts.push(ActionReceipt::rejected(
                    action,
                    ReceiptErrorCode::Authorization,
                    format!("action not executed: {error:?}"),
                    now,
                )),
            }
        }
        PlanReport {
            goal: plan.goal.clone(),
            receipts,
            completed_effects,
            cancelled: plan.actions.iter().any(|action| {
                self.cancellations
                    .get(&action.cancel_token)
                    .is_some_and(Cancellation::is_cancelled)
            }),
        }
    }

    fn store_receipt(&mut self, receipt: ActionReceipt) -> ActionReceipt {
        self.receipts
            .insert(receipt.action_id.clone(), receipt.clone());
        self.audit_receipts.push(receipt.clone());
        receipt
    }

    pub fn receipts(&self) -> &[ActionReceipt] {
        &self.audit_receipts
    }
}

fn map_catalog_error(error: ActionCatalogError) -> ChainError {
    match error {
        ActionCatalogError::PolicyVersionMismatch => ChainError::VersionMismatch,
        ActionCatalogError::InvalidDefinition
        | ActionCatalogError::DuplicateOperation
        | ActionCatalogError::DefinitionMismatch => ChainError::Connector(ReceiptErrorCode::Scope),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpecialistRequest {
    pub specialist_id: String,
    pub task_id: String,
    pub context_ref: String,
    pub tool_allowlist: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpecialistCandidate {
    pub specialist_id: String,
    pub task_id: String,
    pub result_ref: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpecialistError {
    MissingIdentity,
    ForbiddenCapability,
    SideEffectNotAllowed,
}

impl SpecialistRequest {
    pub fn validate(&self) -> Result<(), SpecialistError> {
        if self.specialist_id.is_empty() || self.task_id.is_empty() || self.context_ref.is_empty() {
            return Err(SpecialistError::MissingIdentity);
        }
        if self
            .tool_allowlist
            .iter()
            .any(|capability| SPECIALIST_DENIED_CAPABILITIES.contains(&capability.as_str()))
        {
            return Err(SpecialistError::ForbiddenCapability);
        }
        Ok(())
    }

    pub fn candidate(
        &self,
        capability: &str,
        action: &ActionSpec,
        result_ref: &str,
    ) -> Result<SpecialistCandidate, SpecialistError> {
        self.validate()?;
        if !self.tool_allowlist.iter().any(|item| item == capability) {
            return Err(SpecialistError::ForbiddenCapability);
        }
        if !action.impact.is_read_only() || action.connector_id.is_empty() {
            return Err(SpecialistError::SideEffectNotAllowed);
        }
        if withu_connectors::ALWAYS_EXPLICIT_OPERATIONS.contains(&action.operation.as_str()) {
            return Err(SpecialistError::SideEffectNotAllowed);
        }
        Ok(SpecialistCandidate {
            specialist_id: self.specialist_id.clone(),
            task_id: self.task_id.clone(),
            result_ref: result_ref.into(),
        })
    }
}

#[derive(Default)]
pub struct TeamCancellation {
    pub cancelled: bool,
    pub dispatch_stopped: bool,
    pub partial_artifacts: Vec<String>,
    pub completed_effects: Vec<String>,
}

impl TeamCancellation {
    pub fn cancel(&mut self) {
        self.cancelled = true;
        self.dispatch_stopped = true;
        self.partial_artifacts.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use withu_connectors::{Connector, FakeLocalAdapter, PermissionState};

    fn read_action(id: &str) -> ActionSpec {
        ActionSpecBuilder::new(id, "task", id, "search")
            .target("query", "q", 1)
            .connector("local", "search.read")
            .impact(ActionImpact::ReadOnly)
            .safe_for_auto(true)
            .data_scope(["query:q"])
            .versions(1, 1, 1)
            .expires_at(100)
            .idempotency(&format!("idem-{id}"))
            .cancel_token(&format!("cancel-{id}"))
            .build()
            .unwrap()
    }

    fn write_action(id: &str) -> ActionSpec {
        ActionSpecBuilder::new(id, "task", id, "send_message")
            .target("message", "m", 1)
            .connector("local", "message.write")
            .impact(ActionImpact::ExternalSideEffect)
            .data_scope(["message:m"])
            .versions(1, 1, 1)
            .expires_at(100)
            .idempotency(&format!("idem-{id}"))
            .cancel_token(&format!("cancel-{id}"))
            .build()
            .unwrap()
    }

    fn chain() -> ActionChain<FakeLocalAdapter> {
        let mut connectors = ConnectorRegistry::default();
        connectors.register_fake_local(
            Connector {
                id: "local".into(),
                capabilities: vec!["search.read".into(), "message.write".into()],
                permission: PermissionState::AlwaysAllow,
                credential_ref: None,
            },
            1,
        );
        connectors.set_target_version("local", "query", "q", 1);
        connectors.set_target_version("local", "message", "m", 1);
        connectors.set_data_scope("local", &["query:q", "message:m"]);
        let mut catalog = ActionCatalog::new(1).unwrap();
        catalog
            .register(withu_connectors::ActionDefinition {
                operation: "search".into(),
                connector_id: "local".into(),
                capability: "search.read".into(),
                impact: ActionImpact::ReadOnly,
                safe_for_auto: true,
                action_version: 1,
                parameter_rules: std::collections::BTreeMap::new(),
            })
            .unwrap();
        catalog
            .register(withu_connectors::ActionDefinition {
                operation: "send_message".into(),
                connector_id: "local".into(),
                capability: "message.write".into(),
                impact: ActionImpact::ExternalSideEffect,
                safe_for_auto: false,
                action_version: 1,
                parameter_rules: std::collections::BTreeMap::new(),
            })
            .unwrap();
        ActionChain::new(connectors, catalog, FakeLocalAdapter::default())
    }

    #[test]
    fn auto_read_only_runs_after_preview_without_user_allow() {
        let mut chain = chain();
        let plan = chain
            .preview(
                DelegatedGoal::new("find", "user-turn-1"),
                vec![read_action("r")],
                1,
                1,
                1,
            )
            .unwrap();
        let card = chain
            .request_approval(&plan, "r", ApprovalMode::Auto, 2)
            .unwrap();
        assert_eq!(card.decision, withu_runtime::ApprovalDecision::Allow);
        let receipt = chain.execute(&plan, "r", 2).unwrap();
        assert_eq!(receipt.status, ReceiptStatus::Applied);
        assert!(chain.adapter.effects.is_empty());
    }

    #[test]
    fn write_requires_each_explicit_allow_and_duplicate_is_side_effect_free() {
        let mut chain = chain();
        let plan = chain
            .preview(
                DelegatedGoal::new("send", "user-turn-2"),
                vec![write_action("w")],
                1,
                1,
                1,
            )
            .unwrap();
        let card = chain
            .request_approval(&plan, "w", ApprovalMode::Auto, 2)
            .unwrap();
        assert_eq!(card.decision, withu_runtime::ApprovalDecision::Pending);
        let pending = chain.execute(&plan, "w", 2).unwrap();
        assert_eq!(pending.status, ReceiptStatus::Rejected);
        assert_eq!(pending.error.unwrap().code, ReceiptErrorCode::Authorization);
        chain
            .decide(
                &card.approval_id,
                withu_runtime::ApprovalDecision::Allow,
                true,
                2,
            )
            .unwrap();
        let applied = chain.execute(&plan, "w", 2).unwrap();
        assert_eq!(applied.status, ReceiptStatus::Applied);
        let duplicate = chain.execute(&plan, "w", 2).unwrap();
        assert_eq!(duplicate.error.unwrap().code, ReceiptErrorCode::Duplicate);
        assert_eq!(chain.adapter.effects.len(), 1);
    }

    #[test]
    fn cancellation_before_submission_has_no_effect_and_specialist_cannot_side_effect() {
        let mut chain = chain();
        let action = write_action("w");
        let plan = chain
            .preview(
                DelegatedGoal::new("send", "user-turn-3"),
                vec![action.clone()],
                1,
                1,
                1,
            )
            .unwrap();
        let card = chain
            .request_approval(&plan, "w", ApprovalMode::Manual, 2)
            .unwrap();
        chain
            .decide(
                &card.approval_id,
                withu_runtime::ApprovalDecision::Allow,
                true,
                2,
            )
            .unwrap();
        chain.cancel("cancel-w");
        let receipt = chain.execute(&plan, "w", 2).unwrap();
        assert_eq!(receipt.error.unwrap().code, ReceiptErrorCode::Cancelled);
        assert!(chain.adapter.effects.is_empty());
        let specialist = SpecialistRequest {
            specialist_id: "s".into(),
            task_id: "task".into(),
            context_ref: "ctx".into(),
            tool_allowlist: vec!["message.write".into()],
        };
        assert!(specialist.validate().is_ok());
        assert_eq!(
            specialist.candidate("message.write", &action, "candidate"),
            Err(SpecialistError::SideEffectNotAllowed)
        );
    }

    #[test]
    fn failure_is_reported_without_claiming_success() {
        let mut chain = chain();
        chain
            .adapter
            .fail_next(ReceiptErrorCode::ConnectorFailure, "fixture failed");
        let action = read_action("r");
        let plan = chain
            .preview(
                DelegatedGoal::new("find", "user-turn-4"),
                vec![action],
                1,
                1,
                1,
            )
            .unwrap();
        chain
            .request_approval(&plan, "r", ApprovalMode::Auto, 2)
            .unwrap();
        let receipt = chain.execute(&plan, "r", 2).unwrap();
        assert_eq!(receipt.status, ReceiptStatus::Failed);
        assert!(!receipt.effect_committed);
    }

    #[test]
    fn cancellation_keeps_already_committed_effects() {
        let mut cancellation = TeamCancellation {
            partial_artifacts: vec!["candidate".into()],
            completed_effects: vec!["action-w".into()],
            ..Default::default()
        };
        cancellation.cancel();
        assert!(cancellation.partial_artifacts.is_empty());
        assert_eq!(cancellation.completed_effects, vec!["action-w"]);
    }
}
