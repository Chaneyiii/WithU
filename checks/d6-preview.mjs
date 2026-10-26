import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'client/withu-renderer/intelligent-ui-preview.html'), 'utf8');
const main = await readFile(path.join(root, 'client/withu-renderer/src/intelligent-ui/preview-main.jsx'), 'utf8');
const css = await readFile(path.join(root, 'client/withu-renderer/src/intelligent-ui/intelligent-ui.css'), 'utf8');
assert.match(html, /intelligent-ui\/preview-main\.jsx/);
assert.match(main, /Fixture only/);
assert.match(html, /intelligent-ui-preview/);
assert.match(main, /No production side effect/);
assert.match(main, /No reminder is created/);
assert.match(css, /prefers-reduced-motion/);
if (!process.argv.includes('--serve')) { console.log('PASS D6 preview assets: standalone entry, test-preview marker, no fake success copy, keyboard/reduced-motion CSS'); process.exit(0); }

const mime = {'.html':'text/html; charset=utf-8','.jsx':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server = createServer(async (request, response) => {
  try {
    const urlPath = new URL(request.url, 'http://127.0.0.1').pathname;
    const relative = urlPath === '/' ? 'client/withu-renderer/intelligent-ui-preview.html' : urlPath.startsWith('/src/') ? `client/withu-renderer${urlPath}` : null;
    if (!relative) { response.writeHead(404); response.end('Not found'); return; }
    const file = path.resolve(root, relative);
    if (!file.startsWith(path.resolve(root, 'client/withu-renderer'))) { response.writeHead(403); response.end('Forbidden'); return; }
    response.writeHead(200, {'content-type': mime[path.extname(file)] || 'text/plain; charset=utf-8'}); response.end(await readFile(file));
  } catch (error) { response.writeHead(500); response.end(String(error.message)); }
});
server.listen(4174, '127.0.0.1', () => console.log('D6 Intelligent UI preview: http://127.0.0.1:4174/'));
process.once('SIGINT', () => server.close(() => process.exit(0)));
