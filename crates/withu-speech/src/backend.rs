use std::time::{Duration, Instant};

pub const SAMPLE_RATE: u32 = 16_000;
pub const TTS_FRAME_SAMPLES: usize = 3_200;
pub struct BackendEvent {
    pub due: Instant,
    pub generation: u64,
    pub turn_id: String,
    pub kind: &'static str,
    pub text: Option<String>,
    pub revision: u64,
    pub frame_sequence: u64,
    pub samples: Vec<i16>,
}
pub trait AsrBackend: Send {
    fn finish(&mut self, generation: u64, turn: &str, scenario: &str) -> Vec<BackendEvent>;
}
pub trait TtsBackend: Send {
    fn synthesize(&mut self, generation: u64, turn: &str) -> Vec<BackendEvent>;
    fn render(&self, frame_sequence: u64) -> Vec<i16>;
}
pub struct FakeAsr;
pub struct FakeTts {
    pub alternate: bool,
}
impl AsrBackend for FakeAsr {
    fn finish(&mut self, generation: u64, turn: &str, scenario: &str) -> Vec<BackendEvent> {
        let mut out = vec![];
        let delayed = if scenario == "delayed" { 500 } else { 0 };
        for (ms, kind, text, revision) in [
            (40, "partial", Some("合成测试：今天去公…"), 1),
            (100, "partial", Some("合成测试：今天去公园走走"), 2),
            (180, "final", Some("合成测试：今天去公园走走。"), 3),
            (260, "provider_complete", None, 3),
        ] {
            out.push(event(
                ms + delayed,
                generation,
                turn,
                kind,
                (text, revision, 0, vec![]),
            ));
        }
        if scenario == "late" {
            out.push(event(
                80,
                generation.saturating_sub(1),
                turn,
                "final",
                (Some("obsolete synthetic final"), 99, 0, vec![]),
            ));
        }
        if scenario == "duplicate_final" {
            out.push(event(
                220,
                generation,
                turn,
                "final",
                (Some("合成测试：今天去公园走走。"), 3, 0, vec![]),
            ));
        }
        out
    }
}
impl TtsBackend for FakeTts {
    fn synthesize(&mut self, generation: u64, turn: &str) -> Vec<BackendEvent> {
        let mut out = vec![];
        // Hold work descriptors, not precomputed PCM. Cancellation prevents future rendering.
        for index in 0..10 {
            out.push(event(
                30 + index * 90,
                generation,
                turn,
                "audio",
                (None, 0, index + 1, vec![]),
            ));
        }
        out.push(event(
            950,
            generation,
            turn,
            "synthesis_complete",
            (None, 0, 10, vec![]),
        ));
        out
    }
    fn render(&self, frame_sequence: u64) -> Vec<i16> {
        let frequency = if self.alternate { 330.0 } else { 440.0 };
        let index = frame_sequence.saturating_sub(1) as usize;
        (0..TTS_FRAME_SAMPLES)
            .map(|n| {
                let global = index * TTS_FRAME_SAMPLES + n;
                let envelope =
                    (n as f32 / 160.0).min(1.0) * ((TTS_FRAME_SAMPLES - n) as f32 / 160.0).min(1.0);
                ((global as f32 * frequency * std::f32::consts::TAU / SAMPLE_RATE as f32).sin()
                    * 1800.0
                    * envelope) as i16
            })
            .collect()
    }
}

fn event(
    ms: u64,
    generation: u64,
    turn: &str,
    kind: &'static str,
    payload: (Option<&str>, u64, u64, Vec<i16>),
) -> BackendEvent {
    let (text, revision, frame_sequence, samples) = payload;
    BackendEvent {
        due: Instant::now() + Duration::from_millis(ms),
        generation,
        turn_id: turn.into(),
        kind,
        text: text.map(str::to_owned),
        revision,
        frame_sequence,
        samples,
    }
}
