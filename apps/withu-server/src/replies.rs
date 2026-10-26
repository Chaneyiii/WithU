//! Cancelable, bounded Chat Completions adapter. Tools are PROPOSAL-ONLY: a
//! streamed tool call is normalized to a candidate and handed to the server's
//! rule layer; this module never executes anything (spec B.8).
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::thread::JoinHandle;
use tokio::sync::oneshot;
use zeroize::Zeroizing;
pub struct Snapshot {
    pub provider: String,
    pub protocol: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub key: Zeroizing<Vec<u8>>,
    pub messages: Vec<Value>,
    /// OpenAI-format tool definitions; empty means no tools are offered and
    /// any streamed tool call fails closed.
    pub tools: Vec<Value>,
}
/// Terminal output of a reply run: plain text, or a single proposed tool call
/// (name + raw JSON arguments + any text streamed before the proposal)
/// awaiting server-side validation.
pub enum Output {
    Text(String),
    ToolCall {
        name: String,
        arguments: String,
        text: String,
    },
}
pub enum Task {
    Text,
    Title,
    Models,
    Audio { kind: String, voice: String },
}
pub struct Update {
    pub id: String,
    pub conversation: String,
    pub config: u64,
    pub state: &'static str,
    pub text: String,
    pub code: &'static str,
    pub elapsed_ms: u64,
    pub first_token_ms: Option<u64>,
    /// Present only on a complete state whose model output was one tool-call
    /// proposal: {"name": ..., "arguments": <parsed JSON>}.
    pub tool: Option<Value>,
}
struct Job {
    lane: &'static str,
    provider: String,
    conversation: String,
    config: u64,
    cancel: Option<oneshot::Sender<()>>,
    thread: JoinHandle<()>,
}
fn auth_header(protocol: &str) -> &'static str {
    match protocol {
        "anthropic" => "x-api-key",
        "azure" => "api-key",
        _ => "authorization",
    }
}
pub struct Replies {
    jobs: BTreeMap<String, Job>,
    tx: SyncSender<Update>,
    rx: Receiver<Update>,
    terminal_tx: Sender<Update>,
    terminal_rx: Receiver<Update>,
}
impl Default for Replies {
    fn default() -> Self {
        let (tx, rx) = mpsc::sync_channel(256);
        // At most one terminal per worker, with at most four workers.
        let (terminal_tx, terminal_rx) = mpsc::channel();
        Self {
            jobs: BTreeMap::new(),
            tx,
            rx,
            terminal_tx,
            terminal_rx,
        }
    }
}
impl Replies {
    pub fn start(
        &mut self,
        id: String,
        conversation: String,
        config: u64,
        snapshot: Snapshot,
    ) -> Result<(), &'static str> {
        self.start_task(id, conversation, config, snapshot, Task::Text)
    }
    pub fn start_task(
        &mut self,
        id: String,
        conversation: String,
        config: u64,
        snapshot: Snapshot,
        task: Task,
    ) -> Result<(), &'static str> {
        let lane = match &task {
            Task::Text => "text",
            _ => "probe",
        };
        if self
            .jobs
            .values()
            .any(|j| j.conversation == conversation && j.lane == lane)
        {
            return Err("reply_already_running");
        }
        if self.jobs.len() >= 4 {
            return Err("reply_capacity");
        }
        let provider = snapshot.provider.clone();
        let (cancel, signal) = oneshot::channel();
        let tx = self.tx.clone();
        let terminal_tx = self.terminal_tx.clone();
        let rid = id.clone();
        let cid = conversation.clone();
        let thread = std::thread::spawn(move || {
            let overflow = std::cell::Cell::new(false);
            let began = std::time::Instant::now();
            let first_token = std::cell::Cell::new(None);
            let emit =
                |state: &'static str, text: String, code: &'static str, tool: Option<Value>| {
                    let elapsed_ms = began.elapsed().as_millis().min(u64::MAX as u128) as u64;
                    if state == "delta" && !text.is_empty() && first_token.get().is_none() {
                        first_token.set(Some(elapsed_ms));
                    }
                    let mut update = Update {
                        id: rid.clone(),
                        conversation: cid.clone(),
                        config,
                        state,
                        text,
                        code,
                        elapsed_ms,
                        first_token_ms: first_token.get(),
                        tool,
                    };
                    if state == "delta" {
                        if tx.try_send(update).is_err() {
                            overflow.set(true);
                        }
                    } else {
                        if overflow.get() && state == "complete" {
                            update = Update {
                                state: "failed",
                                text: String::new(),
                                code: "output_backpressure",
                                tool: None,
                                ..update
                            };
                        }
                        let _ = terminal_tx.send(update);
                    }
                };
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(_) => {
                    emit("failed", String::new(), "runtime_failed", None);
                    return;
                }
            };
            runtime.block_on(async{tokio::select!{_=signal=>{emit("cancelled",String::new(),"cancelled",None);},result=tokio::time::timeout(std::time::Duration::from_secs(60),async { match task {Task::Text=>run(snapshot,&emit).await,Task::Title=>run(snapshot,&|_,_,_,_|{}).await,Task::Models=>crate::provider_tools::models(snapshot).await.map(Output::Text),Task::Audio{kind,voice}=>crate::provider_tools::audio_probe(snapshot,&kind,&voice).await.map(Output::Text)} })=>{match result{Ok(Ok(output))=>match output{Output::Text(text)=>emit("complete",text,"complete",None),Output::ToolCall{name,arguments,text}=>emit("complete",text,"complete",Some(json!({"name":name,"arguments":arguments})))},Ok(Err(code))=>emit("failed",String::new(),code,None),Err(_)=>emit("failed",String::new(),"request_timeout",None)}}}});
        });
        self.jobs.insert(
            id,
            Job {
                lane,
                provider,
                conversation,
                config,
                cancel: Some(cancel),
                thread,
            },
        );
        Ok(())
    }
    pub fn cancel(&mut self, id: &str) -> Result<(), &'static str> {
        let job = self.jobs.get_mut(id).ok_or("reply_missing")?;
        if let Some(cancel) = job.cancel.take() {
            let _ = cancel.send(());
        }
        Ok(())
    }
    pub fn cancel_conversation(&mut self, cid: &str) {
        for job in self.jobs.values_mut().filter(|j| j.conversation == cid) {
            if let Some(c) = job.cancel.take() {
                let _ = c.send(());
            }
        }
    }
    pub fn cancel_provider(&mut self, provider: &str) {
        for job in self.jobs.values_mut().filter(|j| j.provider == provider) {
            if let Some(c) = job.cancel.take() {
                let _ = c.send(());
            }
        }
    }
    pub fn cancel_all(&mut self) {
        for job in self.jobs.values_mut() {
            if let Some(c) = job.cancel.take() {
                let _ = c.send(());
            }
        }
    }
    pub fn pending(&self, id: &str) -> Option<(String, u64, bool)> {
        self.jobs
            .get(id)
            .map(|j| (j.conversation.clone(), j.config, j.cancel.is_some()))
    }
    pub fn poll(&mut self) -> Vec<Update> {
        // Identify finished workers BEFORE draining, so their final send cannot
        // race removal between the empty-queue check and is_finished().
        let done = self
            .jobs
            .iter()
            .filter(|(_, j)| j.thread.is_finished())
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let mut updates = vec![];
        while let Ok(u) = self.rx.try_recv() {
            if let Some(job) = self.jobs.get(&u.id) {
                if job.cancel.is_some() || u.state == "cancelled" {
                    updates.push(u);
                }
            }
        }
        while let Ok(u) = self.terminal_rx.try_recv() {
            if let Some(job) = self.jobs.get(&u.id) {
                if job.cancel.is_some() || u.state == "cancelled" {
                    updates.push(u);
                }
            }
        }
        for id in done {
            if let Some(job) = self.jobs.remove(&id) {
                let _ = job.thread.join();
            }
        }
        updates
    }
    pub fn shutdown(&mut self) -> bool {
        self.cancel_all();
        let until = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while self.jobs.values().any(|j| !j.thread.is_finished())
            && std::time::Instant::now() < until
        {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let complete = self.jobs.values().all(|j| j.thread.is_finished());
        self.poll();
        complete
    }
}
async fn run(
    snapshot: Snapshot,
    emit: &impl Fn(&'static str, String, &'static str, Option<Value>),
) -> Result<Output, &'static str> {
    if snapshot.protocol == "bedrock" {
        // Bedrock path keeps the pre-T09 no-tools contract.
        return match crate::bedrock::reply(snapshot, emit).await {
            Ok(text) => Ok(Output::Text(text)),
            Err(code) => Err(code),
        };
    }
    if !snapshot.tools.is_empty()
        && matches!(
            snapshot.protocol.as_str(),
            "openai" | "xai" | "openai-compatible" | "azure" | "openai-responses" | "anthropic"
        )
    {
        // Tools are offered; tool-call events are parsed below.
    } else if !snapshot.tools.is_empty() {
        return Err("tools_not_supported");
    }
    let tools_offered = !snapshot.tools.is_empty();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| "http_client_failed")?;
    let key = std::str::from_utf8(&snapshot.key).map_err(|_| "credential_invalid")?;
    if key.is_empty() {
        return Err("credential_missing");
    }
    let raw_auth = Zeroizing::new(
        if matches!(snapshot.protocol.as_str(), "anthropic" | "azure") {
            key.to_string()
        } else {
            format!("Bearer {key}")
        },
    );
    let mut auth =
        reqwest::header::HeaderValue::from_str(&raw_auth).map_err(|_| "credential_invalid")?;
    auth.set_sensitive(true);
    let (route, body) = request_body(&snapshot)?;
    // Retry only explicit pre-stream rejection. Never replay a disconnected or
    // partially delivered request: its billable outcome may be ambiguous.
    // The outer timeout/cancellation covers HTTP attempts AND backoff sleeps.
    let mut attempt = 0;
    let response = loop {
        let mut request = client
            .post(format!(
                "{}/{route}",
                snapshot.endpoint.trim_end_matches('/')
            ))
            .header(auth_header(&snapshot.protocol), auth.clone())
            .json(&body);
        if snapshot.protocol == "anthropic" {
            request = request.header("anthropic-version", "2023-06-01");
        }
        let response = request.send().await.map_err(|_| "service_unavailable")?;
        if !matches!(response.status().as_u16(), 429 | 503) || attempt >= 2 {
            break response;
        }
        let Some(delay) = retry_delay(
            response.headers().get(reqwest::header::RETRY_AFTER),
            attempt,
            std::time::SystemTime::now(),
        ) else {
            break response;
        };
        // Drop the rejected body before waiting; never expose provider error text.
        drop(response);
        tokio::time::sleep(delay).await;
        attempt += 1;
    };
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err("auth_failed"),
        404 | 422 => return Err("model_unsupported"),
        429 => return Err("rate_limited"),
        _ => return Err("service_unavailable"),
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .starts_with("text/event-stream")
    {
        return Err("stream_protocol_unsupported");
    }
    let mut stream = response.bytes_stream();
    let mut buffer = vec![];
    let mut full = String::new();
    let mut pending = String::new();
    let mut finish = None;
    // Single-proposal accumulator; more than one streamed tool call is refused.
    let mut tool = ToolAccum::default();
    let mut done = false;
    let mut total = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "stream_disconnected")?;
        total += chunk.len();
        if total > 2_000_000 {
            return Err("response_limit");
        }
        buffer.extend_from_slice(&chunk);
        while let Some(end) = buffer.iter().position(|v| *v == b'\n') {
            let line = buffer.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "stream_encoding")?
                .trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]"
                && !matches!(snapshot.protocol.as_str(), "anthropic" | "openai-responses")
            {
                done = true;
                break;
            }
            let event: Value = serde_json::from_str(data).map_err(|_| "stream_protocol_invalid")?;
            if event.get("error").is_some() {
                return Err("provider_error");
            }
            if matches!(snapshot.protocol.as_str(), "anthropic" | "openai-responses") {
                let (text, terminal) = native_event(
                    &snapshot.protocol,
                    &event,
                    &mut finish,
                    &mut tool,
                    tools_offered,
                )?;
                if let Some(text) = text {
                    append_text(text, key, &mut full, &mut pending, emit)?;
                }
                if terminal {
                    done = true;
                    break;
                }
                continue;
            }
            if let Some(choice) = event["choices"].as_array().and_then(|c| c.first()) {
                if !tools_offered
                    && choice["delta"]["tool_calls"]
                        .as_array()
                        .is_some_and(|a| !a.is_empty())
                {
                    return Err("tools_not_supported");
                }
                if tools_offered {
                    if let Some(calls) = choice["delta"]["tool_calls"].as_array() {
                        for call in calls {
                            tool.push_chat_completion(call)?;
                        }
                    }
                }
                if choice["delta"]["refusal"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
                {
                    return Err("provider_refusal");
                }
                if let Some(text) = choice["delta"]["content"].as_str() {
                    if !text.is_empty() {
                        append_text(text, key, &mut full, &mut pending, emit)?;
                    }
                }
                if let Some(reason) = choice["finish_reason"].as_str() {
                    finish = Some(reason.to_string());
                }
            }
        }
        if done {
            break;
        }
        if buffer.len() > 64000 {
            return Err("stream_frame_limit");
        }
    }
    // A Chat Completions finish_reason is an authoritative terminal; some compatible services omit [DONE].
    if !done
        && !(matches!(
            snapshot.protocol.as_str(),
            "openai" | "xai" | "openai-compatible" | "azure"
        ) && finish.is_some()
            && buffer.iter().all(u8::is_ascii_whitespace))
    {
        return Err("stream_incomplete");
    }
    let text_out = || -> Result<String, &'static str> {
        if !pending.is_empty() {
            emit("delta", pending.clone(), "partial", None);
        }
        Ok(full.clone())
    };
    match finish.as_deref() {
        Some("stop") => {
            if full.trim().is_empty() {
                return Err("stream_incomplete");
            }
            Ok(Output::Text(text_out()?))
        }
        Some("tool_calls") if tools_offered => {
            let call = tool.finish(key)?;
            if call.0.is_empty() && full.trim().is_empty() {
                return Err("stream_incomplete");
            }
            let text = text_out()?;
            Ok(Output::ToolCall {
                name: call.0,
                arguments: call.1,
                text,
            })
        }
        Some("content_filter") => Err("provider_refusal"),
        Some("length") => Err("output_truncated"),
        _ => Err("stream_incomplete"),
    }
}

