import assert from 'node:assert/strict';
import {createActionIntent, createCancelIntent, selectedOption} from '../client/withu-renderer/src/intelligent-ui/action-adapter.js';
import {initialSurfaceState, reduceSurfaceState} from '../client/withu-renderer/src/intelligent-ui/state-machine.js';
import {validateReplyBlock, validateSurfaceState} from '../client/withu-renderer/src/intelligent-ui/contract.js';

const actionRef = {action_id:'action:reminder:1', expected_revision:3, approval_ref:'approval:1', idempotency_key:'idem:1', cancel_token:'cancel:1', expires_at:500};
const block = {schema_version:1, block_id:'block:1', conversation_id:'conversation:1', turn_id:'turn:1', source:'withu', status_version:1, visibility:'private_preview', kind:'approval', action_ref:actionRef, payload:{title:'Draft reminder', body:'Create a local reminder draft.', decision:'pending'}};
const selectionBlock = {...block, block_id:'block:selection', kind:'selection', payload:{title:'Choose', options:[{id:'morning', label:'Morning', description:'09:00', version:2}]}};
const receipt = (status, error = null) => ({schema_version:1, action_id:'action:reminder:1', idempotency_key:'idem:1', status, result:status === 'applied' ? {summary:'Reminder draft created locally.', affected_targets:['reminder:1']} : null, error, effect_committed:status === 'applied', observed_at:400});

assert.throws(() => validateReplyBlock({...block, kind:'html'}), /unknown/);
assert.throws(() => validateReplyBlock({...block, payload:{...block.payload, html:'<b>unsafe</b>'}}), /unknown field/);
assert.throws(() => validateSurfaceState({...initialSurfaceState(block), unexpected:true}), /unknown field/);

const click = createActionIntent(block, 'click', 100);
const voice = createActionIntent(block, 'voice', 100);
assert.deepEqual({...click, input_channel:undefined}, {...voice, input_channel:undefined});
assert.equal(click.input_channel, 'click'); assert.equal(voice.input_channel, 'voice');
assert.equal(click.intent_kind, 'submit');
assert.equal(createCancelIntent(block, 100).intent_kind, 'cancel');
const selectedIntent = createActionIntent(selectionBlock, 'voice', 100, 'submit', {option_id:'morning', option_version:2});
assert.equal(selectedIntent.option_id, 'morning'); assert.equal(selectedIntent.option_version, 2);
const selected = selectedOption(selectionBlock, 'morning');
for (const channel of ['click', 'voice']) {
  const selectedAction = createActionIntent(selectionBlock, channel, 100, 'submit', selected);
  assert.equal(selectedAction.input_channel, channel);
  assert.equal(selectedAction.option_id, 'morning');
  assert.equal(selectedAction.option_version, 2);
}
assert.throws(() => createActionIntent(selectionBlock, 'click', 100, 'submit', {option_id:'morning', option_version:1}), /does not match/);

let state = initialSurfaceState(block, {surfaceId:'surface:1', now:100});
state = reduceSurfaceState(state, {type:'block_ready'}, 101);
state = reduceSurfaceState(state, {type:'action_requested', requiresApproval:true}, 102);
assert.equal(state.state, 'pending_approval');
state = reduceSurfaceState(state, {type:'receipt_received', receipt:receipt('applied')}, 103);
assert.equal(state.state, 'applied'); assert.equal(state.receipt.result.summary, 'Reminder draft created locally.');

const versionConflict = receipt('rejected', {schema_version:1, code:'version', message:'expected revision 3, observed 4', retryable:false, action_id:'action:reminder:1', committed_targets:[]});
state = reduceSurfaceState(state, {type:'receipt_received', receipt:versionConflict}, 104);
assert.equal(state.state, 'failed'); assert.equal(state.receipt.error.code, 'version');
const expired = receipt('rejected', {schema_version:1, code:'expired', message:'approval card expired', retryable:false, action_id:'action:reminder:1', committed_targets:[]});
state = reduceSurfaceState(state, {type:'receipt_received', receipt:expired}, 105);
assert.equal(state.state, 'expired');
const duplicate = receipt('rejected', {schema_version:1, code:'duplicate', message:'idempotency key was already submitted', retryable:false, action_id:'action:reminder:1', committed_targets:[]});
state = reduceSurfaceState(state, {type:'receipt_received', receipt:duplicate}, 106);
assert.equal(state.state, 'failed'); assert.equal(state.receipt.error.code, 'duplicate');
state = reduceSurfaceState(state, {type:'retry'}, 107); assert.equal(state.state, 'loading'); assert.equal(state.receipt, null);
state = reduceSurfaceState(state, {type:'block_ready'}, 108); assert.equal(state.state, 'ready');
state = reduceSurfaceState(state, {type:'close'}, 109); assert.equal(state.state, 'closed');
state = reduceSurfaceState(state, {type:'receipt_received', receipt:receipt('applied')}, 110); assert.equal(state.state, 'closed');
state = reduceSurfaceState(state, {type:'recover'}, 111); assert.equal(state.state, 'recovering');
state = reduceSurfaceState(state, {type:'recovered'}, 112); assert.equal(state.state, 'ready');
console.log('PASS D6 replay: unknown block/field rejection; click and voice typed intent parity; approval pending; applied/version/expiry/duplicate receipts; retry; close and recovery');
