//! Laya-style typed decision contract (adapter boundary, not the Laya runtime).
//!
//! This module mirrors the typed question semantics documented in the laya
//! reference repository README (`choice`, `score`, `noul` over a state in a
//! single structured pass) so a real Laya worker, or any other model that can
//! answer the same three question shapes, can be plugged in without changing
//! the [`crate::AffectHypothesis`] contract. Nothing here performs network
//! calls, loads checkpoints, or reuses laya code; only the answer semantics
//! are aligned:
//!
//! - `choice` answers carry a probability for every label, plus
//!   `confidence` (1 - normalised entropy, concentration of the distribution)
//!   and `answer_confidence` (`max(p)`, the number a gate should read).
//! - `score` answers carry an expected level over an ordered legend, the full
//!   level distribution, and the same two confidence numbers.
//! - `noul` answers carry `P(statement true)` and a symmetric
//!   `confidence` of `max(p, 1-p)`.
//! - `min_confidence` is a caller-side policy, never a built-in cutoff: a
//!   gated answer reports `passed` / `abstained` / `unevaluated` so a log can
//!   always tell whether a gate ran at all.
//!
//! Thresholds must be fitted on Withu held-out data per language, modality
//! and input length (spec B.20). This crate ships no fitted thresholds; the
//! default fixture judge is uncalibrated and may only order candidates.

use serde::{Deserialize, Serialize};

/// A single conversational input for typed decisions. The utterance is the
/// sanitized current user message; context is a bounded, already-truncated
/// recent window (spec 4.9.2 / A.5: context matters, unbounded history does
/// not enter the decision).
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct DecisionState {
    pub utterance: String,
    pub context: Vec<(String, String)>,
    pub language: String,
    pub modality: String,
}

/// One fixed question in the battery. Mirrors the laya question shapes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TypedQuestion {
    /// Closed label set; `criteria` maps label -> description and the keys
    /// are the only legal answers.
    Choice {
        question_id: String,
        instructions: String,
        criteria: Vec<(String, String)>,
    },
    /// Ordered levels; `levels[0]` is the lowest level.
    Score {
        question_id: String,
        instructions: String,
        levels: Vec<String>,
    },
    /// One proposition; the answer is `P(proposition true)`.
    Noul {
        question_id: String,
        statement: String,
    },
}

impl TypedQuestion {
    pub fn question_id(&self) -> &str {
        match self {
            Self::Choice { question_id, .. }
            | Self::Score { question_id, .. }
            | Self::Noul { question_id, .. } => question_id,
        }
    }

