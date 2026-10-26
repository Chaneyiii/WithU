//! Replaceable candidate judges for the typed affect battery.
//!
//! The battery is the fixed set of questions Withu asks every turn (spec
//! 4.9.2). Two judge implementations exist behind the same boundary:
//!
//! - [`FixtureJudge`]: a deterministic lexicon/rule judge, shipped for
//!   fixture replay and offline development. It is explicitly **uncalibrated
//!   and marked degraded**; per spec B.20 it may only *order* candidates,
//!   never select a response on its own.
//! - [`LayaWorkerJudge`]: the reserved adapter slot for a real local Laya
//!   worker (or an equivalent structured-output model) implementing
//!   [`TypedDecisionWorker`]. No network or runtime is included here.
//!
//! Both judges produce an [`AffectJudgment`]: an [`crate::AffectHypothesis`]
//! that conforms to the frozen `affect-hypothesis` contract, plus the raw
//! typed answers and the `noul` flags the contract does not carry (reported
//! to the coordinator as a suggested contract addition).

use crate::typed::{
    self, ChoiceAnswer, DecisionState, NoulAnswer, ScoreAnswer, TypedAnswer, TypedAnswerSet,
    TypedQuestion,
};
use crate::{
    AffectCandidate, AffectHypothesis, AffectInference, AffectLabel, InferenceError,
    InferenceRequest, InferenceSource, SupportNeed, SupportNeedCandidate, SCHEMA_VERSION,
};

/// Question ids of the fixed battery.
pub const Q_AFFECT_LABEL: &str = "affect_label";
pub const Q_VALENCE: &str = "valence";
pub const Q_AROUSAL: &str = "arousal";
pub const Q_SUPPORT_NEED: &str = "support_need";
pub const Q_NOUL_EXPLICIT_NEED: &str = "noul_explicit_need_stated";
pub const Q_NOUL_ADVICE_REJECTED: &str = "noul_advice_rejected";
pub const Q_NOUL_STOP_REQUESTED: &str = "noul_stop_requested";

/// Only an `answer_confidence` that passed Withu held-out calibration may
/// trigger an automatic strategy (spec B.20 integration contract 3). Below
/// this threshold the flags may only demote, never promote.
pub const NOUL_ACT_THRESHOLD: f32 = 0.75;
/// Uncalibrated hints may still make the response *less* intrusive; they can
/// never make it more so.
pub const NOUL_HINT_THRESHOLD: f32 = 0.50;

/// The fixed question battery Withu asks each turn (spec 4.9.2). Descriptions
/// are bilingual because the judge lexicon is bilingual.
pub fn affect_question_battery() -> Vec<TypedQuestion> {
    vec![
        TypedQuestion::Choice {
            question_id: Q_AFFECT_LABEL.to_owned(),
            instructions: "当前话语的主要情绪候选是哪一种？（可多候选并存）".to_owned(),
            criteria: vec![
                ("sadness".to_owned(), "悲伤/失落 sadness or loss".to_owned()),
                (
                    "anxiety".to_owned(),
                    "焦虑/担忧 anxiety or worry".to_owned(),
                ),
                (
                    "anger".to_owned(),
                    "愤怒/受挫 anger or frustration".to_owned(),
                ),
                (
                    "shame".to_owned(),
                    "羞愧/自责 shame or self-blame".to_owned(),
                ),
                (
                    "loneliness".to_owned(),
                    "孤独/想被陪伴 loneliness, wanting company".to_owned(),
                ),
                (
                    "joy".to_owned(),
                    "轻松/喜悦 joy, relief, lightness".to_owned(),
                ),
                (
                    "tired".to_owned(),
                    "疲惫/耗竭 tiredness, exhaustion".to_owned(),
                ),
                ("mixed".to_owned(), "混合多种情绪 mixed signals".to_owned()),
                (
                    "unclear".to_owned(),
                    "不清楚 unclear or not enough signal".to_owned(),
                ),
            ],
        },
        TypedQuestion::Score {
            question_id: Q_VALENCE.to_owned(),
            instructions: "当前体验的正负方向（序数，非临床量表）".to_owned(),
            levels: vec![
                "很消极 very negative".to_owned(),
                "消极 negative".to_owned(),
                "中性 neutral".to_owned(),
                "积极 positive".to_owned(),
                "很积极 very positive".to_owned(),
            ],
        },
        TypedQuestion::Score {
            question_id: Q_AROUSAL.to_owned(),
            instructions: "当前激活程度（序数，非临床量表）".to_owned(),
            levels: vec![
                "很低 very low".to_owned(),
                "低 low".to_owned(),
                "中等 medium".to_owned(),
                "高 high".to_owned(),
                "很高 very high".to_owned(),
            ],
        },
        TypedQuestion::Choice {
            question_id: Q_SUPPORT_NEED.to_owned(),
            instructions: "用户此刻可能需要哪种支持？".to_owned(),
            criteria: vec![
                ("listening".to_owned(), "倾听 being heard".to_owned()),
                (
                    "emotional_confirmation".to_owned(),
                    "情绪确认 having the feeling acknowledged".to_owned(),
                ),
                (
                    "companionship".to_owned(),
                    "安慰陪伴 comfort and company".to_owned(),
                ),
                (
                    "shared_quiet".to_owned(),
                    "共同安静 quiet presence".to_owned(),
                ),
                (
                    "distraction".to_owned(),
                    "分散注意 a change of focus".to_owned(),
                ),
                ("advice".to_owned(), "建议 suggestions or ideas".to_owned()),
                (
                    "transaction_help".to_owned(),
                    "现实事务帮助 concrete practical help".to_owned(),
                ),
                (
                    "pause_interaction".to_owned(),
                    "暂时停止互动 pausing the interaction".to_owned(),
                ),
            ],
        },
        TypedQuestion::Noul {
            question_id: Q_NOUL_EXPLICIT_NEED.to_owned(),
            statement: "用户在当前话语中明确提出某个需要或请求".to_owned(),
        },
        TypedQuestion::Noul {
            question_id: Q_NOUL_ADVICE_REJECTED.to_owned(),
            statement: "用户明确表示不要建议或不要解决方案".to_owned(),
        },
        TypedQuestion::Noul {
            question_id: Q_NOUL_STOP_REQUESTED.to_owned(),
            statement: "用户要求暂停、停止或结束当前互动".to_owned(),
        },
    ]
}

