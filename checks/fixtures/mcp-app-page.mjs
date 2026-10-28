// Builds a minimal MCP App document that actually speaks the protocol.
//
// Why this exists: the old fixture served a static HTML page with no SDK, so the
// host's AppBridge never completed `ui/initialize` and EVERY real run ended with
// "MCP App 握手超时" (screenshot 2026-10-28 16:13). The host was fine; the fixture
// was not an App. This bundles the real ext-apps client into a tiny page so the
// handshake completes for real.
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const requireFromApp = createRequire(path.join(root, 'client', 'withu-mcp-app', 'package.json'));
const {build} = requireFromApp('esbuild');

const APP_SOURCE = `
import {App, PostMessageTransport} from '@modelcontextprotocol/ext-apps';
const state = document.getElementById('state');
const app = new App({name: 'withu-check-app', version: '1.0.0'}, {}, {strict: true});
// A per-load token makes a rebuild visible to a human: hide/show the window and
// the token must change (new session). Without it the reconnect is too fast to see.
const token = Math.random().toString(36).slice(2, 6);
state.textContent = 'connecting ' + token;
app.connect(new PostMessageTransport(window.parent, window.parent))
  .then(() => { state.textContent = 'connected · ' + token; state.dataset.connected = '1'; })
  .catch(error => { state.textContent = 'error: ' + (error && error.message ? error.message : error) + ' · ' + token; });
`;

let cached = null;

export async function buildCheckAppHtml() {
  if (cached) return cached;
  const result = await build({
    stdin: {contents: APP_SOURCE, resolveDir: root, sourcefile: 'withu-check-app.js', loader: 'js'},
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    minify: true,
    write: false,
    logLevel: 'silent',
  });
  const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
  cached = '<!doctype html><html><head><meta charset="utf-8"><title>check app</title></head>'
    + '<body><h1 id="check-app">check app</h1><p id="state">boot</p>'
    + `<script>${script}</script></body></html>`;
  return cached;
}
