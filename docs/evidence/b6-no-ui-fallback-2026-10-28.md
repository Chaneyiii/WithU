# 集成修复证据：B6 无 UI 能力降级（2026-10-28）

类别：开发补齐（B6 / T16-B「无 UI 能力服务：继续提供文字或原生卡片，不伪报兼容」）

## 1. 修复前

`client/withu-renderer/src/components/McpAppHost.jsx`：

- `if (!fixture.negotiated) throw new Error('MCP Apps capability negotiation failed')`
- `if (!resource) throw new Error('MCP App resource unavailable')`
- 兜底 `catch` 把文案设成「MCP App 不可用: <原始错误>」，但 `<div className="withu-mcp-frame">` **仍然渲染** —— 界面上是一个空框加一行英文错误码。
- 结论：既没有回落成文字，也等于用一个空壳「假装是 App」，与 B6 的「不伪报兼容」相反。

## 2. 修复后

新增 `client/withu-mcp-app/src/app-fallback.js`（纯函数，可单测）：

| 导出 | 作用 |
|---|---|
| `APP_ERROR.noUi` / `.noResource` | 两个已知失败原因的**唯一定义**，宿主与测试共用，防止文案漂移 |
| `classifyAppFailure(error)` | `no_ui` / `no_resource` / `error` 三分类 |
| `appFallbackNotice(kind)` | 每种原因一句诚实文案，未知原因回落到通用句 |

`McpAppHost.jsx` 的改动：

1. 协商失败 → `setFallback('no_ui')` + 状态「这个服务没有提供界面，结果以文字呈现。」，随后 `stop()`，**不再抛错**。
2. 资源缺失 → `setFallback('no_resource')` + 状态「这个服务的界面资源不可用，结果以文字呈现。」。
3. 其他异常 → `classifyAppFailure` 得到 `error`，状态「MCP App 暂时不可用；结果以文字呈现。」。
4. 渲染层只加一个条件：`{!fallback && <div className="withu-mcp-frame" ref={mount}/>}` —— 降级时不渲染空框，消息本身的文字块继续承载结果。

**正常路径零变化**：`negotiated === true` 且资源可读时 `fallback` 始终为 `null`，渲染与改前逐字节一致。GUI 冻结约束下这是「异常分支才生效」的改动。

## 3. 验证

| 层 | 证据 |
|---|---|
| 源码实现 | `app-fallback.js` + `McpAppHost.jsx` 4 处 |
| 自动化 | `npm run check:mcp-app` **19 pass / 0 fail**（新增 3 条：分类正确；每条降级文案都承诺「文字」且不含「已连接/已加载/正常」；未知原因回落通用句） |
| 构建 | `vite build` 通过（JSX 语法与打包均正常） |
| GUI 回归 | `check:chat:gui` PASS 5（不白屏、审批卡终态、候选胶囊） |
| 未验 | 真实 Electron 里制造协商失败：包内 App 必然协商成功，要验这条得接一个**确实没有 UI 扩展**的第三方 MCP server，当前没有凭据/服务 |

## 4. 遗留

- 这条证据是「逻辑 + 单测 + 构建」，不是真机负面用例；roadmap 的第三方服务真机验收仍归 T17-C。
- 交付包未重打：`dist` 与 `output/p1/windows` 内的 app.asar 已不同步（B6 改了渲染层）。与 A4 的 server 改动一起，冻结前需要一次完整重打包 + 三个哈希重录。
