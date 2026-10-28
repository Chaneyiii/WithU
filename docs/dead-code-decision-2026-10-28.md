# 死代码处置说明（2026-10-28）

> **已执行：选 A（删除）。** 2026-10-28 提交里删除了 `ResponseCard.jsx`、`LifeToolsPanel.jsx`、
> `MediaBoundaryPreview.jsx`、`life-tools.css`，并移除 `Chat.jsx` / `App.jsx` 里只服务于它们的引用。
> 执行记录见 [evidence/prompt-clock-and-dead-code-2026-10-28.md](evidence/prompt-clock-and-dead-code-2026-10-28.md)。
> 下文保留当时的决策分析，供将来要「做抽屉入口」时参考。

涉及两处组件。结论在前：**建议删除**，理由与代价见下。删除属于「移除不可达代码」，不改任何可见界面。

## 事实：它们是什么、为什么永远不显示

### `LifeToolsPanel.jsx`（64 行）+ `life-tools.css`

- 是一个「生活工具」面板：列出草稿/日程/提醒，能走 `prepare → allow → execute`，
  右上角有「打开本地 MCP App」按钮，点了在 Modal 里挂 `McpAppHost`。
- **没有被任何文件 import**（`grep -rn LifeToolsPanel client/` 除自身外零命中）。
- `life-tools.css` 也只被它 import，等于整块样式一起失联。

### `ResponseCard.jsx`（136 行）+ `MediaBoundaryPreview.jsx`（15 行）

- 是「回复卡片」：带一组预览态（ready / loading / login / approval / failed / expired / closed /
  unavailable）和一个展示类型选择器（结果 / 视频 / 媒体 / App）。当类型是 App 时它挂 `McpAppHost`，
  并把 `card.proposalContext` 传下去。
- 唯一渲染点是 `Chat.jsx:175` 的 `m.responseCard && <ResponseCard …/>`。
- **`responseCard` 没有任何生产者**：服务端没有 `response_card` 字段（`grep -rn response_card apps/ crates/` 为空），
  渲染层也没有地方构造它 → 条件永远为假。
- 它 import 的 `MediaBoundaryPreview`（`MediaScreen` / `MediaControls`）**只被它使用**，
  所以删 `ResponseCard` 会顺带孤立这 15 行。

## 为什么会变成这样

这两个组件是 D6/D7 做「Intelligent UI / 媒体承载」时的可视化试验台：当时用来手工预览各种卡片状态。
后来产品路径改成了「消息内按块渲染（`Chat.jsx:46`）+ 内联 `McpAppHost`」，
试验台就没有再接回主界面。`check:mcp-app` 的 19 条测试覆盖的是 `McpAppHost` 与宿主协议本身，
不依赖这两个组件。

> 相关的另外一点：`manual-verification-2026-10-27.md` 第 5 项写「打开浏览器抽屉里的本地 MCP App」——
> 抽屉的 App 模式只能由 `ResponseCard` 触发，所以这条路径其实不存在。新的
> `manual-acceptance-2026-10-28.md` 已改写成「消息内联」的真实路径。

## 选项 A：删除（建议）

**改什么**：删 `ResponseCard.jsx`、`LifeToolsPanel.jsx`、`MediaBoundaryPreview.jsx`、`life-tools.css`；
删 `Chat.jsx` 里 `ResponseCard` 的 import 与那一行渲染。

**影响**

| 维度 | 影响 |
|---|---|
| 用户可见 | **无变化**（本来就渲染不到） |
| GUI 冻结 | 不违反——删的是不可达代码，不动任何可见结构；但仍是 `client/` 改动，按约定需你点头 |
| 验收项 | T17-C 的 MCP 项改为「消息内联」（已写进新对照表）；B1 的对话内触发不依赖它们 |
| 测试 | `check:product` 的源文件数会从 361 降到约 357；`check:chat:gui`、`check:mcp:lifecycle` 不受影响 |
| 交付 | 文件数变 → `app.asar` 变 → 三个哈希要重录、要再打一次包 |
| 风险 | 低。唯一「损失」是那套媒体边界预览 UI；B5 的媒体协调走 `mediaCoordinator` + 真实播放器，不经过它 |
| 可逆性 | 完全可逆——文件都在 git 历史里（`git log -- client/withu-renderer/src/components/ResponseCard.jsx`） |

**工作量**：改 5 个文件、约 20 分钟 + 一次重打包。

## 选项 B：接线（把面板挂回界面）

**需要什么**

- 选入口：对话页某个按钮 / 设置页 / 抽屉里的切换。任何一个都是**新增可见控件**。
- `LifeToolsPanel` 需要 `conversationId` 与当前 `userMessage`；它的 Modal 与现有布局要重新对齐。
- 若要接 `ResponseCard`，还得先定义 `responseCard` 的数据契约（服务端要开始产出），那是**新功能**，不是修 bug。

**影响**

| 维度 | 影响 |
|---|---|
| 用户可见 | 多一个入口 → 必须重做视觉验收（T17-C 增一项） |
| GUI 冻结 | **直接冲突**：roadmap 要求新界面先经你决策并更新方向文档 §5 |
| 验收项 | 不增加能力（B1 的对话内触发已由内联路径证明），只是多一条入口 |
| 测试 | 新入口 = 新状态与新错误路径，要补断言；现有 19 条 MCP 测试不覆盖入口 |
| 风险 | 中：入口涉及会话选择、证据引用（`userEvidenceRef`）等上下文，容易做出「点了没反应」的路径 |
| 工作量 | 接线约半天 + 视觉验收；接 `ResponseCard` 另算（契约设计 + 服务端产出） |

## 选项 C：保留（不推荐）

留着就是留一段没人调用、但看起来像功能入口的代码。这次的教训很直接：
`manual-verification` 就是因为照着一份「看起来存在」的入口写了步骤，才让真机验收卡在一个不存在的面板上。
**要么用，要么删**，中间状态最贵。

## 建议

选 **A**，并且和「Windows 版本号口径」一起做，最后统一重打一次包（避免打两次、录两次哈希）。

如果你想保留「从抽屉打开 App」这个产品入口，那属于**新功能**，建议单独排一个任务：
先在方向文档 §5 定入口位置，再接线、补断言、做视觉验收——而不是现在顺手挂一个面板上去。
