//! Fixture replay for the spec 4.9.4 response-action rule table and the
//! failure paths (T13 automated verification layer).
//!
//! Each scenario from [`withu_affect::fixtures`] is replayed through the
//! full current-turn loop: bounded observations -> fixture judge ->
//! explicit-statement overrides / clarification gating -> one primary
//! action -> session feedback log. The fixture judge is deterministic and
//! uncalibrated, so the replays also pin the conservative boundary: model
//! output only ranks candidates; explicit user statements decide.

use withu_affect::fixtures::{self, FixtureTurn};
use withu_affect::{
    misread_recovery_plan, plan_turn, AffectHypothesis, AffectObservation, ContextRole,
    ContextTurn, FixtureJudge, ObservationModality, Outcome, ResponseOutcome, Retention,
    TurnFeedbackLog, UserTurnSignal, SCHEMA_VERSION,
};

fn observation(turn_id: &str, utterance: &str) -> AffectObservation {
    AffectObservation {
        schema_version: SCHEMA_VERSION,
        turn_id: turn_id.to_owned(),
        modality: ObservationModality::Text,
        observed_signal: utterance.to_owned(),
        source_ref: format!("{turn_id}-text"),
        captured_at: "2026-10-25T00:00:00Z".to_owned(),
        retention: Retention::SessionOnly,
    }
}

fn context_turns(turn: &FixtureTurn) -> Vec<ContextTurn> {
    turn.context
        .iter()
        .map(|(role, text)| ContextTurn {
            role: if *role == "assistant" {
                ContextRole::Assistant
            } else {
                ContextRole::User
            },
            text: (*text).to_owned(),
        })
        .collect()
}

struct Replay {
    hypothesis: AffectHypothesis,
    primary: withu_affect::SupportAction,
    secondary: Option<withu_affect::SupportAction>,
    constraints: Vec<String>,
    clarification: Option<withu_affect::clarify::Clarification>,
    superseded: bool,
}

fn replay_turn(
    judge: &FixtureJudge,
    log: &TurnFeedbackLog,
    turn: &FixtureTurn,
    session: &str,
) -> Replay {
    let request = withu_affect::InferenceRequest {
        session_id: session.to_owned(),
        turn_id: turn.turn_id.to_owned(),
        observations: vec![observation(turn.turn_id, turn.utterance)],
        user_signal: turn.user_signal.clone(),
        language: "zh".to_owned(),
        recent_context: context_turns(turn),
    };
    let judgment = judge.judge(&request).expect("judge");
    let decision =
        plan_turn(turn.turn_id, &judgment, &turn.user_signal, Some(log)).expect("plan_turn");
    Replay {
        hypothesis: judgment.hypothesis,
        primary: decision.plan.primary_action,
        secondary: decision.plan.secondary_option,
        constraints: decision.plan.language_constraints.clone(),
        clarification: decision.clarification,
        superseded: decision.superseded_by_correction,
    }
}

fn close_turn(log: &mut TurnFeedbackLog, turn: &FixtureTurn, primary: withu_affect::SupportAction) {
    if let Some(ref outcome) = turn.outcome {
        let closed = ResponseOutcome {
            schema_version: SCHEMA_VERSION,
            turn_id: turn.turn_id.to_owned(),
            action: primary,
            user_feedback: None,
            next_turn_signal: None,
            outcome: outcome.clone(),
            user_correction: None,
        };
        log.record(closed).expect("feedback record");
    }
}

