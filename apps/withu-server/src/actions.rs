//! Owner-only D4 RPC boundary. The sole adapter is fake/local; no network,
//! provider credentials, D5 domain objects, or external effects are available.
use std::collections::{BTreeMap, HashMap, VecDeque};

use serde::Deserialize;
use serde_json::{json, Value};
use withu_approvals::{ApprovalCard, ApprovalDecision, ApprovalError, ApprovalMode};
use withu_connectors::{
    ActionCatalog, ActionDefinition, ActionImpact, ActionResult, ActionSpec, ActionSpecBuilder,
    Cancellation, Connector, ConnectorError, ConnectorRegistry, FakeLocalAdapter,
    LocalActionAdapter, ParameterKind, ParameterRule, ParameterValue, PermissionState,
    ReceiptErrorCode,
};
use withu_ipc::validation::validate;
use withu_orchestrator::{
    ActionChain, ActionReceipt, ChainError, DelegatedGoal, ErrorReceipt, PlanPreview, ReceiptStatus,
};

const SCOPE: &str = "comfort:local";
const TARGET: &str = "demo-item";
const CONNECTOR: &str = "d4-fake-local";
const OPERATION: &str = "local_annotation";
const CAPABILITY: &str = "annotation.write";
const MAX_ACTIONS: usize = 128;
const TTL_SECONDS: u64 = 300;
type RpcResult<T> = Result<T, (&'static str, &'static str)>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Proposal {
    schema_version: u16,
    scope: String,
    goal_description: String,
    user_evidence_ref: String,
    operation: String,
    target_id: String,
    expected_version: u64,
    value: String,
}

struct Prepared {
    session: String,
    plan: PlanPreview,
    card: ApprovalCard,
    terminal: bool,
}

#[derive(Default)]
struct LocalAdapter(FakeLocalAdapter);

impl LocalActionAdapter for LocalAdapter {
    fn execute(
        &mut self,
        action: &ActionSpec,
        cancellation: &Cancellation,
    ) -> Result<ActionResult, ConnectorError> {
        let mut result = self.0.execute(action, cancellation)?;
        result.summary =
            "Fake/local annotation recorded in process memory; no external effect".into();
        Ok(result)
    }
}

pub struct Actions {
    chain: ActionChain<LocalAdapter>,
    prepared: HashMap<String, Prepared>,
    audit: VecDeque<Value>,
    audit_version: u64,
    ttl_seconds: u64,
    running: bool,
}

impl Default for Actions {
    fn default() -> Self {
        let mut connectors = ConnectorRegistry::default();
        connectors.register_fake_local(
            Connector {
                id: CONNECTOR.into(),
                capabilities: vec![CAPABILITY.into()],
                permission: PermissionState::NeedsApproval,
                credential_ref: None,
            },
            1,
        );
        connectors.set_target_version(CONNECTOR, "local_demo_item", TARGET, 1);
        connectors.set_data_scope(CONNECTOR, &[SCOPE]);
        let mut catalog = ActionCatalog::new(1).expect("constant policy version");
        catalog
            .register(ActionDefinition {
                operation: OPERATION.into(),
                connector_id: CONNECTOR.into(),
                capability: CAPABILITY.into(),
                impact: ActionImpact::Write,
                safe_for_auto: false,
                action_version: 1,
                parameter_rules: BTreeMap::from([("value".into(), value_rule())]),
            })
            .expect("constant local action definition");
        Self {
            chain: ActionChain::new(connectors, catalog, LocalAdapter::default()),
            prepared: HashMap::new(),
            audit: VecDeque::new(),
            audit_version: 0,
            ttl_seconds: TTL_SECONDS,
            running: true,
        }
    }
}

impl Actions {
    pub fn recognizes(channel: &str) -> bool {
        matches!(
            channel,
            "withu:action:preview"
                | "withu:action:decide"
                | "withu:action:execute"
                | "withu:action:cancel"
                | "withu:annotation:get"
                | "withu:annotation:list"
        )
    }