/// A worker that can answer typed questions over a decision state. This is
/// the seam where a real Laya worker (local HTTP/ONNX process) or an LLM
/// structured-output adapter plugs in. Implementations must be deterministic
/// per input for replay, must not perform uploads, and must answer only from
/// the provided state.
pub trait TypedDecisionWorker {
    fn answer(
        &self,
        state: &DecisionState,
        questions: &[TypedQuestion],
    ) -> Result<TypedAnswerSet, InferenceError>;
}

/// Bilingual marker lexicons. Terms match by substring on a case-folded
/// utterance; each term contributes one hit per occurrence.
struct Lexicon {
    labels: &'static [(&'static str, AffectLabel)],
    needs: &'static [(&'static str, SupportNeed)],
    arousal_high: &'static [&'static str],
    arousal_low: &'static [&'static str],
    positive: &'static [&'static str],
    explicit_need: &'static [&'static str],
    advice_rejected: &'static [&'static str],
    stop_requested: &'static [&'static str],
    negators: &'static [&'static str],
}

static LEXICON: Lexicon = Lexicon {
    labels: &[
        ("难过", AffectLabel::Sadness),
        ("伤心", AffectLabel::Sadness),
        ("失落", AffectLabel::Sadness),
        ("低落", AffectLabel::Sadness),
        ("想哭", AffectLabel::Sadness),
        ("心情不好", AffectLabel::Sadness),
        ("sad", AffectLabel::Sadness),
        ("down", AffectLabel::Sadness),
        ("焦虑", AffectLabel::Anxiety),
        ("担心", AffectLabel::Anxiety),
        ("害怕", AffectLabel::Anxiety),
        ("心慌", AffectLabel::Anxiety),
        ("紧张", AffectLabel::Anxiety),
        ("睡不着", AffectLabel::Anxiety),
        ("anxious", AffectLabel::Anxiety),
        ("worried", AffectLabel::Anxiety),
        ("nervous", AffectLabel::Anxiety),
        ("panic", AffectLabel::Anxiety),
        ("生气", AffectLabel::Anger),
        ("气死", AffectLabel::Anger),
        ("愤怒", AffectLabel::Anger),
        ("火大", AffectLabel::Anger),
        ("烦死", AffectLabel::Anger),
        ("受不了", AffectLabel::Anger),
        ("离谱", AffectLabel::Anger),
        ("angry", AffectLabel::Anger),
        ("furious", AffectLabel::Anger),
        ("frustrated", AffectLabel::Anger),
        ("自责", AffectLabel::Shame),
        ("愧疚", AffectLabel::Shame),
        ("都怪我", AffectLabel::Shame),
        ("没脸", AffectLabel::Shame),
        ("后悔", AffectLabel::Shame),
        ("我真没用", AffectLabel::Shame),
        ("guilty", AffectLabel::Shame),
        ("my fault", AffectLabel::Shame),
        ("ashamed", AffectLabel::Shame),
        ("孤独", AffectLabel::Loneliness),
        ("一个人", AffectLabel::Loneliness),
        ("没人陪", AffectLabel::Loneliness),
        ("好想有人", AffectLabel::Loneliness),
        ("lonely", AffectLabel::Loneliness),
        ("alone", AffectLabel::Loneliness),
        ("开心", AffectLabel::Joy),
        ("高兴", AffectLabel::Joy),
        ("太好了", AffectLabel::Joy),
        ("松了口气", AffectLabel::Joy),
        ("如释重负", AffectLabel::Joy),
        ("happy", AffectLabel::Joy),
        ("relieved", AffectLabel::Joy),
        ("excited", AffectLabel::Joy),
        ("累", AffectLabel::Tired),
        ("疲惫", AffectLabel::Tired),
        ("没力气", AffectLabel::Tired),
        ("没劲", AffectLabel::Tired),
        ("exhausted", AffectLabel::Tired),
        ("tired", AffectLabel::Tired),
    ],
    needs: &[
        ("听我说", SupportNeed::Listening),
        ("想说说", SupportNeed::Listening),
        ("倾诉", SupportNeed::Listening),
        ("陪陪我", SupportNeed::Companionship),
        ("陪着我", SupportNeed::Companionship),
        ("陪我", SupportNeed::Companionship),
        ("你在吗", SupportNeed::Companionship),
        ("你在就好", SupportNeed::Companionship),
        ("安静", SupportNeed::SharedQuiet),
        ("别说话", SupportNeed::SharedQuiet),
        ("就这样待着", SupportNeed::SharedQuiet),
        ("说点别的", SupportNeed::Distraction),
        ("聊点开心的", SupportNeed::Distraction),
        ("分散", SupportNeed::Distraction),
        ("怎么办", SupportNeed::Advice),
        ("该怎么", SupportNeed::Advice),
        ("建议", SupportNeed::Advice),
        ("你说我该", SupportNeed::Advice),
        ("what should", SupportNeed::Advice),
        ("advice", SupportNeed::Advice),
        ("帮我", SupportNeed::TransactionHelp),
        ("提醒我", SupportNeed::TransactionHelp),
        ("查一下", SupportNeed::TransactionHelp),
        ("安排", SupportNeed::TransactionHelp),
        ("帮我看看", SupportNeed::TransactionHelp),
        ("订", SupportNeed::TransactionHelp),
        ("帮我记", SupportNeed::TransactionHelp),
        ("先这样", SupportNeed::PauseInteraction),
        ("到这吧", SupportNeed::PauseInteraction),
        ("今天就到这", SupportNeed::PauseInteraction),
        ("别说了", SupportNeed::PauseInteraction),
        ("算了", SupportNeed::PauseInteraction),
        ("停", SupportNeed::PauseInteraction),
    ],
    arousal_high: &[
        "气死",
        "烦死",
        "心慌",
        "受不了",
        "着急",
        "马上",
        "panic",
        "urgent",
        "furious",
    ],
    arousal_low: &["没力气", "累", "低落", "没劲", "exhausted", "drained"],
    positive: &[
        "开心",
        "高兴",
        "太好了",
        "松了口气",
        "如释重负",
        "不错",
        "成功",
        "棒",
        "happy",
        "relieved",
        "great",
    ],
    explicit_need: &[
        "帮我",
        "给我",
        "我要",
        "我想请你",
        "能不能",
        "可以帮",
        "提醒我",
        "查一下",
        "帮我看看",
        "帮我记",
        "安排",
        "please",
        "can you",
        "could you",
    ],
    advice_rejected: &[
        "别给建议",
        "不要建议",
        "不想听建议",
        "别说怎么办",
        "别教我",
        "不用建议",
        "no advice",
        "stop suggesting",
        "don't advise",
    ],
    stop_requested: &[
        "先这样",
        "到这吧",
        "今天就到这",
        "别说了",
        "暂停",
        "停一下",
        "stop",
        "pause",
        "not now",
    ],
    negators: &["不", "没", "别", "无", "非", "not ", "n't"],
};

