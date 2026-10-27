# Phase 6–7 任务计划（基于现状实测的评审版）

日期：2026-10-26。编制依据：`docs/superpowers/plans/2026-10-26-phase6-7-plan.md`（下称「原计划」）、`docs/superpowers/plans/2026-10-20-demo-phase-roadmap.md`（下称「roadmap」，权威）、`docs/product/withu-v3-spec.md` v3.8、`docs/releases/v0.3.1go4.md`、`D:\ccc2\Desktop\ai\withu\测试报告与修复计划-2026-10-25.md`、`D:\ccc2\Desktop\ai\withu\计划核对-未完成项-2026-10-25.md`，以及对本仓库 `102f3a2` 提交树的实测。

**本文性质**：不改原计划的验收标准，只做三件事——把原计划中「当作验收项」但实测是「净新增开发」的部分标出来；修正有冲突的执行顺序；列出必须由你决定才能开工的空白点。

**修订记录**
- v1（2026-10-26 19:42）：首版，基于 `102f3a2` 实测。
- v2（2026-10-26 19:55）：录入 D1（MCP App 沿用 renderer iframe）、D2（打包跳 v0.3.1go5）、D3（模型未接入，全线用假模型）；**修正 v1 对 T16-A 的量级判断**——实测发现文字流式路径的 `function_call` 解析与 `chat_tools::map` 可复用、barge-in 已实现、语音 fixture 端点已存在，故 A1 由「从零写」降级为「高复用接线」，但仍属本轮最大开发项；新增 §6.2 语音动作能力三档说明，等你在 (a)/(b)/(c) 中择一。
- v3（2026-10-26 20:18）：**Q1 定为 L2**（D4），GUI 冻结升级为**铁律**（D5，§1.6 给出机械门禁）；新增 §2.5「L2 落地设计」（五个改动点、零 renderer 改动证据链、live/non-live 锚点矛盾），A1 拆为 A1a（可立即做）/A1b（待 Q8）；新增 Q8（通话锚点）、Q9（volc 协议 tools 支持）与风险 R10/R11。
- v4（2026-10-26 20:45）：**A1a 已实施并验证**（语音 function call → 审批卡 → 显式允许 → 落库；cowork 不带工具；打断不产卡）。修正 v3 的一处误判：`assistant-message.schema.json` 的 `properties` 里**本来就有 `blocks`**（我上一版看的是截断字段表）。录入 D6（Q8=O1）、D7（Q9=单后端）。

---

## 0. 结论摘要

1. **最大偏差：T16-A 的主项不是「验证双入口一致」，而是「给语音接上动作能力」。** `apps/withu-server/src/realtime.rs`（503 行）里 `prepare` / `allow` / `execute` / `approval` / `audit` / `tool` 命中数为 **0**——语音只有「人格注入 + 双向对话」，说「明天三点提醒我开会」时模型会口头答应，但**不会产生任何提案**。而方向文档（第 552–553 行）要求「点击与语音形成同一个 typed action」，B.6 明文引用 Realtime API 的 "realtime tool use"。所以原计划 §2.1 第一条「断言两边产生的审计与卡片字段一致」在现状下无法执行：**缺的不是断言，是被断言的对象**。
   > 修正 v1 的措辞：这**不是从零**。文字侧已有可直接复用的三段——`chat_tools::definitions()`（工具目录，`main.rs:2092`/`replies.rs:893` 在用）、`chat_tools::map(name, args, conversation, now) -> Intent`（参数重校验，`main.rs:2381`/`2993` 在用）、`replies.rs:554` 的 `function_call` 参数累加器（含流式分片与 `response.completed` 权威覆盖）。A1 的实质是「让 realtime 循环产出与文字相同的 function_call，再喂进同一条提案路径」，属**接线为主、结构微调为辅**。
2. **原计划的 P5.1 顺序会导致白做。** 原计划把「重打包 + ENV-4 补录」排在 P5.1 第一位，但 P5.2（BUG-6）、P5.3（GUI 检查）都会改源码。先打包再改码，包就作废。正确顺序是**先改完码，最后打包**。
3. **「冻结树」在本仓库不能只靠提交复现。** `.gitignore` 排除了 `target/`、`output/`、`**/dist/`、`node_modules/`。`dist/` 被忽略意味着 renderer 构建产物不在提交里，打包前必须重新 `vite build`；`output/p1/windows` 里的包既不完整（**目录内没有 zip**）也是修复前的产物（10-25 18:42）。T17-B 的「冻结树」必须定义为「同一提交 + 重新构建」，不能定义为「拿现有包复测」。
4. **MCP App 宿主形态已定为 renderer iframe（D1，已决策）。** 实测宿主是 renderer 内的 `McpAppHost.jsx` + `client/withu-mcp-app/src/host.js`（`PostMessageTransport` + `@modelcontextprotocol/ext-apps/app-bridge`，`sandbox: allow-scripts`，origin 固定 `'null'`），`client/withu-window` 下**没有** `WebContentsView` 实现。你已确认沿用 iframe，因此原计划 §2.2 括注「Electron WebContentsView」按**笔误更正**处理，B4 的资源释放对象相应限定为 iframe / 附属端口 / 子进程，不含浏览视图。
5. **主动性、通知的代码基础比预期好。** `crates/withu-proactivity/src/lib.rs`（313 行）已含安静时段、暂停、`evaluate` 不追发逻辑；`client/withu-window/proactivity-notifications.cjs` 已实现 `suppressed_policy` / `suppressed_app_stopped` / `test_preview` / `shown_by_os` 四分支并有 `checks/proactivity-notification.mjs` 用 fake `Notification` 覆盖。**缺的是真机证据与「系统权限被关」的降级**，不是从零重写。
6. **两处文档级问题**：原计划引用的两份核对文档相对路径多算了一层（实际在仓库上一级 `withu/`）；`docs/releases/v0.3.1go4.md` 仍写着基线提交 `4d5ad38`、上一版 `7a6f5df`，这两份提交在新历史中不存在，T17-D 必须显式声明。
7. **打断其实已经有实现（修正 v1 的担心）。** `realtime.rs:392`（`interrupt`/`mute` 控制）与 `:448`（`speech_started` 到达时）都会清空累积并发 `response.cancel`；`checks/realtime-wire.mjs` 断言了打断触发 `response.cancel`，`checks/realtime-client.mjs` 断言了「立即打断、迟到 generation 丢弃、挂断时等待麦克风轨释放」。所以 A2 不是「补打断」，而是**「打断时若已产生提案，必须不落库」**——这一条要等 A1a 落地之后才有对象。
8. **语音 fixture 已存在，假模型不妨碍语音链路的开发与自动化验收。** `checks/realtime-wire.mjs` 里的 `realtimeFixture()` 是真 `WebSocketServer`，能下发 `session.update`、转写分片、音频分片、`speech_started`，也能断言服务端是否发出 `response.cancel`。因此 A1 可以在零真实凭据下开发并逐项断言（包括让它伪造 `function_call` 事件）；而真实声学质量与「真模型是否可靠地调用工具」只能留到 T17-C。
9. **在「模型未接入」这个前提下，T17 的终点大概率就是 roadmap 那句红线状态。** 真实模型、真实连接器、真实声学、Windows 通知真机四项全部未闭合时，交付结论应预设为「工程包可交接，产品验收未完成」。因此 T17-D 的材料要按**工程交付 + 诚实边界**来设计，而不是按「产品验收通过」来设计——这不是失败，是本项目当前阶段的正确终点。
10. **L2 已定，且与 GUI 铁律不冲突——但通话模式有一处硬矛盾。** 卡片由 server 生成 `reply-block`、`Chat.jsx:174` 通用渲染，所以 L2 可零 renderer 改动达成（§2.5.3 有证据链）。但 `session.live`（`main.rs:882`）下语音转写**不入库**，而 `propose_life_action` 强制要求锚定已提交的用户消息（`main.rs:2416`）——所以 L2 必须拆成 A1a（非通话，锚点天然存在，现在就能做）与 A1b（通话，需先在 Q8 里定锚点策略，且会撞 A5 的 Live 边界）。

---

## 1. 任务目标与背景理解

### 1.1 项目所处位置

WithU 是本地优先的桌面陪伴型 Agent（Electron + Rust server + React renderer）。roadmap 把 T01–T17 划为 8 个阶段：Phase 0–2 界面（已完成、GUI 冻结、用户视觉验收通过，v0.3.1go3）、Phase 3–5 自然对话能力（T09–T15，代码完成并发布 v0.3.1go4，但真实服务/真机验收未闭合）、Phase 6 多入口集成（T16）、Phase 7 交付（T17）。

前工程师交接的实际形态是：源码树从 zip 解压重建，**历史提交不可考**（原目录无 `.git`，文档中的 `7a6f5df` / `4d5ad38` 无法核实），本轮在 `WithU-0.3.1go4` 树上新建仓库并打了一个快照提交。因此「谁在什么时候改了什么」这条线索在本项目是断的，T17-A 的「冻结与终审」只能以新历史的提交为准。

### 1.2 Phase 6 的实质目标（我的理解）

T16 不是加功能，而是**把已经能跑的单条链路，扩成经得起追问的三种入口 + 一套运行边界**：

- **一致性**：同一个动作（提醒/草稿/检索）无论从文字还是语音发起，都必须落到同一条 `prepare → allow → execute`，同一版本 CAS，同一张结果卡，同一份审计。判定标准是「两条路径产生的审计与卡片字段可逐字段对照」，不是「两条路径都能work」。
- **安全性**：任何入口都不能绕过 R07 审批；第三方 UI 自绘的确认按钮不构成 Withu 授权。
- **诚实边界**：Live 只存时长摘要；无 UI 能力的 App 不伪报兼容；真机不可用时如实标注而非用模拟顶替。
- **运行边界**：窗口隐藏时主动性照常（server 是独立进程），**应用完全退出后必须零主动行为**。

### 1.3 Phase 7 的实质目标

把「能演示」变成「可交接」：冻结一个可复现的源码提交 + 一个可校验的包，四层证据（源码实现 / 自动化验证 / 真实服务验证 / 真机人工验收）逐项闭合；任何未闭合项必须写在交接状态里，而不是被「已打包」掩盖。roadmap 的红线原文是：真实服务/真机验收缺失时，交接状态写「工程包可交接，产品验收未完成」。

### 1.4 本轮的硬约束

- **GUI 已冻结**：不做结构性改动；确需新界面先经你决策并更新方向文档 §5。
- **真机门槛**：Windows 通知中心、Focus Assist、真实声学（麦克风/扬声器）、第三方服务，四项分别要真机记录，模拟证据不替代。
- **参考对照**：每个 T 项动手前要按背书矩阵查参考仓库/官方文档并留「参考对照」栏，无证据的「参考过」按未参考处理。
- **一次一个 T 项**，共享的界面/IPC/server 路由/版本文件顺序集成。

### 1.5 已确认前提：模型未真正接入（D3）