/// Accumulates one streamed tool-call proposal across delta fragments.
#[derive(Default)]
struct ToolAccum {
    name: String,
    id: String,
    arguments: String,
    seen: bool,
}

impl ToolAccum {
    fn reset(&mut self) {
        *self = ToolAccum::default();
    }
    fn push_chat_completion(&mut self, call: &Value) -> Result<(), &'static str> {
        // Only index 0 is accepted: Withu takes exactly one proposal per turn.
        if call["index"].as_u64().unwrap_or(0) != 0 {
            return Err("tool_call_invalid");
        }
        if self.seen {
            // Continuation deltas only extend arguments; a second start is a
            // second proposal and is refused.
        }
        self.seen = true;
        if let Some(id) = call["id"].as_str() {
            if !id.is_empty() {
                if !self.id.is_empty() && self.id != id {
                    return Err("tool_call_invalid");
                }
                self.id = id.to_owned();
            }
        }
        if let Some(name) = call["function"]["name"].as_str() {
            if !name.is_empty() {
                if !self.name.is_empty() && self.name != name {
                    return Err("tool_call_invalid");
                }
                self.name = name.to_owned();
            }
        }
        if let Some(fragment) = call["function"]["arguments"].as_str() {
            self.arguments.push_str(fragment);
            if self.arguments.len() > 64000 {
                return Err("tool_call_invalid");
            }
        }
        Ok(())
    }
    fn push_anthropic(&mut self, block: &Value) -> Result<(), &'static str> {
        if !self.name.is_empty() || !self.id.is_empty() {
            return Err("tool_call_invalid");
        }
        self.seen = true;
        self.id = block["id"].as_str().unwrap_or_default().to_owned();
        self.name = block["name"].as_str().unwrap_or_default().to_owned();
        if self.name.is_empty() {
            return Err("tool_call_invalid");
        }
        Ok(())
    }
    fn push_anthropic_delta(&mut self, fragment: &str) -> Result<(), &'static str> {
        self.seen = true;
        self.arguments.push_str(fragment);
        if self.arguments.len() > 64000 {
            return Err("tool_call_invalid");
        }
        Ok(())
    }
    fn push_responses_item(&mut self, item: &Value) -> Result<(), &'static str> {
        if self.seen {
            return Err("tool_call_invalid");
        }
        self.seen = true;
        self.id = item["id"].as_str().unwrap_or_default().to_owned();
        self.name = item["name"].as_str().unwrap_or_default().to_owned();
        if let Some(args) = item["arguments"].as_str() {
            self.arguments.push_str(args);
        }
        if self.name.is_empty() {
            return Err("tool_call_invalid");
        }
        Ok(())
    }
    fn finish(&self, key: &str) -> Result<(String, String), &'static str> {
        if !self.seen || self.name.is_empty() || self.arguments.trim().is_empty() {
            return Err("tool_call_invalid");
        }
        if self.arguments.contains(key) || self.name.contains(key) {
            return Err("sensitive_provider_output");
        }
        serde_json::from_str::<Value>(&self.arguments)
            .map_err(|_| "tool_call_invalid")?
            .as_object()
            .ok_or("tool_call_invalid")?;
        Ok((self.name.clone(), self.arguments.clone()))
    }
}

