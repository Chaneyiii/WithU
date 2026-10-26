// Renderer event mapping regression (no browser needed).
// Guards the T14 capsule wiring: the server emits memory.candidate.created with
// FLAT fields; the renderer used to read nested keys only and the capsule never
// appeared while every server-side wire check stayed green.
import assert from 'node:assert/strict';
import {memoryCandidateFromEvent} from '../client/withu-renderer/src/memory-candidate-event.js';

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
