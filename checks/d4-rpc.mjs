import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClientServerOwner } from '../client/withu-window/index.mjs';

const binary = process.env.WITHU_SERVER_BINARY || path.resolve('target/debug/withu-server.exe');
const owners = [];
const start = async (dir, options = {}) => {
  const owner = new ClientServerOwner(binary, { dataDir: dir, test: true, ...options });
  owners.push(owner);
  await owner.start();
  return owner;
};
const proposal = (patch = {}) => ({
  schema_version: 1,
  scope: 'comfort:local',
  goal_description: 'Record a local demo annotation',
  user_evidence_ref: 'user-turn:explicit-request',
  operation: 'local_annotation',
  target_id: 'demo-item',
  expected_version: 1,
  value: 'take a break',
  ...patch,
});
const seedEvidence = async owner => {
  await owner.request('withu:conversation:update', { expected_version: 0, object: {
    schema_version: 1, conversation_id: 'comfort', mode: 'comfort', project_id: null,
    title: 'D4 local action', last_activity_at: '1', task_refs: [], draft_ref: null, version: 1,
  }});
  await owner.request('withu:message:submit', { expected_version: 0, object: {
    schema_version: 1, id: 'user-turn:explicit-request', conversation_id: 'comfort', role: 'user',
    text: proposal().goal_description, file_refs: [], submitted_at: '1', version: 1,
  }});
};
const reference = preview => ({ schema_version: 1, action_id: preview.plan.actions[0].action_id,
  approval_id: preview.approval.approval_id, scope: 'comfort:local' });
const getAnnotation = owner => owner.request('withu:annotation:get', { schema_version: 1, scope: 'comfort:local', target_id: 'demo-item' });
const validate = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'withu-d4-rpc-'));
  let owner = await start(root);
  await assert.rejects(owner.request('withu:action:preview', proposal()), /action_user_evidence/);
  await seedEvidence(owner);
  assert.equal((await getAnnotation(owner)).annotation, null);
  const preview = await owner.request('withu:action:preview', proposal());
  assert.equal(preview.plan.external_effects, false);
  assert.equal(preview.approval.decision, 'pending');
  assert.equal(preview.approval.explicit_user_allow, false);
  assert.equal(preview.plan.actions[0].data_scope[0], 'comfort:local');
  assert.ok(preview.plan.actions[0].expires_at > Math.floor(Date.now() / 1000));

  const { receipt: beforeAllow } = await owner.request('withu:action:execute', {
    schema_version: 1, action_id: preview.plan.actions[0].action_id,
    approval_id: preview.approval.approval_id, scope: 'comfort:local',
  });
  assert.equal(beforeAllow.status, 'rejected');
  assert.equal(beforeAllow.error.code, 'authorization');
  assert.equal(beforeAllow.effect_committed, false);

  assert.equal((await getAnnotation(owner)).annotation, null);
  const { approval: allowed } = await owner.request('withu:action:decide', {
    schema_version: 1, action_id: preview.plan.actions[0].action_id,
    approval_id: preview.approval.approval_id, scope: 'comfort:local', decision: 'allow_once',
  });
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.explicit_user_allow, true);
  const { receipt } = await owner.request('withu:action:execute', {
    schema_version: 1, action_id: preview.plan.actions[0].action_id,
    approval_id: preview.approval.approval_id, scope: 'comfort:local',
  });
  assert.equal(receipt.status, 'applied');
  assert.equal(receipt.effect_committed, true);
  assert.match(receipt.result.summary, /no external effect/);
  const { receipt: duplicate } = await owner.request('withu:action:execute', {
    schema_version: 1, action_id: preview.plan.actions[0].action_id,
    approval_id: preview.approval.approval_id, scope: 'comfort:local',
  });
  assert.equal(duplicate.status, 'rejected');
  assert.equal(duplicate.error.code, 'duplicate');
  const annotation = (await getAnnotation(owner)).annotation;
  assert.equal(annotation.value, 'take a break');
  assert.equal(annotation.version, 2);
  assert.equal(annotation.scope, 'comfort:local');
  assert.equal((await owner.request('withu:annotation:list', {schema_version: 1, scope: 'comfort:local'})).items.length, 1);
  await assert.rejects(owner.request('withu:action:decide', {
    schema_version: 1, action_id: preview.plan.actions[0].action_id,
    approval_id: preview.approval.approval_id, scope: 'comfort:local', decision: 'allow_once',
  }), /approval_already_used/);

  await assert.rejects(owner.request('withu:action:preview', proposal({ scope: 'cowork:project-1' })), /action_scope/);
  await assert.rejects(owner.request('withu:action:preview', proposal()), /action_target_version/);
  await assert.rejects(owner.request('withu:action:preview', { ...proposal(), external_effects: true }), /action_proposal_schema/);
  await assert.rejects(owner.request('withu:action:execute', {
    schema_version: 1, action_id: preview.plan.actions[0].action_id,
    approval_id: preview.approval.approval_id, scope: 'cowork:project-1',
  }), /action_scope/);
  await owner.quit();
  owner = await start(root);
  assert.deepEqual((await getAnnotation(owner)).annotation, annotation);
  await assert.rejects(owner.request('withu:action:execute', reference(preview)), /action_missing/);
  const updated = await owner.request('withu:action:preview', proposal({expected_version: 2, value: 'local edit'}));
  const stale = await owner.request('withu:action:preview', proposal({expected_version: 2, value: 'stale edit'}));
  await owner.request('withu:action:decide', {...reference(updated), decision: 'allow_once'});
  await owner.request('withu:action:execute', reference(updated));
  await owner.request('withu:action:decide', {...reference(stale), decision: 'allow_once'});
  const staleReceipt = (await owner.request('withu:action:execute', reference(stale))).receipt;
  assert.equal(staleReceipt.status, 'rejected');
  assert.equal(staleReceipt.error.code, 'version');
  assert.equal((await getAnnotation(owner)).annotation.value, 'local edit');
  assert.equal((await getAnnotation(owner)).annotation.version, 3);
  await owner.quit();

  process.env.WITHU_TEST_D4_FAILURE = '1';
  owner = await start(path.join(root, 'failure'));
  delete process.env.WITHU_TEST_D4_FAILURE;
  await seedEvidence(owner);
  const failedPreview = await owner.request('withu:action:preview', proposal());
  await owner.request('withu:action:decide', {
    schema_version: 1, action_id: failedPreview.plan.actions[0].action_id,
    approval_id: failedPreview.approval.approval_id, scope: 'comfort:local', decision: 'allow_once',
  });
  const { receipt: failed } = await owner.request('withu:action:execute', {
    schema_version: 1, action_id: failedPreview.plan.actions[0].action_id,
    approval_id: failedPreview.approval.approval_id, scope: 'comfort:local',
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'connector_failure');
  assert.equal(failed.effect_committed, false);
  assert.equal((await getAnnotation(owner)).annotation, null);
  await owner.quit();
};

try {
  await validate();
  console.log('PASS D4 owner RPC preview, explicit per-action Allow, rejection, idempotency, expiry-bound claims, scope/version/schema checks, and honest failure receipt');
} finally {
  for (const owner of owners) await owner.forceStop();
}
