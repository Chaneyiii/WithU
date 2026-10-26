use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    AlwaysAllow,
    NeedsApproval,
    Blocked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorTransport {
    FakeLocal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connector {
    pub id: String,
    pub capabilities: Vec<String>,
    pub permission: PermissionState,
    pub credential_ref: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionImpact {
    ReadOnly,
    Write,
    Delete,
    ExternalSideEffect,
    HighImpact,
}

impl ActionImpact {
    pub fn is_read_only(self) -> bool {
        self == Self::ReadOnly
    }

    pub fn is_high_impact(self) -> bool {
        matches!(
            self,
            Self::Delete | Self::ExternalSideEffect | Self::HighImpact
        )
    }
}

pub const ALWAYS_EXPLICIT_OPERATIONS: &[&str] = &[
    "send_message",
    "publish",
    "purchase",
    "buy",
    "payment",
    "pay",
    "appointment_confirm",
    "permanent_delete",
    "delete",
    "account_change",
    "account_update",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionDefinition {
    pub operation: String,
    pub connector_id: String,
    pub capability: String,
    pub impact: ActionImpact,
    pub safe_for_auto: bool,
    pub action_version: u64,
    pub parameter_rules: BTreeMap<String, ParameterRule>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionCatalogError {
    InvalidDefinition,
    DuplicateOperation,
    PolicyVersionMismatch,
    DefinitionMismatch,
}

pub struct ActionCatalog {
    policy_version: u64,
    definitions: HashMap<String, ActionDefinition>,
}

impl ActionCatalog {
    pub fn new(policy_version: u64) -> Result<Self, ActionCatalogError> {
        if policy_version == 0 {
            return Err(ActionCatalogError::InvalidDefinition);
        }
        Ok(Self {
            policy_version,
            definitions: HashMap::new(),
        })
    }

    pub fn policy_version(&self) -> u64 {
        self.policy_version
    }

    pub fn set_policy_version(&mut self, version: u64) -> Result<(), ActionCatalogError> {
        if version == 0 {
            return Err(ActionCatalogError::InvalidDefinition);
        }
        if version <= self.policy_version {
            return Err(ActionCatalogError::InvalidDefinition);
        }
        self.policy_version = version;
        Ok(())
    }

    pub fn register(&mut self, definition: ActionDefinition) -> Result<(), ActionCatalogError> {
        if definition.operation.is_empty()
            || definition.connector_id.is_empty()
            || definition.capability.is_empty()
            || definition.action_version == 0
            || definition.safe_for_auto && !definition.impact.is_read_only()
            || ALWAYS_EXPLICIT_OPERATIONS.contains(&definition.operation.as_str())
                && definition.impact.is_read_only()
        {
            return Err(ActionCatalogError::InvalidDefinition);
        }
        if self.definitions.contains_key(&definition.operation) {
            return Err(ActionCatalogError::DuplicateOperation);
        }
        self.definitions
            .insert(definition.operation.clone(), definition);
        Ok(())
    }

    pub fn validate(&self, action: &ActionSpec) -> Result<(), ActionCatalogError> {
        if action.policy_version != self.policy_version {
            return Err(ActionCatalogError::PolicyVersionMismatch);
        }
        let definition = self
            .definitions
            .get(&action.operation)
            .ok_or(ActionCatalogError::DefinitionMismatch)?;
        if definition.connector_id != action.connector_id
            || definition.capability != action.capability
            || definition.impact != action.impact
            || definition.safe_for_auto != action.safe_for_auto
            || definition.action_version != action.action_version
            || definition.parameter_rules != action.parameter_rules
        {
            return Err(ActionCatalogError::DefinitionMismatch);
        }
        Ok(())
    }

    pub fn is_always_explicit(&self, operation: &str) -> bool {
        ALWAYS_EXPLICIT_OPERATIONS.contains(&operation)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParameterValue {
    Text(String),
    Integer(i64),
    Boolean(bool),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParameterKind {
    Text,
    Integer,
    Boolean,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterRule {
    pub kind: ParameterKind,
    pub required: bool,
    pub max_string_length: Option<u32>,
    pub min_integer: Option<i64>,
    pub max_integer: Option<i64>,
    pub allowed_strings: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionTarget {
    pub object_type: String,
    pub object_id: String,
    pub version: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionSpec {
    pub schema_version: u16,
    pub action_id: String,
    pub task_id: String,
    pub step_id: String,
    pub operation: String,
    pub targets: Vec<ActionTarget>,
    pub connector_id: String,
    pub capability: String,
    pub parameters: BTreeMap<String, ParameterValue>,
    pub parameter_rules: BTreeMap<String, ParameterRule>,
    pub parameter_digest: String,
    pub data_scope: Vec<String>,
    pub impact: ActionImpact,
    pub safe_for_auto: bool,
    pub action_version: u64,
    pub policy_version: u64,
    pub authorization_version: u64,
    pub expires_at: u64,
    pub idempotency_key: String,
    pub cancel_token: String,
}

impl ActionSpec {
    pub fn validate(&self) -> Result<(), ActionValidationError> {
        if self.schema_version != 1
            || self.action_id.is_empty()
            || self.task_id.is_empty()
            || self.step_id.is_empty()
            || self.operation.is_empty()
            || self.connector_id.is_empty()
            || self.capability.is_empty()
            || self.idempotency_key.is_empty()
            || self.cancel_token.is_empty()
            || self.targets.is_empty()
            || self.expires_at == 0
            || self.data_scope.is_empty()
            || self.data_scope.iter().any(|scope| scope.trim().is_empty())
            || self.policy_version == 0
            || self.authorization_version == 0
            || self.action_version == 0
        {
            return Err(ActionValidationError::MissingRequiredField);
        }
        if self.safe_for_auto && !self.impact.is_read_only() {
            return Err(ActionValidationError::AutoWriteForbidden);
        }
        let mut targets = HashSet::new();
        for target in &self.targets {
            if target.object_type.is_empty() || target.object_id.is_empty() || target.version == 0 {
                return Err(ActionValidationError::InvalidTarget);
            }
            if !targets.insert((&target.object_type, &target.object_id)) {
                return Err(ActionValidationError::InvalidTarget);
            }
        }
        if self
            .parameters
            .keys()
            .any(|key| !self.parameter_rules.contains_key(key))
            || self
                .parameter_rules
                .keys()
                .any(|key| !self.parameters.contains_key(key) && self.parameter_rules[key].required)
        {
            return Err(ActionValidationError::ParameterScope);
        }
        for (key, value) in &self.parameters {
            let rule = self
                .parameter_rules
                .get(key)
                .ok_or(ActionValidationError::ParameterScope)?;
            validate_value(value, rule)?;
        }
        if self.parameter_digest != parameter_digest(&self.parameters, &self.parameter_rules) {
            return Err(ActionValidationError::ParameterDigest);
        }
        Ok(())
    }
}

fn validate_value(
    value: &ParameterValue,
    rule: &ParameterRule,
) -> Result<(), ActionValidationError> {
    let kind = match value {
        ParameterValue::Text(_) => ParameterKind::Text,
        ParameterValue::Integer(_) => ParameterKind::Integer,
        ParameterValue::Boolean(_) => ParameterKind::Boolean,
    };
    if kind != rule.kind
        || rule
            .min_integer
            .zip(rule.max_integer)
            .is_some_and(|(min, max)| min > max)
    {
        return Err(ActionValidationError::ParameterType);
    }
    match value {
        ParameterValue::Text(text) => {
            if rule
                .max_string_length
                .is_some_and(|max| text.chars().count() > max as usize)
                || !rule.allowed_strings.is_empty() && !rule.allowed_strings.contains(text)
            {
                return Err(ActionValidationError::ParameterOutOfRange);
            }
        }
        ParameterValue::Integer(number) => {
            if rule.min_integer.is_some_and(|min| *number < min)
                || rule.max_integer.is_some_and(|max| *number > max)
            {
                return Err(ActionValidationError::ParameterOutOfRange);
            }
        }
        ParameterValue::Boolean(_) => {
            if rule.max_string_length.is_some()
                || rule.min_integer.is_some()
                || rule.max_integer.is_some()
                || !rule.allowed_strings.is_empty()
            {
                return Err(ActionValidationError::ParameterType);
            }
        }
    }
    Ok(())
}

fn parameter_digest(
    parameters: &BTreeMap<String, ParameterValue>,
    rules: &BTreeMap<String, ParameterRule>,
) -> String {
    let bytes =
        serde_json::to_vec(&(parameters, rules)).expect("ordered action parameters serialize");
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Clone, Debug)]
pub struct ActionSpecBuilder {
    action: ActionSpec,
}

impl ActionSpecBuilder {
    pub fn new(action_id: &str, task_id: &str, step_id: &str, operation: &str) -> Self {
        Self {
            action: ActionSpec {
                schema_version: 1,
                action_id: action_id.into(),
                task_id: task_id.into(),
                step_id: step_id.into(),
                operation: operation.into(),
                targets: Vec::new(),
                connector_id: String::new(),
                capability: String::new(),
                parameters: BTreeMap::new(),
                parameter_rules: BTreeMap::new(),
                parameter_digest: String::new(),
                data_scope: Vec::new(),
                impact: ActionImpact::ReadOnly,
                safe_for_auto: false,
                action_version: 1,
                policy_version: 1,
                authorization_version: 1,
                expires_at: 0,
                idempotency_key: String::new(),
                cancel_token: String::new(),
            },
        }
    }

    pub fn target(mut self, object_type: &str, object_id: &str, version: u64) -> Self {
        self.action.targets.push(ActionTarget {
            object_type: object_type.into(),
            object_id: object_id.into(),
            version,
        });
        self
    }

    pub fn parameter(mut self, key: &str, value: ParameterValue, rule: ParameterRule) -> Self {
        self.action.parameters.insert(key.into(), value);
        self.action.parameter_rules.insert(key.into(), rule);
        self
    }

    pub fn optional_parameter_rule(mut self, key: &str, rule: ParameterRule) -> Self {
        self.action.parameter_rules.insert(key.into(), rule);
        self
    }

    pub fn connector(mut self, connector_id: &str, capability: &str) -> Self {
        self.action.connector_id = connector_id.into();
        self.action.capability = capability.into();
        self
    }

    pub fn impact(mut self, impact: ActionImpact) -> Self {
        self.action.impact = impact;
        self
    }

    pub fn safe_for_auto(mut self, safe: bool) -> Self {
        self.action.safe_for_auto = safe;
        self
    }

    pub fn data_scope(mut self, scope: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.action.data_scope = scope.into_iter().map(Into::into).collect();
        self
    }

    pub fn versions(mut self, action: u64, policy: u64, authorization: u64) -> Self {
        self.action.action_version = action;
        self.action.policy_version = policy;
        self.action.authorization_version = authorization;
        self
    }

    pub fn expires_at(mut self, expires_at: u64) -> Self {
        self.action.expires_at = expires_at;
        self
    }

    pub fn idempotency(mut self, key: &str) -> Self {
        self.action.idempotency_key = key.into();
        self
    }

    pub fn cancel_token(mut self, token: &str) -> Self {
        self.action.cancel_token = token.into();
        self
    }

    pub fn build(mut self) -> Result<ActionSpec, ActionValidationError> {
        self.action.parameter_digest =
            parameter_digest(&self.action.parameters, &self.action.parameter_rules);
        self.action.validate()?;
        Ok(self.action)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionValidationError {
    MissingRequiredField,
    AutoWriteForbidden,
    InvalidTarget,
    ParameterScope,
    ParameterOutOfRange,
    ParameterType,
    ParameterDigest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConnectorPermission {
    AlwaysAllow,
    NeedsApproval,
    Blocked,
}

impl From<PermissionState> for ConnectorPermission {
    fn from(value: PermissionState) -> Self {
        match value {
            PermissionState::AlwaysAllow => Self::AlwaysAllow,
            PermissionState::NeedsApproval => Self::NeedsApproval,
            PermissionState::Blocked => Self::Blocked,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptErrorCode {
    Validation,
    Authorization,
    Scope,
    Version,
    Expired,
    Revoked,
    Duplicate,
    Cancelled,
    ConnectorFailure,
    Lifecycle,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConnectorRegistration {
    pub connector: Connector,
    pub transport: ConnectorTransport,
    pub authorization_version: u64,
    pub target_versions: HashMap<(String, String), u64>,
    pub data_scope: HashSet<String>,
}

#[derive(Default)]
pub struct ConnectorRegistry {
    connectors: HashMap<String, ConnectorRegistration>,
}

impl ConnectorRegistry {
    pub fn register_fake_local(
        &mut self,
        connector: Connector,
        authorization_version: u64,
    ) -> bool {
        if connector.id.is_empty()
            || authorization_version == 0
            || self.connectors.contains_key(&connector.id)
        {
            return false;
        }
        self.connectors.insert(
            connector.id.clone(),
            ConnectorRegistration {
                connector,
                transport: ConnectorTransport::FakeLocal,
                authorization_version,
                target_versions: HashMap::new(),
                data_scope: HashSet::new(),
            },
        );
        true
    }

    pub fn set_target_version(
        &mut self,
        connector_id: &str,
        object_type: &str,
        object_id: &str,
        version: u64,
    ) -> bool {
        let Some(connector) = self.connectors.get_mut(connector_id) else {
            return false;
        };
        if version == 0 {
            return false;
        }
        connector
            .target_versions
            .insert((object_type.into(), object_id.into()), version);
        true
    }

    /// Called only by the trusted server after the user has granted these data
    /// scopes. A model or an embedded App must never construct this grant.
    pub fn set_data_scope(&mut self, connector_id: &str, scopes: &[&str]) -> bool {
        let Some(registration) = self.connectors.get_mut(connector_id) else {
            return false;
        };
        registration.data_scope = scopes.iter().map(|scope| (*scope).into()).collect();
        true
    }

    pub fn revoke(&mut self, connector_id: &str) -> bool {
        let Some(connector) = self.connectors.get_mut(connector_id) else {
            return false;
        };
        connector.connector.permission = PermissionState::Blocked;
        connector.authorization_version = connector.authorization_version.saturating_add(1);
        true
    }

    pub fn authorize(&self, action: &ActionSpec) -> Result<ConnectorPermission, ReceiptErrorCode> {
        let registration = self
            .connectors
            .get(&action.connector_id)
            .ok_or(ReceiptErrorCode::Revoked)?;
        if registration.transport != ConnectorTransport::FakeLocal
            || registration.connector.permission == PermissionState::Blocked
        {
            return Err(ReceiptErrorCode::Revoked);
        }
        if registration.authorization_version != action.authorization_version {
            return Err(ReceiptErrorCode::Version);
        }
        if !registration
            .connector
            .capabilities
            .contains(&action.capability)
        {
            return Err(ReceiptErrorCode::Scope);
        }
        if action.data_scope.is_empty()
            || !action
                .data_scope
                .iter()
                .all(|scope| registration.data_scope.contains(scope))
        {
            return Err(ReceiptErrorCode::Scope);
        }
        for target in &action.targets {
            if registration
                .target_versions
                .get(&(target.object_type.clone(), target.object_id.clone()))
                != Some(&target.version)
            {
                return Err(ReceiptErrorCode::Version);
            }
        }
        Ok(registration.connector.permission.into())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionResult {
    pub summary: String,
    pub affected_targets: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConnectorError {
    pub code: ReceiptErrorCode,
    pub message: String,
    /// An adapter that fails after committing must report the affected objects;
    /// cancellation and failure never imply that a committed effect was undone.
    pub committed_targets: Vec<String>,
}

#[derive(Clone, Default)]
pub struct Cancellation {
    cancelled: Arc<AtomicBool>,
}

impl Cancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

pub trait LocalActionAdapter {
    /// Check cancellation before submission and before each commit. This API is
    /// a trusted in-process boundary, never an API handed to a specialist.
    fn execute(
        &mut self,
        action: &ActionSpec,
        cancellation: &Cancellation,
    ) -> Result<ActionResult, ConnectorError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FakeEffect {
    pub action_id: String,
    pub operation: String,
    pub targets: Vec<String>,
}

#[derive(Default)]
pub struct FakeLocalAdapter {
    pub calls: Vec<String>,
    pub effects: Vec<FakeEffect>,
    fail_next: Option<ConnectorError>,
}

impl FakeLocalAdapter {
    pub fn fail_next(&mut self, code: ReceiptErrorCode, message: &str) {
        self.fail_next = Some(ConnectorError {
            code,
            message: message.into(),
            committed_targets: vec![],
        });
    }
}

impl LocalActionAdapter for FakeLocalAdapter {
    fn execute(
        &mut self,
        action: &ActionSpec,
        cancellation: &Cancellation,
    ) -> Result<ActionResult, ConnectorError> {
        if cancellation.is_cancelled() {
            return Err(ConnectorError {
                code: ReceiptErrorCode::Cancelled,
                message: "cancelled before connector execution".into(),
                committed_targets: vec![],
            });
        }
        self.calls.push(action.action_id.clone());
        if let Some(error) = self.fail_next.take() {
            return Err(error);
        }
        let targets = action
            .targets
            .iter()
            .map(|target| target.object_id.clone())
            .collect::<Vec<_>>();
        if !action.impact.is_read_only() {
            self.effects.push(FakeEffect {
                action_id: action.action_id.clone(),
                operation: action.operation.clone(),
                targets: targets.clone(),
            });
        }
        Ok(ActionResult {
            summary: format!("fake-local:{}", action.operation),
            affected_targets: targets,
        })
    }
}

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

    fn read_action() -> ActionSpec {
        ActionSpecBuilder::new("a", "t", "s", "search")
            .target("query", "q", 1)
            .connector("local", "search.read")
            .impact(ActionImpact::ReadOnly)
            .safe_for_auto(true)
            .data_scope(["query:q"])
            .expires_at(10)
            .idempotency("i")
            .cancel_token("c")
            .build()
            .unwrap()
    }

    #[test]
    fn parameter_bounds_are_enforced_and_digest_is_bound() {
        let action = ActionSpecBuilder::new("a", "t", "s", "search")
            .target("query", "q", 1)
            .parameter(
                "limit",
                ParameterValue::Integer(5),
                ParameterRule {
                    kind: ParameterKind::Integer,
                    required: true,
                    max_string_length: None,
                    min_integer: Some(1),
                    max_integer: Some(10),
                    allowed_strings: vec![],
                },
            )
            .connector("local", "search.read")
            .impact(ActionImpact::ReadOnly)
            .safe_for_auto(true)
            .data_scope(["query:q"])
            .expires_at(10)
            .idempotency("i")
            .cancel_token("c")
            .build()
            .unwrap();
        assert!(action.validate().is_ok());
        let mut changed = action;
        changed
            .parameters
            .insert("limit".into(), ParameterValue::Integer(50));
        assert_eq!(
            changed.validate(),
            Err(ActionValidationError::ParameterOutOfRange)
        );
    }

    #[test]
    fn specialist_permissions_are_closed_by_default() {
        for c in SPECIALIST_DENIED_CAPABILITIES {
            assert!(!specialist_can(c, &[c]));
        }
        assert!(!specialist_can("read_file", &[]));
        assert!(specialist_can("read_file", &["read_file"]));
        assert!(!specialist_can("message.write", &["message.write"]));
    }

    #[test]
    fn cancellation_discards_partials_but_does_not_undo_effects() {
        let mut c = TeamCancellation {
            partial_artifacts: vec!["draft".into()],
            completed_effects: vec!["written-file".into()],
            ..Default::default()
        };
        c.cancel();
        c.cancel();
        assert!(c.dispatch_stopped && c.partial_artifacts.is_empty());
        assert_eq!(c.completed_effects.len(), 1);
    }

    #[test]
    fn revoked_connector_and_stale_target_fail_closed() {
        let mut registry = ConnectorRegistry::default();
        registry.register_fake_local(
            Connector {
                id: "local".into(),
                capabilities: vec!["search.read".into()],
                permission: PermissionState::AlwaysAllow,
                credential_ref: None,
            },
            1,
        );
        registry.set_target_version("local", "query", "q", 1);
        registry.set_data_scope("local", &["query:q"]);
        assert!(registry.authorize(&read_action()).is_ok());
        registry.set_target_version("local", "query", "q", 2);
        assert_eq!(
            registry.authorize(&read_action()),
            Err(ReceiptErrorCode::Version)
        );
        registry.set_target_version("local", "query", "q", 1);
        registry.revoke("local");
        assert_eq!(
            registry.authorize(&read_action()),
            Err(ReceiptErrorCode::Revoked)
        );
    }
}
