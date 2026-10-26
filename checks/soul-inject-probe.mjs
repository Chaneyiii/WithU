// 抓包核验：模型真正收到的 system 提示词里有没有 soul.md 的正文
import http from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ClientServerOwner } from '../client/withu-window/index.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const output = path.resolve('output/p4/soul-inject');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(output, 'run-'));
const key = 'FICTIONAL-WIRE-ONLY-' + crypto.randomUUID();
const wire = [];

const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;

const server = http.createServer(async (req, res) => {
  let data = '';
  for await (const c of req) data += c;
  const body = JSON.parse(data);
  wire.push({ url: req.url, body });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(frame({ content: '收到' }));
  res.write(frame({}, 'stop'));
  res.end('data: [DONE]\n\n');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;

const owner = new ClientServerOwner(
  path.resolve(process.env.WITHU_SERVER_BINARY || 'target/debug/withu-server.exe'),
  { dataDir: root, test: true }
);

try {
  await owner.start();
  let config = (await owner.request('withu:config:get')).config;
  config.config_version = 2;
  config.providers = [{ provider_id: 'wire', service: 'llm', endpoint, protocol: 'openai-compatible', capabilities: [] }];
  config.defaults.llm = 'wire';
  config.model_overrides.llm = { provider_ref: 'wire', model_ref: 'user-model' };
  await owner.request('withu:config:update', {
    schema_version: 1, expected_version: 1, config,
    credential_changes: [{ provider_id: 'wire', action: 'replace', value: key }],
  });

  const conv = (id, mode) => ({ schema_version: 1, conversation_id: id, mode, project_id: null, title: id, last_activity_at: '1', task_refs: [], draft_ref: null, version: 1 });
  for (const id of ['comfort']) await owner.request('withu:conversation:update', { expected_version: 0, object: conv(id, id) });

  await owner.request('withu:message:submit', {
    expected_version: 0,
    object: { schema_version: 1, id: 'input-1', conversation_id: 'comfort', role: 'user', text: '你叫什么名字', file_refs: [], submitted_at: String(Date.now()), version: 1 },
  });
  const run = await owner.request('withu:reply:start', { schema_version: 1, conversation_id: 'comfort', message_id: 'input-1', config_version: config.config_version });
  for (let i = 0; i < 350; i++) {
    const event = owner.wire.find(e => e.data?.reply?.operation_id === run.operation_id && ['complete', 'failed', 'cancelled'].includes(e.data.reply.state));
    if (event) { console.log('reply state:', event.data.reply.state, '| text:', JSON.stringify(event.data.reply.text)); break; }
    await sleep(20);
  }

  const req0 = wire[0];
  console.log('\n=== 抓到的请求 ===');
  console.log('url:', req0.url, '| model:', req0.body.model);
  console.log('messages 角色序列:', req0.body.messages.map(m => m.role).join(' → '));
  const sys = req0.body.messages.filter(m => m.role === 'system');
  console.log('system 消息条数:', sys.length);
  if (sys.length) {
    const s = sys[0].content;
    console.log('system[0] 长度:', s.length);
    console.log('--- system[0] 前 400 字 ---');
    console.log(s.slice(0, 400));
    console.log('--- 关键句检测 ---');
    for (const probe of ['我是 Lumi', '有立场的暖', '以上是你的灵魂文档', '你的名字以本条为准', 'Lumi']) {
      console.log(' ', probe.padEnd(20), s.includes(probe) ? 'FOUND' : 'MISSING');
    }
  }
  const user = req0.body.messages.filter(m => m.role === 'user');
  console.log('\nuser 消息:', JSON.stringify(user.map(m => m.content)));
} finally {
  if (owner && !owner.exitResult) await owner.forceStop();
  await new Promise(r => server.close(r));
}
