use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use withu_connectors::{ActionSpec, ConnectorPermission, ReceiptErrorCode};
pub use withu_runtime::{ApprovalDecision, ApprovalMode};

pub const DEFAULT_MODE: ApprovalMode = ApprovalMode::Manual;

/// The legacy scope remains available for the existing v1 approval wire.  It is
/// deliberately exact: an approval never covers a broader target or parameter
/// set than the record names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActionScope {
    pub task_id: String,
    pub step_id: String,
    pub action: String,
    pub target_ids: Vec<String>,
    pub parameters_digest: String,
}

#[derive(Clone, Debug)]
pub struct ApprovalRecord {
    pub approval_id: String,
    pub scope: ActionScope,
    pub mode: ApprovalMode,
    pub decision: ApprovalDecision,
    pub high_impact: bool,
    pub explicit_user_allow: bool,
    pub policy_version: u64,
    pub authorization_version: u64,
    pub expires_at: u64,
}

/// A v1-compatible approval card for the typed action contract.  The action is
/// stored by value so later edits cannot widen the approval scope.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovalCard {
    pub schema_version: u16,
    pub approval_id: String,
    pub action: ActionSpec,
    #[serde(with = "ApprovalModeDef")]
    pub mode: ApprovalMode,
    #[serde(with = "ApprovalDecisionDef")]
    pub decision: ApprovalDecision,
    pub policy_version: u64,
    pub authorization_version: u64,
    pub expires_at: u64,
    pub explicit_user_allow: bool,
    pub decided_at: Option<u64>,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "ApprovalMode", rename_all = "snake_case")]
enum ApprovalModeDef {
    Manual,
    Auto,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "ApprovalDecision", rename_all = "snake_case")]
enum ApprovalDecisionDef {
    Pending,
    Allow,
    Deny,
    Expired,
}

/// Opaque and non-Clone: only the approval authority can issue an execution
/// grant.  A grant is single-use and is bound to the exact action value.
/// ```compile_fail
/// use withu_approvals::AllowGrant;
/// let grant = AllowGrant { approval_id: String::from("a") };
/// ```
/// ```compile_fail
/// fn copy(grant: withu_approvals::AllowGrant) { let _ = grant.clone(); }
/// ```
pub struct AllowGrant {
    token: Arc<()>,
    approval_id: String,
}

/// A typed grant has the same single-use semantics as the legacy grant, but is
/// kept separate so callers cannot accidentally mix the two contracts.
/// ```compile_fail
/// fn copy(grant: withu_approvals::ActionGrant) { let _ = grant.clone(); }
/// ```
pub struct ActionGrant {
    token: Arc<()>,
    approval_id: String,
    action_id: String,
    idempotency_key: String,
}

struct StoredApproval {
    token: Arc<()>,
    record: ApprovalRecord,
    issued: bool,
    consumed: bool,
}

struct StoredCard {
    token: Arc<()>,
    card: ApprovalCard,
    issued: bool,
    consumed: bool,
}

#[derive(Default)]
pub struct ApprovalAuthority {
    records: HashMap<String, StoredApproval>,
    cards: HashMap<String, StoredCard>,
}

impl ApprovalAuthority {
    /// Server accepts a record only after validating the originating user
    /// decision. Re-import cannot reset issued or consumed state.
    pub fn record(&mut self, r: ApprovalRecord) -> bool {
        if r.approval_id.is_empty() || self.records.contains_key(&r.approval_id) {
            return false;
        }
        self.records.insert(
            r.approval_id.clone(),
            StoredApproval {
                token: Arc::new(()),
                record: r,
                issued: false,
                consumed: false,
            },
        );
        true
    }

    pub fn issue(&mut self, id: &str, now: u64) -> Option<AllowGrant> {
        let stored = self.records.get_mut(id)?;
        let r = &stored.record;
        if stored.issued
            || r.decision != ApprovalDecision::Allow
            || !r.explicit_user_allow
            || now >= r.expires_at
        {
            return None;
        }
        stored.issued = true;
        Some(AllowGrant {
            token: Arc::clone(&stored.token),
            approval_id: id.into(),
        })
    }

