use withu_approvals::ApprovalDecision;
use withu_life::{ActionContext, LifeError, LifeTools, ReminderInput, ReminderStatus};
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

fn context(id: &str) -> ActionContext {
    ActionContext::delegated(id, "handle a local life task", "user-turn:probe", 1, 200)
}

#[test]
fn prepared_getters_and_scheduler_preflight_conflict_are_honest() {
    let mut tools = LifeTools::new(["home"], limits()).unwrap();
    let create = tools
        .prepare_create_reminder(
            context("create"),
            ReminderInput {
                scope: "home".into(),
                id: "probe-reminder".into(),
                text: "probe".into(),
                due_at: 100,
                timezone: "Asia/Taipei".into(),
            },
            1,
        )
        .unwrap();
    assert_eq!(create.action_id(), create.plan().actions[0].action_id);
    assert_eq!(create.approval_id(), create.approval().approval_id);
    assert_eq!(create.approval().decision, ApprovalDecision::Pending);
    tools
        .approve(&create, ApprovalDecision::Allow, true, 1)
        .unwrap();
    assert_eq!(
        tools.execute_prepared(&create, 1).unwrap().status,
        ReceiptStatus::Applied
    );

    let reminder = tools.get_reminder("home", "probe-reminder").unwrap();
    let prepared = tools
        .prepare_pause_reminder(
            context("pause"),
            "home",
            "probe-reminder",
            reminder.version,
            1,
        )
        .unwrap();
    assert_eq!(prepared.action_id(), prepared.plan().actions[0].action_id);
    assert_eq!(prepared.approval_id(), prepared.approval().approval_id);
    tools
        .approve(&prepared, ApprovalDecision::Allow, true, 1)
        .unwrap();

    let scheduled = tools
        .scheduler
        .get(&reminder.schedule_task_id)
        .unwrap()
        .clone();
    tools
        .scheduler
        .pause(&reminder.schedule_task_id, scheduled.version)
        .unwrap();
    assert_eq!(
        tools.execute_prepared(&prepared, 1),
        Err(LifeError::VersionConflict)
    );

    let unchanged = tools.get_reminder("home", "probe-reminder").unwrap();
    assert_eq!(unchanged.status, ReminderStatus::Active);
    assert_eq!(unchanged.version, reminder.version);
    assert_eq!(
        tools
            .scheduler
            .get(&reminder.schedule_task_id)
            .unwrap()
            .status,
        ScheduleStatus::Paused
    );
    assert!(tools
        .chain
        .receipts()
        .iter()
        .filter(|receipt| receipt.action_id == prepared.action_id())
        .all(|receipt| receipt.status != ReceiptStatus::Applied));
}
