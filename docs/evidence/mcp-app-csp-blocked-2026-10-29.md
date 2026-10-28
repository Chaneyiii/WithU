# 内联 MCP App 握手超时：宿主 CSP 挡住了运行时 App（2026-10-29 实测）

## 1. 结论

**不是夹具不握手，是宿主页面的 CSP 把 App 的脚本拦掉了。**

- 宿主页 `index.html` 的 CSP 是：`script-src 'self' 'sha256-DxIrVYx/…'`
  —— 只白名单了**内置演示 App**那一段脚本的哈希。
- 内联宿主用的是 `srcdoc` iframe，而 **srcdoc iframe 会继承父页面的 CSP**。
- 于是任何「运行时 App」（第三方、或我们夹具提供的文档）里的内联脚本，都会被这条
  `script-src` 拒绝；CSP 是求交集，文档自己的 `nonce-…` 救不回来。
- App 脚本没跑 → `ui/initialize` 从未发出 → `AppBridge` 等不到初始化 → 10 秒后宿主打印
  「MCP App 握手超时；重新打开可重试」，并 `stop()` 把 iframe 拆掉。

这也解释了**为什么最小化再恢复仍然超时**：每次重挂都是同一个 `srcdoc`，都撞同一堵 CSP 墙。

## 2. 证据（这次是真的抓到了）

在 iframe 的独立执行上下文里（CDP 连 `about:srcdoc` 目标）读到：

```
state 文本 = "boot"          ← 脚本从未执行（执行了至少会变成 connecting/connected/error）
控制台日志  = "Executing inline script violates the following Content Security Policy
              directive 'script-src 'self' 'sha256-DxIrVYx/lhhWECHkf3Ks5UlnExYLkJX44axm/k/7ius=' …"
```

对照宿主页实际下发的 CSP（`client/withu-renderer/dist/index.html`）：

```
default-src 'self'; media-src data:;
script-src 'self' 'sha256-DxIrVYx/lhhWECHkf3Ks5UlnExYLkJX44axm/k/7ius=';   ← 只有内置 App 的哈希
style-src 'self' 'sha256-Wt0kLixN4e4ix2C+/bXmkyR9TYgwmZ8EPVzTIUwkCQY=' 'unsafe-inline';
img-src 'self' data: https:; font-src 'self'; connect-src 'self';
frame-src 'self' about:; object-src 'none'; base-uri 'none'
```

这个哈希是构建期由 `client/withu-mcp-app/vite-plugin.mjs::transformIndexHtml` 注入的——
它只认识**打进包里的那一个**演示 App，不认识任何运行时 App。

## 3. 为什么之前没发现

- `check:mcp:lifecycle` 只断言「iframe 出现 + srcdoc 非空」，**没有断言握手完成**；
  App 脚本被拦掉时 iframe 照样在，检查照样绿。
  （本次已把断言改成必须出现「已连接」且不得出现「超时」，于是它现在会**如实失败**。）
- 内置演示 App 走的是 `makeAppDocument` + 自己的哈希，所以它在抽屉里一直能连——
  唯一一个能连的 App，恰好是唯一一个被 CSP 认识的。
- 之前的真机验收根本没用过运行时 App（`ResponseCard` 入口是死代码），所以没人撞上。

## 4. 试过但没验证成功的修法（已回退，不作为交付内容）

思路：把运行时文档从 `srcdoc` 改成 `blob:` URL（blob 有自己的不透明源，不继承父页 CSP），
同时把 `frame-src` 放宽到 `frame-src 'self' about: blob:`。

结果：iframe 仍然超时；而且 `/json/list` 里看不到该 iframe 的任何目标或执行上下文
（只有宿主页一个 target、一个 context），说明这个 blob 文档在「无 `allow-same-origin` 的 sandbox iframe」
里**根本没加载起来**。原因是沙箱对 blob 的限制还是别的问题，当晚没定论。

