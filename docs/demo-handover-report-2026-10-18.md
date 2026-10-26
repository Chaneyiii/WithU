# WithU v0.3.1goX Demo 项目转交报告

更新时间：2026-10-18（UTC+8）
用途：把当前 Demo 的源码入口、D1–D9 状态、版本规则、清理记录和后续收尾边界交给下一位同事。

## 1. 先读这里：当前结论

当前可接手的项目目录是：

```text
路径：E:\Orbit\demobuddy
当前 HEAD：以 `git rev-parse HEAD` 核对
版本文件：v0.3.1go1
```

`E:\Orbit\demobuddy` 已同步到当前冻结后的交付树，源码、交付文档和 Windows 包都从这里交接。

历史临时集成工作区不随交付包提供，也不是接手入口；后续开发、构建、打包和验收均以 `E:\Orbit\demobuddy` 为准。

D1–D9 集成代码已统一提交并同步到交付目录。接手后先运行：

```powershell
Set-Location E:\Orbit\demobuddy
git status --short --branch
```

Windows 包、SHA-256 和六场景自动化回归已完成；接手后只需补做视觉验收、真实设备声学验收和第三方服务人工验收。

## 2. 文档入口与权威关系

| 文档 | 用途 |
|---|---|
| `docs/product/withu-v3-spec.md` | 当前项目内的产品规格；旧的 `E:\Orbit\withu-plus\docs\product\withu-v3-spec.md` 已移动到这里 |
| `docs/demo-release-plan.md` | Demo 与正式版范围、D1–D9 总体定义 |
| `docs/demo-acceptance-index.md` | 历史验收证据和已知边界 |
| `docs/superpowers/plans/2026-10-18-demo-sequential-closeout.md` | 本轮 T01–T17 收尾计划和 TODO |
| `docs/demobuddy-file-index-2026-10-18.md` | `E:\Orbit\demobuddy` 当前 Git 跟踪源文件的路径索引 |
| `docs/demo-pause-handoff-2026-10-18.md` | 暂停时记录的 GUI 变更和未完成事项 |
| `docs/version-history.md` | 历史版本和发布说明 |

用户在本对话中后续确认的决定优先于旧文档内容。GUI 参考图只作为已经记录的验收要求，恢复 GUI 工作前仍需按用户规范逐项核对。

## 3. D1–D9 执行状态

| 任务 | 目标范围 | 已完成证据/代码 | 未完成、限制和接手动作 | 状态 |
|---|---|---|---|---|
| **D1 情绪支持与关系回应** | 用户明示优先、低置信澄清、支持计划、误判纠正、当前回合反馈、2D 状态投影 | affect/support 合同、server relationship-turn、renderer `SupportPlan`/feedback 和当前回合反馈代码已接入 | 尚未完成自然对话情绪推断；conversation 绑定、TTL、文字/Realtime/球体的一次投影消费要做最终集成回归 | **部分完成** |
| **D2 权威关系记忆** | 保存许可、证据链、版本、纠正、删除、墓碑、后台候选竞态和持久回放 | SQLite 权威存储、显式保存 RPC、版本/证据/纠正/删除/墓碑路径已有；本地持久性回放曾通过 | go1 集成树需要重新跑 owner/server/renderer 回归；不能把历史独立回放当成产品全链路完成 | **模块完成，集成待验** |
| **D3 检索、上下文与记忆 GUI** | 精确/语义检索、作用域、有限上下文注入、查看、纠正、删除 | server、preload、IPC、Memory Manager GUI 和实时 payload 检查已有 | 语义索引仍可能返回 `semantic_index_unavailable`；会话自动候选提取不足；真实云端模型效果未验 | **部分完成** |
| **D4 Comfort 事务与工具链** | 明确委托、预览、审批、执行、取消、幂等、版本保护、审计 | contracts、Rust actions、owner/server RPC、审批卡、执行/取消和本地 annotation 效果已接入；D7 host 缺少授权时会拒绝 | 自然对话中的工具派发和专项产品验收未完成；手动表单不能替代自然对话链路 | **部分完成** |
| **D5 基础生活事务** | 草稿、日历、提醒、整理、本地检索和恢复 | 独立 crate/fake 回放、owner/server/GUI 本地事务、SQLite 恢复已接入；草稿保持不可发送 | 没有联网检索和自然语言委托；D5 本身不发送通知，需与 D8 的到期策略联调 | **部分完成** |
| **D6 Intelligent UI 自有卡片** | typed blocks、surface、intent、版本、审批卡、真实结果、关闭/恢复 | renderer 组件、契约、回放、审批卡和 typed intent 挂载已有 | 模型回复到真实消息卡片的完整端到端闭环未补；需要把过期/关闭/恢复和语音同一动作纳入专项回归 | **部分完成** |
| **D7 标准 MCP App** | resource/tool、握手、AppBridge、PostMessageTransport、CSP、session、size、teardown、媒体协调 | 标准 SDK host、resource/tool 注册、Client/AppBridge/transport、CSP/session/size/teardown、fixture/browser 检查已有；本地报告曾通过 15/15 检查 | 第三方服务、真实对话触发、媒体/播放器实机和设备声学未验；缺 host/授权时应继续明确拒绝而不是伪装成功 | **模块完成，真实环境待验** |
| **D8 主动性、Feed 与通知** | 已授权提醒/问候、安静时段、暂停、不追发、权限和应用运行门控 | policy core、owner persistence、runner、Feed 和 generic notification projection 已接入 | Windows 通知中心、Focus Assist、权限、长时运行和 GUI 位置未验；动态设置应迁移到 Settings | **部分完成** |
| **D9 集成、验收与交付** | 统一提交、稳定包、六场景 packaged 回归、源码/包匹配、哈希、视觉和实机验收、交付报告 | 自动化构建、Windows 打包、SHA-256、源码/包版本核对和 normal/restart/malformed/crash/EOF/timeout 六场景回归均已通过；证据在 docs/evidence | 视觉验收、真实设备声学和第三方服务验收仍需人工 | **自动化完成，人工验收待办** |