    pub fn configure_test_failure(&mut self, test: bool) {
        if test && std::env::var("WITHU_TEST_D4_FAILURE").as_deref() == Ok("1") {
            self.chain.adapter.0.fail_next(
                ReceiptErrorCode::ConnectorFailure,
                "Synthetic fake/local failure; no external effect",
            );
        }
    }

    pub fn stop(&mut self) {
        self.running = false;
        self.chain.stop_accepting_work();
    }

    pub fn handle(
        &mut self,
        channel: &str,
        payload: &Value,
        session: &str,
        store: &mut withu_storage::Store,
        now: u64,
    ) -> RpcResult<Value> {
        let schema = match channel {
            "withu:action:preview" => "action-proposal",
            "withu:action:decide" => "typed-approval-decision",
            "withu:action:execute" => "action-execute-request",
            "withu:action:cancel" => "action-cancel-request",
            "withu:annotation:get" => "annotation-get",
            "withu:annotation:list" => "annotation-list",
            _ => return Err(("validation", "action_channel")),
        };
        if !validate(schema, payload) {
            return Err((
                "validation",
                if channel == "withu:action:preview" {
                    "action_proposal_schema"
                } else {
                    "action_request_schema"
                },
            ));
        }
        if channel.starts_with("withu:annotation:") {
            if payload["scope"] != SCOPE
                || channel == "withu:annotation:get" && payload["target_id"] != TARGET
            {
                return Err(("authorization", "action_scope"));
            }
            let annotation = read_annotation(store)?;
            return Ok(if channel.ends_with(":get") {
                json!({"annotation":annotation})
            } else {
                json!({"items":annotation.into_iter().collect::<Vec<_>>()})
            });
        }
        if !self.running {
            return Err(("authorization", "action_lifecycle"));
        }
        // The owner envelope is checked by the server before this handler. No
        // approval-success boolean, ActionSpec, grant, or receipt is accepted.
        let result = match channel {
            "withu:action:preview" => self.preview(payload, session, store, now)?,
            "withu:action:decide" => self.decide(payload, session, now)?,
            "withu:action:execute" => self.execute(payload, session, store, now)?,
            "withu:action:cancel" => self.cancel(payload, session, now)?,
            _ => unreachable!(),
        };
        if let Err(error) = self.persist_audit(store, session, now) {
            // A failed audit commit cannot enable another adapter submission.
            self.stop();
            // Once an execution returned a receipt, retain its honest effect
            // result even if the later audit snapshot commit fails. Readback
            // remains available while further submissions are stopped.
            if channel != "withu:action:execute" {
                return Err(error);
            }
        }
        Ok(result)
    }

