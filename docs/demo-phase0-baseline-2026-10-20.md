# Demo Phase 0 基线审计（2026-10-20）

本轮仅审计源码、历史证据和包元数据；未启动应用、未读取凭据、未联系生产服务、未重跑全量测试、未修改应用源码或原 T01–T17 勾选状态。Phase 0 的完成表示缺口已定位，不表示产品功能或真实环境验收完成。

## 1. 当前开发入口与提交关系

交接源码源头为 `E:/Orbit/demobuddy` 当前源码树。控制器的 P1 实施工作区为 `C:/Users/yueeh/.codex/worktrees/demo-phase-0-1/demobuddy`，分支 `codex/demo-phase-0-1`，从此基线隔离实施。历史临时 worktree 和归档包用于取证，不作为继续开发入口；`withu-desktop-v2` 不是本次继续开发源。

本次现场命令与结果：

| 命令 | 结果 |
|---|---|
| `git branch --show-current` | 早期观察为 `chore/collab-infra`；后续 evidence JSON 快照及修订复核均为 `main`，详见下方时间说明 |
| `git rev-parse HEAD` | `8c8fd024f87ffcf6dacffa3360c4b6fdbedd0c41` |
| `git status --short`（审计写入前） | 仅有未跟踪 `.github/`、`.nvmrc`、`.workbuddy/`、`docs/superpowers/plans/2026-10-20-demo-phase-roadmap.md`、`rust-toolchain.toml`；没有已跟踪文件修改 |
| `git diff --stat a092229 621f982` | 77 files changed, 2145 insertions(+), 241 deletions(-) |
| `git diff --name-status 621f982 HEAD` | 仅 5 个文档：delivery manifest、delivery SHA、handover report、file index、sequential closeout plan |
| `git log --oneline --reverse a092229..621f982` | 包含 `09824b2 chore: freeze d1-d9 demo handoff`，以及之后证据、打包、交付文档提交 |

`a092229` 是原文档迁移基线，不能当作现有集成源码。`621f9822058388bc3dffc8747fedaf2863949cbd` 是 manifest 的 sourceFreezeCommit/targetHead。冻结后到当前 HEAD 没有源码、依赖、版本、运行时变更，只有文档修订。原计划仍写旧分支和“没有 go1 包”，与随后 handover/manifest 不是同一时间快照；以上现场 Git 结果优先。审计后新增的本报告与 `docs/evidence/phase0-2026-10-20/` 是本任务产物。

分支观察时间说明：早期命令输出确为 `chore/collab-infra`；随后写入的 [baseline-snapshot.json](evidence/phase0-2026-10-20/baseline-snapshot.json) 记录 `main`。修订时再次执行 `git branch --show-current` 得 `main`，`git rev-parse HEAD` 仍为 `8c8fd024f87ffcf6dacffa3360c4b6fdbedd0c41`。`git reflog -5 --date=iso` 记录 `2026-10-21 00:06:52 +0800` 的 `checkout: moving from chore/collab-infra to main`，对应用户时区 America/New_York 的 `2026-10-20 12:06:52 -0400`。因此早期观察与后期快照属于不同时间点，不能都表述为当前分支；本审计没有执行分支切换，也不推断切换执行者。证据 JSON 已准确记录后期状态，无需改写。

## 2. T02–T17 源码核对

以下路径均相对仓库根目录，行号对应上述 HEAD。证据 E1–E4 见下一节。“有脚本”只说明可验证入口存在，不表示脚本本轮运行通过。冻结与 HEAD 代码相同，因此冻结源码检查适用于本轮静态映射。