你已说明：本项目目前**没有接真实模型**，用的是假模型（fixture / 本地 SSE endpoint），目的是把功能链路跑通、把结构性问题暴露出来，便于调试。这条前提对计划有五个直接后果，必须写进执行口径：

1. **「真实模型端到端」不是待办，而是本轮不打算做的事。** 原计划 P5.4 与 roadmap 的 T09/T10 真实模型行，在当前阶段维持「未验证」，不是遗漏。任何「已通过」的结论都只能限定在「接线与失败路径」范围内。
2. **假模型恰好是最有效的渲染层回归手段。** 因为它可脚本化地制造「running 空文本帧」「超时」「畸形响应」「中断」这些真实模型不会稳定复现的边界，`P5.3` 的 GUI 检查就应该以 fixture 为主力，而不是等真模型。
3. **语音链路同样可被 fixture 驱动**（见 §0 第 8 条），所以 A1 的开发与自动化验收不受凭据阻塞；受阻塞的只是「真实声学 + 真模型行为质量」。
4. **T17-C 的人工验收将大面积留空**，T17-D 必须如实列「诚实桩」清单：模型对话质量、T12 连接器、T13 校准、语义索引降级，以及本轮新增的「语音动作在真实模型下的可靠性」。
5. **风险重心从「模型不听话」转到「链路自身不自洽」。** 这是好事：本轮所有缺陷都归因于我们自己的代码，可复现、可断言、可修——BUG-1/BUG-2 就是这个模式抓出来的。

---

### 1.6 GUI 冻结铁律（你的明确要求，优先级高于本文件其余一切安排）

**定义**：`client/withu-renderer/src/**` 的**结构与交互**不做任何改动。不新增、不删除、不改写任何可见元素、布局、层级、文案位置、交互控件；组件树、事件处理语义、文案 key 都算在内。

**允许**（不构成改动）：

- `checks/**` 新增检查脚本——外部驱动，不进产品包；
- server 侧产生新数据（`blocks` / 事件），由**既有**组件按**既有**契约渲染；
- 纯后端与契约层的任何改动。

**禁止**：

- 新增组件、控件、面板、按钮、图标；
- 调整布局、间距、层级、动效；
- 新增 UI 状态视觉（例如新的「已取消」徽标样式）——必须用既有元素承载。

**需事前单独批准**（默认按禁止处理）：

- 文案值修改（即使当前是错的）；
- 任何 `client/` 下的 bug 修复，无论多小。

**机械门禁**（每次提交前我自己跑，不靠记性）：

1. `git diff --stat -- client/` **必须为空**；若非空，立即停止并向你说明原因，等你批准，不自行判断「这个改动很小」。
2. `npm run check:renderer`、`npm run check:desktop` 必须仍全绿——冻结不等于免检。

**对当前待办的两个直接结论**（现在就能判定，不需要试）：

- **A1（L2 语音动作）与铁律不冲突，可零 renderer 改动达成**：卡片由 server 生成 `reply-block` 挂到助手消息的 `blocks` 字段（`main.rs:3059` 就是这么构造的），渲染层 `Chat.jsx:174` 的 `MessageBlocks` 已按 `m.blocks` 通用渲染，`IntelligentSurface` 复用既有状态机。语音链路只要产出的消息形状与文字一致，界面就会自己出现——这正是「同一动作同一卡片」的自然结果，不是新增界面。
- **BUG-6 的原方案 (b) 违反铁律**：它要新增「重试按钮」= 新增交互控件。因此改用 (a)：落一条「回复已取消」的**普通助手消息**，用既有气泡渲染，零新元素。若你确实想要重试按钮，那属于冻结例外，必须你单独批准，我不会顺手加。

---


## 2. 当前代码与提交状态分析

### 2.1 Git 事实（实测 `git log` / `git ls-files` / `git status`）

| 项目         | 实测结果                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 提交         | `102f3a2`（全号 `102f3a2910018bfe53b794226ae88ca0adba9007`），作者 `anticbv <3538594181@qq.com>`，2026-10-26 18:22:12 +0800              |
| 规模         | 571 文件 / 71,936 插入，单次根提交（无父提交）                                                                                                   |
| 分支         | `codex/demo-phase-0-1`（唯一分支）                                                                                                     |
| 标签         | `v0.3.1go4-postfix`                                                                                                              |
| 工作区        | 干净（`git status --short` 空）                                                                                                       |
| remote     | **无**（`git remote -v` 空）                                                                                                         |
| .gitignore | `/target/` `/target-stage*/` `/var/` `/tmp/` `/output/` `**/dist/` `/node_modules/` `**/node_modules/` `*.tmp` `*.log` `*.local` |
| 提交信息       | 已如实写明「历史提交不可考，冻结哈希将来取自本新历史」                                                                                                      |

**这三点必须写进 T17-D**：① 新历史只有一个提交，所有「修复在某次提交」的说法都无法用 `git log` 佐证；② 没有 remote，本地磁盘是唯一副本；③ `output/`、`dist/`、`target/` 不入库，所以「冻结提交」≠「冻结可执行包」，两者之间隔着一次完整重建。

### 2.2 原计划论断的逐条核实

