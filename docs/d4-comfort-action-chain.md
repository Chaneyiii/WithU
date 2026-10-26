# D4 Comfort Action Chain

This document records the small transaction boundary delivered for the Comfort
demo. It is a server-side contract and adapter seam; it does not add a Cowork
workspace, an Intelligent UI host, or a real external service integration.

## Flow

1. A user turn creates a `DelegatedGoal` with a user evidence reference. An
   emotion, model suggestion, or connector response cannot create one.
2. The trusted server builds a `PlanPreview`. Each action has a target and
   object version, bounded parameters and digest, connector capability, data
   scope, impact, policy/authorization versions, expiry, idempotency key and
   cancel token. Preview performs no connector or adapter call and advertises
   `external_effects: false`.
3. The server validates the action against an `ActionCatalog` and a fake/local
   `ConnectorRegistry`. Connector authorization checks capability, target
   version, data scope and revocation/version state.
4. `Manual` is the default. `Auto` may execute only catalog-defined,
   read-only, `safe_for_auto` actions. Writes, deletes, messages, purchases,
   payments, appointment confirmation, publishing and account changes are
   always individually explicit Allow actions.
5. The server consumes a single-use opaque grant, invokes the local adapter,
   and returns an `ActionReceipt`. Repeated idempotency keys, stale cards,
   version changes, expiry, cancellation and revoked connectors are rejected
   before submission. Adapter failures carry a structured error receipt and
   any already committed target IDs.

## Ownership and integration

- `withu-orchestrator` owns goal evidence, plan preview, policy catalog,
  approval/execute sequencing, receipts and specialist candidate boundaries.
- `withu-approvals` owns per-action cards and opaque one-use grants. It retains
  the legacy v1 API for compatibility.
- `withu-connectors` owns typed action validation, parameter bounds/digests,
  connector capability/scope/version checks, cancellation, and the
  `FakeLocalAdapter` used by isolated tests.
- `withu-scheduler` owns application-running gating, explicit timezone and
  authorization, pause/resume/delete CAS, cancellation tokens and configurable
  concurrency, budget, retry and rate limits.
- `contracts/v1/action-execution.schema.json`, `plan-preview.schema.json`,
  `approval-card.schema.json`, `action-receipt.schema.json`,
  `error-receipt.schema.json`, `connector-capability.schema.json` and
  `schedule-policy.schema.json` are additive contracts. Existing D1/D2 files,
  renderer files, storage/memory/affect crates and shared version metadata are
  untouched.

The D9 D4 integration adds real owner stdio RPC routes in
`apps/withu-server/src/actions.rs`: `withu:action:preview`, `withu:action:decide`,
`withu:action:execute` and `withu:action:cancel`. The typed preload methods are
`actionPreview`, `actionDecide`, `actionExecute` and `actionCancel`. GUI and MCP
hosts submit a bounded proposal; they cannot submit an approved card, grant,
receipt, expiry, idempotency key or cancel token as execution authority.

This minimal integration allowlists only `local_annotation` against the
`comfort:local` / `demo-item` target. Proposal evidence must reference a durable
Comfort user message whose text equals the delegated goal description. The
server builds a Manual action with policy/authorization/action version 1,
five-minute expiry and fresh action, approval, idempotency and cancel bindings.
`allow_once` is the only command that explicitly permits execution; it is
scoped to the owner session and exact action/card. No pending state survives
server restart and no renderer-supplied approval-success flag is accepted.

The fake/local transport has no network or provider credentials. Only after
D4 returns Applied does the server commit a real local annotation to owner
SQLite. A commit failure returns a Failed receipt with no committed target.
`withu:annotation:get` (`annotationGet`) and `withu:annotation:list`
(`annotationList`) read the scope/version-bound record across restarts. The
initial empty target has logical version 1; the first committed annotation is
version 2 and each edit increments it. Preview and execution both enforce CAS,
so a competing old card cannot overwrite a newer annotation. Receipts explicitly
describe this local effect and never report external service completion.

The proposal, decision, execution and cancellation schemas are
`action-proposal.schema.json`, `typed-approval-decision.schema.json`,
`action-execute-request.schema.json` and `action-cancel-request.schema.json`.
Preview returns `{schema_version, plan, approval}`, decision returns
`{approval}`, and execution returns `{receipt}` using the existing D4 schemas.
Read requests use `annotation-get.schema.json` / `annotation-list.schema.json`;
records use `local-annotation.schema.json`.

The server retains at most 128 action plans/grants per process lifetime and
fails closed at capacity. A bounded 128-entry audit snapshot persists action,
decision and receipt metadata without user text, parameters or authority
tokens. Durable annotation content is separate from that audit. Audit commit
failure stops further submissions while preserving execution receipts and
readback of any already committed annotation.

## Replay

`crates/withu-orchestrator/tests/d4_replay.rs` uses only synthetic user evidence,
fake connector state and local adapter effects. It verifies Auto read-only,
Manual per-action Allow, duplicate idempotency, cancellation before submission,
and honest result/error receipts without network or paid credentials.

`checks/d4-rpc.mjs` exercises the actual `ClientServerOwner` and Rust server
process, including real annotation readback and restart, per-action Allow,
duplicate/stale/schema/scope rejection and honest adapter failure. Server unit
tests cover deterministic expiry, wrong session/card/cancel bindings, forged
approval-success fields, Deny, cancellation and rolled-back SQLite commit.