| TODO | 已有实现（源码定位） | 缺口与边界 | 已有证据及覆盖提交 | 下一步类型 |
|---|---|---|---|---|
| T02 图标、侧栏、列表 | `client/withu-renderer/src/components/Icon.jsx:1` 混用 lucide 与三套 JSON SVG；`Navigation.jsx:3` 固定导航项；`ChatsSidebar.jsx:1` 分组、排序、折叠和 portal 菜单；`interactions.css:292` 等控制布局 | 不是统一的新图标体系；参考配色、选中/悬停、所有显示隐藏列表的统一视觉待实现和视觉验收；侧栏内容顺序保留 | E1/E3 仅历史基础/包回归，不能证明新 GUI；无 T02 专项完成证据 | 开发→验证 |
| T03 功能标签栏 | `components/DesktopChrome.jsx:23` 菜单状态/历史，`:66` File/Edit/View/Help；`App.jsx:6` hash 路由、`:36` navigate、`:37` hashchange | 仍是菜单文字，没有聊天/动态/目标/灵感/资料/设置标签与路由联动；Search 是 modal 操作 | E3 基础路由历史覆盖，未覆盖目标标签 UI | 开发→验证 |
| T04 舞台顶栏、通知胶囊 | `components/Chat.jsx:78` 左侧新建+会话标题，`:79` 右侧朗读/语音/活动/支持，`:101` LifeToolsPanel；`App.jsx:22` 单条 5.5 秒 toast，`:66` withu-notice；`TooltipLayer.jsx:4` 全局 tooltip | 没有原子胶囊队列、空收起态及多条滚动；会话标题、支持按钮、生活事务横条仍存在；新建未在语音左侧目标位置 | E3 旧包；`checks/support-ui-scope.mjs` 针对支持面板作用域，不能代替目标视觉 | 开发→集成→验证 |
| T05 新对话空状态 | `components/Composer.jsx:9` submit、附件/输入/模型/语音；`Chat.jsx:176` 始终挂载 Composer；`interactions.css:292` 常规底部流布局；`App.jsx:35` createChat、`:51` send | 没有首条消息前居中分支；需定义“已提交消息”和通话摘要、失败发送、仅附件、切换会话之间的边界 | E3 有历史发送/恢复；无居中→底部专项 | 开发→验证 |
| T06 活动面板/MCP 消息卡 | `ActivityPanel.jsx:7` tabs、`:137` upcoming 为未完成 goals；`IdentityCards.jsx:4` SOUL 指向 `/SOUL.md`、MEMORY 指向 `/MEMORY.md`；`App.jsx:63` 独立 live-activity-panel；`LifeToolsPanel.jsx:60` MCP 仍开 Modal | 即将发生未接真实事务；Soul 应映射 AGENTS.md；记忆管理、通话中置、消息内 MCP/Intelligence UI 需迁移接线 | E1/E3/E4 模块/旧包；`client/withu-mcp-app/test/` 与 `checks/d6-replay.mjs` 存在 | 开发＋集成→验证 |
| T07 动态与日历 | `Pages.jsx:5` Feed 显示 proactivity items，`:82` 最近动态；`App.jsx:23` proactivityFeedList 获取真实本地 feed；`LifeToolsPanel.jsx:46` datetime-local | Feed 没有要求的日历卡、日期联动、详情和提醒创建闭环；没有从卡片推导真实外部来源链接能力 | E1/E3 旧树，未有新动态/日历交互验收 | 开发＋集成→验证 |
| T08 Settings/模型 | `Settings.jsx:45` data-privacy 仍渲染 MemoryManager；`Pages.jsx:19` 主动性设置仍在 Feed；`ChatModelPicker.jsx:53` 模型配置、`:74` effort range 已存在；`ProactivitySettings.jsx:1` 独立组件存在 | 设置迁移未完成；原子记忆管理入口、目标开关/滑块视觉及模型列表在 Effort 上方需核对；不能因有独立组件就认定已挂载 | E1/E3，模型相关脚本存在但本轮未跑 | 开发＋集成→验证 |
| T09 对话→工具公共链 | `apps/withu-server/src/actions.rs:137` action RPC、`:290` 请求审批；`life.rs:284` life handler；`App.jsx:51` 普通 messageSubmit/replyStart；`replies.rs:366` 工具调用返回 tools_not_supported | 文字 adapter 明确拒绝工具调用；尚无自然语言结构化工具派发→澄清→预览→授权→取消/结果公共链 | E1 的 Rust 模块；`checks/d4-rpc.mjs`、`owner-channel-regression.mjs` 是下层入口 | 开发＋集成→验证 |
| T10 D6 消息块 | `intelligent-ui/IntelligentSurface.jsx:1` typed surface；`state-machine.js:7` ready/loading/pending_approval/applied/failed/expired/closed/recovering；`life-actions.js:5` 构造 approval block；`Chat.jsx:113` 普通 Markdown/ResponseCard | D6 主要挂在手动 life 表单；模型回复不是通用 typed blocks；修改/取消、恢复、过期和语音同动作仍需全链路验证 | `checks/d6-replay.mjs` 存在；E1 不等价完整产品闭环 | 集成＋开发→验证 |
| T11 D5 本地事务 | `crates/withu-life/src/lib.rs:653` retrieve_information、`:693` organize_content；`apps/withu-server/src/life.rs:401` retrieve、`:418` organize；`LifeToolsPanel.jsx:22` prepare、`:31` draft/calendar/reminder、`:50` 审批；owner 持久化路径存在 | 手动本地 CRUD 不等于自然对话；整理/本地检索须接公共链；提醒到期走 D8；草稿仅保存不得发送 | E1 Rust tests；`checks/life-owner.mjs`、`life-actions.mjs`、`crates/withu-life/tests/d5_acceptance.rs` 可用 | 集成→验证 |
| T12 联网检索 | `life.rs:401` 和 `withu-life:653` 为本地信息检索；`apps/withu-server/src/provider_tools.rs:1` 是 provider 工具辅助，不能当联网搜索；`App.jsx:62` sources 回调仅提示“尚无来源数据” | 未见授权 web connector/MCP 搜索适配、来源 URL/时间结果链；未配置应明确报告，不能用本地结果充当联网 | 无真实搜索服务证据；E1/E3 不覆盖 | 开发＋集成→服务验证 |
| T13 D1 自然情绪支持 | `crates/withu-affect/src/lib.rs:123` 假设与澄清；`main.rs:569` affect plan，`:594` candidates 空、`:607` no_affect_inference_connected；`Chat.jsx:57` createSupportPlan/feedback 由用户手选 | 自然对话推断未接；需明示优先/低置信澄清、纠正反馈及跨文字/Realtime/presence 一次消费、TTL/会话隔离 | E1 affect 测试；`checks/support-context-wire.mjs`、`support-ui-scope.mjs` 为局部检查 | 开发＋集成→验证 |
| T14 D2/D3 显式记忆 | `main.rs:838` memory save、`:967` correct、`:1008` delete；`withu-memory/src/persistent.rs:259` evidence 原子保存、`:312` 后台候选、`:733` 删除；`Settings.jsx:45` 管理 UI | 用户确认表单/RPC 已有；自然会话候选→通知授权→保存以及活动面板查看仍缺；纠正/墓碑竞态需回归 | E1 memory tests；`checks/memory-save-rpc.mjs`、`memory-rpc.mjs`、`memory-context-wire.mjs`、`memory-gui.mjs` 存在 | 开发＋集成→验证 |
| T15 语义检索 | `persistent.rs:131` 可替换 MemoryIndex、`:143` LocalMemoryIndex、`:153` semantic_index_unavailable；`main.rs:933` semantic 分支明确降级；SQLite 仍权威 | 实际授权语义 adapter 未接，不能标为完成；删除/范围/版本/离线回退要跨索引复核 | E1 精确检索/降级测试；无实际语义服务验收 | 开发＋集成→服务验证 |
| T16 D7/Realtime/D8 | `McpAppHost.jsx:2` AppBridge、`:40` local fixture、`:68` iframe、`:87` 握手；`client/withu-mcp-app/src/host.js` session/transport；`speech/realtime-call.mjs` 独立通话；`main.cjs:49` 通知投递；`withu-proactivity/src/lib.rs:225` 不追发及`:244` quiet gate | 本地标准 App 不等于第三方服务；语音共享动作/结果与 MCP 消息卡未贯通；Windows 通知中心/Focus Assist、物理声学尚未验 | E1/E3 与 MCP fixture/browser、notification fake 脚本；真实服务/设备没有本轮证据 | 集成＋开发→服务/硬件验证 |
| T17 冻结、交付 | `checks/package-windows.mjs:6` 版本解析、`:18` 打包 metadata/manifest；`checks/desktop-run.mjs` 六场景；VERSION 和 npm manifests 为 go1 | 当前 HEAD 是旧冻结源码；后续 GUI 改动必须重新冻结/构建/包回归。历史日志不是新验收；视觉、声学、第三方仍待人工；目标 output 目录当前不完整 | E1–E4；E3 六场景均 code 0；包 hash 与旧 manifest 一致 | 验证＋交付集成 |

