import test from 'node:test';
import assert from 'node:assert/strict';
import {App} from '@modelcontextprotocol/ext-apps';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import {InMemoryTransport} from '@modelcontextprotocol/client';
import {RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';
import {APP_TOOL_NAME, createDemoMcpFixture, makeAppDocument, isAcceptedAppMessage, validateAppNavigation, validateAppSize, validateAppToolIntent} from '../src/fixture.js';

test('registers, negotiates, and reads the demo MCP App resource through MCP SDK', async () => {
  const fixture = await createDemoMcpFixture();
  try {
    assert.equal(fixture.negotiated, true);
    const resources = await fixture.client.listResources();
    assert.deepEqual(resources.resources.map(resource => resource.uri), [fixture.resourceUri]);
    const read = await fixture.client.readResource({uri: fixture.resourceUri});
    assert.equal(read.contents[0].mimeType, RESOURCE_MIME_TYPE);
    assert.match(read.contents[0].text, /__WITHU_APP_NONCE__/);
    const tools = await fixture.client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name), ['request-demo-intent']);
    assert.equal(tools.tools[0]._meta.ui.resourceUri, fixture.resourceUri);
  } finally {
    await fixture.close();
  }
});

test('performs the official App and AppBridge initialize handshake', async () => {
  const fixture = await createDemoMcpFixture();
  const [hostTransport, appTransport] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(fixture.client, {name: 'Withu Demo Host', version: '1.0.0'}, {serverTools: {}}, {strict: true});
  const app = new App({name: 'Withu Demo App', version: '1.0.0'}, {}, {autoResize: false, strict: true});
  let initialized = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  bridge.oninitialized = () => { initialized = true; resolveReady(); };
  try {
    const connecting = bridge.connect(hostTransport);
    await app.connect(appTransport);
    await connecting;
    await ready;
    assert.equal(initialized, true);
    assert.equal(app.getHostVersion().name, 'Withu Demo Host');
    assert.equal(app.getHostCapabilities().serverTools !== undefined, true);
  } finally {
    await bridge.close();
    await app.close();
    await fixture.close();
  }
});

test('accepts only the active opaque-origin iframe session and bounded messages', () => {
  const source = {};
  const sessionId = 'session-a';
  assert.equal(isAcceptedAppMessage({source, origin: 'null', data: {jsonrpc: '2.0'}}, {source, origin: 'null', activeSessionId: sessionId, sessionId}), true);
  assert.equal(isAcceptedAppMessage({source: {}, origin: 'null', data: {jsonrpc: '2.0'}}, {source, origin: 'null', activeSessionId: sessionId, sessionId}), false);
  assert.equal(isAcceptedAppMessage({source, origin: 'https://evil.invalid', data: {jsonrpc: '2.0'}}, {source, origin: 'null', activeSessionId: sessionId, sessionId}), false);
  assert.equal(isAcceptedAppMessage({source, origin: 'null', data: 'x'.repeat(65_537)}, {source, origin: 'null', activeSessionId: sessionId, sessionId}), false);
  assert.equal(isAcceptedAppMessage({source, origin: 'null', data: {jsonrpc: '2.0'}}, {source, origin: 'null', activeSessionId: 'session-b', sessionId}), false);
});

test('builds a nonce-bound app document with no network, navigation, or popup permissions', () => {
  const document = makeAppDocument('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="__WITHU_APP_CSP__"></head><body><script nonce="__WITHU_APP_NONCE__">demo</script></body></html>', 'nonce-123');
  assert.match(document, /default-src 'none'/);
  assert.match(document, /script-src 'nonce-nonce-123'/);
  assert.match(document, /connect-src 'none'/);
  assert.doesNotMatch(document, /https?:\/\//);
});

test('rejects navigation, popup, and unbounded size requests from the app', () => {
  assert.equal(validateAppNavigation('ui://withu/demo-app.html'), true);
  assert.equal(validateAppNavigation('https://example.com'), false);
  assert.equal(validateAppNavigation('javascript:alert(1)'), false);
  assert.equal(validateAppSize({width: 320, height: 240}), true);
  assert.equal(validateAppSize({width: 0, height: 240}), false);
  assert.equal(validateAppSize({width: 100_000, height: 240}), false);
  assert.equal(validateAppSize({width: 320, height: 20_000}), false);
});

test('dispatches only the typed app intent and reports unavailable without D4 RPC', async () => {
  const fixture = await createDemoMcpFixture();
  try {
    const tools = await fixture.client.listTools();
    assert.equal(tools.tools[0].name, APP_TOOL_NAME);
    const rejected = await fixture.client.callTool({name: APP_TOOL_NAME, arguments: {operation: 'execute_arbitrary'}});
    assert.equal(rejected.isError, true);
    const result = await fixture.client.callTool({name: APP_TOOL_NAME, arguments: {operation: 'local_annotation', version: 1, value: 'take a break'}});
    assert.equal(result.structuredContent.status, 'unavailable');
    assert.equal(result.structuredContent.submitted, false);
    assert.equal(result.structuredContent.effect_committed, false);
  } finally {
    await fixture.close();
  }
});

test('validates only the versioned, allowlisted app intent shape', () => {
  assert.deepEqual(validateAppToolIntent({operation: 'local_annotation', version: 1, value: 'take a break'}), {operation: 'local_annotation', version: 1, value: 'take a break'});
  assert.equal(validateAppToolIntent({operation: 'create_local_reminder'}), null);
  assert.equal(validateAppToolIntent({operation: 'execute_arbitrary', version: 1}), null);
  assert.equal(validateAppToolIntent({operation: 'local_annotation', version: 1, value: 'take a break', channel: 'withu:task:create'}), null);
});

test('runs App resource teardown over the standard SDK protocol', async () => {
  const fixture = await createDemoMcpFixture();
  const [hostTransport, appTransport] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(fixture.client, {name:'Host', version:'1'}, {serverTools:{}}, {strict:true});
  const app = new App({name:'App', version:'1'}, {}, {autoResize:false, strict:true});
  let tornDown = false;
  app.onteardown = async () => {tornDown = true; return {};};
  try {
    await bridge.connect(hostTransport);
    await app.connect(appTransport);
    await bridge.teardownResource({});
    assert.equal(tornDown, true);
  } finally {await bridge.close(); await app.close(); await fixture.close();}
});
