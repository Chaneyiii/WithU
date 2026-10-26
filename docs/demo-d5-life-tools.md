# D5 基础生活事务工具

更新：2026-10-17。D5 是 Comfort Demo 的本地生活事务边界，已有 owner/server/GUI 接线与 SQLite 状态恢复；独立 FakeLocalAdapter 测试与生产本地效果分别记录，不把普通网页或 fixture 当作 MCP App。

## 能力范围

- **有界信息检索**：只从 trusted server 注入的本地来源检索，查询和结果数量有上限。每个结果携带 `source_id`、来源 `version`、`observed_at`、`scope` 和 `verified`。没有匹配或没有真实来源时返回 `unavailable`，`content` 为 `null`，不生成补全内容。
- **结构化内容整理**：接收用户提供的结构化条目，按用户指定字段分组，摘要只使用输入字段，并携带 `item_ids` 和 `summary_basis`。输入被限制在条目、字段和文本上限内；推测不会被写成事实。
- **消息草稿**：创建、编辑、预览（读取本地 draft）和丢弃。没有 `send_message` 操作，任何 D5 receipt 都不能说明消息已发送；后续外发连接器必须单独实现并继续走 D4 的逐动作审批。
- **本地日历**：事件的增删改查，使用 `scope` 和对象版本 CAS。独立模块使用内存/fake adapter；生产 owner 持久化本地对象与版本，不连接外部日历，不做预约确认。
- **本地提醒**：提醒的增删改查、暂停和恢复，底层记录委托给 `withu-scheduler`。scheduler 保留应用运行门控、授权 evidence、取消 token、版本 CAS、并发/预算/重试/速率限制；D5 不发送主动通知。主动通知属于 D8。

购物、付款、外发消息、OAuth、预约确认、完整 specialist、Cowork 和 MCP App 不在 D5。

## D4 调用方式

写操作的调用方必须保留下面的顺序：

1. 由用户明确事务目标创建 `ActionContext`，包含 `task_id`、`user_evidence_ref`、policy/authorization version、幂等键、cancel token 和 expiry。关系回合、情绪推断或 connector 结果不能自动创建任务。
2. `withu-life` 用 `ActionSpecBuilder` 构造单个 `ActionSpec`，绑定 operation、target object/version、参数规则和 digest、`life:<scope>` 数据范围及影响等级。
3. `ActionChain::preview` 生成 `PlanPreview`，再由 `request_approval` 生成每动作一张 `ApprovalCard`。写入、删除、草稿丢弃和提醒状态改变都是 `Manual`，必须有明确 `Allow`。
4. 集成层把用户决定传给 `ActionChain::decide`，随后用同一个 `PreparedAction` 调用 `execute_prepared`。D5 不直接调用 adapter，也不绕过 opaque one-use grant。
5. 只有 `ActionReceipt.status == applied` 才提交本地对象。`rejected` 或 `failed` 不改变对象；失败 receipt 的 `effect_committed` 和 `committed_targets` 如实保留。

读操作也使用同一个 typed action 和 receipt 边界。信息检索、内容整理是只读且 `safe_for_auto`，因此可以由 D4 的 `Auto` 规则执行，但仍检查 scope、版本、expiry、取消、幂等和应用生命周期。

## 版本、scope 与生命周期

- 每个本地对象都带 `schema_version`、`scope` 和单调 `version`。编辑、删除、暂停和恢复必须带 expected version；旧版本在准备阶段或 connector authorization 阶段被拒绝。
- `scope` 是 D5 数据隔离的最小边界。对象、来源、ActionSpec data scope 和查询结果都绑定 scope；未授权 scope 直接返回 `ScopeDenied`。
- Action expiry 在 preview、approval 和 execute 期间都有效。cancel token 在 connector submission 前阻断动作；`stop_accepting_work` 同时停止 action chain 和 scheduler，应用退出不会继续提交新动作。
- scheduler 只保存本地执行记录，不产生通知；暂停/恢复/删除使用 scheduler 自身的 expected schedule version。生产 server/GUI 读取 receipt 后展示本地效果，应用运行中的到期候选经 D8 policy 门控；不代表 OS 通知实际显示。

## 隔离验证

`crates/withu-life/src/tests.rs` 的 replay 使用 synthetic evidence、`FakeLocalAdapter` 和本地 scheduler，覆盖：

- scope 隔离、verified/unavailable 来源和可追溯整理；
- 草稿在 Allow 前不落盘，且没有发送效果；
- 草稿 CAS、重复幂等键、取消、expiry、应用退出；
- connector failure receipt 不报成功且不提交对象；
- 未授权/高影响动作 fail closed；
- 提醒创建、暂停、恢复、删除与 scheduler 状态/CAS。

测试不读取生产凭据、不访问网络或付费云，也不代表外部日历、消息供应商或主动通知已经接入。
