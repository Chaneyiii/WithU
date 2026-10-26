//! Low-burden clarification options (spec 4.9.3 step 5 and 4.9.4 row 7).
//!
//! When confidence is low, candidates conflict, or the signal is ironic or
//! ambiguous, the turn must not pick a single emotion label. The structure
//! below carries at most two easy-to-answer options plus a neutral fallback
//! (listening), so the surface layer can ask one low-burden question and
//! still do the right thing when the user does not answer.

use crate::{action_for_need, AffectHypothesis, SupportAction, UserTurnSignal, ValidationError};

/// One clarification choice the user can pick with a single short reply.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClarifyOption {
    /// Short, low-burden wording shown to the user (e.g. "听我说说").
    pub label: String,
    /// The support action chosen when the user picks this option.
    pub action: SupportAction,
}

/// A clarification offer. Never the only path: `fallback` is what happens
/// when the user ignores or declines the question.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Clarification {
    /// One low-burden question, transparent about uncertainty.
    pub question: String,
    /// At most two options (spec 4.9.4 row 7).
    pub options: Vec<ClarifyOption>,
    /// Neutral listening when the user does not choose.
    pub fallback: SupportAction,
}

impl Clarification {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.options.len() > 2 {
            return Err(ValidationError::TooManyClarifyOptions);
        }
        if self.options.is_empty() {
            return Err(ValidationError::EmptyClarification);
        }
        if self
            .options
            .iter()
            .any(|option| option.label.trim().is_empty())
        {
            return Err(ValidationError::EmptyField("clarify option label"));
        }
        Ok(())
    }
}

fn option_label(action: &SupportAction) -> String {
    match action {
        SupportAction::Listen => "听我说说".to_owned(),
        SupportAction::ReflectConfirm => "先接住我的感受".to_owned(),
        SupportAction::Accompany => "陪我待一会儿".to_owned(),
        SupportAction::SharedQuiet => "我们安静一会儿".to_owned(),
        SupportAction::Distract => "说点别的".to_owned(),
        SupportAction::Clarify => "再问问我".to_owned(),
        SupportAction::Advice => "一起想想办法".to_owned(),
        SupportAction::Transaction => "先帮我办事".to_owned(),
        SupportAction::PauseInteraction => "先到这里".to_owned(),
    }
}

