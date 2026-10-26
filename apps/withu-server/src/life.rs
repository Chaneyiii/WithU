//! Production owner boundary for local life tools. No network or send operation.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use withu_audit::AuditFact;
use withu_life::{
    ActionContext, CalendarInput, LifeSnapshot, LifeTools, PreparedAction, ReminderInput,
    ReminderStatus, StructuredContent,
};
use withu_runtime::ApprovalDecision;
use withu_scheduler::SchedulerLimits;
use withu_storage::Store;

type Error = (&'static str, &'static str);
type Result<T> = std::result::Result<T, Error>;
fn invalid() -> Error {
    ("validation", "life_schema")
}
fn life_error(e: withu_life::LifeError) -> Error {
    use withu_life::LifeError::*;
    match e {
        ScopeDenied => ("authorization", "life_scope"),
        VersionConflict => ("conflict", "life_version_conflict"),
        AlreadyExists => ("conflict", "life_already_exists"),
        NotFound => ("validation", "life_not_found"),
        _ => ("validation", "life_action_rejected"),
    }
}
fn decode<T: serde::de::DeserializeOwned>(p: &Value) -> Result<T> {
    serde_json::from_value(p.clone()).map_err(|_| invalid())
}
#[derive(Deserialize)]
struct Envelope {
    schema_version: u16,
    scope: String,
    #[serde(flatten)]
    body: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Operation {
    DraftCreate {
        id: String,
        conversation_id: String,
        text: String,
        file_refs: Vec<String>,
    },
    DraftEdit {
        id: String,
        text: String,
        file_refs: Vec<String>,
        expected_version: u64,
    },
    DraftDiscard {
        id: String,
        expected_version: u64,
    },
    CalendarCreate {
        id: String,
        title: String,
        starts_at: u64,
        ends_at: u64,
        timezone: String,
        notes: String,
    },
    CalendarEdit {
        id: String,
        title: String,
        starts_at: u64,
        ends_at: u64,
        timezone: String,
        notes: String,
        expected_version: u64,
    },
    CalendarDelete {
        id: String,
        expected_version: u64,
    },
    ReminderCreate {
        id: String,
        text: String,
        due_at: u64,
        timezone: String,
    },
    ReminderEdit {
        id: String,
        text: String,
        due_at: u64,
        timezone: String,
        expected_version: u64,
    },
    ReminderDelete {
        id: String,
        expected_version: u64,
    },
    ReminderPause {
        id: String,
        expected_version: u64,
    },
    ReminderResume {
        id: String,
        expected_version: u64,
    },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Prepare {
    operation_id: String,
    user_evidence_ref: String,
    goal_description: String,
    expires_at: Option<u64>,
    operation: Operation,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Id {
    operation_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decide {
    operation_id: String,
    decision: String,
    explicit_user_allow: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Read {
    kind: String,
    id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Retrieve {
    operation_id: String,
    user_evidence_ref: String,
    query: String,
    limit: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Organize {
    operation_id: String,
    user_evidence_ref: String,
    items: Vec<StructuredContent>,
    group_by: String,
    summary_limit: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Tick {
    app_running: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct State {
    schema_version: u16,
    storage_version: u64,
    snapshot: LifeSnapshot,
    reserved: BTreeSet<String>,
    receipts: BTreeMap<String, Value>,
    due_terminal: BTreeMap<String, String>,
}
pub struct Owner {
    tools: LifeTools,
    state: State,
    pending: BTreeMap<String, PreparedAction>,
    decided: BTreeSet<String>,
    poisoned: bool,
    last_tick: u64,
}
impl Owner {
    pub fn load(store: &mut Store, now: u64) -> Result<Self> {
        let mut tools = LifeTools::new(
            ["comfort"],
            SchedulerLimits {
                schema_version: 1,
                max_concurrent: 2,
                budget_units: 100000,
                max_retries: 0,
                rate_limit: 120,
                rate_window_seconds: 60,
            },
        )
        .map_err(life_error)?;
        let state = match store
            .get("life", "comfort")
            .map_err(|_| ("storage", "life_load"))?
        {
            Some(v) => decode::<State>(&v)?,
            None => State {
                schema_version: 1,
                storage_version: 0,
                snapshot: tools.snapshot(),
                reserved: BTreeSet::new(),
                receipts: BTreeMap::new(),
                due_terminal: BTreeMap::new(),
            },
        };
        if state.schema_version != 1 {
            return Err(invalid());
        }
        tools.restore(state.snapshot.clone()).map_err(life_error)?;
        let mut owner = Self {
            tools,
            state,
            pending: BTreeMap::new(),
            decided: BTreeSet::new(),
            poisoned: false,
            last_tick: now,
        };
        let mut changed = false;
        for r in owner.tools.list_reminders("comfort") {
            if r.due_at <= now {
                let key = Self::due_key(&r.id, r.version);
                if !owner.state.due_terminal.contains_key(&key) {
                    owner
                        .state
                        .due_terminal
                        .insert(key, "discarded_on_restart".into());
                    changed = true;
                }
            }
        }
        if changed {
            owner.save(store, now, "restart_discard")?;
        }
        Ok(owner)
    }
    fn due_key(id: &str, version: u64) -> String {
        format!("life-reminder:{id}:v{version}")
    }
    fn save(&mut self, store: &mut Store, now: u64, operation: &str) -> Result<()> {
        self.state.snapshot = self.tools.snapshot();
        let old = self.state.storage_version;
        self.state.storage_version = old
            .checked_add(1)
            .ok_or(("storage", "life_version_exhausted"))?;
        let fact = AuditFact {
            schema_version: 1,
            operation: format!("life:{operation}"),
            object_id: "comfort".into(),
            occurred_at: now.to_string(),
            actor: "owner".into(),
            result: "committed".into(),
        };
        if store
            .put("life", "comfort", old, &json!(self.state), &fact)
            .is_err()
        {
            self.poisoned = true;
            return Err(("storage", "life_commit_failed"));
        }
        Ok(())
    }
    fn reserve(&mut self, id: &str) -> Result<()> {
        if id.trim().is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
            return Err(invalid());
        }
        if !self.state.reserved.insert(id.into()) {
            return Err(("conflict", "life_duplicate_operation"));
        }
        Ok(())
    }
    fn context(
        id: &str,
        evidence: &str,
        goal: &str,
        now: u64,
        expiry: Option<u64>,
    ) -> Result<ActionContext> {
        let expiry = expiry.unwrap_or(now.saturating_add(300));
        if expiry <= now
            || expiry > now.saturating_add(300)
            || evidence.trim().is_empty()
            || evidence.len() > 256
            || goal.trim().is_empty()
            || goal.len() > 1024
        {
            return Err(invalid());
        }
        Ok(ActionContext::delegated(id, goal, evidence, now, expiry))
    }
    pub fn handle(
        &mut self,
        store: &mut Store,
        channel: &str,
        p: &Value,
        now: u64,
    ) -> Result<Value> {
        if self.poisoned {
            return Err(("storage", "life_restart_required"));
        }
        let env = decode::<Envelope>(p)?;
        if env.schema_version != 1 {
            return Err(invalid());
        }
        if env.scope != "comfort" {
            return Err(("authorization", "life_scope"));
        }
        let b = json!(env.body);
        let result = match channel {
            "withu:life:list" => {
                if !env.body.is_empty() {
                    return Err(invalid());
                }
                return Ok(
                    json!({"drafts":self.tools.list_drafts("comfort"),"calendar":self.tools.list_calendar("comfort"),"reminders":self.tools.list_reminders("comfort"),"receipts":self.state.receipts.values().collect::<Vec<_>>(),"due_terminal":self.state.due_terminal}),
                );
            }
            "withu:life:read" => {
                let r = decode::<Read>(&b)?;
                let value = match r.kind.as_str() {
                    "draft" => json!(self.tools.get_draft("comfort", &r.id)),
                    "calendar" => json!(self.tools.get_calendar("comfort", &r.id)),
                    "reminder" => json!(self.tools.get_reminder("comfort", &r.id)),
                    _ => return Err(invalid()),
                };
                return Ok(json!({"value":value}));
            }
            "withu:life:prepare" => {
                let r = decode::<Prepare>(&b)?;
                let ctx = Self::context(
                    &r.operation_id,
                    &r.user_evidence_ref,
                    &r.goal_description,
                    now,
                    r.expires_at,
                )?;
                if self.state.reserved.contains(&r.operation_id) {
                    return Err(("conflict", "life_duplicate_operation"));
                }
                let prepared = self.prepare(ctx, r.operation, now).map_err(life_error)?;
                self.reserve(&r.operation_id)?;
                let out = json!({"operation_id":r.operation_id,"plan":prepared.plan(),"approval":prepared.approval()});
                self.pending.insert(r.operation_id, prepared);
                out
            }
            "withu:life:decide" => {
                let r = decode::<Decide>(&b)?;
                let p = self
                    .pending
                    .get(&r.operation_id)
                    .ok_or(("validation", "life_pending_missing"))?;
                let d = match r.decision.as_str() {
                    "allow" => ApprovalDecision::Allow,
                    "deny" => ApprovalDecision::Deny,
                    _ => return Err(invalid()),
                };
                let approval = self
                    .tools
                    .approve(p, d, r.explicit_user_allow, now)
                    .map_err(life_error)?;
                self.decided.insert(r.operation_id);
                json!({"approval":approval})
            }
            "withu:life:execute" | "withu:life:cancel" => {
                let r = decode::<Id>(&b)?;
                if let Some(receipt) = self.state.receipts.get(&r.operation_id) {
                    return Ok(json!({"receipt":receipt}));
                }
                let p = self
                    .pending
                    .get(&r.operation_id)
                    .ok_or(("validation", "life_pending_missing"))?;
                if channel.ends_with(":execute") && !self.decided.contains(&r.operation_id) {
                    return Err(("authorization", "life_explicit_decision_required"));
                }
                if channel.ends_with(":cancel") {
                    self.tools.chain.cancel_plan(p.plan());
                }
                let receipt = match self.tools.execute_prepared(p, now) {
                    Ok(receipt) => receipt,
                    Err(error) => {
                        // Local CAS can fail after preparation. Preserve the
                        // chain's truthful rejected receipt in the same durable
                        // state as objects, rather than losing it to RPC error.
                        if let Some(receipt) = self
                            .tools
                            .chain
                            .receipts()
                            .iter()
                            .rev()
                            .find(|r| r.action_id == p.action_id())
                            .cloned()
                        {
                            self.pending.remove(&r.operation_id);
                            self.decided.remove(&r.operation_id);
                            self.state.receipts.insert(r.operation_id, json!(receipt));
                            self.save(store, now, "execute_rejected")?;
                        }
                        return Err(life_error(error));
                    }
                };
                let v = json!(receipt);
                self.pending.remove(&r.operation_id);
                self.decided.remove(&r.operation_id);
                self.state.receipts.insert(r.operation_id, v.clone());
                json!({"receipt":v})
            }
            "withu:life:retrieve" => {
                let r = decode::<Retrieve>(&b)?;
                let ctx = Self::context(
                    &r.operation_id,
                    &r.user_evidence_ref,
                    "Retrieve bounded local information",
                    now,
                    None,
                )?;
                self.reserve(&r.operation_id)?;
                let v = self
                    .tools
                    .retrieve_information(ctx, "comfort", &r.query, r.limit, now)
                    .map_err(life_error)?;
                self.state.receipts.insert(r.operation_id, json!(v.receipt));
                json!({"receipt":v.receipt,"value":v.value})
            }
            "withu:life:organize" => {
                let r = decode::<Organize>(&b)?;
                if r.summary_limit > 8192 {
                    return Err(invalid());
                }
                let ctx = Self::context(
                    &r.operation_id,
                    &r.user_evidence_ref,
                    "Organize user supplied content",
                    now,
                    None,
                )?;
                self.reserve(&r.operation_id)?;
                let v = self
                    .tools
                    .organize_content(ctx, "comfort", &r.items, &r.group_by, r.summary_limit, now)
                    .map_err(life_error)?;
                self.state.receipts.insert(r.operation_id, json!(v.receipt));
                json!({"receipt":v.receipt,"value":v.value})
            }
            "withu:life:tick" => {
                let r = decode::<Tick>(&b)?;
                return self.tick(store, r.app_running, now);
            }
            _ => return Err(("validation", "life_channel")),
        };
        self.save(store, now, channel)?;
        Ok(result)
    }
    fn tick(&mut self, store: &mut Store, app_running: bool, now: u64) -> Result<Value> {
        self.tools.scheduler.set_app_running(app_running);
        let gap = now.saturating_sub(self.last_tick);
        self.last_tick = now;
        let mut candidates = Vec::new();
        let mut changed = false;
        for r in self.tools.list_reminders("comfort") {
            if r.status == ReminderStatus::Deleted || r.due_at > now {
                continue;
            }
            let key = Self::due_key(&r.id, r.version);
            if self.state.due_terminal.contains_key(&key) {
                continue;
            }
            let reason = if !app_running {
                "discarded_app_stopped"
            } else if r.status != ReminderStatus::Active {
                "discarded_paused"
            } else if gap > 90 || now.saturating_sub(r.due_at) > 60 {
                "discarded_missed_due"
            } else {
                "offered"
            };
            if reason == "offered" {
                // Keep scheduler authorization, cancellation, concurrency, budget
                // and rate gates in the actual due path.
                let lease = match self.tools.scheduler.begin_run(&r.schedule_task_id, now, 1) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                self.tools
                    .scheduler
                    .finish_run(lease)
                    .map_err(|_| ("validation", "life_schedule_failed"))?;
                candidates.push(json!({"schema_version":1,"id":key,"source":"d5_reminder","scope":"comfort","dedupe_key":key,"title":"Reminder","body":r.text}));
            }
            self.state.due_terminal.insert(key, reason.into());
            changed = true;
        }
        if changed {
            self.save(store, now, "due_tick")?;
        }
        Ok(json!({"candidates":candidates}))
    }
    fn prepare(
        &mut self,
        ctx: ActionContext,
        op: Operation,
        now: u64,
    ) -> std::result::Result<PreparedAction, withu_life::LifeError> {
        use Operation::*;
        match op {
            DraftCreate {
                id,
                conversation_id,
                text,
                file_refs,
            } => self.tools.prepare_create_draft(
                ctx,
                "comfort",
                &id,
                &conversation_id,
                &text,
                file_refs,
                now,
            ),
            DraftEdit {
                id,
                text,
                file_refs,
                expected_version,
            } => self.tools.prepare_edit_draft(
                ctx,
                "comfort",
                &id,
                expected_version,
                &text,
                file_refs,
                now,
            ),
            DraftDiscard {
                id,
                expected_version,
            } => self
                .tools
                .prepare_discard_draft(ctx, "comfort", &id, expected_version, now),
            CalendarCreate {
                id,
                title,
                starts_at,
                ends_at,
                timezone,
                notes,
            } => self.tools.prepare_create_calendar(
                ctx,
                CalendarInput {
                    scope: "comfort".into(),
                    id,
                    title,
                    starts_at,
                    ends_at,
                    timezone,
                    notes,
                },
                now,
            ),
            CalendarEdit {
                id,
                title,
                starts_at,
                ends_at,
                timezone,
                notes,
                expected_version,
            } => self.tools.prepare_edit_calendar(
                ctx,
                CalendarInput {
                    scope: "comfort".into(),
                    id,
                    title,
                    starts_at,
                    ends_at,
                    timezone,
                    notes,
                },
                expected_version,
                now,
            ),
            CalendarDelete {
                id,
                expected_version,
            } => self
                .tools
                .prepare_delete_calendar(ctx, "comfort", &id, expected_version, now),
            ReminderCreate {
                id,
                text,
                due_at,
                timezone,
            } => self.tools.prepare_create_reminder(
                ctx,
                ReminderInput {
                    scope: "comfort".into(),
                    id,
                    text,
                    due_at,
                    timezone,
                },
                now,
            ),
            ReminderEdit {
                id,
                text,
                due_at,
                timezone,
                expected_version,
            } => self.tools.prepare_edit_reminder(
                ctx,
                ReminderInput {
                    scope: "comfort".into(),
                    id,
                    text,
                    due_at,
                    timezone,
                },
                expected_version,
                now,
            ),
            ReminderDelete {
                id,
                expected_version,
            } => self
                .tools
                .prepare_delete_reminder(ctx, "comfort", &id, expected_version, now),
            ReminderPause {
                id,
                expected_version,
            } => self
                .tools
                .prepare_pause_reminder(ctx, "comfort", &id, expected_version, now),
            ReminderResume {
                id,
                expected_version,
            } => self
                .tools
                .prepare_resume_reminder(ctx, "comfort", &id, expected_version, now),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Store {
        Store::open(
            &std::env::temp_dir().join(format!("withu-life-{}.sqlite", uuid::Uuid::new_v4())),
        )
        .unwrap()
    }
    fn call(o: &mut Owner, s: &mut Store, name: &str, b: Value, t: u64) -> Result<Value> {
        let mut p = b;
        p["schema_version"] = json!(1);
        p["scope"] = json!("comfort");
        o.handle(s, &format!("withu:life:{name}"), &p, t)
    }
    fn prep(o: &mut Owner, s: &mut Store, id: &str, op: Value, t: u64) -> Value {
        call(o,s,"prepare",json!({"operation_id":id,"user_evidence_ref":"user:explicit","goal_description":"user requested local task","operation":op}),t).unwrap()
    }
    fn allow(o: &mut Owner, s: &mut Store, id: &str, t: u64) {
        call(
            o,
            s,
            "decide",
            json!({"operation_id":id,"decision":"allow","explicit_user_allow":true}),
            t,
        )
        .unwrap();
    }
    fn apply(o: &mut Owner, s: &mut Store, id: &str, t: u64) -> Value {
        allow(o, s, id, t);
        call(o, s, "execute", json!({"operation_id":id}), t).unwrap()
    }
    #[test]
    fn owner_approval_cas_idempotency_and_restart() {
        let mut s = db();
        let mut o = Owner::load(&mut s, 10).unwrap();
        prep(
            &mut o,
            &mut s,
            "a",
            json!({"kind":"draft_create","id":"d","conversation_id":"local","text":"private draft","file_refs":[]}),
            10,
        );
        assert!(call(&mut o, &mut s, "execute", json!({"operation_id":"a"}), 11).is_err());
        assert_eq!(
            call(&mut o, &mut s, "list", json!({}), 11).unwrap()["drafts"],
            json!([])
        );
        assert!(call(
            &mut o,
            &mut s,
            "decide",
            json!({"operation_id":"a","decision":"allow","explicit_user_allow":false}),
            11
        )
        .is_err());
        assert_eq!(
            apply(&mut o, &mut s, "a", 12)["receipt"]["status"],
            "applied"
        );
        assert_eq!(
            call(&mut o, &mut s, "execute", json!({"operation_id":"a"}), 13).unwrap()["receipt"]
                ["status"],
            "applied"
        );
        assert!(call(&mut o,&mut s,"prepare",json!({"operation_id":"stale","user_evidence_ref":"user:explicit","goal_description":"edit","operation":{"kind":"draft_edit","id":"d","text":"bad","file_refs":[],"expected_version":0}}),14).is_err());
        prep(
            &mut o,
            &mut s,
            "unapproved",
            json!({"kind":"draft_create","id":"pending","conversation_id":"local","text":"pending","file_refs":[]}),
            14,
        );
        allow(&mut o, &mut s, "unapproved", 14);
        let mut restarted = Owner::load(&mut s, 15).unwrap();
        assert_eq!(
            call(&mut restarted, &mut s, "list", json!({}), 15).unwrap()["drafts"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(call(
            &mut restarted,
            &mut s,
            "execute",
            json!({"operation_id":"unapproved"}),
            15
        )
        .is_err());
        assert!(restarted
            .handle(
                &mut s,
                "withu:life:list",
                &json!({"schema_version":1,"scope":"work"}),
                15
            )
            .is_err());
        let result = call(
            &mut restarted,
            &mut s,
            "retrieve",
            json!({"operation_id":"read","user_evidence_ref":"user:x","query":"weather","limit":2}),
            15,
        )
        .unwrap();
        assert_eq!(result["value"][0]["status"], "unavailable");
        assert!(result["value"][0]["content"].is_null());
    }
    #[test]
    fn owner_due_gates_once_and_discards_missed_due() {
        let mut s = db();
        let mut o = Owner::load(&mut s, 10).unwrap();
        for (id, due) in [("once", 20), ("stopped", 30), ("restart", 40), ("late", 50)] {
            prep(
                &mut o,
                &mut s,
                id,
                json!({"kind":"reminder_create","id":id,"text":"water","due_at":due,"timezone":"UTC"}),
                10,
            );
            apply(&mut o, &mut s, id, 11);
        }
        assert_eq!(
            call(&mut o, &mut s, "tick", json!({"app_running":true}), 19).unwrap()["candidates"],
            json!([])
        );
        assert_eq!(
            call(&mut o, &mut s, "tick", json!({"app_running":true}), 20).unwrap()["candidates"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            call(&mut o, &mut s, "tick", json!({"app_running":true}), 21).unwrap()["candidates"],
            json!([])
        );
        assert_eq!(
            call(&mut o, &mut s, "tick", json!({"app_running":false}), 30).unwrap()["candidates"],
            json!([])
        );
        let mut o = Owner::load(&mut s, 40).unwrap();
        assert_eq!(
            call(&mut o, &mut s, "tick", json!({"app_running":true}), 40).unwrap()["candidates"],
            json!([])
        );
        assert_eq!(
            call(&mut o, &mut s, "tick", json!({"app_running":true}), 150).unwrap()["candidates"],
            json!([])
        );
        assert!(call(
            &mut o,
            &mut s,
            "tick",
            json!({"app_running":true,"now":999}),
            150
        )
        .is_err());
    }
}

#[cfg(test)]
mod terminal_tests {
    use super::*;
    #[test]
    fn failed_durable_commit_fails_closed() {
        let mut store = Store::open(&std::env::temp_dir().join(format!(
            "withu-life-failure-{}.sqlite",
            uuid::Uuid::new_v4()
        )))
        .unwrap();
        let mut owner = Owner::load(&mut store, 1).unwrap();
        store.fail_next_commit();
        let result=owner.handle(&mut store,"withu:life:prepare",&json!({"schema_version":1,"scope":"comfort","operation_id":"x","user_evidence_ref":"user:x","goal_description":"Create draft","operation":{"kind":"draft_create","id":"x","conversation_id":"local","text":"x","file_refs":[]}}),1);
        assert_eq!(result.unwrap_err().1, "life_commit_failed");
        assert_eq!(
            owner
                .handle(
                    &mut store,
                    "withu:life:list",
                    &json!({"schema_version":1,"scope":"comfort"}),
                    1
                )
                .unwrap_err()
                .1,
            "life_restart_required"
        );
        let mut restored = Owner::load(&mut store, 2).unwrap();
        assert_eq!(
            restored
                .handle(
                    &mut store,
                    "withu:life:list",
                    &json!({"schema_version":1,"scope":"comfort"}),
                    2
                )
                .unwrap()["drafts"],
            json!([])
        );
    }
    #[test]
    fn approved_action_expiry_and_stale_execution_never_commit() {
        let mut store = Store::open(
            &std::env::temp_dir()
                .join(format!("withu-life-expiry-{}.sqlite", uuid::Uuid::new_v4())),
        )
        .unwrap();
        let mut owner = Owner::load(&mut store, 1).unwrap();
        let base = json!({"schema_version":1,"scope":"comfort","operation_id":"expiry","user_evidence_ref":"user:x","goal_description":"Create draft","expires_at":5,"operation":{"kind":"draft_create","id":"x","conversation_id":"local","text":"x","file_refs":[]}});
        owner
            .handle(&mut store, "withu:life:prepare", &base, 1)
            .unwrap();
        owner.handle(&mut store,"withu:life:decide",&json!({"schema_version":1,"scope":"comfort","operation_id":"expiry","decision":"allow","explicit_user_allow":true}),2).unwrap();
        let receipt = owner
            .handle(
                &mut store,
                "withu:life:execute",
                &json!({"schema_version":1,"scope":"comfort","operation_id":"expiry"}),
                5,
            )
            .unwrap();
        assert_eq!(receipt["receipt"]["error"]["code"], "expired");
        assert!(owner.tools.list_drafts("comfort").is_empty());
    }
}
