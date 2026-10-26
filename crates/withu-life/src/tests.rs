use super::*;
use std::collections::BTreeMap;
use withu_connectors::{ActionImpact, ActionSpecBuilder, ParameterValue, ReceiptErrorCode};
use withu_orchestrator::ReceiptStatus;
use withu_scheduler::{ScheduleStatus, SchedulerLimits};

fn limits() -> SchedulerLimits {
    SchedulerLimits {
        schema_version: 1,
        max_concurrent: 2,
        budget_units: 20,
        max_retries: 1,
        rate_limit: 10,
        rate_window_seconds: 60,
    }
}

fn tools() -> LifeTools {
    LifeTools::new(["home", "work"], limits()).unwrap()
}

fn context(id: &str, expires_at: u64) -> ActionContext {
    ActionContext::delegated(
        id,
        "handle a local life task",
        "user-turn:fixture",
        1,
        expires_at,
    )
}

fn allow(tools: &mut LifeTools, prepared: &PreparedAction, now: u64) {
    tools
        .approve(prepared, ApprovalDecision::Allow, true, now)
        .unwrap();
}

#[test]
fn retrieval_is_scoped_and_unavailable_is_honest() {
    let mut tools = tools();
    tools
        .add_information_source(InformationSource {
            schema_version: 1,
            source_id: "fixture-source".into(),
            scope: "home".into(),
            version: 3,
            observed_at: 7,
            verified: true,
            title: "Local term guide".into(),
            content: "verified term content".into(),
        })
        .unwrap();
    tools
        .add_information_source(InformationSource {
            schema_version: 1,
            source_id: "unverified-source".into(),
            scope: "home".into(),
            version: 1,
            observed_at: 8,
            verified: false,
            title: "term note".into(),
            content: "must not be presented as fact".into(),
        })
        .unwrap();

    let response = tools
        .retrieve_information(context("retrieve", 100), "home", "term", 10, 1)
        .unwrap();
    assert_eq!(response.receipt.status, ReceiptStatus::Applied);
    let results = response.value.unwrap();
    assert_eq!(results.len(), 2);
    assert!(results
        .iter()
        .any(|result| result.verified && result.content.is_some()));
    assert!(results
        .iter()
        .any(|result| !result.verified && result.content.is_none()));

    let unavailable = tools
        .retrieve_information(context("missing", 100), "home", "not present", 10, 1)
        .unwrap();
    let result = &unavailable.value.unwrap()[0];
    assert_eq!(result.status, InformationStatus::Unavailable);
    assert!(!result.verified);
    assert!(result.content.is_none());
    assert_eq!(
        tools.retrieve_information(context("scope", 100), "private", "term", 1, 1),
        Err(LifeError::ScopeDenied)
    );
}

#[test]
fn organization_is_traceable_and_does_not_infer_facts() {
    let mut tools = tools();
    let response = tools
        .organize_content(
            context("organize", 100),
            "home",
            &[
                StructuredContent {
                    item_id: "a".into(),
                    fields: BTreeMap::from([
                        ("kind".into(), "errand".into()),
                        ("summary".into(), "buy tea".into()),
                    ]),
                },
                StructuredContent {
                    item_id: "b".into(),
                    fields: BTreeMap::from([("kind".into(), "errand".into())]),
                },
            ],
            "kind",
            64,
            1,
        )
        .unwrap();
    assert_eq!(response.receipt.status, ReceiptStatus::Applied);
    let organized = response.value.unwrap();
    assert_eq!(organized.groups[0].item_ids, vec!["a", "b"]);
    assert_eq!(organized.groups[0].summary_basis, vec!["a", "b"]);
    assert_eq!(organized.groups[0].summary, "buy tea");
}