const SMOOTHING: f32 = 0.01;
/// Top-two probability margin below which candidates count as conflicting.
const CONFLICT_MARGIN: f32 = 0.15;

/// Deterministic, uncalibrated fixture judge. Rule/lexicon driven; the
/// hypothesis it produces is always marked degraded with the reason below,
/// so downstream code can only use it to rank candidates (spec B.20:
/// "没有通过校准前，只能把 Laya 当候选排序器").
#[derive(Clone, Debug)]
pub struct FixtureJudge {
    battery: Vec<TypedQuestion>,
}

impl Default for FixtureJudge {
    fn default() -> Self {
        Self {
            battery: affect_question_battery(),
        }
    }
}

impl FixtureJudge {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn battery(&self) -> &[TypedQuestion] {
        &self.battery
    }

    /// Judge a turn and assemble the contract-level hypothesis. Falls back
    /// to a fully abstaining judgment when there is no usable signal.
    pub fn judge(&self, request: &InferenceRequest) -> Result<AffectJudgment, InferenceError> {
        let state = decision_state_from_request(request);
        if request.user_signal.correction.is_some() {
            // A correction supersedes model inference entirely this turn.
            return self.abstaining_judgment(request, "user_correction_supersedes_inference");
        }
        let answers = self.answer(&state, &self.battery)?;
        assemble_judgment(request, answers, &Provenance::fixture())
    }

    fn abstaining_judgment(
        &self,
        request: &InferenceRequest,
        reason: &str,
    ) -> Result<AffectJudgment, InferenceError> {
        let mut answers = TypedAnswerSet::default();
        for question in &self.battery {
            match question {
                TypedQuestion::Choice {
                    question_id,
                    criteria,
                    ..
                } => {
                    let probabilities = criteria
                        .iter()
                        .map(|(label, _)| (label.clone(), 1.0 / criteria.len() as f32))
                        .collect();
                    answers
                        .answers
                        .push(TypedAnswer::Choice(typed::choice_answer(
                            question_id.clone(),
                            probabilities,
                        )));
                }
                TypedQuestion::Score {
                    question_id,
                    levels,
                    ..
                } => {
                    let probabilities = vec![1.0 / levels.len() as f32; levels.len()];
                    answers.answers.push(TypedAnswer::Score(typed::score_answer(
                        question_id.clone(),
                        levels.clone(),
                        probabilities,
                    )));
                }
                TypedQuestion::Noul { question_id, .. } => {
                    answers.answers.push(TypedAnswer::Noul(typed::noul_answer(
                        question_id.clone(),
                        0.5,
                    )));
                }
            }
        }
        let mut judgment = assemble_judgment(request, answers, &Provenance::fixture())?;
        judgment.hypothesis.abstention = true;
        judgment.hypothesis.confidence = 0.0;
        judgment.hypothesis.answer_confidence = 0.0;
        judgment.hypothesis.user_correction = request.user_signal.correction.clone();
        judgment.hypothesis.degradation_reason = Some(format!("fixture_judge:{reason}"));
        judgment
            .hypothesis
            .validate()
            .map_err(InferenceError::InvalidHypothesis)?;
        Ok(judgment)
    }
}

