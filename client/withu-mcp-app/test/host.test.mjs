import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuardedAppTransport, appIframePolicy, invokeD4AppIntent} from '../src/host.js';
import framePolicy from '../../withu-window/mcp-frame-policy.cjs';

test('Electron rejects MCP app frame navigation before a network request', () => {
  assert.equal(framePolicy.allowMcpFrameNavigation({isMainFrame:false, frame:{name:'withu-mcp-app'}, url:'https://evil.invalid'}), false);
  assert.equal(framePolicy.allowMcpFrameNavigation({isMainFrame:false, frame:{name:'withu-mcp-app'}, url:'file:///secret'}), false);
  assert.equal(framePolicy.allowMcpFrameNavigation({isMainFrame:false, frame:{name:'withu-mcp-app'}, url:'about:srcdoc'}), true);
  assert.equal(framePolicy.allowMcpFrameNavigation({isMainFrame:false, frame:{name:'changed-by-app'}, url:'https://evil.invalid'}), false);
});

test('iframe policy permits scripts only, with no popup, navigation or device permissions', () => {
  assert.equal(appIframePolicy.sandbox, 'allow-scripts');
  assert.equal(appIframePolicy.referrerPolicy, 'no-referrer');
  assert.match(appIframePolicy.allow, /microphone 'none'/);
  assert.doesNotMatch(appIframePolicy.sandbox, /allow-same-origin|allow-popups|allow-top-navigation/);
});

test('guarded official transport rejects wrong origin, stale session, oversize and post-close traffic', async () => {
  let accepted = 0;
  const source = {};
  const session = {id: 'a'};
  const raw = {async start(){}, async close(){}, async send(){}};
  const transport = createGuardedAppTransport({source, sessionId: 'a', activeSession: () => session.id, transport: raw});
  transport.onmessage = () => accepted++;
  transport.accept({source, origin: 'null', data: {jsonrpc: '2.0', method: 'ping', id: 1}});
  assert.equal(accepted, 1);
  transport.accept({source: {}, origin: 'null', data: {jsonrpc: '2.0'}});
  transport.accept({source, origin: 'https://evil.invalid', data: {jsonrpc: '2.0'}});
  transport.accept({source, origin: 'null', data: 'x'.repeat(65_537)});
  session.id = 'b';
  transport.accept({source, origin: 'null', data: {jsonrpc: '2.0'}});
  assert.equal(accepted, 1);
  await transport.close();
  session.id = 'a';
  transport.accept({source, origin: 'null', data: {jsonrpc: '2.0'}});
  assert.equal(accepted, 1);
});

test('D4 adapter fails closed and never claims an unproven commit', async () => {
  const intent = {operation: 'local_annotation', version: 1, value: 'take a break'};
  await assert.rejects(invokeD4AppIntent(intent, {}), /D4/);
  await assert.rejects(invokeD4AppIntent({...intent, channel: 'admin'}, {}), /Invalid/);
});

test('D4 adapter previews exact proposal and waits for host Allow before deciding and executing', async () => {
  const calls = [];
  let allow;
  const consent = new Promise(resolve => {allow = resolve;});
  const preview = {plan:{external_effects:false, actions:[{action_id:'a'}]}, approval:{approval_id:'p', decision:'pending'}};
  const bridge = {
    async actionPreview(payload) {calls.push(['preview', payload]); return preview;},
    async actionDecide(payload) {calls.push(['decide', payload]); return {approval:{decision:'allow', explicit_user_allow:true}};},
    async actionExecute(payload) {calls.push(['execute', payload]); return {receipt:{status:'applied', effect_committed:true, result:{summary:'Local annotation recorded; no external effect'}}};},
  };
  const result = invokeD4AppIntent({operation:'local_annotation', version:1, value:'take a break'}, bridge, {
    userEvidenceRef:'user-1', goalDescription:'Please annotate', isActive:() => true,
    requestApproval: async value => {assert.equal(value, preview); return consent;},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(c=>c[0]), ['preview']);
  allow('allow_once');
  const receipt = await result;
  assert.deepEqual(calls.map(c=>c[0]), ['preview','decide','execute']);
  assert.equal(calls[0][1].user_evidence_ref, 'user-1');
  assert.equal(calls[0][1].value, 'take a break');
  assert.equal(receipt.structuredContent.effect_committed, true);
  assert.equal(receipt.structuredContent.receipt.status, 'applied');
});
