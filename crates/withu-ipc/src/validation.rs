use serde_json::Value;
pub fn schema(name: &str) -> Option<Value> {
    let text = match name {
        "realtime-scope" => include_str!("../../../contracts/v1/realtime-scope.schema.json"),
        "realtime-start" => include_str!("../../../contracts/v1/realtime-start.schema.json"),
        "realtime-input" => include_str!("../../../contracts/v1/realtime-input.schema.json"),
        "message-correct" => include_str!("../../../contracts/v1/message-correct.schema.json"),
        "affect-feedback" => include_str!("../../../contracts/v1/affect-feedback.schema.json"),
        "affect-plan" => include_str!("../../../contracts/v1/affect-plan.schema.json"),
        "realtime-command" => include_str!("../../../contracts/v1/realtime-command.schema.json"),
        "voice-request" => include_str!("../../../contracts/v1/voice-request.schema.json"),
        "voice-session-start" => {
            include_str!("../../../contracts/v1/voice-session-start.schema.json")
        }
        "voice-session-command" => {
            include_str!("../../../contracts/v1/voice-session-command.schema.json")
        }
        "voice-scope" => include_str!("../../../contracts/v1/voice-scope.schema.json"),
        "model-list" => include_str!("../../../contracts/v1/model-list.schema.json"),
        "config-test" => include_str!("../../../contracts/v1/config-test.schema.json"),
        "assistant-message" => include_str!("../../../contracts/v1/assistant-message.schema.json"),
        "reply-block" => include_str!("../../../contracts/v1/reply-block.schema.json"),
        "reply-start" => include_str!("../../../contracts/v1/reply-start.schema.json"),
        "reply-cancel" => include_str!("../../../contracts/v1/reply-cancel.schema.json"),
        "action" => include_str!("../../../contracts/v1/action.schema.json"),
        "action-execution" => include_str!("../../../contracts/v1/action-execution.schema.json"),
        "action-proposal" => include_str!("../../../contracts/v1/action-proposal.schema.json"),
        "action-preview-response" => {
            include_str!("../../../contracts/v1/action-preview-response.schema.json")
        }
        "action-execute-request" => {
            include_str!("../../../contracts/v1/action-execute-request.schema.json")
        }
        "action-cancel-request" => {
            include_str!("../../../contracts/v1/action-cancel-request.schema.json")
        }
        "typed-approval-decision" => {
            include_str!("../../../contracts/v1/typed-approval-decision.schema.json")
        }
        "local-annotation" => include_str!("../../../contracts/v1/local-annotation.schema.json"),
        "annotation-get" => include_str!("../../../contracts/v1/annotation-get.schema.json"),
        "annotation-list" => include_str!("../../../contracts/v1/annotation-list.schema.json"),
        "action-receipt" => include_str!("../../../contracts/v1/action-receipt.schema.json"),
        "affect-hypothesis" => include_str!("../../../contracts/v1/affect-hypothesis.schema.json"),
        "affect-turn" => include_str!("../../../contracts/v1/affect-turn.schema.json"),
        "affect-observation" => {
            include_str!("../../../contracts/v1/affect-observation.schema.json")
        }
        "approval" => include_str!("../../../contracts/v1/approval.schema.json"),
        "approval-card" => include_str!("../../../contracts/v1/approval-card.schema.json"),
        "audit" => include_str!("../../../contracts/v1/audit.schema.json"),
        "background-candidate" => {
            include_str!("../../../contracts/v1/background-candidate.schema.json")
        }
        "config-update" => include_str!("../../../contracts/v1/config-update.schema.json"),
        "config-v1" => include_str!("../../../contracts/migrations/config-v1.schema.json"),
        "config" => include_str!("../../../contracts/v1/config.schema.json"),
        "connector" => include_str!("../../../contracts/v1/connector.schema.json"),
        "connector-capability" => {
            include_str!("../../../contracts/v1/connector-capability.schema.json")
        }
        "conversation" => include_str!("../../../contracts/v1/conversation.schema.json"),
        "deletion" => include_str!("../../../contracts/v1/deletion.schema.json"),
        "draft" => include_str!("../../../contracts/v1/draft.schema.json"),
        "error-response" => include_str!("../../../contracts/v1/error-response.schema.json"),
        "error" => include_str!("../../../contracts/v1/error.schema.json"),
        "error-receipt" => include_str!("../../../contracts/v1/error-receipt.schema.json"),
        "event-envelope" => include_str!("../../../contracts/v1/event-envelope.schema.json"),
        "event" => include_str!("../../../contracts/v1/event.schema.json"),
        "evidence" => include_str!("../../../contracts/v1/evidence.schema.json"),
        "goals" => include_str!("../../../contracts/v1/goals.schema.json"),
        "ideas" => include_str!("../../../contracts/v1/ideas.schema.json"),
        "identity" => include_str!("../../../contracts/v1/identity.schema.json"),
        "library" => include_str!("../../../contracts/v1/library.schema.json"),
        "memory" => include_str!("../../../contracts/v1/memory.schema.json"),
        "memory-list" => include_str!("../../../contracts/v1/memory-list.schema.json"),
        "memory-save" => include_str!("../../../contracts/v1/memory-save.schema.json"),
        "memory-correct" => include_str!("../../../contracts/v1/memory-correct.schema.json"),
        "memory-delete" => include_str!("../../../contracts/v1/memory-delete.schema.json"),
        "message" => include_str!("../../../contracts/v1/message.schema.json"),
        "project" => include_str!("../../../contracts/v1/project.schema.json"),
        "plan-preview" => include_str!("../../../contracts/v1/plan-preview.schema.json"),
        "proactivity-policy" => {
            include_str!("../../../contracts/v1/proactivity-policy.schema.json")
        }
        "proactive-candidate" => {
            include_str!("../../../contracts/v1/proactive-candidate.schema.json")
        }
        "proactive-candidate-offer" => {
            include_str!("../../../contracts/v1/proactive-candidate-offer.schema.json")
        }
        "proactive-feed-item" => {
            include_str!("../../../contracts/v1/proactive-feed-item.schema.json")
        }
        "provider" => include_str!("../../../contracts/v1/provider.schema.json"),
        "public-config" => include_str!("../../../contracts/v1/public-config.schema.json"),
        "recoverable-item" => include_str!("../../../contracts/v1/recoverable-item.schema.json"),
        "relationship-state" => {
            include_str!("../../../contracts/v1/relationship-state.schema.json")
        }
        "relationship-summary" => {
            include_str!("../../../contracts/v1/relationship-summary.schema.json")
        }
        "request" => include_str!("../../../contracts/v1/request.schema.json"),
        "response-outcome" => include_str!("../../../contracts/v1/response-outcome.schema.json"),
        "response" => include_str!("../../../contracts/v1/response.schema.json"),
        "scheduled-task" => include_str!("../../../contracts/v1/scheduled-task.schema.json"),
        "schedule-policy" => include_str!("../../../contracts/v1/schedule-policy.schema.json"),
        "server" => include_str!("../../../contracts/v1/server.schema.json"),
        "shutdown" => include_str!("../../../contracts/v1/shutdown.schema.json"),
        "specialist" => include_str!("../../../contracts/v1/specialist.schema.json"),
        "speech-backend" => include_str!("../../../contracts/v1/speech-backend.schema.json"),
        "speech-start" => include_str!("../../../contracts/v1/speech-start.schema.json"),
        "speech-session" => include_str!("../../../contracts/v1/speech-session.schema.json"),
        "speech-command" => include_str!("../../../contracts/v1/speech-command.schema.json"),
        "speech-update" => include_str!("../../../contracts/v1/speech-update.schema.json"),
        "speech" => include_str!("../../../contracts/v1/speech.schema.json"),
        "support-plan" => include_str!("../../../contracts/v1/support-plan.schema.json"),
        "task" => include_str!("../../../contracts/v1/task.schema.json"),
        "team" => include_str!("../../../contracts/v1/team.schema.json"),
        "view" => include_str!("../../../contracts/v1/view.schema.json"),
        "worker-message" => include_str!("../../../contracts/v1/worker-message.schema.json"),
        _ => return None,
    };
    serde_json::from_str(text).ok()
}
pub fn validate(name: &str, value: &Value) -> bool {
    schema(name).is_some_and(|s| valid(&s, value))
}
fn valid(s: &Value, v: &Value) -> bool {
    if let Some(r) = s["$ref"].as_str() {
        return validate(
            r.trim_start_matches("./").trim_end_matches(".schema.json"),
            v,
        );
    }
    if let Some(c) = s.get("const") {
        if c != v {
            return false;
        }
    }
    if let Some(e) = s["enum"].as_array() {
        if !e.contains(v) {
            return false;
        }
    }
    if let Some(t) = s.get("type") {
        let types = if let Some(a) = t.as_array() {
            a.clone()
        } else {
            vec![t.clone()]
        };
        if !types.iter().any(|t| match t.as_str() {
            Some("object") => v.is_object(),
            Some("array") => v.is_array(),
            Some("string") => v.is_string(),
            Some("null") => v.is_null(),
            Some("boolean") => v.is_boolean(),
            Some("integer") => v.is_i64() || v.is_u64(),
            Some("number") => v.is_number(),
            _ => false,
        }) {
            return false;
        }
    }
    if let Some(n) = v.as_f64() {
        if s["minimum"].as_f64().is_some_and(|m| n < m)
            || s["maximum"].as_f64().is_some_and(|m| n > m)
        {
            return false;
        }
    }
    if let Some(a) = v.as_array() {
        if s["minItems"].as_u64().is_some_and(|m| (a.len() as u64) < m) {
            return false;
        }
        if s["maxItems"].as_u64().is_some_and(|m| (a.len() as u64) > m) {
            return false;
        }
        if let Some(items) = s.get("items") {
            if !a.iter().all(|v| valid(items, v)) {
                return false;
            }
        }
    }
    if let Some(obj) = v.as_object() {
        if let Some(req) = s["required"].as_array() {
            if !req
                .iter()
                .all(|k| obj.contains_key(k.as_str().unwrap_or("")))
            {
                return false;
            }
        }
        if let Some(props) = s["properties"].as_object() {
            if s["additionalProperties"] == false && obj.keys().any(|k| !props.contains_key(k)) {
                return false;
            }
            for (k, p) in props {
                if let Some(v) = obj.get(k) {
                    if !valid(p, v) {
                        return false;
                    }
                }
            }
        }
    }
    true
}