impl TypedDecisionWorker for FixtureJudge {
    fn answer(
        &self,
        state: &DecisionState,
        questions: &[TypedQuestion],
    ) -> Result<TypedAnswerSet, InferenceError> {
        if state.utterance.trim().is_empty() && state.context.is_empty() {
            return Err(InferenceError::Unavailable {
                source: InferenceSource::RulesFallback,
                reason: "no_utterance_or_context".to_owned(),
            });
        }
        let folded = fold(&state.utterance);
        let context_hits: Vec<(AffectLabel, u32)> = state
            .context
            .iter()
            .flat_map(|(_, text)| label_hits(&fold(text)))
            .collect();
        let mut answers = TypedAnswerSet::default();
        for question in questions {
            match question {
                TypedQuestion::Choice {
                    question_id,
                    criteria,
                    ..
                } if question_id == Q_AFFECT_LABEL => {
                    answers
                        .answers
                        .push(TypedAnswer::Choice(affect_label_answer(
                            question_id,
                            criteria,
                            &folded,
                            &context_hits,
                        )));
                }
                TypedQuestion::Choice {
                    question_id,
                    criteria,
                    ..
                } if question_id == Q_SUPPORT_NEED => {
                    answers
                        .answers
                        .push(TypedAnswer::Choice(support_need_answer(
                            question_id,
                            criteria,
                            &folded,
                        )));
                }
                TypedQuestion::Score {
                    question_id,
                    levels,
                    ..
                } if question_id == Q_VALENCE => {
                    answers.answers.push(TypedAnswer::Score(valence_answer(
                        question_id,
                        levels,
                        &folded,
                    )));
                }
                TypedQuestion::Score {
                    question_id,
                    levels,
                    ..
                } if question_id == Q_AROUSAL => {
                    answers.answers.push(TypedAnswer::Score(arousal_answer(
                        question_id,
                        levels,
                        &folded,
                    )));
                }
                TypedQuestion::Noul { question_id, .. } => {
                    let probability = match question_id.as_str() {
                        Q_NOUL_EXPLICIT_NEED => marker_probability(&folded, LEXICON.explicit_need),
                        Q_NOUL_ADVICE_REJECTED => {
                            marker_probability(&folded, LEXICON.advice_rejected)
                        }
                        Q_NOUL_STOP_REQUESTED => {
                            marker_probability(&folded, LEXICON.stop_requested)
                        }
                        other => {
                            return Err(InferenceError::Unavailable {
                                source: InferenceSource::RulesFallback,
                                reason: format!("fixture_judge_cannot_answer:{other}"),
                            });
                        }
                    };
                    answers.answers.push(TypedAnswer::Noul(typed::noul_answer(
                        question_id.clone(),
                        probability,
                    )));
                }
                other => {
                    return Err(InferenceError::Unavailable {
                        source: InferenceSource::RulesFallback,
                        reason: format!("fixture_judge_cannot_answer:{}", other.question_id()),
                    });
                }
            }
        }
        Ok(answers)
    }
}

impl AffectInference for FixtureJudge {
    fn infer(&self, request: &InferenceRequest) -> Result<AffectHypothesis, InferenceError> {
        self.judge(request).map(|judgment| judgment.hypothesis)
    }
}

/// Reserved adapter slot for a real local Laya worker / LLM structured
/// output adapter. Wire a [`TypedDecisionWorker`] implementation; this
/// wrapper keeps provenance honest (it never claims a checkpoint it does not
/// have, and never claims calibration without a calibration version).
#[derive(Clone, Debug)]
pub struct LayaWorkerJudge<W> {
    worker: W,
    battery: Vec<TypedQuestion>,
    provenance: Provenance,
}

impl<W: TypedDecisionWorker> LayaWorkerJudge<W> {
    /// Uncalibrated local worker: answers may only rank candidates.
    pub fn uncalibrated(worker: W, checkpoint: impl Into<String>) -> Self {
        Self {
            worker,
            battery: affect_question_battery(),
            provenance: Provenance {
                source: InferenceSource::LocalLaya,
                model_version: checkpoint.into(),
                calibration_version: None,
                degraded: false,
                degradation_reason: None,
            },
        }
    }

    /// Calibrated worker. Only call this when Withu held-out calibration for
    /// the current language/modality actually passed (spec B.20); the
    /// calibration version is mandatory and recorded.
    pub fn calibrated(
        worker: W,
        checkpoint: impl Into<String>,
        calibration_version: impl Into<String>,
    ) -> Self {
        Self {
            worker,
            battery: affect_question_battery(),
            provenance: Provenance {
                source: InferenceSource::LocalLaya,
                model_version: checkpoint.into(),
                calibration_version: Some(calibration_version.into()),
                degraded: false,
                degradation_reason: None,
            },
        }
    }

    pub fn judge(&self, request: &InferenceRequest) -> Result<AffectJudgment, InferenceError> {
        if request.user_signal.correction.is_some() {
            return Err(InferenceError::Unavailable {
                source: self.provenance.source.clone(),
                reason: "user_correction_supersedes_inference".to_owned(),
            });
        }
        let state = decision_state_from_request(request);
        let answers = self.worker.answer(&state, &self.battery)?;
        assemble_judgment(request, answers, &self.provenance)
    }
}

/// Where a result claims to come from, and whether Withu calibrated it.
#[derive(Clone, Debug)]
pub struct Provenance {
    pub source: InferenceSource,
    pub model_version: String,
    pub calibration_version: Option<String>,
    pub degraded: bool,
    pub degradation_reason: Option<String>,
}

impl Provenance {
    pub fn fixture() -> Self {
        Self {
            source: InferenceSource::RulesFallback,
            model_version: "withu-affect-fixture-lexicon-v1".to_owned(),
            calibration_version: None,
            degraded: true,
            degradation_reason: Some(
                "uncalibrated_fixture_ranker_candidate_ordering_only".to_owned(),
            ),
        }
    }
}

/// `noul` answers to the three boundary questions of the battery. The frozen
/// `affect-hypothesis` contract has no noul fields, so they ride alongside
/// the hypothesis in [`AffectJudgment`] (see the T13 report: suggested
/// contract addition).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NoulFlags {
    pub explicit_need_stated: f32,
    pub advice_rejected: f32,
    pub stop_requested: f32,
    /// Whether these probabilities come from a calibrated judge. Uncalibrated
    /// flags may demote actions but never promote them.
    pub calibrated: bool,
}

impl NoulFlags {
    fn from_answers(answers: &TypedAnswerSet, calibrated: bool) -> Self {
        let read = |id: &str| answers.noul(id).map_or(0.5, |answer| answer.noul);
        Self {
            explicit_need_stated: read(Q_NOUL_EXPLICIT_NEED),
            advice_rejected: read(Q_NOUL_ADVICE_REJECTED),
            stop_requested: read(Q_NOUL_STOP_REQUESTED),
            calibrated,
        }
    }

    /// Act-level rejection of advice: only a calibrated judge may block a
    /// user-stated action (spec B.20 integration contract 3).
    pub fn rejects_advice(&self) -> bool {
        self.calibrated && self.advice_rejected >= NOUL_ACT_THRESHOLD
    }

    /// Uncalibrated hint: may demote model-driven advice, never promote
    /// anything. Conservative direction only.
    pub fn hints_advice_rejected(&self) -> bool {
        self.advice_rejected >= NOUL_HINT_THRESHOLD
    }