| 原计划断言                             | 实测证据                                                                                                                                      | 结论                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| BUG-1..5 已修复并按 GUI 复验             | `Chat.jsx:4` 有 `import Loader from './Loader'`；`src/memory-candidate-event.js`、`checks/renderer-mapping.mjs`（`npm run check:renderer`）均在树 | ✅ 一致                                         |
| soul.md 尾注改为「Lumi，2026 年秋。」       | `client/withu-renderer/public/soul.md` 末行 `*Lumi，2026 年秋。*`                                                                               | ✅ 一致                                         |
| realtime 补注入 soul.md              | `realtime.rs:355` `instructions = format!("{}…", crate::SOUL_MD, …)`，注释解释了「同一个人在两种媒介里得是同一个人」                                              | ✅ 一致                                         |
| 新增 `checks/soul-inject-probe.mjs` | 文件存在（3,988 B）                                                                                                                             | ✅ 一致，但**未进 `package.json` scripts**，不是「常规检查」 |
| 自 BUG-1..5 后未重新打包                 | `output/p1/windows` 时间戳 2026-10-25 18:42，含 `Withu-win32-x64/` + `source-scan.json`；**目录内无 zip**                                           | ✅ 一致，且比计划更差一档（无 zip 可交付/可复算哈希）               |
| BUG-6 未实施                         | 全仓 `BUG-6` 仅出现在计划文档，代码零命中；`回复已取消` 零命中                                                                                                     | ✅ 一致                                         |
| P5.3 渲染层 GUI 检查未固化                | `package.json` 无 `check:chat:gui`；`check:desktop` 仅跑 normal/restart/malformed/crash/eof/timeout 六场景生命周期                                   | ✅ 仍待做                                        |
| P5.5 soul 注入未成常规检查 | `package.json` 无 soul 相关 script；realtime 路径无对应断言 | ✅ **已补齐**（脚本改真断言 + `check:soul` + 语音侧两条断言） |
| 引用 `../../../测试报告…`               | 实际位于 `D:\ccc2\Desktop\ai\withu\`（仓库**上一级**）                                                                                               | ⚠️ 路径写错一层，不影响内容                              |

### 2.3 代码现状：Phase 6 三条线的真实起点

**T16-A 文字/语音（起点最低，但可复用度比 v1 判断的高）**

- `realtime.rs` 503 行的实际职责：建 WS → `session.create`/`session.update` → `input_audio_buffer.append` 转发 → 事件归一化（`session.created`→`session.updated`、转写分片→`speech_started`/`speech_stopped`、`output_text`/`output_audio`→渲染层事件、`response.done`）→ 取消集合 `cancelled` → `SafeText` 敏感值脱敏 → `transcript_items` 去重 → 上限保护（256 条）。
- **已具备**：`session.create`/`update` 已带 `instructions`（soul.md 注入）、历史种子（`conversation.item.create`）、`turn_detection: server_vad`、barge-in（`:392` 与 `:448` 主动发 `response.cancel`）。
- **缺失**：`tools` 字段从未下发；`response.function_call_arguments.*` 与 `response.output_item.added(type=function_call)` **没有任何分支**，落到默认路径被忽略；`response.done` 分支是 `continue`（`:435`），不解析 `output` 里的 function_call；因此不存在「语音提案」这个东西。
- **可复用**（这是 A1 从「L/从零」降为「M–L/接线」的原因）：
  - `chat_tools::definitions()` —— 工具目录，文字侧两处在用；
  - `chat_tools::map(name, args, conversation_id, now) -> Intent` —— 全部参数重校验（字段双列表、时区、墙钟格式、过去时间拒绝），文字侧三处在用；
  - `replies.rs:554` `push_responses_item` / `push_anthropic_delta` —— 流式分片累积 + `response.completed` 权威覆盖 + 多个 tool call 拒绝（`tool_call_invalid`）。目前它是 `replies.rs` 的私有方法，A1 需要把它提到可共享位置（小重构，非重写）。
  - OpenAI Realtime 的函数调用事件名与 Responses 流式**同族**（`response.function_call_arguments.delta` / `response.output_item.added` / `response.done`），因此上述解析逻辑可直接迁。
- **结论**：T16-A 第一条仍是「开发补齐」，但性质是**把 realtime 的 function_call 事件接到既有提案路径**，而不是新写一套动作语义。真正的风险不在代码量，而在 §6.1 的产品口径（语音能发起什么、说到哪一步算数）。

**T16-B MCP App（起点中等）**

- `client/withu-mcp-app/src/host.js`（70 行）：`PostMessageTransport` + `JSONRPCMessageSchema` 前置校验 + 会话/Opaque origin/尺寸检查，`sandbox: 'allow-scripts'`，`allow="camera 'none'; microphone 'none'; …"` —— 隔离模型的骨架是对的。
- `client/withu-renderer/src/components/McpAppHost.jsx` 是实际挂载点（renderer iframe 路线）。
- `client/withu-window` 下 grep 无 `WebContentsView` / `iframe` 相关实现。
- 已有 `host.test.mjs` / `protocol.test.mjs` / `media.test.mjs` / `browser-runner.cjs`，属 fixture 级。
- **结论**：隔离与握手有基础；缺的是「真实对话触发全生命周期」「App 内动作走 R07」「资源释放编排」的实证。

**T16-C 主动性（起点最高）**

- `withu-proactivity/lib.rs`：`QuietHours`、`PolicyConfig`、`Policy::evaluate`（含 `is_quiet`、暂停、不会因配置变更回放积压）、`set_enabled`/`set_paused`。
- `client/withu-window/proactivity-notifications.cjs`：`showProactivityNotification` 返回 `suppressed_policy` / `suppressed_app_stopped` / `test_preview` / `shown_by_os`，且正文不含私密标记（`checks/proactivity-notification.mjs` 断言了不泄漏 `Private memory marker`）。
- **结论**：门控与「退出后不主动」的逻辑已在代码里并有 fixture 覆盖；缺的是 Windows 通知中心真机、Focus Assist、系统权限被关的降级呈现、通话中静默/延后。

### 2.4 与 Phase 7 相关的资产状态

| 资产                           | 状态                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `docs/releases/v0.3.1go4.md` | 记录了 zip/exe/server 三个哈希；但 zip 哈希与用户手上的包不一致（ENV-4 未销），且当前树内已无 zip                                                               |
| `package.json` scripts       | 37 个检查入口齐全（`check` / `check:desktop` / `check:packaged` / `check:product` / `check:renderer` 等），**无 GUI 对话回归入口**               |
| `checks/package-windows.mjs` | 从 `electron-packager` 打包，`ignore` 列表排除 `output/target/.git/crates/apps/docs/checks`，写 `manifest.json`（exe/server/app.asar 三哈希） |
| `docs/evidence/`             | phase0 / phase2 / phase3-5 三段证据目录；Phase 6 无目录                                                                                  |
| `docs/version-history.md`    | 最新条目是 v0.3.1go3，**go4 未回填**（发布记录存在但版本历史缺行）                                                                                     |

---

### 2.5 L2 落地设计（Q1 已定 L2，本节是可直接施工的接线图）

#### 2.5.1 五个改动点（全部在 server / 契约层，renderer 零改动）

| # | 位置 | 改什么 | 为什么是这里 |
|---|---|---|---|
| 1 | `realtime.rs:357` / `:359`（两条 session 建立分支） | 在 session 负载里加 `tools`，来源 `chat_tools::definitions()` | 文字侧工具目录同源（`main.rs:2092`、`replies.rs:893`），不新造一套 |
| 2 | `realtime.rs` 事件归一化段（`:412`–`:466`） | 加 `response.function_call_arguments.delta` / `response.output_item.added(function_call)` 两个分支，复用从 `replies.rs:554` 提取的累加器 | 现有 `response.done` 是 `continue`（`:435`），function_call 会被静默丢弃 |
| 3 | `realtime.rs` `response.done` 分支（`:435`） | 解析 `output[]` 里的 `function_call`，作为一条新事件（如 `tool_call`）上抛，而不是当普通文本 | 与 OpenAI Responses 的权威覆盖语义一致，避免分片拼错 |
| 4 | `main.rs` `realtime_updates()`（`:400`–`:520`） | 收到 `tool_call` → 解析当前 turn 的语音用户消息 id（`rt-{session}-{item}`，`:469`）→ 调 `propose_life_action(name, args, conversation, &format!("reply-{mid}"), text, now)`（`:2371`）→ 返回的 blocks 挂到助手消息（形状照 `:3059`） | 这是**唯一**复用文字提案链的正确入口：`reply_id.strip_prefix("reply-")` 得到 mid，正是 `:469` 落库的那条用户消息 |
| 5 | `checks/realtime-wire.mjs` | 在 `realtimeFixture()` 里注入 `function_call` 序列，断言 1→4 全线 | 零凭据可回归，符合 D3 的假模型前提 |

**关键约束**：`propose_life_action` 会先 `store.get("message", mid)` 并要求 `role == "user"`（`:2416`–`:2419`）。因此**提案必须晚于用户消息落库**。语音链路里 `transcript_final` 与 `response.done` 的到达顺序不保证，实现时必须按 `item_id` 做 join/等待，而不是假设顺序。这是 A1a 最容易写错的一处。

#### 2.5.2 一个必须先解决的矛盾：通话模式没有消息锚点

`session.live = (mode == "live" || mode == "read")`（`:882`）。而用户消息只在 `!live` 时落库（`:466`–`:489`）：

| 模式 | 用户消息是否入库 | 能否直接复用 `propose_life_action` |
|---|---|---|
| 语音输入 / 语音对话（`live=false`，默认） | **是**，id = `rt-{session}-{item}` | **可以**，锚点天然存在 |
| 通话 / 朗读（`live=true`） | **否**，转写只以事件流给渲染层 | **不行**，`store.get("message", mid)` 必然失败 |

这意味着 **L2 必须分两步落地**：

- **A1a（无冲突，先做）**：非通话语音路径。用户消息已落库，只需接 function_call → 提案，零持久化变更、零 Live 边界争议。
- **A1b（需你决策，见 Q8）**：通话中发起动作。要先决定「通话里的动作提案以什么为依据」——而这一决定会直接撞上 A5 的 Live 边界（「只保存时长摘要，不新增逐句转写落盘」）。三个候选：
  - **O1** 只为「触发动作的那一句」落一条消息（理解为「提案证据」，非「逐句转写」）；
  - **O2** 通话中不落提案，只在通话期间显示卡片（重载后消失——与「重载后可辨认」相冲突）；
  - **O3** 通话中不接受新建动作，只接受指代（等于通话内退回 L1）。

我不替你选。**在 Q8 有答案前，A1b 不动工**；A1a 不受影响，可以立即做。

#### 2.5.3 零 renderer 改动的证据链

1. `main.rs:3059` 构造助手消息时，`blocks` 是普通字段，随后 `:3061`–`:3063` 用 `reply-block` 契约逐块校验——**文字路径已证明这个形状可行**。
2. `Chat.jsx:174`：`m.role === 'assistant' && m.blocks?.length > 0` → `<MessageBlocks blocks={m.blocks}/>`，**按数据通用渲染，不认来源**。
3. `Chat.jsx:30`–`44`：`MessageBlocks` 按 `block.kind === 'approval'` 分流到 `IntelligentSurface compact`，**复用既有审批状态机**。
4. 结论：语音只要产出「同一 conversation + 同一形状的 user 消息 + 带 blocks 的 assistant 消息」，界面自动成立。铁律不被触碰。

> **修正（20:45）**：`contracts/v1/assistant-message.schema.json` 的 `properties` 里**本来就有 `blocks`**，`additionalProperties: false` 与它并不冲突——v3 里"字段表没有 blocks"是我按截断列表得出的误判，已实测更正。真正的约束在别处：`submitted_at` 是 **string**（我第一版传了 u64，导致 `validate` 失败、整条消息不落库）。这条踩坑记在这里，避免复现。

#### 2.5.4 A1a 的验收断言（会写进 `checks/realtime-wire.mjs`）

1. 语音 turn 说出提醒句 → fixture 回 `function_call` → 落库的助手消息 `blocks[0].kind == 'approval'`，且 `payload` 含正确 `due_at` 与时区；
2. 同一句话走文字路径 → 两条审计条目的动作类型、参数、`expected_version` **逐字段一致**（除来源标记）；
3. 点允许（走既有 IPC）→ 提醒入库、`applied` 回执、审计留痕，与文字路径一致；
4. 打断：`speech_started` 在提案生成前到达 → 不产生任何 block、不产生提案、`cancelled` 标记正确；
5. 提案晚于用户消息的乱序场景（先 `response.done` 后 `transcript_final`）→ 要么等待后成功，要么诚实失败，**不允许产生无锚点孤儿卡片**；
6. 幂等：同一句话语音一次 + 文字一次 → 只一条提醒（A4 的键必须含来源维度）。

---


## 3. 需完成事项的分项拆解

分类口径沿用 roadmap：**开发补齐**（代码不存在或能力缺失）/ **集成修复**（代码在、接线断或行为错）/ **验收补证**（实现可信、缺证据）。

规模：S ≈ 单点改动 + 1 条断言；M ≈ 跨 2–3 个模块的接线与断言；L ≈ 需要设计新链路并有失败路径断言。

### Wave 0 — 进入 T16 前的收口（5 项）

| ID   | 事项                | 分类          | 规模  | 现状                                | 完成判据                                                                                                                                                                           |
| ---- | ----------------- | ----------- | --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P5.5 | soul 注入回归入册 | 开发补齐 | **S（已完成）** | `checks/soul-inject-probe.mjs` 改为**真断言**（原先只打印 FOUND/MISSING，永远不会失败）；注册 `npm run check:soul`；`checks/realtime-tools.mjs` 增两条语音侧断言 | ✅ 已实施并跑通 |
| P5.2 | BUG-6 诚实终态 | 开发补齐 | **S（已完成）** | 取消的回合现在会落一条固定文案「回复已取消（可以重新发送）。」，用既有消息气泡承载（零新 UI）。**刻意不写半截模型文本**——半截输出不是回答，写进去会被误读。`reply-wire.mjs` 的三处「取消后不得持久化」断言按新语义更新为「只允许这条公告」，其中仍断言不含部分文本 | ✅ 已实施并跑通（PASS 15） |
| P5.3 | 渲染层 GUI 检查固化 | 开发补齐 | **M（已完成）** | 新 `checks/chat-gui.mjs` + `npm run check:chat:gui`：进程内 SSE fixture（随机端口）→ 全新 `WITHU_DEV_DATA` → Electron（带 GPU 兜底参数）→ **经 `window.withuDesktop.configUpdate` 写配置**（与设置页同一 IPC，方案 C）→ 发消息断言。5 条：profile 确实全新 / 配置回读一致 / 不白屏且请求带灵魂正文 / 卡片本地化并点后转终态 / 候选胶囊出现 | ✅ PASS 5 |
| P5.1 | 重打包 + ENV-4 补录    | 集成修复 + 验收补证 | M   | 包为修复前、无 zip                       | `npm run package:windows`（已定 `v0.3.1go5`，见 D2）；冻结树上 `check:packaged` 六场景 + `check:product`；把 zip/exe/server 三哈希写入 `docs/releases/`；**同时补 `version-history.md` 的 go4/go5 行** |
| P5.4 | 真实 provider / 连接器 | 验收补证（用户）    | —   | 凭据未配                              | 不阻塞 T16，阻塞 T17-C；需 Q3 确认就绪时间                                                                                                                                                   |

> **顺序修正**：P5.1 必须排在 P5.2 / P5.3 / P5.5 **之后**。原计划把打包放第一位，会产出立刻作废的包，并让 ENV-4 补录的哈希再次失效。

### Wave 1 — T16-A 文字/语音同权（7 项，Phase 6 重心；A1 已按 §2.5 拆为 A1a/A1b）

| ID | 事项               | 分类          | 规模    | 说明与断言                                                                                                                                                                         |
| -- | ---------------- | ----------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1a | **非通话语音提案链路** | 开发补齐 | **M（已完成）** | 按 §2.5.1 的五个改动点落地（下发 tools → 累加 function_call → `response.done` 解析 → `propose_life_action` → fixture 断言）。这是 L2 的主体，**零 renderer 改动**。验收断言见 §2.5.4 六条 |
| A1b | 通话中提案的锚点策略 | 开发补齐 | **M（已完成）** | 按 O1 实现：`tool_call` 事件携带本回合转写文本；`main.rs` 仅在 `live` 且锚点缺失时，把**触发动作的那一句**落为消息（`realtime.action_evidence`），其余通话内容零落库。检查断言：普通通话句不落库、动作句落一条、卡片照常生成 | ✅ 已并入 `check:realtime:tools`（7 条全绿） |
| A2 | 打断后提案必须丢弃 | 集成修复 | S–M | barge-in 本身已实现（`:392`/`:448` 主动发 `response.cancel`），缺的是「被取消回合若已攒出 function_call，不得转成提案」。断言：说话打断后旧回合 `cancelled`、无 `applied` 回执、无孤儿 `reply-block`。若供应商在 `turn_detection` 上支持显式 `interrupt_response`，顺带显式声明以摆脱「隐式继承」 |
| A3 | 取消与清理幂等          | 集成修复        | M     | 通话结束/切换会话时音频会话、监听、临时文件清理可重复调用不报错；**与 P5.2 合并实现**（同一状态机的两个出口，分两次改会打架）                                                                                                          |
| A4 | 双入口幂等（不重复副作用）    | 开发补齐        | M     | 同一句话语音说过再打字，只产生一条提醒；幂等键必须覆盖来源维度，而非仅内容哈希                                                                                                                                       |
| A5 | Live 边界回归 | 验收补证 | S | 断言只存时长摘要，无原始音频、无逐句转写落盘（`checks/realtime-output-safety.mjs` 已有基础，扩一条）。**与 A1b 强耦合**：若 Q8 选 O1（为动作落一句转写），本项断言必须改成「只允许动作证据句，其余零转写」，并在参考对照栏写明理由 |
| A6 | 参考对照栏            | 验收补证        | S     | OpenAI Realtime barge-in/turn-taking 采用什么、xAI 流式不采用什么、理由；按 B.6/B.7 逐条填                                                                                                        |

### Wave 2 — T16-B MCP App（6 项）

| ID | 事项            | 分类   | 规模 | 说明与断言                                                                           |
| -- | ------------- | ---- | -- | ------------------------------------------------------------------------------- |
| B1 | 真实对话触发全生命周期 | 开发补齐（**非验收**） | **L** | **服务端零 MCP 代码**（`jsonrpc/tools/list/resources/read` 命中 0）；App 只从 `BrowserDrawer.jsx:266` 与 `LifeToolsPanel.jsx:61` 挂载，资源来自构建期 `virtual:withu-mcp-app-resource`。要做 B1 必须先写 server 端 MCP 客户端。**待决策（Q11）** | ⛔ 未开工 |
| B2 | App 内动作同走 R07 | 验收补证 | S | fixture 层已覆盖：`protocol.test.mjs` 的 typed-intent 白名单 + fail-closed；`host.test.mjs` 的「preview → 等 host Allow → decide → execute」。真实链路随 B1 | ✅ fixture 通过 |
| B3 | 隔离负路径 | 验收补证 | S | 已覆盖：错误 origin / 过期 session / 超限 / 关闭后流量全部拒绝；nonce CSP、无网络/导航/popup/设备权限 | ✅ fixture 通过 |
| B4 | 生命周期资源释放 | 验收补证 | S | `protocol.test.mjs`「runs App resource teardown over the standard SDK protocol」；宿主卸载即撤销会话 | ✅ fixture 通过 |
| B5 | 媒体/语音协调 | 验收补证 | M | `media.test.mjs` 两条：语音忙碌期间暂停、结束后需显式点击才播放；重叠通话保持占用 | ✅ fixture 通过（真机声学仍待验） |
| B6 | 无 UI 能力降级 | 验收补证 | S | 未单独断言；随 B1 的真实链路一并补 | ⛔ 待 B1 |

### Wave 3 — T16-C 主动性（5 项）

| ID | 事项             | 分类            | 规模  | 说明与断言                                                                |
| -- | -------------- | ------------- | --- | -------------------------------------------------------------------- |
| C1 | Windows 通知中心真机 | 验收补证 | M | 需真机点击验证弹窗与回跳 | 🕓 待配合 |
| C2 | 门控实证 | 验收补证 | S–M | 代码已有 quiet hours / pause / `evaluate` 不追发 | 🕓 真机待验 |
| C3 | 系统权限关闭降级 | 开发补齐 | **S（已完成）** | `proactivity-notifications.cjs` 增 `Notification.permission === 'denied' → suppressed_permission`，**不构造系统通知**（避免把「用户关了通知」谎报成 `shown_by_os`）；`check:proactivity:notify` 已加断言 | ✅ 通过 |
| C4 | 退出后零主动 | 验收补证 | S | 代码已有 `suppressed_app_stopped`；断言已存在 | 🕓 真机待验 |
| C5 | 通话中通知协调 | 开发补齐 | M | 依赖通话状态可知（A1 已提供），未做 | ⛔ 未开工 |


### Wave 4 — T17 交付（4 组）

| ID    | 事项      | 要点                                                                                                                                                                    |
| ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T17-A | 冻结与独立终审 | 逐 T 项核对四层证据；按背书矩阵回查「参考对照」；**在交付材料中声明「历史提交不可考（7a6f5df / 4d5ad38 不存在），现状以 102f3a2 及其后续为准」**；锁定版本三元组                                                                     |
| T17-B | 全量检查与打包 | 四件套 + `check:desktop` + `package:windows` + `check:packaged` 六场景；**「冻结树」定义为「同一提交 + 完整重建」**（dist/target 不入库）                                                           |
| T17-C | 人工验收    | 用户视觉（含消息内审批卡，Phase 3 遗留）+ 真实声学 + 第三方服务 + Windows 通知；修复后重验受影响范围                                                                                                        |
| T17-D | 交付材料    | 版本三元组、提交号、三哈希、源码↔包对应（`check:product`）；**如实列出诚实桩**（T12 连接器、T13 校准、语义索引降级）；更新验收索引/manifest/version-history（补 go4/go5 缺行）/转交报告；旧 `sequential-closeout` 标注「已由 roadmap 取代」 |



---

## 4. 执行顺序与优先级

```
Wave 0（改码优先，打包收尾）
  P5.5 ─ P5.2 ─ P5.3 ──► P5.1（打包 + ENV-4 + version-history）
                          │