    pub fn kind(&self) -> QuestionKind {
        match self {
            Self::Choice { .. } => QuestionKind::Choice,
            Self::Score { .. } => QuestionKind::Score,
            Self::Noul { .. } => QuestionKind::Noul,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    Choice,
    Score,
    Noul,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChoiceAnswer {
    pub question_id: String,
    /// Chosen label (highest probability); ties break to the first listed.
    pub choice: String,
    /// Probability of every label, in criteria order.
    pub probabilities: Vec<(String, f32)>,
    /// `max(p)`. The value a confidence gate reads.
    pub answer_confidence: f32,
    /// `1 - H(p)/ln(k)`: how concentrated the distribution is. Never the
    /// gating number.
    pub confidence: f32,
    /// Present only when a caller-side gate ran.
    pub gate: Option<GateReport>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScoreAnswer {
    pub question_id: String,
    /// Expected level `sum(level * p)`, 0-based; a value between levels is
    /// normal and meaningful.
    pub score: f32,
    /// Distribution over levels in legend order.
    pub probabilities: Vec<f32>,
    /// The ordered level descriptions, echoed so the number never floats
    /// free of its rubric.
    pub legend: Vec<String>,
    pub answer_confidence: f32,
    pub confidence: f32,
    pub gate: Option<GateReport>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoulAnswer {
    pub question_id: String,
    /// `P(statement true)` in 0..=1. The raw probability is the answer; the
    /// decision threshold belongs to the caller.
    pub noul: f32,
    /// Symmetric `max(p, 1-p)`; carries no direction.
    pub confidence: f32,
    pub gate: Option<GateReport>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TypedAnswer {
    Choice(ChoiceAnswer),
    Score(ScoreAnswer),
    Noul(NoulAnswer),
}

impl TypedAnswer {
    pub fn question_id(&self) -> &str {
        match self {
            Self::Choice(answer) => &answer.question_id,
            Self::Score(answer) => &answer.question_id,
            Self::Noul(answer) => &answer.question_id,
        }
    }

    pub fn gate(&self) -> Option<&GateReport> {
        match self {
            Self::Choice(answer) => answer.gate.as_ref(),
            Self::Score(answer) => answer.gate.as_ref(),
            Self::Noul(answer) => answer.gate.as_ref(),
        }
    }

    /// The gating number for every question shape: `max(p)` of the reported
    /// answer.
    pub fn answer_confidence(&self) -> f32 {
        match self {
            Self::Choice(answer) => answer.answer_confidence,
            Self::Score(answer) => answer.answer_confidence,
            Self::Noul(answer) => answer.confidence,
        }
    }
}

/// Abstention states for a caller-side gate, following the laya README:
/// presence of the report distinguishes "a gate ran" from "no gate ran".
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AbstentionState {
    /// A gate ran and the answer cleared its threshold.
    Passed,
    /// A gate ran and `answer_confidence` fell below it.
    Abstained,
    /// No gate ran (or the confidence was unusable). A boolean cannot say
    /// this, which is why it is a tri-state.
    Unevaluated,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GateReport {
    pub state: AbstentionState,
    /// The threshold this answer's bucket was gated at.
    pub threshold: f32,
    /// True only when the gate fired.
    pub low_confidence: bool,
}

/// The full answer set for one decision pass over a question battery.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TypedAnswerSet {
    pub answers: Vec<TypedAnswer>,
}

impl TypedAnswerSet {
    pub fn get(&self, question_id: &str) -> Option<&TypedAnswer> {
        self.answers
            .iter()
            .find(|answer| answer.question_id() == question_id)
    }

    pub fn choice(&self, question_id: &str) -> Option<&ChoiceAnswer> {
        match self.get(question_id) {
            Some(TypedAnswer::Choice(answer)) => Some(answer),
            _ => None,
        }
    }

    pub fn score(&self, question_id: &str) -> Option<&ScoreAnswer> {
        match self.get(question_id) {
            Some(TypedAnswer::Score(answer)) => Some(answer),
            _ => None,
        }
    }

    pub fn noul(&self, question_id: &str) -> Option<&NoulAnswer> {
        match self.get(question_id) {
            Some(TypedAnswer::Noul(answer)) => Some(answer),
            _ => None,
        }
    }

    /// Validate internal consistency: probabilities are finite and (within
    /// tolerance) normalised, and every answer stays in its question's
    /// label/level space.
    pub fn validate_against(&self, questions: &[TypedQuestion]) -> Result<(), String> {
        for answer in &self.answers {
            let question = questions
                .iter()
                .find(|question| question.question_id() == answer.question_id())
                .ok_or_else(|| format!("answer for unknown question {}", answer.question_id()))?;
            match (answer, question) {
                (TypedAnswer::Choice(choice), TypedQuestion::Choice { criteria, .. }) => {
                    if choice.probabilities.len() != criteria.len() {
                        return Err(format!(
                            "choice {} probability count does not match criteria",
                            choice.question_id
                        ));
                    }
                    let labels: Vec<&str> =
                        criteria.iter().map(|(label, _)| label.as_str()).collect();
                    for (label, probability) in &choice.probabilities {
                        if !labels.contains(&label.as_str()) {
                            return Err(format!(
                                "choice {} reports unknown label {label}",
                                choice.question_id
                            ));
                        }
                        check_probability(&choice.question_id, *probability)?;
                    }
                    check_unit_sum(
                        &choice.question_id,
                        choice.probabilities.iter().map(|(_, p)| *p),
                    )?;
                }
                (TypedAnswer::Score(score), TypedQuestion::Score { levels, .. }) => {
                    if score.legend.len() != levels.len()
                        || score.probabilities.len() != levels.len()
                    {
                        return Err(format!(
                            "score {} legend/probability count does not match levels",
                            score.question_id
                        ));
                    }
                    for probability in &score.probabilities {
                        check_probability(&score.question_id, *probability)?;
                    }
                    check_unit_sum(&score.question_id, score.probabilities.iter().copied())?;
                }
                (TypedAnswer::Noul(noul), TypedQuestion::Noul { .. }) => {
                    check_probability(&noul.question_id, noul.noul)?;
                }
                _ => {
                    return Err(format!(
                        "answer/question kind mismatch for {}",
                        answer.question_id()
                    ));
                }
            }
        }
        Ok(())
    }
}

/// Apply a caller-side `min_confidence` policy to every answer. Answers keep
/// their raw values; the gate only annotates. Answers whose confidence is
/// not usable land in `unevaluated`, never silently in `passed`.
pub fn apply_gate(answers: &mut TypedAnswerSet, min_confidence: f32) {
    for answer in &mut answers.answers {
        let answer_confidence = answer.answer_confidence();
        let state = if !answer_confidence.is_finite() {
            AbstentionState::Unevaluated
        } else if answer_confidence < min_confidence {
            AbstentionState::Abstained
        } else {
            AbstentionState::Passed
        };
        let report = GateReport {
            low_confidence: state == AbstentionState::Abstained,
            state,
            threshold: min_confidence,
        };
        match answer {
            TypedAnswer::Choice(inner) => inner.gate = Some(report),
            TypedAnswer::Score(inner) => inner.gate = Some(report),
            TypedAnswer::Noul(inner) => inner.gate = Some(report),
        }
    }
}

/// Normalised-entropy confidence `1 - H(p)/ln(k)` for a discrete
/// distribution. A single-option distribution is fully concentrated.
pub fn entropy_confidence(probabilities: &[f32]) -> f32 {
    let count = probabilities.len();
    if count <= 1 {
        return 1.0;
    }
    let entropy: f32 = probabilities
        .iter()
        .filter(|probability| **probability > 0.0)
        .map(|probability| -probability * probability.ln())
        .sum();
    let maximum = (count as f32).ln();
    (1.0 - entropy / maximum).clamp(0.0, 1.0)
}

/// Build a `choice` answer from a label probability list in criteria order.
/// Ties break to the first listed label so results stay deterministic.
pub fn choice_answer(
    question_id: impl Into<String>,
    probabilities: Vec<(String, f32)>,
) -> ChoiceAnswer {
    let values: Vec<f32> = probabilities
        .iter()
        .map(|(_, probability)| *probability)
        .collect();
    let confidence = entropy_confidence(&values);
    let choice = probabilities
        .iter()
        .max_by(|left, right| {
            left.1
                .partial_cmp(&right.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(label, _)| label.clone())
        .unwrap_or_default();
    let answer_confidence = values.iter().copied().fold(0.0f32, f32::max);
    ChoiceAnswer {
        question_id: question_id.into(),
        choice,
        probabilities,
        answer_confidence,
        confidence,
        gate: None,
    }
}

/// Build a `score` answer from a level distribution in legend order.
pub fn score_answer(
    question_id: impl Into<String>,
    legend: Vec<String>,
    probabilities: Vec<f32>,
) -> ScoreAnswer {
    let score: f32 = probabilities
        .iter()
        .enumerate()
        .map(|(level, probability)| level as f32 * probability)
        .sum();
    let confidence = entropy_confidence(&probabilities);
    let answer_confidence = probabilities.iter().copied().fold(0.0f32, f32::max);
    ScoreAnswer {
        question_id: question_id.into(),
        score,
        probabilities,
        legend,
        answer_confidence,
        confidence,
        gate: None,
    }
}

/// Build a `noul` answer from `P(statement true)`.
pub fn noul_answer(question_id: impl Into<String>, probability: f32) -> NoulAnswer {
    NoulAnswer {
        question_id: question_id.into(),
        noul: probability.clamp(0.0, 1.0),
        confidence: probability.max(1.0 - probability),
        gate: None,
    }
}

fn check_probability(question_id: &str, value: f32) -> Result<(), String> {
    if !(0.0..=1.0).contains(&value) || !value.is_finite() {
        return Err(format!("question {question_id} has an invalid probability"));
    }
    Ok(())
}

fn check_unit_sum(question_id: &str, values: impl Iterator<Item = f32>) -> Result<(), String> {
    let total: f32 = values.sum();
    if !(0.98..=1.02).contains(&total) {
        return Err(format!(
            "question {question_id} probabilities sum to {total}, not 1"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entropy_confidence_distinguishes_concentrated_and_uniform() {
        let concentrated = entropy_confidence(&[0.95, 0.03, 0.02]);
        let uniform = entropy_confidence(&[1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0]);
        // Normalised entropy of [0.95, 0.03, 0.02] is ~0.79: concentrated,
        // but a 3-way distribution can never approach 1.0.
        assert!(concentrated > 0.75);
        assert!(uniform < 0.01);
        assert_eq!(entropy_confidence(&[1.0]), 1.0);
    }

    #[test]
    fn choice_answer_reports_max_probability_as_answer_confidence() {
        let answer = choice_answer(
            "affect_label",
            vec![
                ("sadness".to_owned(), 0.7),
                ("joy".to_owned(), 0.2),
                ("unclear".to_owned(), 0.1),
            ],
        );
        assert_eq!(answer.choice, "sadness");
        assert!((answer.answer_confidence - 0.7).abs() < 1e-6);
        assert!(answer.confidence > 0.0 && answer.confidence < 1.0);
    }

    #[test]
    fn score_answer_reports_expected_level_over_legend() {
        let answer = score_answer(
            "valence",
            vec![
                "very_negative".to_owned(),
                "negative".to_owned(),
                "neutral".to_owned(),
                "positive".to_owned(),
                "very_positive".to_owned(),
            ],
            vec![0.0, 0.6, 0.3, 0.1, 0.0],
        );
        assert!((answer.score - 1.5).abs() < 1e-6);
        assert!((answer.answer_confidence - 0.6).abs() < 1e-6);
    }

    #[test]
    fn noul_confidence_is_symmetric() {
        let low = noul_answer("stop_requested", 0.1);
        let high = noul_answer("stop_requested", 0.9);
        assert!((low.confidence - high.confidence).abs() < 1e-6);
        assert!((low.noul - 0.1).abs() < 1e-6);
    }

    #[test]
    fn gate_reports_three_states_and_keeps_raw_answers() {
        let mut answers = TypedAnswerSet {
            answers: vec![
                TypedAnswer::Choice(choice_answer(
                    "q_high",
                    vec![("a".to_owned(), 0.9), ("b".to_owned(), 0.1)],
                )),
                TypedAnswer::Choice(choice_answer(
                    "q_low",
                    vec![("a".to_owned(), 0.5), ("b".to_owned(), 0.5)],
                )),
                TypedAnswer::Noul(noul_answer("q_nan", f32::NAN)),
            ],
        };
        apply_gate(&mut answers, 0.8);
        let high = answers.choice("q_high").unwrap();
        assert_eq!(high.gate.as_ref().unwrap().state, AbstentionState::Passed);
        assert!(!high.gate.as_ref().unwrap().low_confidence);
        let low = answers.choice("q_low").unwrap();
        assert_eq!(low.gate.as_ref().unwrap().state, AbstentionState::Abstained);
        assert!(low.gate.as_ref().unwrap().low_confidence);
        // Raw values are untouched by the gate.
        assert!((low.probabilities[0].1 - 0.5).abs() < 1e-6);
        let unusable = answers.noul("q_nan").unwrap();
        assert_eq!(
            unusable.gate.as_ref().unwrap().state,
            AbstentionState::Unevaluated
        );
    }

    #[test]
    fn validation_rejects_unknown_labels_and_bad_sums() {
        let questions = vec![TypedQuestion::Choice {
            question_id: "affect_label".to_owned(),
            instructions: "current affect".to_owned(),
            criteria: vec![
                ("sadness".to_owned(), "down".to_owned()),
                ("joy".to_owned(), "up".to_owned()),
            ],
        }];
        let good = TypedAnswerSet {
            answers: vec![TypedAnswer::Choice(choice_answer(
                "affect_label",
                vec![("sadness".to_owned(), 0.6), ("joy".to_owned(), 0.4)],
            ))],
        };
        assert!(good.validate_against(&questions).is_ok());
        let bad = TypedAnswerSet {
            answers: vec![TypedAnswer::Choice(choice_answer(
                "affect_label",
                vec![("anger".to_owned(), 1.0), ("joy".to_owned(), 0.0)],
            ))],
        };
        assert!(bad.validate_against(&questions).is_err());
    }
}