    pub fn revoke(&mut self, id: &str) {
        if let Some(s) = self.records.get_mut(id) {
            s.record.decision = ApprovalDecision::Deny;
        }
    }

    /// Sole legacy execution-permission entry point. Receipt creation remains
    /// outside this authority; this function only consumes authorization.
    pub fn consume(
        &mut self,
        grant: &AllowGrant,
        scope: &ActionScope,
        policy: u64,
        authorization: u64,
        now: u64,
    ) -> bool {
        let Some(s) = self.records.get_mut(&grant.approval_id) else {
            return false;
        };
        let r = &s.record;
        if !Arc::ptr_eq(&s.token, &grant.token)
            || !s.issued
            || s.consumed
            || r.decision != ApprovalDecision::Allow
            || !r.explicit_user_allow
            || &r.scope != scope
            || r.policy_version != policy
            || r.authorization_version != authorization
            || now >= r.expires_at
        {
            return false;
        }
        s.consumed = true;
        true
    }

    /// Store one approval card for one action.  Cards are indexed by action id
    /// as well as approval id so the executor can never select a neighbouring
    /// step by accident.
    pub fn record_card(&mut self, card: ApprovalCard) -> Result<(), ApprovalError> {
        if card.schema_version != 1
            || card.approval_id.is_empty()
            || card.action.validate().is_err()
            || card.policy_version != card.action.policy_version
            || card.authorization_version != card.action.authorization_version
            || card.expires_at != card.action.expires_at
        {
            return Err(ApprovalError::InvalidCard);
        }
        if self.cards.contains_key(&card.approval_id)
            || self
                .cards
                .values()
                .any(|stored| stored.card.action.action_id == card.action.action_id)
        {
            return Err(ApprovalError::Duplicate);
        }
        if card.decision == ApprovalDecision::Allow
            && !card.explicit_user_allow
            && !(card.mode == ApprovalMode::Auto
                && card.action.impact.is_read_only()
                && card.action.safe_for_auto)
        {
            return Err(ApprovalError::ExplicitAllowRequired);
        }
        if card.action.policy_version == 0 || card.action.authorization_version == 0 {
            return Err(ApprovalError::InvalidCard);
        }
        self.cards.insert(
            card.approval_id.clone(),
            StoredCard {
                token: Arc::new(()),
                card,
                issued: false,
                consumed: false,
            },
        );
        Ok(())
    }

    pub fn revoke_card(&mut self, approval_id: &str) {
        if let Some(stored) = self.cards.get_mut(approval_id) {
            stored.card.decision = ApprovalDecision::Deny;
        }
    }

    pub fn decide_card(
        &mut self,
        approval_id: &str,
        decision: ApprovalDecision,
        explicit_user_decision: bool,
        now: u64,
    ) -> Result<ApprovalCard, ApprovalError> {
        let stored = self
            .cards
            .get_mut(approval_id)
            .ok_or(ApprovalError::Missing)?;
        if now >= stored.card.action.expires_at {
            return Err(ApprovalError::Expired);
        }
        if stored.issued || stored.consumed || stored.card.decision != ApprovalDecision::Pending {
            return Err(ApprovalError::AlreadyUsed);
        }
        if !matches!(decision, ApprovalDecision::Allow | ApprovalDecision::Deny)
            || decision == ApprovalDecision::Allow && !explicit_user_decision
        {
            return Err(ApprovalError::ExplicitAllowRequired);
        }
        stored.card.decision = decision;
        stored.card.explicit_user_allow =
            decision == ApprovalDecision::Allow && explicit_user_decision;
        stored.card.decided_at = Some(now);
        Ok(stored.card.clone())
    }

