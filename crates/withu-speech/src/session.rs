use crate::backend::{AsrBackend, BackendEvent, FakeAsr, FakeTts, TtsBackend, SAMPLE_RATE};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub type SpeechResult<T> = Result<T, &'static str>;
const VAD_ENERGY_THRESHOLD: f64 = 2500.0;
const MAX_INPUT_SAMPLES: usize = 1600;

pub struct Session {
    id: String,
    conversation: String,
    renderer: String,
    turn: Option<String>,
    config: u64,
    generation: u64,
    version: u64,
    state: &'static str,
    backend: String,
    scenario: String,
    muted: bool,
    attached: bool,
    capturing: bool,
    requires_resume: bool,
    voiced: bool,
    input_sequence: u64,
    transcript_revision: u64,
    final_text: Option<String>,
    responded: bool,
    source: &'static str,
    synthesis_complete: bool,
    playback_completed: bool,
    cleanup_complete: bool,
    discarded: u64,
    work: Vec<BackendEvent>,
    asr: Box<dyn AsrBackend>,
    tts: Box<dyn TtsBackend>,
}
impl Session {
    pub fn snapshot(&self) -> Value {
        json!({"schema_version":1,"session_id":self.id,"conversation_id":self.conversation,"renderer_id":self.renderer,"turn_id":self.turn,"config_version":self.config,"generation":self.generation,"version":self.version,"state":self.state,"backend_id":self.backend,"muted":self.muted,"attached":self.attached,"synthetic":true,"transcript_revision":self.transcript_revision,"pending_work":self.work.len(),"discarded_stale":self.discarded,"cleanup_complete":self.cleanup_complete})
    }
    fn update(
        &self,
        kind: &str,
        text: Option<&str>,
        sequence: u64,
        samples: &[i16],
        reason: Option<&str>,
    ) -> Value {
        json!({"schema_version":1,"session":self.snapshot(),"kind":kind,"utterance_id":self.turn,"revision":self.transcript_revision,"text":text,"source":if kind=="audio" || kind=="synthesis_complete" || kind=="response" {"withu_tts"}else if matches!(kind,"partial"|"final"|"corrected"|"provider_complete"|"vad_started"|"vad_stopped") {self.source}else {"control"},"frame_sequence":sequence,"sample_rate":SAMPLE_RATE,"samples":samples,"occurred_at":millis(),"reason":reason})
    }
    fn state(&mut self, state: &'static str, reason: Option<&str>) -> Value {
        self.state = state;
        self.version += 1;
        self.update("state", None, 0, &[], reason)
    }
    fn cancel(&mut self, state: &'static str) -> Vec<Value> {
        if self.state == state && !self.capturing && self.work.is_empty() {
            return vec![];
        }
        self.generation += 1;
        self.capturing = false;
        self.requires_resume = true;
        self.voiced = false;
        self.discarded += self.work.len() as u64;
        if self.scenario != "cleanup_failure" {
            self.work.clear();
            self.cleanup_complete = true;
        } else {
            self.cleanup_complete = false;
        }
        self.synthesis_complete = false;
        self.playback_completed = false;
        let mut changes = vec![
            self.state(state, None),
            self.update("cancelled", None, 0, &[], None),
        ];
        if !self.cleanup_complete {
            changes.push(self.update(
                "cleanup_failed",
                None,
                0,
                &[],
                Some("synthetic_cleanup_failure"),
            ));
        }
        changes
    }
    fn fresh_turn(&mut self) {
        self.requires_resume = false;
        self.generation += 1;
        self.turn = Some(format!("{}-turn-{}", self.id, self.generation));
        self.work.clear();
        self.capturing = false;
        self.voiced = false;
        self.input_sequence = 0;
        self.transcript_revision = 0;
        self.final_text = None;
        self.responded = false;
        self.synthesis_complete = false;
        self.playback_completed = false;
        self.cleanup_complete = false;
        self.requires_resume = false;
    }
    fn command(&mut self, p: &Value) -> SpeechResult<Vec<Value>> {
        if p["conversation_id"] != self.conversation || p["renderer_id"] != self.renderer {
            return Err("speech_scope");
        }
        if p["config_version"] != self.config {
            return Err("speech_config_snapshot");
        }
        let command = p["command"].as_str().ok_or("speech_command")?;
        if command != "input" && !command.starts_with("playback_") && p["source"] != "control" {
            return Err("speech_control_source");
        }
        if command == "status" {
            return Ok(vec![]);
        }
        // New idempotent terminal requests may repeat an old cancellation generation, but no input/output can.
        if ["end", "detach", "interrupt", "mute"].contains(&command)
            && (self.state == "ended"
                || (command == "interrupt" && self.state == "interrupted")
                || (command == "mute" && self.muted))
        {
            return Ok(vec![]);
        }
        if p["generation"] != self.generation || p["turn_id"] != json!(self.turn) {
            return Err("speech_stale_generation");
        }
        if self.state == "ended" {
            return Err("speech_ended");
        }
        let mut out = vec![];
        match command {
            "resume" => {
                if !self.attached || self.muted {
                    return Err("speech_device_not_attached");
                }
                if self.capturing || !self.work.is_empty() {
                    return Err("speech_busy");
                }
                self.fresh_turn();
                out.push(self.state("idle", None));
            }
            "capture_begin" => {
                if !self.attached || self.muted || self.turn.is_none() {
                    return Err("speech_device_not_attached");
                }
                if self.requires_resume
                    || !matches!(self.state, "idle" | "listening")
                    || self.capturing
                {
                    return Err("speech_explicit_resume_required");
                }
                self.capturing = true;
                self.voiced = false;
                self.input_sequence = 0;
                out.push(self.state("listening", None));
            }
            "input" => {
                if !self.capturing || self.muted || !self.attached {
                    return Err("speech_capture_closed");
                }
                let source = match p["source"].as_str() {
                    Some("user_microphone") => "user_microphone",
                    Some("user_fixture") => "user_fixture",
                    _ => return Err("speech_input_source"),
                };
                let seq = p["frame_sequence"]
                    .as_u64()
                    .ok_or("speech_frame_sequence")?;
                if seq != self.input_sequence + 1 {
                    return Err("speech_frame_sequence");
                }
                let samples = p["samples"].as_array().ok_or("speech_samples")?;
                if samples.is_empty() || samples.len() > MAX_INPUT_SAMPLES {
                    return Err("speech_frame_size");
                }
                self.input_sequence = seq;
                self.source = source;
                let energy = samples
                    .iter()
                    .map(|v| v.as_i64().unwrap_or(0) as f64)
                    .map(|n| n * n)
                    .sum::<f64>()
                    / samples.len() as f64;
                if !self.voiced && energy > VAD_ENERGY_THRESHOLD {
                    self.voiced = true;
                    self.version += 1;
                    out.push(self.update("vad_started", None, seq, &[], None));
                }
            }
            "capture_end" => {
                if !self.capturing {
                    return Err("speech_capture_closed");
                }
                self.capturing = false;
                self.version += 1;
                out.push(self.update("vad_stopped", None, self.input_sequence, &[], None));
                if !self.voiced || self.scenario == "no_input" {
                    out.push(self.state("idle", Some("no_user_speech")));
                } else if self.scenario == "overlap" {
                    out.push(self.state("degraded", Some("ambiguous_speakers_use_text")));
                } else if self.scenario == "disconnect" {
                    out.extend(self.cancel("reconnecting"));
                } else if self.scenario == "fail" {
                    out.extend(self.cancel("degraded"));
                } else {
                    out.push(self.state("thinking", Some("synthetic_asr_processing")));
                    self.work = self.asr.finish(
                        self.generation,
                        self.turn.as_deref().unwrap(),
                        &self.scenario,
                    );
                }
            }
            "interrupt" => out.extend(self.cancel("interrupted")),
            "end" | "detach" | "refuse" => {
                out.extend(self.cancel("ended"));
                self.attached = false;
                self.version += 1;
                out.push(self.update("state", None, 0, &[], None));
            }
            "mute" => {
                self.muted = true;
                out.extend(self.cancel("idle"));
            }
            "unmute" => {
                self.muted = false;
                out.push(self.state("idle", Some("explicit_capture_required")));
            }
            "quiet" => out.extend(self.cancel("idle")),
            "device_failed" => {
                self.attached = false;
                out.extend(self.cancel("degraded"));
            }
            "reconnect" => {
                if self.state != "reconnecting" {
                    return Err("speech_not_disconnected");
                }
                self.work.clear();
                out.push(self.state("idle", Some("explicit_resume_required")));
            }
            "correct" => {
                let text = p["text"]
                    .as_str()
                    .filter(|t| !t.is_empty() && t.len() <= 4096)
                    .ok_or("speech_correction_text")?;
                if self.final_text.is_none()
                    || p["expected_transcript_revision"] != self.transcript_revision
                {
                    return Err("speech_stale_transcript");
                }
                self.final_text = Some(text.into());
                self.transcript_revision += 1;
                self.version += 1;
                out.push(self.update("corrected", Some(text), 0, &[], None));
                // Correction never triggers a second synthetic response or a message/authorization write.
            }
            "playback_started" => {
                if self.state != "speaking" || p["source"] != "withu_tts" {
                    return Err("speech_playback_scope");
                }
            }
            "playback_completed" => {
                if p["source"] != "withu_tts"
                    || !self.synthesis_complete
                    || self.state != "speaking"
                {
                    return Err("speech_playback_not_complete");
                }
                if !self.playback_completed {
                    self.playback_completed = true;
                    self.requires_resume = true;
                    self.cleanup_complete = true;
                    self.version += 1;
                    out.push(self.update(
                        "playback_completed",
                        None,
                        0,
                        &[],
                        Some("not_user_acceptance"),
                    ));
                    out.push(self.state("idle", None));
                }
            }
            "playback_stopped" => {
                if p["source"] != "withu_tts" {
                    return Err("speech_playback_scope");
                }
            }
            _ => return Err("speech_command"),
        }
        Ok(out)
    }
    fn tick(&mut self) -> Vec<Value> {
        let now = Instant::now();
        let mut due = vec![];
        let mut pending = vec![];
        for event in self.work.drain(..) {
            if event.due <= now {
                due.push(event);
            } else {
                pending.push(event);
            }
        }
        self.work = pending;
        due.sort_by_key(|e| e.due);
        let mut out = vec![];
        for event in due {
            if event.generation != self.generation
                || Some(&event.turn_id) != self.turn.as_ref()
                || !self.attached
                || matches!(
                    self.state,
                    "ended" | "interrupted" | "reconnecting" | "degraded"
                )
            {
                self.discarded += 1;
                continue;
            }
            match event.kind {
                "partial" => {
                    if self.final_text.is_none() && event.revision > self.transcript_revision {
                        self.transcript_revision = event.revision;
                        self.version += 1;
                        out.push(self.update("partial", event.text.as_deref(), 0, &[], None));
                    }
                }
                "final" => {
                    if self.final_text.is_none() && event.revision > self.transcript_revision {
                        self.transcript_revision = event.revision;
                        self.final_text = event.text.clone();
                        self.version += 1;
                        out.push(self.update("final", event.text.as_deref(), 0, &[], None));
                    }
                }
                "provider_complete" => {
                    if self.final_text.is_none() || self.responded {
                        continue;
                    }
                    self.responded = true;
                    self.version += 1;
                    out.push(self.update("provider_complete", None, 0, &[], None));
                    if self.scenario == "quiet" {
                        out.push(self.state("idle", Some("quiet_together")));
                        self.cleanup_complete = true;
                    } else if self.scenario == "refuse" {
                        out.extend(self.cancel("ended"));
                    } else {
                        out.push(self.state("thinking", None));
                        out.push(self.update(
                            "response",
                            Some("合成测试回应：以下为测试提示音，不是真人语音。"),
                            0,
                            &[],
                            None,
                        ));
                        self.work.extend(
                            self.tts
                                .synthesize(self.generation, self.turn.as_deref().unwrap()),
                        );
                    }
                }
                "audio" => {
                    if self.state == "thinking" {
                        out.push(self.state("speaking", Some("synthetic_tone_not_voice")));
                    }
                    self.version += 1;
                    out.push(self.update(
                        "audio",
                        None,
                        event.frame_sequence,
                        &self.tts.render(event.frame_sequence),
                        None,
                    ));
                }
                "synthesis_complete" => {
                    self.synthesis_complete = true;
                    self.version += 1;
                    out.push(self.update(
                        "synthesis_complete",
                        None,
                        event.frame_sequence,
                        &[],
                        None,
                    ));
                }
                _ => {}
            }
        }
        out
    }
}
#[derive(Default)]
pub struct SpeechSessions {
    entries: BTreeMap<String, Session>,
    next: u64,
}
impl SpeechSessions {
    pub fn start(&mut self, p: &Value) -> SpeechResult<(Value, Vec<Value>)> {
        let renderer = p["renderer_id"].as_str().ok_or("speech_renderer")?;
        let mut out = self.detach(renderer);
        if self
            .entries
            .values()
            .any(|s| !s.cleanup_complete && s.state == "ended")
        {
            return Err("speech_cleanup_failed");
        }
        self.entries.retain(|_, s| s.state != "ended");
        self.next += 1;
        let id = format!("speech-{}-{}", std::process::id(), self.next);
        let backend = p["backend_id"].as_str().ok_or("speech_backend")?;
        let mut s = Session {
            id: id.clone(),
            conversation: p["conversation_id"]
                .as_str()
                .ok_or("speech_conversation")?
                .into(),
            renderer: renderer.into(),
            turn: None,
            config: p["config_version"]
                .as_u64()
                .ok_or("speech_config_snapshot")?,
            generation: 1,
            version: 1,
            state: "idle",
            backend: backend.into(),
            scenario: p["scenario"].as_str().ok_or("speech_scenario")?.into(),
            muted: false,
            attached: true,
            capturing: false,
            requires_resume: false,
            voiced: false,
            input_sequence: 0,
            transcript_revision: 0,
            final_text: None,
            responded: false,
            source: "user_fixture",
            synthesis_complete: false,
            playback_completed: false,
            cleanup_complete: true,
            discarded: 0,
            work: vec![],
            asr: Box::new(FakeAsr),
            tts: Box::new(FakeTts {
                alternate: backend == "fake-b",
            }),
        };
        s.fresh_turn();
        out.push(s.update(
            "state",
            None,
            0,
            &[],
            Some("synthetic_session_no_real_provider"),
        ));
        let snapshot = s.snapshot();
        self.entries.insert(id, s);
        Ok((snapshot, out))
    }
    pub fn command(&mut self, p: &Value) -> SpeechResult<(Value, Vec<Value>)> {
        let s = self
            .entries
            .get_mut(p["session_id"].as_str().ok_or("speech_session")?)
            .ok_or("speech_session_missing")?;
        let events = s.command(p)?;
        Ok((s.snapshot(), events))
    }
    pub fn tick(&mut self) -> Vec<Value> {
        self.entries.values_mut().flat_map(Session::tick).collect()
    }
    pub fn detach(&mut self, renderer: &str) -> Vec<Value> {
        self.entries
            .values_mut()
            .filter(|s| s.renderer == renderer && s.state != "ended")
            .flat_map(|s| {
                s.attached = false;
                s.cancel("ended")
            })
            .collect()
    }
    pub fn delete_conversation(&mut self, id: &str) -> Vec<Value> {
        self.entries
            .values_mut()
            .filter(|s| s.conversation == id && s.state != "ended")
            .flat_map(|s| {
                s.attached = false;
                s.cancel("ended")
            })
            .collect()
    }
    pub fn shutdown(&mut self) -> bool {
        for s in self.entries.values_mut() {
            s.attached = false;
            s.cancel("ended");
        }
        self.entries
            .values()
            .all(|s| s.cleanup_complete && s.work.is_empty())
    }
}
fn millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
