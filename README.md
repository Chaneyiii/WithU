# Withu v3

## Phase 3–5：自然对话能力（2026-10-25，v0.3.1go4）

T09–T15 已实现并通过自动化验证（详见 [Phase 3–5 证据](docs/evidence/phase3-5-2026-10-25/verification-2026-10-25-p3-5.md)）：自然语言委托本地生活事务（提醒/日程/草稿的创建、编辑、删除）经模型结构化工具提案 → 消息内审批卡 → 显式允许 → 落盘，取消零副作用、重复确认不重复执行、修改后旧卡失效；本地检索与内容整理免审批走有界只读回合；联网检索为诚实桩（未配置时如实报告，来源/时间契约就位）；情绪判断层为 Laya 式结构化候选（fixture 排序器，未校准，用户明示永远优先）；记忆候选以原子通知出现、用户显式保存、删除走墓碑不复活；SQLite 之上的派生语义索引支持中文检索且不可用时如实降级。

### 实机验证（Phase 3–5 全量）

环境准备（Windows）：

```powershell
cargo build -p withu-server            # 产出 target\debug\withu-server.exe
npx vite build --config client/withu-renderer/vite.config.mjs
npx electron . --withu-dev-data        # 隔离数据运行，不碰 %AppData%\Withu 演示库
```

启动后在 Settings 配置真实对话 provider 与 API Key 并测试通过。逐项验证：

| 任务 | 操作 | 预期 |
|---|---|---|
| T09/T10 | 输入「明天下午三点提醒我开会」 | 出现审批卡（内容+时间），不直接执行；点「允许一次」后活动面板「即将发生」与日程页出现该提醒 |
| T09 参数澄清 | 输入「提醒我开会」（无时间） | 模型先问一个澄清问题，不出卡 |
| T10 拒绝/重复 | 出卡后关闭；允许后重复确认 | 关闭零副作用；重复确认不重复执行（仍只有一条） |
| T10 修改失效 | 连续委托并修改时间 | 旧卡自动显示「已失效」，无法再执行 |
| T10 失败真相 | 改错 API Key 后委托 | 显示真实失败原因（鉴权失败等），不落假消息 |
| T10 恢复 | 完全退出应用后重开 | 提醒还在；卡片显示「已允许」（决定已持久化） |
| T11 草稿 | 「帮我写一条消息给老师请假」 | 只生成草稿，永不发送 |
| T11 编辑/删除 | 「把那个提醒改到四点」「删掉它」 | 编辑/删除审批卡，允许后生效；多条相似时先问是哪一条 |
| T11 检索 | 「帮我找会议纪要」 | 引用本地已导入文件来源；无来源时如实说 |
| T12 检索桩 | 「上网帮我查一下天气」 | 诚实说明未配置网络检索连接器，不出现编造结果 |
| T13 情绪 | 「我今天有点难过」→「你理解错了，我只是累了」 | 先倾听不贴标签；被纠正后道歉修正、不连续追问 |
| T14 记忆 | 「我喜欢无糖乌龙茶」 | 通知胶囊弹「要记住这条吗？」；点查看才保存进活动面板 Memory；关闭零痕迹；重复陈述不重弹；删除后不复活 |
| T15 语义检索 | Memory 检索模式选 semantic，查「乌龙茶」 | 命中该记忆（带版本与证据）；删除后同查询不出现；无结果时如实报告 |

自动化兜底（真实 server 二进制 + 本地 SSE fixture，覆盖全部失败路径）：`npm run check:chat:tools`（12 组）、`node checks/memory-rpc.mjs`、`node checks/memory-candidate-wire.mjs`（6 组）。真实模型行为与 GUI 呈现以上表实机为准；Windows 系统通知、声学、Live 通话属 Phase 6/7 范围。

## 当前中期工程包（2026-10-17，v0.3.1go1 Comfort Demo）