    /// Act-level pause request: calibrated only; an uncalibrated judge can
    /// never stop an interaction on its own.
    pub fn requests_pause(&self) -> bool {
        self.calibrated && self.stop_requested >= NOUL_ACT_THRESHOLD
    }
}

/// A complete turn judgment: contract hypothesis + raw typed answers + noul.
#[derive(Clone, Debug)]
pub struct AffectJudgment {
    pub hypothesis: AffectHypothesis,
    pub typed: TypedAnswerSet,
    pub noul: NoulFlags,
}

/// Build the sanitized decision state from a request: the current utterance
/// is the last text observation; recent context is already bounded by
/// [`InferenceRequest::validate`] and clamped again here (defense in depth).
pub fn decision_state_from_request(request: &InferenceRequest) -> DecisionState {
    let utterance = request
        .observations
        .iter()
        .rev()
        .find(|observation| observation.modality == crate::ObservationModality::Text)
        .map(|observation| observation.observed_signal.clone())
        .unwrap_or_default();
    let mut context = Vec::new();
    for turn in request.recent_context.iter().take(crate::MAX_CONTEXT_TURNS) {
        context.push((
            turn.role.as_str().to_owned(),
            turn.text
                .chars()
                .take(crate::MAX_CONTEXT_TURN_CHARS)
                .collect(),
        ));
    }
    DecisionState {
        utterance: utterance.chars().take(crate::MAX_UTTERANCE_CHARS).collect(),
        context,
        language: request.language.clone(),
        modality: "text".to_owned(),
    }
}

fn assemble_judgment(
    request: &InferenceRequest,
    answers: TypedAnswerSet,
    provenance: &Provenance,
) -> Result<AffectJudgment, InferenceError> {
    let battery = affect_question_battery();
    answers
        .validate_against(&battery)
        .map_err(|reason| InferenceError::Unavailable {
            source: provenance.source.clone(),
            reason,
        })?;

    let label_answer =
        answers
            .choice(Q_AFFECT_LABEL)
            .ok_or_else(|| InferenceError::Unavailable {
                source: provenance.source.clone(),
                reason: format!("missing answer {Q_AFFECT_LABEL}"),
            })?;
    let need_answer =
        answers
            .choice(Q_SUPPORT_NEED)
            .ok_or_else(|| InferenceError::Unavailable {
                source: provenance.source.clone(),
                reason: format!("missing answer {Q_SUPPORT_NEED}"),
            })?;
    let valence_answer = answers
        .score(Q_VALENCE)
        .ok_or_else(|| InferenceError::Unavailable {
            source: provenance.source.clone(),
            reason: format!("missing answer {Q_VALENCE}"),
        })?;
    let arousal_answer = answers
        .score(Q_AROUSAL)
        .ok_or_else(|| InferenceError::Unavailable {
            source: provenance.source.clone(),
            reason: format!("missing answer {Q_AROUSAL}"),
        })?;

    let mut affect_candidates: Vec<AffectCandidate> = label_answer
        .probabilities
        .iter()
        .filter_map(|(label, probability)| {
            let parsed: AffectLabel = serde_parse_label(label)?;
            (*probability > 0.0).then(|| AffectCandidate {
                label: parsed,
                score: *probability,
            })
        })
        .collect();
    affect_candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut support_need_candidates: Vec<SupportNeedCandidate> = need_answer
        .probabilities
        .iter()
        .filter_map(|(need, probability)| {
            let parsed: SupportNeed = serde_parse_need(need)?;
            (*probability > 0.0).then(|| SupportNeedCandidate {
                need: parsed,
                score: *probability,
            })
        })
        .collect();
    support_need_candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let valence = ordinal_from_score(valence_answer);
    let arousal = ordinal_from_score(arousal_answer);

    let top_two_margin = affect_candidates
        .first()
        .zip(affect_candidates.get(1))
        .map(|(top, second)| top.score - second.score)
        .unwrap_or(1.0);
    let conflict = affect_candidates.len() > 1 && top_two_margin < CONFLICT_MARGIN;
    let sarcasm_or_ambiguity = conflict && valence == 0 && !affect_candidates.is_empty();

    let hypothesis = AffectHypothesis {
        schema_version: SCHEMA_VERSION,
        session_id: request.session_id.clone(),
        hypothesis_id: format!("{}:{}", request.turn_id, provenance.model_version),
        valence,
        arousal,
        affect_candidates,
        support_need_candidates,
        confidence: label_answer.confidence,
        answer_confidence: label_answer.answer_confidence,
        abstention: false,
        conflict,
        sarcasm_or_ambiguity,
        calibrated: provenance.calibration_version.is_some(),
        evidence_refs: request
            .observations
            .iter()
            .map(|observation| observation.source_ref.clone())
            .collect(),
        model_version: provenance.model_version.clone(),
        source: provenance.source.clone(),
        calibration_version: provenance.calibration_version.clone(),
        degraded: provenance.degraded,
        degradation_reason: provenance.degradation_reason.clone(),
        user_correction: None,
        language: request.language.clone(),
        input_modality: "text".to_owned(),
    };
    hypothesis
        .validate()
        .map_err(InferenceError::InvalidHypothesis)?;

    let noul = NoulFlags::from_answers(&answers, hypothesis.calibrated);
    Ok(AffectJudgment {
        hypothesis,
        typed: answers,
        noul,
    })
}

fn ordinal_from_score(answer: &ScoreAnswer) -> i8 {
    // Levels 0..=4 map to -2..=2.
    let ordinal = answer.score.round() as i8 - 2;
    ordinal.clamp(-2, 2)
}