## 3. 交付物和证据复核

已读 [delivery manifest](delivery-manifest-2026-10-18.json) 与 [handover report](demo-handover-report-2026-10-18.md)，并用 Git、文件哈希、PE VersionInfo 和 ASAR 静态读取复核；未执行包。

| 项目 | 现场结果 |
|---|---|
| manifest 指向 EXE | `output/p1/windows/Withu-win32-x64/Withu.exe` 存在，246316032 bytes |
| `Get-FileHash -Algorithm SHA256` | `cedf5ceb547ade7fddf67318145b378a78faff0cf10471059effa59a54dd3f8b`，与 manifest 完全一致 |
| PE 字符串 FileVersion/ProductVersion | 均为 `0.3.1-go.1` |
| PE 数值 FileMajor/Minor/Build/Private | `0 / 3 / 1 / 1`，Product 四元组相同，满足数值 Windows 版本 `0.3.1.1` |
| 目标包完整性 | 上述目标目录现场仅有 EXE，没有 resources；不能把它单独当可运行完整包 |
| 完整包归档 | `output/git-cleanup-2026-10-20/worktree-files/d9-demo-closeout/output/p1/windows/Withu-win32-x64/`，含 resources/app.asar 和 withu-server.exe |
| ASAR SHA-256 | `68a1bc72d430f0c678901a9777808a7a4c460fa8b75d406986baf3690f8cb1fc`，匹配归档打包 manifest |
| server SHA-256 | `1bd3626adce56d90f501795fc7e7622047bc335878bd73623a9289ec4ec8ae6c`，匹配归档打包 manifest |
| 包内版本 | ASAR 的 VERSION=`v0.3.1go1`、renderer `src/version.js`=`v0.3.1go1`、根和 renderer npm=`0.3.1-go.1` |
| 包内源码关系 | 用 `@electron/asar` 静态读取，对照 Git 跟踪 client 文件及根版本/manifests：173 文件可比，116 字节相同，56 仅 CRLF/LF 不同，1 为根 package.json 打包裁剪；1 个候选路径不在包内。归一换行后 172 文件一致。只证明这些可比文件与当前/冻结树一致；不证明 server 二进制可重现构建或所有 dist 与源码一一对应 |

