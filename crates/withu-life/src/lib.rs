//! Local, bounded life tools for the Comfort demo.
//!
//! The tools keep working data in memory and expose a durable data snapshot.
//! A server integration must keep the same `ActionSpec` -> approval
//! -> `ActionReceipt` boundary.  No method in this crate sends a message,
//! contacts an external calendar, or emits a notification.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

use withu_connectors::{
    ActionCatalog, ActionDefinition, ActionImpact, ActionSpec, ActionSpecBuilder, Connector,
    ConnectorRegistry, ParameterKind, ParameterRule, ParameterValue, PermissionState,
};
use withu_orchestrator::{
    ActionChain, ActionReceipt, ChainError, DelegatedGoal, PlanPreview, ReceiptStatus,
};
use withu_runtime::{ApprovalDecision, ApprovalMode};
use withu_scheduler::{
    ScheduleController, ScheduleError, ScheduleRecord, ScheduleRequest, SchedulerLimits,
};

const CONNECTOR_ID: &str = "life-local";
const POLICY_VERSION: u64 = 1;
const AUTHORIZATION_VERSION: u64 = 1;
const MAX_SCOPE_LENGTH: usize = 128;
const MAX_QUERY_LENGTH: usize = 256;
const MAX_TEXT_LENGTH: u32 = 8_192;
const MAX_SOURCE_CONTENT_LENGTH: usize = 32_768;
const MAX_ORGANIZE_ITEMS: usize = 100;
const MAX_RESULTS: u32 = 20;

const OP_INFO_RETRIEVE: &str = "life_information_retrieve";
const OP_ORGANIZE: &str = "life_content_organize";
const OP_DRAFT_CREATE: &str = "life_draft_create";
const OP_DRAFT_EDIT: &str = "life_draft_edit";
const OP_DRAFT_DISCARD: &str = "life_draft_discard";
const OP_CALENDAR_CREATE: &str = "life_calendar_create";
const OP_CALENDAR_EDIT: &str = "life_calendar_edit";
const OP_CALENDAR_DELETE: &str = "life_calendar_delete";
const OP_REMINDER_CREATE: &str = "life_reminder_create";
const OP_REMINDER_EDIT: &str = "life_reminder_edit";
const OP_REMINDER_DELETE: &str = "life_reminder_delete";
const OP_REMINDER_PAUSE: &str = "life_reminder_pause";
const OP_REMINDER_RESUME: &str = "life_reminder_resume";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionContext {
    pub task_id: String,
    pub step_id: String,
    pub action_id: String,
    pub idempotency_key: String,
    pub cancel_token: String,
    pub policy_version: u64,
    pub authorization_version: u64,
    pub expires_at: u64,
    pub goal_description: String,
    pub user_evidence_ref: String,
}

impl ActionContext {
    /// Construct context for a user-delegated life action.  A caller still
    /// supplies the expiry and the evidence reference; relation turns cannot
    /// construct a task implicitly.
    pub fn delegated(
        operation_id: &str,
        goal_description: &str,
        user_evidence_ref: &str,
        now: u64,
        expires_at: u64,
    ) -> Self {
        Self {
            task_id: format!("life-task:{operation_id}"),
            step_id: format!("life-step:{operation_id}"),
            action_id: format!("life-action:{operation_id}"),
            idempotency_key: format!("life-idem:{operation_id}"),
            cancel_token: format!("life-cancel:{operation_id}"),
            policy_version: POLICY_VERSION,
            authorization_version: AUTHORIZATION_VERSION,
            expires_at: expires_at.max(now.saturating_add(1)),
            goal_description: goal_description.into(),
            user_evidence_ref: user_evidence_ref.into(),
        }
    }

