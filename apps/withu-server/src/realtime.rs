//! Server-owned bounded realtime transport. No credentials, raw provider errors or
//! recorded audio enter persistence. Only normalized events cross the GUI bridge.
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    sync::mpsc::{self, Receiver, SyncSender},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tokio::sync::mpsc as async_channel;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use zeroize::Zeroizing;

pub struct Snapshot {
    pub protocol: String,
    pub endpoint: String,
    pub model: String,
    pub voice: String,
    pub key: Zeroizing<Vec<u8>>,
    pub history: Vec<Value>,
    pub read_text: Option<String>,
    pub name: String,
    pub memory_context: String,
    pub support_context: String,
    /// Proposal-only tool catalog (T16). Empty unless the conversation is a
    /// comfort conversation on a protocol that supports function calling, so
    /// voice can never reach a write action the text path would not offer.
    pub tools: Vec<Value>,
}
pub struct Session {
    pub scope: Value,
    pub probe: bool,
    pub live: bool,
    pub started: Instant,
    pub active: bool,
    pub sequence: u64,
    tx: async_channel::Sender<Value>,
    stop: tokio::sync::watch::Sender<bool>,
    thread: Option<JoinHandle<()>>,
}
pub struct Update {
    pub id: String,
    pub data: Value,
}
impl Session {
    pub fn finished(&self) -> bool {
        self.thread.as_ref().is_some_and(|t| t.is_finished())
    }
}
pub struct Realtime {
    pub sessions: BTreeMap<String, Session>,
    tx: SyncSender<Update>,
    rx: Receiver<Update>,
}
impl Default for Realtime {
    fn default() -> Self {
        let (tx, rx) = mpsc::sync_channel(128);
        Self {
            sessions: BTreeMap::new(),
            tx,
            rx,
        }
    }
}
impl Realtime {
    pub fn start(
        &mut self,
        cid: &str,
        renderer: &str,
        config: u64,
        _provider: &str,
        snapshot: Snapshot,
        probe: bool,
    ) -> Result<Value, &'static str> {
        self.reap();
        if self.sessions.values().filter(|s| s.active).count() >= 4 {
            return Err("realtime_capacity");
        }
        if !probe
            && self
                .sessions
                .values()
                .any(|s| s.active && !s.probe && s.scope["renderer_id"] == renderer)
        {
            return Err("realtime_session_active");
        }
        let id = uuid::Uuid::new_v4().to_string();
        let scope = json!({"schema_version":1,"session_id":id,"conversation_id":cid,"renderer_id":renderer,"config_version":config,"generation":1});
        let (tx, rx) = async_channel::channel(32);
        let (stop, stopped) = tokio::sync::watch::channel(false);
        let output = self.tx.clone();
        let worker_id = id.clone();
        let thread = std::thread::spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return;
            };
            runtime.block_on(async move{
   let emit=|data:Value|output.try_send(Update{id:worker_id.clone(),data}).map_err(|_|"audio_output_backpressure");
   let result=run(snapshot,rx,stopped.clone(),&emit).await;
   if !*stopped.borrow(){let _=emit(json!({"type":"failed","code":result.err().unwrap_or("stream_disconnected")}));}
  });
        });
        self.sessions.insert(
            id,
            Session {
                scope: scope.clone(),
                probe,
                live: false,
                started: Instant::now(),
                active: true,
                sequence: 0,
                tx,
                stop,
                thread: Some(thread),
            },
        );
        Ok(scope)
    }
    pub fn scoped(&mut self, scope: &Value) -> Result<&mut Session, &'static str> {
        let s = self
            .sessions
            .get_mut(scope["session_id"].as_str().ok_or("realtime_scope")?)
            .ok_or("realtime_session_missing")?;
        if s.scope != *scope {
            return Err("realtime_scope");
        }
        if !s.active {
            return Err("realtime_session_ended");
        }
        Ok(s)
    }
    pub fn input(&mut self, scope: &Value, sequence: u64, audio: &str) -> Result<(), &'static str> {
        let bytes = STANDARD.decode(audio).map_err(|_| "audio_format_invalid")?;
        if bytes.is_empty() || bytes.len() > 3200 || bytes.len() % 2 != 0 {
            return Err("audio_input_limit");
        }
        let s = self.scoped(scope)?;
        if sequence != s.sequence + 1 {
            return Err("realtime_audio_sequence");
        }
        s.tx.try_send(json!({"type":"input_audio_buffer.append","audio":audio}))
            .map_err(|_| "audio_input_backpressure")?;
        s.sequence = sequence;
        Ok(())
    }
    pub fn command(
        &mut self,
        scope: &Value,
        command: &str,
        response: Option<&str>,
    ) -> Result<(), &'static str> {
        if command == "end" {
            if let Some(s) = self
                .sessions
                .get(scope["session_id"].as_str().unwrap_or(""))
            {
                if s.scope != *scope {
                    return Err("realtime_scope");
                }
            }
            self.end(scope["session_id"].as_str().unwrap_or(""));
            return Ok(());
        }
        let s = self.scoped(scope)?;
        s.tx.try_send(json!({"control":command,"response_id":response}))
            .map_err(|_| "audio_input_backpressure")?;
        Ok(())
    }
    pub fn end(&mut self, id: &str) {
        if let Some(s) = self.sessions.get_mut(id) {
            s.active = false;
            let _ = s.stop.send(true);
        }
    }
    pub fn end_renderer(&mut self, id: &str) {
        for s in self
            .sessions
            .values_mut()
            .filter(|s| s.scope["renderer_id"] == id)
        {
            s.active = false;
            let _ = s.stop.send(true);
        }
    }
    pub fn end_conversation(&mut self, id: &str) {
        for s in self
            .sessions
            .values_mut()
            .filter(|s| s.scope["conversation_id"] == id)
        {
            s.active = false;
            let _ = s.stop.send(true);
        }
    }
    pub fn end_all(&mut self) {
        for s in self.sessions.values_mut() {
            s.active = false;
            let _ = s.stop.send(true);
        }
    }
    pub fn reap(&mut self) {
        for s in self.sessions.values_mut() {
            if s.thread.as_ref().is_some_and(|t| t.is_finished()) {
                s.active = false;
                if let Some(t) = s.thread.take() {
                    let _ = t.join();
                }
            }
        }
        if self.sessions.len() > 32 {
            self.sessions.retain(|_, s| s.active || s.thread.is_some());
        }
    }
    pub fn updates(&self) -> Vec<Update> {
        self.rx.try_iter().take(128).collect()
    }
    pub fn shutdown(&mut self) -> bool {
        self.end_all();
        let until = Instant::now() + Duration::from_secs(2);
        while Instant::now() < until
            && self
                .sessions
                .values()
                .any(|s| s.thread.as_ref().is_some_and(|t| !t.is_finished()))
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        self.reap();
        self.sessions.values().all(|s| s.thread.is_none())
    }
}