完整结构化取证见 [package-audit.json](evidence/phase0-2026-10-20/package-audit.json)。命令示例：`node` 加载 `@electron/asar` 的 `listPackage/extractFile`，路径使用 Windows 分隔符；哈希通过 `node:crypto`；未解包到应用数据位置。

证据分级与溯源：

- **E1 历史全量日志**：manifest 引用 `docs/evidence/verification-2026-10-18.log`，该原位置不存在；`git log --all -- ...` 无提交记录，`git ls-tree -r HEAD docs/evidence` 也没有此文件。使用 `rg --files --hidden --no-ignore output -g '*verification*'` 在上述归档的 `docs/evidence/verification-2026-10-18.log` 找到。其 SHA 为 `a72e18fa48060fb2a4c4efc85485cdbd1239f250c7aeb10283f72afccb35038a`。它记录旧临时 worktree：diff check=0；先前 `npm run check/build:contracts` 因 PowerShell ExecutionPolicy 失败=1，随后 `npm.cmd` 重试均=0（98 schemas），cargo workspace=0。没有嵌入完整 Git SHA，不能独立证明精确冻结提交；结合源码比对属于 go1 集成历史证据，不能宣称本轮重跑。
- **E2 历史构建**：[release-build](evidence/release-build-2026-10-18.log) 记录 release=0、package:windows=0 及 EXE SHA；Git 首次记录提交 `126a568`。另 [package-windows](evidence/package-windows-2026-10-18.log) 是先前缺 server binary 的 ENOENT 失败=1，提交 `347bb5e`，不得引用为成功。成功日志晚于失败日志，均属冻结前记录。
- **E3 六场景旧包**：[check-packaged](evidence/check-packaged-2026-10-18.log)，提交 `41018cc`，normal/restart/malformed/crash/eof/timeout PASS、EXIT_CODE=0。归档 `output/p1/desktop-run-SQrfwM/results.json` 六项 code 均 0，并有各场景 JSON；聚合结果没有记录 HEAD 或包 hash，因此按旧 go1 包历史证据使用，不能独立绑定之后文档提交的每个字节。没有读取场景导出内容中的用户数据。
- **E4 当前静态取证**：本报告及 JSON 对应 `8c8fd02`，证明 Git 比较、文件存在、哈希/版本与包内可比源文件关系。未重跑功能测试。原引用路径缺失仍明确保留，没有复制归档日志伪装新日志。