    fn preview(
        &mut self,
        payload: &Value,
        session: &str,
        store: &withu_storage::Store,
        now: u64,
    ) -> RpcResult<Value> {
        let request: Proposal = serde_json::from_value(payload.clone())
            .map_err(|_| ("validation", "action_proposal_schema"))?;
        if request.schema_version != 1
            || request.operation != OPERATION
            || request.value.chars().count() > 120
            || request.goal_description.trim().is_empty()
            || request.goal_description.chars().count() > 240
            || request.user_evidence_ref.len() > 128
        {
            return Err(("validation", "action_proposal_schema"));
        }
        if request.scope != SCOPE || request.target_id != TARGET {
            return Err(("authorization", "action_scope"));
        }
        let current_version = read_annotation(store)?
            .map(|v| v["version"].as_u64().expect("validated annotation"))
            .unwrap_or(1);
        if request.expected_version != current_version {
            return Err(("conflict", "action_target_version"));
        }
        // A real submitted user message is the delegation evidence. Model,
        // assistant, media, connector and unscoped references fail closed.
        let message = store
            .get("message", &request.user_evidence_ref)
            .map_err(super::storage_error)?
            .ok_or(("authorization", "action_user_evidence"))?;
        let conversation = store
            .get(
                "conversation",
                message["conversation_id"].as_str().unwrap_or(""),
            )
            .map_err(super::storage_error)?
            .ok_or(("authorization", "action_user_evidence"))?;
        if message["role"] != "user"
            || conversation["mode"] != "comfort"
            || message["text"] != request.goal_description
        {
            return Err(("authorization", "action_user_evidence"));
        }
        // Bound all retained plans/cards/grants/idempotency entries per server
        // lifetime. Never evict a live grant or permit replay by eviction.
        if self.prepared.len() >= MAX_ACTIONS {
            return Err(("authorization", "action_capacity"));
        }
        let id = format!("action:{}", uuid::Uuid::new_v4());
        let task = format!("task:{}", uuid::Uuid::new_v4());
        let cancel = format!("cancel:{}", uuid::Uuid::new_v4());
        let action = ActionSpecBuilder::new(&id, &task, "local-annotation", OPERATION)
            .target("local_demo_item", TARGET, current_version)
            .connector(CONNECTOR, CAPABILITY)
            .parameter("value", ParameterValue::Text(request.value), value_rule())
            .impact(ActionImpact::Write)
            .data_scope([SCOPE])
            .versions(1, 1, 1)
            .expires_at(now.saturating_add(self.ttl_seconds))
            .idempotency(&format!("idem:{}", uuid::Uuid::new_v4()))
            .cancel_token(&cancel)
            .build()
            .map_err(|_| ("validation", "action_proposal_schema"))?;
        let evidence = format!(
            "message:{}:v{}",
            request.user_evidence_ref, message["version"]
        );
        self.chain.connectors.set_target_version(
            CONNECTOR,
            "local_demo_item",
            TARGET,
            current_version,
        );
        let plan = self
            .chain
            .preview(
                DelegatedGoal::new(&request.goal_description, &evidence),
                vec![action],
                1,
                1,
                now,
            )
            .map_err(chain_error)?;
        let card = self
            .chain
            .request_approval(&plan, &id, ApprovalMode::Manual, now)
            .map_err(chain_error)?;
        let result = json!({"schema_version":1,"plan":plan,"approval":card});
        if !validate("action-preview-response", &result) {
            return Err(("internal", "action_response_schema"));
        }
        self.prepared.insert(
            id.clone(),
            Prepared {
                session: session.into(),
                plan,
                card,
                terminal: false,
            },
        );
        self.record(&id, "previewed", now, None);
        Ok(result)
    }

    fn bound(&self, payload: &Value, session: &str) -> RpcResult<&Prepared> {
        let prepared = self
            .prepared
            .get(payload["action_id"].as_str().unwrap_or(""))
            .ok_or(("authorization", "action_missing"))?;
        if prepared.session != session || payload["scope"] != SCOPE {
            return Err(("authorization", "action_scope"));
        }
        if payload["approval_id"] != prepared.card.approval_id {
            return Err(("authorization", "action_approval_scope"));
        }
        Ok(prepared)
    }

    fn decide(&mut self, payload: &Value, session: &str, now: u64) -> RpcResult<Value> {
        let prepared = self.bound(payload, session)?;
        let id = prepared.plan.actions[0].action_id.clone();
        let approval_id = prepared.card.approval_id.clone();
        let decision = if payload["decision"] == "allow_once" {
            ApprovalDecision::Allow
        } else {
            ApprovalDecision::Deny
        };
        // Explicitness comes from this narrow owner command, never a renderer
        // supplied `explicit_user_allow` or already-decided card.
        let card = self
            .chain
            .decide(
                &approval_id,
                decision,
                decision == ApprovalDecision::Allow,
                now,
            )
            .map_err(chain_error)?;
        let result =
            serde_json::to_value(&card).map_err(|_| ("internal", "action_response_schema"))?;
        if !validate("approval-card", &result) {
            return Err(("internal", "action_response_schema"));
        }
        self.prepared.get_mut(&id).expect("bound action").card = card;
        self.record(
            &id,
            if decision == ApprovalDecision::Allow {
                "allow_once"
            } else {
                "denied"
            },
            now,
            None,
        );
        Ok(json!({"approval":result}))
    }

