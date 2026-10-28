# v0.3.1goX Demo 顺序收尾计划

> **已由 roadmap 取代（2026-10-20）。** 本文件的 T02–T17 复选框未随 roadmap 同步更新，
> 其状态**不代表当前进度**；权威执行计划是
> [2026-10-20-demo-phase-roadmap.md](2026-10-20-demo-phase-roadmap.md)，
> 分解任务见 [2026-10-26-phase6-7-task-plan.md](2026-10-26-phase6-7-task-plan.md)。
> 本文件仅作历史记录保留。

## 目标

将现有 D1–D9 分支成果统一收拢到 `codex/d9-demo-closeout`，先完成已经锁定的 GUI 调整，再补齐自然对话链路，最后完成 D9 终审、打包和交付。

目标版本：显示版本 `v0.3.1go1`，npm/Electron 版本 `0.3.1-go.1`，Windows 包版本 `0.3.1.1`。

## 当前基线

- 最终交付/接手目录：`E:\Orbit\demobuddy`
- 历史临时集成工作区不随交付包提供，仅保留提交历史作为审计依据，不作为后续开发入口。
- 分支：`codex/d9-demo-closeout`
- 当前文档基线提交：`a092229`
- 工作区有大量未提交集成变更，禁止 reset、stash 覆盖或整体 cherry-pick 历史分支。
- 产品规格唯一权威：[`docs/product/withu-v3-spec.md`](../../product/withu-v3-spec.md)。用户在对话中明确确认的决定优先于旧文档。
- 当前没有经过最终验收的新 go1 包；历史 alpha17/alpha18 包不能替代 go1 证据。

## 执行规则

- 一次只执行一个 TODO；完成后更新本文件、提交代码并记录证据。
- 子 agent 统一使用 `gpt-6.1-sol`、中等思考能力，同时最多一个执行 agent。
- 只运行与当前任务相关的检查，最终冻结后集中运行全量检查。
- 开发验证使用隔离数据和本地模拟端点，不读取生产凭据或调用收费生产服务。
- 未验证的内容保持 `[ ]`，不得把模块测试写成产品完成。
- 不恢复 3D、本地模型安装管理、独立 ASR/TTS 配置或 Cowork 正式版能力。

## GUI 设计锁定规范

### 全局