### D1–D9 的交付判定规则

独立 crate、fixture、replay 或 RPC 通过，只能证明该层边界工作；只有 server 路由、IPC、renderer、持久化和真实交互全部接通，并有本轮证据，才能把任务标为完成。缺少云端凭据、真实 Windows 通知中心或物理声学设备时，报告必须保留人工验收项，不得用本地模拟结果替代。

## 4. 版本号规则与历史

### 4.1 规则

Demo 采用：

```text
显示版本：vMAJOR.MINOR.PATCHgoN
npm/Electron：MAJOR.MINOR.PATCH-go.N
Windows 数值版本：MAJOR.MINOR.PATCH.N
```

- `v0.3.1` 是产品/工程主版本。
- `go` 表示 Demo 独立 editing 工作完成，进入集成收尾阶段。
- `N` 是 go 阶段的收尾迭代号；`go1`、`go2` 必须递增，不覆盖历史版本。
- 当前源码显示版本为 `v0.3.1go1`，npm/Electron 为 `0.3.1-go.1`，Windows 数值版本为 `0.3.1.1`。
- `checks/package-windows.mjs` 从根 `VERSION` 读取并解析 Windows 数值版本；改版本时必须同步检查 `VERSION`、`client/withu-renderer/src/version.js`、根和各 workspace `package.json`、`package-lock.json`、Windows manifest 及最终产物。
- 版本变更要写入 `docs/version-history.md`，并在交付 manifest 中记录源码提交号和包哈希。

### 4.2 历史

| 版本 | 日期 | 说明 |
|---|---|---|
| `v0.3alpha16` | 2026-10-15 | P3 alpha 基线；当前 `E:\Orbit\demobuddy` 仍停在此版本 |
| `v0.3alpha17` | 2026-10-15 | Comfort Demo 中期基线，固定 Comfort GUI，记录 D1–D9 方向 |
| `v0.3alpha18` | 2026-10-17 | D1–D6 独立模块/合同、D3 记忆管理和若干并发修复进入中期工程包 |
| `v0.3.1go1` | 2026-10-17 | 当前集成收口版本；D4/D5 owner 生命周期、D7 MCP App、D8 feed/主动性接线进入集成树，但还不是最终验收完成包 |

## 5. GUI 待办（已记录，暂停期间不自动实施）

这些是用户已经明确的后续设计约束，恢复 GUI 工作后按列表逐项做，不自由扩展：

1. 主动性、通知、安静时段、时区等动态设置移到 Settings；Settings 保持原有页面样式。
2. 收掉主舞台右上角擅加的“生活支持”和主舞台“生活事务”横条，按方向文档重新归位。
3. 常驻侧栏只调整颜色，不改内容；顶部栏改为参考案例的标签页形式，移除“文件”“编辑”等菜单文字。
4. 列表、显示/隐藏、折叠、下拉统一采用指定案例的圆角浮层和顺滑状态切换。
5. 主舞台左上角使用通知原子胶囊；无通知保留收起态，多条通知上下滚动切换。
6. 新建会话图标移到右上角，紧挨语音通话图标并位于其左侧；会话标题移除。
7. 首条消息发送前输入框居中；发送首条消息后输入框回到底部。
8. 事务卡片放活动面板“即将发生”列表；日历和提醒走原子通知；Soul/Memory 留在活动面板，Settings 不展示记忆列表。
9. 通话面板放活动面板中间；MCP App 通过消息内 Intelligence UI 卡片承载。
10. 动态页卡片和日历支持真实链接、日期切换、详情、创建提醒和跨卡片联动。

## 6. 凭据和测试数据清理记录

### 6.1 已执行

- 只处理 WithU 自有的 Windows Credential Manager 命名空间 `Withu/v3/<workspace-hash>/<uuid>`；没有读取或输出 credential blob。
- 清理前发现 238 个 WithU 专属目标，已全部删除；清理后再次枚举结果为 0。
- 删除 WithU 本机配置、会话和 WebView 数据目录：
  - `%APPDATA%\Withu`
  - `%APPDATA%\withu-client`
  - `%APPDATA%\ai.withu.desktop`
  - `%LOCALAPPDATA%\withu`
  - `%LOCALAPPDATA%\ai.withu.desktop`
