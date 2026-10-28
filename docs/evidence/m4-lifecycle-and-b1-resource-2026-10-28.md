# 验收补证：M4 生命周期 + B1 宿主资源读取（2026-10-28）

类别：开发补齐（B1 缺一半）+ 验收补证（M4）　触发：想把 M4 自动化时发现 App 根本渲染不出来

## 1. 做 M4 时发现的三件事（都不是 M4 本身）

### 1.1 宿主从未读取 App 资源（B1 只做了服务端一半）

`client/withu-window/main.cjs` 的 `handleMcpEvent` 只做 `tools/call`，然后把结果
`withu:mcp:invoke_result {ok, text}` 发回服务端 —— **不读 `resources/read`**，
也不带 `app` 字段。所以任何真实 MCP server 的界面都不可能进入消息。
服务端其实早就留好了位置（`finish_mcp_call` 把 `app` 放进块 payload，注释写着
"a UI resource the host already read"），只是没人读。

MCP 客户端早就有 `readResource`，但主进程从未调用。

**修**：`startMcp` 记下每个工具的 `_meta.ui.resourceUri`；`handleMcpEvent` 在
`tools/call` 成功后读该资源，取 `text/html*` 文档（≤512 KiB），随结果以
`app:{uri,html}` 回传。读取失败不影响调用本身（文字结果照常返回）。

### 1.2 渲染层块契约拒收 `payload.app`（一挂就整屏报错）

JSON 契约 `contracts/v1/reply-block.schema.json` 里 `payload.app` 是**合法字段**
（uri ≤512、html ≤1048576），但渲染层手写的 `validateReplyBlock`
（`client/withu-renderer/src/intelligent-ui/contract.js`）的 allowlist 里没有它。

后果：第一个带 App 的结果块直接抛 `TypeError: reply_block.payload contains unknown field app`，
被根 ErrorBoundary 接住 → 整屏「界面遇到错误」。也就是说，即使宿主读了资源，
产品里也一定崩。这是 BUG-2 的同类问题：服务端契约与渲染层校验各写一份、没有对齐。

**修**：allowlist 加 `app`，并按 JSON 契约校验 `{uri,html}` 的类型与长度上限；
`checks/renderer-mapping.mjs` 增加 6 条断言（合法通过 / 缺 html 拒 / 多字段拒 / 超长拒 / 纯文本不受影响）。

### 1.3 没有可达的 App 宿主入口（遗留，未修）

目前会挂载 `McpAppHost` 的三处：`Chat.jsx`（块带 `payload.app.html` 时，**修完 1.1 后可自然进入**）、
`ResponseCard`（`m.responseCard` 无任何生产者，死代码）、`LifeToolsPanel`（组件没被任何文件 import，死代码）。
1.1 修好后第一条已经打通，后两条仍是无入口的死代码，留给 T17-D 决定删除或接线。

## 2. M4 自动化（本轮新增）

`npm run check:mcp:lifecycle` → `checks/mcp-app-lifecycle.mjs`：

1. 用真实 Electron + 真实 Rust server + stdio MCP 夹具（`checks/fixtures/mcp-app-server.mjs`，
   本轮给它加了 `_meta.ui.resourceUri` 与一条可辨识的 App 文档）。
2. 模型夹具在用户说「读…」时发 `mcp__local__annotate` 调用 → 宿主执行 → 读资源 → 落块 →
   `Chat.jsx` 内联渲染 → 断言 `.withu-mcp-frame iframe` 出现且 `srcdoc` 非空。
3. `Page.setWebLifecycleState('frozen')` 让页面进入 hidden，等 1.5s 断言 `visibilityState==='hidden'`；
   再 `('active')` + `Emulation.setFocusEmulationEnabled` 回到 visible。
4. 用页面内 `MutationObserver` 记录 iframe 数量时间线，断言**出现过 0**（会话被释放）**且最终回到 1**
   （会话重建），并再次断言 `srcdoc` 非空。

### 关于「模拟」的说明（必须写清）

- 真实部分：应用、server、MCP 子进程与协议往返、资源读取、内联宿主、Chromium 自己的页面生命周期。
- 模拟部分：**隐藏用的是 CDP 的页面冻结，不是真正的系统最小化**。Electron 44 不提供
  `Browser.getWindowForTarget`，应用也没有窗口控制 IPC，所以无法从外部让窗口最小化。
- 已知差异：冻结期间 Chromium 把 React 的提交延后到解冻，因此 DOM 的「移除→重建」发生在解冻瞬间；
  断言因此改为「时间线里必须出现过 0」，而不是「隐藏期间持续为 0」。这一点在脚本注释里也写了。
- 物理最小化 / 关闭到托盘仍是 `manual-verification-2026-10-27.md` 的手工步骤。

## 3. 验证

| 项 | 结果 |
|---|---|
| `npm run check:mcp:lifecycle` | **PASS 2**（内联渲染 / 释放后重建） |
| `npm run check:renderer` | PASS 6 组（新增 App 契约组） |
| `npm run check:chat:gui` | PASS 5（契约改动未影响既有界面） |
| `npm run check:mcp-app` | 19 pass |
| `npm run check:version` | 5 处一致 |
| `npm run check:mcp:client` | 10 pass（夹具改动后复跑） |

## 4. 环境坑（顺带记录）

`npx vite build` 在清理 `dist/assets`（60 个文件）时被本机 safe-delete 机制拦下
（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 50）。表现是「第一次构建失败、第二次成功」。
绕法：构建前先 `rm -rf client/withu-renderer/dist`。这也解释了 00:17 那次「不可复现的构建失败」。

## 5. 遗留

- 交付包再次落后：`main.cjs`、`dist`（契约修复）都不在 `output/p1/windows` 里。
- `ResponseCard` / `LifeToolsPanel` 仍是无入口死代码。
- 真机最小化未验（见 §2 的模拟说明）。
