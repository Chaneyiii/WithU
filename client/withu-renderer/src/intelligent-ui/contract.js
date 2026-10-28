export const REPLY_KINDS = Object.freeze(['text', 'summary', 'list', 'selection', 'approval', 'error', 'unavailable']);
export const SURFACE_STATES = Object.freeze(['loading', 'ready', 'pending_approval', 'applied', 'failed', 'expired', 'closed', 'recovering']);
export const RECEIPT_CODES = Object.freeze(['validation', 'authorization', 'scope', 'version', 'expired', 'revoked', 'duplicate', 'cancelled', 'connector_failure', 'lifecycle']);

const keys = (value) => Object.keys(value || {});
const hasOnly = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const unknown = keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${label} contains unknown field ${unknown[0]}`);
};
const string = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
};
const integer = (value, label) => {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
};

export function validateActionRef(actionRef, {required = false} = {}) {
  if (actionRef === null || actionRef === undefined) {
    if (required) throw new TypeError('action_ref is required for this block');
    return null;
  }
  hasOnly(actionRef, ['action_id', 'expected_revision', 'approval_ref', 'idempotency_key', 'cancel_token', 'expires_at'], 'action_ref');
  string(actionRef.action_id, 'action_ref.action_id');
  integer(actionRef.expected_revision, 'action_ref.expected_revision');
  if (actionRef.approval_ref !== null) string(actionRef.approval_ref, 'action_ref.approval_ref');
  string(actionRef.idempotency_key, 'action_ref.idempotency_key');
  string(actionRef.cancel_token, 'action_ref.cancel_token');
  integer(actionRef.expires_at, 'action_ref.expires_at');
  return Object.freeze({...actionRef});
}

function validateItem(item, label) {
  hasOnly(item, ['id', 'label', 'description', 'version'], label);
  string(item.id, `${label}.id`); string(item.label, `${label}.label`);
  if (typeof item.description !== 'string') throw new TypeError(`${label}.description must be a string`);
  integer(item.version, `${label}.version`);
}

function payload_app(payload) { return payload ? payload.app : undefined; }
function validateApp(app) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) throw new TypeError('payload.app must be an object');
  hasOnly(app, ['uri', 'html'], 'payload.app');
  if (typeof app.uri !== 'string' || !app.uri || app.uri.length > 512) throw new TypeError('payload.app.uri is invalid');
  if (typeof app.html !== 'string' || app.html.length > 1048576) throw new TypeError('payload.app.html is invalid');
}

export function validateReplyBlock(block) {
  hasOnly(block, ['schema_version', 'block_id', 'conversation_id', 'turn_id', 'source', 'status_version', 'visibility', 'kind', 'action_ref', 'payload'], 'reply_block');
  if (block.schema_version !== 1) throw new TypeError('reply_block.schema_version must be 1');
  string(block.block_id, 'block_id'); string(block.conversation_id, 'conversation_id'); string(block.turn_id, 'turn_id');
  if (!['withu', 'local_adapter', 'user'].includes(block.source)) throw new TypeError('reply_block.source is unknown');
  integer(block.status_version, 'status_version');
  if (!['conversation', 'turn', 'private_preview'].includes(block.visibility)) throw new TypeError('reply_block.visibility is unknown');
  if (!REPLY_KINDS.includes(block.kind)) throw new TypeError('reply_block.kind is unknown');
  validateActionRef(block.action_ref);
  hasOnly(block.payload, ['text', 'title', 'body', 'code', 'message', 'retryable', 'items', 'options', 'decision', 'app'], 'reply_block.payload');
  // MCP results carry their App document here. The JSON contract has always
  // allowed it (contracts/v1/reply-block.schema.json); this allowlist did not,
  // so the first real App block threw and the window fell into the error
  // boundary instead of rendering it.
  if (payload_app(block.payload) !== undefined) validateApp(block.payload.app);
  const payload = block.payload;
  if (block.kind === 'text') string(payload.text, 'payload.text');
  if (block.kind === 'summary') { string(payload.title, 'payload.title'); string(payload.body, 'payload.body'); }
  if (block.kind === 'list') { string(payload.title, 'payload.title'); if (!Array.isArray(payload.items) || !payload.items.length) throw new TypeError('payload.items is required'); payload.items.forEach((item, index) => validateItem(item, `payload.items[${index}]`)); }
  if (block.kind === 'selection') { string(payload.title, 'payload.title'); if (!Array.isArray(payload.options) || !payload.options.length) throw new TypeError('payload.options is required'); payload.options.forEach((item, index) => validateItem(item, `payload.options[${index}]`)); validateActionRef(block.action_ref, {required: true}); }
  if (block.kind === 'approval') { string(payload.title, 'payload.title'); string(payload.body, 'payload.body'); if (!['pending', 'allow', 'deny', 'expired'].includes(payload.decision)) throw new TypeError('payload.decision is unknown'); validateActionRef(block.action_ref, {required: true}); }
  if (block.kind === 'error' || block.kind === 'unavailable') { string(payload.code, 'payload.code'); string(payload.message, 'payload.message'); if (typeof payload.retryable !== 'boolean') throw new TypeError('payload.retryable must be boolean'); }
  return Object.freeze(block);
}

export function validateReceipt(receipt) {
  hasOnly(receipt, ['schema_version', 'action_id', 'idempotency_key', 'status', 'result', 'error', 'effect_committed', 'observed_at'], 'receipt');
  if (receipt.schema_version !== 1) throw new TypeError('receipt.schema_version must be 1');
  string(receipt.action_id, 'receipt.action_id'); string(receipt.idempotency_key, 'receipt.idempotency_key');
  if (!['applied', 'failed', 'rejected'].includes(receipt.status)) throw new TypeError('receipt.status is unknown');
  if (receipt.result !== null) { hasOnly(receipt.result, ['summary', 'affected_targets'], 'receipt.result'); string(receipt.result.summary, 'receipt.result.summary'); if (!Array.isArray(receipt.result.affected_targets) || receipt.result.affected_targets.some(target => typeof target !== 'string')) throw new TypeError('receipt.result.affected_targets is invalid'); }
  if (receipt.error !== null) { hasOnly(receipt.error, ['schema_version', 'code', 'message', 'retryable', 'action_id', 'committed_targets'], 'receipt.error'); if (receipt.error.schema_version !== 1 || !RECEIPT_CODES.includes(receipt.error.code)) throw new TypeError('receipt.error is invalid'); string(receipt.error.message, 'receipt.error.message'); string(receipt.error.action_id, 'receipt.error.action_id'); if (typeof receipt.error.retryable !== 'boolean' || !Array.isArray(receipt.error.committed_targets)) throw new TypeError('receipt.error details are invalid'); }
  if (typeof receipt.effect_committed !== 'boolean') throw new TypeError('receipt.effect_committed must be boolean');
  integer(receipt.observed_at, 'receipt.observed_at');
  return Object.freeze(receipt);
}

export function validateSurfaceState(state) {
  hasOnly(state, ['schema_version', 'surface_id', 'block_id', 'state', 'state_version', 'source_status_version', 'visibility', 'action_ref', 'receipt', 'updated_at'], 'surface_state');
  if (state.schema_version !== 1) throw new TypeError('surface_state.schema_version must be 1');
  string(state.surface_id, 'surface_id'); string(state.block_id, 'block_id');
  if (!SURFACE_STATES.includes(state.state)) throw new TypeError('surface_state.state is unknown');
  integer(state.state_version, 'state_version');
  integer(state.source_status_version, 'source_status_version');
  if (!['conversation', 'turn', 'private_preview'].includes(state.visibility)) throw new TypeError('surface_state.visibility is unknown');
  validateActionRef(state.action_ref);
  if (state.receipt !== null) validateReceipt(state.receipt);
  integer(state.updated_at, 'updated_at');
  return Object.freeze(state);
}