    fn execute(
        &mut self,
        payload: &Value,
        session: &str,
        store: &mut withu_storage::Store,
        now: u64,
    ) -> RpcResult<Value> {
        let prepared = self.bound(payload, session)?;
        let plan = prepared.plan.clone();
        let id = plan.actions[0].action_id.clone();
        if prepared.terminal {
            let receipt = ActionReceipt {
                schema_version: 1,
                action_id: id,
                idempotency_key: plan.actions[0].idempotency_key.clone(),
                status: ReceiptStatus::Rejected,
                result: None,
                error: Some(ErrorReceipt {
                    schema_version: 1,
                    action_id: plan.actions[0].action_id.clone(),
                    code: ReceiptErrorCode::Duplicate,
                    message: "Action already reached a terminal receipt".into(),
                    retryable: false,
                    committed_targets: vec![],
                }),
                effect_committed: false,
                observed_at: now,
            };
            let value = serde_json::to_value(receipt)
                .map_err(|_| ("internal", "action_response_schema"))?;
            if !validate("action-receipt", &value) {
                return Err(("internal", "action_response_schema"));
            }
            return Ok(json!({"receipt":value}));
        }
        let previous = read_annotation(store)?;
        let target_version = previous
            .as_ref()
            .map(|v| v["version"].as_u64().expect("validated annotation"))
            .unwrap_or(1);
        self.chain.connectors.set_target_version(
            CONNECTOR,
            "local_demo_item",
            TARGET,
            target_version,
        );
        let mut receipt = self.chain.execute(&plan, &id, now).map_err(chain_error)?;
        if receipt.status == ReceiptStatus::Applied {
            // Commit the local owner record only after D4 consumed the exact
            // action grant and the fake/local adapter returned Applied.
            let value = match &plan.actions[0].parameters["value"] {
                ParameterValue::Text(value) => value,
                _ => unreachable!("catalog text rule"),
            };
            let annotation = json!({"schema_version":1,"scope":SCOPE,"target_id":TARGET,"version":target_version+1,"value":value,"updated_at":now});
            let fact = withu_audit::AuditFact {
                schema_version: 1,
                operation: "annotation.applied".into(),
                object_id: TARGET.into(),
                occurred_at: now.to_string(),
                actor: session.into(),
                result: "committed".into(),
            };
            // Logical target version 1 represents the initial empty item;
            // storage revision 0 represents its first durable annotation.
            let expected = target_version - 1;
            if store
                .put("d4-local-annotation", TARGET, expected, &annotation, &fact)
                .is_err()
            {
                receipt.status = ReceiptStatus::Failed;
                receipt.effect_committed = false;
                receipt.result = None;
                receipt.error = Some(ErrorReceipt {
                    schema_version: 1,
                    action_id: id.clone(),
                    code: ReceiptErrorCode::ConnectorFailure,
                    message: "Local annotation commit failed; no external effect".into(),
                    retryable: false,
                    committed_targets: vec![],
                });
            } else {
                receipt.result.as_mut().expect("applied result").summary =
                    "Local annotation stored in owner SQLite; no external effect".into();
                self.chain.connectors.set_target_version(
                    CONNECTOR,
                    "local_demo_item",
                    TARGET,
                    target_version + 1,
                );
            }
        }
        let value =
            serde_json::to_value(&receipt).map_err(|_| ("internal", "action_response_schema"))?;
        if !validate("action-receipt", &value) {
            return Err(("internal", "action_response_schema"));
        }
        // Pending authorization can still be explicitly decided. Every other
        // outcome is terminal, bounding the chain's internal receipt storage.
        if receipt.status != ReceiptStatus::Rejected
            || receipt
                .error
                .as_ref()
                .is_some_and(|error| error.code != ReceiptErrorCode::Authorization)
        {
            self.prepared.get_mut(&id).expect("bound action").terminal = true;
        }
        self.record(&id, "receipt", now, Some(json!({"status":value["status"],"code":value["error"]["code"],"effect_committed":receipt.effect_committed})));
        Ok(json!({"receipt":value}))
    }

    fn cancel(&mut self, payload: &Value, session: &str, now: u64) -> RpcResult<Value> {
        let id = payload["action_id"].as_str().unwrap_or("");
        let prepared = self
            .prepared
            .get(id)
            .ok_or(("authorization", "action_missing"))?;
        if prepared.session != session || payload["cancel_token"] != prepared.plan.cancel_token {
            return Err(("authorization", "action_cancel_scope"));
        }
        let token = prepared.plan.cancel_token.clone();
        self.chain.cancel(&token);
        self.record(id, "cancelled", now, None);
        Ok(json!({"cancelled":true,"action_id":id}))
    }