fn serde_parse_label(label: &str) -> Option<AffectLabel> {
    match label {
        "sadness" => Some(AffectLabel::Sadness),
        "anxiety" => Some(AffectLabel::Anxiety),
        "anger" => Some(AffectLabel::Anger),
        "shame" => Some(AffectLabel::Shame),
        "loneliness" => Some(AffectLabel::Loneliness),
        "joy" => Some(AffectLabel::Joy),
        "tired" => Some(AffectLabel::Tired),
        "mixed" => Some(AffectLabel::Mixed),
        "unclear" => Some(AffectLabel::Unclear),
        _ => None,
    }
}

fn serde_parse_need(need: &str) -> Option<SupportNeed> {
    match need {
        "listening" => Some(SupportNeed::Listening),
        "emotional_confirmation" => Some(SupportNeed::EmotionalConfirmation),
        "companionship" => Some(SupportNeed::Companionship),
        "shared_quiet" => Some(SupportNeed::SharedQuiet),
        "distraction" => Some(SupportNeed::Distraction),
        "advice" => Some(SupportNeed::Advice),
        "transaction_help" => Some(SupportNeed::TransactionHelp),
        "pause_interaction" => Some(SupportNeed::PauseInteraction),
        _ => None,
    }
}

fn fold(text: &str) -> String {
    text.to_lowercase()
}

fn negated(text: &str, at: usize) -> bool {
    // Char-safe window of up to 6 characters immediately before the match.
    // Chinese negators ("不开心") sit right next to the marker; English ones
    // ("not happy", "don't be sad") sit a little further back.
    let prefix = &text[..at];
    let window: String = prefix
        .chars()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    LEXICON
        .negators
        .iter()
        .any(|negator| window.contains(negator))
}

fn label_hits(folded: &str) -> Vec<(AffectLabel, u32)> {
    let mut hits: Vec<(AffectLabel, u32)> = Vec::new();
    for (marker, label) in LEXICON.labels {
        let mut search_from = 0;
        while let Some(found) = folded[search_from..].find(marker) {
            let at = search_from + found;
            let is_negated = negated(folded, at);
            let target = if is_negated {
                // A negated positive marker reads as low mood; a negated
                // negative marker reads as neutral (drop it).
                match label {
                    AffectLabel::Joy => Some(AffectLabel::Sadness),
                    _ => None,
                }
            } else {
                Some(label.clone())
            };
            if let Some(label) = target {
                if let Some(entry) = hits.iter_mut().find(|(existing, _)| existing == &label) {
                    entry.1 += 1;
                } else {
                    hits.push((label, 1));
                }
            }
            search_from = at + marker.len();
        }
    }
    hits
}

/// Accumulate a score for a label (first occurrence creates the entry).
fn bump_score<T: PartialEq>(scores: &mut Vec<(T, f32)>, label: T, amount: f32) {
    if let Some(entry) = scores.iter_mut().find(|(existing, _)| *existing == label) {
        entry.1 += amount;
    } else {
        scores.push((label, amount));
    }
}

fn marker_probability(folded: &str, markers: &[&str]) -> f32 {
    let hits: u32 = markers
        .iter()
        .map(|marker| folded.matches(marker).count() as u32)
        .sum();
    // Deterministic pseudo-probability: strong presence, weak absence. These
    // are ranking numbers from an uncalibrated judge, never calibrated odds.
    if hits == 0 {
        0.05
    } else {
        (0.7 + 0.1 * hits as f32).min(0.95)
    }
}

fn affect_label_answer(
    question_id: &str,
    criteria: &[(String, String)],
    folded: &str,
    context_hits: &[(AffectLabel, u32)],
) -> ChoiceAnswer {
    let mut scores: Vec<(AffectLabel, f32)> = Vec::new();
    for (label, count) in label_hits(folded) {
        // Current utterance weighs 3x the recent-context average.
        bump_score(&mut scores, label, count as f32 * 3.0);
    }
    for (label, count) in context_hits {
        // Context is a weak prior: with SMOOTHING-sized floors, 0.05 keeps a
        // context-only hit below a plausible label (a neutral utterance after
        // a sad one is never asserted as sadness).
        bump_score(&mut scores, label.clone(), *count as f32 * 0.05);
    }
    let has_signal = !scores.is_empty();
    let mut mixed_present = false;
    if has_signal {
        let mut sorted = scores.clone();
        sorted.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        if sorted.len() > 1 {
            let (top_label, top) = &sorted[0];
            let (second_label, second) = &sorted[1];
            let distinct = top_label != second_label
                && !matches!(top_label, AffectLabel::Mixed | AffectLabel::Unclear)
                && !matches!(second_label, AffectLabel::Mixed | AffectLabel::Unclear);
            if distinct && (top - second) < 1.0 {
                mixed_present = true;
            }
        }
        if mixed_present {
            // Conflicting concrete labels surface Mixed as the leading
            // candidate (never tie-broken back to one of the conflicting
            // labels); the individual labels stay visible beneath it.
            let mixed_mass = scores.iter().map(|(_, score)| *score).sum::<f32>() * 0.75;
            bump_score(&mut scores, AffectLabel::Mixed, mixed_mass);
        }
    }
    let mut probabilities: Vec<(String, f32)> = criteria
        .iter()
        .map(|(label, _)| {
            let parsed = serde_parse_label(label);
            let mut mass = SMOOTHING;
            if !has_signal {
                // No signal at all: everything stays flat and `unclear`
                // carries the turn (no label is asserted).
                mass = if parsed == Some(AffectLabel::Unclear) {
                    0.6
                } else {
                    SMOOTHING
                };
            } else if let Some(parsed) = parsed {
                let found = scores
                    .iter()
                    .find(|(existing, _)| *existing == parsed)
                    .map(|(_, score)| *score);
                mass = SMOOTHING + found.unwrap_or(0.0);
            }
            (label.clone(), mass)
        })
        .collect();
    let sum: f32 = probabilities.iter().map(|(_, mass)| *mass).sum();
    for (_, mass) in &mut probabilities {
        *mass /= sum;
    }
    typed::choice_answer(question_id.to_owned(), probabilities)
}