    pub fn issue_for_action(
        &mut self,
        action: &ActionSpec,
        now: u64,
        policy_version: u64,
        authorization_version: u64,
    ) -> Result<ActionGrant, ApprovalError> {
        let stored = self
            .cards
            .values_mut()
            .find(|stored| stored.card.action.action_id == action.action_id)
            .ok_or(ApprovalError::Missing)?;
        let card = &stored.card;
        if stored.issued || stored.consumed {
            return Err(ApprovalError::AlreadyUsed);
        }
        if card.decision == ApprovalDecision::Deny {
            return Err(ApprovalError::Denied);
        }
        if card.decision != ApprovalDecision::Allow {
            return Err(ApprovalError::AwaitingDecision);
        }
        let auto_read_only =
            card.mode == ApprovalMode::Auto && action.impact.is_read_only() && action.safe_for_auto;
        if now >= card.action.expires_at {
            return Err(ApprovalError::Expired);
        }
        if card.action.policy_version != policy_version
            || card.action.authorization_version != authorization_version
        {
            return Err(ApprovalError::Version);
        }
        if card.action != *action || !card.explicit_user_allow && !auto_read_only {
            return Err(ApprovalError::ScopeOrVersion);
        }
        stored.issued = true;
        Ok(ActionGrant {
            token: Arc::clone(&stored.token),
            approval_id: card.approval_id.clone(),
            action_id: action.action_id.clone(),
            idempotency_key: action.idempotency_key.clone(),
        })
    }