    fn record(&mut self, id: &str, event: &str, now: u64, receipt: Option<Value>) {
        if self.audit.len() == MAX_ACTIONS {
            self.audit.pop_front();
        }
        // Excludes user text, parameter values, approval/cancel tokens and goal
        // evidence. Durable records are audit facts, never resumable grants.
        self.audit.push_back(
            json!({"action_id":id,"event":event,"scope":SCOPE,"observed_at":now,"receipt":receipt}),
        );
    }

    fn persist_audit(
        &mut self,
        store: &mut withu_storage::Store,
        session: &str,
        now: u64,
    ) -> RpcResult<()> {
        if self.audit_version == 0 {
            self.audit_version = store
                .get("d4-action-audit", "bounded")
                .map_err(super::storage_error)?
                .and_then(|v| v["version"].as_u64())
                .unwrap_or(0);
        }
        let fact = withu_audit::AuditFact {
            schema_version: 1,
            operation: "action.audit".into(),
            object_id: "bounded".into(),
            occurred_at: now.to_string(),
            actor: session.into(),
            result: "committed".into(),
        };
        store
            .put(
                "d4-action-audit",
                "bounded",
                self.audit_version,
                &json!({"schema_version":1,"version":self.audit_version+1,"items":self.audit}),
                &fact,
            )
            .map_err(super::storage_error)?;
        self.audit_version += 1;
        Ok(())
    }
}

fn value_rule() -> ParameterRule {
    ParameterRule {
        kind: ParameterKind::Text,
        required: true,
        max_string_length: Some(120),
        min_integer: None,
        max_integer: None,
        allowed_strings: vec![],
    }
}

fn read_annotation(store: &withu_storage::Store) -> RpcResult<Option<Value>> {
    let annotation = store
        .get("d4-local-annotation", TARGET)
        .map_err(super::storage_error)?;
    if annotation
        .as_ref()
        .is_some_and(|value| !validate("local-annotation", value))
    {
        return Err(("internal", "annotation_storage_schema"));
    }
    Ok(annotation)
}

