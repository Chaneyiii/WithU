// A tiny stdio MCP server used by checks/mcp-client.mjs. It speaks just enough
// of the protocol to exercise the host client: initialize, tools, resources,
// a tool call, and two failure modes (unknown tool, silent hang).
import {createInterface} from 'node:readline';

const mode = process.env.FIXTURE_MODE || 'normal';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const serverInfo = {name: 'withu-check-app', version: '1.0.0'};

const rl = createInterface({input: process.stdin});
rl.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id == null) return;
  const reply = result => send({jsonrpc: '2.0', id: message.id, result});
  const fail = (code, text) => send({jsonrpc: '2.0', id: message.id, error: {code, message: text}});
  if (mode === 'hang') return;

  switch (message.method) {
    case 'initialize':
      return reply({protocolVersion: '2024-11-05', capabilities: {tools: {}, resources: {}}, serverInfo});
    case 'tools/list':
      return reply({tools: [{
        name: 'annotate',
        description: 'Record a local annotation',
        inputSchema: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']},
        // B1: the host reads this document and renders it inline with the result.
        _meta: {ui: {resourceUri: 'ui://withu-check/app'}},
      }]});
    case 'resources/list':
      return reply({resources: [{uri: 'ui://withu-check/app', name: 'Check App', mimeType: 'text/html'}]});
    case 'resources/read':
      if (message.params?.uri !== 'ui://withu-check/app') return fail(-32002, 'resource not found');
      return reply({contents: [{uri: 'ui://withu-check/app', mimeType: 'text/html', text: '<!doctype html><html><head><meta charset="utf-8"><title>check app</title></head><body><h1 id="check-app">check app</h1><p>local fixture</p></body></html>'}]});
    case 'tools/call':
      if (message.params?.name !== 'annotate') return fail(-32602, 'unknown tool');
      return reply({content: [{type: 'text', text: 'annotated:' + (message.params.arguments?.text ?? '')}]});
    default:
      return fail(-32601, 'method not found');
  }
});