fn error_code(code: &str) -> &'static str {
    let code = code.to_lowercase();
    if code.contains("invalidspeaker") {
        "voice_id_invalid"
    } else if code.contains("50700000") || code.contains("timeout") {
        "request_timeout"
    } else if code.contains("auth") || code.contains("api_key") || code.contains("invalid_key") {
        "auth_failed"
    } else if code.contains("rate") || code.contains("quota") {
        "rate_limited"
    } else if code.contains("model") {
        "model_unsupported"
    } else {
        "realtime_provider_error"
    }
}
// Match decoded strings as well as the raw frame (including escaped IDs/metadata).
fn contains_secret(value: &Value, key: &str) -> bool {
    if key.is_empty() {
        return false;
    }
    match value {
        Value::String(text) => text.contains(key),
        Value::Array(values) => values.iter().any(|v| contains_secret(v, key)),
        Value::Object(values) => values
            .iter()
            .any(|(name, v)| name.contains(key) || contains_secret(v, key)),
        _ => false,
    }
}
fn checked_text<'a>(text: &'a str, key: &str, limit: usize) -> Result<&'a str, &'static str> {
    if text.len() > limit {
        return Err(if limit == 16000 {
            "context_limit"
        } else {
            "output_limit"
        });
    }
    if !key.is_empty() && text.contains(key) {
        return Err("sensitive_provider_output");
    }
    Ok(text)
}
fn held_prefix(text: &str, key: &str) -> usize {
    (1..key.len())
        .filter(|n| key.is_char_boundary(*n) && text.ends_with(&key[..*n]))
        .max()
        .unwrap_or(0)
}
#[derive(Default)]
struct SafeText {
    full: String,
    pending: String,
}
impl SafeText {
    fn clear(&mut self) {
        self.full.clear();
        self.pending.clear();
    }
    fn append(&mut self, delta: &str, key: &str) -> Result<String, &'static str> {
        self.full.push_str(delta);
        checked_text(&self.full, key, 64000)?;
        self.pending.push_str(delta);
        let safe = self.pending.len() - held_prefix(&self.pending, key);
        Ok(self.pending.drain(..safe).collect())
    }
    fn replace(&mut self, text: &str, key: &str) -> Result<(), &'static str> {
        checked_text(text, key, 64000)?;
        if self.full != text {
            self.pending.clear();
            self.full = text.into();
        }
        Ok(())
    }
}
async fn run(
    snapshot: Snapshot,
    mut commands: async_channel::Receiver<Value>,
    mut stop: tokio::sync::watch::Receiver<bool>,
    emit: &impl Fn(Value) -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    let volc = snapshot.protocol == "volc-realtime";
    let began = Instant::now();
    let mut url = url::Url::parse(&snapshot.endpoint).map_err(|_| "endpoint_invalid")?;
    if !volc {
        url.query_pairs_mut().append_pair("model", &snapshot.model);
    }
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| "endpoint_invalid")?;
    let key = std::str::from_utf8(&snapshot.key).map_err(|_| "credential_value_invalid")?;
    if volc {
        request.headers_mut().insert(
            "X-Api-Key",
            key.parse().map_err(|_| "credential_value_invalid")?,
        );
    } else {
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {key}")
                .parse()
                .map_err(|_| "credential_value_invalid")?,
        );
    }
    let connect = tokio::time::timeout(Duration::from_secs(15), connect_async(request));
    let (mut socket, _) = tokio::select! {biased;_=stop.changed()=>return Ok(()), result=connect=>result.map_err(|_|"request_timeout")?.map_err(|e|match e{tokio_tungstenite::tungstenite::Error::Http(r)=>match r.status().as_u16(){401|403=>"auth_failed",429=>"rate_limited",404=>"model_unsupported",_=>"service_unavailable"},_=>"service_unavailable"})?};
    let voice = if snapshot.voice.is_empty() {
        if volc {
            "zh_female_vv_jupiter_bigtts"
        } else {
            "longanqian"
        }
    } else {
        &snapshot.voice
    };
    // 语音会话也必须带人格正文：文本回复用 soul.md 作系统提示词，语音若只发
    // 一个名字，同一个「我」在两种媒介里就不是同一个人了。
    let instructions=format!("{}\n\n---\n以上是你的灵魂文档。语音会话沿用同一份人格，只是语域可以更活泼、更俏皮。补充运行规则：\n1. 你的名字以本条为准：当前名字是「{}」（Withu 是应用名，不是你的名字），旧消息里的其他名字一律不再使用。\n2. 跟随用户当前的语言和意愿。不下诊断、不假装确定、不强行正能量、不鼓励依赖。用户说停就停。没有接入联网工具，不要声称自己搜索过。{}{}",crate::SOUL_MD,snapshot.name,snapshot.memory_context,snapshot.support_context);
    // Without this the voice model would answer a request out loud and leave
    // nothing behind; with it, a request becomes a proposal the user approves.
    let instructions = if snapshot.tools.is_empty() {
        instructions
    } else {
        format!("{instructions}{}", crate::chat_tools::PROPOSAL_GUIDANCE)
    };
    let create = if volc {
        json!({"event_id":uuid::Uuid::new_v4().to_string(),"type":"session.create","session":{"id":uuid::Uuid::new_v4().to_string(),"model":snapshot.model,"instructions":instructions,"audio":{"input":{"format":{"type":"pcm","rate":16000}},"output":{"format":{"type":"pcm_s16le","rate":24000},"voice":voice}}},"extension":{"asr":{"extra":{}},"tts":{"extra":{}},"dialog":{"extra":{}}}})
    } else {
        // Tools travel with the session, exactly like the text path's tool
        // catalog: same definitions, same "+ proposals only" instruction.
        let mut session = json!({"modalities":["text","audio"],"voice":voice,"instructions":instructions,"input_audio_format":"pcm","output_audio_format":"pcm","turn_detection":{"type":"server_vad","threshold":0.5,"silence_duration_ms":500}});
        if !snapshot.tools.is_empty() {
            session["tools"] = Value::Array(snapshot.tools.clone());
            session["tool_choice"] = "auto".into();
        }
        json!({"event_id":uuid::Uuid::new_v4().to_string(),"type":"session.update","session":session})
    };
    socket
        .send(Message::Text(create.to_string().into()))
        .await
        .map_err(|_| "stream_disconnected")?;
    let mut ready = false;
    let mut audio_response = String::new();
    let mut response = String::new();
    let mut cancelled = HashSet::new();
    let mut text = SafeText::default();
    let mut transcript_items = HashSet::new();
    // The proposal path needs the committed user message as evidence, so the
    // turn's own item id must travel with the tool call; the transcript for
    // that item may legitimately arrive after response.done.
    let mut user_item = String::new();
    let mut user_item_text = String::new();
    let mut user_item_final = false;
    let mut tool_name = String::new();
    let mut tool_args = String::new();
    // A tool call may resolve before its own transcript is committed. Holding
    // it here keeps the proposal strictly after the user message it answers,
    // so main never sees an anchored-at-nothing card.
    let mut pending_tool: Option<Value> = None;
    let mut muted = false;
    let mut generation = 0u64;
    let mut output_first = None;
    let mut turn_started = Instant::now();
    let mut seeded = false;
    let mut item_generations = BTreeMap::new();
    let mut asr_text = String::new();
    let mut text_done = false;
    let mut audio_done = false;
    let mut completed = HashSet::new();
    loop {
        tokio::select! {biased;
         _=stop.changed()=>{
          if volc{let _=tokio::time::timeout(Duration::from_millis(700),async{
           socket.send(Message::Text(json!({"type":"session.close","event_id":uuid::Uuid::new_v4().to_string()}).to_string().into())).await?;
           while let Some(frame)=socket.next().await{let frame=frame?;match frame{Message::Text(raw)=>{if serde_json::from_str::<Value>(&raw).is_ok_and(|e|e["type"]=="session.closed"){break;}},Message::Ping(bytes)=>socket.send(Message::Pong(bytes)).await?,Message::Close(_)=>break,_=>{}}}Ok::<_,tokio_tungstenite::tungstenite::Error>(())
          }).await;}
          let _=tokio::time::timeout(Duration::from_millis(300),socket.close(None)).await;return Ok(());
         },
         command=commands.recv()=>{let Some(mut command)=command else{return Ok(())};
          if let Some(control)=command["control"].as_str(){match control{
           "interrupt"|"mute"=>{if control=="mute"{muted=true;}audio_response.clear();text.clear();pending_tool=None;if !response.is_empty(){cancelled.insert(response.clone());socket.send(Message::Text(json!({"type":"response.cancel"}).to_string().into())).await.map_err(|_|"stream_disconnected")?;}},
           "unmute"=>muted=false,
           _=>{}
          }}else{if !ready{continue;}let audio=STANDARD.decode(command["audio"].as_str().ok_or("audio_format_invalid")?).map_err(|_|"audio_format_invalid")?;
           for frame in audio.chunks(640){command["audio"]=STANDARD.encode(frame).into();command["event_id"]=uuid::Uuid::new_v4().to_string().into();
            tokio::select!{biased;_=stop.changed()=>return Ok(()),result=tokio::time::timeout(Duration::from_secs(2),socket.send(Message::Text(command.to_string().into())))=>{result.map_err(|_|"request_timeout")?.map_err(|_|"stream_disconnected")?;}}
           }}
         },
         frame=socket.next()=>{
          let frame=frame.ok_or("stream_disconnected")?.map_err(|_|"stream_disconnected")?;
          let raw=match frame{Message::Text(raw)=>raw,Message::Ping(bytes)=>{socket.send(Message::Pong(bytes)).await.map_err(|_|"stream_disconnected")?;continue;},Message::Close(_)=>return Err("stream_disconnected"),_=>continue};
          if raw.len()>512_000{return Err("audio_response_limit");}
          if !key.is_empty()&&raw.contains(key){return Err("sensitive_provider_output");}
          let mut e:Value=serde_json::from_str(&raw).map_err(|_|"provider_protocol_invalid")?;
          if contains_secret(&e,key) { return Err("sensitive_provider_output"); }
          // Seeduplex JSON events normalize into the existing scoped session pipeline.
          if volc{
           let kind=e["type"].as_str().unwrap_or("").to_owned();

           match kind.as_str(){
            "session.created"=>e["type"]="session.updated".into(),
            "conversation.item.input_audio_transcription.started"=>{asr_text.clear();e["type"]="input_audio_buffer.speech_started".into();if e["item_id"].as_str().unwrap_or("").is_empty(){e["item_id"]=format!("speech-{}",generation+1).into();}},
            "conversation.item.input_audio_transcription.delta"=>{asr_text=e["delta"].as_str().unwrap_or("").to_owned();if asr_text.len()>16000{return Err("context_limit");}e["text"]=asr_text.clone().into();},
            "conversation.item.input_audio_transcription.completed"=>{emit(json!({"type":"speech_stopped","generation":generation,"item_id":e["item_id"]}))?;if e["transcript"].is_null(){e["transcript"]=e["text"].clone();}},
            "response.output_text.delta"|"response.output_text.done"|"response.output_audio.started"|"response.output_audio.delta"|"response.output_audio.done"=>{
             // Real audio.delta frames carry only delta/event_id; bind them to the preceding audio.started.
             if kind=="response.output_audio.started"{audio_response=e["response_id"].as_str().filter(|id|!id.is_empty()).unwrap_or(&response).to_owned();if audio_response.is_empty()&&snapshot.read_text.is_some(){audio_response="read-audio".into();}
              if e["response_id"].as_str().unwrap_or("").is_empty(){e["response_id"]=audio_response.clone().into();}}
             if (kind=="response.output_audio.delta"||kind=="response.output_audio.done")&&e["response_id"].as_str().unwrap_or("").is_empty()&&!audio_response.is_empty(){e["response_id"]=audio_response.clone().into();}
             if (kind=="response.output_text.delta"||kind=="response.output_text.done")&&e["response_id"].as_str().unwrap_or("").is_empty()&&!response.is_empty(){e["response_id"]=response.clone().into();}
             let id=e["response_id"].as_str().unwrap_or("").to_owned();if id.is_empty()||cancelled.contains(&id)||completed.contains(&id){continue;}
             if id!=response{response=id.clone();text.clear();text_done=false;audio_done=false;output_first=None;emit(json!({"type":"response_started","response_id":id,"generation":generation}))?;}
             match kind.as_str(){
              "response.output_text.delta"=>e["type"]="response.audio_transcript.delta".into(),
              "response.output_audio.delta"=>e["type"]="response.audio.delta".into(),
              "response.output_text.done"=>{if let Some(final_text)=e["text"].as_str(){text.replace(final_text,key)?;}text_done=true;},
              "response.output_audio.done"=>{let code=e["status_code"].as_str().map(str::to_owned).unwrap_or_else(||e["status_code"].to_string());// The official output_audio.done event also has a documented form without status_code.
              if !e["status_code"].is_null()&&code!="20000000"&&code!="20000002"{return Err("stream_incomplete");}audio_done=true;if snapshot.read_text.is_some(){text_done=true;}},
              _=>continue,
             }
             if text_done&&audio_done{completed.insert(id.clone());if completed.len()>256{return Err("realtime_session_limit");}e=json!({"type":"response.done","response":{"id":id,"status":"completed"}});}
            },
            // response.done is usage accounting in Seeduplex, not the audio completion signal.
            "response.done"|"session.updated"=>continue,
            "session.closed"=>return Err("stream_disconnected"),
            "error"=>{let code=e["error"]["code"].as_str().or(e["error"]["type"].as_str()).unwrap_or("");let message=e["error"]["message"].as_str().unwrap_or("");return Err(error_code(&format!("{code} {message}")));},
            _=>{},
           }
          }
          match e["type"].as_str().unwrap_or(""){
           "session.updated"=>{if !ready{ready=true;emit(json!({"type":"ready","connection_ms":began.elapsed().as_millis() as u64,"input_rate":16000,"output_rate":24000}))?;}
            if !seeded{if let Some(read_text)=&snapshot.read_text{let speech_id=uuid::Uuid::new_v4().to_string();for event in [json!({"type":"speech_text_buffer.append","event_id":uuid::Uuid::new_v4().to_string(),"speech_id":speech_id,"text":read_text}),json!({"type":"speech_text_buffer.commit","speech_id":speech_id,"text":"","event_id":uuid::Uuid::new_v4().to_string()})]{socket.send(Message::Text(event.to_string().into())).await.map_err(|_|"stream_disconnected")?;}seeded=true;}}
            if !seeded{if volc{let mut paired=Vec::new();for pair in snapshot.history.windows(2){if pair[0]["role"]=="user"&&pair[1]["role"]=="assistant"{paired.extend([&pair[0],&pair[1]]);}}let items:Vec<_>=paired.into_iter().rev().take(40).collect::<Vec<_>>().into_iter().rev().map(|message|json!({"id":message["id"],"type":"message","role":message["role"],"content":[{"type":"input_text","text":message["text"]}]})).collect();if !items.is_empty(){socket.send(Message::Text(json!({"type":"conversation.item.create","items":items}).to_string().into())).await.map_err(|_|"stream_disconnected")?;}}else{for message in &snapshot.history{socket.send(Message::Text(json!({"type":"conversation.item.create","item":{"type":"message","role":message["role"],"content":[{"type":if message["role"]=="user"{"input_text"}else{"text"},"text":message["text"]}]}}).to_string().into())).await.map_err(|_|"stream_disconnected")?;}}seeded=true;}

           },
           "input_audio_buffer.speech_started"=>{audio_response.clear();text.clear();generation+=1;if item_generations.len()>=256||transcript_items.len()>=256||cancelled.len()>=256{return Err("realtime_session_limit");}
            if let Some(id)=e["item_id"].as_str(){item_generations.insert(id.to_owned(),generation);user_item=id.to_owned();}user_item_text.clear();user_item_final=false;pending_tool=None;tool_name.clear();tool_args.clear();turn_started=Instant::now();if !response.is_empty(){cancelled.insert(response.clone());socket.send(Message::Text(json!({"type":"response.cancel"}).to_string().into())).await.map_err(|_|"stream_disconnected")?;}emit(json!({"type":"speech_started","generation":generation,"item_id":e["item_id"]}))?;},
           "input_audio_buffer.speech_stopped"=>{emit(json!({"type":"speech_stopped","generation":generation,"item_id":e["item_id"]}))?;},
           "conversation.item.input_audio_transcription.delta"=>{let preview=format!("{}{}",e["text"].as_str().unwrap_or(""),e["stash"].as_str().unwrap_or(""));checked_text(&preview,key,16000)?;let safe=&preview[..preview.len()-held_prefix(&preview,key)];emit(json!({"type":"transcript_delta","item_id":e["item_id"],"text":safe,"generation":item_generations.get(e["item_id"].as_str().unwrap_or("")).copied().unwrap_or(generation)}))?;},
           "conversation.item.input_audio_transcription.completed"=>{let item=e["item_id"].as_str().ok_or("provider_protocol_invalid")?;if transcript_items.insert(item.to_owned()){let transcript=checked_text(e["transcript"].as_str().unwrap_or(""),key,16000)?;emit(json!({"type":"transcript_final","item_id":item,"text":transcript,"generation":item_generations.get(item).copied().unwrap_or(generation)}))?;if item==user_item{user_item_text=transcript.to_owned();}}if item==user_item{user_item_final=true;if let Some(event)=pending_tool.take(){emit(event)?;}}},
           "response.output_item.added"=>{
            if e["item"]["type"]=="function_call"{
             tool_name=e["item"]["name"].as_str().unwrap_or("").to_owned();
             tool_args.clear();
             if let Some(args)=e["item"]["arguments"].as_str(){if !args.is_empty()&&args!="{}"{tool_args.push_str(args);}}
            }
           },
           "response.function_call_arguments.delta"=>{
            let delta=e["delta"].as_str().unwrap_or("");
            if tool_args.len()+delta.len()>8000{return Err("context_limit");}
            tool_args.push_str(delta);
           },
           "response.created"=>{response=e["response"]["id"].as_str().ok_or("provider_protocol_invalid")?.into();if cancelled.contains(&response){continue;}text.clear();output_first=None;emit(json!({"type":"response_started","response_id":response,"generation":generation}))?;},
           "response.audio.delta"=>{let id=e["response_id"].as_str().unwrap_or("");if id!=response||cancelled.contains(id)||muted{continue;}let audio=e["delta"].as_str().ok_or("provider_protocol_invalid")?;let bytes=STANDARD.decode(audio).map_err(|_|"audio_format_invalid")?;if bytes.is_empty()||bytes.len()%2!=0||bytes.len()>96000{return Err("audio_format_invalid");}let first=*output_first.get_or_insert(turn_started.elapsed().as_millis() as u64);emit(json!({"type":"audio","response_id":id,"audio_base64":audio,"sample_rate":24000,"channels":1,"format":"pcm16le","generation":generation,"first_audio_ms":first}))?;},
           "response.audio_transcript.delta"|"response.text.delta"=>{let id=e["response_id"].as_str().unwrap_or("");if id!=response||cancelled.contains(id){continue;}let safe=text.append(e["delta"].as_str().unwrap_or(""),key)?;if !safe.is_empty(){emit(json!({"type":"assistant_delta","response_id":id,"text":safe,"generation":generation}))?;}},
           "response.audio_transcript.done"=>{if e["response_id"]==response&&!cancelled.contains(&response){if let Some(final_text)=e["transcript"].as_str(){text.replace(final_text,key)?;}}},
           "response.done"=>{
            let id=e["response"]["id"].as_str().unwrap_or("").to_owned();
            if id!=response||cancelled.contains(&id){continue;}
            if e["response"]["status"]!="completed"{
             text.clear();
             emit(json!({"type":"response_failed","response_id":id,"code":"stream_incomplete","generation":generation}))?;
             continue;
            }
            checked_text(&text.full,key,64000)?;
            // A function-call turn still closes the spoken turn, so the renderer
            // keeps its existing end-of-turn contract. The call is a proposal
            // only: it never turns into text the user would read as done.
            let call=e["response"]["output"].as_array().and_then(|items|items.iter().find(|item|item["type"]=="function_call").cloned());
            if !text.pending.is_empty(){emit(json!({"type":"assistant_delta","response_id":id,"text":std::mem::take(&mut text.pending),"generation":generation}))?;}
            emit(json!({"type":"assistant_final","response_id":id,"text":text.full,"generation":generation,"duration_ms":turn_started.elapsed().as_millis() as u64,"first_audio_ms":output_first}))?;
            text.clear();response.clear();
            if let Some(call)=call{
             let name=call["name"].as_str().filter(|name|!name.is_empty()).map(str::to_owned).unwrap_or_else(||tool_name.clone());
             let args=call["arguments"].as_str().filter(|args|!args.is_empty()&&*args!="{}").map(str::to_owned).unwrap_or_else(||tool_args.clone());
             if name.is_empty(){return Err("provider_protocol_invalid");}
             checked_text(&args,key,8000)?;
             let event=json!({"type":"tool_call","response_id":id,"item_id":user_item,"transcript":user_item_text,"name":name,"arguments":args,"call_id":call["call_id"].as_str().or(call["id"].as_str()).unwrap_or(""),"generation":generation});
             if user_item_final{emit(event)?;}else{pending_tool=Some(event);}
            }
            tool_name.clear();tool_args.clear();
           },
           "conversation.item.input_audio_transcription.failed"=>{emit(json!({"type":"transcript_failed","code":"asr_rejected","generation":generation}))?;},
           "error"=>{let code=e["error"]["code"].as_str().unwrap_or("");if code=="response_cancel_not_active"{continue;}return Err(error_code(code));},
           _=>{}
          }
         },
         _=tokio::time::sleep_until(tokio::time::Instant::from_std(began+Duration::from_secs(15))),if !ready=>return Err("request_timeout"),
        }
    }
}

#[cfg(test)]
mod text_tests {
    use super::*;

    #[test]
    fn unicode_secret_prefix_is_held_before_split_completion() {
        let key = "钥匙🔑abc";
        let mut text = SafeText::default();
        assert_eq!(text.append("normal 钥匙", key), Ok("normal ".into()));
        assert_eq!(text.append("🔑a", key), Ok(String::new()));
        assert_eq!(text.append("bc", key), Err("sensitive_provider_output"));
    }

    #[test]
    fn final_replacement_is_validated_and_new_response_discards_prefix() {
        let key = "fixture-secret";
        let mut text = SafeText::default();
        assert_eq!(text.append("fixture-", key), Ok(String::new()));
        assert_eq!(text.replace(key, key), Err("sensitive_provider_output"));
        text.clear();
        assert_eq!(text.append("secret", key), Ok("secret".into()));
        assert_eq!(text.append(" accepted", ""), Ok(" accepted".into()));
        assert!(!contains_secret(&json!({"id":"ordinary"}), ""));
    }
}
