//! Structured, current-turn affect understanding and relationship response.
//!
//! This crate produces short-lived candidates and one support decision. It has
//! no storage, network, task, specialist, or model-download side effects. A
//! caller may plug in Laya or another model through [`AffectInference`], or
//! through the typed-question boundary in [`judge`] (spec 4.9.2: Withu asks a
//! fixed battery; the model answers, Withu's rules decide).
//!
//! Layering (spec 4.9.3):
//! 1. [`judge`] turns sanitized observations into an [`AffectHypothesis`]
//!    (candidates with probabilities, valence/arousal ordinals, noul flags,
//!    confidence/abstention). Explicit user statements never pass through it.
//! 2. [`decide_support_plan`] / [`plan_turn`] implement the spec 4.9.4
//!    response-action rule table: one primary action per turn, explicit user
//!    statements overriding conflicting candidates, clarification instead of
//!    a single label under uncertainty.
//! 3. [`feedback::TurnFeedbackLog`] closes the loop with the
//!    improved/unchanged/misread/unknown outcome of the previous turn,
//!    current session only.

pub mod clarify;

pub mod feedback;
pub mod fixtures;
pub mod judge;
pub mod typed;

pub use feedback::TurnFeedbackLog;
pub use judge::FixtureJudge;

use clarify::{Clarification, ClarifyOption};

use serde::{Deserialize, Serialize};
use std::fmt;

pub const SCHEMA_VERSION: u16 = 1;
pub const MIN_CONFIDENCE: f32 = 0.60;
pub const MIN_ANSWER_CONFIDENCE: f32 = 0.60;
/// Bounded recent context for inference (spec 4.9.2 / A.5: recent context
/// matters; unbounded history must not enter the decision).
pub const MAX_CONTEXT_TURNS: usize = 4;
pub const MAX_CONTEXT_TURN_CHARS: usize = 400;
pub const MAX_UTTERANCE_CHARS: usize = 600;

/// The source is explicit so a fallback cannot be reported as a Laya result.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InferenceSource {
    LocalLaya,
    ConfiguredLlm,
    ConfiguredLlmFallback,
    RulesFallback,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationModality {
    Text,
    Prosody,
    Interaction,
}

/// One sanitized turn of bounded recent context, already stripped of raw
/// audio and anything the user has not authorized for the session.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ContextTurn {
    pub role: ContextRole,
    pub text: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextRole {
    User,
    Assistant,
}

impl ContextRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Retention {
    SessionOnly,
    UserAuthorized,
}

/// An observation is a reference to an input signal, never raw audio or a
/// transcript. It is normally retained for the current session only.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AffectObservation {
    pub schema_version: u16,
    pub turn_id: String,
    pub modality: ObservationModality,
    pub observed_signal: String,
    pub source_ref: String,
    pub captured_at: String,
    pub retention: Retention,
}

