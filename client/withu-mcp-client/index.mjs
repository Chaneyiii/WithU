// Minimal MCP client for the desktop host (B1 foundation).
//
// Why hand-rolled instead of the SDK transport: the App side already uses the
// SDK for AppBridge, but the *host* needs a client it controls end to end —
// bounded reads, an explicit timeout per request, and a hard teardown that
// kills the child. MCP over stdio is newline-delimited JSON-RPC, so the
// protocol part is small and auditable; the interesting work is the limits.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 512 * 1024;

export class McpClientError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function createMcpClient({command, args = [], env = {}, cwd, timeoutMs = DEFAULT_TIMEOUT_MS}) {
  if (typeof command !== 'string' || !command) throw new McpClientError('mcp_command_required');
  const child = spawn(command, args, {cwd, env: {...process.env, ...env}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  const pending = new Map();
  let nextId = 1;
  let closed = false;
  let stderr = '';

  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  createInterface({input: child.stdout}).on('line', line => {
    if (line.length > MAX_MESSAGE_BYTES) { rejectAll(new McpClientError('mcp_message_too_large')); return; }
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id == null) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new McpClientError('mcp_error', message.error));
    else entry.resolve(message.result);
  });
  child.once('exit', code => rejectAll(new McpClientError('mcp_server_exited', {code, stderr})));
  child.once('error', error => rejectAll(new McpClientError('mcp_server_unavailable', {message: error.message})));

  function rejectAll(error) {
    closed = true;
    for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  }

  function request(method, params = {}) {
    if (closed) return Promise.reject(new McpClientError('mcp_client_closed'));
    const id = nextId++;
    const payload = JSON.stringify({jsonrpc: '2.0', id, method, params});
    if (Buffer.byteLength(payload) > MAX_MESSAGE_BYTES) return Promise.reject(new McpClientError('mcp_request_too_large'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new McpClientError('mcp_timeout', {method})); }, timeoutMs);
      pending.set(id, {resolve, reject, timer});
      child.stdin.write(payload + '\n', error => {
        if (!error) return;
        const entry = pending.get(id);
        if (entry) { pending.delete(id); clearTimeout(entry.timer); }
        reject(new McpClientError('mcp_write_failed', {message: error.message}));
      });
    });
  }

  function notify(method, params = {}) {
    if (closed) return;
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', method, params}) + '\n');
  }

  return {
    get stderr() { return stderr; },
    async initialize(clientInfo = {name: 'withu-host', version: '1'}) {
      const result = await request('initialize', {protocolVersion: PROTOCOL_VERSION, capabilities: {resources: {}, tools: {}}, clientInfo});
      notify('notifications/initialized');
      return result;
    },
    listTools: () => request('tools/list'),
    listResources: () => request('resources/list'),
    readResource: uri => request('resources/read', {uri}),
    callTool: (name, args = {}) => request('tools/call', {name, arguments: args}),
    async close() {
      if (closed) return;
      closed = true;
      for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(new McpClientError('mcp_client_closed')); }
      pending.clear();
      try { child.stdin.end(); } catch {}
      await new Promise(resolve => {
        const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 1500);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
    get pid() { return child.pid; }
  };
}