fn support_need_answer(
    question_id: &str,
    criteria: &[(String, String)],
    folded: &str,
) -> ChoiceAnswer {
    let mut scores: Vec<(SupportNeed, f32)> = Vec::new();
    let has_marker = |markers: &[&str]| markers.iter().any(|marker| folded.contains(marker));
    for (marker, need) in LEXICON.needs {
        let count = folded.matches(marker).count();
        if count > 0 {
            bump_score(&mut scores, need.clone(), count as f32);
        }
    }
    if has_marker(LEXICON.advice_rejected) {
        // "不要建议" must never raise advice.
        if let Some(entry) = scores
            .iter_mut()
            .find(|(need, _)| *need == SupportNeed::Advice)
        {
            entry.1 = 0.0;
        }
    }
    if has_marker(LEXICON.stop_requested) {
        bump_score(&mut scores, SupportNeed::PauseInteraction, 2.0);
    }
    if scores.is_empty() {
        // Defaults by coarse valence, never asserting a single label: for
        // negative turns listening/confirmation lead; otherwise neutral.
        let negative = LEXICON.labels.iter().any(|(marker, label)| {
            folded.contains(marker)
                && !matches!(
                    label,
                    AffectLabel::Joy | AffectLabel::Unclear | AffectLabel::Mixed
                )
        });
        if negative {
            bump_score(&mut scores, SupportNeed::Listening, 1.0);
            bump_score(&mut scores, SupportNeed::EmotionalConfirmation, 0.8);
            bump_score(&mut scores, SupportNeed::Companionship, 0.5);
        } else {
            bump_score(&mut scores, SupportNeed::Listening, 1.0);
        }
    }
    let mut probabilities: Vec<(String, f32)> = criteria
        .iter()
        .map(|(need, _)| {
            let parsed = serde_parse_need(need);
            let mass = SMOOTHING
                + parsed
                    .and_then(|parsed| {
                        scores
                            .iter()
                            .find(|(existing, _)| *existing == parsed)
                            .map(|(_, score)| *score)
                    })
                    .unwrap_or(0.0);
            (need.clone(), mass)
        })
        .collect();
    let sum: f32 = probabilities.iter().map(|(_, mass)| *mass).sum();
    for (_, mass) in &mut probabilities {
        *mass /= sum;
    }
    typed::choice_answer(question_id.to_owned(), probabilities)
}

fn valence_answer(question_id: &str, levels: &[String], folded: &str) -> ScoreAnswer {
    let positive_hits: u32 = LEXICON
        .positive
        .iter()
        .map(|marker| folded.matches(marker).count() as u32)
        .sum();
    let negative_hits: u32 = label_hits(folded)
        .into_iter()
        .map(|(label, count)| match label {
            AffectLabel::Joy | AffectLabel::Unclear | AffectLabel::Mixed => 0,
            _ => count,
        })
        .sum();
    // Distribution over the 5 ordered levels (0 very negative .. 4 very
    // positive), centered with a soft prior.
    let mut probabilities = vec![0.05f32; levels.len().max(1)];
    let mid = probabilities.len() / 2;
    let push = |probabilities: &mut Vec<f32>, center: usize, weight: f32| {
        if probabilities.is_empty() {
            return;
        }
        let center = center.min(probabilities.len() - 1);
        probabilities[center] += weight;
        if center + 1 < probabilities.len() {
            probabilities[center + 1] += weight * 0.4;
        }
        if center > 0 {
            probabilities[center - 1] += weight * 0.4;
        }
    };
    probabilities[mid] += 0.3;
    if positive_hits > 0 {
        push(&mut probabilities, mid + 1, 0.5 * positive_hits as f32);
    }
    if negative_hits > 0 {
        push(&mut probabilities, mid - 1, 0.5 * negative_hits as f32);
    }
    let sum: f32 = probabilities.iter().sum();
    for probability in &mut probabilities {
        *probability /= sum;
    }
    typed::score_answer(question_id.to_owned(), levels.to_vec(), probabilities)
}