fn request_body(snapshot: &Snapshot) -> Result<(&'static str, Value), &'static str> {
    match snapshot.protocol.as_str() {
        "openai" | "xai" | "openai-compatible" | "azure" => {
            let mut body =
                json!({"model":snapshot.model,"messages":snapshot.messages,"stream":true});
            if let Some(effort) = &snapshot.reasoning_effort {
                body["reasoning_effort"] = effort.clone().into();
            }
            if !snapshot.tools.is_empty() {
                body["tools"] = Value::Array(snapshot.tools.clone());
            }
            Ok(("chat/completions", body))
        }
        "openai-responses" => {
            let mut body = json!({"model":snapshot.model,"input":snapshot.messages,"stream":true,"store":false});
            if let Some(effort) = &snapshot.reasoning_effort {
                body["reasoning"] = json!({"effort":effort});
            }
            if !snapshot.tools.is_empty() {
                // Responses tools are flat {type,name,description,parameters}.
                let tools = snapshot
                    .tools
                    .iter()
                    .map(|tool| {
                        json!({
                            "type":"function",
                            "name":tool["function"]["name"],
                            "description":tool["function"]["description"],
                            "parameters":tool["function"]["parameters"]
                        })
                    })
                    .collect::<Vec<_>>();
                body["tools"] = Value::Array(tools);
            }
            Ok(("responses", body))
        }
        "anthropic" => {
            let system = snapshot
                .messages
                .iter()
                .filter(|m| m["role"] == "system")
                .filter_map(|m| m["content"].as_str())
                .collect::<Vec<_>>()
                .join("\n");
            let messages = snapshot
                .messages
                .iter()
                .filter(|m| m["role"] != "system")
                .cloned()
                .collect::<Vec<_>>();
            // Required output cap; engineering bound, not a model capability claim.
            let mut body = json!({"model":snapshot.model,"system":system,"messages":messages,"max_tokens":4096,"stream":true});
            if let Some(effort) = &snapshot.reasoning_effort {
                body["output_config"] = json!({"effort":effort});
            }
            if !snapshot.tools.is_empty() {
                let tools = snapshot
                    .tools
                    .iter()
                    .map(|tool| {
                        json!({
                            "name":tool["function"]["name"],
                            "description":tool["function"]["description"],
                            "input_schema":tool["function"]["parameters"]
                        })
                    })
                    .collect::<Vec<_>>();
                body["tools"] = Value::Array(tools);
            }
            Ok(("messages", body))
        }
        _ => Err("protocol_unsupported"),
    }
}
fn native_event<'a>(
    protocol: &str,
    event: &'a Value,
    finish: &mut Option<String>,
    tool: &mut ToolAccum,
    tools_offered: bool,
) -> Result<(Option<&'a str>, bool), &'static str> {
    let kind = event["type"].as_str().ok_or("stream_protocol_invalid")?;
    if protocol == "anthropic" {
        match kind {
            "error" => Err("provider_error"),
            "content_block_start" => match event["content_block"]["type"].as_str() {
                Some("tool_use") => {
                    if !tools_offered {
                        return Err("tools_not_supported");
                    }
                    tool.push_anthropic(&event["content_block"])?;
                    Ok((None, false))
                }
                Some("server_tool_use" | "fallback") => Err("tools_not_supported"),
                _ => Ok((None, false)),
            },
            "content_block_delta" => match event["delta"]["type"].as_str() {
                Some("text_delta") => Ok((
                    Some(
                        event["delta"]["text"]
                            .as_str()
                            .ok_or("stream_protocol_invalid")?,
                    ),
                    false,
                )),
                Some("input_json_delta") => {
                    if !tools_offered {
                        return Err("tools_not_supported");
                    }
                    tool.push_anthropic_delta(
                        event["delta"]["partial_json"]
                            .as_str()
                            .ok_or("stream_protocol_invalid")?,
                    )?;
                    Ok((None, false))
                }
                _ => Ok((None, false)),
            },
            "message_delta" => {
                if let Some(reason) = event["delta"]["stop_reason"].as_str() {
                    *finish = Some(
                        match reason {
                            "end_turn" | "stop_sequence" => "stop",
                            "max_tokens" => "length",
                            "refusal" => "content_filter",
                            "tool_use" if tools_offered => "tool_calls",
                            "tool_use" => return Err("tools_not_supported"),
                            _ => return Err("stream_incomplete"),
                        }
                        .into(),
                    );
                }
                Ok((None, false))
            }
            "message_stop" => Ok((None, true)),
            _ => Ok((None, false)),
        }
    } else {
        match kind {
            "response.output_text.delta" => Ok((
                Some(event["delta"].as_str().ok_or("stream_protocol_invalid")?),
                false,
            )),
            "response.refusal.delta" | "response.refusal.done" => Err("provider_refusal"),
            "response.function_call_arguments.delta" => {
                if !tools_offered {
                    return Err("tools_not_supported");
                }
                tool.push_anthropic_delta(
                    event["delta"].as_str().ok_or("stream_protocol_invalid")?,
                )?;
                Ok((None, false))
            }
            "response.output_item.added" | "response.output_item.done" => {
                let item_type = event["item"]["type"].as_str().unwrap_or("");
                if !matches!(item_type, "message" | "reasoning") {
                    if item_type == "function_call" && tools_offered {
                        // Only the added event starts accumulation; done is
                        // covered by response.completed's authoritative list.
                        if kind == "response.output_item.added" {
                            tool.push_responses_item(&event["item"])?;
                        }
                        return Ok((None, false));
                    }
                    return Err("tools_not_supported");
                }
                Ok((None, false))
            }
            "response.failed" | "error" => Err("provider_error"),
            "response.incomplete" => Err(
                if event["response"]["incomplete_details"]["reason"] == "max_output_tokens" {
                    "output_truncated"
                } else {
                    "stream_incomplete"
                },
            ),
            "response.completed" => {
                if event["response"]["status"] != "completed" {
                    return Err("stream_incomplete");
                }
                let output = event["response"]["output"].as_array();
                if let Some(items) = output {
                    let calls: Vec<&Value> = items
                        .iter()
                        .filter(|item| item["type"] == "function_call")
                        .collect();
                    if calls.len() > 1 {
                        return Err("tool_call_invalid");
                    }
                    if let Some(item) = calls.first() {
                        if !tools_offered {
                            return Err("tools_not_supported");
                        }
                        // The completed response carries authoritative
                        // arguments; replace streamed fragments with it.
                        tool.reset();
                        tool.push_responses_item(item)?;
                    }
                    for item in items {
                        if !matches!(
                            item["type"].as_str(),
                            Some("message" | "reasoning" | "function_call")
                        ) {
                            return Err("tools_not_supported");
                        }
                        if item["content"]
                            .as_array()
                            .is_some_and(|a| a.iter().any(|c| c["type"] == "refusal"))
                        {
                            return Err("provider_refusal");
                        }
                    }
                }
                if tool.seen {
                    *finish = Some("tool_calls".into());
                } else {
                    *finish = Some("stop".into());
                }
                Ok((None, true))
            }
            _ => Ok((None, false)),
        }
    }
}
fn append_text(
    text: &str,
    key: &str,
    full: &mut String,
    pending: &mut String,
    emit: &impl Fn(&'static str, String, &'static str, Option<Value>),
) -> Result<(), &'static str> {
    full.push_str(text);
    if full.len() > 256000 {
        return Err("response_limit");
    }
    if full.contains(key) {
        return Err("sensitive_provider_output");
    }
    pending.push_str(text);
    let held = (1..key.len())
        .filter(|n| key.is_char_boundary(*n) && pending.ends_with(&key[..*n]))
        .max()
        .unwrap_or(0);
    let safe = pending.len() - held;
    if safe > 0 {
        emit("delta", pending[..safe].to_string(), "partial", None);
        pending.drain(..safe);
    }
    Ok(())
}

