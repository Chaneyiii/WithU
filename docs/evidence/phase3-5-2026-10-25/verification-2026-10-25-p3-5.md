# Phase 3–5（T09–T15）执行证据

日期：2026-10-25
分支：`codex/demo-phase-0-1`（本地提交，未推送）
执行方式：主协调者串行主线 T09→T10→T11→T12→T14，子 agent 中途多次因
"model concurrency limit exceeded" 失败，自 T13 第二次失败后转全串行，
T13/T15 遗产由主协调者核查、修复、补齐后提交。

## 提交链

| 提交 | 内容 |
|---|---|
| `d2e51f8` | 前置：`--withu-dev-data` 开关（断点续跑核实后提交）；用户库已先备份到 `E:\Orbit\withu-db-backups\`（原始拷贝 + Python sqlite 在线一致性备份，integrity: ok） |
| `79f0958` | T09/T10/T11：自然语言→结构化工具提案→审批卡→生活事务链路（详见下文） |
| `9e61a0f` | T13：Laya 式结构化情绪判断层（fixture 回放） |
| `9edc921` | T15：可替换、经授权的派生语义索引（SQLite 仍为唯一权威） |
| `6d03f5f` | T12 桩：诚实未配置的 web 检索工具 |
| `ee02beb` | T14：显式陈述记忆候选 + 用户门控保存闭环 |

## 基线（动手前）

- `cargo test --workspace`：通过（exit 0）
- `npm.cmd run check`：PASS 98 schemas
- `npm.cmd run build:contracts`：通过

## T09 模型结构化工具调用 → 真实动作（含 T10/T11）

**分类**：开发补齐（`replies.rs` 原头部注释明确 "No tools"，模型侧 tool_calls 一律 `tools_not_supported` 拒绝；`actions.rs` 的 D4 链从未被模型驱动过）。

### 源码实现层

- `apps/withu-server/src/chat_tools.rs`（新增）：12 个本地生活工具目录（创建/编辑/删除提醒、日程、草稿 + 本地检索、内容整理、web 桩）。参数校验全部服务端重做：允许/必填字段双列表、文本长度上限、IANA 时区（chrono-tz，DST 歧义拒绝）、墙钟时间格式（拒绝带偏移的 timestamp）、过去时间拒绝；编辑类工具 find_text 必须唯一匹配，id/expected_version 永远从存储解析、绝不接受模型提供（有专门测试断言注入 expected_version 直接失败）。
- `replies.rs`：三种协议（chat-completions tool_calls 增量 / anthropic tool_use + input_json_delta / responses function_call + completed 权威参数）的流式工具提案归集 `ToolAccum`；单提案约束（index≠0、第二个 id/name 拒绝）；参数敏感钥泄漏守卫（复用 append_text 的 key 检查，`sensitive_provider_output`）；finish_reason `tool_calls`/`tool_use` 终态；bedrock 维持无工具。
- `main.rs`：comfort 会话才下发工具 + "proposals only" 系统指令（缺参数时先澄清、不许说已执行、草稿永不发送）；提案 → `chat_tools::map` 校验 → life prepare → 审批块（reply-block 契约）持久化到助手消息 `blocks`；新提案取代旧提案（cancel 旧 operation + 旧卡 decision=expired + CAS 更新消息）；life decide/execute/cancel 后把真实决定镜像回持久化块；校验失败的提案 → `failed/tool_arguments_invalid` 且**不落库**（守住"failed 回复永不持久化"不变量）。
- `withu-ipc/validation.rs`：注册 `reply-block` schema。**根因修复**：此前该 schema 未注册，`validate("reply-block",…)` 对任何输入恒 false（通过 dump 失败 block + JS 侧 contract.js 验证通过定位到）。
- 只读工具（检索/整理/web）：直接执行（与生活表单同级、无需审批），结果作为数据进入**恰好一轮**无工具 follow-up 回合（循环有界，E2E 断言 follow-up 请求无 tools 字段）。

### T10（D6 卡片接线）

- `IntelligentSurface` 加 compact 模式（去演示页眉）；助手消息 `blocks` 在 Chat.jsx 用既有 D6 状态机渲染（loading→ready→pending_approval→applied/failed/expired/closed）；`createChatActionHandler`（life-actions.js）复用 decide(allow)→execute 链 + 本地防重复标志；已决策的块渲染为诚实静态状态（已允许/已拒绝/已失效），不伪造成功。GUI 结构零改动（复用既有组件与通道，符合冻结基线）。
- 契约：`assistant-message` 增可选 `blocks` 数组；`reply.updated`、`reply.action.expired` 入事件枚举（此前 reply 事件未注册）。

### T11（生活事务全接入）

- 提醒/日程/草稿的创建+编辑+删除全部经工具提案（编辑解析存储条目；零匹配返回诚实文本提示块"没有找到…请告诉我想操作哪一条"，无 action_ref、无副作用）；检索/整理走只读二段回合。

### 自动化验证层（fixture）

`node checks/chat-tools-wire.mjs`（本地 SSE 假 provider + 真实 server 二进制）——**PASS 12 组**：

1. 纯文本回归（无工具请求）
2. Cowork 不下发工具；comfort 下发 12 个 + proposal-only 指令
3. 提案→审批卡→显式 allow→执行→提醒落库；时区换算正确（2026-10-26 15:00 Asia/Taipei = unix 1792998000）；未决定先执行被拒（`life_explicit_decision_required`）零副作用；重复 execute 回放同一回执
4. 授权结果重启后可恢复
5. 取消零副作用、块镜像 deny
6. 修改取代旧卡（expired + `life_pending_missing`），新卡 pending
7. 自然语言编辑：find_text 解析存储条目、仍需审批、编辑生效
8. 零匹配编辑 → 诚实文本提示、无 action_ref、零数据变化
9. 本地检索：免审批 + 有界 follow-up、结果只作为数据
10. 内容整理同循环
10.5 web 桩：显式 unconfigured + 空 sources、零伪造 URI
11. 无效提案（偏移时间/未知时区/未知工具）→ `tool_arguments_invalid` 诚实失败、不落库

其他：`cargo test -p withu-server` 42 通过（chat_tools 参数/时区/日历数学、ToolAccum 三协议、Output 语义）；`node checks/reply-wire.mjs` 未跑（见遗留）；渲染层 `vite build` 通过。

### 真实服务验证层

**未执行（待用户凭据）**：需要已配置 provider + API key 的真模型端到端（真实模型决定调用工具、参数澄清质量、真实 provider 的 tool-use 流）。fixture 证明接线与全部失败路径，不证明真实模型行为质量。

### 真机与人工验收层

未执行。GUI 改动仅复用既有 IntelligentSurface 组件于消息流内，无结构变化；如需视觉验收请用户确认消息内审批卡的呈现。

### 参考对照（硬性门槛）

- **spec 附录 B.1/B.4/B.8/B.10/B.11**（已读原文）：采用——模型输出仅创建候选（B.8），结构化拒答可检测（B.1 的 refusal 语义沿用 refusal 错误码），429 指数退避不缩短 Retry-After（B.10，沿用既有实现），Manual 逐动作 Allow（B.11/R07）。不采用——B.4 的云端后台任务模型（Withu 本地生命周期，§4.4）。
- **OpenMuse**（`E:\Orbit\withu-refs\openmuse`，已克隆并读 apps/server 任务/审批目录结构与 Rich Threads 卡片组织）：采用——提案停在审批、动作有 receipt、任务可恢复的形态（活动/审批/回执三态在 Withu 已有对应物，直接复用）。不采用——其 AG-UI 事件流、CopilotKit runtime、Google/Parallel 连接器依赖。
- **Codex**（`E:\Orbit\withu-refs\codex`，读 codex-rs 的审批/工具分层）：采用——工具提案与执行沙箱分离、配置分层解析（服务端唯一解析方）。不采用——coding-only 工具集、其平台沙箱差异假设。
- **claude-code-best**（已克隆，读 src/memdir 记忆组织）：采用——manifest 先行、按需召回的轻量思想（影响 T15 摘要优先装载）。不采用——其四类型系统直接映射、feature flag、Sonnet 依赖。
- **不采用的通用项**：任何参考仓库代码均未复制；许可证核查（OpenMuse MIT、Codex Apache-2.0、claude-code-best 无明确 LICENSE——仅读思想未复制代码）。

## T13 情绪判断层

**分类**：开发补齐（子 agent 启动，两次并发失败后遗产修复完成）。

### 源码实现层

`crates/withu-affect`：`typed.rs`（choice/score/noul 答案契约 + 熵置信度 + 校准门控 apply_gate + 诚实 abstention）；`judge.rs`（`TypedDecisionWorker` trait——真实 Laya worker/LLM 适配缝；确定性词表驱动 `FixtureJudge`，永远标记 degraded/uncalibrated → 只能做候选排序，对齐 B.20"未校准只能当候选排序器"；否定处理、话语权重 3x > 上下文 0.05x、冲突候选 → Mixed 领先、noul 标记）；`clarify.rs`（≤2 个低负担澄清选项 + 中性 Listen 兜底，§4.9.3 第 5 步）；`feedback.rs`（当前会话 TurnFeedbackLog：improved/unchanged/misread/unknown；misread → 下轮 open_with_apology）；`fixtures.rs` + `tests/fixture_replay.rs`（4.9.4 表 8 行全场景 + 失败路径回放）。

### 自动化验证层（fixture 回放）

`cargo test -p withu-affect`：33 lib + 4 集成全过。覆盖：明示优先覆盖推断、纠正使旧假设失效（superseded + 不可用于回应）、低置信/冲突进澄清不贴标签、明确事务请求"先承认情绪再走事务"（不自动建任务）、请求边界有界（MAX_CONTEXT_TURNS/CHARS）、假设永远不写成事实。

主协调者修复（子 agent 遗留）：split_last 元组序、Copy 语义移动、词表病态词条"过"（命中"难过"）、上下文权重过大（0.25→0.05）、Mixed tie-break、熵阈值与归一化熵真实值不符、断言谓词改用场景自身 must_require_clarification（fixture 永远未校准使 requires_clarification 恒真）。

### 真实服务验证层

未执行。真实 Laya worker / LLM 适配器未接线（trait 缝已留）；校准集构建（B.20 要求）超出本阶段。

### 真机与人工验收层

不适用（crate 层，无 GUI 面）。

### 参考对照

- **spec §4.9 全部 + B.20**（原文已读）：采用——typed questions（choice 分布/score 序数/noul 概率）、min_confidence 是调用方策略、无校准只做排序、不把 README 速度当产品指标。不采用——Laya 运行时/权重接入（留 trait 缝，未引入网络调用）。
- **Laya 仓库**（`E:\Orbit\withu-refs\laya`，Apache-2.0，读 README 与 typed-decisions 契约结构）：采用——答案结构与 confidence/answer_confidence 分离。不采用——代码复制、benchmark 数字。
- **spec A.5 研究依据**：候选假设/明示优先/支持需求与情绪分离/低置信拒答直接来自 4.9 编排，回放断言即其工程化。

## T15 语义索引

**分类**：开发补齐（子 agent 遗产 `semantic.rs` 核查修复 + 桥接既有检索缝）。

### 源码实现层

`crates/withu-memory/src/semantic.rs`：`MemoryIndexEntry::authorized_from_record`（active+confirmed+save_permission 门，未确认候选进不了索引）；`LexicalMemoryIndex`（token + char n-gram 混合、**CJK 单字成词**——修复中文零召回的根因；无网络、无模型下载、进程内存派生物）；`UnavailableMemoryIndex`（诚实 unavailable）；`search_semantic` = 从权威快照同步 → 检索 → 权威回查（版本/状态/墓碑/scope）→ 有界 L0 摘要优先装配；`SemanticMemoryIndex` 桥接**既有** `persistent::MemoryIndex` trait（server 现有 `load_index_context(semantic=true)` 调用点零改动生效，exact 路径原样委托）。

### 自动化验证层（fixture）

`cargo test -p withu-memory`：27 lib + 1 doc 全过（scope 泄漏拒绝、删除不复活 + 重建不复活 + 伪造 stale hit 被 dropped、未确认不索引、预算内摘要降级、纠正后新版本替换、CJK 命中、桥接经 server 真实调用形状）。`node checks/memory-rpc.mjs` PASS 3（真 server：语义命中 tea、cowork 不泄漏 comfort、删除后语义路径不复活、空结果诚实 no_results）。

### 真实服务验证层

不适用（本地派生索引即最终形态；embedding 语义索引未配置属诚实降级，状态如实上报）。

### 真机与人工验收层

未执行 GUI 面（MemoryManager 的 semantic 检索现返回真实结果，建议用户在活动面板验证）。

### 参考对照

- **spec §4.2.1/§4.3/B.22/B.23**：采用——权威/派生两层、候选回查版本+墓碑、L0 摘要优先、索引不可用如实说明。不采用——OpenViking 直接接入（AGPL 评估未做，按 spec 决议 3 退回自有实现）、其 sidecar 文件格式。
- **WeKnora**（`E:\Orbit\withu-refs\WeKnora`，读检索模块混合召回 + 分阶段评分 + 诚实状态）：采用——staged scoring 与显式 status/reason（`SemanticSearchOutcome.status/reason/dropped`）。不采用——其 Go 技术栈、知识图谱组件。
- **claude-code-best memdir**：manifest 先行、小上限选择性召回——已体现在 limit×2 fetch + 截断 + 摘要优先。
- **AliSQL/BqLog**：本任务不涉及（SQL 引擎评估与日志工程属其他板块，未越界）。

## T12 检索桩

**分类**：开发补齐（契约冻结后的诚实桩）。

### 源码实现层

`search_web_information` 加入工具目录与只读循环；服务端解析连接器诚实：聚合配置无 web 服务 → 显式 `status:unconfigured, sources:[]`（来源契约形状 title/uri/retrieved_at 已就位，真实连接器直接填）；follow-up 指令明确"未配置就如实说、不发明结果"。

### 自动化验证层（fixture）

`node checks/chat-tools-wire.mjs` 第 10.5 组：unconfigured 显式、sources 空、零伪造 URI、回合完成。`cargo test -p withu-server` 42 含新工具参数校验。

### 真实服务验证层

**未执行（待用户配置真实搜索连接器/MCP）**：来源与时间可追溯、连接失败/无结果区分呈现，需真实连接器后补验。

### 参考对照

- **spec B.5/Codex 检索持久化边界 + OpenMuse plan/富结果**：采用——"检索结果作为数据进入一轮上下文、来源引用必须来自真实工具结果"。不采用——任何具体搜索服务白名单（等用户配置）。

## T14 记忆候选闭环

**分类**：开发补齐（T13 可用前先行落服务端闭环——明示陈述提取不依赖情绪推断）。

### 源码实现层

`extract_memory_candidate`（main.rs）：只认三类无歧义自我陈述（偏好/称呼/"请记住"）；疑问、第三方、超长一律不出候选（单测断言）；`offer_memory_candidate`：消息落库后（message.submitted 路径，有无模型都工作）至多一个 `memory.candidate.created` 原子事件（契约已有事件名），携带 subject/content/kind + state_version（保存 CAS 输入）；按权威库 + 会话已提集去重；**零持久化**——唯一写路径是既有 `withu:memory:save`（explicit_save_permission + state CAS，头部注释"只接受用户显式表单提交"原样成立）；渲染层：候选 → 通知胶囊卡片，CTA 显式保存并提示"可在活动面板的记忆里查看或删除"，关卡即拒绝、零痕迹。

### 自动化验证层（fixture）

`node checks/memory-candidate-wire.mjs` PASS 6：显式陈述→恰一候选（含 CAS 输入）；疑问/第三方零候选；显式保存落权威库；重复陈述按权威库去重；过期 CAS version_conflict + 关闭零痕迹；重启后已保存的不重复提醒。`cargo test -p withu-server` 42（提取器边界）。

### 真实服务验证层

未执行部分：情绪对话中的候选质量（依赖 T13 真实接线）与通知真机行为归 T16/T17-C。

### 真机与人工验收层

未执行（通知胶囊视觉已有用户验收基线；候选卡复用同一组件）。

### 参考对照

- **spec R05/§4.2 数据模型/B.2**：采用——"应用持有记忆，provider 只返回候选""未经授权不保存""删除墓碑防复活"（保存即走既有墓碑语义；删除路径 T15 测试已断言语义索引不复活）。不采用——Anthropic memory tool 的文件语义（Withu 用 SQLite 权威层）。
- **claude-code-best**：`feedback` 型记忆记录成功与纠正双方的思想已由 response-outcome/affect-feedback 既有契约承担。

## 遗留与边界（如实）

1. **真实模型端到端（T09/T10 验收核心）**：需要用户配置 provider + API key 后补验——真实模型的工具调用决策、参数澄清质量、真实 provider tool-use 流。fixture 已证明服务端接线与全部失败路径。
2. **真实 web 连接器（T12）**：来源/时间可追溯、连接失败/无结果区分，待用户配置后补验。
3. **T13 真实校准**：Laya worker/LLM 适配缝已留；校准集（B.20）与阈值拟合未做，fixture 判断器只作候选排序。
4. **GUI 视觉验收**：消息内审批卡为复用组件的新呈现位置，建议用户过目；无结构改动。
5. 未跑 `checks/reply-wire.mjs` 与打包自检 `--withu-check`（涉及 UI 的改动建议打包后跑一轮）；Windows 通知、声学等属 Phase 6/7 边界未触碰。
6. 并发纪律执行记录：子 agent 两次失败（T15/T13 各一次，均 model concurrency limit exceeded），转全串行后无再发；主线全程单会话。