    fn validate(&self, now: u64) -> Result<(), LifeError> {
        if [
            &self.task_id,
            &self.step_id,
            &self.action_id,
            &self.idempotency_key,
            &self.cancel_token,
            &self.goal_description,
            &self.user_evidence_ref,
        ]
        .iter()
        .any(|value| value.trim().is_empty())
            || self.policy_version == 0
            || self.authorization_version == 0
            || self.expires_at == 0
            || now >= self.expires_at
        {
            return Err(LifeError::Invalid(
                "action context is missing or expired".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InformationStatus {
    Verified,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InformationSource {
    pub schema_version: u16,
    pub source_id: String,
    pub scope: String,
    pub version: u64,
    pub observed_at: u64,
    pub verified: bool,
    pub title: String,
    pub content: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InformationResult {
    pub schema_version: u16,
    pub query: String,
    pub scope: String,
    pub source_id: String,
    pub source_version: u64,
    pub observed_at: u64,
    pub status: InformationStatus,
    pub verified: bool,
    pub content: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructuredContent {
    pub item_id: String,
    pub fields: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrganizedGroup {
    pub category: String,
    pub item_ids: Vec<String>,
    pub summary: String,
    pub summary_basis: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrganizedContent {
    pub schema_version: u16,
    pub result_id: String,
    pub scope: String,
    pub group_by: String,
    pub groups: Vec<OrganizedGroup>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DraftStatus {
    Active,
    Discarded,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MessageDraft {
    pub schema_version: u16,
    pub id: String,
    pub scope: String,
    pub conversation_id: String,
    pub text: String,
    pub file_refs: Vec<String>,
    pub status: DraftStatus,
    pub version: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarStatus {
    Active,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalendarEvent {
    pub schema_version: u16,
    pub id: String,
    pub scope: String,
    pub title: String,
    pub starts_at: u64,
    pub ends_at: u64,
    pub timezone: String,
    pub notes: String,
    pub status: CalendarStatus,
    pub version: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStatus {
    Active,
    Paused,
    Deleted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reminder {
    pub schema_version: u16,
    pub id: String,
    pub scope: String,
    pub text: String,
    pub due_at: u64,
    pub timezone: String,
    pub status: ReminderStatus,
    pub version: u64,
    pub schedule_task_id: String,
    pub schedule_version: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedAction {
    plan: PlanPreview,
    action_id: String,
    approval_id: String,
    approval: withu_approvals::ApprovalCard,
    intent: WriteIntent,
}

impl PreparedAction {
    pub fn action_id(&self) -> &str {
        &self.action_id
    }
    pub fn approval_id(&self) -> &str {
        &self.approval_id
    }
    pub fn approval(&self) -> &withu_approvals::ApprovalCard {
        &self.approval
    }
    pub fn plan(&self) -> &PlanPreview {
        &self.plan
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum WriteIntent {
    DraftCreate {
        scope: String,
        id: String,
        conversation_id: String,
        text: String,
        file_refs: Vec<String>,
    },
    DraftEdit {
        scope: String,
        id: String,
        text: String,
        file_refs: Vec<String>,
        expected_version: u64,
    },
    DraftDiscard {
        scope: String,
        id: String,
        expected_version: u64,
    },
    CalendarCreate {
        scope: String,
        id: String,
        title: String,
        starts_at: u64,
        ends_at: u64,
        timezone: String,
        notes: String,
    },
    CalendarEdit {
        scope: String,
        id: String,
        title: String,
        starts_at: u64,
        ends_at: u64,
        timezone: String,
        notes: String,
        expected_version: u64,
    },
    CalendarDelete {
        scope: String,
        id: String,
        expected_version: u64,
    },
    ReminderCreate {
        scope: String,
        id: String,
        text: String,
        due_at: u64,
        timezone: String,
        evidence_ref: String,
        authorization_version: u64,
    },
    ReminderEdit {
        scope: String,
        id: String,
        text: String,
        due_at: u64,
        timezone: String,
        expected_version: u64,
        evidence_ref: String,
        authorization_version: u64,
    },
    ReminderDelete {
        scope: String,
        id: String,
        expected_version: u64,
    },
    ReminderPause {
        scope: String,
        id: String,
        expected_version: u64,
    },
    ReminderResume {
        scope: String,
        id: String,
        expected_version: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolResponse<T> {
    pub receipt: ActionReceipt,
    pub value: Option<T>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LifeError {
    Invalid(String),
    ScopeDenied,
    AlreadyExists,
    NotFound,
    VersionConflict,
    Unsupported(String),
    HighImpactRejected,
    Chain(ChainError),
    Scheduler(ScheduleError),
}

impl From<ChainError> for LifeError {
    fn from(value: ChainError) -> Self {
        Self::Chain(value)
    }
}

impl From<ScheduleError> for LifeError {
    fn from(value: ScheduleError) -> Self {
        Self::Scheduler(value)
    }
}

#[derive(Default)]
struct LifeStore {
    sources: BTreeMap<(String, String), InformationSource>,
    drafts: BTreeMap<(String, String), MessageDraft>,
    calendar: BTreeMap<(String, String), CalendarEvent>,
    reminders: BTreeMap<(String, String), Reminder>,
}

/// Durable data only. Approval cards, grants, pending plans and adapter state
/// are intentionally excluded and must never survive a process restart.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LifeSnapshot {
    pub schema_version: u16,
    pub sources: Vec<InformationSource>,
    pub drafts: Vec<MessageDraft>,
    pub calendar: Vec<CalendarEvent>,
    pub reminders: Vec<Reminder>,
    pub schedules: Vec<ScheduleRecord>,
    pub target_versions: Vec<(String, String, u64)>,
}

/// D5's local tool collection.  The generic adapter is kept for isolated
/// replay tests; production construction uses `FakeLocalAdapter` only.
pub struct LifeTools<A: withu_connectors::LocalActionAdapter = withu_connectors::FakeLocalAdapter> {
    pub chain: ActionChain<A>,
    pub scheduler: ScheduleController,
    allowed_scopes: HashSet<String>,
    target_versions: HashMap<(String, String), u64>,
    store: LifeStore,
}

impl LifeTools<withu_connectors::FakeLocalAdapter> {
    pub fn new(
        scopes: impl IntoIterator<Item = impl Into<String>>,
        limits: SchedulerLimits,
    ) -> Result<Self, LifeError> {
        Self::with_adapter(
            scopes,
            limits,
            withu_connectors::FakeLocalAdapter::default(),
        )
    }
}

impl<A: withu_connectors::LocalActionAdapter> LifeTools<A> {
    pub fn snapshot(&self) -> LifeSnapshot {
        LifeSnapshot {
            schema_version: 1,
            sources: self.store.sources.values().cloned().collect(),
            drafts: self.store.drafts.values().cloned().collect(),
            calendar: self.store.calendar.values().cloned().collect(),
            reminders: self.store.reminders.values().cloned().collect(),
            schedules: self
                .store
                .reminders
                .values()
                .filter_map(|r| self.scheduler.get(&r.schedule_task_id).cloned())
                .collect(),
            target_versions: self
                .target_versions
                .iter()
                .map(|((kind, id), version)| (kind.clone(), id.clone(), *version))
                .collect(),
        }
    }

    /// Restore into a fresh instance, rebuilding connector CAS and scheduler
    /// authorization from committed schedules. No execution grant is restored.
    pub fn restore(&mut self, snapshot: LifeSnapshot) -> Result<(), LifeError> {
        if snapshot.schema_version != 1
            || !self.store.drafts.is_empty()
            || !self.store.calendar.is_empty()
            || !self.store.reminders.is_empty()
        {
            return Err(LifeError::Invalid("snapshot requires a fresh store".into()));
        }
        self.restore_data(snapshot)
    }

    fn restore_data(&mut self, snapshot: LifeSnapshot) -> Result<(), LifeError> {
        let mut store = LifeStore::default();
        let mut scheduler = ScheduleController::new(self.scheduler.limits())?;
        for source in snapshot.sources {
            self.require_scope(&source.scope)?;
            validate_source(&source)?;
            if store
                .sources
                .insert((source.scope.clone(), source.source_id.clone()), source)
                .is_some()
            {
                return Err(LifeError::AlreadyExists);
            }
        }
        for draft in snapshot.drafts {
            self.require_scope(&draft.scope)?;
            if draft.schema_version != 1 || draft.version == 0 {
                return Err(LifeError::Invalid("invalid draft snapshot".into()));
            }
            validate_identifier(&draft.id, "draft id")?;
            validate_identifier(&draft.conversation_id, "conversation id")?;
            validate_text(&draft.text, MAX_TEXT_LENGTH as usize, "draft text")?;
            if store
                .drafts
                .insert((draft.scope.clone(), draft.id.clone()), draft)
                .is_some()
            {
                return Err(LifeError::AlreadyExists);
            }
        }
        for event in snapshot.calendar {
            self.require_scope(&event.scope)?;
            if event.schema_version != 1 || event.version == 0 {
                return Err(LifeError::Invalid("invalid calendar snapshot".into()));
            }
            validate_calendar_input(&CalendarInput {
                scope: event.scope.clone(),
                id: event.id.clone(),
                title: event.title.clone(),
                starts_at: event.starts_at,
                ends_at: event.ends_at,
                timezone: event.timezone.clone(),
                notes: event.notes.clone(),
            })?;
            if store
                .calendar
                .insert((event.scope.clone(), event.id.clone()), event)
                .is_some()
            {
                return Err(LifeError::AlreadyExists);
            }
        }
        for mut reminder in snapshot.reminders {
            self.require_scope(&reminder.scope)?;
            if reminder.schema_version != 1 || reminder.version == 0 {
                return Err(LifeError::Invalid("invalid reminder snapshot".into()));
            }
            validate_reminder_input(&ReminderInput {
                scope: reminder.scope.clone(),
                id: reminder.id.clone(),
                text: reminder.text.clone(),
                due_at: reminder.due_at,
                timezone: reminder.timezone.clone(),
            })?;
            let record = snapshot
                .schedules
                .iter()
                .find(|s| s.task_id == reminder.schedule_task_id)
                .ok_or_else(|| LifeError::Invalid("missing schedule snapshot".into()))?;
            let status = match reminder.status {
                ReminderStatus::Active => withu_scheduler::ScheduleStatus::Active,
                ReminderStatus::Paused => withu_scheduler::ScheduleStatus::Paused,
                ReminderStatus::Deleted => withu_scheduler::ScheduleStatus::Deleted,
            };
            if record.schema_version != 1
                || record.version != reminder.schedule_version
                || record.scheduled_at != reminder.due_at
                || record.timezone != reminder.timezone
                || record.status != status
            {
                return Err(LifeError::Invalid("inconsistent schedule snapshot".into()));
            }
            let created = scheduler.create(ScheduleRequest {
                task_id: record.task_id.clone(),
                authorization_evidence_ref: record.authorization_evidence_ref.clone(),
                scheduled_at: record.scheduled_at,
                timezone: record.timezone.clone(),
                authorized: true,
                notification_conditions: record.notification_conditions.clone(),
                authorization_version: record.authorization_version,
                cancel_token: record.cancel_token.clone(),
            })?;
            reminder.schedule_version = match reminder.status {
                ReminderStatus::Active => created.version,
                ReminderStatus::Paused => {
                    scheduler.pause(&created.task_id, created.version)?.version
                }
                ReminderStatus::Deleted => {
                    scheduler.delete(&created.task_id, created.version)?.version
                }
            };
            if store
                .reminders
                .insert((reminder.scope.clone(), reminder.id.clone()), reminder)
                .is_some()
            {
                return Err(LifeError::AlreadyExists);
            }
        }
        for (kind, id, version) in &snapshot.target_versions {
            if !matches!(
                kind.as_str(),
                "draft" | "calendar" | "reminder" | "query" | "content"
            ) || *version == 0
                || !self.allowed_scopes.iter().any(|scope| {
                    id.starts_with(&format!("{scope}/"))
                        || id == &format!("{scope}:query")
                        || id == &format!("{scope}:content")
                })
            {
                return Err(LifeError::Invalid("invalid target snapshot".into()));
            }
        }
        // Commit only after every object and schedule has been validated.
        self.store = store;
        self.scheduler = scheduler;
        for (kind, id, version) in snapshot.target_versions {
            self.ensure_target(&kind, &id, version);
        }
        Ok(())
    }
    pub fn with_adapter(
        scopes: impl IntoIterator<Item = impl Into<String>>,
        limits: SchedulerLimits,
        adapter: A,
    ) -> Result<Self, LifeError> {
        let allowed_scopes = scopes.into_iter().map(Into::into).collect::<HashSet<_>>();
        if allowed_scopes.is_empty() || allowed_scopes.iter().any(|scope| !valid_scope(scope)) {
            return Err(LifeError::Invalid(
                "at least one valid scope is required".into(),
            ));
        }
        let mut connectors = ConnectorRegistry::default();
        if !connectors.register_fake_local(
            Connector {
                id: CONNECTOR_ID.into(),
                capabilities: vec!["life.read".into(), "life.write".into()],
                permission: PermissionState::AlwaysAllow,
                credential_ref: None,
            },
            AUTHORIZATION_VERSION,
        ) {
            return Err(LifeError::Invalid(
                "failed to register local connector".into(),
            ));
        }
        let scopes_for_registry = allowed_scopes
            .iter()
            .map(|scope| format!("life:{scope}"))
            .collect::<Vec<_>>();
        let scope_refs = scopes_for_registry
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        connectors.set_data_scope(CONNECTOR_ID, &scope_refs);
        let mut catalog = ActionCatalog::new(POLICY_VERSION)
            .map_err(|error| LifeError::Invalid(format!("catalog: {error:?}")))?;
        for definition in action_definitions() {
            catalog
                .register(definition)
                .map_err(|error| LifeError::Invalid(format!("catalog: {error:?}")))?;
        }
        Ok(Self {
            chain: ActionChain::new(connectors, catalog, adapter),
            scheduler: ScheduleController::new(limits)?,
            allowed_scopes,
            target_versions: HashMap::new(),
            store: LifeStore::default(),
        })
    }

    pub fn stop_accepting_work(&mut self) {
        self.chain.stop_accepting_work();
        self.scheduler.set_app_running(false);
    }

    pub fn scope_allowed(&self, scope: &str) -> bool {
        self.allowed_scopes.contains(scope)
    }

    /// Register a bounded local fixture.  This is source ingestion performed
    /// by the trusted server; it never claims that an unverified source exists.
    pub fn add_information_source(&mut self, source: InformationSource) -> Result<(), LifeError> {
        validate_source(&source)?;
        self.require_scope(&source.scope)?;
        self.store
            .sources
            .insert((source.scope.clone(), source.source_id.clone()), source);
        Ok(())
    }

    pub fn retrieve_information(
        &mut self,
        context: ActionContext,
        scope: &str,
        query: &str,
        limit: u32,
        now: u64,
    ) -> Result<ToolResponse<Vec<InformationResult>>, LifeError> {
        self.require_scope(scope)?;
        validate_query(query)?;
        if limit == 0 || limit > MAX_RESULTS {
            return Err(LifeError::Invalid(
                "result limit is outside the bounded range".into(),
            ));
        }
        let action = self.build_action(
            &context,
            OP_INFO_RETRIEVE,
            "query",
            &format!("{scope}:query"),
            scope,
            vec![
                ("query", ParameterValue::Text(query.into())),
                ("limit", ParameterValue::Integer(i64::from(limit))),
            ],
            ActionImpact::ReadOnly,
            true,
        )?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Auto)?;
        let receipt = self
            .chain
            .execute(&prepared.plan, &prepared.action_id, now)?;
        let value = if receipt.status == ReceiptStatus::Applied {
            Some(self.search_sources(scope, query, limit, now))
        } else {
            None
        };
        Ok(ToolResponse { receipt, value })
    }

    pub fn organize_content(
        &mut self,
        context: ActionContext,
        scope: &str,
        items: &[StructuredContent],
        group_by: &str,
        summary_limit: usize,
        now: u64,
    ) -> Result<ToolResponse<OrganizedContent>, LifeError> {
        self.require_scope(scope)?;
        validate_text(group_by, 64, "group_by")?;
        if items.is_empty() || items.len() > MAX_ORGANIZE_ITEMS || summary_limit == 0 {
            return Err(LifeError::Invalid(
                "content input is outside the bounded range".into(),
            ));
        }
        for item in items {
            validate_text(&item.item_id, 128, "item_id")?;
            if item.fields.len() > 32 {
                return Err(LifeError::Invalid("too many structured fields".into()));
            }
            for (key, value) in &item.fields {
                validate_text(key, 64, "field key")?;
                validate_text(value, MAX_TEXT_LENGTH as usize, "field value")?;
            }
        }
        let encoded = serde_json::to_string(items)
            .map_err(|_| LifeError::Invalid("structured content cannot be encoded".into()))?;
        validate_text(&encoded, 16_384, "structured content")?;
        let action = self.build_action(
            &context,
            OP_ORGANIZE,
            "content",
            &format!("{scope}:content"),
            scope,
            vec![
                ("content", ParameterValue::Text(encoded)),
                ("group_by", ParameterValue::Text(group_by.into())),
            ],
            ActionImpact::ReadOnly,
            true,
        )?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Auto)?;
        let receipt = self
            .chain
            .execute(&prepared.plan, &prepared.action_id, now)?;
        let value = if receipt.status == ReceiptStatus::Applied {
            Some(organize(
                items,
                scope,
                group_by,
                summary_limit,
                &prepared.action_id,
            ))
        } else {
            None
        };
        Ok(ToolResponse { receipt, value })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare_create_draft(
        &mut self,
        context: ActionContext,
        scope: &str,
        id: &str,
        conversation_id: &str,
        text: &str,
        file_refs: Vec<String>,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(scope)?;
        validate_identifier(id, "draft id")?;
        validate_identifier(conversation_id, "conversation id")?;
        validate_text(text, MAX_TEXT_LENGTH as usize, "draft text")?;
        self.ensure_absent(&self.store.drafts, scope, id)?;
        let target_version = self.next_target_version("draft", scope, id);
        let action = self.build_action_with_target(
            &context,
            OP_DRAFT_CREATE,
            "draft",
            &scoped_id(scope, id),
            target_version,
            scope,
            vec![
                (
                    "conversation_id",
                    ParameterValue::Text(conversation_id.into()),
                ),
                ("text", ParameterValue::Text(text.into())),
                (
                    "file_refs",
                    ParameterValue::Text(encode_file_refs(&file_refs)?),
                ),
            ],
            ActionImpact::Write,
            false,
        )?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::DraftCreate {
                scope: scope.into(),
                id: id.into(),
                conversation_id: conversation_id.into(),
                text: text.into(),
                file_refs,
            },
        ))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare_edit_draft(
        &mut self,
        context: ActionContext,
        scope: &str,
        id: &str,
        expected_version: u64,
        text: &str,
        file_refs: Vec<String>,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(scope)?;
        validate_identifier(id, "draft id")?;
        validate_text(text, MAX_TEXT_LENGTH as usize, "draft text")?;
        let draft = self
            .store
            .drafts
            .get(&(scope.into(), id.into()))
            .ok_or(LifeError::NotFound)?;
        if draft.status != DraftStatus::Active || draft.version != expected_version {
            return Err(LifeError::VersionConflict);
        }
        let action = self.build_action_with_target(
            &context,
            OP_DRAFT_EDIT,
            "draft",
            &scoped_id(scope, id),
            expected_version,
            scope,
            vec![
                ("text", ParameterValue::Text(text.into())),
                (
                    "file_refs",
                    ParameterValue::Text(encode_file_refs(&file_refs)?),
                ),
            ],
            ActionImpact::Write,
            false,
        )?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::DraftEdit {
                scope: scope.into(),
                id: id.into(),
                text: text.into(),
                file_refs,
                expected_version,
            },
        ))
    }

    pub fn prepare_discard_draft(
        &mut self,
        context: ActionContext,
        scope: &str,
        id: &str,
        expected_version: u64,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(scope)?;
        let draft = self
            .store
            .drafts
            .get(&(scope.into(), id.into()))
            .ok_or(LifeError::NotFound)?;
        if draft.status != DraftStatus::Active || draft.version != expected_version {
            return Err(LifeError::VersionConflict);
        }
        let action = self.build_action_with_target(
            &context,
            OP_DRAFT_DISCARD,
            "draft",
            &scoped_id(scope, id),
            expected_version,
            scope,
            vec![],
            ActionImpact::Delete,
            false,
        )?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::DraftDiscard {
                scope: scope.into(),
                id: id.into(),
                expected_version,
            },
        ))
    }

    pub fn prepare_create_calendar(
        &mut self,
        context: ActionContext,
        input: CalendarInput,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(&input.scope)?;
        validate_calendar_input(&input)?;
        self.ensure_absent(&self.store.calendar, &input.scope, &input.id)?;
        let target_version = self.next_target_version("calendar", &input.scope, &input.id);
        let action = self.calendar_action(&context, OP_CALENDAR_CREATE, &input, target_version)?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::CalendarCreate {
                scope: input.scope,
                id: input.id,
                title: input.title,
                starts_at: input.starts_at,
                ends_at: input.ends_at,
                timezone: input.timezone,
                notes: input.notes,
            },
        ))
    }

    pub fn prepare_edit_calendar(
        &mut self,
        context: ActionContext,
        input: CalendarInput,
        expected_version: u64,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(&input.scope)?;
        validate_calendar_input(&input)?;
        let event = self
            .store
            .calendar
            .get(&(input.scope.clone(), input.id.clone()))
            .ok_or(LifeError::NotFound)?;
        if event.version != expected_version {
            return Err(LifeError::VersionConflict);
        }
        let action = self.calendar_action(&context, OP_CALENDAR_EDIT, &input, expected_version)?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::CalendarEdit {
                scope: input.scope,
                id: input.id,
                title: input.title,
                starts_at: input.starts_at,
                ends_at: input.ends_at,
                timezone: input.timezone,
                notes: input.notes,
                expected_version,
            },
        ))
    }

    pub fn prepare_delete_calendar(
        &mut self,
        context: ActionContext,
        scope: &str,
        id: &str,
        expected_version: u64,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(scope)?;
        let event = self
            .store
            .calendar
            .get(&(scope.into(), id.into()))
            .ok_or(LifeError::NotFound)?;
        if event.version != expected_version {
            return Err(LifeError::VersionConflict);
        }
        let action = self.build_action_with_target(
            &context,
            OP_CALENDAR_DELETE,
            "calendar",
            &scoped_id(scope, id),
            expected_version,
            scope,
            vec![],
            ActionImpact::Delete,
            false,
        )?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::CalendarDelete {
                scope: scope.into(),
                id: id.into(),
                expected_version,
            },
        ))
    }

    pub fn prepare_create_reminder(
        &mut self,
        context: ActionContext,
        input: ReminderInput,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(&input.scope)?;
        validate_reminder_input(&input)?;
        self.ensure_absent(&self.store.reminders, &input.scope, &input.id)?;
        let target_version = self.next_target_version("reminder", &input.scope, &input.id);
        let action = self.reminder_action(&context, OP_REMINDER_CREATE, &input, target_version)?;
        let prepared = self.prepare_action(context.clone(), action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::ReminderCreate {
                scope: input.scope,
                id: input.id,
                text: input.text,
                due_at: input.due_at,
                timezone: input.timezone,
                evidence_ref: context.user_evidence_ref,
                authorization_version: context.authorization_version,
            },
        ))
    }

    pub fn prepare_edit_reminder(
        &mut self,
        context: ActionContext,
        input: ReminderInput,
        expected_version: u64,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(&input.scope)?;
        validate_reminder_input(&input)?;
        let reminder = self
            .store
            .reminders
            .get(&(input.scope.clone(), input.id.clone()))
            .ok_or(LifeError::NotFound)?;
        if reminder.status == ReminderStatus::Deleted || reminder.version != expected_version {
            return Err(LifeError::VersionConflict);
        }
        let action = self.reminder_action(&context, OP_REMINDER_EDIT, &input, expected_version)?;
        let prepared = self.prepare_action(context.clone(), action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::ReminderEdit {
                scope: input.scope,
                id: input.id,
                text: input.text,
                due_at: input.due_at,
                timezone: input.timezone,
                expected_version,
                evidence_ref: context.user_evidence_ref,
                authorization_version: context.authorization_version,
            },
        ))
    }

    pub fn prepare_delete_reminder(
        &mut self,
        context: ActionContext,
        scope: &str,
        id: &str,
        expected_version: u64,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(scope)?;
        let reminder = self
            .store
            .reminders
            .get(&(scope.into(), id.into()))
            .ok_or(LifeError::NotFound)?;
        if reminder.status == ReminderStatus::Deleted || reminder.version != expected_version {
            return Err(LifeError::VersionConflict);
        }
        let action = self.build_action_with_target(
            &context,
            OP_REMINDER_DELETE,
            "reminder",
            &scoped_id(scope, id),
            expected_version,
            scope,
            vec![],
            ActionImpact::Delete,
            false,
        )?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            WriteIntent::ReminderDelete {
                scope: scope.into(),
                id: id.into(),
                expected_version,
            },
        ))
    }

    pub fn prepare_pause_reminder(
        &mut self,
        context: ActionContext,
        scope: &str,
        id: &str,
        expected_version: u64,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.prepare_reminder_status(
            context,
            scope,
            id,
            expected_version,
            now,
            OP_REMINDER_PAUSE,
            false,
        )
    }

    pub fn prepare_resume_reminder(
        &mut self,
        context: ActionContext,
        scope: &str,
        id: &str,
        expected_version: u64,
        now: u64,
    ) -> Result<PreparedAction, LifeError> {
        self.prepare_reminder_status(
            context,
            scope,
            id,
            expected_version,
            now,
            OP_REMINDER_RESUME,
            true,
        )
    }

    pub fn approve(
        &mut self,
        prepared: &PreparedAction,
        decision: ApprovalDecision,
        explicit_user_allow: bool,
        now: u64,
    ) -> Result<withu_approvals::ApprovalCard, LifeError> {
        self.chain
            .decide(&prepared.approval_id, decision, explicit_user_allow, now)
            .map_err(LifeError::from)
    }

    /// Execute the exact prepared action.  Only an applied receipt commits a
    /// local object.  A rejected or failed receipt leaves the store untouched.
    pub fn execute_prepared(
        &mut self,
        prepared: &PreparedAction,
        now: u64,
    ) -> Result<ActionReceipt, LifeError> {
        if let Err(error) = self.validate_intent(&prepared.intent) {
            // Record a non-applied chain receipt for a local preflight failure;
            // otherwise the previous Applied receipt would be misleading.
            self.chain.cancel_plan(&prepared.plan);
            let _ = self.chain.execute(&prepared.plan, &prepared.action_id, now);
            return Err(error);
        }
        let receipt = self
            .chain
            .execute(&prepared.plan, &prepared.action_id, now)?;
        if receipt.status == ReceiptStatus::Applied {
            self.commit_intent(
                &prepared.intent,
                now,
                prepared
                    .plan
                    .action(&prepared.action_id)
                    .map(|a| a.targets[0].version)
                    .unwrap_or(0),
            )?;
        }
        Ok(receipt)
    }

    pub fn get_draft(&self, scope: &str, id: &str) -> Option<MessageDraft> {
        self.store.drafts.get(&(scope.into(), id.into())).cloned()
    }

    pub fn list_drafts(&self, scope: &str) -> Vec<MessageDraft> {
        self.store
            .drafts
            .iter()
            .filter(|((item_scope, _), _)| item_scope == scope)
            .map(|(_, draft)| draft.clone())
            .collect()
    }

    pub fn get_calendar(&self, scope: &str, id: &str) -> Option<CalendarEvent> {
        self.store.calendar.get(&(scope.into(), id.into())).cloned()
    }

    pub fn list_calendar(&self, scope: &str) -> Vec<CalendarEvent> {
        self.store
            .calendar
            .iter()
            .filter(|((item_scope, _), _)| item_scope == scope)
            .map(|(_, event)| event.clone())
            .collect()
    }

    pub fn get_reminder(&self, scope: &str, id: &str) -> Option<Reminder> {
        self.store
            .reminders
            .get(&(scope.into(), id.into()))
            .cloned()
    }

    pub fn list_reminders(&self, scope: &str) -> Vec<Reminder> {
        self.store
            .reminders
            .iter()
            .filter(|((item_scope, _), _)| item_scope == scope)
            .map(|(_, reminder)| reminder.clone())
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_reminder_status(
        &mut self,
        context: ActionContext,
        scope: &str,
        id: &str,
        expected_version: u64,
        now: u64,
        operation: &str,
        resume: bool,
    ) -> Result<PreparedAction, LifeError> {
        self.require_scope(scope)?;
        let reminder = self
            .store
            .reminders
            .get(&(scope.into(), id.into()))
            .ok_or(LifeError::NotFound)?;
        let expected_status = if resume {
            ReminderStatus::Paused
        } else {
            ReminderStatus::Active
        };
        if reminder.status != expected_status || reminder.version != expected_version {
            return Err(LifeError::VersionConflict);
        }
        let action = self.build_action_with_target(
            &context,
            operation,
            "reminder",
            &scoped_id(scope, id),
            expected_version,
            scope,
            vec![],
            ActionImpact::Write,
            false,
        )?;
        let prepared = self.prepare_action(context, action, now, ApprovalMode::Manual)?;
        Ok(self.attach_intent(
            prepared,
            if resume {
                WriteIntent::ReminderResume {
                    scope: scope.into(),
                    id: id.into(),
                    expected_version,
                }
            } else {
                WriteIntent::ReminderPause {
                    scope: scope.into(),
                    id: id.into(),
                    expected_version,
                }
            },
        ))
    }

    fn prepare_action(
        &mut self,
        context: ActionContext,
        action: ActionSpec,
        now: u64,
        mode: ApprovalMode,
    ) -> Result<PreparedAction, LifeError> {
        context.validate(now)?;
        if action.impact == ActionImpact::ExternalSideEffect
            || action.impact == ActionImpact::HighImpact
        {
            return Err(LifeError::HighImpactRejected);
        }
        let plan = self.chain.preview(
            DelegatedGoal::new(&context.goal_description, &context.user_evidence_ref),
            vec![action.clone()],
            context.policy_version,
            context.authorization_version,
            now,
        )?;
        let approval = self
            .chain
            .request_approval(&plan, &action.action_id, mode, now)?;
        Ok(PreparedAction {
            action_id: action.action_id.clone(),
            approval_id: approval.approval_id.clone(),
            plan,
            approval,
            intent: WriteIntent::DraftDiscard {
                scope: String::new(),
                id: String::new(),
                expected_version: 0,
            },
        })
    }

    fn attach_intent(&self, mut prepared: PreparedAction, intent: WriteIntent) -> PreparedAction {
        prepared.intent = intent;
        prepared
    }

    #[allow(clippy::too_many_arguments)]
    fn build_action(
        &mut self,
        context: &ActionContext,
        operation: &str,
        object_type: &str,
        object_id: &str,
        scope: &str,
        parameters: Vec<(&str, ParameterValue)>,
        impact: ActionImpact,
        safe_for_auto: bool,
    ) -> Result<ActionSpec, LifeError> {
        let target_version = self.next_target_version(object_type, scope, object_id);
        self.build_action_with_target(
            context,
            operation,
            object_type,
            object_id,
            target_version,
            scope,
            parameters,
            impact,
            safe_for_auto,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn build_action_with_target(
        &mut self,
        context: &ActionContext,
        operation: &str,
        object_type: &str,
        object_id: &str,
        target_version: u64,
        scope: &str,
        parameters: Vec<(&str, ParameterValue)>,
        impact: ActionImpact,
        safe_for_auto: bool,
    ) -> Result<ActionSpec, LifeError> {
        let rules = rules_for(operation)
            .ok_or_else(|| LifeError::Unsupported(format!("unsupported operation: {operation}")))?;
        let mut builder = ActionSpecBuilder::new(
            &context.action_id,
            &context.task_id,
            &context.step_id,
            operation,
        )
        .target(object_type, object_id, target_version)
        .connector(
            CONNECTOR_ID,
            if impact.is_read_only() {
                "life.read"
            } else {
                "life.write"
            },
        )
        .impact(impact)
        .safe_for_auto(safe_for_auto)
        .data_scope([format!("life:{scope}")])
        .versions(1, context.policy_version, context.authorization_version)
        .expires_at(context.expires_at)
        .idempotency(&context.idempotency_key)
        .cancel_token(&context.cancel_token);
        let mut supplied = HashSet::new();
        for (key, value) in parameters {
            let rule = rules
                .get(key)
                .ok_or_else(|| LifeError::Invalid(format!("parameter not allowed: {key}")))?
                .clone();
            supplied.insert(key.to_owned());
            builder = builder.parameter(key, value, rule);
        }
        for (key, rule) in rules {
            if !supplied.contains(&key) {
                if rule.required {
                    return Err(LifeError::Invalid(format!("missing parameter: {key}")));
                }
                builder = builder.optional_parameter_rule(&key, rule);
            }
        }
        let action = builder
            .build()
            .map_err(|error| LifeError::Invalid(format!("action: {error:?}")))?;
        self.ensure_target(object_type, object_id, target_version);
        Ok(action)
    }

    fn calendar_action(
        &mut self,
        context: &ActionContext,
        operation: &str,
        input: &CalendarInput,
        target_version: u64,
    ) -> Result<ActionSpec, LifeError> {
        self.build_action_with_target(
            context,
            operation,
            "calendar",
            &scoped_id(&input.scope, &input.id),
            target_version,
            &input.scope,
            vec![
                ("title", ParameterValue::Text(input.title.clone())),
                ("starts_at", ParameterValue::Integer(input.starts_at as i64)),
                ("ends_at", ParameterValue::Integer(input.ends_at as i64)),
                ("timezone", ParameterValue::Text(input.timezone.clone())),
                ("notes", ParameterValue::Text(input.notes.clone())),
            ],
            ActionImpact::Write,
            false,
        )
    }

    fn reminder_action(
        &mut self,
        context: &ActionContext,
        operation: &str,
        input: &ReminderInput,
        target_version: u64,
    ) -> Result<ActionSpec, LifeError> {
        self.build_action_with_target(
            context,
            operation,
            "reminder",
            &scoped_id(&input.scope, &input.id),
            target_version,
            &input.scope,
            vec![
                ("text", ParameterValue::Text(input.text.clone())),
                ("due_at", ParameterValue::Integer(input.due_at as i64)),
                ("timezone", ParameterValue::Text(input.timezone.clone())),
            ],
            ActionImpact::Write,
            false,
        )
    }

    fn validate_intent(&self, intent: &WriteIntent) -> Result<(), LifeError> {
        match intent {
            WriteIntent::DraftCreate { .. }
            | WriteIntent::DraftEdit { .. }
            | WriteIntent::DraftDiscard { .. }
            | WriteIntent::CalendarCreate { .. }
            | WriteIntent::CalendarEdit { .. }
            | WriteIntent::CalendarDelete { .. }
            | WriteIntent::ReminderCreate { .. } => {}
            WriteIntent::ReminderEdit {
                scope,
                id,
                expected_version,
                ..
            }
            | WriteIntent::ReminderDelete {
                scope,
                id,
                expected_version,
            }
            | WriteIntent::ReminderPause {
                scope,
                id,
                expected_version,
            }
            | WriteIntent::ReminderResume {
                scope,
                id,
                expected_version,
            } => {
                let reminder = self
                    .store
                    .reminders
                    .get(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                if reminder.version != *expected_version
                    || reminder.status == ReminderStatus::Deleted
                {
                    return Err(LifeError::VersionConflict);
                }
                let schedule = self
                    .scheduler
                    .get(&reminder.schedule_task_id)
                    .ok_or(LifeError::NotFound)?;
                if schedule.version != reminder.schedule_version {
                    return Err(LifeError::VersionConflict);
                }
            }
        }
        Ok(())
    }

    fn commit_intent(
        &mut self,
        intent: &WriteIntent,
        now: u64,
        target_version: u64,
    ) -> Result<(), LifeError> {
        match intent {
            WriteIntent::DraftCreate {
                scope,
                id,
                conversation_id,
                text,
                file_refs,
            } => {
                let key = (scope.clone(), id.clone());
                if self.store.drafts.contains_key(&key) {
                    return Err(LifeError::AlreadyExists);
                }
                let version = target_version;
                self.store.drafts.insert(
                    key,
                    MessageDraft {
                        schema_version: 1,
                        id: id.clone(),
                        scope: scope.clone(),
                        conversation_id: conversation_id.clone(),
                        text: text.clone(),
                        file_refs: file_refs.clone(),
                        status: DraftStatus::Active,
                        version,
                    },
                );
                self.set_target_version("draft", scope, id, version);
            }
            WriteIntent::DraftEdit {
                scope,
                id,
                text,
                file_refs,
                expected_version,
            } => {
                let draft = self
                    .store
                    .drafts
                    .get_mut(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                if draft.status != DraftStatus::Active || draft.version != *expected_version {
                    return Err(LifeError::VersionConflict);
                }
                draft.text = text.clone();
                draft.file_refs = file_refs.clone();
                draft.version = expected_version.saturating_add(1);
                let version = draft.version;
                self.set_target_version("draft", scope, id, version);
            }
            WriteIntent::DraftDiscard {
                scope,
                id,
                expected_version,
            } => {
                let draft = self
                    .store
                    .drafts
                    .get_mut(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                if draft.status != DraftStatus::Active || draft.version != *expected_version {
                    return Err(LifeError::VersionConflict);
                }
                draft.status = DraftStatus::Discarded;
                draft.version = expected_version.saturating_add(1);
                let version = draft.version;
                self.set_target_version("draft", scope, id, version);
            }
            WriteIntent::CalendarCreate {
                scope,
                id,
                title,
                starts_at,
                ends_at,
                timezone,
                notes,
            } => {
                let key = (scope.clone(), id.clone());
                if self.store.calendar.contains_key(&key) {
                    return Err(LifeError::AlreadyExists);
                }
                let version = target_version;
                self.store.calendar.insert(
                    key,
                    CalendarEvent {
                        schema_version: 1,
                        id: id.clone(),
                        scope: scope.clone(),
                        title: title.clone(),
                        starts_at: *starts_at,
                        ends_at: *ends_at,
                        timezone: timezone.clone(),
                        notes: notes.clone(),
                        status: CalendarStatus::Active,
                        version,
                    },
                );
                self.set_target_version("calendar", scope, id, version);
            }
            WriteIntent::CalendarEdit {
                scope,
                id,
                title,
                starts_at,
                ends_at,
                timezone,
                notes,
                expected_version,
            } => {
                let event = self
                    .store
                    .calendar
                    .get_mut(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                if event.version != *expected_version {
                    return Err(LifeError::VersionConflict);
                }
                event.title = title.clone();
                event.starts_at = *starts_at;
                event.ends_at = *ends_at;
                event.timezone = timezone.clone();
                event.notes = notes.clone();
                event.version = expected_version.saturating_add(1);
                let version = event.version;
                self.set_target_version("calendar", scope, id, version);
            }
            WriteIntent::CalendarDelete {
                scope,
                id,
                expected_version,
            } => {
                let event = self
                    .store
                    .calendar
                    .remove(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                if event.version != *expected_version {
                    return Err(LifeError::VersionConflict);
                }
                self.set_target_version("calendar", scope, id, expected_version.saturating_add(1));
            }
            WriteIntent::ReminderCreate {
                scope,
                id,
                text,
                due_at,
                timezone,
                evidence_ref,
                authorization_version,
            } => {
                let key = (scope.clone(), id.clone());
                if self.store.reminders.contains_key(&key) {
                    return Err(LifeError::AlreadyExists);
                }
                let version = target_version;
                let schedule = self.create_schedule(
                    scope,
                    id,
                    version,
                    *due_at,
                    timezone,
                    evidence_ref,
                    *authorization_version,
                )?;
                self.store.reminders.insert(
                    key,
                    Reminder {
                        schema_version: 1,
                        id: id.clone(),
                        scope: scope.clone(),
                        text: text.clone(),
                        due_at: *due_at,
                        timezone: timezone.clone(),
                        status: ReminderStatus::Active,
                        version,
                        schedule_task_id: schedule.task_id,
                        schedule_version: schedule.version,
                    },
                );
                self.set_target_version("reminder", scope, id, version);
            }
            WriteIntent::ReminderEdit {
                scope,
                id,
                text,
                due_at,
                timezone,
                expected_version,
                evidence_ref,
                authorization_version,
            } => {
                let current = self
                    .store
                    .reminders
                    .get(&(scope.clone(), id.clone()))
                    .cloned()
                    .ok_or(LifeError::NotFound)?;
                if current.status == ReminderStatus::Deleted || current.version != *expected_version
                {
                    return Err(LifeError::VersionConflict);
                }
                self.delete_schedule(&current)?;
                let version = expected_version.saturating_add(1);
                let schedule = self.create_schedule(
                    scope,
                    id,
                    version,
                    *due_at,
                    timezone,
                    evidence_ref,
                    *authorization_version,
                )?;
                let reminder = self
                    .store
                    .reminders
                    .get_mut(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                reminder.text = text.clone();
                reminder.due_at = *due_at;
                reminder.timezone = timezone.clone();
                reminder.status = ReminderStatus::Active;
                reminder.version = version;
                reminder.schedule_task_id = schedule.task_id;
                reminder.schedule_version = schedule.version;
                self.set_target_version("reminder", scope, id, version);
            }
            WriteIntent::ReminderDelete {
                scope,
                id,
                expected_version,
            } => {
                let current = self
                    .store
                    .reminders
                    .get(&(scope.clone(), id.clone()))
                    .cloned()
                    .ok_or(LifeError::NotFound)?;
                if current.status == ReminderStatus::Deleted || current.version != *expected_version
                {
                    return Err(LifeError::VersionConflict);
                }
                self.delete_schedule(&current)?;
                let reminder = self
                    .store
                    .reminders
                    .get_mut(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                reminder.status = ReminderStatus::Deleted;
                reminder.version = expected_version.saturating_add(1);
                reminder.schedule_version = reminder.schedule_version.saturating_add(1);
                let version = reminder.version;
                self.set_target_version("reminder", scope, id, version);
            }
            WriteIntent::ReminderPause {
                scope,
                id,
                expected_version,
            } => {
                let current = self
                    .store
                    .reminders
                    .get(&(scope.clone(), id.clone()))
                    .cloned()
                    .ok_or(LifeError::NotFound)?;
                if current.status != ReminderStatus::Active || current.version != *expected_version
                {
                    return Err(LifeError::VersionConflict);
                }
                self.scheduler
                    .pause(&current.schedule_task_id, current.schedule_version)?;
                let reminder = self
                    .store
                    .reminders
                    .get_mut(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                reminder.status = ReminderStatus::Paused;
                reminder.version = expected_version.saturating_add(1);
                reminder.schedule_version = reminder.schedule_version.saturating_add(1);
                let version = reminder.version;
                self.set_target_version("reminder", scope, id, version);
            }
            WriteIntent::ReminderResume {
                scope,
                id,
                expected_version,
            } => {
                let current = self
                    .store
                    .reminders
                    .get(&(scope.clone(), id.clone()))
                    .cloned()
                    .ok_or(LifeError::NotFound)?;
                if current.status != ReminderStatus::Paused || current.version != *expected_version
                {
                    return Err(LifeError::VersionConflict);
                }
                self.scheduler
                    .resume(&current.schedule_task_id, current.schedule_version)?;
                let reminder = self
                    .store
                    .reminders
                    .get_mut(&(scope.clone(), id.clone()))
                    .ok_or(LifeError::NotFound)?;
                reminder.status = ReminderStatus::Active;
                reminder.version = expected_version.saturating_add(1);
                reminder.schedule_version = reminder.schedule_version.saturating_add(1);
                let version = reminder.version;
                self.set_target_version("reminder", scope, id, version);
            }
        }
        let _ = now;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn create_schedule(
        &mut self,
        scope: &str,
        id: &str,
        version: u64,
        due_at: u64,
        timezone: &str,
        evidence_ref: &str,
        authorization_version: u64,
    ) -> Result<ScheduleRecord, LifeError> {
        let task_id = format!("life-reminder:{}:v{version}", scoped_id(scope, id));
        Ok(self.scheduler.create(ScheduleRequest {
            task_id,
            authorization_evidence_ref: evidence_ref.into(),
            scheduled_at: due_at,
            timezone: timezone.into(),
            authorized: true,
            notification_conditions: vec![],
            authorization_version,
            cancel_token: format!("cancel:{scope}:{id}:v{version}"),
        })?)
    }

    fn delete_schedule(&mut self, reminder: &Reminder) -> Result<(), LifeError> {
        self.scheduler
            .delete(&reminder.schedule_task_id, reminder.schedule_version)?;
        Ok(())
    }

    fn search_sources(
        &self,
        scope: &str,
        query: &str,
        limit: u32,
        now: u64,
    ) -> Vec<InformationResult> {
        let query_lower = query.to_lowercase();
        let mut results = self
            .store
            .sources
            .iter()
            .filter(|((source_scope, _), source)| {
                source_scope == scope
                    && (source.title.to_lowercase().contains(&query_lower)
                        || source.content.to_lowercase().contains(&query_lower))
            })
            .take(limit as usize)
            .map(|(_, source)| InformationResult {
                schema_version: 1,
                query: query.into(),
                scope: scope.into(),
                source_id: source.source_id.clone(),
                source_version: source.version,
                observed_at: source.observed_at,
                status: if source.verified {
                    InformationStatus::Verified
                } else {
                    InformationStatus::Unavailable
                },
                verified: source.verified,
                content: source.verified.then(|| source.content.clone()),
            })
            .collect::<Vec<_>>();
        if results.is_empty() {
            results.push(InformationResult {
                schema_version: 1,
                query: query.into(),
                scope: scope.into(),
                source_id: "unavailable".into(),
                source_version: 0,
                observed_at: now,
                status: InformationStatus::Unavailable,
                verified: false,
                content: None,
            });
        }
        results
    }

    fn ensure_absent<T>(
        &self,
        map: &BTreeMap<(String, String), T>,
        scope: &str,
        id: &str,
    ) -> Result<(), LifeError> {
        if map.contains_key(&(scope.into(), id.into())) {
            Err(LifeError::AlreadyExists)
        } else {
            Ok(())
        }
    }

    fn require_scope(&self, scope: &str) -> Result<(), LifeError> {
        if self.scope_allowed(scope) {
            Ok(())
        } else {
            Err(LifeError::ScopeDenied)
        }
    }

    fn next_target_version(&self, object_type: &str, scope: &str, id: &str) -> u64 {
        self.target_versions
            .get(&(object_type.into(), scoped_id(scope, id)))
            .copied()
            .unwrap_or(0)
            .saturating_add(1)
    }

    fn ensure_target(&mut self, object_type: &str, id: &str, version: u64) {
        let key = (object_type.into(), id.into());
        if self.target_versions.get(&key).copied() == Some(version) {
            return;
        }
        self.target_versions.insert(key, version);
        self.chain
            .connectors
            .set_target_version(CONNECTOR_ID, object_type, id, version);
    }

    fn set_target_version(&mut self, object_type: &str, scope: &str, id: &str, version: u64) {
        let target_id = scoped_id(scope, id);
        self.target_versions
            .insert((object_type.into(), target_id.clone()), version);
        self.chain
            .connectors
            .set_target_version(CONNECTOR_ID, object_type, &target_id, version);
    }
}

fn encode_file_refs(file_refs: &[String]) -> Result<String, LifeError> {
    serde_json::to_string(file_refs)
        .map_err(|_| LifeError::Invalid("file refs are not encodable".into()))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalendarInput {
    pub scope: String,
    pub id: String,
    pub title: String,
    pub starts_at: u64,
    pub ends_at: u64,
    pub timezone: String,
    pub notes: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReminderInput {
    pub scope: String,
    pub id: String,
    pub text: String,
    pub due_at: u64,
    pub timezone: String,
}

fn valid_scope(scope: &str) -> bool {
    !scope.trim().is_empty()
        && scope.len() <= MAX_SCOPE_LENGTH
        && scope.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':')
        })
}

fn validate_identifier(value: &str, label: &str) -> Result<(), LifeError> {
    if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        Err(LifeError::Invalid(format!("{label} is invalid")))
    } else {
        Ok(())
    }
}

fn validate_text(value: &str, max: usize, label: &str) -> Result<(), LifeError> {
    if value.chars().count() > max || value.chars().any(char::is_control) {
        Err(LifeError::Invalid(format!(
            "{label} is outside the bounded range"
        )))
    } else {
        Ok(())
    }
}

fn validate_query(query: &str) -> Result<(), LifeError> {
    if query.trim().is_empty()
        || query.chars().count() > MAX_QUERY_LENGTH
        || query.chars().any(char::is_control)
    {
        Err(LifeError::Invalid(
            "query is outside the bounded range".into(),
        ))
    } else {
        Ok(())
    }
}

fn validate_source(source: &InformationSource) -> Result<(), LifeError> {
    if source.schema_version != 1
        || source.version == 0
        || source.observed_at == 0
        || source.source_id.trim().is_empty()
        || source.content.chars().count() > MAX_SOURCE_CONTENT_LENGTH
    {
        return Err(LifeError::Invalid("information source is invalid".into()));
    }
    validate_identifier(&source.source_id, "source id")?;
    validate_text(&source.title, 256, "source title")?;
    validate_text(&source.content, MAX_SOURCE_CONTENT_LENGTH, "source content")
}

fn validate_calendar_input(input: &CalendarInput) -> Result<(), LifeError> {
    validate_identifier(&input.id, "calendar id")?;
    validate_text(&input.title, 256, "calendar title")?;
    validate_text(&input.notes, MAX_TEXT_LENGTH as usize, "calendar notes")?;
    if input.starts_at == 0 || input.ends_at <= input.starts_at || !valid_timezone(&input.timezone)
    {
        return Err(LifeError::Invalid(
            "calendar time range or timezone is invalid".into(),
        ));
    }
    Ok(())
}

fn validate_reminder_input(input: &ReminderInput) -> Result<(), LifeError> {
    validate_identifier(&input.id, "reminder id")?;
    validate_text(&input.text, MAX_TEXT_LENGTH as usize, "reminder text")?;
    if input.due_at == 0 || !valid_timezone(&input.timezone) {
        return Err(LifeError::Invalid(
            "reminder time or timezone is invalid".into(),
        ));
    }
    Ok(())
}

fn valid_timezone(timezone: &str) -> bool {
    timezone == "UTC"
        || timezone.starts_with("Etc/")
        || timezone.contains('/')
            && timezone.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '+' | '-' | '/')
            })
}

fn scoped_id(scope: &str, id: &str) -> String {
    format!("{scope}/{id}")
}

fn text_rule(max: u32) -> ParameterRule {
    ParameterRule {
        kind: ParameterKind::Text,
        required: true,
        max_string_length: Some(max),
        min_integer: None,
        max_integer: None,
        allowed_strings: vec![],
    }
}

fn integer_rule(min: i64, max: i64) -> ParameterRule {
    ParameterRule {
        kind: ParameterKind::Integer,
        required: true,
        max_string_length: None,
        min_integer: Some(min),
        max_integer: Some(max),
        allowed_strings: vec![],
    }
}

fn rules_for(operation: &str) -> Option<BTreeMap<String, ParameterRule>> {
    let mut rules = BTreeMap::new();
    let add_text = |rules: &mut BTreeMap<String, ParameterRule>, key: &str, max| {
        rules.insert(key.into(), text_rule(max));
    };
    match operation {
        OP_INFO_RETRIEVE => {
            add_text(&mut rules, "query", MAX_QUERY_LENGTH as u32);
            rules.insert("limit".into(), integer_rule(1, i64::from(MAX_RESULTS)));
        }
        OP_ORGANIZE => {
            add_text(&mut rules, "content", 16_384);
            add_text(&mut rules, "group_by", 64);
        }
        OP_DRAFT_CREATE => {
            add_text(&mut rules, "conversation_id", 256);
            add_text(&mut rules, "text", MAX_TEXT_LENGTH);
            add_text(&mut rules, "file_refs", 16_384);
        }
        OP_DRAFT_EDIT => {
            add_text(&mut rules, "text", MAX_TEXT_LENGTH);
            add_text(&mut rules, "file_refs", 16_384);
        }
        OP_DRAFT_DISCARD | OP_CALENDAR_DELETE | OP_REMINDER_DELETE | OP_REMINDER_PAUSE
        | OP_REMINDER_RESUME => {}
        OP_CALENDAR_CREATE | OP_CALENDAR_EDIT => {
            add_text(&mut rules, "title", 256);
            rules.insert("starts_at".into(), integer_rule(1, i64::MAX));
            rules.insert("ends_at".into(), integer_rule(1, i64::MAX));
            add_text(&mut rules, "timezone", 128);
            add_text(&mut rules, "notes", MAX_TEXT_LENGTH);
        }
        OP_REMINDER_CREATE | OP_REMINDER_EDIT => {
            add_text(&mut rules, "text", MAX_TEXT_LENGTH);
            rules.insert("due_at".into(), integer_rule(1, i64::MAX));
            add_text(&mut rules, "timezone", 128);
        }
        _ => return None,
    }
    Some(rules)
}

fn action_definitions() -> Vec<ActionDefinition> {
    [
        (OP_INFO_RETRIEVE, ActionImpact::ReadOnly, true),
        (OP_ORGANIZE, ActionImpact::ReadOnly, true),
        (OP_DRAFT_CREATE, ActionImpact::Write, false),
        (OP_DRAFT_EDIT, ActionImpact::Write, false),
        (OP_DRAFT_DISCARD, ActionImpact::Delete, false),
        (OP_CALENDAR_CREATE, ActionImpact::Write, false),
        (OP_CALENDAR_EDIT, ActionImpact::Write, false),
        (OP_CALENDAR_DELETE, ActionImpact::Delete, false),
        (OP_REMINDER_CREATE, ActionImpact::Write, false),
        (OP_REMINDER_EDIT, ActionImpact::Write, false),
        (OP_REMINDER_DELETE, ActionImpact::Delete, false),
        (OP_REMINDER_PAUSE, ActionImpact::Write, false),
        (OP_REMINDER_RESUME, ActionImpact::Write, false),
    ]
    .into_iter()
    .map(|(operation, impact, safe_for_auto)| ActionDefinition {
        operation: operation.into(),
        connector_id: CONNECTOR_ID.into(),
        capability: if impact.is_read_only() {
            "life.read"
        } else {
            "life.write"
        }
        .into(),
        impact,
        safe_for_auto,
        action_version: 1,
        parameter_rules: rules_for(operation).expect("registered operation has rules"),
    })
    .collect()
}

fn organize(
    items: &[StructuredContent],
    scope: &str,
    group_by: &str,
    summary_limit: usize,
    result_id: &str,
) -> OrganizedContent {
    let mut groups: BTreeMap<String, OrganizedGroup> = BTreeMap::new();
    for item in items {
        let category = item
            .fields
            .get(group_by)
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "uncategorized".into());
        let summary_piece = item
            .fields
            .get("summary")
            .or_else(|| item.fields.get("text"))
            .or_else(|| item.fields.get("title"))
            .cloned()
            .unwrap_or_default();
        let group = groups
            .entry(category.clone())
            .or_insert_with(|| OrganizedGroup {
                category,
                item_ids: vec![],
                summary: String::new(),
                summary_basis: vec![],
            });
        group.item_ids.push(item.item_id.clone());
        group.summary_basis.push(item.item_id.clone());
        if !summary_piece.is_empty() {
            if !group.summary.is_empty() {
                group.summary.push_str("; ");
            }
            group.summary.push_str(&summary_piece);
            group.summary = group.summary.chars().take(summary_limit).collect();
        }
    }
    OrganizedContent {
        schema_version: 1,
        result_id: result_id.into(),
        scope: scope.into(),
        group_by: group_by.into(),
        groups: groups.into_values().collect(),
    }
}

#[cfg(test)]
mod tests;
