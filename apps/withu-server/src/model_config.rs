//! Config CAS uses immutable staged credentials: commit never replaces an old key.
use crate::credentials::Credentials;
use serde_json::{json, Value};
use std::collections::HashSet;
use withu_audit::AuditFact;
use withu_ipc::validation::validate;
use withu_storage::Store;
pub fn empty() -> Value {
    json!({"schema_version":2,"config_version":1,"providers":[],"credential_refs":[],"defaults":{"llm":null,"realtime":null},"model_overrides":{},"speech_preferences":{}})
}
// Read retired documents once, preserving provider IDs and OS credential references.
// An ASR/TTS configuration is never promoted to a verified duplex service.
pub fn migrate(mut c: Value) -> Result<Value, &'static str> {
    if c["schema_version"] == 1 {
        if !validate("config-v1", &c) {
            return Err("configuration_corrupt");
        }
        for provider in c["providers"].as_array_mut().unwrap() {
            provider["service"] = "llm".into();
            provider["capabilities"] = json!([]);
        }
        c["schema_version"] = 2.into();
        c["defaults"] = json!({"llm":c["defaults"]["llm"],"realtime":null});
        let llm = c["model_overrides"]["llm"].clone();
        c["model_overrides"] = if llm.is_object() {
            json!({"llm":llm})
        } else {
            json!({})
        };
        c["speech_preferences"] = json!({});
    }
    if !validate("config", &c) {
        return Err("configuration_corrupt");
    }
    Ok(c)
}
pub fn load(store: &Store) -> Result<Value, &'static str> {
    let c = store
        .get("config", "user")
        .map_err(|e| e.0)?
        .unwrap_or_else(empty);
    migrate(c)
}
pub fn refs(c: &Value) -> Vec<String> {
    c["credential_refs"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}
pub fn public(c: &Value, credentials: &Credentials, cleanup_ok: bool) -> Value {
    let mut public = c.clone();
    public.as_object_mut().unwrap().remove("credential_refs");
    let mut states = serde_json::Map::new();
    for p in public["providers"].as_array_mut().unwrap() {
        let state = match p["credential_ref"].as_str() {
            None => "missing",
            Some(r) => match credentials.read(r) {
                Ok(_) => "present",
                Err("credential_missing") => "missing",
                Err(_) => "storage_error",
            },
        };
        states.insert(p["provider_id"].as_str().unwrap().to_string(), state.into());
        p.as_object_mut().unwrap().remove("credential_ref");
        p.as_object_mut().unwrap().remove("schema_version");
    }
    json!({"config":public,"source":if c["providers"].as_array().unwrap().is_empty(){"unconfigured"}else{"user"},"credential_states":states,"credential_storage":"windows_credential_manager","credential_cleanup":if cleanup_ok{"complete"}else{"pending"},"capabilities":"unverified"})
}
pub fn validate_public(c: &Value) -> Result<(), &'static str> {
    if !validate("public-config", c) {
        return Err("configuration_schema");
    }
    let mut ids = HashSet::new();
    for p in c["providers"].as_array().unwrap() {
        let id = p["provider_id"].as_str().unwrap();
        if id.is_empty()
            || id.len() > 80
            || !id
                .chars()
                .all(|v| v.is_ascii_alphanumeric() || v == '-' || v == '_')
            || !ids.insert(id)
        {
            return Err("provider_id_invalid");
        }
        let endpoint = p["endpoint"].as_str().unwrap();
        let url = url::Url::parse(endpoint).map_err(|_| "endpoint_invalid")?;
        if endpoint.len() > 2048
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.host_str().is_none()
            || (url.scheme() != "https"
                && !(p["service"] == "realtime" && url.scheme() == "wss")
                && !(["http", "ws"].contains(&url.scheme())
                    && ["127.0.0.1", "localhost", "[::1]"].contains(&url.host_str().unwrap_or(""))))
        {
            return Err("endpoint_invalid");
        }
        if ![
            "openai-compatible",
            "openai",
            "anthropic",
            "xai",
            "openai-responses",
            "azure",
            "bedrock",
            "volc-realtime",
            "qwen-realtime",
            "openai-realtime",
            "gemini-live",
            "custom-realtime",
        ]
        .contains(&p["protocol"].as_str().unwrap())
        {
            return Err("protocol_unsupported");
        }
        let realtime = p["protocol"].as_str().unwrap().ends_with("-realtime")
            || p["protocol"] == "gemini-live";
        if realtime != (p["service"] == "realtime") {
            return Err("provider_service_mismatch");
        }
        // Configured capability lists must not be used as health/verification evidence.
    }
    for k in ["llm", "realtime"] {
        if let Some(id) = c["defaults"][k].as_str() {
            if !ids.contains(id) {
                return Err("provider_reference_invalid");
            }
            if !c["providers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["provider_id"] == id && p["service"] == k)
            {
                return Err("provider_service_mismatch");
            }
        }
        if let Some(selection) = c["model_overrides"].get(k) {
            if let Some(id) = selection["provider_ref"].as_str() {
                if !ids.contains(id) {
                    return Err("provider_reference_invalid");
                }
                if !c["providers"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p["provider_id"] == id && p["service"] == k)
                {
                    return Err("provider_service_mismatch");
                }
            }
            if let Some(model) = selection["model_ref"].as_str() {
                if model.len() > 256 || model.contains(['\n', '\r', '\0']) {
                    return Err("model_id_invalid");
                }
            }
            if let Some(effort) = selection["reasoning_effort"].as_str() {
                if effort.len() > 24 || !effort.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
                {
                    return Err("reasoning_effort_invalid");
                }
            }
        }
    }
    Ok(())
}
pub fn resolve_endpoints(config: &mut Value) {
    for p in config["providers"].as_array_mut().into_iter().flatten() {
        if p["endpoint"] == "" {
            match p["protocol"].as_str() {
                Some("openai" | "openai-responses") => {
                    p["endpoint"] = "https://api.openai.com/v1".into()
                }
                Some("anthropic") => p["endpoint"] = "https://api.anthropic.com/v1".into(),
                Some("xai") => p["endpoint"] = "https://api.x.ai/v1".into(),
                _ => {}
            }
        }
    }
}
pub fn update(
    store: &mut Store,
    credentials: &Credentials,
    p: &Value,
    fact: &AuditFact,
) -> Result<Value, &'static str> {
    if !validate("config-update", p) {
        return Err("configuration_update_schema");
    }
    let mut resolved = p["config"].clone();
    resolve_endpoints(&mut resolved);
    validate_public(&resolved)?;
    let old = load(store)?;
    let expected = p["expected_version"].as_u64().unwrap();
    if old["config_version"].as_u64() != Some(expected)
        || p["config"]["config_version"].as_u64() != Some(expected + 1)
    {
        return Err("version_conflict");
    }
    let mut next = resolved;
    let mut changes = std::collections::HashMap::new();
    for change in p["credential_changes"].as_array().unwrap() {
        let id = change["provider_id"].as_str().unwrap();
        if changes.insert(id, change).is_some()
            || !next["providers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["provider_id"] == id)
        {
            return Err("credential_change_invalid");
        }
        let action = change["action"].as_str().unwrap();
        let key = change["value"].as_str();
        if action == "replace"
            && (key.is_none()
                || key.unwrap().is_empty()
                || key.unwrap().len() > 2560
                || key.unwrap().contains('\0'))
            || action == "clear" && !change["value"].is_null()
        {
            return Err("credential_value_invalid");
        }
    }
    for provider in next["providers"].as_array().unwrap() {
        if old["providers"].as_array().unwrap().iter().any(|p| {
            p["provider_id"] == provider["provider_id"] && p["service"] != provider["service"]
        }) {
            return Err("provider_service_immutable");
        }
    }
    let mut staged = vec![];
    let result = (|| {
        for provider in next["providers"].as_array_mut().unwrap() {
            let id = provider["provider_id"].as_str().unwrap();
            let previous = old["providers"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["provider_id"] == id)
                .and_then(|p| p["credential_ref"].as_str());
            let reference = if let Some(change) = changes.get(id) {
                if change["action"] == "replace" {
                    let r = credentials.fresh_ref();
                    credentials.write(&r, change["value"].as_str().unwrap())?;
                    staged.push(r.clone());
                    Some(r)
                } else {
                    None
                }
            } else {
                previous.map(str::to_string)
            };
            provider["credential_ref"] = reference.map(Value::String).unwrap_or(Value::Null);
            provider["schema_version"] = 1.into();
        }
        next["credential_refs"] = next["providers"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p["credential_ref"].as_str().map(Value::from))
            .collect::<Vec<_>>()
            .into();
        if !validate("config", &next) {
            return Err("configuration_schema");
        }
        let exists = store.get("config", "user").map_err(|e| e.0)?.is_some();
        store
            .put(
                "config",
                "user",
                if exists { expected - 1 } else { 0 },
                &next,
                fact,
            )
            .map_err(|e| e.0)?;
        Ok(())
    })();
    if let Err(code) = result {
        for reference in staged {
            if credentials.delete(&reference).is_err() {
                return Err("credential_rollback_cleanup_failed");
            }
        }
        return Err(code);
    }
    let cleanup_ok = credentials.collect(&refs(&next)).is_ok();
    Ok(public(&next, credentials, cleanup_ok))
}

// Internal scope binds a proof to credential revision (not credential value), endpoint,
// protocol, task selection, backend and voice. Unrelated config saves retain proofs.
pub fn proof_scope(config: &Value, kind: &str) -> Value {
    let selection = &config["model_overrides"][kind];
    let provider = config["providers"].as_array().and_then(|ps| {
        ps.iter()
            .find(|p| p["provider_id"] == selection["provider_ref"])
    });
    json!({"selection":selection,"provider":provider.map(|p| json!({"id":p["provider_id"],"endpoint":p["endpoint"],"protocol":p["protocol"],"credential_revision":p["credential_ref"]})),"preferences":config["speech_preferences"][kind]})
}
pub fn proofs(store: &Store, config: &Value) -> Value {
    let mut output = serde_json::Map::new();
    for kind in ["llm", "realtime"] {
        if let Ok(Some(saved)) = store.get("model-verification", kind) {
            if saved["scope"] == proof_scope(config, kind) {
                output.insert(kind.into(), saved["proof"].clone());
            }
        }
    }
    Value::Object(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_config_keeps_llm_and_credentials_without_promoting_voice() {
        let old = json!({"schema_version":1,"config_version":8,"providers":[{"schema_version":1,"provider_id":"shared","endpoint":"https://example.test/v1","protocol":"openai-compatible","capabilities":["llm","asr","tts"],"credential_ref":"synthetic-ref"}],"credential_refs":["synthetic-ref"],"defaults":{"llm":"shared","asr":"shared","tts":"shared"},"model_overrides":{"llm":{"provider_ref":"shared","model_ref":"user-chat"},"asr":{"provider_ref":"shared","model_ref":"old-asr"},"tts":{"provider_ref":"shared","model_ref":"old-tts"}},"speech_preferences":{"asr":{"backend_id":"local"},"tts":{"backend_id":"local","voice_id":"old-voice"}}});
        let next = migrate(old).unwrap();
        assert_eq!(next["schema_version"], 2);
        assert_eq!(next["config_version"], 8);
        assert_eq!(next["credential_refs"], json!(["synthetic-ref"]));
        assert_eq!(next["providers"][0]["credential_ref"], "synthetic-ref");
        assert_eq!(next["providers"][0]["service"], "llm");
        assert_eq!(next["model_overrides"]["llm"]["model_ref"], "user-chat");
        assert!(next["defaults"]["realtime"].is_null());
        assert_eq!(next["model_overrides"].as_object().unwrap().len(), 1);
        assert_eq!(migrate(next.clone()).unwrap(), next);
    }
    #[test]
    fn malformed_legacy_config_is_not_repaired_silently() {
        assert_eq!(
            migrate(json!({"schema_version":1})).unwrap_err(),
            "configuration_corrupt"
        );
    }
    #[test]
    fn defaults_and_protocol_cannot_cross_service_boundary() {
        let mut c = empty();
        c.as_object_mut().unwrap().remove("credential_refs");
        c["providers"] = json!([{"provider_id":"voice","service":"realtime","endpoint":"wss://example.test/dialogue","protocol":"custom-realtime","capabilities":[]}]);
        assert!(validate_public(&c).is_ok());
        c["defaults"]["llm"] = "voice".into();
        assert_eq!(validate_public(&c), Err("provider_service_mismatch"));
        c["defaults"]["llm"] = Value::Null;
        c["providers"][0]["protocol"] = "openai-compatible".into();
        assert_eq!(validate_public(&c), Err("provider_service_mismatch"));
    }
}
