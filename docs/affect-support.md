# Affect and Support Boundary

`crates/withu-affect` owns the current relationship turn for the Comfort Demo.
It accepts signal references, produces a structured affect hypothesis, chooses
one support action, and records response feedback. The types are serializable
against the v1 contracts in `contracts/v1/`.

The model output is always a candidate. A stated emotion, need, boundary, or
correction from the user wins over a model candidate. A low-confidence,
uncalibrated, conflicting, sarcastic, or ambiguous result chooses clarification
or neutral listening. The decision has one primary action and sets both task
creation and specialist dispatch to false. Advice and transaction help require
an explicit permission boundary; a relationship turn never creates a task.

`AffectInference` is the replaceable Laya/model worker boundary. Every
hypothesis carries `source`, `model_version`, `calibration_version`,
`confidence`, `answer_confidence`, `abstention`, and an optional correction.
`degraded_fallback` marks Laya unavailability as an explicit rules fallback
with a fixed rules version, a reason, zero confidence, and abstention. It does
not claim that Laya ran and does not upload raw text or audio.

Corrections immediately supersede the old hypothesis and increment the
versioned `RelationshipState`. The affect crate exposes no conversion from an
`AffectHypothesis` to a memory candidate: an unconfirmed current-turn
inference cannot become long-term memory. A separately confirmed memory
projection belongs to the future memory integration and is intentionally not
implemented here.

## Current integration and remaining verification

- D1 server relationship-turn route and renderer support/feedback controls were integrated as `6112596`. The explicit user signal remains authoritative; this is not cloud emotion inference.
- Conversation binding, TTL and one-time support projection into text/Realtime/presence consumption are being completed; final integrated verification is pending.
- Real cloud model quality, acoustic echo separation, a calibrated Laya adapter and durable user-confirmed memory projection are not proven by local fixtures. No Laya model is bundled or downloaded.
- Live persists call-duration summaries only; no transcript or raw-audio retention is added.