Wave 1  T16-A  ── A1a ─► A2 ─► A3(=P5.2 延伸) ─► A4 ─► A5/A6
                   └─ A1b（待 Q8，撞 A5 边界）
                          │
Wave 2  T16-B  ── B1 ─► B2 ─► B3/B4 ─► B5 ─► B6      （可与 A4/A5 并行）
                          │
Wave 3  T16-C  ── C3 ─► C2 ─► C1 ─► C4 ─► C5（C5 依赖 A1 通话状态）
                          │
Wave 4  T17-A ─► T17-B ─► T17-C ─► T17-D
并行轨道：P5.4（真实 provider/连接器）随时可做，只阻塞 T17-C
```

**优先级理由（与原计划的差异）**

1. **P5.1 后置**：打包是「冻结动作」，不是「开工动作」。凡后续还会改源码，提前打包只是制造失效哈希。
2. **A1 提到 T16 首位**：它决定 T16-A 其余五项能否成立，也决定 C5 的设计与 A4 的幂等键维度。A1 的代码路径已确认可复用，真正的不确定项是§6.2 的产品口径（Q1），越早知道越好。
3. **A3 与 P5.2 合并**：两者是同一「在途回合终止」状态机的两个入口，分开做会二次返工。
4. **T16-B 可与 A4/A5 并行**：MCP App 与语音链路没有共享状态机（宿主在 renderer，语音在 server），除 B5 媒体协调外互不阻塞。
5. **T16-C 最后**：C5 依赖通话状态可知性；C1/C2 的真机验收需要你在场，天然靠后且可能形成长尾。

**风险最高、建议先做技术验证的三项**：A1（用 `realtimeFixture()` 注入 `function_call`，验证服务端能否转成提案——半天可出结论，不需要真实凭据）、B5（TTS 与媒体不叠音的实际可测性）、C3（Windows 权限被拒时的降级体验）。这三项若在实现末尾才发现不可行，返工面最大。

---

## 5. 关键风险

| ID | 风险                                    | 影响                                                     | 缓解                                                                                         |
| -- | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| R1 | **语音工具链的既有能力被低估过、也被我高估过** | 前者导致原计划把它当验收项；后者导致 v1 把它当「从零」。两种误判都会让排期失真 | 已改为按实测分层：可复用什么、缺什么、缺的那部分多大（§2.3）。开工前用 fixture 探针复核一次（§7） |
| R2 | **「冻结树」不可由提交复现**                      | T17-B 六场景在「旧包」或「脏树」上跑，证据无效                             | 定义冻结树 = 提交 + 完整重建；记录 `Cargo.lock`/`package-lock.json`（已入库）与构建命令输出；打包时记 `manifest.json` 三哈希 |
| R3 | **无 remote，单副本**                      | 磁盘故障即全部历史丢失；T17-A「锁定源码提交」无冗余                           | 建议加一个远端（内网/GitHub 私有）；至少定期 `bundle` 备份（Q5）                                                 |
| R4 | ~~GUI 冻结 vs MCP App 宿主形态~~（已闭合 D1） | 沿用 iframe，不改结构，冻结红线不受影响 | 已决策；仅需更正原计划 §2.2 括注，B4 的释放对象据此收窄 |
| R5 | **真机门槛全部依赖你本人在场**                     | T17-C 可能无限期挂起，拖住交付                                     | 把四项真机验收集中排一个时间窗（Q3）；缺失时按 roadmap 红线写「工程包可交接，产品验收未完成」                                       |
| R6 | **ENV-4 哈希不一致未销**                     | T17-D 终审哈希对不上，交付材料自相矛盾                                 | 随 P5.1 一次性重打包 + 补录三哈希 + 回填 version-history                                                 |
| R7 | **参考仓库路径在外部盘（`E:\Orbit\withu-refs`）** | 「参考对照」硬门槛无法执行，按未参考处理 → 该阶段不通过                          | 开工前确认可达（Q4）；不可达则需重新获取并记录                                                                   |
| R8 | **`DEMO_NOTICES` 硬编码演示通知仍在**          | 全新安装即显示「资料库导入完成 project-brief.docx」等不存在的数据，属对真实用户的虚假信息 | 计划未覆盖；建议在 T17-D 前决策移除或标注（Q2）                                                               |
| R10 | **GUI 铁律被「顺手小改」蚕食** | 一次「就加个按钮」就破了冻结；事后没人能证明没破 | §1.6 机械门禁：每次提交前 `git diff --stat -- client/` 必须为空，非空即停；`check:renderer`+`check:desktop` 仍须绿；冻结期任何 `client/` 改动都视为需要你批准 |
| R11 | **volc 实时协议的 tools 支持未知** | L2 可能只能在非 volc 后端成立，造成「同一功能因后端而异」的不一致 | 先按非 volc 实现并验证（Q9）；volc 单独探测，不支持的路径如实标注为能力边界，不伪装 |

---

## 6. 决策记录与待确认问题

### 6.1 已闭合（你的答复：19:55 三条 + 20:18 两条）

| ID | 议题 | 你的决定 | 对计划的连带改动 |
|---|---|---|---|
| D1 | MCP App 宿主形态 | 沿用 renderer iframe | 原计划 §2.2 的「Electron WebContentsView」按笔误更正；B4 的资源释放对象收窄为 iframe / 附属端口 / 子进程；不触碰 GUI 冻结 |
| D2 | 打包版本号 | 跳 `v0.3.1go5` | P5.1 直接产出 go5；需全链升版（`VERSION`、6 个 `package.json`、Cargo workspace、窗口标题、关于页），版本三元组为 `v0.3.1go5` / `0.3.1-go.5` / `0.3.1.5`；新建 `docs/releases/v0.3.1go5.md`；`v0.3.1go4.md` 保留为历史但须加一行「zip/exe 哈希已失效，实际交付以 go5 为准」；`version-history.md` 补 go4、go5 两行 |
| D3 | 模型接入现状 | 未接入真实模型，全线假模型（暴露功能问题用） | 见 §1.5 五条后果。核心是：本轮所有「通过」只覆盖接线与失败路径；T17 的预设终点改为「工程包可交接，产品验收未完成」 |
| D4 | **Q1 语音能力档位** | **L2 自主发起** | A1 拆为 A1a（非通话，可立即做）与 A1b（通话，待 Q8）；硬约束：语音只产出提案，**绝不直接执行**，必须经审批卡与 R07 |
| D5 | **GUI 冻结** | **铁律**，`client/withu-renderer/src/**` 结构与交互零改动 | 落地为 §1.6 的机械门禁；BUG-6 只能用占位消息方案（不加重试按钮）；A1 已确认可零 renderer 改动完成 |
| D6 | **Q8 通话锚点** | **O1**：只为触发动作的那一句落一条消息，视为「提案证据」而非逐句转写 | A1b 解禁；需在方向文档补一句解释（Live 边界 = 不留录音/不留完整对话稿，不等于不许为已授权动作留依据）；A5 的断言改成「只允许动作证据句，其余零转写」 |
| D7 | **Q9 后端范围** | **先成立一个即可** | 先做非 volc（OpenAI 形态）路径；volc 分支保持无 tools，交付材料如实标注「该后端语音不支持发起动作」 |

### 6.2 Q1 详解与结论：语音「能发起动作」到底指什么

你说不太理解，我从「现在实际会发生什么」讲起，再给三档，最后给建议。

#### 第一步：先看现状的一个具体场景

**文字入口**，你打「明天下午三点提醒我开会」：

1. 模型返回 `function_call: create_local_reminder`；
2. 服务端 `chat_tools::map` 重校验参数（时区、墙钟格式、过去时间拒绝）；
3. 落一条 `reply-block` → 渲染成审批卡（「创建本地提醒 / 明天 15:00 / 允许一次」）；
4. 你点允许 → `withu-approvals` 放行 → `withu-life` 落库 → 审计留痕。

**语音入口**，你说同一句话：`realtime.rs` 的会话里**没有任何 tools**。模型没有可调用的函数，只能「说」。它大概率会回你一句「好呀，我记住了」。

但它没有记住。没有提案、没有卡片、没有入库、没有审计。**这句话听起来像承诺，实际上什么都没发生。**

这就是问题的性质：不是「语音功能少」，而是**同一个产品在两个入口给了你两种不同的事实陈述**。而方向文档反复强调的原则是「不下诊断、不假装确定、不说已执行」——语音这一档，恰好违反了最后一条。

所以真正的选择不是「要不要加这个功能」，而是**这一轮把语音做到哪一层，或者明确把它写成能力边界**。

#### 第二步：三档的差别

| 档位 | 你说「明天三点提醒我开会」 | 你说「第二个」「就这个」 | 你说「刚才那个改到四点」 | 工作量 | 对照文档 |
|---|---|---|---|---|---|
| **L0 纯对话（现状）** | 口头答应，无事发生（**空承诺**） | 做不了 | 做不了 | 0 | 不满足 roadmap「两种入口」；也不满足 spec 第 552 行的「语音与点击同一 typed action」 |
| **L1 只做界面指代** | 诚实拒绝：「这句得打字，或者你指屏幕上那张卡我来操作」 | **能执行**（引用当前卡片的对象 ID + 版本，走同一审批） | 能执行（同上，带版本 CAS） | S–M | 满足 spec 第 552 行**字面**要求；不满足 roadmap 的「两种入口共用同一动作」 |
| **L2 自主发起** | **产生提案 → 弹审批卡 → 你点允许 → 落库**，与文字同一条链、同一份审计 | 能执行 | 能执行 | M–L | 同时满足 spec 与 roadmap |

三点必须说清楚的补充：

- **L1 不是「白送」**：它同样要下发 tools（至少一个「指代界面对象」的工具）、要有目标解析、要有版本校验，只是不需要 12 个业务工具。它省的是工具目录的接线，不是架构。
- **L1 有个体验陷阱**：它把「听得懂但做不了」变成常态。用户说「提醒我」，得到一句「这个得打字」，会觉得这产品有点笨；如果产品话术没设计好，甚至比 L0 更突兀。
- **L2 的最大不确定性不在我们的代码，而在真模型**：真模型在语音低延迟、被打断、口语化表达下，是否稳定地调用工具，这个**在假模型下永远测不出来**。所以 L2 能让代码和自动化验收在本轮闭合，但「真实可靠性」必须留在 T17-C 里如实标注——这一点我会写进交付材料，不会含糊。

#### 第三步：我的建议

**建议选 L2，理由三条：**

1. **增量成本比看起来小**。我实测过文字侧的三块现成件（工具目录、参数重校验、function_call 分片累加）都可直接复用，realtime 的事件名与 Responses 流式同族。A1 的实质是接线，不是重写语义。
2. **L1 是个尴尬的中间态**。它已经付出了「下发 tools + 目标解析」的成本，却仍然不能创建动作；用户感知上「能指代但不能发起」比「干脆不能」更费解。
3. **roadmap 的 T16 完成条件卡的就是 L2**。只做 L1，T16 仍然标不了完成，最终还得补 L2——不如一次做完。

**但我给它加一条硬约束**：L2 只做到「产出提案」，**绝不语音直接执行**。语音说「提醒我开会」，出来的必须是审批卡，必须你点允许才落库（符合 R07）。我不会做成「说一句就创建」。

#### 你的决定：L2（D4）

已锁定 **(a) L2 自主发起**。由此确定的边界：

- 语音与文字**同权**：同一 `prepare → allow → execute`、同一版本 CAS、同一张结果卡、同一份审计。
- **语音绝不直接执行**：说「提醒我开会」只产出审批卡，必须点「允许一次」才落库（R07）。
- 落地入口是 `propose_life_action`（`main.rs:2371`），不是新写一套动作语义——这条决定了 A1 的性质是接线（§2.5.1）。
- 由于通话模式没有消息锚点，L2 拆成 A1a（现在就能做）与 A1b（等 Q8），见 §2.5.2。

### 6.3 其余待确认（不阻塞 Wave 0）

**Q2｜`DEMO_NOTICES` 演示通知**：全新安装会显示「资料库导入完成 project-brief.docx」「早安问候已生成」等指向不存在数据的通知。保留（标注为演示）/ 移除 / 改为首次运行引导？它是 T17-C 视觉验收里最容易被一眼看穿的地方。

**Q3｜凭据与真机验收窗口**（原 Q5 + Q6 合并，因为 D3 改变了它们的含义）：模型未接入意味着「真实声学验收」目前连对象都没有——没有真实 realtime 凭据，就没有真实麦克风/扬声器链路可验。所以请一并说明：①真实模型 provider 的 Key 是否具备、预计何时；②真实实时语音凭据是否具备；③若都不具备，T17-C 是否接受「四项真机全部标注未验」并照 roadmap 红线交付。

**Q4｜参考仓库可达性**：`E://Orbit//withu-refs`（OpenMuse/Codex/WeKnora/OpenViking/laya/claude-code-best）当前是否可访问？「参考对照」是硬门槛，不可达则该 T 项按未通过计。

**Q5｜远端备份**：是否允许我为这个新仓库配一个 remote 并推送首个提交（含 `v0.3.1go4-postfix` 标签）？现在只有本地单副本，T17-A 的「锁定」没有冗余。

**Q6｜用户参考包的位置与哈希**：ENV-4 要销项，需要知道 `Withu-v0.3.1go4-win32-x64.zip` 现在在哪、完整 SHA-256 是多少（测试报告只记了前 16 位 `A54E9342F0DFCA4F…`）。当前仓库内无 zip。若已丢失，则 ENV-4 直接改为「go5 重新起算」，不再追溯 go4。

**Q7｜BUG-6 的实现语义（已按铁律收窄）**：原方案 (b) 要新增「重试按钮」= 新增交互控件，**违反 GUI 冻结铁律**，故按 (a) 执行：回复被取消时落一条普通助手消息「回复已取消」+ 既有消息气泡承载，零新元素，重载后可见。**这条我按铁律自行定了，除非你明确要求例外**。唯一代价是会话里多一条简短消息，可接受。

**Q8｜通话中（`live=true`）的提案锚点**（阻塞 A1b，不阻塞 A1a）：通话模式下语音转写不入库，`propose_life_action` 因此无锚点。三选一——
- **O1**：只为触发动作的那一句落一条消息，理解为「提案证据」而非「逐句转写」（需在方向文档里补一句解释，否则与 Live 边界字面冲突）；
- **O2**：通话中不落提案，卡片只在通话期间可见（重载后消失，与「重载后可辨认」冲突）；
- **O3**：通话中不接受新建动作，只接受指代（通话内退回 L1）。
> 我的倾向：O1。它最贴近「语音与文字同权」，且 Live 边界的本意是「不留录音、不留完整对话稿」，不是「不许为已授权的动作留下依据」。但这属于对方向文档的解释，需要你点头。

**Q9｜语音后端范围**：`realtime.rs` 有 volc 与非 volc 两条 session 建立路径（`:357` / `:359`）。非 volc 分支的 `session.update` 是 OpenAI 形态，加 `tools` 是标准做法；volc 分支是 `session.create` + `extension.{asr,tts,dialog}`，**没有 tools 位，是否支持 function calling 需查文档或实测**。请确认：L2 是否只需在一个后端上成立（其余后端按「语音不支持发起动作」如实标注），还是必须两个后端都支持？

---

## 7. 下一步（A1a 已解锁，可以开工）

放行顺序（每一步都可独立验收，失败不会污染下一步）：

1. **A1a-0 三个前置确认（半天，纯只读，不改码）**
   - `assistant-message` 校验是否允许额外 `blocks` 字段（§2.5.3 的注意项）；
   - 非 volc 分支的 `session.update` 是否已有能力位冲突；
   - `transcript_final` 与 `response.done` 的实际到达顺序（用 fixture 观测，决定 join 策略）。
2. **A1a-1 fixture 探针**：在 `realtimeFixture()` 注入 `function_call` 序列，先把「当前会被静默丢弃」这个事实固化成一条失败断言，再开始改。**先有红灯，再有绿灯**——否则改完不知道改没改对。
3. **A1a-2 接线**：按 §2.5.1 的五个改动点逐个落地，每落一处跑一次 `cargo test --workspace` + `realtime-wire`。
4. **A1a-3 断言补齐**：§2.5.4 六条全绿，其中「审计逐字段对照文字路径」是 L2 的成败判据。
5. **并行轨道（互不阻塞）**：P5.5 soul 回归入册（S）、P5.2 BUG-6 占位消息方案（S，按 Q7 结论）、C3 通知权限降级（M，纯 server/Electron 主进程，不碰 renderer）。
6. **A1b 暂缓**，等 Q8。**P5.3 的 GUI 检查放在 A1a-3 之后**：它要断言的「卡片终态」正好需要 A1a 产生的真实数据。
7. **P5.1 打包始终最后**，一次把 go5 与 ENV-4、version-history 收干净。

> 铁律提醒：以上第 1–6 步**没有一步需要改 `client/withu-renderer/src/**`**。如果实现过程中我发现必须改，我会停下来先告诉你，不会边改边论证「这不算结构改动」。

---

## 8. 执行记录：A1a 已完成（2026-10-26 20:45）

### 8.1 改了什么（全部 server 侧，renderer 零改动）

| 文件 | 改动 | 目的 |
|---|---|---|
| `apps/withu-server/src/realtime.rs` | `Snapshot` 增 `tools`；非 volc `session.update` 带 `tools` + `tool_choice:"auto"`；事件循环新增 `response.output_item.added(function_call)` 与 `response.function_call_arguments.delta` 累积；`response.done` 解析 `output[]` 里的 `function_call`；新增 `tool_call` 事件；`pending_tool` 保证「先有转写锚点、后出提案」 | 让语音产出的调用与文字同形 |
| `apps/withu-server/src/main.rs` | `realtime:start` 按**与文字同一门控**下发工具目录（comfort + 非 volc）；`realtime_updates()` 增 `tool_call` 分支 → `commit_voice_proposal()` | 复用 `propose_life_action` 同一条链（同一 `reply-block`、同一 CAS、同一审计） |
| `apps/withu-server/src/chat_tools.rs` | 抽出 `PROPOSAL_GUIDANCE` 常量 | 文字与语音共用同一段「仅提案、不宣称已执行」的指令，避免两处措辞漂移 |
| `checks/realtime-tools.mjs`（新增） | 6 条断言 | `npm run check:realtime:tools` |

### 8.2 验证结果

| 检查 | 结果 |
|---|---|
| `npm run check:realtime:tools` | **PASS 6**：cowork 不带工具；comfort 带 13 个工具且 `tool_choice:auto`；转写落库为锚点；语音 function call 生成审批卡；未经允许不执行、允许后提醒入库；打断不产卡无副作用 |
| `node checks/realtime-wire.mjs` | **PASS 9 组**（既有语音行为未回归） |
| `cargo test --workspace` | **全部 ok，0 failed** |
| `node checks/contracts.mjs` | **PASS 98 schemas** |
| `node checks/renderer-mapping.mjs` | **PASS** |
| `cargo fmt --all -- --check` | **干净** |
| `git diff --stat -- client/` | **空**（GUI 铁律守住） |
| `npm run check:desktop` | **环境阻塞**：Electron 启动即 `GPU process isn't usable`（复现 3/3）。用 §8.5 的启动参数可在本机跑起真实界面——已实机验证 |
| **GUI 实机（fixture 假模型 + CDP 驱动）** | **通过**：发送「后天下午三点提醒我开会」→ 回复「好的，我来准备这个本地事务，请确认。」→ 审批卡「创建本地提醒 / due 2026-10-27 15:00 CST / 允许一次」→ 点击后变「已允许」，按钮消失，全程无白屏 |

### 8.3 过程中踩到的两个坑（写下来避免复现）

1. **`submitted_at` 必须是字符串**。我第一版传了 `u64`，`validate("assistant-message", …)` 返回 false，导致整条消息静默不落库——没有任何报错，测试只看到「助理消息等不到」。这类失败必须打日志，否则极难定位。
2. **语音必须继续发 `assistant_final`**。渲染层 `realtime-call.mjs:75` 靠它把回合收敛（`responseFinished=true`）；只发 `tool_call` 会让气泡一直停在「思考中」。正确做法是两个事件都发：`assistant_final` 关回合、`tool_call` 出卡片，且卡片挂到同一条消息 id 上（已落库则合并版本 +1）。

### 8.4 A1b（通话模式）的实施要点（依据 D6=O1）

- `realtime.rs` 需在 `tool_call` 事件里补带**本回合转写文本**（当前只带 `item_id`）；
- `main.rs` 在锚点缺失（`live=true`，用户消息不入库）时，用该文本插入一条**仅此一句**的用户消息（`rt-{session}-{item}`），再走同一条提案链——这就是 O1「只为动作证据落一句」；
- A5 的断言同步改为「恰好一条动作证据句、其余零转写」，并在参考对照栏写明为什么这不算「逐句转写落盘」；
- volc 分支不加 tools（D7），交付材料标注该后端不支持语音发起动作。

### 8.5 GUI 实机启动配方（2026-10-26 21:11 验证可用）

**两步，顺序不能反**——先预热假模型，再启动应用：

```bash
# 1) 假模型（SSE chat-completions fixture，默认端口 48171）
node D:/ccc2/Desktop/ai/withu/gui-test/fixture-provider.mjs

# 2) 应用（dev 数据隔离）
cd D:/ccc2/Desktop/ai/withu/WithU-0.3.1go4
npx electron . --withu-dev-data
```

**本机三个坑（均实测）**：

1. **`npx electron` 会静默失败**：本会话环境带 `ELECTRON_RUN_AS_NODE=1`，electron 以纯 Node 运行，报 `Cannot read properties of undefined (reading 'isPackaged')`。需 `env -u ELECTRON_RUN_AS_NODE`。
2. **GPU 进程必崩**：`exit_code=-1073741819` → `FATAL: GPU process isn't usable`。加 `--no-sandbox --disable-gpu-sandbox --disable-gpu` 后可正常渲染。这是环境限制，不是应用缺陷；`check:desktop` 未带这些参数，所以它仍会失败（不能据此判定产品问题）。
3. **数据目录要选对**：全新 `WITHU_DEV_DATA` 无 provider，界面能开但发消息无回复；用 `output/dev-userData`（既有配置指向 48171）才通。

**带 CDP 的一行命令（便于断言与截图）**：

```bash
cd D:/ccc2/Desktop/ai/withu/WithU-0.3.1go4
env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe . \
  --withu-dev-data --remote-debugging-port=9222 \
  --no-sandbox --disable-gpu-sandbox --disable-gpu
```

配合 `D:/ccc2/Desktop/ai/withu/gui-test/cdp-drive.mjs`（stage：`ping|dom|bodytext|type|click|eval|shot|config|watch`）断言与截图，如 `node cdp-drive.mjs bodytext`、`node cdp-drive.mjs shot 证据名`。

**关于 fixture 的日期（2026-10-27 已修）**：原先 `TODAY` 写死 `2026-10-25`，隔天后「明天/后天」就变成过去时间，被服务端「拒绝过去时间」规则正确拦截，界面表现为**「模型提出的动作参数不完整或无效，本次没有执行」**——看起来像 proposal 链坏了，其实是夹具的历史日期。已改为按 UTC+8 取当天日期，`明天下午三点` 现在稳定解析为次日 15:00。

**这类故障的辨识方法**：出现上面那句提示时，先看假模型给回的 `due_at_local` 是不是早于当前时间（`curl --noproxy '*' -X POST http://127.0.0.1:48171/v1/chat/completions …` 看 SSE 里的 `arguments`），再怪代码。另外本机 curl 走代理，探本地端口必须加 `--noproxy '*'`。

---

## 9. 执行记录：P5.2 / BUG-6 已完成（2026-10-26 22:40）

### 9.1 行为变化

| 场景 | 之前 | 现在 |
|---|---|---|
| 回复在途时刷新/崩溃导致取消 | 用户消息永久悬空，重载后像"模型永不回复" | 落一条助手消息「回复已取消（可以重新发送）。」，重载后可见 |
| 取消前模型已流出部分文本 | 不落库（正确） | 仍不落库；公告是**固定文案**，不拼半截文本（半截输出不是回答） |
| 模型失败（failed） | 不落消息 | **不变**，仍不落消息（原有不变量保留） |

实现位置：`main.rs` 的 `realtime_updates` 同层的回复终态处理块（`matches!(update.state, "failed" | "cancelled")`）内，仅对 `cancelled` 且尚无 assistant-message 的情况生效；`validate("assistant-message")` 通过才写，写失败不影响主流程。

### 9.2 断言更新（有意为之，非绕过）

`checks/reply-wire.mjs` 原有三处断言「取消后不得持久化任何消息」，与新语义冲突。已按新语义改为 `cancelledOnly()`：**恰好一条** assistant 消息、文案完全等于公告、且**不含** `部分`（防止半截文本混入）。这三处分别是：退避期取消、流中取消、配置替换取消。

### 9.3 验证

| 检查 | 结果 |
|---|---|
| `node checks/reply-wire.mjs` | **PASS 15**（含更新后的三处取消断言） |
| `cargo test --workspace` | 31 个 test 结果全 ok，0 failed |
| `node checks/contracts.mjs` | PASS 98 schemas |
| `npm run check:realtime:tools` / `check:soul` | PASS（未受影响） |

### 9.4 顺带修掉的检查脚本环境兼容问题（不是产品改动）

本机请求以 **absolute-form** 发出（`http://127.0.0.1:port/v1/chat/completions`），fixture 用 `req.url === '/v1/chat/completions'` 精确比较必然落空，表现为「请求进来了但代码走了 else 分支」。已修 `reply-wire.mjs`（统一取 `pathname`）与 `chat-tools-wire.mjs`（同上，并在断言里带上实际路径，便于下次直接看出问题）。

**仍然失败的既有检查（与本次改动无关，已用改动前二进制对照复现）**：

- `checks/chat-tools-wire.mjs`：文字工具链在**旧二进制 `output/p3/build-target/debug/withu-server.exe` 上同样失败**（`done.state = failed`），属既有环境/夹具问题，不构成本轮回归。待专项排查（建议先打印 reply.code）。
- `checks/alpha-ui.mjs`、`chat-voice-wire.mjs`、`electron.mjs`、`provider-discovery.mjs`、`voice-turn-wire.mjs`：存在同类 `req.url` 精确比较，尚未逐项处理。

---

## 10. 执行记录：P5.3 与 A1b 已完成（2026-10-27）

### 10.1 P5.3：GUI 检查按方案 C 固化

`checks/chat-gui.mjs`（`npm run check:chat:gui`）的流程：

1. 起一个**进程内** SSE fixture（随机端口，`/v1/chat/completions` + `/v1/models`），按用户话术决定回文本还是回 `tool_calls`；
2. `mkdtemp` 一个**全新** `WITHU_DEV_DATA`，启动 Electron（`--withu-dev-data --remote-debugging-port=<随机> --no-sandbox --disable-gpu-sandbox --disable-gpu`）；
3. 等页面与渲染层桥就绪，**先断言 `config.model_overrides.llm.model_ref` 为空**——这是防假通过的地基；
4. 用 `window.withuDesktop.configUpdate(...)` 写 provider（与设置页保存完全同一条 IPC），再 **read-back 断言**写入成功；
5. 发消息并断言 5 件事。

为什么不用「复制现成 profile」：那份 profile 带着历史消息，断言（卡片数量、候选胶囊）可能被旧数据满足；为什么不用「点设置页」：选择器脆弱且失败时无法区分「产品坏了」和「检查写错了」。C 方案两头都避开，且它验的正好是本检查的职责——对话渲染。

**过程中踩到的两个坑**（都已修）：

- **单次 eval 里 set value + 立刻派发 Enter 不生效**：React 还没提交 input 事件，`send()` 读到空草稿，静默不发。改为「set value → `await 150ms` → 点 `button.send-button`」，并断言按钮存在。
- **首启时 composer 尚未挂载**：直接 `querySelector('textarea')` 拿到 null。改为先 `waitComposer()` 轮询到 textarea 与发送按钮同时存在。

### 10.2 A1b：通话中按 O1 落「动作证据句」

| 场景 | 行为 |
|---|---|
| 通话中普通对话（无动作） | **不落库**（转写只在事件流里，符合 A5 的 Live 边界） |
| 通话中说出会触发动作的句子 | 落**恰好一条**用户消息（`rt-{session}-{item}`，事实类型 `realtime.action_evidence`），审批卡挂在这条消息上 |
| 通话中同一句重复 | 幂等：同一 `item_id` 不重复写 |

实现：`realtime.rs` 在 `tool_call` 事件里带上 `transcript`（本回合最终转写）；`main.rs` 仅当 `live` 且该 id 尚无消息且文本非空时写入，`validate("message")` 通过才落。

### 10.3 本轮全量验证

| 检查 | 结果 |
|---|---|
| `npm run check:chat:gui` | **PASS 5** |
| `npm run check:realtime:tools` | **PASS 7**（含新增的 O1 通话用例） |
| `node checks/realtime-wire.mjs` | PASS 9 组 |
| `node checks/reply-wire.mjs` | PASS 15 |
| `npm run check:soul` | PASS |
| `node checks/contracts.mjs` | PASS 98 schemas |
| `cargo test --workspace` | 31 个结果全 ok，0 failed |
| `cargo fmt --all -- --check` | 干净 |
| `git diff --stat -- client/` | **空**（GUI 铁律） |

---

## 11. 验收手册（怎么自己确认这些东西真的成立）

### 11.1 只看结论：一条命令跑全部

```bash
cd D:/ccc2/Desktop/ai/withu/WithU-0.3.1go4
cargo test --workspace                      # 期望：0 failed
node checks/contracts.mjs                   # 期望：PASS 98 schemas
node checks/reply-wire.mjs                  # 期望：PASS 15
node checks/realtime-wire.mjs               # 期望：PASS 9 groups
npm run check:realtime:tools                # 期望：PASS 7（含通话 O1 用例）
npm run check:soul                          # 期望：全部 FOUND
npm run check:chat:gui                      # 期望：PASS 5（会开一次真实窗口，约 20 秒）
```

> `check:desktop` 在这台机器上仍会因 GPU 崩（`--no-sandbox --disable-gpu-sandbox --disable-gpu` 未带）失败，属环境；`check:chat:gui` 已自带这三个参数。

### 11.2 亲手验 GUI（3 分钟）

1. **预热假模型**（必须先做，否则发消息无回复）：
   ```bash
   node D:/ccc2/Desktop/ai/withu/gui-test/fixture-provider.mjs
   ```
2. **启动应用**（另一个窗口）：
   ```bash
   cd D:/ccc2/Desktop/ai/withu/WithU-0.3.1go4
   npx electron . --withu-dev-data
   ```
   若窗口打不开或白屏，用带兜底参数的版本：
   ```bash
   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe . --withu-dev-data --no-sandbox --disable-gpu-sandbox --disable-gpu
   ```
3. **验卡片**：说「明天下午三点提醒我开会」→ 预期出现「创建本地提醒 / 开会 / due 次日 15:00 CST / 允许一次」→ 点「允许一次」→ 变「已允许」，按钮消失。
4. **验撤销公告（BUG-6）**：发一条长消息后**立刻刷新窗口**（Ctrl+R）→ 重载后该用户消息下方应有「回复已取消（可以重新发送）。」，而不是永远悬空。
5. **验候选胶囊**：说「我偏好安静的工作环境。」→ 预期弹出「要记住这条吗」。

### 11.3 验收时的三种「假故障」（别误判成产品问题）

| 现象 | 真实原因 | 处理 |
|---|---|---|
| 点发送没反应 / 没有回复 | 假模型没在 48171 上跑 | 先执行 11.2 第 1 步 |
| 「模型提出的动作参数不完整或无效」 | 假模型把「明天/后天」算成了过去时间（基准日曾写死） | 已修（改为当天）；仍出现就用 `curl --noproxy '*'` 看它回的 `due_at_local` |
| 窗口打不开 / `GPU process isn't usable` | 本机 GPU 进程被环境拦 | 加 `--no-sandbox --disable-gpu-sandbox --disable-gpu` |

### 11.4 还没法验收的部分（如实）

- **真实模型下的语音动作可靠性**：本轮用 fixture 证明接线，真模型在低延迟/被打断时是否稳定调工具，需真实凭据后补验（T17-C）。
- **volc 实时后端的语音动作**：按 D7 未接入，该后端如实标注「不支持语音发起动作」。
- **Windows 通知中心 / Focus Assist / 真实声学**：仍是 T16-C 的真机项，未开始。

---

## 12. T16-B 核查结论（2026-10-27）：真实对话触发是开发项

**一句话**：T16-B 的第一条（真实对话触发全生命周期）**不是验收项，是开发项**——服务端一行 MCP 代码都没有。

证据：

- `grep -rli "jsonrpc|json-rpc|tools/list|resources/read" apps/withu-server/src/ crates/` → **命中 0**；
- App 只有两个挂载点：`BrowserDrawer.jsx:266`（inline）与 `LifeToolsPanel.jsx:61`（弹窗），资源来自构建期 `virtual:withu-mcp-app-resource`，**与对话、模型、消息流无关**；
- `docs/demo-d7-mcp-app.md` 自己写着："Real conversation-triggered App selection/rendering … are not verified by these fixtures."

**已有的（fixture 层，15 条，`npm run check:mcp-app` 全绿）**：注册/协商/读资源、官方握手、opaque-origin 会话与超限拒绝、nonce CSP 无网络/导航/popup、typed-intent 白名单 fail-closed、宿主 Allow 前不执行、SDK teardown、语音期间暂停媒体、结束后需显式播放。

**缺的只有一件，但很大**：server 端 MCP 客户端（JSON-RPC 传输、`tools/list`、`resources/read`、把 App 资源作为 block 下发、再把 App 动作回灌 R07）。这不是一两个回合的活。

**Q11（需要你定）**：现在就投入 B1（估 3–5 天，且要动 server 的消息/块契约），还是先把 T16-C 与 T17 收口，把 B1 作为下一轮？我的建议是后者——理由是 B1 会让"冻结"推迟，而 T16-C 剩下的都是你配合就能闭合的真机项。

## 13. T16-C 现状与 Windows 的诚实限制

| 项 | 状态 |
|---|---|
| C3 权限降级 | **已完成**：`Notification.permission === 'denied'` → `suppressed_permission`，**不构造系统通知**；断言已加 |
| C4 退出后零主动 | 代码已有 `suppressed_app_stopped` + 断言；真机待验 |
| C2 门控（安静时段/暂停/不追发） | 代码已有；真机待验 |
| C1 通知中心弹窗与回跳 | 需真机 |
| C5 通话中静音/延后 | 未做（依赖通话状态，A1 已提供该状态） |

**必须说清的 Windows 限制**：Windows 没有"系统通知是否被关闭"的查询 API，`Notification.permission` 在 Windows 上基本恒为 `granted`。所以：

- C3 的实际价值是**不谎报**——不再把"根本没弹出来"记成 `shown_by_os`；检测不到时走既有 `unconfirmed`（`show` 事件 5 秒不确认）。
- 真正的降级体验靠**应用内胶囊**（它不依赖系统通知），这一点现状已具备。
- 谁要说"能检测 Windows 通知被关"，那是做不到的，别写进交付材料。

## 14. T16-C 真机验收：我需要你做什么

按顺序做，每步只需回我一句话（"弹了/没弹"或截图）：

| # | 你的操作 | 我在看什么 |
|---|---|---|
| 1 | 建一个 2 分钟后的提醒，**窗口最小化**，等它到点 | 系统通知是否弹出；点通知是否回到该会话/卡片 |
| 2 | 同一提醒再来一次，但**先退出应用** | 应当**完全不弹**（`suppressed_app_stopped`） |
| 3 | 设置里把安静时段设成"现在"，再建一个 1 分钟后的提醒 | 应当不弹，应用内胶囊仍在 |
| 4 | 打开 Windows「专注助手/勿扰」，重复第 1 步 | 记录实际行为（这是系统层，我们只能记录不能控制） |
| 5 | Windows 设置里关掉 Withu 的通知权限，重复第 1 步 | 应当不弹且**不谎报成功**；应用内胶囊仍可用 |

## 15. T16-B 的验收边界（现在能验什么）

- **能验**：`npm run check:mcp-app`（15 条）——App 的协商、隔离、授权、teardown、媒体协调在 fixture 层是正确的。
- **手动看一眼**：启动应用后，浏览器抽屉里的「本地 MCP App」与生活工具面板里的「本地 MCP App」弹窗，都是同一个 App 的两处挂载。
- **不能验**：对话里"说一句话把 App 调出来"。这个路径目前**不存在**，不是坏了。

### 13.1 实测：为什么「到点什么都不弹」

用无界面脚本（`output/p4/proactivity-probe.mjs`，临时数据目录）跑完整链路，输出：

```
default policy.enabled = false
reminder#1 receipt = applied
tick#1 candidates = 1
offer#1 while default -> {"decision":"suppressed","reason":"disabled"}   ← 就是这里
policy enabled, version -> 2
reminder#2 receipt = applied
tick#2 candidates = 1
offer#2 after enable -> {"decision":"eligible", ...}
feed entries = 1 [{"status":"pending"}]
```

**结论**：`withu-proactivity` 的策略默认 `enabled: false`（`apps/withu-server/src/proactivity.rs:68`）。到点的提醒确实被 `life.tick` 扫出来变成候选，但投递时被策略以 `reason:"disabled"` 抑制——所以系统通知不弹、应用内胶囊也不出。**链路没坏，是开关默认关着。**

`life.tick` 每次仍会把该提醒写入 `due_terminal`，因此**先关后开的用户不会补收到过去的提醒**（符合"不追发"，但容易被误读成"功能坏了"）。

### 13.2 两个仍需处理的问题

1. **诚实性缺口**：审批卡写「已允许执行」，而主动性关着时永远不会有提醒。用户无从得知。要修就得在卡片或提醒列表上加一句说明——**属于 GUI 文案改动，需要你批准**；或者把默认值改成 `enabled: true`（产品决策，涉及"未经授权就主动打扰"）。
2. **点击通知不跳转**：`showProactivityNotification` 没有 `click` 处理，即使弹出来，点它只会在任务栏激活窗口，不会回到对应会话/卡片。C1 的第二半尚未实现，且回跳需要渲染层配合（冻结范围）。

### 13.3 按 Q12 修复（2026-10-27 16:45）

用户实测补充：关掉「主动提醒」和「静默时段」后提醒会弹，但**点击通知不回 Withu**；并要求「保持默认关，但在卡片上明说」（选 b）。

| 问题 | 修法 | 验证 |
|---|---|---|
| 点击通知不回到应用 | `showProactivityNotification` 增 `onClick`，在 `notification.once('click')` 里回调；`main.cjs` 传入 `show()/restore()/focus()`。**不碰渲染层** | `check:proactivity:notify` 新增「click 触发 focus」断言 |
| 主动性关闭时卡片仍像会响 | 生成审批卡时读 `ProactivityState.policy.enabled`，仅对 `reminder_create` 追加一句「注意：主动提醒当前已关闭，到点不会弹出系统通知。」 | `check:realtime:tools` 新增 body 含该句的断言 |

**仍未做**：点击通知只把窗口带回前台，**不会跳到对应会话/卡片**（深链需要渲染层配合）。按用户 16:40 的说明（冻结的本意是别改坏 GUI，该有的功能必须有），深链属于"该有"，但需要一次明确的渲染层改动，需单独确认后再做。

### 13.4 回归修复：C3 的硬拦截导致「到点弹都不弹」（2026-10-27 17:05）

**我的错**：13.3 里为 C3 加的 `if (Notification.permission === 'denied') return 'suppressed_permission';` 是**硬拦截**。Windows/Electron 上 `permission` 不可信（本机 dev 启动方式下报 `denied`），结果所有通知在构造之前就被吞掉——用户侧表现正是「到点弹都不弹」。

**证据**：用用户真实策略的只读副本跑服务端，`candidate_offer` 两次都返回 `eligible`；说明候选与策略都正常，问题只在投递。

**修法**：不再按 `permission` 拦截；一律尝试 `new Notification(...)`，只有在系统明确 `failed` 或 5 秒未确认**且** `permission === 'denied'` 时，才把状态记为 `suppressed_permission`（服务端白名单已放行该状态）。这样既不会静默吞掉，也不会谎报 `shown_by_os`。

**教训**：把「读到的权限标志」当成「事实」是错的。权限 API 在桌面端不可靠，只能作为**归因**，不能作为**闸门**。

---

## 16. T16-C / T17 收口状态（2026-10-27 17:15）

### 16.1 冻结基线

- 提交：`418a3c0`（前一个 `102f3a2`）。今日全部改动已入库，工作区干净。
- 新增的检查入口：`check:chat:gui`（PASS 5）、`check:realtime:tools`（PASS 7）、`check:soul`、`check:mcp-app`（PASS 15）、`check:proactivity:notify`。

### 16.2 T16-C 状态（诚实版）

| 项 | 状态 | 证据 |
|---|---|---|
| C1 通知中心弹出 | **用户实测通过** | 用户 16:35 与 17:00 两次实测收到通知；feed 记 `shown_by_os` |
| C1 点击回到 Withu | **已实现，待用户复验** | `notification.once('click')` → `show/restore/focus`；单测断言 click 触发 |
| C2 门控（安静时段/暂停） | 代码已有，**未真机逐项验** | `withu-proactivity` + `evaluate`；本次只验了「关掉静默时段后能弹」 |
| C3 权限降级 | **已修正**：权限只作归因，不作闸门 | 上一版硬拦截导致全部通知被吞，已回退并加断言 |
| C4 退出后零主动 | 代码已有 `suppressed_app_stopped`，**未真机验** | 需退应用后等到点 |
| C5 通话中不打扰 | **未实现** | 依赖通话状态，未排期 |

### 16.3 T17 待办（按依赖顺序）

1. **T17-A 冻结**：以 `418a3c0` 为冻结候选；仍需把「参考对照」栏逐项补齐（roadmap 硬门槛）。
2. **T17-B 打包**：`VERSION` → `v0.3.1go5`，全链升版（6 个 `package.json`、Cargo workspace、`withuVersion` 常量、关于页），`npm run package:windows`，冻结树跑 `check:packaged` 六场景 + `check:product`，补 zip/exe/server 三哈希，新建 `releases/v0.3.1go5.md`，回填 `version-history.md`。
3. **T17-C 人工验收**：用户视觉（含审批卡）、真实声学、第三方服务、通知中心——其中「通知中心」已在 C1 中验过，可复用证据。
4. **T17-D 交付材料**：版本三元组、提交号、三哈希、源码↔包对应、演示步骤、**诚实边界清单**（真实模型未接入、volc 不支持语音动作、MCP App 无对话触发、C5 未做）。

### 16.4 为什么现在还不能说"T17 完成"

- 包还没打（当前 `output/p1/windows` 是 10-25 的旧包）；
- 六场景回归必须在**新包**上跑，旧结果不顶替；
- 参考对照栏还有空项，roadmap 规定无证据按未参考处理。

---

## 17. 剩余工作清单（2026-10-27 17:25，打包前）

### 17.1 已闭合（有证据）

| 项 | 证据 |
|---|---|
| A1a 非通话语音提案 | `check:realtime:tools` 7 条 |
| A1b 通话 O1 证据句 | 同上（第 7 条） |
| A2 打断不产卡 | 同上（第 6 条） |
| A5 Live 边界 | `node checks/realtime-output-safety.mjs` → PASS 25 |
| P5.2 BUG-6 | `reply-wire` 15 条（含三处取消断言） |
| P5.3 GUI 检查 | `check:chat:gui` 5 条 |
| P5.5 soul 回归入册 | `check:soul` |
| C1 通知弹出 | 用户 16:35 / 17:00 两次真机；feed 记 `shown_by_os` |
| C1 点击回窗口 | `check:proactivity:notify` 断言 + 待用户真机确认 |
| C3 权限降级 | 同上（改为「先尝试、失败才标注」） |
| B2/B3/B4/B5（fixture 层） | `check:mcp-app` 15 条 |
| 图标快捷方式 | 写入移入 `app.whenReady()`；待用户重启确认 |

### 17.2 我可以独立做完（不阻塞你）

| 项 | 规模 | 说明 |
|---|---|---|
| **A4 双入口幂等** | M | 现在只有 life 层的 `idempotency_key`，**没有跨入口去重**：同一句话语音说过再打字，会产生两条提醒。需要按「动作语义 + 时间窗」建幂等键 |
| **A6 参考对照栏** | S | B.6/B.7/B.19/B.21 逐条填「采用/不采用 + 理由」；roadmap 硬门槛，空着按未通过 |
| **C5 通话中不打扰** | M | 通话期间通知静默或延后；依赖 A1 已提供的通话状态 |
| **B6 无 UI 能力降级** | S | 无能力时给文字/原生卡片，不伪报兼容（随 B1 或独立） |
| **check:chat:gui 杀进程范围** | S | 现在 `taskkill /F /IM electron.exe` 会误杀用户窗口，应只杀自己 spawn 的 PID |
| **5 个检查的 absolute-form 兼容** | S | `alpha-ui` / `chat-voice-wire` / `electron` / `provider-discovery` / `voice-turn-wire` |
| **chat-tools-wire 失败根因** | S–M | 旧二进制同样失败，属既有问题；需先打印 `reply.code` |

### 17.3 需要你（真机 / 决策 / 凭据）

| 项 | 需要你做什么 |
|---|---|
| C1 点击回窗口 | 重启后点一次通知，确认窗口被带回前台 |
| C2 安静时段 / 暂停 | 设置里设「现在」为安静时段，验证不弹但胶囊在；再验证「暂停」 |
| C4 退出后零主动 | 建 1 分钟提醒，**退出应用**，等到点确认完全不弹 |
| 图标 | 完全退出后重启，确认任务栏图标恢复 |
| 真实模型 / 连接器凭据 | T17-C 的「真实服务」验收前置；没有就只能写进诚实边界 |
| 参考仓库可达性 | `E:/Orbit/withu-refs` 是否还在（A6 要用） |

### 17.4 大项 / 阻塞

| 项 | 规模 | 归属 |
|---|---|---|
| **B1 server 端 MCP 客户端** | **L（3–5 天）** | 阻塞 T16-B 的"真实对话触发"；也是 B6 的前提 |
| T17-B 打包 + 六场景 | M | **等全部完成后再做**（按本轮决定） |
| T17-C 人工验收 | M | 依赖 17.3 的真机项 |
| T17-D 交付材料 | M | 依赖打包产出的三哈希 |

### 17.5 "全部完成"到底指什么（需要你确认边界）

- 若"全部"= T16-C + T17（不含 B1）：现在只剩 17.2 的七项 + 17.3 的真机确认，**打包可在 1 个工作日内**。
- 若"全部"= 含 B1：打包要往后推 3–5 天，且 B1 会改 server 的消息/块契约，T17-B 的六场景要重跑。

---

## 18. B1 开工（2026-10-27 17:30，go5 含 B1）

### 18.1 M1 已完成：宿主能说 MCP

提交 `cc9d421`。`client/withu-mcp-client/index.mjs` 手写 stdio JSON-RPC 客户端（不用 SDK 传输层，因为宿主需要自己控制超时/上限/子进程回收），`npm run check:mcp:client` **PASS 10**：

- initialize 协商协议与能力；`tools/list` 返回模型可用的 schema；
- `resources/list` + `resources/read` 拿到 App 文档；
- `tools/call` 参数与结果往返；
- 未知工具、未知资源各自报 `mcp_error`（**不返回空内容糊弄**）；
- 静默 server 超时（`mcp_timeout`）、缺失二进制（`mcp_server_unavailable`）；
- `close()` 关子进程并拒绝后续请求。

### 18.2 还差三个里程碑（这才是 3–5 天的主体）

| 里程碑 | 内容 | 关键难点 |
|---|---|---|
| **M2 模型侧接线** | 让模型的工具目录包含 MCP 工具；模型提案 → 宿主执行 → 结果回到消息 | 模型在 Rust server，MCP 客户端在 Electron main；需要一条「server 问 main 要工具清单 / main 代执行」的 IPC 契约，且**执行必须过 R07**（App 内动作不能自授权） |
| **M3 App 资源进消息** | 把 `resources/read` 拿到的文档交给 `McpAppHost`，在消息内渲染 | 现在 `McpAppHost` 只认构建期的 `virtual:withu-mcp-app-resource`；要接受运行时资源 = 一次明确的渲染层改动（你已同意"该有的功能必须有"） |
| **M4 生命周期收口** | 会话切换/窗口隐藏/退出时释放 App 视图、端口、子进程；媒体协调沿用现有 coordinator | 复用 B4/B5 已验的机制，但要接到动态 App 上 |

### 18.3 打包顺延

既然 go5 含 B1，`VERSION → v0.3.1go5` 与打包要等 M2–M4 完成后再做；否则打完还要重打。当前冻结候选是 `418a3c0`，B1 会把它推后。