fn arousal_answer(question_id: &str, levels: &[String], folded: &str) -> ScoreAnswer {
    let high_hits: u32 = LEXICON
        .arousal_high
        .iter()
        .map(|marker| folded.matches(marker).count() as u32)
        .sum();
    let low_hits: u32 = LEXICON
        .arousal_low
        .iter()
        .map(|marker| folded.matches(marker).count() as u32)
        .sum();
    let mut probabilities = vec![0.05f32; levels.len().max(1)];
    let mid = probabilities.len() / 2;
    probabilities[mid] += 0.3;
    let push = |probabilities: &mut Vec<f32>, center: usize, weight: f32| {
        if probabilities.is_empty() {
            return;
        }
        let center = center.min(probabilities.len() - 1);
        probabilities[center] += weight;
        if center + 1 < probabilities.len() {
            probabilities[center + 1] += weight * 0.4;
        }
        if center > 0 {
            probabilities[center - 1] += weight * 0.4;
        }
    };
    if high_hits > 0 {
        push(&mut probabilities, mid + 2, 0.5 * high_hits as f32);
    }
    if low_hits > 0 {
        push(&mut probabilities, mid - 2, 0.5 * low_hits as f32);
    }
    let sum: f32 = probabilities.iter().sum();
    for probability in &mut probabilities {
        *probability /= sum;
    }
    typed::score_answer(question_id.to_owned(), levels.to_vec(), probabilities)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AffectObservation, ObservationModality, Retention, UserTurnSignal};

    fn request(utterance: &str) -> InferenceRequest {
        InferenceRequest {
            session_id: "session-1".to_owned(),
            turn_id: "turn-1".to_owned(),
            observations: vec![AffectObservation {
                schema_version: SCHEMA_VERSION,
                turn_id: "turn-1".to_owned(),
                modality: ObservationModality::Text,
                observed_signal: utterance.to_owned(),
                source_ref: "turn-1-text".to_owned(),
                captured_at: "2026-10-25T00:00:00Z".to_owned(),
                retention: Retention::SessionOnly,
            }],
            user_signal: UserTurnSignal::default(),
            language: "zh".to_owned(),
            recent_context: Vec::new(),
        }
    }

    #[test]
    fn fixture_judge_is_deterministic_and_lexicon_driven() {
        let judge = FixtureJudge::new();
        let first = judge.judge(&request("我今天有点难过，有点想哭")).unwrap();
        let second = judge.judge(&request("我今天有点难过，有点想哭")).unwrap();
        assert_eq!(first.hypothesis, second.hypothesis);
        assert_eq!(
            first.hypothesis.affect_candidates.first().unwrap().label,
            AffectLabel::Sadness
        );
        assert!(first.hypothesis.valence < 0);
    }

    #[test]
    fn fixture_judge_is_always_uncalibrated_and_degraded() {
        let judgment = FixtureJudge::new()
            .judge(&request("我很焦虑，明天就要交了"))
            .unwrap();
        assert!(!judgment.hypothesis.calibrated);
        assert!(judgment.hypothesis.degraded);
        assert!(judgment
            .hypothesis
            .degradation_reason
            .as_deref()
            .unwrap()
            .contains("uncalibrated_fixture_ranker"));
        // Uncalibrated output can never drive an automatic strategy.
        assert!(judgment.hypothesis.requires_clarification());
        assert!(!judgment.noul.calibrated);
        assert!(!judgment.noul.rejects_advice());
    }

    #[test]
    fn no_signal_yields_abstention_not_a_label() {
        let judgment = FixtureJudge::new().judge(&request("嗯。")).unwrap();
        let top = judgment.hypothesis.affect_candidates.first().unwrap();
        assert!(matches!(
            top.label,
            AffectLabel::Unclear | AffectLabel::Mixed
        ));
        assert!(judgment.hypothesis.requires_clarification());
    }

    #[test]
    fn mixed_signals_flag_conflict() {
        let judgment = FixtureJudge::new()
            .judge(&request("我有点难过，但又替她开心，说不上来"))
            .unwrap();
        assert!(
            judgment.hypothesis.conflict
                || judgment
                    .hypothesis
                    .affect_candidates
                    .iter()
                    .any(|candidate| candidate.label == AffectLabel::Mixed)
        );
    }

    #[test]
    fn correction_turn_produces_abstaining_echo() {
        let mut with_correction = request("你理解错了，我不是难过");
        with_correction.user_signal.correction = Some(crate::UserCorrectionRecord {
            turn_id: "turn-1".to_owned(),
            corrected_emotion: Some(AffectLabel::Anger),
            corrected_need: None,
            boundary: Some("no advice".to_owned()),
            recorded_at: "2026-10-25T00:01:00Z".to_owned(),
        });
        let judgment = FixtureJudge::new().judge(&with_correction).unwrap();
        assert!(judgment.hypothesis.abstention);
        assert!(judgment.hypothesis.user_correction.is_some());
        assert!(crate::infer_validated(&FixtureJudge::new(), &with_correction).is_ok());
    }

    #[test]
    fn context_contributes_but_utterance_dominates() {
        let mut with_context = request("今天天气不错");
        with_context.recent_context = vec![crate::ContextTurn {
            role: crate::ContextRole::User,
            text: "昨天我很难过".to_owned(),
        }];
        let judgment = FixtureJudge::new().judge(&with_context).unwrap();
        let sadness = judgment
            .hypothesis
            .affect_candidates
            .iter()
            .find(|candidate| candidate.label == AffectLabel::Sadness)
            .map(|candidate| candidate.score)
            .unwrap_or(0.0);
        // Context may register, but a neutral utterance keeps it weak; the
        // turn is never labelled sadness outright.
        assert!(sadness < 0.5, "sadness={sadness}");
    }

    #[test]
    fn laya_worker_slot_assembles_with_honest_provenance() {
        struct StubWorker;
        impl TypedDecisionWorker for StubWorker {
            fn answer(
                &self,
                _state: &DecisionState,
                questions: &[TypedQuestion],
            ) -> Result<TypedAnswerSet, InferenceError> {
                FixtureJudge::new().answer(
                    &DecisionState {
                        utterance: "我很开心".to_owned(),
                        context: Vec::new(),
                        language: "zh".to_owned(),
                        modality: "text".to_owned(),
                    },
                    questions,
                )
            }
        }
        let uncalibrated = LayaWorkerJudge::uncalibrated(StubWorker, "laya-snapshot-x");
        let judgment = uncalibrated.judge(&request("我很开心")).unwrap();
        assert_eq!(judgment.hypothesis.source, InferenceSource::LocalLaya);
        assert_eq!(judgment.hypothesis.model_version, "laya-snapshot-x");
        assert!(!judgment.hypothesis.calibrated);
        assert!(!judgment.hypothesis.degraded);

        let calibrated =
            LayaWorkerJudge::calibrated(StubWorker, "laya-snapshot-x", "withu-cal-2026-10");
        let judgment = calibrated.judge(&request("我很开心")).unwrap();
        assert!(judgment.hypothesis.calibrated);
        assert_eq!(
            judgment.hypothesis.calibration_version.as_deref(),
            Some("withu-cal-2026-10")
        );
        assert!(!judgment.hypothesis.requires_clarification());
    }

    #[test]
    fn noul_flags_demote_but_never_promote_uncalibrated() {
        let judgment = FixtureJudge::new()
            .judge(&request("别给建议了，我就是想说说"))
            .unwrap();
        assert!(judgment.noul.hints_advice_rejected());
        assert!(!judgment.noul.rejects_advice());
        let advice = judgment
            .hypothesis
            .support_need_candidates
            .iter()
            .find(|candidate| candidate.need == SupportNeed::Advice)
            .map(|candidate| candidate.score)
            .unwrap_or(0.0);
        let listening = judgment
            .hypothesis
            .support_need_candidates
            .iter()
            .find(|candidate| candidate.need == SupportNeed::Listening)
            .map(|candidate| candidate.score)
            .unwrap_or(0.0);
        assert!(listening > advice);
    }
}
