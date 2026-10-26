//! Replay fixtures for the spec 4.9.4 response-action rule table and the
//! failure paths (automated verification layer of the four-layer evidence
//! record; fixture replay, not live-model evaluation).
//!
//! Every scenario is a short turn script with an expectation. The runner
//! (integration test `tests/fixture_replay.rs`) feeds each turn through
//! [`crate::judge::FixtureJudge`] and [`crate::plan_turn`], so the whole
//! observe -> judge -> clarify/override -> plan -> feedback loop is exercised
//! deterministically. The fixture judge is uncalibrated; scenarios therefore
//! also encode the conservative boundary: model output only ranks, explicit
//! user statements decide.

use crate::{AffectLabel, Outcome, SupportAction, UserTurnSignal};

/// One scripted user turn.
#[derive(Clone, Debug)]
pub struct FixtureTurn {
    pub turn_id: &'static str,
    /// The sanitized current utterance (text observation signal).
    pub utterance: &'static str,
    /// Bounded recent context, oldest first: (role, text).
    pub context: &'static [(&'static str, &'static str)],
    /// Explicit user statements for this turn (priority-1 evidence; in the
    /// live pipeline the upstream extractor produces these).
    pub user_signal: UserTurnSignal,
    /// Outcome to record for this turn once the response has been delivered.
    pub outcome: Option<Outcome>,
}

impl FixtureTurn {
    pub fn say(turn_id: &'static str, utterance: &'static str) -> Self {
        Self {
            turn_id,
            utterance,
            context: &[],
            user_signal: UserTurnSignal::default(),
            outcome: None,
        }
    }

    pub fn with_signal(mut self, user_signal: UserTurnSignal) -> Self {
        self.user_signal = user_signal;
        self
    }

    pub fn with_outcome(mut self, outcome: Outcome) -> Self {
        self.outcome = Some(outcome);
        self
    }
}

/// What the replay asserts for the final turn of a scenario.
#[derive(Clone, Debug)]
pub struct Expectation {
    pub primary: SupportAction,
    pub secondary: Option<SupportAction>,
    /// Whether a clarification offer must / must not be present.
    pub clarify: Option<bool>,
    /// Constraints that must all be present on the plan.
    pub constraints: Vec<&'static str>,
    /// Actions that must not appear as primary (shortcut forbidden).
    pub forbidden_primary: Vec<SupportAction>,
    /// Top affect label expected from the fixture judge (candidate ranking,
    /// never a fact).
    pub top_label: Option<AffectLabel>,
    /// Hypothesis must require clarification (low confidence / conflict /
    /// abstention / uncalibrated).
    pub must_require_clarification: bool,
    /// Plan must not create tasks or dispatch specialists (asserted
    /// explicitly for row 8).
    pub must_not_create_task: bool,
    /// The scenario's final turn carries an explicit user correction.
    pub carries_correction: bool,
}

impl Expectation {
    pub fn primary(action: SupportAction) -> Self {
        Self {
            primary: action,
            secondary: None,
            clarify: None,
            constraints: Vec::new(),
            forbidden_primary: Vec::new(),
            top_label: None,
            must_require_clarification: false,
            must_not_create_task: false,
            carries_correction: false,
        }
    }

    pub fn secondary(mut self, action: SupportAction) -> Self {
        self.secondary = Some(action);
        self
    }

    pub fn with(mut self, constraint: &'static str) -> Self {
        self.constraints.push(constraint);
        self
    }

    pub fn forbid(mut self, action: SupportAction) -> Self {
        self.forbidden_primary.push(action);
        self
    }

    pub fn top(mut self, label: AffectLabel) -> Self {
        self.top_label = Some(label);
        self
    }

    pub fn must_clarify(mut self) -> Self {
        self.must_require_clarification = true;
        self
    }

    pub fn task_boundary(mut self) -> Self {
        self.must_not_create_task = true;
        self
    }

    pub fn corrected(mut self) -> Self {
        self.carries_correction = true;
        self
    }
}

