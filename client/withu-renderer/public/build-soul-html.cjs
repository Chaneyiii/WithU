// 从 soul/memory/app 的中英文 md 渲染 identity 页面（基于 identity-template.html）。
// 产物仍是 soul.html（抽屉 URL 不变）。运行：node public/build-soul-html.cjs
const fs = require('fs');
const path = require('path');
const pub = __dirname;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>')
  .replace(/「([^」]+)」/g, '「<span class="q">$1</span>」')
  .replace(/"([^"]{2,48})"/g, '"<span class="q">$1</span>"');
function render(md) {
  let html = '';
  let inList = false;
  let h2n = 0;
  const closeList = () => { if (inList) { html += '</ul>\n'; inList = false; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^[-*] (.*)$/);
    if (li) {
      if (!inList) { html += '<ul>\n'; inList = true; }
      html += '<li>' + inline(li[1]) + '</li>\n';
      continue;
    }
    closeList();
    if (line.startsWith('> ')) { html += '<blockquote>' + inline(line.slice(2)) + '</blockquote>\n'; continue; }
    if (line.startsWith('### ')) { html += '<h3>' + esc(line.slice(4)) + '</h3>\n'; continue; }
    if (line.startsWith('## ')) {
      h2n += 1;
      html += '<h2 data-n="' + String(h2n).padStart(2, '0') + '">' + esc(line.slice(3)) + '</h2>\n';
      continue;
    }
    if (line.startsWith('# ')) { continue; }
    if (/^\*[^*].*\*$/.test(line)) { html += '<p class="quiet">' + inline(line) + '</p>\n'; continue; }
    if (line === '---') { html += '<hr>\n'; continue; }
    if (line.trim() === '') continue;
    html += '<p>' + inline(line) + '</p>\n';
  }
  closeList();
  return html;
}
const read = name => {
  const p = path.join(pub, name);
  return fs.existsSync(p) ? render(fs.readFileSync(p, 'utf8')) : '<p>(待补)</p>';
};
const blocks = {
  __SOUL_ZH__: read('soul.md'),
  __SOUL_EN__: read('soul-en.md'),
  __MEMORY_ZH__: read('memory.md'),
  __MEMORY_EN__: read('memory-en.md'),
  __APP_ZH__: read('app.md'),
  __APP_EN__: read('app-en.md'),
};
let tpl = fs.readFileSync(path.join(pub, 'identity-template.html'), 'utf8');
for (const [k, v] of Object.entries(blocks)) tpl = tpl.replace(k, v);
fs.writeFileSync(path.join(pub, 'soul.html'), tpl);
const total = Object.values(blocks).reduce((n, s) => n + s.length, 0);
console.log('soul.html built (identity, 6 blocks):', total, 'chars');
