// Renderer event mapping regression (no browser needed).
// Guards the T14 capsule wiring: the server emits memory.candidate.created with
// FLAT fields; the renderer used to read nested keys only and the capsule never
// appeared while every server-side wire check stayed green.
import assert from 'node:assert/strict';
import {memoryCandidateFromEvent} from '../client/withu-renderer/src/memory-candidate-event.js';
import {validateReplyBlock} from '../client/withu-renderer/src/intelligent-ui/contract.js';

// Sample 1: byte-shape of the real server payload (apps/withu-server/src/main.rs
// json! block of memory.candidate.created).
const serverEvent = {
  record: { event: 'memory.candidate.created' },
  data: {
    conversation_id: 'c-1',
    kind: 'explicit_preference',
    subject: '偏好',
    content: '用户喜欢无糖乌龙茶',
    state_version: 3,
    message_id: 'm-1',
  },
};
const fromServer = memoryCandidateFromEvent(serverEvent);
assert.equal(fromServer?.content, '用户喜欢无糖乌龙茶');
assert.equal(fromServer?.kind, 'explicit_preference');
assert.equal(fromServer?.subject, '偏好');
assert.equal(fromServer?.state_version, 3);
assert.equal(fromServer?.message_id, 'm-1');
console.log('PASS flat server payload maps to capsule candidate');

// Sample 2: legacy nested shape still maps (defense for other emitters).
const nested = memoryCandidateFromEvent({ data: { memory_candidate: { kind: 'stable_fact', subject: '称呼', content: '叫我小张', state_version: 0, message_id: 'm-2' } } });
assert.equal(nested?.content, '叫我小张');
console.log('PASS nested payload maps to capsule candidate');

// Negative 1: reply events must never become candidates.
assert.equal(memoryCandidateFromEvent({ record: { event: 'reply.updated' }, data: { reply: { state: 'delta', text: '用户喜欢无糖乌龙茶' } } }), null);
console.log('PASS reply.updated is not a candidate');

// Negative 2: flat look-alike fields on a non-candidate event are ignored.
assert.equal(memoryCandidateFromEvent({ record: { event: 'reply.updated' }, data: { content: 'x', state_version: 1, message_id: 'm-3' } }), null);
console.log('PASS flat look-alike on non-candidate event is rejected');

// Negative 3: malformed candidate events are dropped instead of crashing.
assert.equal(memoryCandidateFromEvent({ record: { event: 'memory.candidate.created' }, data: { content: '', state_version: 1, message_id: 'm-4' } }), null);
assert.equal(memoryCandidateFromEvent({ record: { event: 'memory.candidate.created' }, data: {} }), null);
console.log('PASS malformed candidate payloads are dropped safely');

// Block contract: an MCP result block carries its App document in payload.app.
// The server has always sent it and the JSON contract has always allowed it,
// but the renderer allowlist rejected the field, so the first real App block
// threw and the window fell into the error boundary instead of rendering.
const mcpBlock = {
  schema_version: 1, block_id: 'mcp:op:result', conversation_id: 'c-1', turn_id: 'op',
  source: 'withu', status_version: 1, visibility: 'conversation', kind: 'text', action_ref: null,
  payload: { text: 'annotated:记住这条', app: { uri: 'ui://withu-check/app', html: '<!doctype html><html><body>ok</body></html>' } },
};
assert.doesNotThrow(() => validateReplyBlock(mcpBlock), 'an MCP result block with an App must validate');
assert.ok(Object.isFrozen(validateReplyBlock(mcpBlock)));
assert.doesNotThrow(() => validateReplyBlock({ ...mcpBlock, payload: { text: 'no app here' } }), 'a plain text block still validates');
assert.throws(() => validateReplyBlock({ ...mcpBlock, payload: { text: 'x', app: { uri: 'ui://a' } } }), /payload\.app\.html/, 'an App without html is refused');
assert.throws(() => validateReplyBlock({ ...mcpBlock, payload: { text: 'x', app: { uri: 'ui://a', html: 'x', extra: 1 } } }), /payload\.app/, 'an App with unknown fields is refused');
assert.throws(() => validateReplyBlock({ ...mcpBlock, payload: { text: 'x', app: { uri: 'ui://a', html: 'x'.repeat(1048577) } } }), /payload\.app\.html/, 'an oversized App document is refused');
console.log('PASS MCP result block accepts payload.app (and still refuses malformed ones)');
