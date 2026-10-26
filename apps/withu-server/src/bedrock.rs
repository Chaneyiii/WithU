use aws_credential_types::Credentials;
use aws_sdk_bedrock::types::ModelModality;
use aws_sdk_bedrock::{config::Region, Client as CatalogClient};
use aws_sdk_bedrockruntime::types::{
    ContentBlock, ContentBlockDelta, ConversationRole, Message, SystemContentBlock,
};
use aws_sdk_bedrockruntime::Client as RuntimeClient;
use serde::Deserialize;
use serde_json::json;
use zeroize::Zeroizing;

use crate::replies::Snapshot;

#[derive(Deserialize)]
struct AwsCredentialInput {
    access_key_id: String,
    secret_access_key: String,
}

fn region(snapshot: &Snapshot) -> Result<String, &'static str> {
    let url = url::Url::parse(&snapshot.endpoint).map_err(|_| "endpoint_invalid")?;
    let host = url.host_str().ok_or("endpoint_invalid")?;
    let region = host
        .strip_prefix("bedrock.")
        .and_then(|value| value.strip_suffix(".amazonaws.com"))
        .ok_or("endpoint_invalid")?;
    let parts = region.split('-').collect::<Vec<_>>();
    let (country, service, number) = match parts.as_slice() {
        [country, service, number] => (*country, *service, *number),
        [country, "gov", service, number] => (*country, *service, *number),
        _ => return Err("endpoint_invalid"),
    };
    let valid = country.len() == 2
        && country.bytes().all(|b| b.is_ascii_lowercase())
        && !service.is_empty()
        && service.bytes().all(|b| b.is_ascii_lowercase())
        && !number.is_empty()
        && number.bytes().all(|b| b.is_ascii_digit());
    if url.scheme() != "https" || url.path() != "/" || !valid {
        return Err("endpoint_invalid");
    }
    Ok(region.to_owned())
}

async fn config(snapshot: &Snapshot) -> Result<aws_types::SdkConfig, &'static str> {
    let region = region(snapshot)?;
    let input: AwsCredentialInput =
        serde_json::from_slice(&snapshot.key).map_err(|_| "credential_invalid")?;
    let access_key = Zeroizing::new(input.access_key_id);
    let secret_key = Zeroizing::new(input.secret_access_key);
    if access_key.is_empty() || secret_key.is_empty() {
        return Err("credential_invalid");
    }
    let credentials = Credentials::new(
        access_key.as_str(),
        secret_key.as_str(),
        None::<String>,
        None,
        "withu",
    );
    Ok(aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new(region))
        .credentials_provider(credentials)
        .load()
        .await)
}

pub async fn models(snapshot: Snapshot) -> Result<String, &'static str> {
    let shared = config(&snapshot).await?;
    let client = CatalogClient::new(&shared);
    let output = client
        .list_foundation_models()
        .set_by_output_modality(Some(ModelModality::Text))
        .send()
        .await
        .map_err(|_| "service_unavailable")?;
    let summaries = output.model_summaries();
    if summaries.len() > 2000 {
        return Err("models_limit");
    }
    let items = summaries
        .iter()
        .filter(|model| {
            model
                .input_modalities()
                .iter()
                .any(|kind| kind == &ModelModality::Text)
        })
        .filter(|model| model.response_streaming_supported().unwrap_or(false))
        .map(|model| json!({"id":model.model_id(),"name":model.model_name()}))
        .collect::<Vec<_>>();
    Ok(
        json!({"items":items,"partial":false,"source":"provider","capabilities_verified":false})
            .to_string(),
    )
}

pub async fn reply(
    snapshot: Snapshot,
    emit: &impl Fn(&'static str, String, &'static str, Option<serde_json::Value>),
) -> Result<String, &'static str> {
    let shared = config(&snapshot).await?;
    let client = RuntimeClient::new(&shared);
    let mut messages = Vec::new();
    let mut system = Vec::new();
    for item in &snapshot.messages {
        let role = item["role"].as_str().ok_or("provider_protocol_invalid")?;
        let text = item["content"]
            .as_str()
            .ok_or("provider_protocol_invalid")?;
        if role == "system" {
            system.push(SystemContentBlock::Text(text.to_owned()));
            continue;
        }
        let role = match role {
            "user" => ConversationRole::User,
            "assistant" => ConversationRole::Assistant,
            _ => return Err("provider_protocol_invalid"),
        };
        let message = Message::builder()
            .role(role)
            .content(ContentBlock::Text(text.to_owned()))
            .build()
            .map_err(|_| "provider_protocol_invalid")?;
        messages.push(message);
    }
    if messages.is_empty() {
        return Err("provider_protocol_invalid");
    }
    let mut stream = client
        .converse_stream()
        .model_id(&snapshot.model)
        .set_messages(Some(messages))
        .set_system((!system.is_empty()).then_some(system))
        .send()
        .await
        .map_err(|_| "service_unavailable")?
        .stream;
    let mut full = String::new();
    let mut pending = String::new();
    let mut complete = false;
    while let Some(event) = stream.recv().await.map_err(|_| "stream_disconnected")? {
        match event {
            aws_sdk_bedrockruntime::types::ConverseStreamOutput::ContentBlockDelta(delta) => {
                if let Some(ContentBlockDelta::Text(text)) = delta.delta() {
                    if full.len() + text.len() > 2_000_000 {
                        return Err("response_limit");
                    }
                    full.push_str(text);
                    pending.push_str(text);
                    if pending.len() >= 48 {
                        emit("delta", std::mem::take(&mut pending), "streaming", None);
                    }
                }
            }
            aws_sdk_bedrockruntime::types::ConverseStreamOutput::MessageStop(_) => {
                complete = true;
            }
            _ => {}
        }
    }
    if !pending.is_empty() {
        emit("delta", pending, "streaming", None);
    }
    if !complete || full.is_empty() {
        return Err("stream_incomplete");
    }
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(endpoint: &str) -> Snapshot {
        Snapshot {
            protocol: "bedrock".into(),
            provider: "bedrock-test".into(),
            endpoint: endpoint.into(),
            model: "fictional.model".into(),
            reasoning_effort: None,
            key: Zeroizing::new(br#"{"access_key_id":"FAKE","secret_access_key":"FAKE"}"#.to_vec()),
            messages: vec![],
            tools: vec![],
        }
    }

    #[test]
    fn accepts_only_https_bedrock_region_hosts() {
        assert_eq!(
            region(&snapshot("https://bedrock.us-east-1.amazonaws.com")),
            Ok("us-east-1".into())
        );
        assert!(region(&snapshot("http://bedrock.us-east-1.amazonaws.com")).is_err());
        assert!(region(&snapshot("https://example.com")).is_err());
        assert!(region(&snapshot("https://bedrock.us-east-1.amazonaws.com/path")).is_err());
        assert!(region(&snapshot("https://bedrock.fake-zone-1.amazonaws.com")).is_err());
    }
}