- 图标统一参考 [_eugrl 图标案例页](https://collectui.com/designers/_eugrl)和用户提供的图标截图。
- 常驻侧栏内容、顺序、名称和功能保持不变，只更新图标、颜色、选中态和悬停态。
- 显示/隐藏列表统一参考 [Menu 案例](https://collectui.com/designs/menu-ui-design-inspiration/67582462-f25b-4323-bb6a-2b6b14a8d036) 和 [CSS 下拉案例](https://collectui.com/designs/css-ui-design-inspiration/c6e9a4d3-e029-467d-8db8-e35e5b5196bc)。
- 不使用 emoji、文字符号、CSS 绘图或临时手绘 SVG 代替图标。

### 顶部栏与主舞台

- 顶部栏改为聊天、动态、目标、灵感、资料、设置等功能页标签，删除“文件”“编辑”等菜单文字；搜索保留为现有操作。
- 主舞台左上角移除会话标题，在原位置放通知原子胶囊。
- 主舞台右上角放新建会话和语音通话图标，新建会话位于语音图标左侧。
- 左上角和右上角图标及 tooltip 参考 [Tooltip/Popover 案例](https://collectui.com/designs/tooltip-popover-ui-design-inspiration/30e894e1-f1dd-4b9a-8d14-0fbe9a940d97)。
- 删除右上角“生活支持”按钮和“生活事务”常驻横条。
- 侧栏和顶部栏颜色参考 [案例一](https://cdn.collectui.com/media/HKOLZo8aUAAkYFf.avif) 与 [案例二](https://cdn.collectui.com/media/HJu3rRnbsAAZOsK.avif)。

### 通知、事务与记忆

- 所有通知统一使用原子胶囊；无通知时保留收起态，点击展开，多条通知支持上下滚动。
- 日历和提醒走原子通知。
- 事务卡片放在活动面板“即将发生”区域，以列表形式展示。
- 记忆确认与管理走原子通知；Settings 不展示记忆列表。
- 活动面板 Soul 卡片对应 `AGENTS.md`，Memory 卡片对应记忆文件。

### 新对话、通话与 MCP App

- 首条消息发送前，输入框位于主舞台中央；发送后回到底部原位置。
- 通话面板放在活动面板中间，参考 [通话面板案例](https://collectui.com/designs/ui-interaction-ui-design-inspiration/c0ee31dc-2570-4aee-9df3-5be89ce730f7)。
- MCP App 以消息内卡片形式显示在现有 Intelligence UI 幕布。
- 模型选择浮层替换为 [Range Slider 案例](https://collectui.com/designs/range-slider-ui-design-inspiration/78d07ba6-585c-47c5-bbbe-a906cbb3f336) 风格，模型列表放在 Effort 行上方。
- 思考轨迹只记录为 Cowork 正式版待办，Demo 不实现。

### 动态页与设置页

- 动态卡片参考 [动态卡片案例](https://cdn.collectui.com/media/G83ERWGXQAA6AId.avif)，内容必须是真实能力和真实链接。
- 日期选择使用 [第一套日历案例](https://collectui.com/designs/calendar-ui-design-inspiration/4df04cb9-9c9a-4be1-b4bc-80b811861cb4)。
- 动态页日历卡片使用 [第二套日历案例](https://collectui.com/designs/calendar-ui-design-inspiration/c6df3600-2650-42c0-931a-a1671757c423)，支持切换日期、查看详情、创建提醒和联动其他动态卡片。
- 主动性和通知设置移入 Settings，Settings 保持原有样式。
- 启用开关参考 [Switch 案例](https://collectui.com/designs/switch-button-ui-design-inspiration/8706c04a-cb38-4873-9037-3658160c07fc)。
- 无数据状态参考 [No data 案例](https://cdn.collectui.com/media/HKcTws5akAELch5.avif)。

## 顺序 TODO

- [x] **T01 — 保存计划、转交报告并建立集成基线**：写入本计划和 `docs/demo-handover-report-2026-10-18.md`，核对现有改动并提交文档迁移与路径修正的可恢复基线；既有 D1–D9 代码改动保持未提交。
- [ ] **T02 — 更新全局图标、侧栏颜色和列表交互**：替换图标资源，保留侧栏内容，统一下拉、折叠和显示/隐藏列表。
- [ ] **T03 — 重做顶部功能页标签栏**：删除文件/编辑等菜单文字，实现标签与路由同步。
- [ ] **T04 — 重做主舞台顶栏和通知胶囊**：移除会话标题、生活支持和生活事务入口，加入通知胶囊、tooltip、新建会话和语音入口。
- [ ] **T05 — 完成新对话空状态切换**：实现首条消息前的居中输入框及发送后的底部输入框。
- [ ] **T06 — 调整活动面板**：实现即将发生列表、Soul/Memory 卡片、通话面板和 Intelligence UI 中的 MCP App 卡片。
- [ ] **T07 — 重做动态页卡片和日历交互**：实现真实链接、日期选择、详情、提醒创建和跨卡片联动。
- [ ] **T08 — 整理 Settings 页面**：接入主动性、通知、安静时段、时区、Switch 和模型/Effort 控件。
- [ ] **T09 — 建立自然对话到工具执行的公共链路**：接入结构化工具调用、澄清、预览、授权、执行、取消和结果。
- [ ] **T10 — 接入 D6 消息块和卡片状态**：支持预览、确认、修改、取消、执行中、成功、失败和过期保护。
- [ ] **T11 — 完成 D5 本地事务**：接入草稿、日历、提醒、整理和本地检索；草稿不得发送。
- [ ] **T12 — 补齐 D5 联网检索**：使用已配置连接器或 MCP，返回来源和时间；未配置时明确报告。
- [ ] **T13 — 完成 D1 自然对话支持**：接入情绪观察、谨慎推断、支持策略和反馈。
- [ ] **T14 — 收尾 D2/D3 显式记忆管理**：接入候选提取、授权保存、纠正和遗忘；记忆查看走活动面板。
- [ ] **T15 — 补齐 D3 语义检索**：保留 SQLite 权威存储，接入可替换授权语义索引；不可用时不虚报完成。
- [ ] **T16 — 收尾 D7、Realtime 和 D8**：让文字与语音共用授权和结果卡片，接入 MCP App、主动性和通知门控。
- [ ] **T17 — D9 冻结、终审、打包和交付**：完成全量检查、独立终审、版本统一、六场景包回归、哈希和源码匹配。

## TODO 更新格式

每项完成后追加：

> 状态｜完成日期｜提交号｜验证命令与证据路径｜剩余问题

只有满足完成条件并有证据时才改为 `[x]`。最终交付必须分别说明源码实现、自动化验证、真实服务验证和真机验收。

## 已完成记录

- T01｜2026-10-18｜`a092229`｜已验证 `docs/product/withu-v3-spec.md` 存在、原外部路径不存在、仓库内引用已统一；`checks/p3-closeout.mjs` 已按脚本位置解析仓库根目录规格文件｜D1–D9 既有集成代码仍待后续 TODO 逐项收口。
