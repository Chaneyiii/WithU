pub use withu_runtime::SpeechState;
pub const REQUIRED_STATES: &[SpeechState] = &[
    SpeechState::Idle,
    SpeechState::Listening,
    SpeechState::Thinking,
    SpeechState::Speaking,
    SpeechState::Interrupted,
    SpeechState::Reconnecting,
    SpeechState::Degraded,
    SpeechState::Ended,
];
pub struct SpeechSession {
    pub state: SpeechState,
    pub synthesis_cancelled: bool,
    pub playback_cancelled: bool,
    pub audio_queue: Vec<u8>,
}
impl SpeechSession {
    pub fn interrupt(&mut self) {
        if self.state == SpeechState::Ended {
            return;
        }
        self.synthesis_cancelled = true;
        self.playback_cancelled = true;
        self.audio_queue.clear();
        self.state = SpeechState::Interrupted;
    }
    pub fn end(&mut self) {
        self.interrupt();
        self.state = SpeechState::Ended;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn barge_in_cancels_synthesis_playback_and_queue() {
        let mut s = SpeechSession {
            state: SpeechState::Speaking,
            synthesis_cancelled: false,
            playback_cancelled: false,
            audio_queue: vec![1, 2],
        };
        s.interrupt();
        s.interrupt();
        assert!(s.synthesis_cancelled && s.playback_cancelled && s.audio_queue.is_empty());
        s.end();
        s.interrupt();
        assert_eq!(s.state, SpeechState::Ended);
    }
}
pub mod backend;
pub mod session;
