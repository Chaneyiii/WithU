# 集成修复证据：A4 双入口不重复副作用（2026-10-28）

类别：开发补齐（A4 / T16-A「不重复副作用」）　影响：文字与语音共用一条提案路径

## 1. 缺陷（实测）

`output/probe/dup-probe.mjs` 用本地 SSE 夹具驱动真实 server：同一句「明天下午三点提醒我开会」、同一 due，
两轮 `提案 → allow → execute`，两次回执都是 `applied`，`life:list` 得到 **2 条提醒**，
文本与 due 完全相同、仅 id 不同。

根因：幂等键绑 `operation_id`（每次提案一个新 uuid，`ActionContext::delegated` 里 `life-idem:{operation_id}`），
只防「同一次操作重复点」，不防「同一句话两次提案」。语音说一遍再打字说一遍就是真实现场。

## 2. 改动（server 侧，零 renderer 改动）

- `apps/withu-server/src/main.rs`：`propose_life_action` 在生成审批卡之前先判重 ——
  若 `operation.kind == reminder_create` 且 `duplicate_reminder()` 命中，则返回**一条文字提示块**
  （`tool_notice_block`，`kind:"text"`、`action_ref:null`、零副作用），复用「编辑未命中」已有的诚实提示机制。
- 新增 `duplicate_reminder()`：身份 = **归一化文本（trim + casefold）+ 精确 due 时刻 + status=active**，
  在 `scope: comfort` 内查 `withu:life:list`。

**为什么放在提案层而不是执行层**：执行层去重只能保证「不落两条」，用户仍会看到第二张卡、点了「允许」才发现没变化；
提案层直接给提示，既没有重复数据也没有第二张卡，且不需要改 `action-receipt` 契约、不需要动渲染层。

**为什么两者共用这一处**：文字路径与语音路径都调用同一个 `propose_life_action`
（语音在 `main.rs` 约 2628 行处调用），因此跨入口天然覆盖。

## 3. 行为边界（有意为之）

| 情形 | 行为 | 理由 |
|---|---|---|
| 同文本 + 同 due，再提一次 | 文字提示「已经有了」，不建卡、不落库 | A4 的目标 |
| 同文本 + **不同** due | 正常出卡 | 「三点」改「六点」是另一个动作，用户应当能新建 |
| 已有提醒是 paused / 完成态 | 允许新建 | 只有 active 才算「同一件事还在」 |
| 不同会话 | 同样判重（scope 固定 comfort） | 用户视角是同一个生活空间，不是按会话隔离 |

## 4. 验证

| 层 | 证据 |
|---|---|
| 源码实现 | `main.rs` `propose_life_action` 判重分支 + `duplicate_reminder()` |
| 自动化（文字） | `check:chat:tools` **PASS 14**：新增 3b「同动作重复提案 → text 块 + 仍只有 1 条提醒」、12「同文本不同时刻仍出卡（防过度去重）」；原有 cancel/supersede 场景改用各自的动作变体，不再依赖制造重复 |
| 自动化（语音） | `check:realtime:tools` **PASS 10**：新增 4b「同一句话再说一次 → 提示」、7「语音先建，同样的动作改打字 → 提示，仍 1 条」（跨入口用例） |
| 回归 | `check:chat:gui` PASS 5（渲染层未改，审批卡/胶囊照常）；12 个 crate 的 Rust 测试全绿 |
| 未跑 | `cargo test --workspace` 的 server 测试目标（42 项）被环境拦截，见下 |

## 5. 环境问题（如实记录）

`cargo test --workspace` 无法完成：安全策略拒绝写入
`target/debug/deps/withu_server-2ce26dfbefe4445c.exe`（换 `CARGO_TARGET_DIR` 后同样是这个文件名被拒）。
其余 12 个 crate 单独跑全部 `test result: ok`（126 项）。server 自有测试里只有 `main.rs` 的
2 条（support context 过期、记忆候选抽取）与本改动无关，其余在未改动的模块内。

## 6. 遗留

- 本改动只做**提案层**判重；若用户绕开提案直接调 `withu:life:prepare`（非产品路径），仍可造出两条 —— 属内部 API 面，未额外设闸。
- 交付包尚未包含本改动（`output/p1/windows` 里的 server 二进制是 10-28 00:24 版），需在冻结前重打包并重录哈希。
  `check:product` 只扫 `client/**` 与禁用词，**不会**发现 server 二进制是旧的。
