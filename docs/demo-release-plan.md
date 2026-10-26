# Demo 与正式版交付安排

更新：2026-10-17。此文件记录用户最新交付决定与任务排期，不替代产品规格。
产品依据：`docs/product/withu-v3-spec.md`；用户后续明确指令优先于旧规格顺序。

## 当前交付决定

- 中期汇报先提交 Comfort Demo。GUI 模式标题固定为 Comfort，移除模式切换交互；Cowork 工作区、团队和专业工作能力放到正式版。
- Intelligent UI 属于 Demo：至少包含一个 Withu 自有真实交互场景和一个标准 MCP App；不把它作为 Cowork 专属能力。
- 保留当前已验收的 GUI、2D 球体、文字 LLM、千问/豆包 Withu-Live、消息朗读、配置与凭据隔离、数据恢复和退出语义。
- 3D Avatar、本地模型下载/安装/管理、独立 ASR/TTS 配置开发线不恢复。旧规格的 Laya 本地模型路径须与最新决定对齐，不能自动重建本地模型安装功能。
- 固定 GUI 模式不删除既有 Cowork 数据，也不改写 server 的两模式契约。Comfort 仍可有用户明确委托的生活事务、交互卡片与必要审批；Demo 不依赖完整 specialist 团队。

## 当前中期提交基线

`v0.3.1go1`（npm 内部版本 `0.3.1-go.1`）在已验收的 P3/alpha17/alpha18 基线上收口 D1-D8 的独立模块与当前生产接线。
该包记录集成进度，不提前声称完整打包或全流程验收通过；D1 的 conversation/TTL/一次投影消费、真实 Windows 通知中心/Focus Assist/权限、云模型效果和声学回声分离仍待验证。
版本与模块级证据见 `docs/demo-acceptance-index.md`。
后续 GUI 阶段继续由用户本人视觉验收，自动截图与设备模拟不能替代本人验收。

## Demo 任务包与状态

| 编号 | 任务 | 完成边界 | 当前状态 |
|---|---|---|---|
| D1 | 情绪支持与关系回应 | 用户明示优先、低置信澄清、支持计划、误判纠正、当前回合反馈与 2D 状态 | 核心 crate、server relationship-turn 与 renderer SupportPlan/feedback 已接入；conversation 绑定、TTL 与文字/Realtime/球体一次投影消费待最终验证 |
| D2 | 权威关系记忆持久化 | 保存许可、证据链、版本、纠正/删除、持久墓碑与后台候选竞态 | SQLite 权威存储和持久性回放已完成；与 D3 的服务端存取集成见其验收记录 |
| D3 | 记忆检索、上下文与管理 GUI | 精确/语义检索、作用域、有限上下文装载、用户查看/纠正/删除 | server、preload、GUI 与本地实时 WebSocket payload 检查已完成；真实云端模型效果/实机声学仍待单独验收 |
| D4 | Comfort 最小事务与工具执行链 | 明确委托、真实工具结果、MCP/连接器、最小动作审批、幂等/取消/审计 | 合同、Rust 模块与隔离回放已完成；owner/server RPC、聊天审批与本地 annotation 效果已接入，最终产品专项待补录 |
| D5 | 基础生活事务 | 信息检索、内容整理、消息草稿、本地日历与提醒 | 独立 crate/fake 回放和生产 owner/server/GUI 本地事务、SQLite 恢复已接入；到期候选经 D8，D5 本身不发送通知 |
| D6 | Intelligent UI 自有卡片 | 回复块、组件注册、真实结果、点击/语音同一动作与版本、过期/关闭/恢复 | renderer 组件、合同、回放及生产审批卡片/typed intent 挂载已接入；最终端到端专项待补录，MCP App 属于 D7 |
| D7 | 标准 MCP App 与媒体协调 | 一个标准 App 的协商/资源/握手/AppBridge/隔离/teardown；验证支持的播放器与语音协调 | SDK resource/tool 注册、Client/AppBridge/PostMessageTransport、CSP/session/size/teardown 与 fixture/browser 测试已完成；D4 host RPC 接入本地 annotation 审批；缺少 host/授权时拒绝并标明未提交，媒体/播放器实机未验 |
| D8 | 已授权主动性与 Feed/通知 | 日程提醒、低频问候/话题、安静时段、暂停、不追发、权限与应用运行门控 | policy core、owner persistence、runner、feed 与 generic notification 接线已完成；真实 Windows 通知中心、Focus Assist、权限和长时行为待验，fixture 不代表生产成功 |
| D9 | Demo 集成验收与汇报交付 | 全流程回放、用户视觉/实机验收、稳定包、功能边界与演示说明 | 生产接线与版本元数据正在收口；部分 workspace/schema/build 检查通过，最终专项、包回归、用户视觉与实机验证待补录 |

实时语音由独立实时模型回答。D1 支持计划的 server/renderer 控件已接入，进一步文字/Realtime/球体消费待最终验证；D3 的本地测试只证明 memory instructions 被装入独立 realtime WebSocket 请求，不证明真实云端回答效果。不得以文字 LLM 或本地 fixture 替代这两项链路验收。Live 继续只保存通话时长摘要，不为情绪或记忆功能重新落盘逐句转写/原始音频；记忆只保存用户允许保存的必要事实与证据。

## 正式版后置任务包（5 个）

| 编号 | 任务 | 与 Demo 的关系 |
|---|---|---|
| F1 | Cowork 工作区与项目体验 | 恢复模式切换，接计划、工具块、项目作用域、任务/产物面板；复用 Demo 的工具、审批和回复块 |
| F2 | 完整 Primary + Specialists | 独立上下文、派发/依赖/并发/预算/限流/重试/取消；specialist 无关系记忆或审批权 |
| F3 | 文件、代码与专业工作 | 授权文件夹、文件处理、代码差异、终端/专业产物最小闭环，仍遵守逐动作范围 |
| F4 | 预约、购物等高影响连接器 | 建议后置于 Demo；复用审批链，最终确认逐动作显式 Allow，不把消息草稿当作已发送 |
| F5 | 正式发行工程与全量验收 | 安装/卸载、升级与数据兼容、签名方案、依赖/许可证、恢复、跨机器与长时稳定性、完整 v3 回放和文档 |

其他实时供应商适配、千问独立朗读、任意商业流媒体兼容不是本次中期提交的前置条件。未支持能力如实显示，不由配置预设或网页能打开推导完成。

## 建议并行安排

1. D1-D6 的领域模块已有独立回放；下一阶段由一个集成人统一负责 server 路由、IPC、主界面与持久化接线，避免多个任务改共享入口。
2. 本轮先完成 D8 的无付费调用本地 policy/feed 核心，再由集成人挂载通知入口；所有主动行为必须来源于用户明确授权的候选。
3. D9 逐项接通 D1/D4/D5/D6，并重跑 D2/D3 的 owner/server 与 UI 回归；缺少云端凭据或真实设备时明确保留人工验收项。D4/D5 本地效果不代表发送、预约、购买或付款；Live 只保存时长摘要。
4. D7 标准 MCP App 已按用户最新决定纳入交付；第三方 App/媒体服务与完整 Cowork 团队仍以后续独立验收为准。

并行开发使用独立 Git 分支/工作树；共享 `App.jsx`、IPC/schema、server 路由、SQLite migration、package/version 由一个集成人负责，避免多个对话同时修改主工作目录。不得并发运行多个签名/打包/最终集成操作。

子 agent 统一使用用户指定的 `gpt-6.1-sol`、思考能力“中”。本次 D8 core 已派发；D9 由当前对话统一集成与终审。
