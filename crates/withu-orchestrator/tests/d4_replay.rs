use withu_connectors::{
    ActionCatalog, ActionDefinition, ActionImpact, ActionSpec, Connector, FakeLocalAdapter,
    PermissionState,
};
use withu_orchestrator::{ActionChain, DelegatedGoal, ReceiptStatus};
use withu_runtime::{ApprovalDecision, ApprovalMode};

fn action(id: &str, operation: &str, capability: &str, impact: ActionImpact) -> ActionSpec {
    withu_orchestrator::ActionSpecBuilder::new(id, "task-replay", id, operation)
        .target("item", id, 1)
        .connector("fixture", capability)
        .impact(impact)
        .safe_for_auto(impact == ActionImpact::ReadOnly)
        .data_scope([format!("item:{id}")])
        .versions(1, 1, 1)
        .expires_at(100)
        .idempotency(&format!("idem-{id}"))
        .cancel_token("cancel-task-replay")
        .build()
        .unwrap()
}

fn chain() -> ActionChain<FakeLocalAdapter> {
    let mut connectors = withu_connectors::ConnectorRegistry::default();
    connectors.register_fake_local(
        Connector {
            id: "fixture".into(),
            capabilities: vec!["query.read".into(), "message.write".into()],
            permission: PermissionState::AlwaysAllow,
            credential_ref: None,
        },
        1,
    );
    connectors.set_target_version("fixture", "item", "read", 1);
    connectors.set_target_version("fixture", "item", "write", 1);
    connectors.set_data_scope("fixture", &["item:read", "item:write"]);
    let mut catalog = ActionCatalog::new(1).unwrap();
    for (operation, capability, impact, safe_for_auto) in [
        ("query", "query.read", ActionImpact::ReadOnly, true),
        (
            "send_message",
            "message.write",
            ActionImpact::ExternalSideEffect,
            false,
        ),
    ] {
        catalog
            .register(ActionDefinition {
                operation: operation.into(),
                connector_id: "fixture".into(),
                capability: capability.into(),
                impact,
                safe_for_auto,
                action_version: 1,
                parameter_rules: std::collections::BTreeMap::new(),
            })
            .unwrap();
    }
    ActionChain::new(connectors, catalog, FakeLocalAdapter::default())
}

#[test]
fn isolated_comfort_replay_keeps_receipts_honest() {
    let mut chain = chain();
    let read = action("read", "query", "query.read", ActionImpact::ReadOnly);
    let write = action(
        "write",
        "send_message",
        "message.write",
        ActionImpact::ExternalSideEffect,
    );
    let plan = chain
        .preview(
            DelegatedGoal::new("find and draft", "synthetic-user-turn"),
            vec![read.clone(), write.clone()],
            1,
            1,
            1,
        )
        .unwrap();
    let read_card = chain
        .request_approval(&plan, "read", ApprovalMode::Auto, 2)
        .unwrap();
    assert_eq!(
        chain.execute(&plan, "read", 2).unwrap().status,
        ReceiptStatus::Applied
    );
    let write_card = chain
        .request_approval(&plan, "write", ApprovalMode::Manual, 2)
        .unwrap();
    assert_eq!(write_card.decision, ApprovalDecision::Pending);
    let pending = chain.execute(&plan, "write", 2).unwrap();
    assert_eq!(pending.status, ReceiptStatus::Rejected);
    assert_eq!(
        pending.error.unwrap().code,
        withu_connectors::ReceiptErrorCode::Authorization
    );
    chain
        .decide(&write_card.approval_id, ApprovalDecision::Allow, true, 2)
        .unwrap();
    let applied = chain.execute(&plan, "write", 2).unwrap();
    assert_eq!(applied.status, ReceiptStatus::Applied);
    let duplicate = chain.execute(&plan, "write", 2).unwrap();
    assert_eq!(
        duplicate.error.unwrap().code,
        withu_connectors::ReceiptErrorCode::Duplicate
    );
    assert_eq!(chain.adapter.effects.len(), 1);
    drop(read_card);
}

#[test]
fn replay_rejects_expiry_revocation_version_and_cancel_without_effect() {
    let mut chain = chain();
    let write = action(
        "write",
        "send_message",
        "message.write",
        ActionImpact::ExternalSideEffect,
    );
    let plan = chain
        .preview(
            DelegatedGoal::new("send", "synthetic-user-turn"),
            vec![write],
            1,
            1,
            1,
        )
        .unwrap();
    let card = chain
        .request_approval(&plan, "write", ApprovalMode::Manual, 2)
        .unwrap();
    chain.cancel_plan(&plan);
    chain
        .decide(&card.approval_id, ApprovalDecision::Allow, true, 2)
        .unwrap();
    let cancelled = chain.execute(&plan, "write", 2).unwrap();
    assert_eq!(
        cancelled.error.unwrap().code,
        withu_connectors::ReceiptErrorCode::Cancelled
    );
    assert!(chain.adapter.effects.is_empty());
}
