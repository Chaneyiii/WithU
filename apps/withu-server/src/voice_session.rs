//! Production voice scopes. Client endpoint detection may explicitly submit an ASR final.
use serde_json::{json, Value};
use std::collections::BTreeMap;
#[derive(Default)]
pub struct VoiceSessions {
    entries: BTreeMap<String, Session>,
}
pub struct Session {
    pub id: String,
    pub conversation: String,
    pub renderer: String,
    pub config: u64,
    pub generation: u64,
    pub revision: u64,
    pub turn: String,
    pub state: &'static str,
    pub transcript: Option<String>,
    pub reply: Option<String>,
    pub submitted: bool,
}
impl Session {
    pub fn snapshot(&self) -> Value {
        json!({"session_id":self.id,"conversation_id":self.conversation,"renderer_id":self.renderer,"config_version":self.config,"generation":self.generation,"turn_id":self.turn,"transcript_revision":self.revision,"state":self.state,"synthetic":false,"asr_streaming":false,"continuous_duplex":false})
    }
    pub fn fresh(&mut self) {
        self.generation += 1;
        self.turn = uuid::Uuid::new_v4().to_string();
        self.revision = 0;
        self.transcript = None;
        self.reply = None;
        self.submitted = false;
        self.state = "listening";
    }
}
impl VoiceSessions {
    pub fn snapshot(&self, id: &str) -> Option<Value> {
        self.entries.get(id).map(Session::snapshot)
    }
    pub fn set_reply(&mut self, id: &str, reply: &str) {
        if let Some(s) = self.entries.get_mut(id) {
            s.reply = Some(reply.into());
        }
    }
    pub fn start(&mut self, cid: &str, renderer: &str, config: u64) -> Result<Value, &'static str> {
        if self
            .entries
            .values()
            .any(|s| s.renderer == renderer && s.state != "ended")
        {
            return Err("voice_session_active");
        }
        if self.entries.len() >= 32 {
            self.entries.retain(|_, s| s.state != "ended");
        }
        if self.entries.len() >= 32 {
            return Err("voice_session_capacity");
        }
        let id = uuid::Uuid::new_v4().to_string();
        let s = Session {
            id: id.clone(),
            conversation: cid.into(),
            renderer: renderer.into(),
            config,
            generation: 1,
            revision: 0,
            turn: uuid::Uuid::new_v4().to_string(),
            state: "idle",
            transcript: None,
            reply: None,
            submitted: false,
        };
        let value = s.snapshot();
        self.entries.insert(id, s);
        Ok(value)
    }
    pub fn scoped(&mut self, p: &Value) -> Result<&mut Session, &'static str> {
        let s = self
            .entries
            .get_mut(p["session_id"].as_str().ok_or("voice_session_missing")?)
            .ok_or("voice_session_missing")?;
        if p["conversation_id"] != s.conversation || p["renderer_id"] != s.renderer {
            return Err("voice_session_scope");
        }
        if p["generation"] != s.generation
            || p["turn_id"] != s.turn
            || p["config_version"] != s.config
        {
            return Err("voice_session_stale");
        }
        Ok(s)
    }
    pub fn finish_asr(&mut self, p: &Value, text: &str) -> bool {
        let Ok(s) = self.scoped(p) else { return false };
        if s.state != "thinking" || s.transcript.is_some() || s.submitted {
            return false;
        }
        s.revision += 1;
        s.transcript = Some(text.into());
        s.state = "idle";
        true
    }
    pub fn end_renderer(&mut self, id: &str) -> Vec<String> {
        let mut cids = vec![];
        for s in self
            .entries
            .values_mut()
            .filter(|s| s.renderer == id && s.state != "ended")
        {
            s.state = "ended";
            s.generation += 1;
            cids.push(s.conversation.clone());
        }
        cids
    }
    pub fn end_conversation(&mut self, cid: &str) {
        for s in self.entries.values_mut().filter(|s| s.conversation == cid) {
            s.state = "ended";
            s.generation += 1;
        }
    }
    pub fn end_all(&mut self) -> Vec<String> {
        let ids = self
            .entries
            .values()
            .filter(|s| s.state != "ended")
            .map(|s| s.conversation.clone())
            .collect();
        for s in self.entries.values_mut() {
            s.state = "ended";
            s.generation += 1;
        }
        ids
    }
}
