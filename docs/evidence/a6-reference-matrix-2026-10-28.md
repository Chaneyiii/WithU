# A6 参考对照矩阵（2026-10-28）

**这是 roadmap 的硬门槛项**：B.6 / B.7 / B.19 / B.21 必须逐条写「采用 / 不采用 + 理由」，
空着按「未参考」处理、该阶段不通过。

## 0. 依据与边界（先说清楚）

- 对照依据是**本仓库 v3.8 方向文档附录 B** 记录的官方原文摘录（读取日期 2026-10-09 / 10-10，
  含 URL）与这些页面的公开文档，不是凭印象。
- **参考仓库不可达**：`E:/Orbit/withu-refs` 已不存在（本轮 `Test-Path` 为否），
  OpenMuse / codex / laya / WeKnora 等仓库本轮**没有重新读取**。因此本矩阵只覆盖
  「官方文档」这一路，不含「参考仓库源码」。
- 未复制任何参考项目的代码；引用的是文档中的公开描述。
- 每条都给出 Withu 侧的**落地证据**（代码位置 + 可复跑的检查），而不是「参考过」。

---

## B.6 语音主链路

**参考原文要点**（OpenAI Realtime API；xAI STT/TTS）

> “Use the Realtime API when the interaction should feel conversational and immediate... barge-in,
> low first-audio latency, natural turn taking, and realtime tool use.”

xAI 侧是「单次调用转写 / 单次调用合成，或 WebSocket 流式转写」。

| 决策 | 内容 | 理由 |
|---|---|---|
| **采用** | 全双工 WS 会话 + `server_vad` 轮次检测 + `response.cancel` 打断；`session.update` 下发工具目录；`response.done` 里的 `function_call` 走与文字同一条提案链 | 这正是「实时工具调用」的形态，且能复用已验证的授权链 |
| **采用** | 音色/模型由用户配置，后端能力决定是否可用 | 与「模型用户自定义」一致 |
| **不采用** | 把 xAI 那种「单次 STT / 单次 TTS」当作主链路 | 与 barge-in、低首音延迟、自然轮次直接冲突；这条产品路径已退役（`withu:voice:request` 现为 tombstone，见 `checks/RETIRED.md`） |
| **不采用** | 供应商文档替我们决定授权 | 供应商只描述工具调用机制；授权仍是 Withu 的 R07 |

**落地证据**：`apps/withu-server/src/realtime.rs`（会话/打断/工具调用）、`checks/realtime-wire.mjs`
（9 组，含 `response.cancel`）、`checks/realtime-tools.mjs`（11 组，含打断不产卡、O1 证据句、
A4 双入口、C5 通话中不打扰与恢复）、`checks/realtime-output-safety.mjs`（25 组）。

---

## B.7 流式回合

**参考原文要点**：Anthropic SSE 增量、OpenAI 可在生成完成前处理输出开头、xAI 推荐 Streaming；
v3.8 的决议是「provider-neutral 增量合同，只有 provider 明确终态且规则通过才 complete；
断流、取消、预算耗尽不得伪装完成」。

| 决策 | 内容 | 理由 |
|---|---|---|
| **采用** | 增量只表示「部分输出」；终态由 provider 明确信号（`finish_reason` / `response.done` / 流错误）决定 | 伪装完成会直接破坏审计与回执语义 |
| **采用** | 取消/断流落**固定公告**「回复已取消（可以重新发送）。」，不拼半截模型文本 | 半截输出不是回答，写进历史会被误读（BUG-6） |
| **采用** | 失败路径全部有真实终态码（`tool_arguments_invalid` / `tool_read_failed` / `provider_unconfigured` …），并落 `reply.updated` | 「失败路径一等公民」 |
| **不采用** | 把「流关闭」当作完成 | 供应商断流与正常结束无法区分，必须看显式终态 |
| **不采用** | 网络故障自动换模型重试后仍报成功 | 重试不等于用户同意，也不等于结果可用 |

**落地证据**：`apps/withu-server/src/replies.rs`、`checks/reply-wire.mjs`（15 条含三处取消断言）、
`checks/chat-tools-wire.mjs`（14 条，含非法提案/未知工具/偏移时区的诚实失败）。

---

## B.19 通知与定时规则

**参考原文要点**：通知分档（从不到「仅后台」再到「总是」）、权限通知与提问通知可分开控制；
任务要写明时区与结束日期、哪些结果值得通知；定时任务可暂停 / 恢复 / 删除。

