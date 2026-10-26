import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBridge } from '../client/withu-preload/index.mjs';
import { showProactivityNotification, settleInterruptedNotifications } from '../client/withu-window/proactivity-notifications.cjs';

class FakeNotification extends EventEmitter {
  static isSupported() { return true; }
  static created = [];
  constructor(options) { super(); this.options = options; FakeNotification.created.push(this); }
  show() { queueMicrotask(() => this.emit('show')); }
}

const privateItem = { title: 'Private memory marker', body: 'credential marker' };
const bridge = createBridge(() => { throw Error('must not reach owner'); });
assert.throws(() => bridge.invoke('withu:proactivity:notification_result', {}), /main-process channel/);
assert.throws(() => bridge.invoke('withu:proactivity:candidate_offer', {}), /main-process channel/);
assert.equal(await showProactivityNotification({ Notification: FakeNotification, eligible: false, appRunning: true, item: privateItem }), 'suppressed_policy');
assert.equal(FakeNotification.created.length, 0);
assert.equal(await showProactivityNotification({ Notification: FakeNotification, eligible: true, appRunning: false, item: privateItem }), 'suppressed_app_stopped');
assert.equal(FakeNotification.created.length, 0);
assert.equal(await showProactivityNotification({ Notification: FakeNotification, eligible: true, appRunning: true, item: privateItem, preview: true }), 'test_preview');
assert.equal(FakeNotification.created.length, 0);
assert.equal(await showProactivityNotification({ Notification: FakeNotification, eligible: true, appRunning: true, item: privateItem }), 'shown_by_os');
assert.deepEqual(FakeNotification.created[0].options, { title: 'Withu', body: 'You have an update.' });
assert.ok(!JSON.stringify(FakeNotification.created[0].options).includes('Private memory marker'));
assert.ok(!JSON.stringify(FakeNotification.created[0].options).includes('credential marker'));
class UnsupportedNotification extends FakeNotification { static isSupported() { return false; } }
assert.equal(await showProactivityNotification({ Notification: UnsupportedNotification, eligible: true, appRunning: true }), 'not_supported');
class FailedNotification extends FakeNotification { show() { queueMicrotask(() => this.emit('failed')); } }
assert.equal(await showProactivityNotification({ Notification: FailedNotification, eligible: true, appRunning: true }), 'failed');
class ThrowNotification extends FakeNotification { show() { throw new Error('OS refused'); } }
assert.equal(await showProactivityNotification({ Notification: ThrowNotification, eligible: true, appRunning: true }), 'failed');
const requests = [];
const owner = { ready: true, async request(channel, payload) {
  requests.push({ channel, payload });
  return { items: [{ candidate_id: 'interrupted', notification_status: 'pending', notification_version: 0 }, { candidate_id: 'already-shown', notification_status: 'shown_by_os' }] };
} };
const notificationCount = FakeNotification.created.length;
await settleInterruptedNotifications({ owner, appRunning: () => true });
assert.equal(requests.length, 2);
assert.deepEqual(requests[1], { channel: 'withu:proactivity:notification_result', payload: { candidate_id: 'interrupted', expected_version: 0, status: 'unconfirmed' } });
assert.equal(FakeNotification.created.length, notificationCount, 'restart must not show catch-up notifications');
await settleInterruptedNotifications({ owner, appRunning: () => false });
assert.equal(requests.length, 2, 'exit suppresses startup reconciliation');
console.log('PASS proactivity notification policy, app-running gate, preview truth, and generic payload');
