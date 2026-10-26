# D6 Intelligent UI

D6 adds a Withu-owned reply-block surface for Comfort. It is an additive renderer seam and a contract/replay package; it does not change the chat shell, mode selector, desktop bridge, preload, IPC, server routes, or MCP App work.

## Contract

`contracts/v1/reply-block.schema.json` binds every block to `block_id`, `conversation_id`, `turn_id`, source, status version and visibility. The allowed kinds are text, summary, list, selection, approval, error and unavailable. Payloads are plain structured text and lists; the renderer never accepts or injects HTML. `contracts/v1/surface-state.schema.json` carries the component state version and receipt reference.

An interactive block carries an opaque action reference containing the D4 `action_id`, expected revision, approval reference, idempotency key, cancel token and expiry. Approval/token values live only in the in-memory DTO and are passed to the host adapter; the UI never writes them to `localStorage`.

All D6 timestamps use Unix seconds, matching D4. Selection blocks bind the selected `option_id` and positive `option_version` into the same typed intent for click and voice input; a stale or unknown option is rejected before submission. Surface state records the source `status_version`, so newer host blocks with the same ID replace the old action reference while closed surfaces remain closed.

## Renderer seam

Import `IntelligentSurface` from `client/withu-renderer/src/intelligent-ui/index.js` and pass:

```js
<IntelligentSurface
  blocks={replyBlocks}
  onAction={(typedIntent) => actionAdapter.submit(typedIntent)}
  testPreview={false}
/>
```

`onAction` is the only side-effect boundary. A click and a voice invocation both produce the same submit-shaped `withu_action_intent` DTO and call this adapter. Closing an active block emits the same typed DTO shape with `intent_kind: cancel`, so the host can cancel by its D4 cancel token. The host is responsible for constructing/validating the full D4 `ActionSpec`, approval decision and execution. If it returns a D4 `ActionReceipt`, the surface renders applied, failed, expired or rejected details. CAS/version conflicts, revocation, cancellation, duplicate idempotency and lifecycle failures remain visible as receipt errors. Expired action references are rejected before adapter submission. Close stops further UI submission and invalidates late receipts; Retry clears a failed receipt and re-enters ready through loading; Recover waits for a host block update and does not replay a prior action.

The current server has no D6 route. The preview adapter is deliberately local and marked as a test preview; it records intents but does not create a reminder or claim a production receipt. This is not an MCP App and contains no resources/read, AppBridge, iframe, sandbox, negotiation or teardown implementation.

## Replay and preview

Run the pure D6 replay:

```text
node checks/d6-replay.mjs
```

Run the asset check:

```text
node checks/d6-preview.mjs
```

Start the standalone visual preview for personal inspection:

```text
node checks/d6-preview.mjs --serve
```

Then open `http://127.0.0.1:4174/`. The page is intentionally separate from `App.jsx`; its badge and event log identify the local adapter boundary and do not represent a connected server or successful side effect.
