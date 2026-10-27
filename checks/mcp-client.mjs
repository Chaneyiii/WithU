// B1 foundation: the host can actually speak MCP to a server over stdio —
// negotiate capabilities, list tools and resources, read an App resource, call
// a tool, and shut the child down. Failure paths are part of the contract.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMcpClient, McpClientError} from '../client/withu-mcp-client/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, 'fixtures/mcp-app-server.mjs');
const results = [];

const normal = createMcpClient({command: process.execPath, args: [server]});
try {
  const init = await normal.initialize({name: 'withu-check', version: '1'});
  assert.equal(init.protocolVersion, '2024-11-05');
  assert.equal(init.serverInfo.name, 'withu-check-app');
  assert.equal(init.capabilities.tools !== undefined, true, 'server advertises tools');
  results.push('initialize negotiates protocol and server capabilities');

  const {tools} = await normal.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'annotate');
  assert.deepEqual(tools[0].inputSchema.required, ['text']);
  results.push('tools/list returns the schema the model would need');

  const {resources} = await normal.listResources();
  assert.equal(resources[0].uri, 'ui://withu-check/app');
  results.push('resources/list exposes the App resource');

  const read = await normal.readResource('ui://withu-check/app');
  assert.equal(read.contents[0].mimeType, 'text/html');
  assert.ok(read.contents[0].text.includes('<!doctype html>'));
  results.push('resources/read returns the App document');

  const called = await normal.callTool('annotate', {text: '记住这条'});
  assert.equal(called.content[0].text, 'annotated:记住这条');
  results.push('tools/call round-trips arguments and result');

  await assert.rejects(() => normal.callTool('missing', {}), error => error instanceof McpClientError && error.code === 'mcp_error');
  results.push('an unknown tool fails loudly instead of returning empty content');

  await assert.rejects(() => normal.readResource('ui://nope'), error => error.code === 'mcp_error');
  results.push('an unknown resource fails loudly');

  await normal.close();
  await assert.rejects(() => normal.listTools(), error => error.code === 'mcp_client_closed');
  results.push('close shuts the child down and refuses later traffic');
} finally {
  await normal.close().catch(() => {});
}

const hang = createMcpClient({command: process.execPath, args: [server], env: {FIXTURE_MODE: 'hang'}, timeoutMs: 400});
try {
  await assert.rejects(() => hang.initialize({name: 'withu-check', version: '1'}), error => error.code === 'mcp_timeout');
  results.push('a silent server times out instead of hanging the host');
} finally {
  await hang.close().catch(() => {});
}

const missing = createMcpClient({command: path.join(here, 'fixtures/definitely-missing-binary'), args: []});
try {
  await assert.rejects(() => missing.initialize({name: 'withu-check', version: '1'}), error => ['mcp_server_unavailable', 'mcp_server_exited'].includes(error.code));
  results.push('a missing server binary surfaces a bounded error');
} finally {
  await missing.close().catch(() => {});
}

console.log('PASS mcp client (' + results.length + '):\n' + results.map(r => ' - ' + r).join('\n'));