#[test]
fn draft_requires_allow_and_is_never_sent() {
    let mut tools = tools();
    let prepared = tools
        .prepare_create_draft(
            context("draft", 100),
            "home",
            "draft-1",
            "conversation-1",
            "hello from a draft",
            vec![],
            1,
        )
        .unwrap();
    assert_eq!(prepared.approval.decision, ApprovalDecision::Pending);
    let pending = tools.execute_prepared(&prepared, 1).unwrap();
    assert_eq!(pending.status, ReceiptStatus::Rejected);
    assert_eq!(pending.error.unwrap().code, ReceiptErrorCode::Authorization);
    assert!(tools.get_draft("home", "draft-1").is_none());

    allow(&mut tools, &prepared, 1);
    let applied = tools.execute_prepared(&prepared, 1).unwrap();
    assert_eq!(applied.status, ReceiptStatus::Applied);
    assert_eq!(
        tools.get_draft("home", "draft-1").unwrap().text,
        "hello from a draft"
    );
    assert!(tools
        .chain
        .adapter
        .effects
        .iter()
        .all(|effect| effect.operation != "send_message"));

    let duplicate = tools.execute_prepared(&prepared, 1).unwrap();
    assert_eq!(duplicate.status, ReceiptStatus::Rejected);
    assert_eq!(duplicate.error.unwrap().code, ReceiptErrorCode::Duplicate);
}

#[test]
fn writes_enforce_cas_and_failed_receipts_do_not_commit() {
    let mut tools = tools();
    let first = tools
        .prepare_create_draft(
            context("cas-create", 100),
            "home",
            "draft-cas",
            "conversation-1",
            "first",
            vec![],
            1,
        )
        .unwrap();
    allow(&mut tools, &first, 1);
    tools.execute_prepared(&first, 1).unwrap();

    let stale = tools
        .prepare_edit_draft(
            context("cas-stale", 100),
            "home",
            "draft-cas",
            1,
            "stale",
            vec![],
            1,
        )
        .unwrap();
    let current = tools
        .prepare_edit_draft(
            context("cas-current", 100),
            "home",
            "draft-cas",
            1,
            "current",
            vec![],
            1,
        )
        .unwrap();
    allow(&mut tools, &current, 1);
    assert_eq!(
        tools.execute_prepared(&current, 1).unwrap().status,
        ReceiptStatus::Applied
    );
    allow(&mut tools, &stale, 1);
    let rejected = tools.execute_prepared(&stale, 1).unwrap();
    assert_eq!(rejected.status, ReceiptStatus::Rejected);
    assert_eq!(rejected.error.unwrap().code, ReceiptErrorCode::Version);
    assert_eq!(
        tools.get_draft("home", "draft-cas").unwrap().text,
        "current"
    );

    let failed = tools
        .prepare_create_draft(
            context("failed", 100),
            "home",
            "draft-failed",
            "conversation-1",
            "must not commit",
            vec![],
            1,
        )
        .unwrap();
    tools.chain.adapter.fail_next(
        ReceiptErrorCode::ConnectorFailure,
        "synthetic local failure",
    );
    allow(&mut tools, &failed, 1);
    let receipt = tools.execute_prepared(&failed, 1).unwrap();
    assert_eq!(receipt.status, ReceiptStatus::Failed);
    assert_eq!(
        receipt.error.unwrap().code,
        ReceiptErrorCode::ConnectorFailure
    );
    assert!(tools.get_draft("home", "draft-failed").is_none());
}

#[test]
fn cancellation_expiry_exit_and_high_impact_are_fail_closed() {
    let mut tools = tools();
    let cancelled = tools
        .prepare_create_draft(
            context("cancelled", 100),
            "home",
            "draft-cancelled",
            "conversation-1",
            "cancel me",
            vec![],
            1,
        )
        .unwrap();
    tools.chain.cancel_plan(&cancelled.plan);
    allow(&mut tools, &cancelled, 1);
    let receipt = tools.execute_prepared(&cancelled, 1).unwrap();
    assert_eq!(receipt.status, ReceiptStatus::Rejected);
    assert_eq!(receipt.error.unwrap().code, ReceiptErrorCode::Cancelled);
    assert!(tools.get_draft("home", "draft-cancelled").is_none());

    let expired = tools
        .prepare_create_draft(
            context("expired", 2),
            "home",
            "draft-expired",
            "conversation-1",
            "expire me",
            vec![],
            1,
        )
        .unwrap();
    allow(&mut tools, &expired, 1);
    let receipt = tools.execute_prepared(&expired, 2).unwrap();
    assert_eq!(receipt.status, ReceiptStatus::Rejected);
    assert_eq!(receipt.error.unwrap().code, ReceiptErrorCode::Expired);

    let exited = tools
        .prepare_create_draft(
            context("exited", 100),
            "home",
            "draft-exited",
            "conversation-1",
            "exit me",
            vec![],
            1,
        )
        .unwrap();
    tools.stop_accepting_work();
    allow(&mut tools, &exited, 1);
    let receipt = tools.execute_prepared(&exited, 1).unwrap();
    assert_eq!(receipt.status, ReceiptStatus::Rejected);
    assert_eq!(receipt.error.unwrap().code, ReceiptErrorCode::Lifecycle);

    let mut high_tools = LifeTools::new(["home", "work"], limits()).unwrap();
    let context = context("high-impact", 100);
    let action = ActionSpecBuilder::new(
        &context.action_id,
        &context.task_id,
        &context.step_id,
        "life_external_send",
    )
    .target("message", "home/message", 1)
    .connector(CONNECTOR_ID, "life.write")
    .impact(ActionImpact::ExternalSideEffect)
    .data_scope(["life:home"])
    .versions(1, POLICY_VERSION, AUTHORIZATION_VERSION)
    .expires_at(100)
    .idempotency(&context.idempotency_key)
    .cancel_token(&context.cancel_token)
    .build()
    .unwrap();
    assert_eq!(
        high_tools.prepare_action(context, action, 1, ApprovalMode::Manual),
        Err(LifeError::HighImpactRejected)
    );
}