/// A named scenario mapped to its spec row or failure path.
#[derive(Clone, Debug)]
pub struct FixtureScenario {
    pub name: &'static str,
    /// Which spec 4.9.4 row (or failure path) this covers.
    pub spec_ref: &'static str,
    pub turns: Vec<FixtureTurn>,
    pub expect: Expectation,
}

/// All replay scenarios: the 8 rows of spec 4.9.4 plus the failure paths.
///
/// Rows 1-6 carry the emotion as an explicit user statement, exactly like
/// the table's evidence column ("明确表达…"): explicit statements are
/// priority-1 evidence (spec 4.9.1) and must drive the rule table even
/// though the fixture judge itself is uncalibrated and could never select a
/// response on its own.
pub fn scenarios() -> Vec<FixtureScenario> {
    fn stated(label: AffectLabel) -> UserTurnSignal {
        UserTurnSignal {
            stated_emotion: Some(label),
            ..UserTurnSignal::default()
        }
    }
    vec![
        FixtureScenario {
            name: "row1_sadness_low_arousal",
            spec_ref: "4.9.4 row 1",
            turns: vec![
                FixtureTurn::say("t1", "今天没什么力气，就是有点难过，也有点想哭")
                    .with_signal(stated(AffectLabel::Sadness)),
            ],
            expect: Expectation::primary(SupportAction::ReflectConfirm)
                .top(AffectLabel::Sadness)
                .with("no_immediate_solution_list")
                .with("no_forced_positivity")
                .with("no_diagnosis")
                .forbid(SupportAction::Advice)
                .forbid(SupportAction::Transaction),
        },
        FixtureScenario {
            name: "row2_anxiety_high_arousal",
            spec_ref: "4.9.4 row 2",
            turns: vec![FixtureTurn::say(
                "t1",
                "明天就要交了还没弄完，我真的很焦虑，心慌得不行，特别紧张",
            )
            .with_signal(stated(AffectLabel::Anxiety))],
            expect: Expectation::primary(SupportAction::ReflectConfirm)
                .top(AffectLabel::Anxiety)
                .with("no_diagnosis_of_disorder")
                .with("no_repeated_why_questions")
                .with("no_unconsented_exercises")
                .with("reduce_pace_and_information")
                .with("offer_two_present_steps")
                .forbid(SupportAction::Advice),
        },
        FixtureScenario {
            name: "row3_anger_facts_unclear",
            spec_ref: "4.9.4 row 3",
            turns: vec![
                FixtureTurn::say("t1", "真是气死了，这件事太离谱了，我快受不了了")
                    .with_signal(stated(AffectLabel::Anger)),
            ],
            expect: Expectation::primary(SupportAction::ReflectConfirm)
                .top(AffectLabel::Anger)
                .with("ask_vent_or_handle")
                .with("no_danger_or_personality_labels")
                .with("no_endorsing_harm")
                .forbid(SupportAction::Advice),
        },
        FixtureScenario {
            name: "row4_shame_self_blame",
            spec_ref: "4.9.4 row 4",
            turns: vec![FixtureTurn::say(
                "t1",
                "都怪我，要不是我记错时间就不会这样了，我真是没用，特别自责",
            )
            .with_signal(stated(AffectLabel::Shame))],
            expect: Expectation::primary(SupportAction::ReflectConfirm)
                .top(AffectLabel::Shame)
                .with("no_empty_praise")
                .with("no_moralizing")
                .with("no_unverified_absolution")
                .with("separate_act_from_worth")
                .forbid(SupportAction::Advice),
        },
        FixtureScenario {
            name: "row5_loneliness_wants_company",
            spec_ref: "4.9.4 row 5",
            turns: vec![
                FixtureTurn::say("t1", "晚上就我一个人，有点孤独，你在就好，陪我待一会儿")
                    .with_signal(stated(AffectLabel::Loneliness)),
            ],
            expect: Expectation::primary(SupportAction::Accompany)
                .top(AffectLabel::Loneliness)
                .with("no_only_relationship_claims")
                .with("no_dependency_design")
                .with("no_notification_tracking")
                .forbid(SupportAction::Distract),
        },
        FixtureScenario {
            name: "row6_joy_relief",
            spec_ref: "4.9.4 row 6",
            turns: vec![
                FixtureTurn::say("t1", "考过了！太开心了，真是松了口气，如释重负")
                    .with_signal(stated(AffectLabel::Joy)),
            ],
            expect: Expectation::primary(SupportAction::ReflectConfirm)
                .top(AffectLabel::Joy)
                .with("no_topic_stealing")
                .with("no_intimacy_inflation")
                .with("no_forced_productivity_pivot")
                .forbid(SupportAction::Transaction)
                .forbid(SupportAction::Distract),
        },
        FixtureScenario {
            name: "row7_conflicting_candidates_clarify",
            spec_ref: "4.9.4 row 7",
            turns: vec![FixtureTurn::say(
                "t1",
                "我有点难过，但又替她开心，说不上来是什么感觉",
            )],
            expect: Expectation::primary(SupportAction::Clarify)
                .secondary(SupportAction::Listen)
                .must_clarify()
                .with("no_single_label")
                .with("transparent_uncertainty")
                .with("max_two_clarify_options")
                .forbid(SupportAction::Advice),
        },
        FixtureScenario {
            name: "row8_explicit_transaction_with_emotion",
            spec_ref: "4.9.4 row 8",
            turns: vec![FixtureTurn::say(
                "t1",
                "今天烦死了，先不说了。对了，帮我查一下明天下午的天气，再提醒我拿快递",
            )
            .with_signal(UserTurnSignal {
                explicit_transaction_request: true,
                ..UserTurnSignal::default()
            })],
            expect: Expectation::primary(SupportAction::Transaction)
                .task_boundary()
                .with("acknowledge_emotion_before_transaction")
                .with("no_auto_task_creation")
                .with("explicit_user_statement_priority")
                .with("no_diagnosis"),
        },
        // ---- Failure paths (first-class, spec 4.9.3 steps 5/10) ----
        FixtureScenario {
            name: "fail_low_signal_never_labels",
            spec_ref: "4.9.3 step 5 (low confidence must not label)",
            turns: vec![FixtureTurn::say("t1", "嗯。")],
            expect: Expectation::primary(SupportAction::Clarify)
                .secondary(SupportAction::Listen)
                .must_clarify()
                .with("no_single_label")
                .forbid(SupportAction::Advice)
                .forbid(SupportAction::Transaction),
        },
        FixtureScenario {
            name: "fail_correction_kills_old_reading",
            spec_ref: "4.9.3 steps 3+10 (user correction priority)",
            turns: vec![
                FixtureTurn::say("t1", "我今天有点难过，有点失落").with_outcome(Outcome::Misread),
                FixtureTurn::say(
                    "t2",
                    "你理解错了，我不是难过，我是气他们没提前说，而且别给建议",
                ),
            ],
            expect: Expectation::primary(SupportAction::ReflectConfirm)
                .corrected()
                .with("open_with_apology")
                .with("no_repeated_followup")
                .with("accept_user_account_as_authoritative")
                .forbid(SupportAction::Advice)
                .forbid(SupportAction::Distract),
        },
    ]
}

/// The correction record attached to the `fail_correction_kills_old_reading`
/// scenario's second turn (kept here so the runner and the scenario agree).
/// The user corrects the emotion and sets a boundary, but does not name a
/// new need: the turn's job is apology + acceptance, not a new action.
pub fn correction_fixture() -> crate::UserCorrectionRecord {
    crate::UserCorrectionRecord {
        turn_id: "t2".to_owned(),
        corrected_emotion: Some(AffectLabel::Anger),
        corrected_need: None,
        boundary: Some("no advice".to_owned()),
        recorded_at: "2026-10-25T00:02:00Z".to_owned(),
    }
}
