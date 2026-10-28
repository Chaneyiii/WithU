// A tiny stdio MCP server used by checks/mcp-client.mjs. It speaks just enough
// of the protocol to exercise the host client: initialize, tools, resources,
// a tool call, and two failure modes (unknown tool, silent hang).
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
import {buildCheckAppHtml} from './mcp-app-page.mjs';

const mode = process.env.FIXTURE_MODE || 'normal';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const serverInfo = {name: 'withu-check-app', version: '1.0.0'};
// 必须是会握手的最小 MCP App：静态页会让 host 永远等不到 ui/initialize。
const appHtml = await buildCheckAppHtml();
// run-with-mcp.cmd 用它确认 MCP 服务器真的起来了（手动验收用，测试不设就不写）。
if (process.env.WITHU_MCP_MARK) { try { writeFileSync(process.env.WITHU_MCP_MARK, String(process.pid)); } catch {} }

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
        description: 'Save a short local note (本地注记) on this device',
        inputSchema: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']},
        // B1: the host reads this document and renders it inline with the result.
        _meta: {ui: {resourceUri: 'ui://withu-check/app'}},
      }]});
    case 'resources/list':
      return reply({resources: [{uri: 'ui://withu-check/app', name: 'Check App', mimeType: 'text/html'}]});
    case 'resources/read':
      if (message.params?.uri !== 'ui://withu-check/app') return fail(-32002, 'resource not found');
      return reply({contents: [{uri: 'ui://withu-check/app', mimeType: 'text/html', text: appHtml}]});
    case 'tools/call':
      if (message.params?.name !== 'annotate') return fail(-32602, 'unknown tool');
      return reply({content: [{type: 'text', text: 'annotated:' + (message.params.arguments?.text ?? '')}]});
    default:
      return fail(-32601, 'method not found');
  }
});