#[test]
fn reminders_use_scheduler_cas_pause_resume_and_delete() {
    let mut tools = tools();
    let input = ReminderInput {
        scope: "home".into(),
        id: "reminder-1".into(),
        text: "take a break".into(),
        due_at: 100,
        timezone: "Asia/Taipei".into(),
    };
    let create = tools
        .prepare_create_reminder(context("reminder-create", 200), input.clone(), 1)
        .unwrap();
    allow(&mut tools, &create, 1);
    assert_eq!(
        tools.execute_prepared(&create, 1).unwrap().status,
        ReceiptStatus::Applied
    );
    let reminder = tools.get_reminder("home", "reminder-1").unwrap();
    assert_eq!(reminder.status, ReminderStatus::Active);
    assert_eq!(
        tools
            .scheduler
            .get(&reminder.schedule_task_id)
            .unwrap()
            .status,
        ScheduleStatus::Active
    );

    let pause = tools
        .prepare_pause_reminder(context("reminder-pause", 200), "home", "reminder-1", 1, 1)
        .unwrap();
    allow(&mut tools, &pause, 1);
    tools.execute_prepared(&pause, 1).unwrap();
    let reminder = tools.get_reminder("home", "reminder-1").unwrap();
    assert_eq!(reminder.status, ReminderStatus::Paused);
    assert_eq!(
        tools
            .scheduler
            .get(&reminder.schedule_task_id)
            .unwrap()
            .status,
        ScheduleStatus::Paused
    );

    let resume = tools
        .prepare_resume_reminder(context("reminder-resume", 200), "home", "reminder-1", 2, 1)
        .unwrap();
    allow(&mut tools, &resume, 1);
    tools.execute_prepared(&resume, 1).unwrap();
    let reminder = tools.get_reminder("home", "reminder-1").unwrap();
    assert_eq!(reminder.status, ReminderStatus::Active);

    let delete = tools
        .prepare_delete_reminder(context("reminder-delete", 200), "home", "reminder-1", 3, 1)
        .unwrap();
    allow(&mut tools, &delete, 1);
    tools.execute_prepared(&delete, 1).unwrap();
    assert_eq!(
        tools.get_reminder("home", "reminder-1").unwrap().status,
        ReminderStatus::Deleted
    );
    assert_eq!(
        tools
            .scheduler
            .get(&reminder.schedule_task_id)
            .unwrap()
            .status,
        ScheduleStatus::Deleted
    );
}