fn chain_error(error: ChainError) -> (&'static str, &'static str) {
    match error {
        ChainError::Approval(ApprovalError::AlreadyUsed | ApprovalError::Duplicate) => {
            ("conflict", "approval_already_used")
        }
        ChainError::Approval(ApprovalError::Expired)
        | ChainError::Connector(ReceiptErrorCode::Expired) => ("authorization", "action_expired"),
        _ => ("authorization", "action_rejected"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Actions, withu_storage::Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("withu-d4-unit-{}", uuid::Uuid::new_v4()));
        let mut store = withu_storage::Store::open(&dir.join("state.sqlite")).unwrap();
        let fact = withu_audit::AuditFact {
            schema_version: 1,
            operation: "test.seed".into(),
            object_id: "user-message".into(),
            occurred_at: "1".into(),
            actor: "owner".into(),
            result: "committed".into(),
        };
        store
            .put(
                "conversation",
                "comfort",
                0,
                &json!({"mode":"comfort"}),
                &fact,
            )
            .unwrap();
        store.put("message", "user-message", 0, &json!({"role":"user","text":"Record locally","conversation_id":"comfort","version":1}), &fact).unwrap();
        (Actions::default(), store, dir)
    }

    fn proposal() -> Value {
        json!({"schema_version":1,"scope":SCOPE,"goal_description":"Record locally","user_evidence_ref":"user-message","operation":OPERATION,"target_id":TARGET,"expected_version":1,"value":"bounded annotation"})
    }

    fn reference(preview: &Value) -> Value {
        json!({"schema_version":1,"action_id":preview["plan"]["actions"][0]["action_id"],"approval_id":preview["approval"]["approval_id"],"scope":SCOPE})
    }

    #[test]
    fn expired_action_never_reaches_adapter_or_local_storage() {
        let (mut actions, mut store, dir) = fixture();
        let preview = actions
            .handle("withu:action:preview", &proposal(), "owner", &mut store, 10)
            .unwrap();
        let request = reference(&preview);
        let mut allow = request.clone();
        allow["decision"] = "allow_once".into();
        actions
            .handle("withu:action:decide", &allow, "owner", &mut store, 11)
            .unwrap();
        let receipt = actions
            .handle("withu:action:execute", &request, "owner", &mut store, 310)
            .unwrap();
        assert_eq!(receipt["receipt"]["error"]["code"], "expired");
        assert_eq!(receipt["receipt"]["effect_committed"], false);
        assert!(actions.chain.adapter.0.calls.is_empty());
        assert!(read_annotation(&store).unwrap().is_none());
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn session_approval_and_cancel_bindings_are_server_owned() {
        let (mut actions, mut store, dir) = fixture();
        let preview = actions
            .handle("withu:action:preview", &proposal(), "owner", &mut store, 10)
            .unwrap();
        let request = reference(&preview);
        assert_eq!(
            actions
                .handle("withu:action:execute", &request, "foreign", &mut store, 11)
                .unwrap_err()
                .1,
            "action_scope"
        );
        let mut wrong_card = request.clone();
        wrong_card["approval_id"] = "approval:other".into();
        assert_eq!(
            actions
                .handle("withu:action:execute", &wrong_card, "owner", &mut store, 11)
                .unwrap_err()
                .1,
            "action_approval_scope"
        );
        let mut forged = request.clone();
        forged["explicit_user_allow"] = true.into();
        assert_eq!(
            actions
                .handle("withu:action:execute", &forged, "owner", &mut store, 11)
                .unwrap_err()
                .1,
            "action_request_schema"
        );
        let mut cancel =
            json!({"schema_version":1,"action_id":request["action_id"],"cancel_token":"forged"});
        assert_eq!(
            actions
                .handle("withu:action:cancel", &cancel, "owner", &mut store, 11)
                .unwrap_err()
                .1,
            "action_cancel_scope"
        );
        cancel["cancel_token"] = preview["plan"]["cancel_token"].clone();
        actions
            .handle("withu:action:cancel", &cancel, "owner", &mut store, 11)
            .unwrap();
        let mut allow = request.clone();
        allow["decision"] = "allow_once".into();
        actions
            .handle("withu:action:decide", &allow, "owner", &mut store, 11)
            .unwrap();
        let receipt = actions
            .handle("withu:action:execute", &request, "owner", &mut store, 12)
            .unwrap();
        assert_eq!(receipt["receipt"]["error"]["code"], "cancelled");
        assert!(actions.chain.adapter.0.calls.is_empty());
        assert!(read_annotation(&store).unwrap().is_none());
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn deny_and_failed_storage_commit_return_no_applied_effect() {
        let (mut actions, mut store, dir) = fixture();
        let preview = actions
            .handle("withu:action:preview", &proposal(), "owner", &mut store, 10)
            .unwrap();
        let request = reference(&preview);
        let mut deny = request.clone();
        deny["decision"] = "deny".into();
        actions
            .handle("withu:action:decide", &deny, "owner", &mut store, 11)
            .unwrap();
        let receipt = actions
            .handle("withu:action:execute", &request, "owner", &mut store, 12)
            .unwrap();
        assert_eq!(receipt["receipt"]["status"], "rejected");
        assert!(actions.chain.adapter.0.calls.is_empty());
        let next = actions
            .handle("withu:action:preview", &proposal(), "owner", &mut store, 13)
            .unwrap();
        let request = reference(&next);
        let mut allow = request.clone();
        allow["decision"] = "allow_once".into();
        actions
            .handle("withu:action:decide", &allow, "owner", &mut store, 14)
            .unwrap();
        store.fail_next_commit();
        let receipt = actions
            .handle("withu:action:execute", &request, "owner", &mut store, 15)
            .unwrap();
        assert_eq!(receipt["receipt"]["status"], "failed");
        assert_eq!(receipt["receipt"]["effect_committed"], false);
        assert_eq!(receipt["receipt"]["error"]["committed_targets"], json!([]));
        assert!(read_annotation(&store).unwrap().is_none());
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
