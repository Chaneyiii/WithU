//! Current-session response outcome log (spec 4.9.3 step 10).
//!
//! Every relationship turn is closed with a [`ResponseOutcome`]:
//! improved / unchanged / misread / unknown. This log keeps those outcomes
//! for the current session only. It is an in-memory correction signal for
//! the next turn; it never persists, never feeds long-term memory, and never
//! turns an inference into a fact about the user.

use crate::{Outcome, ResponseOutcome, SupportAction, UserCorrectionRecord, ValidationError};

/// Session-scoped bound. Outcomes are per-session corrections; anything
/// longer-lived belongs to explicit, user-authorized memory instead.
pub const MAX_FEEDBACK_ENTRIES: usize = 64;

#[derive(Clone, Debug, Default)]
pub struct TurnFeedbackLog {
    session_id: String,
    entries: Vec<ResponseOutcome>,
}

/// What the next turn should learn from the most recent outcomes.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct FeedbackGuidance {
    /// Outcome of the most recent closed turn, if any.
    pub last_outcome: Option<Outcome>,
    /// A misread turn is followed by apology + correction first (spec
    /// 4.9.3 step 10), without repeated follow-up questions.
    pub open_with_apology: bool,
    /// Actions to avoid in the next turn because the user just corrected
    /// them (e.g. unwanted advice). Session-scoped demotion only.
    pub avoid_actions: Vec<SupportAction>,
    /// Explicit boundaries the user stated in corrections this session.
    pub active_boundaries: Vec<String>,
}

impl TurnFeedbackLog {
    pub fn new(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            entries: Vec::new(),
        }
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Record a closed turn. Each turn may be closed exactly once.
    pub fn record(&mut self, outcome: ResponseOutcome) -> Result<(), ValidationError> {
        outcome.validate()?;
        if self
            .entries
            .iter()
            .any(|entry| entry.turn_id == outcome.turn_id)
        {
            return Err(ValidationError::DuplicateFeedbackTurn);
        }
        self.entries.push(outcome);
        if self.entries.len() > MAX_FEEDBACK_ENTRIES {
            self.entries.remove(0);
        }
        Ok(())
    }

    pub fn last(&self) -> Option<&ResponseOutcome> {
        self.entries.last()
    }

    /// Read API for the next turn: what the session has learned so far.
    pub fn guidance(&self) -> FeedbackGuidance {
        let Some(last) = self.last() else {
            return FeedbackGuidance::default();
        };
        let mut avoid_actions = Vec::new();
        let mut active_boundaries = Vec::new();
        // Session-scope: only the corrections recorded in this session
        // demote actions; older corrections arrive through explicit
        // relationship state, not this log.
        for entry in &self.entries {
            if let Some(correction) = &entry.user_correction {
                if let Some(boundary) = &correction.boundary {
                    if !active_boundaries.contains(boundary) {
                        active_boundaries.push(boundary.clone());
                    }
                }
            }
            // An unwanted action that ended in misread is demoted for the
            // rest of the session.
            if entry.outcome == Outcome::Misread
                && matches!(
                    entry.action,
                    SupportAction::Advice | SupportAction::Distract
                )
                && !avoid_actions.contains(&entry.action)
            {
                avoid_actions.push(entry.action.clone());
            }
        }
        FeedbackGuidance {
            last_outcome: Some(last.outcome.clone()),
            open_with_apology: last.outcome == Outcome::Misread,
            avoid_actions,
            active_boundaries,
        }
    }

    /// All corrections recorded this session, oldest first.
    pub fn corrections(&self) -> impl Iterator<Item = &UserCorrectionRecord> {
        self.entries
            .iter()
            .filter_map(|entry| entry.user_correction.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(turn_id: &str, outcome: Outcome) -> ResponseOutcome {
        ResponseOutcome {
            schema_version: crate::SCHEMA_VERSION,
            turn_id: turn_id.to_owned(),
            action: SupportAction::ReflectConfirm,
            user_feedback: None,
            next_turn_signal: None,
            outcome,
            user_correction: None,
        }
    }

    #[test]
    fn records_and_reads_outcomes_for_the_current_session() {
        let mut log = TurnFeedbackLog::new("session-1");
        assert!(log.is_empty());
        log.record(outcome("turn-1", Outcome::Improved)).unwrap();
        log.record(outcome("turn-2", Outcome::Unknown)).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log.session_id(), "session-1");
        assert_eq!(log.guidance().last_outcome, Some(Outcome::Unknown));
        assert!(!log.guidance().open_with_apology);
    }

    #[test]
    fn duplicate_turn_close_is_rejected() {
        let mut log = TurnFeedbackLog::new("session-1");
        log.record(outcome("turn-1", Outcome::Improved)).unwrap();
        assert_eq!(
            log.record(outcome("turn-1", Outcome::Unchanged)),
            Err(ValidationError::DuplicateFeedbackTurn)
        );
    }

    #[test]
    fn misread_opens_the_next_turn_with_an_apology_and_avoids_repeated_actions() {
        let mut log = TurnFeedbackLog::new("session-1");
        let mut misread = outcome("turn-1", Outcome::Misread);
        misread.action = SupportAction::Advice;
        misread.user_correction = Some(UserCorrectionRecord {
            turn_id: "turn-1".to_owned(),
            corrected_emotion: None,
            corrected_need: Some(crate::SupportNeed::Listening),
            boundary: Some("no advice".to_owned()),
            recorded_at: "2026-10-25T00:00:00Z".to_owned(),
        });
        log.record(misread).unwrap();
        let guidance = log.guidance();
        assert!(guidance.open_with_apology);
        assert!(guidance.avoid_actions.contains(&SupportAction::Advice));
        assert_eq!(guidance.active_boundaries, vec!["no advice".to_owned()]);
        assert_eq!(log.corrections().count(), 1);
    }

    #[test]
    fn log_is_bounded_and_session_scoped() {
        let mut log = TurnFeedbackLog::new("session-1");
        for index in 0..(MAX_FEEDBACK_ENTRIES + 10) {
            log.record(outcome(&format!("turn-{index}"), Outcome::Unchanged))
                .unwrap();
        }
        assert_eq!(log.len(), MAX_FEEDBACK_ENTRIES);
    }
}