为了不把未验证的安全相关改动写进交付，已 `git checkout` 回退，工作区与包保持一致。

## 5. 要修的话，得选一条路（都需要单独验证）

| 方案 | 做法 | 风险/代价 |
|---|---|---|
| A 自定义协议 | 注册 `withu-app://` 协议（registerSchemesAsPrivileged + protocol.handle），把它加进 `frame-src`，App 文档从该源加载 | 新协议要过 `mcp-frame-policy` 的导航白名单；CSP 要加 `frame-src withu-app:` |
| B blob（再查） | 排查 blob 在 sandbox iframe 里为何不加载（可能需要 `allow-same-origin`，但那会破坏隔离，不建议） | 与「不透明源」要求冲突，可能走不通 |
| C 放宽宿主 CSP | `script-src` 加 `'unsafe-inline'` | **不建议**：等于给整个渲染层开洞 |

推荐 A：它保持「App 在独立源、宿主 CSP 只认自己的脚本」，而且能让第三方 App 真正跑起来。

## 6. 对验收的影响

- 第 5 项（MCP 端到端）**阻塞**：能看到 `annotated:上课` 与内联壳，但壳里连不上，
  状态停在「握手超时」。
- 第 6 项（最小化后重建）**一并阻塞**：没有成功的会话可释放/重建。
- 验收对照表已注明这两项被这个缺陷阻塞，不计入「未通过」的界面问题，而是产品缺陷待修。

## 7. 方案 A 的第一次尝试（2026-10-29 00:26–00:30）与结果

按方案 A 落地了 `withu-app://` 自定义协议：

| 改动 | 内容 |
|---|---|
| main.cjs | `protocol.registerSchemesAsPrivileged([{scheme:'withu-app',privileges:{standard:true,secure:true,…}}])`；宿主读到 App 文档时存进 `mcpAppDocs`（uri → html）；`protocol.handle('withu-app', …)` 按 uri 返回文档 |
| 渲染层 | `McpAppHost` 增加 `resourceUri`；运行时文档改为 `frame.src = 'withu-app://doc/' + encodeURIComponent(uri)`；`Chat` 传 `resourceUri` |
| CSP | `frame-src 'self' about: withu-app:` |
| 导航策略 | `mcp-frame-policy` 放行 `withu-app://` |

结果：**没跑通，已全部回退**。

- 第一次启动直接崩：`ReferenceError: protocol is not defined`（解构里漏了 `protocol`）——用户截图里的报错框就是这个。
- 补上后又跑：iframe 里读到的是 `{"state":null,"head":"<html><head></head><body></body></html>"}`，
  也就是**空白文档**（about:blank 级别的空壳），说明 `withu-app://` 的文档没有被真正供应出来，
  握手仍然超时。进程 stderr 里没有 `app protocol failed`，所以不是 handler 注册失败，
  而是导航/供应这一层还有别的问题（scheme 注册时机、file:// 页面加载特权 scheme、
  或 handler 返回体的形式）——当晚没继续深挖。

**当前代码状态**：`git checkout` 回到 srcdoc 版，工作区干净；夹具、检查的加固保留。
也就是说：缺陷仍在，但这次尝试没有留下半成品。

下一步建议（下次开工按顺序）：
1. 先用最小复现验证 `withu-app://` 能否从 `file://` 页面加载：在 dev 里手动建一个
   `<iframe src="withu-app://doc/ping">`，handler 固定返回一段文字，看是否显示。
2. 若 file:// 受限，改为在 `ready` 之后把窗口加载方式换成自定义协议（`app://`），再让
   App 用子协议；这一步动的是窗口装载路径，影响面更大，需要单独验证。
3. 或退回方案 B'：让 **server 端**把 App 文档托管在既有本地回环端口上（带一次性 token
   与 `connect-src` 限制），iframe 走 http；代价是 App 与本地 API 同源风险，需要 token 隔离。