| 决策 | 内容 | 理由 |
|---|---|---|
| **采用** | 策略化门控：`enabled` / `paused` / `quiet_hours` / `rate_limit`，且**应用是否运行**单独作为一道闸 | 桌面端的「后台才有意义」用「app_running」表达比三档开关更贴近本机事实 |
| **采用** | 通知结果**归因**（`shown_by_os` / `suppressed_policy` / `suppressed_app_stopped` / `suppressed_permission`），权限标志只作归因不作闸门 | 上一版把 `permission==='denied'` 当闸门，结果在 Windows 上把通知全吞了（已回滚） |
| **采用** | 暂停 / 恢复 / 停用都能让投递立刻改变；不追发（错过的候选不补发） | 与官方「pause / resume」一致，也避免半夜补弹 |
| **采用** | 通知正文用通用投影（`You have an update.`），不把候选内容写到锁屏 | 锁屏泄露风险；这是 Withu 自主取舍，不冒充三家规定 |
| **不采用** | 照搬「从不 / 仅后台 / 总是」三档 UI | 与现有设置面板的两维表达重复，且 GUI 已冻结 |
| **不采用** | 把官方任务频率选项当成「问候频率」推荐值 | 官方没有情绪问候频率规定；§8.3 的克制策略是 Withu 自定 |

**落地证据**：`crates/withu-proactivity`、`apps/withu-server/src/proactivity.rs`、
`checks/proactivity-notification.mjs`、`output/probe/gate-probe.mjs` 实测五态
（`disabled` / `duplicate` / `app_stopped` / `paused` / `eligible`）、
`checks/realtime-tools.mjs` 的 C5 两条。

---

## B.21 MCP Apps（Intelligent UI 承载）

**参考原文要点**：MCP Apps 是**可选扩展**，必须通过扩展能力机制显式协商；
所有 View **必须**在受限 sandbox iframe 渲染；`_meta.ui.resourceUri` → `ui://` 资源 →
host `resources/read` 取 `text/html;profile=mcp-app`；`visibility` 区分 model/app；
CSP 限制连接与嵌套 frame；生命周期含 teardown；动作 payload 是**不可信输入**，必须先校验授权。

| 决策 | 内容 | 理由 |
|---|---|---|
| **采用** | 扩展协商（`io.modelcontextprotocol/ui`），未协商上就**降级为文字**而不是硬报错 | 可选扩展的正确语义；B6 落地 |
| **采用** | sandbox iframe + CSP + 内联脚本 nonce，origin 固定 `null` | 与「必须 sandbox + CSP」一致 |
| **采用** | 动作走 typed intent 白名单 + R07 审批；App 自绘的确认按钮不构成 Withu 审批 | payload 不可信，宿主必须重新校验 |
| **采用** | `ui/resource-teardown`、卸载即撤销会话；窗口隐藏时释放会话与 iframe | 资源释放是规范的一部分 |
| **不采用** | 默认承诺 `window.openai` 旧 Apps SDK 应用免适配可跑 | 那是另一套宿主 API，未经适配不能承诺 |
| **不采用** | 引入 ChatKit 整套 UI / Claude 专属 sandbox 域名 | 已有 GUI 且已冻结；域名绑定会把 host 锁死在单一供应商 |
| **不采用** | 用工具元数据（`readOnlyHint` 等）替代真实动作分类 | 自报字段不能当授权依据 |

**落地证据**：`client/withu-mcp-app/src/host.js`（origin/session/size/teardown 守卫）、
`McpAppHost.jsx`（host 侧生命周期）、`client/withu-mcp-app/test/*`（19 条：协商、隔离、授权、
teardown、媒体协调、无 UI 降级）、`checks/mcp-tools-wire.mjs`（9 条）、`checks/mcp-client.mjs`（10 条）、
`docs/evidence/b6-no-ui-fallback-2026-10-28.md`。

---

## 结论

- 四条都能给出「采用什么 / 不采用什么 / 为什么」以及可复跑的落地证据，不依赖「我记得参考过」。
- **缺口如实标注**：参考仓库本轮不可达，B.6/B.7/B.19/B.21 的对照建立在官方文档摘录之上，
  没有重新阅读 OpenMuse / codex / laya / WeKnora 的源码。若终审要求「参考仓库源码」这一路，
  需要先把 `withu-refs` 恢复可访问再补一轮。