- 删除明确命名的 `%TEMP%\withu-*` 验收、RPC、MCP、memory-save、support-wire、research 和 config 临时目录。
- 删除两个工作区的构建和测试产物：`E:\Orbit\demobuddy\output`、`E:\Orbit\demobuddy\target`，以及当前集成树对应的 `output`、`target`。
- 保留源码、契约、文档、锁文件和 Git 历史；没有删除其他应用凭据（Docker、Microsoft、Outlook 等）。

### 6.2 清理边界

这次清理删除的是本机保存的 API key 副本、credential reference 关联的本地配置和测试数据。它不会自动撤销服务商后台已经签发的 key；若这些 key 仍可能有效，接手者应在对应服务商控制台执行 revoke/rotate，并把结果写入私有运维记录，不要把新 key 写入仓库、报告或截图。

后续启动 Demo 时应使用空配置或新的临时凭据。不要把真实 key 放进 JSON、日志、`output/`、截图、commit 或 issue。

## 7. 文件索引与交付包判断

冻结后的源码交付目录为 `E:\Orbit\demobuddy`。文件索引、交付 manifest 和 SHA-256 必须在同步完成后从该目录重新生成，索引只包含 Git 跟踪的源码、契约、文档和锁文件；`node_modules/`、`target/`、`output/` 与 `.git/` 不计入源码索引。若生成 Windows output 包，必须将其作为独立交付物并单独记录哈希。

交接会切换项目的开发环境和生产环境。接手者不能只复制 `demobuddy` 文件夹完成迁移，必须在新环境重新注入凭据、配置服务地址、安装 Node/Rust/Electron 工具链，并执行版本检查、包检查和六场景检查（normal、restart、malformed、crash、EOF、timeout）。旧服务商 API key 仍由密钥持有人在服务商后台 revoke/rotate；仓库、日志、manifest、截图和报告不得保存真实 key。

交付判定以同步后的 HEAD、`VERSION`、根与 workspace `package.json`/`package-lock.json`、`client/withu-renderer/src/version.js` 一致为准。缺少依赖或 Windows 环境时，报告必须记录确切失败原因和已完成的替代验证，不能把源码同步或本地测试写成已生成完整安装包。

## 8. 已完成交付状态、环境迁移要求与验证证据

- [x] 集成树 D1–D9 已统一提交；最终交付 HEAD 为 `621f9822058388bc3dffc8747fedaf2863949cbd`，已写入交付 manifest 与目标目录。
- [x] `E:\Orbit\demobuddy` 已 fast-forward 到 `621f9822058388bc3dffc8747fedaf2863949cbd`；`VERSION`、根与 workspace manifests、`client/withu-renderer/src/version.js` 均为 `v0.3.1go1` / `0.3.1-go.1`。
- [x] 文件索引：`docs/demobuddy-file-index-2026-10-18.md`（同步后 430 个 Git 跟踪源文件）；manifest：`docs/delivery-manifest-2026-10-18.json`；SHA-256：`docs/delivery-sha256-2026-10-18.txt`。
- [x] `git diff --check` 退出码 0；`npm.cmd run check` 退出码 0；`npm.cmd run build:contracts` 退出码 0；`cargo test --workspace` 退出码 0。完整输出和退出码保存在 `docs/evidence/verification-2026-10-18.log`。
- [x] Windows 包、SHA-256 和六场景 packaged 自动化回归已完成；`cargo build --workspace --release` 退出码 0，随后 `npm.cmd run package:windows` 退出码 0；生成 `E:\Orbit\demobuddy\output/p1/windows/Withu-win32-x64/Withu.exe`，SHA-256 为 `cedf5ceb547ade7fddf67318145b378a78faff0cf10471059effa59a54dd3f8b`。完整日志见 `docs/evidence/release-build-2026-10-18.log`，包哈希已写入 delivery manifest。六场景 packaged 回归已完成并通过；仅视觉验收、真实设备和第三方服务仍待人工。

交接会切换项目的开发环境和生产环境。接手者必须在新环境重新注入凭据、配置服务地址、安装 Node/Rust/Electron 工具链，并执行版本检查、包检查和六场景检查（normal、restart、malformed、crash、EOF、timeout）。只复制 `demobuddy` 文件夹不足以完成迁移；旧服务商 API key 仍要由密钥持有人在后台 revoke/rotate。真实 key 不得写入仓库、日志、manifest、截图或报告。

## 9. Demo 明确不包含的内容

- 不恢复 3D、本地模型安装管理、独立 ASR/TTS 配置开发线。
- Demo 不实现 Cowork 思考轨迹、团队工作区和专业工作能力。
- 不调用生产凭据或收费生产服务。
- 草稿不会发送；不做预约、购买或付款。
- Live 只保存通话时长摘要，不保存原始音频或逐句转写。
- 合成设备、fixture 和自动截图不能替代用户视觉验收或真实设备声学验收。