/// Build the clarification for a turn that must not name a single label.
/// Options come from the top support-need candidates the user has not
/// blocked; the fallback is neutral listening. Returns `None` when the turn
/// has an explicit statement, correction, or transaction request (those
/// paths do not ask the user to disambiguate what they already said), or
/// when the hypothesis itself is not in a clarification state and no rule
/// row asks for two options.
pub fn build_clarification(
    hypothesis: &AffectHypothesis,
    user: &UserTurnSignal,
    ask_for_options: bool,
) -> Result<Option<Clarification>, ValidationError> {
    hypothesis.validate()?;
    user.validate()?;
    // Paths that already carry an explicit statement of *what the user
    // wants* never ask the user to disambiguate it. A stated *emotion* does
    // not settle the desired help (spec 4.9.4 rows 2-3), so clarification
    // may still be offered alongside it.
    if user.stated_need.is_some() || user.correction.is_some() || user.explicit_transaction_request
    {
        return Ok(None);
    }
    if !ask_for_options {
        return Ok(None);
    }
    let mut actions: Vec<SupportAction> = Vec::new();
    for candidate in &hypothesis.support_need_candidates {
        let (action, _, _) = action_for_need(&candidate.need, false);
        // Clarify as an option would be circular; blocked actions are out.
        if action == SupportAction::Clarify
            || user.blocked_actions.contains(&action)
            || actions.contains(&action)
        {
            continue;
        }
        actions.push(action);
        if actions.len() == 2 {
            break;
        }
    }
    if actions.is_empty() {
        actions.push(SupportAction::Listen);
    }
    if actions.len() == 1 && actions[0] != SupportAction::Listen {
        // Always contrast with a neutral option rather than forcing one
        // single reading.
        actions.push(SupportAction::Listen);
    }
    let options: Vec<ClarifyOption> = actions
        .into_iter()
        .map(|action| ClarifyOption {
            label: option_label(&action),
            action,
        })
        .collect();
    let question = format!(
        "我不太确定你现在更想要哪一种：{}？也可以不选，我就在这儿。",
        options
            .iter()
            .map(|option| option.label.as_str())
            .collect::<Vec<_>>()
            .join("，还是")
    );
    let clarification = Clarification {
        question,
        options,
        fallback: SupportAction::Listen,
    };
    clarification.validate()?;
    Ok(Some(clarification))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AffectCandidate, SupportNeed, SupportNeedCandidate};

    fn hypothesis(needs: &[(SupportNeed, f32)]) -> AffectHypothesis {
        AffectHypothesis {
            schema_version: crate::SCHEMA_VERSION,
            session_id: "session-1".to_owned(),
            hypothesis_id: "hyp-1".to_owned(),
            valence: -1,
            arousal: 0,
            affect_candidates: vec![AffectCandidate {
                label: crate::AffectLabel::Mixed,
                score: 0.4,
            }],
            support_need_candidates: needs
                .iter()
                .map(|(need, score)| SupportNeedCandidate {
                    need: need.clone(),
                    score: *score,
                })
                .collect(),
            confidence: 0.3,
            answer_confidence: 0.3,
            abstention: false,
            conflict: true,
            sarcasm_or_ambiguity: false,
            calibrated: false,
            evidence_refs: Vec::new(),
            model_version: "fixture".to_owned(),
            source: crate::InferenceSource::RulesFallback,
            calibration_version: None,
            degraded: true,
            degradation_reason: Some("uncalibrated_fixture_ranker".to_owned()),
            user_correction: None,
            language: "zh".to_owned(),
            input_modality: "text".to_owned(),
        }
    }

    #[test]
    fn clarification_offers_at_most_two_options_with_neutral_fallback() {
        let mixed = hypothesis(&[
            (SupportNeed::Listening, 0.4),
            (SupportNeed::Advice, 0.35),
            (SupportNeed::Companionship, 0.25),
        ]);
        let clarification = build_clarification(&mixed, &UserTurnSignal::default(), true)
            .unwrap()
            .unwrap();
        clarification.validate().unwrap();
        assert!(clarification.options.len() <= 2);
        assert_eq!(clarification.fallback, SupportAction::Listen);
        assert!(!clarification.question.is_empty());
    }

    #[test]
    fn blocked_actions_are_not_offered() {
        let mixed = hypothesis(&[(SupportNeed::Advice, 0.5), (SupportNeed::Listening, 0.4)]);
        let user = UserTurnSignal {
            blocked_actions: vec![SupportAction::Advice],
            ..UserTurnSignal::default()
        };
        let clarification = build_clarification(&mixed, &user, true).unwrap().unwrap();
        assert!(clarification
            .options
            .iter()
            .all(|option| option.action != SupportAction::Advice));
    }

    #[test]
    fn explicit_paths_never_ask_the_user_to_disambiguate() {
        let mixed = hypothesis(&[(SupportNeed::Listening, 0.5)]);
        let stated = UserTurnSignal {
            stated_need: Some(SupportNeed::Companionship),
            ..UserTurnSignal::default()
        };
        assert!(build_clarification(&mixed, &stated, true)
            .unwrap()
            .is_none());
        // A stated emotion does not settle the desired help: clarification
        // is still allowed to carry the two options.
        let emotional = UserTurnSignal {
            stated_emotion: Some(crate::AffectLabel::Sadness),
            ..UserTurnSignal::default()
        };
        assert!(build_clarification(&mixed, &emotional, true)
            .unwrap()
            .is_some());
    }
}