## 4. 后续验证前提（本地模拟与实际环境分开）

| 能力 | 本地已有入口/可测边界 | 实际环境前提与仍缺证据 |
|---|---|---|
| Web connector/MCP search | life retrieve/organize 可测本地授权内容；目前无 web 搜索接入 | 指定已授权连接器/MCP、可用地址与服务权限，由持有人私下注入凭据；来源 URL、采集/发布时刻、超时/取消、未配置提示及真实结果验收。不能仅因 provider 可发现模型就认定支持搜索 |
| 授权语义索引 | MemoryIndex trait、精确检索、unavailable 降级、删除墓碑可本地验证 | 明确索引后端与授权范围、Windows 部署/依赖、派生数据删除策略、重建和故障回退；实际 adapter/语义召回与删除竞态未验。SQLite 保持权威 |
| Realtime | `checks/realtime-wire.mjs`、`volc-realtime-wire.mjs`、`memory-context-wire.mjs`、`audio-transport.mjs` 等本地端点/传输检查 | 独立实时模型/服务开通、正确端点/模型/音色、私下注入凭据、麦克风权限、网络/TLS；文字模型通了不证明实时服务通了。需实际中断/重连/记忆更新/授权同链路；只保留时长摘要 |
| 标准 MCP App | local fixture、SDK/AppBridge/PostMessageTransport、CSP/session/size/teardown；`client/withu-mcp-app/test/` 与 test-browser.mjs | 选定第三方 MCP server 的 capability、UI resource、app 可用工具范围、账号授权/CSP 与真实工具结果；媒体内容还需允许的播放路径。local App 与标准协议支持不代表商业平台可播放 |
| Windows 通知 | `checks/proactivity-notification.mjs` 使用 FakeNotification；policy/runner 及不追发可本地验证 | Windows 通知中心、应用通知允许/拒绝、Focus Assist 开关、隐藏窗口/运行/完全退出、时区/quiet hours 和长时运行。`show` 事件不等于用户可见送达；Feed 的 preview 明示未发送 |
| 物理声学 | synthetic capture、有限音频、播放器协调/暂停本地检查 | 实体扬声器+麦克风、耳机及实际驱动/音量，验证回声、双讲、抢话、设备断开/切换、媒体与通话互斥；fixture、录制波形或截图不替代真机 |

Phase 0 没有读取 Credential Manager、用户配置、API key 或联系上述服务，因此“未验证”是证据状态，不推断现有凭据是否有效。

## 5. P1（T02–T05）精确交接

按锁定 GUI 规范先 T02→T03→T04→T05，每项单独保留可复核证据。当前无代码级阻塞，主要是视觉参考、通知来源接线和验收判定需在具体实现中核实。