GUI 固定 Comfort，保留既有 Cowork 数据。D1-D6 的关系支持、记忆、事务和 Intelligent UI 模块已进入代码库；D1 的 conversation/TTL/投影消费仍待最终验证，D4/D5/D6 的生产应用接线与 D9 全流程验收仍按证据收口，D8/D7 已有本地接线但保留真实设备/权限边界。交付边界见 [Demo 与正式版计划](docs/demo-release-plan.md)。

Settings 通用页提供两个独立分割线卡片：对话模型、实时语音服务。各自新增／编辑／删除提供商，分别保存 API Key 到 Windows 凭据库，分别选择默认模型。实时语音不再拆分 ASR/TTS；提供豆包实时语音、OpenAI Realtime、Gemini Live 和自定义协议表单预设。预设仅填写地址和协议，不代表适配器已经实现或接口已经通过测试。豆包全双工表单使用固定版本 1.2.6.1。

文字聊天使用用户选定的 LLM；端到端语音服务由其自身模型回答。千问、豆包全双工已接入，麦克风与电话统一进入 Withu-Live，仅保存通话时长摘要。交互身份默认 Lumi，尊重自定义名字；消息朗读当前支持豆包。其他协议预设不代表已实现适配。

当前包路径待本轮打包产生；Windows 包未签名。当前 D1-D8/D9 集成证据与边界见 [Demo 提交索引](docs/demo-acceptance-index.md)；alpha17/alpha18 及更早的 P3 实机与设备证据见 [P3 索引](docs/p3-acceptance-index.md)。

本地语音模型目录、GLM 默认项、下载管理、README 展示、Cowork 安装入口及对应 IPC／服务端模块已删除。旧配置按 schema 1→2 读取迁移，保留配置版本、既有 LLM 选择、提供商 IDs 和系统凭据引用，清除旧 ASR/TTS 默认选择；实时语音需独立配置。迁移读取不写正式配置，下一次用户明确保存时按 CAS 原子提交。旧下载文件和用户凭据未被删除。

检查：`npm run check`、`npm run check:models:gui`、`npm run check:models:server`、`node checks/service-isolation.mjs`、`npm run check:reply:wire`、`npm run check:providers:wire`。GUI 隔离检查使用 `WITHU_CHECK_SERVICE_GUI=1`、`WITHU_CHECK_DATA` 独立目录、`WITHU_SERVER_BINARY` 本轮构建，再运行 `npx electron . --withu-check`；使用虚构凭据，不调用云服务。

本轮构建：`cargo build -p withu-server --target-dir output/p3/build-target` 与 `npx vite build --config client/withu-renderer/vite.config.mjs`。下方 alpha 历史记录仅说明旧阶段；旧有限 ASR/TTS 的测试不代表当前实时语音验收。验收与未知项见 [P3 索引](docs/p3-acceptance-index.md)。

独立 v3 仓库。唯一产品权威：`docs/product/withu-v3-spec.md`（当前 v3.7-draft）。用户直接确认的最新决定优先；本文仅记录工程入口和当前实现，不定义产品需求。

## 开发

需要 Windows、Rust/Cargo、Node.js/npm、Git、PowerShell。Electron、React、Vite 与其他依赖由 `package-lock.json` 锁定，不再是 P0 的无依赖骨架。

```powershell
npm ci
cargo build --workspace --locked
npm run build
npm start
```

`npm run build` 实际构建 Rust workspace 与 React 前端。Electron main 持有 Rust server，server 权威持久化为 SQLite；主窗口/renderer 与 server 生命周期分离，完全退出执行收尾。`npm run build:contracts` 只检查桥接模块语法。