    pub fn consume_action(
        &mut self,
        grant: &ActionGrant,
        action: &ActionSpec,
        now: u64,
        policy_version: u64,
        authorization_version: u64,
    ) -> Result<(), ApprovalError> {
        let stored = self
            .cards
            .get_mut(&grant.approval_id)
            .ok_or(ApprovalError::Missing)?;
        let card = &stored.card;
        if !Arc::ptr_eq(&stored.token, &grant.token)
            || !stored.issued
            || stored.consumed
            || grant.action_id != action.action_id
            || grant.idempotency_key != action.idempotency_key
            || card.action != *action
            || card.decision != ApprovalDecision::Allow
            || !card.explicit_user_allow
                && !(card.mode == ApprovalMode::Auto
                    && action.impact.is_read_only()
                    && action.safe_for_auto)
            || card.action.policy_version != policy_version
            || card.action.authorization_version != authorization_version
            || now >= card.action.expires_at
        {
            return Err(ApprovalError::ScopeOrVersion);
        }
        stored.consumed = true;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalError {
    InvalidCard,
    Duplicate,
    ExplicitAllowRequired,
    Missing,
    AlreadyUsed,
    AwaitingDecision,
    Denied,
    Expired,
    Version,
    ScopeOrVersion,
}

impl ApprovalError {
    pub fn code(self) -> ReceiptErrorCode {
        match self {
            Self::InvalidCard => ReceiptErrorCode::Validation,
            Self::Duplicate | Self::AlreadyUsed => ReceiptErrorCode::Duplicate,
            Self::ExplicitAllowRequired
            | Self::Missing
            | Self::AwaitingDecision
            | Self::ScopeOrVersion => ReceiptErrorCode::Authorization,
            Self::Denied => ReceiptErrorCode::Authorization,
            Self::Expired => ReceiptErrorCode::Expired,
            Self::Version => ReceiptErrorCode::Version,
        }
    }
}

/// Manual is the default. Auto can continue only for an explicitly safe,
/// read-only connector action. Every other action is individually approved.
pub fn needs_explicit_allow(
    mode: ApprovalMode,
    read_only: bool,
    high_impact: bool,
    rule_safe: bool,
) -> bool {
    high_impact || mode == ApprovalMode::Manual || !read_only || !rule_safe
}

pub fn action_needs_explicit_allow(
    mode: ApprovalMode,
    action: &ActionSpec,
    connector_permission: ConnectorPermission,
) -> bool {
    let safe_read_only = action.impact.is_read_only()
        && connector_permission == ConnectorPermission::AlwaysAllow
        && action.safe_for_auto;
    needs_explicit_allow(
        mode,
        action.impact.is_read_only(),
        action.impact.is_high_impact(),
        safe_read_only,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use withu_connectors::{ActionImpact, ActionSpecBuilder};

    fn scope() -> ActionScope {
        ActionScope {
            task_id: "t".into(),
            step_id: "s".into(),
            action: "send_message".into(),
            target_ids: vec!["recipient".into()],
            parameters_digest: "body-1".into(),
        }
    }

    fn record() -> ApprovalRecord {
        ApprovalRecord {
            approval_id: "a".into(),
            scope: scope(),
            mode: ApprovalMode::Auto,
            decision: ApprovalDecision::Allow,
            high_impact: true,
            explicit_user_allow: true,
            policy_version: 1,
            authorization_version: 1,
            expires_at: 100,
        }
    }

    fn typed_action() -> ActionSpec {
        ActionSpecBuilder::new("a1", "t", "s", "send_message")
            .target("message", "m1", 1)
            .parameter(
                "body",
                withu_connectors::ParameterValue::Text("body-1".into()),
                withu_connectors::ParameterRule {
                    kind: withu_connectors::ParameterKind::Text,
                    required: true,
                    max_string_length: Some(512),
                    min_integer: None,
                    max_integer: None,
                    allowed_strings: vec![],
                },
            )
            .connector("fake", "message.write")
            .impact(ActionImpact::ExternalSideEffect)
            .data_scope(["message:m1"])
            .versions(1, 1, 1)
            .expires_at(100)
            .idempotency("idem-a1")
            .cancel_token("cancel-t")
            .build()
            .unwrap()
    }

    #[test]
    fn default_and_auto_high_impact_require_explicit_allow() {
        assert_eq!(ApprovalMode::default(), DEFAULT_MODE);
        assert!(needs_explicit_allow(ApprovalMode::Auto, false, true, true));
        let mut a = ApprovalAuthority::default();
        let mut r = record();
        r.explicit_user_allow = false;
        assert!(a.record(r));
        assert!(a.issue("a", 1).is_none());
    }

    #[test]
    fn task_step_parameters_targets_versions_and_expiry_are_bound() {
        let mut a = ApprovalAuthority::default();
        assert!(a.record(record()));
        let g = a.issue("a", 1).unwrap();
        for changed in 0..5 {
            let mut s = scope();
            match changed {
                0 => s.task_id = "other".into(),
                1 => s.step_id = "other".into(),
                2 => s.parameters_digest = "body-2".into(),
                3 => s.target_ids.push("other".into()),
                _ => s.action = "publish".into(),
            }
            assert!(!a.consume(&g, &s, 1, 1, 1));
        }
        assert!(!a.consume(&g, &scope(), 2, 1, 1));
        assert!(!a.consume(&g, &scope(), 1, 2, 1));
        assert!(!a.consume(&g, &scope(), 1, 1, 100));
        assert!(a.consume(&g, &scope(), 1, 1, 1));
        assert!(!a.consume(&g, &scope(), 1, 1, 1));
        assert!(a.issue("a", 1).is_none());
        assert!(!a.record(record()));
    }

    #[test]
    fn authorization_revocation_invalidates_grant() {
        let mut a = ApprovalAuthority::default();
        a.record(record());
        let g = a.issue("a", 1).unwrap();
        a.revoke("a");
        assert!(!a.consume(&g, &scope(), 1, 1, 1));
    }

    #[test]
    fn typed_card_is_exactly_one_action() {
        let action = typed_action();
        let mut authority = ApprovalAuthority::default();
        authority
            .record_card(ApprovalCard {
                schema_version: 1,
                approval_id: "approval-a1".into(),
                action: action.clone(),
                mode: ApprovalMode::Manual,
                decision: ApprovalDecision::Allow,
                policy_version: 1,
                authorization_version: 1,
                expires_at: 100,
                explicit_user_allow: true,
                decided_at: Some(1),
            })
            .unwrap();
        let grant = authority.issue_for_action(&action, 2, 1, 1).unwrap();
        assert!(authority.consume_action(&grant, &action, 2, 1, 1).is_ok());
        assert!(authority.issue_for_action(&action, 2, 1, 1).is_err());
    }
}