impl AffectObservation {
    pub fn validate(&self) -> Result<(), ValidationError> {
        check_schema(self.schema_version)?;
        require_non_empty("turn_id", &self.turn_id)?;
        require_non_empty("observed_signal", &self.observed_signal)?;
        require_non_empty("source_ref", &self.source_ref)?;
        require_non_empty("captured_at", &self.captured_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AffectLabel {
    Sadness,
    Anxiety,
    Anger,
    Shame,
    Loneliness,
    Joy,
    Tired,
    Mixed,
    Unclear,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportNeed {
    Listening,
    EmotionalConfirmation,
    Companionship,
    SharedQuiet,
    Distraction,
    Advice,
    TransactionHelp,
    PauseInteraction,
}

impl fmt::Display for SupportNeed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::Listening => "listening",
            Self::EmotionalConfirmation => "emotional_confirmation",
            Self::Companionship => "companionship",
            Self::SharedQuiet => "shared_quiet",
            Self::Distraction => "distraction",
            Self::Advice => "advice",
            Self::TransactionHelp => "transaction_help",
            Self::PauseInteraction => "pause_interaction",
        };
        f.write_str(value)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AffectCandidate {
    pub label: AffectLabel,
    pub score: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SupportNeedCandidate {
    pub need: SupportNeed,
    pub score: f32,
}

/// A model output is a hypothesis, not a fact and not a memory record.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AffectHypothesis {
    pub schema_version: u16,
    pub session_id: String,
    pub hypothesis_id: String,
    pub valence: i8,
    pub arousal: i8,
    pub affect_candidates: Vec<AffectCandidate>,
    pub support_need_candidates: Vec<SupportNeedCandidate>,
    pub confidence: f32,
    pub answer_confidence: f32,
    pub abstention: bool,
    pub conflict: bool,
    pub sarcasm_or_ambiguity: bool,
    pub calibrated: bool,
    pub evidence_refs: Vec<String>,
    pub model_version: String,
    pub source: InferenceSource,
    pub calibration_version: Option<String>,
    pub degraded: bool,
    pub degradation_reason: Option<String>,
    pub user_correction: Option<UserCorrectionRecord>,
    pub language: String,
    pub input_modality: String,
}

impl AffectHypothesis {
    pub fn validate(&self) -> Result<(), ValidationError> {
        check_schema(self.schema_version)?;
        require_non_empty("session_id", &self.session_id)?;
        require_non_empty("hypothesis_id", &self.hypothesis_id)?;
        require_range("valence", self.valence as f32, -2.0, 2.0)?;
        require_range("arousal", self.arousal as f32, -2.0, 2.0)?;
        require_probability("confidence", self.confidence)?;
        require_probability("answer_confidence", self.answer_confidence)?;
        require_non_empty("model_version", &self.model_version)?;
        require_non_empty("language", &self.language)?;
        require_non_empty("input_modality", &self.input_modality)?;
        if let Some(version) = &self.calibration_version {
            require_non_empty("calibration_version", version)?;
        }
        if self.calibrated && self.calibration_version.is_none() {
            return Err(ValidationError::MissingCalibrationVersion);
        }
        if self.degraded
            && self
                .degradation_reason
                .as_deref()
                .is_none_or(|reason| reason.trim().is_empty())
        {
            return Err(ValidationError::MissingDegradationReason);
        }
        if !self.degraded && self.degradation_reason.is_some() {
            return Err(ValidationError::UnexpectedDegradationReason);
        }
        if matches!(
            self.source,
            InferenceSource::ConfiguredLlmFallback | InferenceSource::RulesFallback
        ) && !self.degraded
        {
            return Err(ValidationError::FallbackMustBeDegraded);
        }
        if let Some(correction) = &self.user_correction {
            correction.validate()?;
            if !self.abstention {
                return Err(ValidationError::CorrectionMustStopOldHypothesis);
            }
        }
        for candidate in &self.affect_candidates {
            require_probability("affect candidate score", candidate.score)?;
        }
        for candidate in &self.support_need_candidates {
            require_probability("support candidate score", candidate.score)?;
        }
        Ok(())
    }

    pub fn requires_clarification(&self) -> bool {
        self.abstention
            || self.conflict
            || self.sarcasm_or_ambiguity
            || !self.calibrated
            || self.confidence < MIN_CONFIDENCE
            || self.answer_confidence < MIN_ANSWER_CONFIDENCE
    }

    /// A hypothesis superseded by a user correction (or abstaining) must not
    /// influence response selection again (spec 4.9.3 step 10: after a
    /// misread, the old reading is dead, not averaged in).
    pub fn usable_for_response(&self) -> bool {
        self.user_correction.is_none() && !self.abstention
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UserCorrectionRecord {
    pub turn_id: String,
    pub corrected_emotion: Option<AffectLabel>,
    pub corrected_need: Option<SupportNeed>,
    pub boundary: Option<String>,
    pub recorded_at: String,
}

impl UserCorrectionRecord {
    fn validate(&self) -> Result<(), ValidationError> {
        require_non_empty("correction turn_id", &self.turn_id)?;
        require_non_empty("correction recorded_at", &self.recorded_at)?;
        if let Some(boundary) = &self.boundary {
            require_non_empty("correction boundary", boundary)?;
        }
        if self.corrected_emotion.is_none()
            && self.corrected_need.is_none()
            && self.boundary.as_deref().is_none_or(str::is_empty)
        {
            return Err(ValidationError::EmptyCorrection);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UserTurnSignal {
    pub stated_emotion: Option<AffectLabel>,
    pub stated_need: Option<SupportNeed>,
    pub boundary: Option<String>,
    pub blocked_actions: Vec<SupportAction>,
    pub correction: Option<UserCorrectionRecord>,
    pub explicit_transaction_request: bool,
}

impl UserTurnSignal {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if let Some(boundary) = &self.boundary {
            require_non_empty("boundary", boundary)?;
        }
        if let Some(correction) = &self.correction {
            correction.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RelationshipState {
    pub schema_version: u16,
    pub session_id: String,
    pub topic: String,
    pub emotion: Option<AffectLabel>,
    pub intent: Option<String>,
    pub user_stated: bool,
    pub boundary: Option<String>,
    pub observed_at: String,
    pub source_turn_id: String,
    pub version: u64,
}

impl RelationshipState {
    pub fn empty(
        session_id: impl Into<String>,
        source_turn_id: impl Into<String>,
        observed_at: impl Into<String>,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            session_id: session_id.into(),
            topic: String::new(),
            emotion: None,
            intent: None,
            user_stated: false,
            boundary: None,
            observed_at: observed_at.into(),
            source_turn_id: source_turn_id.into(),
            version: 1,
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        check_schema(self.schema_version)?;
        require_non_empty("session_id", &self.session_id)?;
        require_non_empty("observed_at", &self.observed_at)?;
        require_non_empty("source_turn_id", &self.source_turn_id)?;
        if self.version == 0 {
            return Err(ValidationError::InvalidVersion);
        }
        if let Some(boundary) = &self.boundary {
            require_non_empty("boundary", boundary)?;
        }
        Ok(())
    }

    /// A correction immediately replaces current state and advances its version.
    pub fn apply_correction(
        &self,
        correction: &UserCorrectionRecord,
    ) -> Result<Self, ValidationError> {
        self.validate()?;
        correction.validate()?;
        let mut next = self.clone();
        if let Some(emotion) = &correction.corrected_emotion {
            next.emotion = Some(emotion.clone());
        }
        if let Some(need) = &correction.corrected_need {
            next.intent = Some(need.to_string());
        }
        if let Some(boundary) = &correction.boundary {
            next.boundary = Some(boundary.clone());
        }
        next.user_stated = true;
        next.source_turn_id = correction.turn_id.clone();
        next.observed_at = correction.recorded_at.clone();
        next.version = self
            .version
            .checked_add(1)
            .ok_or(ValidationError::VersionExhausted)?;
        Ok(next)
    }

    /// Merge only the fields the user explicitly stated in this turn. Model
    /// candidates never enter this state through this method.
    pub fn apply_user_signal(
        &self,
        turn_id: impl Into<String>,
        observed_at: impl Into<String>,
        signal: &UserTurnSignal,
    ) -> Result<Self, ValidationError> {
        self.validate()?;
        signal.validate()?;
        let turn_id = turn_id.into();
        let observed_at = observed_at.into();
        require_non_empty("turn_id", &turn_id)?;
        require_non_empty("observed_at", &observed_at)?;
        if let Some(correction) = &signal.correction {
            if correction.turn_id != turn_id {
                return Err(ValidationError::TurnEnvelopeMismatch);
            }
            return self.apply_correction(correction);
        }
        if signal.stated_emotion.is_none()
            && signal.stated_need.is_none()
            && signal.boundary.is_none()
        {
            return Ok(self.clone());
        }
        let mut next = self.clone();
        if let Some(emotion) = &signal.stated_emotion {
            next.emotion = Some(emotion.clone());
        }
        if let Some(need) = &signal.stated_need {
            next.intent = Some(need.to_string());
        }
        if let Some(boundary) = &signal.boundary {
            next.boundary = Some(boundary.clone());
        }
        next.user_stated = signal.stated_emotion.is_some()
            || signal.stated_need.is_some()
            || signal.boundary.is_some()
            || signal.correction.is_some();
        next.source_turn_id = turn_id;
        next.observed_at = observed_at;
        next.version = self
            .version
            .checked_add(1)
            .ok_or(ValidationError::VersionExhausted)?;
        Ok(next)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SupportPlan {
    pub schema_version: u16,
    pub turn_id: String,
    pub primary_action: SupportAction,
    pub secondary_option: Option<SupportAction>,
    pub permission_needed: bool,
    pub language_constraints: Vec<String>,
    pub presence_cues: PresenceCues,
    pub creates_task: bool,
    pub specialist_dispatched: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportAction {
    ReflectConfirm,
    Listen,
    Accompany,
    SharedQuiet,
    Clarify,
    Distract,
    Advice,
    Transaction,
    PauseInteraction,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PresenceCues {
    pub pace: Option<String>,
    pub pause: Option<String>,
    pub intensity: Option<String>,
}

impl SupportPlan {
    pub fn validate(&self) -> Result<(), ValidationError> {
        check_schema(self.schema_version)?;
        require_non_empty("turn_id", &self.turn_id)?;
        if self.secondary_option.as_ref() == Some(&self.primary_action) {
            return Err(ValidationError::MultiplePrimaryActions);
        }
        if self.creates_task || self.specialist_dispatched {
            return Err(ValidationError::RelationshipTurnCreatedWork);
        }
        if matches!(
            self.primary_action,
            SupportAction::Advice | SupportAction::Transaction
        ) && !self.permission_needed
        {
            return Err(ValidationError::PermissionRequired);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseOutcome {
    pub schema_version: u16,
    pub turn_id: String,
    pub action: SupportAction,
    pub user_feedback: Option<String>,
    pub next_turn_signal: Option<String>,
    pub outcome: Outcome,
    pub user_correction: Option<UserCorrectionRecord>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Improved,
    Unchanged,
    Misread,
    Unknown,
}

impl ResponseOutcome {
    pub fn validate(&self) -> Result<(), ValidationError> {
        check_schema(self.schema_version)?;
        require_non_empty("turn_id", &self.turn_id)?;
        if let Some(correction) = &self.user_correction {
            correction.validate()?;
            if !matches!(self.outcome, Outcome::Misread) {
                return Err(ValidationError::CorrectionRequiresMisread);
            }
        }
        Ok(())
    }
}

/// Complete current-turn envelope used by a future server/GUI adapter. It is
/// deliberately self-contained so callers can validate one turn atomically.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AffectTurn {
    pub schema_version: u16,
    pub turn_id: String,
    pub user_signal: UserTurnSignal,
    pub observations: Vec<AffectObservation>,
    pub hypothesis: AffectHypothesis,
    pub support_plan: SupportPlan,
    pub response_outcome: ResponseOutcome,
    pub relationship_state: RelationshipState,
}

impl AffectTurn {
    pub fn validate(&self) -> Result<(), ValidationError> {
        check_schema(self.schema_version)?;
        require_non_empty("turn_id", &self.turn_id)?;
        self.user_signal.validate()?;
        for observation in &self.observations {
            observation.validate()?;
            if observation.turn_id != self.turn_id {
                return Err(ValidationError::ObservationTurnMismatch);
            }
        }
        self.hypothesis.validate()?;
        self.support_plan.validate()?;
        self.response_outcome.validate()?;
        self.relationship_state.validate()?;
        if self.support_plan.turn_id != self.turn_id
            || self.response_outcome.turn_id != self.turn_id
            || self.support_plan.primary_action != self.response_outcome.action
            || self.hypothesis.session_id != self.relationship_state.session_id
        {
            return Err(ValidationError::TurnEnvelopeMismatch);
        }
        Ok(())
    }
}

/// An adapter request carries references and structured signals, not raw audio
/// or a request to upload text to a provider. `recent_context` is the bounded,
/// sanitized window the judge may see; anything longer is rejected here.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InferenceRequest {
    pub session_id: String,
    pub turn_id: String,
    pub observations: Vec<AffectObservation>,
    pub user_signal: UserTurnSignal,
    pub language: String,
    #[serde(default)]
    pub recent_context: Vec<ContextTurn>,
}

impl InferenceRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        require_non_empty("session_id", &self.session_id)?;
        require_non_empty("turn_id", &self.turn_id)?;
        require_non_empty("language", &self.language)?;
        self.user_signal.validate()?;
        for observation in &self.observations {
            observation.validate()?;
            if observation.turn_id != self.turn_id {
                return Err(ValidationError::ObservationTurnMismatch);
            }
        }
        if self.recent_context.len() > MAX_CONTEXT_TURNS {
            return Err(ValidationError::RecentContextTooManyTurns);
        }
        for turn in &self.recent_context {
            if turn.text.chars().count() > MAX_CONTEXT_TURN_CHARS {
                return Err(ValidationError::RecentContextTurnTooLong);
            }
        }
        Ok(())
    }
}

/// Replaceable Laya/model worker boundary. Implementations must return
/// provenance in the hypothesis and must never claim Laya when it was absent.
pub trait AffectInference {
    fn infer(&self, request: &InferenceRequest) -> Result<AffectHypothesis, InferenceError>;
}

/// Invoke an adapter through a validated boundary. A faulty worker cannot
/// return a malformed record or leak a candidate across sessions.
pub fn infer_validated(
    worker: &impl AffectInference,
    request: &InferenceRequest,
) -> Result<AffectHypothesis, InferenceError> {
    request.validate().map_err(InferenceError::InvalidRequest)?;
    let hypothesis = worker.infer(request)?;
    hypothesis
        .validate()
        .map_err(InferenceError::InvalidHypothesis)?;
    if hypothesis.session_id != request.session_id {
        return Err(InferenceError::SessionMismatch);
    }
    if let Some(correction) = &request.user_signal.correction {
        if hypothesis.user_correction.as_ref() != Some(correction) || !hypothesis.abstention {
            return Err(InferenceError::CorrectionNotApplied);
        }
    }
    Ok(hypothesis)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InferenceError {
    InvalidRequest(ValidationError),
    InvalidHypothesis(ValidationError),
    Unavailable {
        source: InferenceSource,
        reason: String,
    },
    SessionMismatch,
    CorrectionNotApplied,
}

impl fmt::Display for InferenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(error) => write!(f, "invalid affect request: {error}"),
            Self::InvalidHypothesis(error) => write!(f, "invalid affect result: {error}"),
            Self::Unavailable { source, reason } => {
                write!(f, "{source:?} unavailable: {reason}")
            }
            Self::SessionMismatch => write!(f, "affect result belongs to another session"),
            Self::CorrectionNotApplied => {
                write!(f, "user correction did not supersede the candidate")
            }
        }
    }
}

impl std::error::Error for InferenceError {}

/// Construct an explicit degraded result when Laya cannot run. This neutral,
/// abstaining candidate is never presented as a successful Laya inference.
pub fn degraded_fallback(
    request: &InferenceRequest,
    reason: impl Into<String>,
) -> Result<AffectHypothesis, ValidationError> {
    request
        .validate()
        .map_err(|_| ValidationError::InvalidRequest)?;
    let hypothesis = AffectHypothesis {
        schema_version: SCHEMA_VERSION,
        session_id: request.session_id.clone(),
        hypothesis_id: format!("{}:degraded", request.turn_id),
        valence: 0,
        arousal: 0,
        affect_candidates: vec![AffectCandidate {
            label: AffectLabel::Unclear,
            score: 1.0,
        }],
        support_need_candidates: vec![SupportNeedCandidate {
            need: SupportNeed::Listening,
            score: 1.0,
        }],
        confidence: 0.0,
        answer_confidence: 0.0,
        abstention: true,
        conflict: false,
        sarcasm_or_ambiguity: false,
        calibrated: false,
        evidence_refs: Vec::new(),
        model_version: "withu-affect-rules-v1".to_owned(),
        source: InferenceSource::RulesFallback,
        calibration_version: None,
        degraded: true,
        degradation_reason: Some(reason.into()),
        user_correction: request.user_signal.correction.clone(),
        language: request.language.clone(),
        input_modality: "unknown".to_owned(),
    };
    hypothesis.validate()?;
    Ok(hypothesis)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValidationError {
    InvalidSchemaVersion,
    InvalidVersion,
    VersionExhausted,
    EmptyField(&'static str),
    InvalidProbability(&'static str),
    OutOfRange(&'static str),
    MissingDegradationReason,
    MissingCalibrationVersion,
    UnexpectedDegradationReason,
    FallbackMustBeDegraded,
    CorrectionMustStopOldHypothesis,
    EmptyCorrection,
    ObservationTurnMismatch,
    MultiplePrimaryActions,
    PermissionRequired,
    RelationshipTurnCreatedWork,
    CorrectionRequiresMisread,
    TurnEnvelopeMismatch,
    NoPermittedAction,
    InvalidRequest,
    TooManyClarifyOptions,
    EmptyClarification,
    DuplicateFeedbackTurn,
    RecentContextTooManyTurns,
    RecentContextTurnTooLong,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSchemaVersion => write!(f, "unsupported schema version"),
            Self::InvalidVersion => write!(f, "version must be greater than zero"),
            Self::VersionExhausted => write!(f, "state version cannot advance"),
            Self::EmptyField(field) => write!(f, "{field} must not be empty"),
            Self::InvalidProbability(field) => write!(f, "{field} must be between 0 and 1"),
            Self::OutOfRange(field) => write!(f, "{field} is out of range"),
            Self::MissingDegradationReason => write!(f, "degraded inference requires a reason"),
            Self::MissingCalibrationVersion => {
                write!(f, "calibrated inference requires a calibration version")
            }
            Self::UnexpectedDegradationReason => {
                write!(f, "non-degraded inference has a degradation reason")
            }
            Self::FallbackMustBeDegraded => write!(f, "fallback source must be marked degraded"),
            Self::CorrectionMustStopOldHypothesis => {
                write!(f, "a corrected hypothesis must abstain")
            }
            Self::EmptyCorrection => {
                write!(f, "correction must change an emotion, need, or boundary")
            }
            Self::ObservationTurnMismatch => write!(f, "observation belongs to another turn"),
            Self::MultiplePrimaryActions => {
                write!(f, "a support plan may have only one primary action")
            }
            Self::PermissionRequired => {
                write!(f, "advice and transaction actions require permission")
            }
            Self::RelationshipTurnCreatedWork => {
                write!(f, "relationship turns cannot create tasks or specialists")
            }
            Self::CorrectionRequiresMisread => {
                write!(f, "a correction is only valid for a misread outcome")
            }
            Self::TurnEnvelopeMismatch => write!(f, "current-turn envelope fields do not match"),
            Self::NoPermittedAction => write!(f, "all neutral fallback actions are blocked"),
            Self::InvalidRequest => write!(f, "invalid inference request"),
            Self::TooManyClarifyOptions => {
                write!(f, "a clarification may offer at most two options")
            }
            Self::EmptyClarification => write!(f, "a clarification needs at least one option"),
            Self::DuplicateFeedbackTurn => write!(f, "a turn may be closed exactly once"),
            Self::RecentContextTooManyTurns => {
                write!(f, "recent context exceeds the bounded window")
            }
            Self::RecentContextTurnTooLong => {
                write!(f, "a recent context turn exceeds the length bound")
            }
        }
    }
}

impl std::error::Error for ValidationError {}

fn check_schema(version: u16) -> Result<(), ValidationError> {
    (version == SCHEMA_VERSION)
        .then_some(())
        .ok_or(ValidationError::InvalidSchemaVersion)
}

fn require_non_empty(field: &'static str, value: &str) -> Result<(), ValidationError> {
    (!value.trim().is_empty())
        .then_some(())
        .ok_or(ValidationError::EmptyField(field))
}

fn require_probability(field: &'static str, value: f32) -> Result<(), ValidationError> {
    (value.is_finite() && (0.0..=1.0).contains(&value))
        .then_some(())
        .ok_or(ValidationError::InvalidProbability(field))
}

fn require_range(
    field: &'static str,
    value: f32,
    minimum: f32,
    maximum: f32,
) -> Result<(), ValidationError> {
    (minimum..=maximum)
        .contains(&value)
        .then_some(())
        .ok_or(ValidationError::OutOfRange(field))
}

pub fn current_expression<'a>(
    user_stated: Option<&'a str>,
    model_inferred: Option<&'a str>,
) -> Option<&'a str> {
    user_stated.or(model_inferred)
}

pub fn may_select_model_response(
    calibrated: bool,
    language_applicable: bool,
    modality_applicable: bool,
    abstention: bool,
    conflict: bool,
) -> bool {
    calibrated && language_applicable && modality_applicable && !abstention && !conflict
}

/// Decide one support action for a relationship turn. Explicit user signals
/// win over model candidates; uncertain candidates result in clarification or
/// neutral listening. No branch creates a task or dispatches a specialist.
///
/// The label-driven branches implement the spec 4.9.4 response-action rule
/// table (see [`rule_table_row`]); the priority order follows spec 4.9.1:
/// explicit statements, then context, then (calibrated) candidates.
pub fn decide_support_plan(
    turn_id: impl Into<String>,
    hypothesis: &AffectHypothesis,
    user: &UserTurnSignal,
) -> Result<SupportPlan, ValidationError> {
    hypothesis.validate()?;
    user.validate()?;
    let turn_id = turn_id.into();
    require_non_empty("turn_id", &turn_id)?;

    // A superseded hypothesis never contributes content, only the fact that
    // the user corrected (which is handled below through the correction).
    let dead_hypothesis = !hypothesis.usable_for_response();

    let stated_need = user
        .correction
        .as_ref()
        .and_then(|correction| correction.corrected_need.as_ref())
        .or(user.stated_need.as_ref());
    let (
        mut primary_action,
        mut secondary_option,
        mut permission_needed,
        mut cues,
        mut constraints,
    ) = if let Some(need) = stated_need {
        let (action, permission, cue) = action_for_need(need, user.explicit_transaction_request);
        let mut row = base_constraints();
        if action == SupportAction::Transaction {
            // Spec 4.9.4 row 8: acknowledge the emotion first, then handle
            // the transaction; never auto-create tasks "out of care".
            row.push("acknowledge_emotion_before_transaction".to_owned());
            row.push("no_auto_task_creation".to_owned());
        }
        if action == SupportAction::Advice {
            row.push("advice_requires_consent".to_owned());
        }
        row.push("explicit_user_statement_priority".to_owned());
        (action, None, permission, cue, row)
    } else if user.explicit_transaction_request {
        let mut row = base_constraints();
        row.push("acknowledge_emotion_before_transaction".to_owned());
        row.push("no_auto_task_creation".to_owned());
        row.push("explicit_user_statement_priority".to_owned());
        (
            SupportAction::Transaction,
            None,
            true,
            PresenceCues::default(),
            row,
        )
    } else if user.correction.is_some() {
        let mut row = base_constraints();
        row.push("acknowledge_correction".to_owned());
        row.push("no_repeated_followup".to_owned());
        row.push("accept_user_account_as_authoritative".to_owned());
        if user
            .correction
            .as_ref()
            .and_then(|correction| correction.boundary.as_ref())
            .is_some()
        {
            row.push("respect_stated_boundary".to_owned());
        }
        (
            SupportAction::ReflectConfirm,
            None,
            false,
            PresenceCues {
                pace: Some("calm".to_owned()),
                pause: Some("longer".to_owned()),
                intensity: Some("soft".to_owned()),
            },
            row,
        )
    } else if user.stated_emotion.is_some() {
        // Explicit emotion beats model uncertainty: an uncalibrated judge
        // must not turn a stated "我很难过" into a clarification about which
        // emotion it might be (spec 4.9.1 priority, 4.9.3 step 3).
        let label = user.stated_emotion.clone().unwrap_or(AffectLabel::Unclear);
        rule_table_row(&label, hypothesis.arousal)
    } else if hypothesis.requires_clarification() || dead_hypothesis {
        // Spec 4.9.4 row 7: candidate conflict or low confidence.
        let mut row = base_constraints();
        row.push("no_single_label".to_owned());
        row.push("transparent_uncertainty".to_owned());
        row.push("max_two_clarify_options".to_owned());
        (
            SupportAction::Clarify,
            Some(SupportAction::Listen),
            false,
            PresenceCues {
                pace: Some("calm".to_owned()),
                pause: Some("short".to_owned()),
                intensity: Some("neutral".to_owned()),
            },
            row,
        )
    } else {
        // Rule-table row from the top candidate. Only a calibrated,
        // non-conflicting candidate reaches this branch (it passed
        // `requires_clarification` above); an uncalibrated judge can only
        // rank, never select (spec B.20).
        let label = hypothesis
            .affect_candidates
            .first()
            .map(|top| top.label.clone())
            .unwrap_or(AffectLabel::Unclear);
        rule_table_row(&label, hypothesis.arousal)
    };

    // A stated boundary constrains even an otherwise explicit need/request.
    if user.blocked_actions.contains(&primary_action) {
        primary_action = [
            SupportAction::Clarify,
            SupportAction::Listen,
            SupportAction::PauseInteraction,
        ]
        .into_iter()
        .find(|action| !user.blocked_actions.contains(action))
        .ok_or(ValidationError::NoPermittedAction)?;
        secondary_option = None;
        permission_needed = false;
        cues = PresenceCues::default();
        if !constraints
            .iter()
            .any(|constraint| constraint == "respect_stated_boundary")
        {
            constraints.push("respect_stated_boundary".to_owned());
        }
    }

    let plan = SupportPlan {
        schema_version: SCHEMA_VERSION,
        turn_id,
        primary_action,
        secondary_option,
        permission_needed,
        language_constraints: constraints,
        presence_cues: cues,
        creates_task: false,
        specialist_dispatched: false,
    };
    plan.validate()?;
    Ok(plan)
}

fn base_constraints() -> Vec<String> {
    vec!["no_diagnosis".to_owned(), "no_inferred_fact".to_owned()]
}

/// Spec 4.9.4 response-action rule table. Each row: (primary action,
/// secondary option, presence cues, language constraints). The constraints
/// encode both the row's preferred action and its "禁止的捷径" column, so the
/// surface generator (T14) is bound by them.
fn rule_table_row(
    label: &AffectLabel,
    arousal: i8,
) -> (
    SupportAction,
    Option<SupportAction>,
    bool,
    PresenceCues,
    Vec<String>,
) {
    let row = |constraints: &[&str]| -> Vec<String> {
        base_constraints()
            .into_iter()
            .chain(constraints.iter().map(|constraint| constraint.to_string()))
            .collect()
    };
    match label {
        AffectLabel::Sadness => (
            SupportAction::ReflectConfirm,
            Some(SupportAction::Accompany),
            false,
            PresenceCues {
                pace: Some("slow".to_owned()),
                pause: Some("longer".to_owned()),
                intensity: Some("soft".to_owned()),
            },
            row(&[
                "brief_reflection_acknowledge_weight",
                "invite_continuation_not_solutions",
                "no_immediate_solution_list",
                "no_forced_positivity",
                "no_boilerplate_reassurance",
            ]),
        ),
        AffectLabel::Anxiety if arousal >= 1 => (
            SupportAction::ReflectConfirm,
            Some(SupportAction::Clarify),
            false,
            PresenceCues {
                pace: Some("slow".to_owned()),
                pause: Some("longer".to_owned()),
                intensity: Some("low_stimulation".to_owned()),
            },
            row(&[
                "reduce_pace_and_information",
                "confirm_nearest_worry",
                "offer_two_present_steps",
                "no_diagnosis_of_disorder",
                "no_repeated_why_questions",
                "no_unconsented_exercises",
            ]),
        ),
        AffectLabel::Anxiety => (
            SupportAction::ReflectConfirm,
            Some(SupportAction::Accompany),
            false,
            PresenceCues {
                pace: Some("calm".to_owned()),
                pause: Some("longer".to_owned()),
                intensity: Some("soft".to_owned()),
            },
            row(&[
                "confirm_nearest_worry",
                "no_diagnosis_of_disorder",
                "no_repeated_why_questions",
            ]),
        ),
        AffectLabel::Anger => (
            SupportAction::ReflectConfirm,
            Some(SupportAction::Listen),
            false,
            PresenceCues {
                pace: Some("calm".to_owned()),
                pause: Some("short".to_owned()),
                intensity: Some("steady".to_owned()),
            },
            row(&[
                "acknowledge_impact_and_unfairness",
                "ask_vent_or_handle",
                "offer_fact_sorting_if_wanted",
                "no_danger_or_personality_labels",
                "no_endorsing_harm",
            ]),
        ),
        AffectLabel::Shame => (
            SupportAction::ReflectConfirm,
            Some(SupportAction::Clarify),
            false,
            PresenceCues {
                pace: Some("slow".to_owned()),
                pause: Some("longer".to_owned()),
                intensity: Some("non_judgmental".to_owned()),
            },
            row(&[
                "restate_event_and_feeling_non_judgmentally",
                "separate_act_from_worth",
                "invite_optional_next_step_review",
                "no_empty_praise",
                "no_moralizing",
                "no_unverified_absolution",
            ]),
        ),
        AffectLabel::Loneliness => (
            SupportAction::Accompany,
            Some(SupportAction::SharedQuiet),
            false,
            PresenceCues {
                pace: Some("calm".to_owned()),
                pause: Some("longer".to_owned()),
                intensity: Some("present".to_owned()),
            },
            row(&[
                "stay_present",
                "respect_ending",
                "no_only_relationship_claims",
                "no_dependency_design",
                "no_notification_tracking",
            ]),
        ),
        AffectLabel::Joy => (
            SupportAction::ReflectConfirm,
            Some(SupportAction::Listen),
            false,
            PresenceCues::default(),
            row(&[
                "mirror_positive_naturally",
                "let_user_choose_next",
                "no_topic_stealing",
                "no_intimacy_inflation",
                "no_forced_productivity_pivot",
            ]),
        ),
        AffectLabel::Tired => (
            SupportAction::ReflectConfirm,
            Some(SupportAction::SharedQuiet),
            false,
            PresenceCues {
                pace: Some("slow".to_owned()),
                pause: Some("longer".to_owned()),
                intensity: Some("soft".to_owned()),
            },
            row(&[
                "low_demand_presence",
                "no_pressure_to_talk",
                "no_immediate_solution_list",
            ]),
        ),
        // Mixed, unclear, or anything else: never a single label.
        AffectLabel::Mixed | AffectLabel::Unclear => (
            SupportAction::Clarify,
            Some(SupportAction::Listen),
            false,
            PresenceCues {
                pace: Some("calm".to_owned()),
                pause: Some("short".to_owned()),
                intensity: Some("neutral".to_owned()),
            },
            row(&[
                "no_single_label",
                "transparent_uncertainty",
                "max_two_clarify_options",
            ]),
        ),
    }
}

/// The full per-turn decision for the reply chain: the plan, the optional
/// low-burden clarification, and whether a correction superseded the model
/// reading this turn.
#[derive(Clone, Debug)]
pub struct TurnDecision {
    pub plan: SupportPlan,
    pub clarification: Option<Clarification>,
    pub superseded_by_correction: bool,
}

impl TurnDecision {
    /// Convenience accessor for the at-most-two options.
    pub fn clarify_options(&self) -> &[ClarifyOption] {
        self.clarification
            .as_ref()
            .map(|clarification| clarification.options.as_slice())
            .unwrap_or(&[])
    }
}

/// Plan a full relationship turn from a judgment. This is the T14 wiring
/// point: after [`judge::FixtureJudge::judge`] (or a real worker), call this
/// with the user signal of the turn and the session feedback log.
///
/// - Explicit user statements override model candidates (they do not even
///   reach the judge).
/// - A calibrated `noul` "advice rejected" blocks advice; an uncalibrated
///   hint can only demote, never promote.
/// - A prior misread outcome opens the turn with an apology and forbids
///   repeated follow-up questions.
/// - Under clarification, at most two low-burden options are offered, with
///   neutral listening as the fallback.
pub fn plan_turn(
    turn_id: impl Into<String>,
    judgment: &judge::AffectJudgment,
    user: &UserTurnSignal,
    feedback: Option<&feedback::TurnFeedbackLog>,
) -> Result<TurnDecision, ValidationError> {
    let guidance = feedback.map(feedback::TurnFeedbackLog::guidance);
    let mut effective_user = user.clone();
    if let Some(guidance) = &guidance {
        for action in &guidance.avoid_actions {
            if !effective_user.blocked_actions.contains(action) {
                effective_user.blocked_actions.push(action.clone());
            }
        }
    }
    // Calibrated rejection blocks even a stated need for advice this turn;
    // uncalibrated hints only demote model-driven paths (which cannot pick
    // advice on their own anyway).
    if judgment.noul.rejects_advice()
        && !effective_user
            .blocked_actions
            .contains(&SupportAction::Advice)
    {
        effective_user.blocked_actions.push(SupportAction::Advice);
    }

    let mut plan = decide_support_plan(turn_id, &judgment.hypothesis, &effective_user)?;
    if let Some(guidance) = &guidance {
        if guidance.open_with_apology {
            for constraint in ["open_with_apology", "no_repeated_followup"] {
                if !plan
                    .language_constraints
                    .iter()
                    .any(|existing| existing == constraint)
                {
                    plan.language_constraints.push(constraint.to_owned());
                }
            }
        }
    }

    let ask_for_options = plan.primary_action == SupportAction::Clarify
        || offers_two_options(&judgment.hypothesis, &effective_user, &plan);
    let clarification =
        clarify::build_clarification(&judgment.hypothesis, &effective_user, ask_for_options)?;
    plan.validate()?;
    Ok(TurnDecision {
        plan,
        clarification,
        superseded_by_correction: judgment.hypothesis.user_correction.is_some(),
    })
}

/// Spec 4.9.4 rows 2 and 3 also offer two low-burden options ("先问想倾诉
/// 还是处理" / "提供两个可选的当下步骤") even though their primary action is
/// reflection, and even when the emotion itself was stated explicitly: the
/// emotion is known, the desired help is not.
fn offers_two_options(
    hypothesis: &AffectHypothesis,
    user: &UserTurnSignal,
    plan: &SupportPlan,
) -> bool {
    if plan.primary_action != SupportAction::ReflectConfirm || user.stated_need.is_some() {
        return false;
    }
    let label = user.stated_emotion.clone().or_else(|| {
        hypothesis
            .affect_candidates
            .first()
            .map(|top| top.label.clone())
    });
    match label {
        Some(AffectLabel::Anger) => true,
        Some(AffectLabel::Anxiety) => hypothesis.arousal >= 1,
        _ => false,
    }
}

/// Plan the turn that immediately follows a misread (spec 4.9.3 step 10):
/// apologize, correct the current state, do not keep asking, and never let
/// the superseded hypothesis speak again (it is dead by
/// [`AffectHypothesis::usable_for_response`] and by
/// [`apply_user_correction`]).
pub fn misread_recovery_plan(
    turn_id: impl Into<String>,
    correction: &UserCorrectionRecord,
) -> Result<SupportPlan, ValidationError> {
    correction.validate()?;
    let mut constraints = base_constraints();
    constraints.extend(
        [
            "open_with_apology",
            "no_repeated_followup",
            "accept_correction_as_authoritative",
            "supersede_prior_hypothesis",
        ]
        .iter()
        .map(|constraint| constraint.to_string()),
    );
    let mut permission_needed = false;
    let secondary_option = correction.corrected_need.as_ref().map(|need| {
        let (action, permission, _) = action_for_need(need, false);
        if permission {
            permission_needed = true;
        }
        action
    });
    let plan = SupportPlan {
        schema_version: SCHEMA_VERSION,
        turn_id: turn_id.into(),
        primary_action: SupportAction::ReflectConfirm,
        secondary_option,
        permission_needed,
        language_constraints: constraints,
        presence_cues: PresenceCues {
            pace: Some("calm".to_owned()),
            pause: Some("longer".to_owned()),
            intensity: Some("soft".to_owned()),
        },
        creates_task: false,
        specialist_dispatched: false,
    };
    plan.validate()?;
    Ok(plan)
}

/// Map a support need to its action. Public so the clarify layer can reuse
/// the same mapping for options.
pub fn action_for_need(
    need: &SupportNeed,
    explicit_transaction: bool,
) -> (SupportAction, bool, PresenceCues) {
    match need {
        SupportNeed::Listening => (SupportAction::Listen, false, PresenceCues::default()),
        SupportNeed::EmotionalConfirmation => (
            SupportAction::ReflectConfirm,
            false,
            PresenceCues::default(),
        ),
        SupportNeed::Companionship => (SupportAction::Accompany, false, PresenceCues::default()),
        SupportNeed::SharedQuiet => (SupportAction::SharedQuiet, false, PresenceCues::default()),
        SupportNeed::Distraction => (SupportAction::Distract, false, PresenceCues::default()),
        SupportNeed::Advice => (SupportAction::Advice, true, PresenceCues::default()),
        SupportNeed::TransactionHelp if explicit_transaction => {
            (SupportAction::Transaction, true, PresenceCues::default())
        }
        SupportNeed::TransactionHelp => (SupportAction::Clarify, false, PresenceCues::default()),
        SupportNeed::PauseInteraction => (
            SupportAction::PauseInteraction,
            false,
            PresenceCues::default(),
        ),
    }
}

/// Apply a correction to current state and make the old hypothesis unusable
/// for response selection. The state version advances immediately.
pub fn apply_user_correction(
    state: &RelationshipState,
    hypothesis: &AffectHypothesis,
    correction: &UserCorrectionRecord,
) -> Result<(RelationshipState, AffectHypothesis), ValidationError> {
    state.validate()?;
    hypothesis.validate()?;
    let next_state = state.apply_correction(correction)?;
    let mut superseded = hypothesis.clone();
    superseded.abstention = true;
    superseded.user_correction = Some(correction.clone());
    superseded.validate()?;
    Ok((next_state, superseded))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hypothesis() -> AffectHypothesis {
        AffectHypothesis {
            schema_version: SCHEMA_VERSION,
            session_id: "session-1".to_owned(),
            hypothesis_id: "hyp-1".to_owned(),
            valence: -1,
            arousal: 0,
            affect_candidates: vec![AffectCandidate {
                label: AffectLabel::Sadness,
                score: 0.8,
            }],
            support_need_candidates: vec![SupportNeedCandidate {
                need: SupportNeed::Companionship,
                score: 0.7,
            }],
            confidence: 0.8,
            answer_confidence: 0.8,
            abstention: false,
            conflict: false,
            sarcasm_or_ambiguity: false,
            calibrated: true,
            evidence_refs: vec!["turn-1-text".to_owned()],
            model_version: "fixture-model-1".to_owned(),
            source: InferenceSource::LocalLaya,
            calibration_version: Some("fixture-cal-1".to_owned()),
            degraded: false,
            degradation_reason: None,
            user_correction: None,
            language: "en".to_owned(),
            input_modality: "text".to_owned(),
        }
    }

    fn correction() -> UserCorrectionRecord {
        UserCorrectionRecord {
            turn_id: "turn-2".to_owned(),
            corrected_emotion: Some(AffectLabel::Tired),
            corrected_need: Some(SupportNeed::Listening),
            boundary: Some("no advice".to_owned()),
            recorded_at: "2026-10-15T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn explicit_user_expression_overrides_inference() {
        assert_eq!(
            current_expression(Some("tired"), Some("sad")),
            Some("tired")
        );
    }

    #[test]
    fn uncalibrated_or_conflicting_model_is_conservative() {
        assert!(!may_select_model_response(false, true, true, false, false));
        assert!(!may_select_model_response(true, true, true, false, true));
        assert!(!may_select_model_response(true, false, true, false, false));
    }

    #[test]
    fn low_confidence_requires_clarification() {
        let mut candidate = hypothesis();
        candidate.confidence = 0.2;
        let plan = decide_support_plan("turn-1", &candidate, &UserTurnSignal::default()).unwrap();
        assert_eq!(plan.primary_action, SupportAction::Clarify);
    }

    #[test]
    fn explicit_need_wins_over_model_candidate() {
        let user = UserTurnSignal {
            stated_emotion: Some(AffectLabel::Tired),
            stated_need: Some(SupportNeed::SharedQuiet),
            ..UserTurnSignal::default()
        };
        let plan = decide_support_plan("turn-1", &hypothesis(), &user).unwrap();
        assert_eq!(plan.primary_action, SupportAction::SharedQuiet);
        assert!(!plan.creates_task && !plan.specialist_dispatched);
    }

    #[test]
    fn conflicting_candidates_require_clarification() {
        let mut candidate = hypothesis();
        candidate.conflict = true;
        let plan = decide_support_plan("turn-1", &candidate, &UserTurnSignal::default()).unwrap();
        assert_eq!(plan.primary_action, SupportAction::Clarify);
    }

    #[test]
    fn explicit_boundary_blocks_a_model_supported_action() {
        let user = UserTurnSignal {
            stated_need: Some(SupportNeed::Advice),
            blocked_actions: vec![SupportAction::Advice],
            boundary: Some("no advice".to_owned()),
            ..UserTurnSignal::default()
        };
        let plan = decide_support_plan("turn-1", &hypothesis(), &user).unwrap();
        assert_eq!(plan.primary_action, SupportAction::Clarify);
        assert!(!plan.permission_needed);
    }

    #[test]
    fn only_one_primary_action_is_emitted() {
        let plan =
            decide_support_plan("turn-1", &hypothesis(), &UserTurnSignal::default()).unwrap();
        // Sadness row: reflect is primary, accompany is only an option.
        assert_eq!(plan.primary_action, SupportAction::ReflectConfirm);
        assert_ne!(plan.secondary_option.as_ref(), Some(&plan.primary_action));
        assert!(plan.validate().is_ok());
    }

    #[test]
    fn correction_immediately_supersedes_old_candidate_and_versions_state() {
        let state = RelationshipState {
            schema_version: SCHEMA_VERSION,
            session_id: "session-1".to_owned(),
            topic: "work".to_owned(),
            emotion: Some(AffectLabel::Sadness),
            intent: Some("companionship".to_owned()),
            user_stated: false,
            boundary: None,
            observed_at: "2026-10-15T00:00:00Z".to_owned(),
            source_turn_id: "turn-1".to_owned(),
            version: 1,
        };
        let (next, superseded) =
            apply_user_correction(&state, &hypothesis(), &correction()).unwrap();
        assert_eq!(next.version, 2);
        assert_eq!(next.emotion, Some(AffectLabel::Tired));
        assert_eq!(next.intent, Some("listening".to_owned()));
        assert!(superseded.abstention);
        assert_eq!(superseded.user_correction, Some(correction()));
    }

    #[test]
    fn correction_only_replaces_fields_the_user_corrected() {
        let state = RelationshipState {
            schema_version: SCHEMA_VERSION,
            session_id: "session-1".to_owned(),
            topic: "work".to_owned(),
            emotion: Some(AffectLabel::Sadness),
            intent: Some("companionship".to_owned()),
            user_stated: false,
            boundary: Some("no advice".to_owned()),
            observed_at: "2026-10-15T00:00:00Z".to_owned(),
            source_turn_id: "turn-1".to_owned(),
            version: 4,
        };
        let partial = UserCorrectionRecord {
            turn_id: "turn-2".to_owned(),
            corrected_emotion: Some(AffectLabel::Tired),
            corrected_need: None,
            boundary: None,
            recorded_at: "2026-10-15T00:01:00Z".to_owned(),
        };
        let next = state.apply_correction(&partial).unwrap();
        assert_eq!(next.emotion, Some(AffectLabel::Tired));
        assert_eq!(next.intent, Some("companionship".to_owned()));
        assert_eq!(next.boundary.as_deref(), Some("no advice"));
    }

    #[test]
    fn explicit_user_signal_updates_current_state_without_model_inference() {
        let state = RelationshipState {
            schema_version: SCHEMA_VERSION,
            session_id: "session-1".to_owned(),
            topic: "work".to_owned(),
            emotion: Some(AffectLabel::Sadness),
            intent: Some("companionship".to_owned()),
            user_stated: false,
            boundary: Some("no advice".to_owned()),
            observed_at: "2026-10-15T00:00:00Z".to_owned(),
            source_turn_id: "turn-1".to_owned(),
            version: 4,
        };
        let signal = UserTurnSignal {
            stated_emotion: Some(AffectLabel::Tired),
            stated_need: Some(SupportNeed::Listening),
            boundary: Some("just listen".to_owned()),
            ..UserTurnSignal::default()
        };
        let next = state
            .apply_user_signal("turn-2", "2026-10-15T00:01:00Z", &signal)
            .unwrap();
        assert_eq!(next.version, 5);
        assert_eq!(next.emotion, Some(AffectLabel::Tired));
        assert_eq!(next.intent, Some("listening".to_owned()));
        assert_eq!(next.boundary.as_deref(), Some("just listen"));
        assert!(next.user_stated);
    }

    #[test]
    fn provenance_and_degraded_source_are_complete() {
        let request = InferenceRequest {
            session_id: "session-1".to_owned(),
            turn_id: "turn-1".to_owned(),
            observations: Vec::new(),
            user_signal: UserTurnSignal::default(),
            language: "en".to_owned(),
            recent_context: Vec::new(),
        };
        let fallback = degraded_fallback(&request, "Laya unavailable").unwrap();
        assert_eq!(fallback.source, InferenceSource::RulesFallback);
        assert_eq!(fallback.model_version, "withu-affect-rules-v1");
        assert!(fallback.degraded && fallback.abstention);
        assert!(fallback.calibration_version.is_none());
        assert_eq!(
            fallback.degradation_reason.as_deref(),
            Some("Laya unavailable")
        );
    }

    struct FixtureAdapter(AffectHypothesis);

    impl AffectInference for FixtureAdapter {
        fn infer(&self, _request: &InferenceRequest) -> Result<AffectHypothesis, InferenceError> {
            Ok(self.0.clone())
        }
    }

    #[test]
    fn adapter_boundary_validates_provenance_and_session_scope() {
        let request = InferenceRequest {
            session_id: "session-1".to_owned(),
            turn_id: "turn-1".to_owned(),
            observations: Vec::new(),
            user_signal: UserTurnSignal::default(),
            language: "en".to_owned(),
            recent_context: Vec::new(),
        };
        assert!(infer_validated(&FixtureAdapter(hypothesis()), &request).is_ok());
        let mut foreign = hypothesis();
        foreign.session_id = "other-session".to_owned();
        assert_eq!(
            infer_validated(&FixtureAdapter(foreign), &request),
            Err(InferenceError::SessionMismatch)
        );
    }
}