安装排障（Windows）：若 npm 配置阻止依赖的 postinstall 脚本，`npm ci` 后 vite/electron 会不可用，需 `npm install-scripts approve esbuild electron`（或对应包名）后 `npm rebuild <包>`；electron 二进制直连 GitHub 失败时可用镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx install-electron --no` 重试。wire 检查脚本（`checks/*-wire.mjs` 等）默认读取 `output/p3/build-target/debug/withu-server.exe`，可设置 `WITHU_SERVER_BINARY` 指向任意构建产物（如 `target\debug\withu-server.exe`）。

## 本地网页预览

```powershell
npm run preview:gui # P1 预览，127.0.0.1:4173，原数据目录
npm run preview:p2  # P2.1 预览，127.0.0.1:4174，独立 output/p2/visual-userData
```

P2.1 地址：`http://127.0.0.1:4174/?presence=1#chat`。只有开发网页预览且带 `presence=1` 时呈现 Presence fixture 入口；正式 Electron 不伪报语音可用。网页预览运行实际 Rust server，但测试字幕和 presence 状态只在 renderer 内，不是 server speech session。

**2026-10-10 用户取消 3D Avatar 开发线。** 只保留已验收 2D 球体、动画、眼神/表情；不提供 3D、WebGL 载体、2D/3D 切换或其降级流程，也不作为后续待办。原 2D SVG/CSS 渐变不受影响。

P1/P2 为已验收基础；fake 语音和设备生命周期检查继续用于工程回归。真实语音的当前状态见本文顶部及 P3 索引。开发预览和合成设备不替代真实服务或实机听感证据。Laya、工具/团队/MCP App/商业媒体不因预览存在而成为已支持能力。

## 检查与打包

```powershell
cargo test --workspace --locked
cargo fmt --all -- --check
npm run check
npm run check:presence
npm run check:server
npm run check:lifecycle
npm run check:product
npm run check:desktop
npm run package:windows
npm run check:packaged
```

- `check`：v3 schema/IPC/公开配置等边界检查。
- `check:presence`：P2.1 renderer 状态映射、fixture 字幕和取消边界检查；不替代用户视觉验收或真实 Electron 音频证据。
- `check:server` / `check:lifecycle`：实际 server/持久化/退出与故障回放。`WITHU_SERVER_BINARY` 可指向隔离构建产物。
- `check:desktop`：开发 Electron 的实际 GUI/server 回放；`check:packaged`：实际 Windows 包回放。`package:windows` 保留 P1 输出；`package:p2` 输出独立 P2 包，不覆盖 P1。
- 所有 fixture 在本仓库定义。构建产物、证据、用户数据、音频和临时文件不提交。`output/`、`target/`、`node_modules/`、`dist/` 已忽略。

## 职责目录

- `apps/withu-server`：本机 server 与 main-owned stdio 生命周期。
- `crates/withu-runtime`、`withu-memory`、`withu-speech` 等：运行时、记忆、语音与各领域边界；有骨架不代表真实后端已接入。
- `client/withu-window` / `withu-preload` / `withu-ipc`：可信 main、preload 与版本化 IPC。
- `client/withu-renderer`：保留 GUI、两模式主舞台、文字输入、2D 球体与开发预览。
- `contracts/v1`：严格版本化 schema、事件、错误、操作边界。
- `checks`：v3 独立检查；`docs`：实现来源及证据索引。

索引：`docs/p0-contract-index.md`、`docs/p1-acceptance-index.md`、`docs/p2-acceptance-index.md`。索引是工程记录，不是平行产品权威。

## P2 speech 开发与独立回放

```powershell
cargo build --workspace --locked --target-dir target/p2
npm run check:speech:server
npm run check:speech:desktop
cargo build --release --workspace --locked --target-dir target/p2
npm run package:p2
npm run check:speech:packaged
npm run check:speech:suite
npm run check:speech:suite:packaged
node checks/desktop-run.mjs --p2
node checks/desktop-run.mjs --p2 --packaged
```

`node checks/speech-desktop-run.mjs --scenario=<case>` 可独立复现实际 Electron 用例。`check:speech:suite` / `check:speech:suite:packaged` 顺序运行 15 个隔离进程，覆盖正常闭环、完整 ASR/会话矩阵、权限撤回、合成设备 ended、在途输入/晚到申请、AudioWorklet 失败、结束/超时、清理失败、server 崩溃与设备拒绝/缺失/忙碌。每个进程的输入、owner、userData 与失败注入独立。测试内容与用户数据隔离在 `output/p2`，Chromium 测试麦克风不是物理麦克风证明。音频为受控测试 PCM 提示音，不宣称语音自然度、ASR 准确率或回声消除。

手动开发 fake 入口（普通产品默认关闭）：

```powershell
$env:WITHU_CHECK_DATA="$PWD/output/p2/manual-userData"
$env:WITHU_SERVER_BINARY="$PWD/target/p2/debug/withu-server.exe"
npx electron . --withu-fake-speech
```

须点击开始测试会话；点击说话时才申请可信主帧的 audio 权限，再点停止收音实际停止 tracks。不申请 camera，不给外部 iframe 授权；连续双工与可靠声学分离尚未验证，当前使用保守的点击唤起/停止入口。

包冻结检查：`node checks/p2-package-freeze.mjs --suite=output/p2/<packaged-suite>/results.json`，逐项比对 manifest、实际Rust、app.asar、136个源码/契约/资源和15次回放的二进制哈希；packager移除开发字段的package.json按精确生产投影核对。失败不得当作完成。

## P3.1 模型配置视觉预览（本人暂时通过）

```powershell
npm run preview:p3        # 127.0.0.1:4175，独立 output/p3/visual-userData
npm run check:models:gui  # DTO / 表单边界检查，不是视觉或真实接口验收
```

打开 `http://127.0.0.1:4175/?models=1#/settings/connectors`，在原 Connectors 外壳内检查提供商、默认 LLM/ASR/TTS、普通声音/高级音色、本地下载状态。开发场景下“测试/保存”只操作本页内存，刷新或离开页面会重置；**勿输入真实密钥**。正常页面不开放这些示例操作。Composer 在 Comfort/Cowork 均可进入同一设置，未配置模型不开放无依据的思考能力滑块。

网页预览仅 GUI 和无秘密视图 DTO。用户已暂时通过 P3.1 并授权继续 P3.2–P3.5；正式桌面配置与文字链路状态见下节。详细检查与边界见 `docs/p3-acceptance-index.md`。

若预览占用默认 `target/debug/withu-server.exe`，不要删除或覆盖运行产物；使用隔离构建：

```powershell
$env:CARGO_TARGET_DIR='E:/Orbit/demobuddy/output/p3/build-target'
npm run build
Remove-Item Env:CARGO_TARGET_DIR
```

## P3 配置与运行

正式模型配置在 Electron 的 Settings → 通用分别保存对话模型和实时语音服务：Key 存 Windows Credential Manager，Server 持有配置/CAS/版本与公共投影。网页 `preview:p3` 只演示 GUI，**不要在那里输入真实 Key**。

开发运行最新二进制：

```powershell
$env:WITHU_SERVER_BINARY='E:/Orbit/demobuddy/output/p3/build-target/debug/withu-server.exe'
npm start
```

已接 OpenAI Chat Completions 兼容文字 SSE：选择提供商和模型、保存默认选择后，发送文字会发起真实请求，可能消耗你自己的服务配额；停止生成会取消 HTTP。服务由用户自配，不从其他软件读取凭据，不自动换 provider。Settings 的 LLM“测试真实模型”仅发最小测试请求，不包含对话历史。测试通过只说明这次对话接口结果，不代表 ASR/TTS/音色设计/思考能力也支持。

```powershell
npm run check:models:server  # 实际 Windows OS 凭据 + Server CAS/重启/失败
npm run check:reply:wire     # 实际 HTTP/SSE fixture + 取消/失败，非真实云端验收
```

当前 alpha16 使用独立千问或豆包实时语音服务：持续 16kHz PCM 输入、24kHz PCM 播放、服务端回合检测和打断取消。文字使用独立 LLM。旧 ASR/TTS 配置不会自动变成实时服务；本地模型功能已删除。OpenAI/Gemini/custom 实时协议尚未实现。设置连接测试只验证会话建立；实际语音和用户验收证据另见 `docs/p3-acceptance-index.md`。

### alpha16 运行与验收

在设置页分别添加对话和语音提供商。千问语音使用千问 AI 平台 API Key，模型为 `qwen-audio-3.0-realtime-plus`，不是自动沿用其他平台凭据。音色默认 longanqian，也可选择官方音色或填写已有音色标识。当前不提供克隆音色创建。

启用语音通话后，点击标题栏电话或 Composer 麦克风显式启动 Withu-Live。无需按住说话；回答时说话会打断旧回复。Live 在右侧玻璃面板显示 Lumi、电平条、时长和挂断，球与活动面板同为132px。只保存通话时长摘要，不把逐句转写或语音回复写入普通消息。静音不自动挂断；可恢复断网只重建云连接，沿用同次通话已授权音轨；设备故障释放资源并显示错误。挂断、退出和重载清理音轨、Worklet、播放队列及 WebSocket。

```powershell
node checks/realtime-wire.mjs
node checks/volc-realtime-wire.mjs
node checks/realtime-client.mjs
node checks/realtime-desktop.mjs --volc
$env:WITHU_PACKAGE_OUTPUT='output/p3/windows-alpha16-final-20261014'
npm run package:p3
node checks/p3-closeout.mjs
# 仅在允许少量真实云调用且 App 已正常退出时运行，不输出凭据或用户录音：
node checks/p3-real-metrics.mjs --authorized-small-calls
```

上面测试使用虚构凭据和本机协议服务，桌面测试使用合成音频设备；真实声学验收不由这些结果替代。包未签名。下方为历史版本记录，不代表当前实时服务能力。

### P3 增量检查（2026-10-11）

```powershell
npm run check:models:flight    # 测试事件早于 IPC 返回、旧操作、卸载竞态
npm run check:audio:transport  # Rust + 本机 HTTP；虚构凭据/合成 PCM，不申请麦克风
```

文字 adapter 仅对流开始前的 429/503 明确拒绝执行最多两次重试；1s/2s 退避和 Retry-After（秒/HTTP 日期），取消与 60s 总预算覆盖等待。无效或超过 30s 的 Retry-After 明确失败，不缩短服务要求；鉴权、网络歧义、部分输出/断流不自动重放，无跨提供商 fallback。

音频 adapter 独立测试：ASR 上传内存中的 16kHz 单声道 WAV，TTS 接收 24kHz little-endian signed PCM。没有默认模型/声音、音色设计推断、磁盘录音或自动付费调用。生产 Chat 已接入显式短句录音识别与点击朗读；不是自动连续对话或全双工验收。

### 官方提供商与配置 UI 增量

内置40项区域/套餐预设（非40家厂商），参考 OpenChamber 交互及 CC Switch 官方目录；品牌 Logo 离线打包。新增第三方中转商不在本轮范围，已有配置不删除。自定义协议支持 Chat Completions / Responses / Anthropic Messages。API Key可直接输入，眼睛按钮显示/隐藏当前输入，绝不回显已有OS密钥。需专属地址的服务有明确提示。

运行 `npm run check:providers` 检查离线元数据/秘密编辑规则。真实厂商和模型能力仍需用户在正式 App 验证。语音链路审视与后续优先级见 `docs/p3-voice-architecture-review.md`，不将传输fixture当作低延迟/双工验收。

### 模型选择与语音接口测试

默认配置使用“获取模型列表 → 选择模型”，保留手动模型输入；列表来自用户已保存提供商，不等于任务能力已验证。每项“保存选择”可单独保存入口，“保存并测试”先保存当前默认选择再发起真实最小测试，可能消耗API配额。ASR用固定内置英文样本而非麦克风；TTS需选择声音，测试成功后点击播放器试听。MiMo专用chat/completions音频协议与通用/audio协议分开，TTS不要填写ASR模型。Chat 支持显式短句 ASR 写入草稿并由用户确认发送，以及点击朗读已完成的短回复；不自动调用付费语音。

`npm run check:providers:wire` 使用本机HTTP和虚构Key验证目录/音频probe，非真实云端验收。

### Chat 语音与活动回归修复（2026-10-11）

- 麦克风点击开始/结束（最多 10 秒），16kHz mono WAV 送 ASR，识别结果写入可编辑草稿，不自动发送。
- 已完成回复点击“朗读回复”送 TTS，保留返回采样率；有限短句（1000 字、10 秒/240000 samples 上限），超限明确失败，不截断播放、不改用别的服务。
- 切页、切会话、配置替换、隐藏窗口、退出取消请求并释放麦克风/播放；旧结果不写入新会话。
- 接口验证元数据持久化并按 provider/credential revision/model/backend/voice 隔离，不保存测试音频或秘密；旧版临时验证结果无法追回，需要重新测试一次。历史测试成功不保证服务当前在线。
- 发送消息打开活动面板，只在 Chat 渲染；活动来自实际持久化消息及回复运行状态。
- `node checks/chat-voice-wire.mjs`、`node checks/finite-audio.mjs`；桌面套件 `WITHU_CHECK_CONFIG=1` 使用 Chromium 合成麦克风、虚构 Key 和 localhost，非实际设备或云端验收。

### v0.3alpha1（2026-10-11）

模型提供商、默认 LLM 和 ASR/TTS 改为通用页卡片 + 弹窗。语音总开关默认关闭（不清除已有配置），只有启用时显示 ASR/TTS 卡片和消息框麦克风/主舞台电话入口；ASR/TTS 独立开关，电话须两者都启用。短句输入恢复用户授权原 GUI 的 RecordingStrip + 真实 RMS。朗读从 composer 移到回复操作区。助手消息使用 GFM Markdown，禁原始 HTML/远程图片加载，链接由安全外部打开策略处理。Hover 会话侧栏高不透明度毛玻璃，活动用户/助手不同图标。

ball 面板 tooltip 仅“点击互动”，保留点击 spin/指针 gaze；真实短句录音/识别/生成/播放驱动倾听、思考、说话视觉状态，不伪装为心理状态或关系记忆。主舞台左上新建会话 + 标题，旧会话保存；首个回复后使用同一用户配置模型进行一次有界标题总结（可能增加一次 API 请求），失败保留初始标题，无自动无限重试，不以标注内容作指令。标题写回 Server 并同步会话列表，保护并发改名与删除。

电话面板布局完成：隐藏四个活动标签、身份下移、红色挂断按钮；**全双工后端尚未实现，通话面板不启动录音、不调用真实服务、不生成虚假字幕**。现有短句模式与通话不混用。

WAV 解码增加常见 8/16/24/32-bit PCM、float32、mono/stereo、WAVE_FORMAT_EXTENSIBLE 和 8–96kHz；TTS 通用接口接收明确 WAV Content-Type 并保留采样率。未知/坏格式明确失败。此修复不证明用户此前的 ASR/TTS 真实失败已解决，需要用户显式复测。当前不支持 MP3/压缩 WAV、长句流式语音。

版本来源 `VERSION` / `src/version.js` / npm `0.3.0-alpha.1` / Windows `0.3.0.1`，更新记录 `docs/version-history.md`。本次未读真实凭据/未自动云端调用。

### v0.3alpha2（2026-10-11）

帮助入口改为“关于WithU”并提供产品标识/版本弹窗；设置版本移到左下角，恢复提供商弹窗中的“添加提供商”。全局浅色4px滚动条，聊天与设置滚动容器贴右边。录音时加号替换为红色垃圾桶，点击丢弃录音并释放资源，不发起ASR。

聊天标题栏不加下边线，消息靠近顶部时渐隐；新建/电话/活动图标缩小并统一浅色，标题字距略增。开启TTS后，助手消息操作条在“更多”之前显示朗读图标，合成时旋转、播放时呼吸动画，再点可停止合成或播放；不在操作条下方显示额外朗读文本。减少动态效果偏好下禁用动画。

版本来源 `VERSION` / renderer version / npm `0.3.0-alpha.2` / Windows `0.3.0.2`。仅使用虚构Key、localhost与合成麦克风测试；没有访问用户Key或自动调用真实服务。全双工后端尚未实现的限制保持不变。

### v0.3alpha3（2026-10-11）

标题栏缩窄并上移；TTS控制移入标题栏，回复按句子边界自动分段朗读，支持动态图标、立即静音和恢复；切换期间的旧回复不会补读，新回复按 operation ID 建立独立播放队列。关于WithU文案改为 `Powered by WithU`。通用页将模型服务和语音服务合并为带分隔线的分组卡片，提供商按顺序显示为64px方形卡片；消息栏模型菜单可获取目录并保存所选模型，凭据保持不变。思考滑杆展示为未验证/禁用，因为当前模型目录及 server request 尚无已验证 reasoning 能力/effort 参数合同。TTS片段文本通过受限 voice request 传输，仍受1000字符上限和既有取消清理约束。

版本来源 `VERSION` / renderer version / npm `0.3.0-alpha.3` / Windows `0.3.0.3`。本轮仍只使用虚构Key、localhost和合成麦克风验证，不访问真实Key或自动调用真实服务。

### v0.3alpha4（2026-10-11）

设置页放大统一的展开箭头；提供商卡片只呈现Logo并直接进入详情；聊天标题栏将浅色朗读控制放到语音通话按钮右侧。聊天模型列表聚合所有已保存凭据提供商的账号可用模型，并用静态 models.dev 元数据补充能力、上下文/输出限制和发布信息；明确支持 effort 的模型才显示滑杆，档位会保存并随请求传递。自动朗读从首段回复字符到达即开始提交短文本段、继续覆盖完整回复，长句分段且完整/最终事件不会丢失已流式显示文本。

版本来源 `VERSION` / renderer version / npm `0.3.0-alpha.4` / Windows `0.3.0.4`。验证仅使用本地 fixtures、虚构密钥及合成音频，不读取现有密钥或访问真实模型服务。

### v0.3alpha5（2026-10-11）

按 models.dev 增加 Perplexity、NVIDIA NIM、OpenCode Zen/Go、Azure AI Foundry 与 Amazon Bedrock。OpenRouter 保留原有单一预置。Azure 使用 API Key 请求头及用户提供的 OpenAI v1 endpoint；Bedrock 使用 AWS SDK 凭据、Region 内模型发现和 ConverseStream。模型元数据及厂商图标来源见 `docs/sources/models-dev-provider-catalog.md`。Bedrock 的目录不代表账户已启用模型。验证使用虚构 AWS 凭据、localhost fixtures 和隔离数据目录；没有读取现有凭据或发起真实云请求。

### v0.3alpha6（2026-10-11）

承接 alpha5 的删除/模型切换与视觉修复。正式包输出 `output/p3/alpha6-windows`，打包入口会先编译当前 release Server；旧 alpha5 包保留。模型菜单先呈现思考能力（支持时可调），点击模型名箭头展开已有聚合目录；提供商详情含账号、模型筛选和显示/隐藏。设置及弹窗使用留白分隔线，语音/朗读入口固定在聊天主舞台右上角。TTS 合成与播放逻辑按用户决定保持现状。