- **T02**：入口 `Icon.jsx` 的 `iconNames/Icon/IconButton`、`Navigation.jsx` 的 `NAV/Navigation`、`ChatsSidebar.jsx` 的折叠/分组/排序/portal 菜单。资源为 `source-icons.json`、`navigation-icons.json`、`settings-icons.json`、lucide-react；应用 logo/ICO 位于 `client/withu-window/withu-icon.*`，与控件图标体系分开。样式主要 `source-tokens.css`、`styles.css`、`desktop.css`、`interactions.css`、`refinements.css`、`ui-polish.css`、`withu.css`，需注意覆盖顺序和 currentColor 处理。侧栏当前顺序 Chat/Search/Goals/Feed/Ideas/Library，底部 Settings，保留内容与功能。
- **T03**：`DesktopChrome` 的 menu/move/history 及 `App.jsx:36` navigate、`:37` hashchange、`:61` DesktopChrome 挂载。支持直接 hash、浏览器回退、library/settings 子页选中态；Search 保留 `onSearch` modal，不改成陌生路由。Windows hidden titleBarOverlay 在 `client/withu-window/main.cjs:35`；标签点击区不能落入拖拽区域。
- **T04**：`Chat.jsx:78` 顶栏、`ChatHeader.css`、`TooltipLayer`；`App.jsx:22` notify/toast 当前只保留单条，没有通知模型；真实主动性数据来自 `refresh` 的 proactivityFeedList，记忆和日历/提醒不是现成胶囊队列。移除入口时不能丢失支持/事务必要能力，后续按 T06/T14 归位；新建位于语音左侧；自动朗读、音频激活 `data-speech-activate-audio`、通话禁用状态、tooltip/键盘焦点需保持可操作。
- **T05**：`Chat/Composer` 接口、`App.createChat/send` 与 drafts/attachments/restore；当前 Composer 一直在 messages 后，send 保存成功才刷新消息。居中判定应依据会话已提交内容，明确首条提交失败不应被 busy 或输入中的文字错误切换；切换会话、仅附件发送、生成中取消、通话摘要与恢复都需要边界核对。不能通过重建 Composer 丢失输入焦点、附件或菜单状态。

已有检查入口：`npm.cmd run check`、`npm.cmd run build:contracts`、`npm.cmd run check:gui`（checks/electron.mjs）；针对会话作用域 `node checks/support-ui-scope.mjs`，模型浮层可参考 `checks/model-config-gui.mjs` 与 `checks/alpha-ui.mjs`。`checks/alpha-ui.mjs:34` 还断言 v0.3alpha14，且含旧本地 ASR/TTS 布局要求，不能当当前锁定规范直接全量套用；`checks/chat-voice-wire.mjs` 文件名虽像聊天 UI，实际上是本地 provider discovery/wire 检查。`checks/icon-package.mjs` 检查应用包图标，不验证侧栏新图标风格。P1 应选择相关检查并补充必要交互证据，用户视觉验收仍独立保留。

用户最新补充参考（控制器后续同步计划，本轮未联网读取）：[图标视频](https://cdn.collectui.com/amplify_video/2109709222371868672/vid/avc1/1920x1080/00HHPdmozwqU9WX_-optimized.mp4)、[通知](https://collectui.com/designs/notification-ui-design-inspiration/59aeec1c-5198-4e63-9a85-105f32591f67)、[空对话](https://collectui.com/designs/ai-ui-design-inspiration/78051db2-518e-41b6-92e9-56943d115544)。其余规范沿用 [顺序收尾计划](superpowers/plans/2026-10-18-demo-sequential-closeout.md)。Demo 范围以 [release plan](demo-release-plan.md) 和 [产品规格](product/withu-v3-spec.md) 为依据：不恢复 3D、本地模型安装管理、独立 ASR/TTS 配置、Cowork 正式版思考轨迹；不发送草稿。

控制器并行基线信息（本子任务未复跑）：控制器报告 `npm run check` 的 98 schemas 与 `npm run build:contracts` 通过；隔离 HEAD 副本的 renderer build 在 `client/withu-mcp-app/vite-plugin.mjs` 导入 esbuild 时失败。workspace manifest/lock 声明 esbuild 0.25.12，但当前依赖安装缺该 workspace node_modules，控制器将在隔离工作树安装依赖后验证。P1 构建验收前应先解决该环境前提，不能把依赖缺失归为新 UI 回归；本报告不把控制器转述当作本审计新运行证据。

控制器后续补充：隔离工作树执行 `npm ci --offline --no-audit --no-fund` 安装 211 个锁定依赖后，renderer build 已通过，源码/lock 无变更；仍有 Vite 大于 500KB 的 bundle 警告。此前 esbuild 构建前提已由控制器解除，不阻塞进入 P1。此项为控制器结果转述，本子任务未重复构建。