#[cfg(test)]
mod affect_tests {
    use super::validate;
    use serde_json::json;

    #[test]
    fn affect_turn_schema_is_registered_and_resolves_nested_objects() {
        let turn = json!({
            "schema_version": 1,
            "turn_id": "turn-1",
            "user_signal": {
                "stated_emotion": "tired",
                "stated_need": "listening",
                "boundary": "no advice",
                "blocked_actions": ["advice"],
                "correction": null,
                "explicit_transaction_request": false
            },
            "observations": [],
            "hypothesis": {
                "schema_version": 1,
                "session_id": "session-1",
                "hypothesis_id": "hyp-1",
                "valence": 0,
                "arousal": 0,
                "affect_candidates": [{"label": "unclear", "score": 1.0}],
                "support_need_candidates": [{"need": "listening", "score": 1.0}],
                "confidence": 0.0,
                "answer_confidence": 0.0,
                "abstention": true,
                "conflict": false,
                "sarcasm_or_ambiguity": false,
                "calibrated": false,
                "evidence_refs": [],
                "model_version": "fixture-1",
                "source": "configured_llm_fallback",
                "calibration_version": null,
                "degraded": true,
                "degradation_reason": "Laya unavailable",
                "user_correction": null,
                "language": "en",
                "input_modality": "text"
            },
            "support_plan": {
                "schema_version": 1,
                "turn_id": "turn-1",
                "primary_action": "listen",
                "secondary_option": null,
                "permission_needed": false,
                "language_constraints": ["no_diagnosis"],
                "presence_cues": {"pace": null, "pause": null, "intensity": null},
                "creates_task": false,
                "specialist_dispatched": false
            },
            "response_outcome": {
                "schema_version": 1,
                "turn_id": "turn-1",
                "action": "listen",
                "user_feedback": null,
                "next_turn_signal": null,
                "outcome": "unknown",
                "user_correction": null
            },
            "relationship_state": {
                "schema_version": 1,
                "session_id": "session-1",
                "topic": "",
                "emotion": "tired",
                "intent": "listening",
                "user_stated": true,
                "boundary": "no advice",
                "observed_at": "2026-10-15T00:00:00Z",
                "source_turn_id": "turn-1",
                "version": 2
            }
        });

        assert!(validate("affect-turn", &turn));
        let mut malformed = turn;
        malformed["support_plan"]["primary_action"] = json!("diagnosis");
        assert!(!validate("affect-turn", &malformed));
    }
}