#[test]
fn calendar_delete_then_recreate_advances_connector_version() {
    let mut tools = tools();
    let input = CalendarInput {
        scope: "home".into(),
        id: "recreate".into(),
        title: "event".into(),
        starts_at: 100,
        ends_at: 110,
        timezone: "Asia/Taipei".into(),
        notes: String::new(),
    };
    let create = tools
        .prepare_create_calendar(context("calendar-create", 100), input.clone(), 1)
        .unwrap();
    allow(&mut tools, &create, 1);
    tools.execute_prepared(&create, 1).unwrap();
    let delete = tools
        .prepare_delete_calendar(context("calendar-delete", 100), "home", "recreate", 1, 1)
        .unwrap();
    allow(&mut tools, &delete, 1);
    tools.execute_prepared(&delete, 1).unwrap();
    let recreate = tools
        .prepare_create_calendar(context("calendar-recreate", 100), input, 1)
        .unwrap();
    allow(&mut tools, &recreate, 1);
    tools.execute_prepared(&recreate, 1).unwrap();
    assert_eq!(tools.get_calendar("home", "recreate").unwrap().version, 3);
}

#[test]
fn draft_file_refs_are_action_bound() {
    let mut tools = tools();
    let prepared = tools
        .prepare_create_draft(
            context("draft-files", 100),
            "home",
            "draft-files",
            "conversation-1",
            "attached",
            vec!["file-a".into(), "file-b".into()],
            1,
        )
        .unwrap();
    let action = prepared.plan().action(prepared.action_id()).unwrap();
    assert_eq!(
        action.parameters.get("file_refs"),
        Some(&ParameterValue::Text("[\"file-a\",\"file-b\"]".into()))
    );
}

#[test]
fn snapshot_roundtrip_rebuilds_cas_and_paused_scheduler() {
    let mut original = tools();
    let p = original
        .prepare_create_reminder(
            context("persist", 100),
            ReminderInput {
                scope: "home".into(),
                id: "r".into(),
                text: "water".into(),
                due_at: 50,
                timezone: "UTC".into(),
            },
            1,
        )
        .unwrap();
    allow(&mut original, &p, 2);
    original.execute_prepared(&p, 3).unwrap();
    let p = original
        .prepare_pause_reminder(context("pausepersist", 100), "home", "r", 1, 4)
        .unwrap();
    allow(&mut original, &p, 5);
    original.execute_prepared(&p, 6).unwrap();
    let snapshot =
        serde_json::from_str(&serde_json::to_string(&original.snapshot()).unwrap()).unwrap();
    let mut restored = tools();
    restored.restore(snapshot).unwrap();
    assert_eq!(restored.get_reminder("home", "r").unwrap().version, 2);
    assert_eq!(
        restored
            .scheduler
            .get(&restored.get_reminder("home", "r").unwrap().schedule_task_id)
            .unwrap()
            .status,
        ScheduleStatus::Paused
    );
    assert!(matches!(
        restored.prepare_pause_reminder(context("stale", 100), "home", "r", 1, 7),
        Err(LifeError::VersionConflict)
    ));
}

#[test]
fn corrupt_snapshot_is_rejected_without_partial_restore() {
    let mut original = tools();
    let p = original
        .prepare_create_draft(
            context("valid", 100),
            "home",
            "valid",
            "conversation",
            "text",
            vec![],
            1,
        )
        .unwrap();
    allow(&mut original, &p, 2);
    original.execute_prepared(&p, 3).unwrap();
    let mut snapshot = original.snapshot();
    let mut invalid = snapshot.drafts[0].clone();
    invalid.id = "bad".into();
    invalid.scope = "forbidden".into();
    snapshot.drafts.push(invalid);
    let mut restored = tools();
    assert!(matches!(
        restored.restore(snapshot),
        Err(LifeError::ScopeDenied)
    ));
    assert!(restored.list_drafts("home").is_empty());
}

#[test]
fn deleted_reminder_snapshot_retains_scheduler_version() {
    let mut original = tools();
    let p = original
        .prepare_create_reminder(
            context("delete-snapshot", 100),
            ReminderInput {
                scope: "home".into(),
                id: "r".into(),
                text: "test".into(),
                due_at: 50,
                timezone: "UTC".into(),
            },
            1,
        )
        .unwrap();
    allow(&mut original, &p, 2);
    original.execute_prepared(&p, 3).unwrap();
    let p = original
        .prepare_delete_reminder(context("delete", 100), "home", "r", 1, 4)
        .unwrap();
    allow(&mut original, &p, 5);
    original.execute_prepared(&p, 6).unwrap();
    let mut restored = tools();
    restored.restore(original.snapshot()).unwrap();
    assert_eq!(
        restored.get_reminder("home", "r").unwrap().status,
        ReminderStatus::Deleted
    );
}