#[test]
fn replays_all_rule_table_rows_and_failure_paths() {
    for scenario in fixtures::scenarios() {
        let judge = FixtureJudge::new();
        let mut log = TurnFeedbackLog::new("session-fixture");
        let mut prior: Vec<Replay> = Vec::new();
        // split_last returns (last element, all preceding turns).
        let (last, setup) = scenario.turns.split_last().expect("non-empty scenario");

        let mut final_turn = (*last).clone();
        if scenario.expect.carries_correction {
            final_turn.user_signal.correction = Some(fixtures::correction_fixture());
            final_turn.user_signal.boundary = Some("no advice".to_owned());
        }

        for turn in setup {
            let replay = replay_turn(&judge, &log, turn, "session-fixture");
            close_turn(&mut log, turn, replay.primary.clone());
            prior.push(replay);
        }
        let replay = replay_turn(&judge, &log, &final_turn, "session-fixture");

        // Primary and optional secondary action.
        assert_eq!(
            replay.primary, scenario.expect.primary,
            "{}: primary action",
            scenario.name
        );
        if let Some(secondary) = scenario.expect.secondary {
            assert_eq!(
                replay.secondary,
                Some(secondary),
                "{}: secondary option",
                scenario.name
            );
        }

        // Forbidden shortcuts never become the primary action.
        for forbidden in &scenario.expect.forbidden_primary {
            assert_ne!(
                &replay.primary, forbidden,
                "{}: forbidden primary",
                scenario.name
            );
        }

        // Language constraints (row rules + forbidden shortcuts).
        for constraint in &scenario.expect.constraints {
            assert!(
                replay
                    .constraints
                    .iter()
                    .any(|existing| existing == constraint),
                "{}: missing constraint {constraint}",
                scenario.name
            );
        }

        // Candidate ranking from the fixture judge (never a fact).
        if let Some(ref label) = scenario.expect.top_label {
            let top = replay
                .hypothesis
                .affect_candidates
                .first()
                .expect("candidates");
            assert_eq!(
                top.label, *label,
                "{}: top candidate ranking",
                scenario.name
            );
        }

        // Clarification structure: at most two options, neutral fallback.
        if scenario.expect.must_require_clarification {
            assert!(
                replay.hypothesis.requires_clarification(),
                "{}: hypothesis must require clarification",
                scenario.name
            );
        }
        // requires_clarification() is always true for the fixture judge
        // (uncalibrated, per B.20), so "did not label the user" is asserted
        // on the scenarios that actually carry low/conflicting signal.
        if scenario.expect.must_require_clarification && scenario.expect.top_label.is_none() {
            // Low-signal paths must not have labeled the user.
            let top = replay
                .hypothesis
                .affect_candidates
                .first()
                .expect("candidates");
            assert!(
                matches!(
                    top.label,
                    withu_affect::AffectLabel::Unclear | withu_affect::AffectLabel::Mixed
                ),
                "{}: low signal must not pick a concrete label",
                scenario.name
            );
        }

        if let Some(clarification) = &replay.clarification {
            clarification.validate().expect("clarification valid");
            assert!(
                clarification.options.len() <= 2,
                "{}: at most two options",
                scenario.name
            );
            assert_eq!(
                clarification.fallback,
                withu_affect::SupportAction::Listen,
                "{}: neutral fallback",
                scenario.name
            );
        }

        if scenario.expect.must_not_create_task {
            // Row 8: the emotion never auto-creates a task; the transaction
            // itself goes through explicit user authorization elsewhere.
            assert_ne!(replay.primary, withu_affect::SupportAction::Advice);
            // `creates_task`/`specialist_dispatched` are hard-invalidated by
            // SupportPlan::validate for every relationship turn; reaching
            // here with a valid plan proves the boundary.
        }

        if scenario.expect.carries_correction {
            assert!(
                replay.superseded,
                "{}: correction must supersede",
                scenario.name
            );
            assert!(
                !replay.hypothesis.usable_for_response(),
                "{}: corrected hypothesis is dead",
                scenario.name
            );
            // Old reading must not influence the correction turn: the plan
            // went through the correction branch, not the sadness row.
            assert!(
                replay
                    .constraints
                    .iter()
                    .any(|c| c == "acknowledge_correction"),
                "{}: correction branch marker",
                scenario.name
            );
            // The turn-1 sadness hypothesis, once corrected, is formally
            // unusable for response selection (old content is dead, not
            // averaged in).
            if let Some(old) = prior.first() {
                let state = withu_affect::RelationshipState::empty(
                    "session-fixture",
                    "t1",
                    "2026-10-25T00:00:00Z",
                );
                let (_next, superseded) = withu_affect::apply_user_correction(
                    &state,
                    &old.hypothesis,
                    &fixtures::correction_fixture(),
                )
                .expect("apply_user_correction");
                assert!(
                    !superseded.usable_for_response() && superseded.abstention,
                    "{}: superseded old hypothesis must abstain",
                    scenario.name
                );
            }
            let recovery = misread_recovery_plan("t2-recovery", &fixtures::correction_fixture())
                .expect("recovery plan");
            assert!(recovery
                .language_constraints
                .iter()
                .any(|constraint| constraint == "open_with_apology"));
        }
    }
}

#[test]
fn scenario_coverage_is_complete() {
    let scenarios = fixtures::scenarios();
    assert_eq!(scenarios.len(), 10, "8 rule rows + 2 failure paths");
    let rows: Vec<&str> = scenarios
        .iter()
        .filter(|scenario| scenario.spec_ref.starts_with("4.9.4"))
        .map(|scenario| scenario.spec_ref)
        .collect();
    for row in 1..=8 {
        let expected = format!("4.9.4 row {row}");
        assert!(rows.contains(&expected.as_str()), "missing spec row {row}");
    }
}

#[test]
fn bounded_context_is_enforced_at_the_request_boundary() {
    let turn = fixtures::scenarios()[0].turns[0].clone();
    let mut request = withu_affect::InferenceRequest {
        session_id: "s".to_owned(),
        turn_id: turn.turn_id.to_owned(),
        observations: vec![observation(turn.turn_id, turn.utterance)],
        user_signal: UserTurnSignal::default(),
        language: "zh".to_owned(),
        recent_context: context_turns(&turn),
    };
    assert!(request.validate().is_ok());
    request.recent_context = (0..5)
        .map(|index| ContextTurn {
            role: ContextRole::User,
            text: format!("历史 {index}"),
        })
        .collect();
    assert_eq!(
        request.validate(),
        Err(withu_affect::ValidationError::RecentContextTooManyTurns)
    );
    request.recent_context = vec![ContextTurn {
        role: ContextRole::User,
        text: "长".repeat(withu_affect::MAX_CONTEXT_TURN_CHARS + 1),
    }];
    assert_eq!(
        request.validate(),
        Err(withu_affect::ValidationError::RecentContextTurnTooLong)
    );
}

#[test]
fn outcome_is_only_current_session_and_never_a_fact() {
    let judge = FixtureJudge::new();
    let mut log = TurnFeedbackLog::new("session-fixture");
    let turn = FixtureTurn::say("t1", "我有点难过").with_outcome(Outcome::Improved);
    let replay = replay_turn(&judge, &log, &turn, "session-fixture");
    close_turn(&mut log, &turn, replay.primary);
    assert_eq!(log.guidance().last_outcome, Some(Outcome::Improved));
    assert!(!log.guidance().open_with_apology);
    // The hypothesis stays a hypothesis: the log never rewrites it.
    assert!(replay.hypothesis.validate().is_ok());
}