fn retry_delay(
    header: Option<&reqwest::header::HeaderValue>,
    attempt: u32,
    now: std::time::SystemTime,
) -> Option<std::time::Duration> {
    let floor = std::time::Duration::from_secs(1 << attempt.min(1));
    let requested = match header {
        None => floor,
        Some(value) => {
            let value = value.to_str().ok()?.trim();
            if let Ok(seconds) = value.parse::<u64>() {
                std::time::Duration::from_secs(seconds)
            } else {
                httpdate::parse_http_date(value)
                    .ok()?
                    .duration_since(now)
                    .unwrap_or_default()
            }
        }
    };
    // Do not shorten Retry-After. Long/invalid waits fail explicitly rather
    // than violating the provider's requested delay or tying up a job forever.
    (requested <= std::time::Duration::from_secs(30)).then_some(requested.max(floor))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot(protocol: &str, tools: Vec<Value>) -> Snapshot {
        Snapshot {
            provider: "fixture".into(),
            protocol: protocol.into(),
            endpoint: "http://127.0.0.1/v1".into(),
            model: "fixture-model".into(),
            reasoning_effort: Some("high".into()),
            key: Zeroizing::new(b"FICTIONAL-KEY".to_vec()),
            messages: vec![json!({"role":"user","content":"hello"})],
            tools,
        }
    }
    #[test]
    fn reasoning_effort_maps_to_each_supported_protocol_shape() {
        let make = |protocol: &str| snapshot(protocol, vec![]);
        let (_, chat) = request_body(&make("openai-compatible")).unwrap();
        assert_eq!(chat["reasoning_effort"], "high");
        let (_, responses) = request_body(&make("openai-responses")).unwrap();
        assert_eq!(responses["reasoning"]["effort"], "high");
        let (_, azure) = request_body(&make("azure")).unwrap();
        assert_eq!(azure["model"], "fixture-model");
        assert_eq!(auth_header("azure"), "api-key");
        let (_, compatible) = request_body(&make("openai-compatible")).unwrap();
        assert_eq!(compatible["stream"], true);
        let (_, anthropic) = request_body(&make("anthropic")).unwrap();
        assert_eq!(anthropic["output_config"]["effort"], "high");
    }

    #[test]
    fn tools_are_emitted_per_protocol_and_absent_when_empty() {
        let tools = crate::chat_tools::definitions();
        let (_, chat) = request_body(&snapshot("openai-compatible", tools.clone())).unwrap();
        assert_eq!(chat["tools"][0]["type"], "function");
        assert_eq!(
            chat["tools"][0]["function"]["name"],
            "create_local_reminder"
        );
        let (_, responses) = request_body(&snapshot("openai-responses", tools.clone())).unwrap();
        assert_eq!(responses["tools"][0]["name"], "create_local_reminder");
        assert!(responses["tools"][0].get("function").is_none());
        let (_, anthropic) = request_body(&snapshot("anthropic", tools)).unwrap();
        assert_eq!(anthropic["tools"][0]["name"], "create_local_reminder");
        assert_eq!(anthropic["tools"][0]["input_schema"]["type"], "object");
        let (_, bare) = request_body(&snapshot("openai", vec![])).unwrap();
        assert!(bare.get("tools").is_none());
        let (_, bare_responses) = request_body(&snapshot("openai-responses", vec![])).unwrap();
        assert!(bare_responses.get("tools").is_none());
    }

    #[test]
    fn provider_auth_headers_match_protocol_contracts() {
        assert_eq!(auth_header("azure"), "api-key");
        assert_eq!(auth_header("anthropic"), "x-api-key");
        assert_eq!(auth_header("openai-compatible"), "authorization");
    }
    #[test]
    fn native_protocol_terminal_semantics() {
        let mut finish = None;
        let mut tool = ToolAccum::default();
        assert_eq!(
            native_event(
                "anthropic",
                &json!({"type":"message_stop"}),
                &mut finish,
                &mut tool,
                false
            ),
            Ok((None, true))
        );
        assert!(
            finish.is_none(),
            "message_stop alone must not manufacture successful stop reason"
        );
        assert_eq!(
            native_event(
                "anthropic",
                &json!({"type":"message_delta","delta":{"stop_reason":"max_tokens"}}),
                &mut finish,
                &mut tool,
                false
            ),
            Ok((None, false))
        );
        assert_eq!(finish.as_deref(), Some("length"));
        assert_eq!(
            native_event(
                "anthropic",
                &json!({"type":"content_block_start","content_block":{"type":"tool_use"}}),
                &mut finish,
                &mut tool,
                false
            ),
            Err("tools_not_supported")
        );
        assert_eq!(
            native_event(
                "openai-responses",
                &json!({"type":"response.completed","response":{"status":"incomplete"}}),
                &mut finish,
                &mut tool,
                false
            ),
            Err("stream_incomplete")
        );
        assert_eq!(
            native_event(
                "openai-responses",
                &json!({"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call"}]}}),
                &mut finish,
                &mut tool,
                false
            ),
            Err("tools_not_supported")
        );
        assert_eq!(
            native_event(
                "openai-responses",
                &json!({"type":"response.refusal.delta"}),
                &mut finish,
                &mut tool,
                false
            ),
            Err("provider_refusal")
        );
        assert_eq!(
            native_event(
                "openai-responses",
                &json!({"type":"response.completed","response":{"status":"completed","output":[]}}),
                &mut finish,
                &mut tool,
                false
            ),
            Ok((None, true))
        );
        assert_eq!(finish.as_deref(), Some("stop"));
    }

    #[test]
    fn anthropic_tool_use_stream_accumulates_single_proposal() {
        let mut finish = None;
        let mut tool = ToolAccum::default();
        assert_eq!(
            native_event(
                "anthropic",
                &json!({"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_1","name":"create_local_reminder"}}),
                &mut finish,
                &mut tool,
                true
            ),
            Ok((None, false))
        );
        assert_eq!(
            native_event(
                "anthropic",
                &json!({"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"text\":"}}),
                &mut finish,
                &mut tool,
                true
            ),
            Ok((None, false))
        );
        assert_eq!(
            native_event(
                "anthropic",
                &json!({"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"\"开会\"}"}}),
                &mut finish,
                &mut tool,
                true
            ),
            Ok((None, false))
        );
        assert_eq!(
            native_event(
                "anthropic",
                &json!({"type":"message_delta","delta":{"stop_reason":"tool_use"}}),
                &mut finish,
                &mut tool,
                true
            ),
            Ok((None, false))
        );
        assert_eq!(finish.as_deref(), Some("tool_calls"));
        let (name, args) = tool.finish("FICTIONAL-KEY").unwrap();
        assert_eq!(name, "create_local_reminder");
        assert_eq!(args, "{\"text\":\"开会\"}");
        // A second tool_use block in the same turn is refused.
        let mut second = ToolAccum::default();
        assert_eq!(
            native_event(
                "anthropic",
                &json!({"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_2","name":"create_local_reminder"}}),
                &mut finish,
                &mut second,
                true
            ),
            Ok((None, false))
        );
        second
            .push_anthropic(&json!({"id":"toolu_3","name":"other"}))
            .unwrap_err();
    }

    #[test]
    fn responses_function_call_completed_is_authoritative() {
        let mut finish = None;
        let mut tool = ToolAccum::default();
        assert_eq!(
            native_event(
                "openai-responses",
                &json!({"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","name":"create_message_draft"}}),
                &mut finish,
                &mut tool,
                true
            ),
            Ok((None, false))
        );
        let fragment = "{\"text\":\"草".to_owned() + "稿\"}";
        assert_eq!(
            native_event(
                "openai-responses",
                &json!({"type":"response.function_call_arguments.delta","delta":fragment}),
                &mut finish,
                &mut tool,
                true
            ),
            Ok((None, false))
        );
        // The completed event replaces fragments with authoritative args.
        assert_eq!(
            native_event(
                "openai-responses",
                &json!({"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call","id":"fc_1","name":"create_message_draft","arguments":"{\"text\":\"完整草稿\"}"}]}}),
                &mut finish,
                &mut tool,
                true
            ),
            Ok((None, true))
        );
        assert_eq!(finish.as_deref(), Some("tool_calls"));
        let (_, args) = tool.finish("FICTIONAL-KEY").unwrap();
        assert_eq!(args, "{\"text\":\"完整草稿\"}");
    }

    #[test]
    fn chat_completion_tool_accum_rejects_bad_shapes() {
        let mut tool = ToolAccum::default();
        tool.push_chat_completion(
            &json!({"index":0,"id":"call_1","function":{"name":"create_local_reminder"}}),
        )
        .unwrap();
        tool.push_chat_completion(&json!({"index":0,"function":{"arguments":"{\"text\":\"x\","}}))
            .unwrap();
        tool.push_chat_completion(&json!({"index":0,"function":{"arguments":"\"due\":1}"}}))
            .unwrap();
        let (_, args) = tool.finish("FICTIONAL-KEY").unwrap();
        assert_eq!(args, "{\"text\":\"x\",\"due\":1}");
        // Second distinct index or id is a second proposal.
        assert_eq!(
            tool.push_chat_completion(&json!({"index":1,"function":{"arguments":"{}"}}))
                .unwrap_err(),
            "tool_call_invalid"
        );
        assert_eq!(
            tool.push_chat_completion(&json!({"index":0,"id":"call_2","function":{}}))
                .unwrap_err(),
            "tool_call_invalid"
        );
        // Key material never survives inside proposal arguments.
        let mut leak = ToolAccum::default();
        leak.push_chat_completion(&json!({"index":0,"function":{"name":"create_message_draft"}}))
            .unwrap();
        leak.push_chat_completion(
            &json!({"index":0,"function":{"arguments":"{\"text\":\"FICTIONAL-KEY\"}"}}),
        )
        .unwrap();
        assert_eq!(
            leak.finish("FICTIONAL-KEY").unwrap_err(),
            "sensitive_provider_output"
        );
        // Non-object arguments or empty name never pass.
        let mut scalar = ToolAccum::default();
        scalar.push_chat_completion(&json!({"index":0,"function":{"name":"create_message_draft","arguments":"\"just text\""}})).unwrap();
        assert_eq!(
            scalar.finish("FICTIONAL-KEY").unwrap_err(),
            "tool_call_invalid"
        );
        let mut empty = ToolAccum::default();
        assert_eq!(
            empty.finish("FICTIONAL-KEY").unwrap_err(),
            "tool_call_invalid"
        );
    }

    #[test]
    fn retry_after_is_bounded_and_never_shortened() {
        use reqwest::header::HeaderValue;
        use std::time::{Duration, SystemTime};
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let delay =
            |s: &str, attempt| retry_delay(Some(&HeaderValue::from_str(s).unwrap()), attempt, now);
        assert_eq!(retry_delay(None, 0, now), Some(Duration::from_secs(1)));
        assert_eq!(retry_delay(None, 1, now), Some(Duration::from_secs(2)));
        assert_eq!(delay("0", 1), Some(Duration::from_secs(2)));
        assert_eq!(delay("7", 0), Some(Duration::from_secs(7)));
        assert_eq!(delay("31", 0), None);
        assert_eq!(delay("invalid", 0), None);
        assert_eq!(
            delay(&httpdate::fmt_http_date(now + Duration::from_secs(12)), 0),
            Some(Duration::from_secs(12))
        );
        assert_eq!(
            delay(&httpdate::fmt_http_date(now - Duration::from_secs(12)), 0),
            Some(Duration::from_secs(1))
        );
    }
}
