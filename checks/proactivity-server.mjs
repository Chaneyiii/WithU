import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ClientServerOwner } from '../client/withu-window/index.mjs';
import { settleInterruptedNotifications } from '../client/withu-window/proactivity-notifications.cjs';

const output = path.resolve('output/p1/proactivity-check');
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(path.join(output, 'run-'));
const binary = process.env.WITHU_SERVER_BINARY || path.resolve('target/debug/withu-server.exe');
let owner = new ClientServerOwner(binary, { dataDir, test: true });
await owner.start();
const request = (name, payload = {}) => owner.request(`withu:proactivity:${name}`, payload);
const now = Math.floor(Date.now() / 1000);
const candidate = {
  schema_version: 1,
  id: 'reminder-1-v1',
  source: 'd5_reminder',
  scope: 'comfort',
  dedupe_key: 'reminder-1-v1',
  title: 'Private appointment marker',
  body: 'Private memory marker must stay in the feed only',
};

try {
  const initial = await request('policy_get');
  assert.equal(initial.policy.enabled, false);
  assert.equal(initial.policy.paused, false);
  assert.equal(initial.policy.scope, 'comfort');
  assert.equal((await request('candidate_offer', { app_running: true, candidate: { ...candidate, id: 'disabled', dedupe_key: 'disabled' } })).reason, 'disabled');

  const policy = { ...initial.policy, version: initial.policy.version + 1, enabled: true, timezone: 'Etc/UTC', utc_offset_minutes: 0, quiet_hours: null };
  const updated = await request('policy_update', { expected_version: initial.policy.version, policy });
  assert.equal(updated.policy.version, policy.version);
  await assert.rejects(request('policy_update', { expected_version: initial.policy.version, policy }), /version_conflict/);
  await assert.rejects(request('policy_update', { expected_version: updated.policy.version, policy: { ...updated.policy, version: updated.policy.version + 1, rate_window_seconds: 1, rate_limit: 4 } }), /proactivity_rate_limit/);
  const pausedPolicy = { ...updated.policy, version: updated.policy.version + 1, paused: true };
  await request('policy_update', { expected_version: updated.policy.version, policy: pausedPolicy });
  assert.equal((await request('candidate_offer', { app_running: true, candidate: { ...candidate, id: 'paused', dedupe_key: 'paused' } })).reason, 'paused');
  const quietPolicy = { ...pausedPolicy, version: pausedPolicy.version + 1, paused: false, quiet_hours: { start_minute: 0, end_minute: 1439 } };
  // Choose an offset that places the server's current clock within the quiet interval.
  quietPolicy.utc_offset_minutes = -Math.floor((Date.now() / 60000) % 1440) + 720;
  await request('policy_update', { expected_version: pausedPolicy.version, policy: quietPolicy });
  assert.equal((await request('candidate_offer', { app_running: true, candidate: { ...candidate, id: 'quiet', dedupe_key: 'quiet' } })).reason, 'quiet_hours');
  const resumedPolicy = { ...quietPolicy, version: quietPolicy.version + 1, quiet_hours: null, timezone: 'UTC', utc_offset_minutes: 0 };
  await request('policy_update', { expected_version: quietPolicy.version, policy: resumedPolicy });
  assert.equal((await request('candidate_offer', { app_running: true, candidate: { ...candidate, id: 'paused', dedupe_key: 'paused' } })).reason, 'duplicate');

  await assert.rejects(request('candidate_offer', { app_running: true, candidate: { ...candidate, created_at: now - 1000, expires_at: now + 3600 } }), /proactivity_candidate_schema/);
  const decision = await request('candidate_offer', { app_running: true, candidate });
  assert.equal(decision.decision, 'eligible');
  assert.equal(decision.notification_status, 'pending');
  assert.deepEqual(decision.notification_projection, { title: 'Withu', body: 'You have an update.' });
  const duplicate = await request('candidate_offer', { app_running: true, candidate });
  assert.equal(duplicate.decision, 'suppressed');
  assert.equal(duplicate.reason, 'duplicate');

  await assert.rejects(request('candidate_offer', { app_running: true, candidate: { ...candidate, id: 'wrong-scope', scope: 'cowork' } }), /proactivity_scope/);
  await assert.equal((await request('candidate_offer', { app_running: false, candidate: { ...candidate, id: 'stopped', dedupe_key: 'stopped' } })).reason, 'app_stopped');
  const feed = await request('feed_list');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].notification_status, 'pending');
  assert.ok(feed.items[0].created_at >= now && feed.items[0].created_at <= Math.floor(Date.now() / 1000));
  assert.equal(feed.items[0].expires_at - feed.items[0].created_at, 86400);
  assert.ok(!JSON.stringify(decision.notification_projection).includes('Private'));

  const delivery = await request('notification_result', { candidate_id: candidate.id, expected_version: 0, status: 'shown_by_os' });
  assert.equal(delivery.notification_status, 'shown_by_os');
  await assert.rejects(request('notification_result', { candidate_id: candidate.id, expected_version: 0, status: 'shown_by_os' }), /version_conflict/);
  assert.equal((await request('candidate_offer', { app_running: true, candidate: { ...candidate, id: 'interrupted', dedupe_key: 'interrupted' } })).decision, 'eligible');

  await owner.quit();
  owner = new ClientServerOwner(binary, { dataDir, test: true });
  await owner.start();
  const restored = await request('feed_list');
  assert.equal(restored.items[0].notification_status, 'shown_by_os');
  assert.equal(restored.items[1].notification_status, 'pending');
  await settleInterruptedNotifications({ owner, appRunning: () => true });
  assert.equal((await request('feed_list')).items[1].notification_status, 'unconfirmed');
  assert.equal((await request('candidate_offer', { app_running: true, candidate: { ...candidate, id: 'rate-limited', dedupe_key: 'rate-limited' } })).reason, 'rate_limited');
  assert.equal((await request('policy_get')).policy.enabled, true);
  console.log('PASS proactivity owner persistence, opt-in CAS, scope, dedupe, generic projection, and delivery status');
} finally {
  await owner.quit().catch(() => owner.forceStop());
}
