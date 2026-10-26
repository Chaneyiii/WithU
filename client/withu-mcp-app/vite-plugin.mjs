import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const virtualId = 'virtual:withu-mcp-app-resource';
const resolvedId = `\0${virtualId}`;

const css = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:transparent;color:#1b1a17;font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
::selection{background:#ffd9bd}
.board{--bg:#f6f4ef;--band:rgba(255,255,255,.5);--band-line:#eae5db;--node:#ffffff;--node-line:#e4dfd4;--ink:#1b1a17;--dim:#8d887e;--edge:#c3bcac;--accent:#ff6a12;
  position:relative;display:flex;flex-direction:column;height:100%;background:var(--bg);overflow:hidden;transition:background .25s ease,color .25s ease}
.board.is-dark{--bg:#161519;--band:rgba(255,255,255,.026);--band-line:#2c2a34;--node:#1f1e26;--node-line:#353140;--ink:#f2f0e9;--dim:#948e84;--edge:#504a43;--accent:#ff7a2f}
.board-head{display:flex;align-items:center;justify-content:space-between;gap:14px;height:44px;padding:0 16px;flex:none}
.title{display:flex;align-items:center;gap:9px;min-width:0}
.title .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent);flex:none}
.title b{font-size:12.5px;font-weight:600;letter-spacing:.01em;color:var(--ink);white-space:nowrap}
.title small{font-size:10.5px;color:var(--dim);white-space:nowrap}
.tools{display:flex;align-items:center;gap:7px;flex:none}
.tools button{font:inherit;font-size:10.5px;line-height:1;padding:6px 11px;border:1px solid var(--node-line);border-radius:999px;background:var(--node);color:var(--ink);cursor:pointer;transition:transform .15s ease,border-color .15s ease}
.tools button:hover{transform:translateY(-1px);border-color:var(--edge)}
.tools button.primary{border-color:transparent;background:#1b1a17;color:#fff}
.board.is-dark .tools button.primary{background:#f2f0e9;color:#161519}
.tools button.primary:disabled{opacity:.4;cursor:default;transform:none}
.stage{position:relative;flex:1;min-height:0;padding:0 14px}
.stage svg{display:block;width:100%;height:100%;overflow:visible}
.band{fill:var(--band);stroke:var(--band-line);stroke-width:1;stroke-dasharray:4 3.5}
.band-label{fill:var(--dim);font-size:9px;font-weight:600;letter-spacing:.14em;font-family:ui-monospace,"SF Mono",Menlo,monospace}
.node{cursor:pointer}
.node rect{fill:var(--node);stroke:var(--node-line);stroke-width:1;filter:drop-shadow(0 1px 1px rgba(30,25,16,.045));transition:stroke .16s ease,fill .16s ease,opacity .16s ease}
.board.is-dark .node rect{filter:none}
.node .sigil{transition:fill .16s ease}
.node .name{fill:var(--ink);font-size:12.5px;font-weight:600;transition:fill .16s ease}
.node .sub{fill:var(--dim);font-size:10px;transition:fill .16s ease}
.node:hover rect{stroke:var(--edge)}
.node:hover .name{fill:var(--accent)}
.node.is-active rect{stroke:var(--accent);stroke-width:1.4}
.node.is-active .name{fill:var(--accent)}
.stage.has-active .node:not(.is-active){opacity:.4}
.edge{fill:none;stroke:var(--edge);stroke-width:1.3;stroke-dasharray:3 5;animation:flow 1.8s linear infinite;transition:opacity .2s ease}
#arrow path{fill:var(--edge)}
.edge-label{fill:var(--dim);font-size:9px;letter-spacing:.02em;font-family:ui-monospace,"SF Mono",Menlo,monospace}
@keyframes flow{to{stroke-dashoffset:-16}}
.board-foot{display:flex;align-items:center;gap:14px;height:34px;padding:0 16px;flex:none}
.detail{flex:1;min-width:0;font-size:10.5px;line-height:15px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.detail b{color:var(--ink);font-weight:600;margin-right:5px}
.status{flex:none;font-size:9.5px;color:var(--dim);max-width:44%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (prefers-reduced-motion: reduce){.edge{animation:none}}
`;

const markup = `<main class="board" data-arch>
<header class="board-head">
  <div class="title"><span class="dot"></span><b>WithU 架构</b><small>本地优先 · 四层</small></div>
  <div class="tools">
    <button type="button" data-theme-toggle>深色</button>
    <button type="button" class="primary" data-request-demo disabled>保存为笔记</button>
  </div>
</header>
<div class="stage">
<svg viewBox="0 0 698 390" preserveAspectRatio="xMidYMid meet" role="img" aria-label="WithU 架构图">
  <rect class="band" x="0.5" y="0.5" width="697" height="81" rx="13"/>
  <text class="band-label" x="13" y="16">界面层 · ELECTRON</text>
  <g class="node" data-node data-name="渲染层" data-desc="React + Vite 组成的界面：对话、灵感、日程、设置都在这一层，只负责画和收集输入，没有任何网络或文件权限。">
    <rect x="0" y="26" width="222" height="44" rx="10"/><circle class="sigil" cx="16" cy="40" r="3.5" fill="#ff6a12"/>
    <text class="name" x="27" y="44">渲染层</text><text class="sub" x="27" y="59">React · Vite · 无系统权限</text>
  </g>
  <g class="node" data-node data-name="预加载桥" data-desc="preload.cjs 只把白名单里的 IPC 通道挂到 window 上，界面拿不到 Node 能力，所有调用都要经过它。">
    <rect x="238" y="26" width="222" height="44" rx="10"/><circle class="sigil" cx="254" cy="40" r="3.5" fill="#ff6a12"/>
    <text class="name" x="265" y="44">预加载桥</text><text class="sub" x="265" y="59">preload.cjs · 通道白名单</text>
  </g>
  <g class="node" data-node data-name="窗口" data-desc="Electron 主进程管窗口、托盘和本地服务的生命周期：窗口关掉时，后端进程一起收尾。">
    <rect x="476" y="26" width="222" height="44" rx="10"/><circle class="sigil" cx="492" cy="40" r="3.5" fill="#ff6a12"/>
    <text class="name" x="503" y="44">窗口</text><text class="sub" x="503" y="59">主进程 · 托盘 · 生命周期</text>
  </g>

  <path class="edge" d="M 349 84 L 349 97" marker-end="url(#arrow)"/>
  <text class="edge-label" x="361" y="97">ipc invoke · stdio JSON-RPC</text>

  <rect class="band" x="0.5" y="102.5" width="697" height="81" rx="13"/>
  <text class="band-label" x="13" y="118">本地服务 · RUST</text>
  <g class="node" data-node data-name="withu-server" data-desc="一个 stdio 上的 JSON-RPC 服务：收事件、跑回复管线、把结果写成本地对象。它是唯一碰数据库的进程。">
    <rect x="0" y="128" width="222" height="44" rx="10"/><circle class="sigil" cx="16" cy="142" r="3.5" fill="#2f6fed"/>
    <text class="name" x="27" y="146">withu-server</text><text class="sub" x="27" y="161">Rust · stdio JSON-RPC</text>
  </g>
  <g class="node" data-node data-name="契约校验" data-desc="contracts/v1 里的 JSON Schema 是唯一真相：请求、事件、落库对象都要先过一遍，字段对不上就拒收。">
    <rect x="238" y="128" width="222" height="44" rx="10"/><circle class="sigil" cx="254" cy="142" r="3.5" fill="#2f6fed"/>
    <text class="name" x="265" y="146">契约校验</text><text class="sub" x="265" y="161">contracts/v1 · JSON Schema</text>
  </g>
  <g class="node" data-node data-name="SQLite 存储" data-desc="objects(kind,id,version,body) 一张表装下会话、消息、配置；version 用来做乐观并发，冲突就重读再写。">
    <rect x="476" y="128" width="222" height="44" rx="10"/><circle class="sigil" cx="492" cy="142" r="3.5" fill="#2f6fed"/>
    <text class="name" x="503" y="146">SQLite 存储</text><text class="sub" x="503" y="161">objects · 版本号并发</text>
  </g>

  <path class="edge" d="M 349 186 L 349 199" marker-end="url(#arrow)"/>
  <text class="edge-label" x="361" y="199">reply · 流式事件流</text>

  <rect class="band" x="0.5" y="204.5" width="697" height="81" rx="13"/>
  <text class="band-label" x="13" y="220">能力 · 可插拔</text>
  <g class="node" data-node data-name="模型网关" data-desc="把对话翻译成各家提供商的请求；思考强度滑杆就是这一层在调档位，档位由模型自己声明。">
    <rect x="0" y="230" width="222" height="44" rx="10"/><circle class="sigil" cx="16" cy="244" r="3.5" fill="#7c3aed"/>
    <text class="name" x="27" y="248">模型网关</text><text class="sub" x="27" y="263">provider · 思考强度</text>
  </g>
  <g class="node" data-node data-name="实时语音" data-desc="通话时音频不进库：只保留这一段会话的状态，挂断即丢弃，不落盘也不上传。">
    <rect x="238" y="230" width="222" height="44" rx="10"/><circle class="sigil" cx="254" cy="244" r="3.5" fill="#7c3aed"/>
    <text class="name" x="265" y="248">实时语音</text><text class="sub" x="265" y="263">realtime · 不留原始音频</text>
  </g>
  <g class="node" data-node data-name="MCP 幕布" data-desc="就是你现在看的这一块：一个隔离 iframe，内容由本地 MCP App 提供，只能通过有类型的意图跟宿主说话。">
    <rect x="476" y="230" width="222" height="44" rx="10"/><circle class="sigil" cx="492" cy="244" r="3.5" fill="#7c3aed"/>
    <text class="name" x="503" y="248">MCP 幕布</text><text class="sub" x="503" y="263">隔离 iframe · typed intent</text>
  </g>

  <path class="edge" d="M 349 288 L 349 301" marker-end="url(#arrow)"/>
  <text class="edge-label" x="361" y="301">HTTPS · 配好密钥才会连</text>

  <rect class="band" x="0.5" y="306.5" width="697" height="67" rx="13"/>
  <text class="band-label" x="13" y="322">外部 · 可选</text>
  <g class="node" data-node data-name="模型提供商" data-desc="OpenAI、Anthropic 之类。密钥存在本地凭据里，没有配置就完全不连，界面上也不会出现入口。">
    <rect x="0" y="330" width="222" height="30" rx="8"/><circle class="sigil" cx="16" cy="345" r="3.2" fill="#0ea5a5"/>
    <text class="name" x="27" y="349">模型提供商</text>
  </g>
  <g class="node" data-node data-name="本地文件" data-desc="导入的图片、PDF 都留在本机，库里只存文件引用；删掉记录不会顺手删你的原文件。">
    <rect x="238" y="330" width="222" height="30" rx="8"/><circle class="sigil" cx="254" cy="345" r="3.2" fill="#0ea5a5"/>
    <text class="name" x="265" y="349">本地文件</text>
  </g>
  <g class="node" data-node data-name="系统能力" data-desc="剪贴板、悬浮球、通知这些系统级入口；每一项都能在设置里单独关掉。">
    <rect x="476" y="330" width="222" height="30" rx="8"/><circle class="sigil" cx="492" cy="345" r="3.2" fill="#0ea5a5"/>
    <text class="name" x="503" y="349">系统能力</text>
  </g>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z"/>
    </marker>
  </defs>
</svg>
</div>
<footer class="board-foot">
  <span class="detail" data-detail>点任意模块，看它在这一层里负责什么。</span>
  <span class="status" role="status" data-demo-status>正在连接 Withu…</span>
</footer>
</main>`;

export function withuMcpAppResource() {
  let resource = '';
  const compile = async () => {
    const result = await build({
      entryPoints: [path.join(here, 'src/demo-view.js')],
      bundle: true,
      format: 'iife',
      globalName: 'WithuDemoView',
      target: 'chrome120',
      minify: true,
      write: false,
    });
    const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
    resource = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="__WITHU_APP_CSP__"><style nonce="__WITHU_APP_NONCE__">${css}</style></head><body>${markup}<script nonce="__WITHU_APP_NONCE__">${script};WithuDemoView.startDemoView().then(()=>{document.querySelector('[data-request-demo]').disabled=false}).catch(()=>{document.querySelector('[data-demo-status]').textContent='不可用：host 握手失败。'});</script></body></html>`;
  };

  return {
    name: 'withu-mcp-app-resource',
    async buildStart() { await compile(); },
    transformIndexHtml(html) {
      const hashes = tag => [...resource.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g'))]
        .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join(' ');
      return html.replace(/script-src 'self'/g, `script-src 'self' ${hashes('script')}`)
        .replace(/default-src 'self';/g, "default-src 'self'; media-src data:;")
        .replace(/style-src 'self'/g, `style-src 'self' ${hashes('style')}`);
    },
    resolveId(id) { return id === virtualId ? resolvedId : null; },
    load(id) { return id === resolvedId ? `export default ${JSON.stringify(resource)};` : null; },
  };
}
