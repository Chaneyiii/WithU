# P3 工程验收索引

## 当前状态：P3 精准修复后独立验收完整通过（2026-10-15）

后续中期提交基线已更新为 `v0.3alpha17` Comfort Demo，增量范围与新包见 `docs/demo-acceptance-index.md`；Intelligent UI 纳入 Demo，Cowork 后置的安排见 `docs/demo-release-plan.md`。下方 alpha16 是本轮 P3 修复的原始验收包与证据，保留不覆盖。

本轮修复上一轮独立验收发现的两处问题，并恢复 Rust 格式与严格 Clippy 门禁。独立结论：`E:/Orbit/demobuddy/output/p3/independent-acceptance-repaired.json`，accepted=true。旧退回记录 `output/p3/independent-acceptance.json` 保留，不能用下方历史任务对话的通过结论覆盖本轮修复证据。

实现提交：`8ec0d0b6d8655ba70ac0487994bcef20bd63e8d4`，现有分支 `v0.3alpha16`。运行源码 SHA256：`170637ba34cc03973455dd7d89a6cd21ec4c2d05565de4fd8c85fe3979718e6a`。外部唯一 spec 未修改，SHA256 仍为 `BAC1CC11821873B018F9981B7960CF3178860F2992AEDC28198BBC0CB8606F46`。

修复范围：

- `realtime.rs` 在原始帧与 JSON 解码后检查凭据回显，assistant 流暂存与凭据前缀匹配的尾部，校验 ASR 合并快照、最终文本替换与正式终态；打断/新回复清除暂存状态。阻止凭据经实时 GUI 事件或非 Live 消息历史进入 SQLite，保留 Qwen/豆包正常协议和 ASR 快照语义。
- owner 实时事件仍转发完整 PCM；诊断 `wire` 与 `events` 剥离原始音频，分别最多保留 3000/512 条，事件等待与查询改用绝对 sequence 游标。相关验收脚本同步使用新游标，PCM 正确性在实时监听器中验证。
- 修复已有 PCM chunk、条件分支和多余借用 lint；其他 Rust 文件仅恢复 `cargo fmt` 的格式，不更改产品行为。没有改动 renderer 的界面、球体、通话交互或产品范围。

本轮验证：

- 24 项完整回归全部通过：`E:/Orbit/demobuddy/output/p3/closeout/run-ZG2rwd/results.json`。含 P0/P1、Windows 凭据/CAS、文字与两种语音 wire、P2 完整 15 进程矩阵、新包六个桌面场景、Qwen/豆包包内 Live 与实际新包产品扫描。
- 新增 25 组实时输出边界回归：`E:/Orbit/demobuddy/output/p3/output-safety/run-ZkWD6Z/results.json`。两协议的 Live/非 Live 均覆盖分片凭据、转义 final、ASR 合并字段/final、转义响应 ID、正常输出/终态释放前缀/打断重置/ASR 快照；三次实际本地 Live socket 共 600 个 PCM 帧送达，挂断后两份历史均无原始音频。
- `checks/owner-retention.mjs` 验证 4000 个事件后的容量上限、实时音频完整转发、历史剥离，以及淘汰后的事件等待/已收事件查找；已纳入 closeout。
- 43 个 Rust 单元测试、3 个编译失败文档测试、`cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets --locked -- -D warnings` 全部通过；日志在 `E:/Orbit/demobuddy/output/p3/repair-acceptance/`。最终日志采集首次遇 Windows LNK1104，同目录无代码变更重试通过，失败日志 `rust-tests-link-failure.log` 保留。
- 独立只读补丁复核未发现可确认的绕过或正常行为回归。所有新增修复验证使用虚构凭据与隔离数据，没有读取生产 Key、付费云端请求或重新录制用户音频。

当前新包：[Withu.exe](E:/Orbit/demobuddy/output/p3/windows-alpha16-repaired-20261015/Withu-win32-x64/Withu.exe)，旧包保留。源码/包一致性：`E:/Orbit/demobuddy/output/p3/independent-review/package-match-repaired.json`，131 个 client 源文件、36 个独立重建前端产物、release Server 与生产 package.json 均匹配，manifest 三项哈希通过。新包 Server SHA256：`f37f246640c4a578a947949ab205fcb88a99487aaefa99c630dccc16fc4ee0dc`；app.asar：`6cfa46c23dccbde527caf6bda6df2afcc7b272a8be30444ab2c541bea2ec0342`。

保留用户在 2026-10-14 对界面、实际全双工对话、打断、挂断后的麦克风指示、拔出设备和断网恢复的本人验收。下方真实豆包生成语音/朗读/指标证据仍适用于未改动的协议与交互，不把本轮合成设备测试说成新实机验收。已知限制仍为未签名包、Vite 大 chunk 提示、其他实时协议仅预设、千问独立朗读未支持，以及无跨硬件回声/长时间压力/SLA 结论。3D、本地模型和独立 ASR/TTS 按用户决定取消；P4 未启动。

## 历史：P3 任务对话完成与本人验收记录（2026-10-14）

用户确认：“ok，验证没问题，全双工对话也没有问题”。随后在设备专项提问中确认“都正确”，覆盖说话打断、挂断后麦克风指示消失、设备拔出和断网报错/恢复。设备型号与耳机/扬声器具体选择未提供，不推导全部环境的回声质量。真实通话与专项检查计为用户本人通过；“未配置实时服务”“豆包未接入”不再是待办。

当前范围采用用户最新决定：LLM 与实时语音独立提供商及凭据；千问、豆包实时适配已实现。麦克风和电话统一进入 Withu-Live，仅保存通话时长摘要；文字聊天使用独立 LLM。身份默认 Lumi，尊重自定义名字；消息朗读当前适配豆包，千问独立朗读未支持。本地语音模型、独立 ASR/TTS 配置与安装功能已删除，不作为 P3 待办。

当前包：`E:/Orbit/demobuddy/output/p3/windows-alpha16-final-20261014/Withu-win32-x64/Withu.exe`，未签名；哈希见该输出目录的 `manifest.json`。先提交验收基线 `40fe52c81e5d1f702b6da7624050acdaa4145bfb` 到现有 `v0.3alpha16`，再做本次收尾。后续完成提交由Git历史定位，构建来源另有运行源码摘要。

当前证据：
- 最终22项回归汇总（原始首轮失败保留，P2完整复核另列）：`E:/Orbit/demobuddy/output/p3/closeout/run-w9Hrs5/final-verdict.json`，success=true，包含配置/凭据、文字与语音wire、客户端、P2完整15进程矩阵、包内六场景、千问/豆包包内Live及产品扫描；Rust workspace单元/文档测试日志在同目录`rust-tests.log`。
- 最终包 Electron 实际 Worklet/WebAudio、打断/取消/晚到数据、统一 Live 入口、时长摘要恢复及窗口布局：千问`E:/Orbit/demobuddy/output/p3/realtime-desktop/run-3ubuTr/results.json`、豆包`E:/Orbit/demobuddy/output/p3/realtime-desktop/run-NUMnRT/results.json`，均success=true；使用本地wire与合成麦克风。各目录`fault-resources.json`确认断线重连不重复申请麦克风、设备结束后tracks=ended/context=closed，面板保留到用户挂断。
- P2完整矩阵：`E:/Orbit/demobuddy/output/p2/development-suite-VIj2wp/results.json`；包内六场景：`E:/Orbit/demobuddy/output/p3/desktop-run-w5QlwR/results.json`；两协议各9组wire：`E:/Orbit/demobuddy/output/p3/realtime-wire/run-SPZEYt/results.json`、`E:/Orbit/demobuddy/output/p3/volc-realtime-wire/run-6qUtm5/results.json`。
- 源码/包一致：`E:/Orbit/demobuddy/output/p3/closeout/run-w9Hrs5/source-package-match.json`，比较全部打包client源码与dist文件；package.json仅裁去开发字段，package-lock保留Git不进入包；包内server与release二进制一致。最终回归记录运行源码SHA256 `d44ad293b95ee4037f2f0af38dd31cbaa87423d8746575108f659c6b7b6c2aff`，manifest三项哈希匹配。
- 真实豆包生成语音输入→识别→回答→音频：`E:/Orbit/demobuddy/output/p3/real-synthetic-speech-result.json`，真实云端通过，输入为生成系统语音。
- 真实消息朗读：`E:/Orbit/demobuddy/output/p3/read-real-result.json`，27 音频片段并正常完成，无麦克风请求。
- 用户本人对当前界面与实际全双工对话的通过确认，见本会话 2026-10-14 消息。未保存用户原始音频。

本次修正：可恢复断网沿用同次Live已授权的MediaStream/AudioContext，只替换server socket，不重新索取缺失的点击凭据；配置/鉴权/设备故障仍关闭资源，面板保留到用户挂断。球与活动面板统一132px，删除198px专有覆盖和重复尺寸声明。重连等待中挂断也释放设备并关闭迟到session；客户端负例覆盖此路径。没有新增状态。

真实测量：`E:/Orbit/demobuddy/output/p3/real-metrics/run-LBC883/results.json`。包内release server、豆包1.2.6.1、默认音色、Intel Core Ultra 7 155H/约15.5GiB内存，生成3.010秒16kHz单声道语音后送静音。Comfort/Cowork定稿到首段接收PCM为562.659ms/414.986ms；会话建立2328ms/1237ms；本机输入ACK均值0.587ms/0.468ms，Cowork显式打断ACK0.172ms。服务器采样工作集峰值12.48MiB/12.68MiB，单核CPU平均0.228%/0.881%。两次小样本不推导p50/p95/SLA；收到PCM不等于已听见，ACK不等于停止发声耗时。两模式无逐句历史，shutdown resources_released=true且实际进程退出。

生产程序经“文件→退出Withu”正常退出后，原Withu及包内server进程均不再存在，不靠强杀制造成功。物理麦克风指示由用户专项确认；自动资源与包内进程指标见最终Electron证据，不以合成设备证明物理声学分离。

Electron进程快照在两份最终桌面证据的`process-metrics.json`；它包含Browser/GPU/renderer等进程，单位KiB，来自合成通话及窗口调整后的快照。前述12MiB只指Rust server，不代表整个应用占用。

保留失败记录：首次收尾`run-dtE8FP`中P2 speech_scope失败，独立重跑与最终完整15场景/22检查通过，未放宽scope。最终新包首轮`run-w9Hrs5`再次在P2字幕纠正遇speech_scope超时，单独matrix重跑`development-suite-R3hwaM`通过；最终15场景复核见上方当前证据，旧失败保留。此预览场景的间歇性scope失败原因尚未确定，后续复现仍需跟踪，不以复核通过宣称根因已修复。真实测量首次`run-8BZrqf`因脚本等待不存在的ended事件失败，改为end ACK后验证旧session拒绝输入，最终`run-LBC883`通过；Electron新测试先遇不存在的API及reload丢失监测wrapper，修正测试后通过。不将旧失败改写为成功。

| 原prompt阶段/正文映射 | 最终范围与验收 |
| --- | --- |
| P3.1；R01/R02、§5.5.3/§5.6 | Settings独立LLM/实时语音卡片、可信启动、统一Live、Lumi与19.5:9侧栏；用户视觉通过 |
| P3.2；R05/R07/R09、§4.9 | schema2配置/CAS/重启/撤销、Windows凭据与公共私有分离；实际OS存储及泄漏/失败负例 |
| P3.3；R02/R05/R09、§4.9 | 独立LLM流式终态/取消/拒答/有限重试、server历史和模式边界；15组HTTP wire与既有真实DeepSeek成功 |
| P3.4；R02/R08/R10、§5.5.3 | 千问/豆包WebSocket、Worklet/WebAudio/PCM、打断晚到丢弃、资源释放；实时服务自带chat；本地模型/独立ASR/TTS安装按用户决定移除 |
| P3.5；§6第6步、§7–§8 | 当前源码回归、最终包六场景/两语音协议、扫描/manifest、真实云端测量和用户实机确认；忽略的output/p3存证据 |

已知限制：其他实时协议仅预设，千问独立消息朗读未支持；无克隆/持续学习/联网工具/Laya/长期记忆；无跨硬件回声质量保证、长时间压力测试或性能SLA。包未签名，Vite已有大chunk提示。P4未启动。

以下是历史记录，旧能力与待验结论不覆盖当前状态。

## 历史：alpha16 初次实时语音实现（2026-10-14）

用户授权继续 P3 并打包，维持独立 LLM/realtime 提供商及凭据、删除本地模型的最新决定。本轮未启动 P4，也未配置/下载本地权重。外部 spec SHA256 BAC1CC11821873B018F9981B7960CF3178860F2992AEDC28198BBC0CB8606F46，HEAD 起点 e958368c71954f32f9040f7d4226674649174d2b；承接未提交工作树。配置 schema2，公共操作 schema1，61 schemas。

P3.2–P3.4：千问 qwen-realtime 生产适配器使用服务端持有的 OS 凭据、明确配置快照、Bearer WebSocket 和 session.update。按官方协议输入 PCM16k/输出 PCM24k，ASR text+stash 快照，server_vad 回合检测，取消 response.cancel，无自动换服务。持续客户端采集与流式播放并行；speech_started 清空播放并取消旧回复，迟到 response 音频/文字丢弃。队列、frame、text、session 容量有界；连接超时不因收到无关事件重置。完成转写/回复分别存 server 历史，partial/取消不落正式记录，Comfort/Cowork 同一身份但仅注入当前会话历史。转写纠正校验 message/conversation/version，CAS 更新后结束通话，显式重开采用纠正历史。配置提交成功关闭通话，失败不影响旧连接。停止/重载/设备断开/后端断连关闭音轨、端口、AudioContext 和 socket。

设置增加千问官方五个音色选择，保留自定义标识；不实现音色克隆创建。测试真实 session.updated，仅标“会话已连接”，details.audio_inference_verified=false；不把连接成功等同于识别/播放能力。豆包/OpenAI/Gemini/custom 目前只有独立配置预设，实时适配未实现，明确拒绝开始通话，不宣称全供应商支持。

官方协议来源（2026-10-14）：
- https://platform.qianwenai.com/docs/developer-guides/speech/qwen-audio-realtime
- https://platform.qianwenai.com/docs/api-reference/qwen-audio-realtime/client-events
- https://platform.qianwenai.com/docs/api-reference/qwen-audio-realtime/server-events
- https://www.qianwenai.com/models/qwen-audio-3.0-realtime-plus

本轮证据：
- WebSocket wire 9组：E:/Orbit/demobuddy/output/p3/realtime-wire/run-QMBowV/results.json；真实 localhost socket/auth/header/PCM/取消/重复final/late-drop/历史/转写CAS/配置冲突/断连；虚构凭据，无云请求。
- Electron 实际 Worklet/WebAudio、可信点击、转写预览、打断、重载保留Server PID：E:/Orbit/demobuddy/output/p3/realtime-desktop/run-V9DUju/results.json；合成麦克风，不是物理设备证据。
- 客户端负例及实际 worklet 重采样：node checks/realtime-client.mjs，late acquisition release、ASR 快照、陈旧generation、立即stop/disconnect通过。
- 11配置/Windows凭据：E:/Orbit/demobuddy/output/p3/config-check/run-XoOs65；14 HTTP回复：output/p3/reply-wire/run-DrV3Vy；5目录组：output/p3/provider-discovery/run-rC5LMX。
- service-config/service-isolation、46 provider presets、19 presence、61 contracts、workspace Rust 单元和文档测试通过。
- Electron六场景：E:/Orbit/demobuddy/output/p3/desktop-run-agX8aT/results.json。

最终打包及回归：
- P0/P1 server CRUD/CAS/tombstone/rollback/shutdown：E:/Orbit/demobuddy/output/p1/server-check/run-fRZzG3。
- P2完整15进程speech矩阵：E:/Orbit/demobuddy/output/p2/development-suite-cl5py3/results.json，当前Debug Server SHA256 2145dd04d4f08f2fa066dba41de5bce7f6e6c33d172f31899a8a2b29d8189c97；首轮 acquisition_timeout 场景初始化等待曾失败，单独重跑及完整第二轮均通过，不隐去该失败。
- 最终生产包实时Electron链路：E:/Orbit/demobuddy/output/p3/realtime-desktop/run-toQXFp/results.json，54个真实worklet生成帧、取消及socket释放通过，realCloud/realDevice=false。
- 正式包六场景：E:/Orbit/demobuddy/output/p3/desktop-run-vsLz1S/results.json。
- 正式包设置GUI：E:/Orbit/demobuddy/output/p3/alpha16-settings-evidence/packaged/realtime-settings.png。
- 包：E:/Orbit/demobuddy/output/p3/windows-alpha16/Withu-win32-x64/Withu.exe，manifest.json 记录client/server/archive哈希，仍未签名。Server与本轮release产物SHA256相同：1a22e8035c506e5d1ee145cb398e62e75cbdc45ae0138f6e27c76c6686697c3f；app.asar 44c7cee3073e775a9c4acfe77d936866b530105549ef986a45f43093d5f66aa1。
- 显式 --archive 指向 alpha16 的product-scan通过；前端现有500kB chunk提示仍存在。
- 打包时一次debug rebuild遇使用中的exe锁定，未删除运行产物；相关检查退出后重新编译通过，release独立目录未受影响。
- 用户实机检查见 docs/p3-device-acceptance.md。源码在本轮本地提交；哈希见Git历史，包manifest绑定最终运行内容。

未知/未验收：实际保存的是旧 schema1 ASR/TTS 配置，无实时模型选择；只读检查公共配置结构，没有读取Key值。因此没有调用真实千问，无真实云端端到端/首音延迟/听感/物理麦克风及扬声器回声证明。语音服务自动回复与独立文字LLM是两条调用路径；不把千问语音替换为用户文字LLM，不声称 GPT-live 同等质量、持续学习或物理全双工已验收。P3 不能标完全验收。


## 历史：千问实时语音预设补充（2026-10-14）

新增千问 AI 平台 Qwen-Audio-3.0-Realtime-Plus；官方页面 https://www.qianwenai.com/models/qwen-audio-3.0-realtime-plus 的 API 示例确认模型标识 qwen-audio-3.0-realtime-plus、WebSocket 基地址 wss://maas.qianwenaiapi.com/api-ws/v1/realtime 和 Bearer API Key。配置单独保存模型标识，基地址不含 model 查询参数；后续适配器建立连接时添加模型参数。本轮增加 qwen-realtime 协议枚举及设置预设，仍未接入实际通话。配置契约、表单往返、Rust 检查、Vite 构建通过。当前运行的 alpha15 包未更新。

## 历史：独立实时语音配置（2026-10-14）

用户最新决定优先于外部 spec 中旧共享 LLM/ASR/TTS／本地模型规则：对话与语音分别配置提供商与 API Key；语音统一为全双工实时服务；删除本地模型功能。外部 spec 未修改。起始 HEAD：e958368c71954f32f9040f7d4226674649174d2b；当前为未提交工作树。spec SHA256：BAC1CC11821873B018F9981B7960CF3178860F2992AEDC28198BBC0CB8606F46。Node v26.10.0、Cargo 1.99.0。

对应旧 spec §4.10／§5.5.3／§5.6 与 P3.1–P3.2：配置 schema 2，provider.service 绑定 llm／realtime，独立默认选择和 OS 凭据引用；既有 provider ID 不允许改用途；测试与模型目录拒绝跨服务用途。schema 1 冻结校验器仅供迁移，保留 LLM、config_version 和凭据引用，不把旧语音升格成实时服务。读取不写入，下一次显式保存维持原 CAS／回滚路径。

删除 LocalModels／本地目录／README 资产／安装入口、服务端 local_models 与三个本地管理契约及 IPC；另删除旧 ChatVoice、ContinuousCall 与有限语音任务 worker，旧 voice:request 明确拒绝，不解析实时语音凭据。有限录音／朗读控件从消息页删除，保留通话展示和实时转写消息呈现基础；当前没有云端全双工适配器，不能以已保存／预设声明就绪。原有限 ASR/TTS 测试与下方历史报告不适用于新实时语音能力。

本轮验证：56 schemas 版本／未知字段／IPC 检查通过；3 项迁移／跨用途 Rust 测试通过；11 项 Windows 凭据／CAS／重启／回滚检查通过（output/p3/config-check/run-dvfPkp）；服务隔离负例通过；14 项真实 localhost HTTP 流式文字回复／取消回归通过（output/p3/reply-wire/run-QOUlRJ）；5 组模型发现／用途拒绝／取消检查通过（output/p3/provider-discovery/run-AX8Gy3）；46 提供商预设往返及模型测试事件竞态检查通过；19 项 2D presence 回归通过。全部使用隔离数据／虚构凭据，无付费请求。

Electron GUI 检查：output/p3/realtime-settings-check6/development/realtime-settings.png；独立卡片、虚构语音凭据保存、固定版本、协议未接入提示、返回消息页均通过。Electron 捕获曾出现 UnknownVizError，已使用重试获取实际截图。最后一轮 Rust 单测链接曾遇 LNK1104 文件占用，重试后 3 项测试通过。Vite 与 Rust 构建通过；既有 >500kB 前端 chunk 提示仍存在。本轮未打包，output/p3/windows 仍为旧 alpha14，不能作为新源码验收产物。

未验证：全双工 WebSocket、真实服务鉴权／音频／中断、回声与物理设备、听感／延迟。新增预设不表示这些能力已实现。P3 尚不能宣布完整验收。


本文件只记录实现与证据。产品权威：`docs/product/withu-v3-spec.md`，用户明确决定优先。外部 spec 和源 GUI 均未改写。

## 历史：v0.3alpha12（2026-10-13）

用户最新决定覆盖旧点击说话验收流程：电话入口持续收音、停顿自动发送、回答期间说话即打断。已删除手动通话按钮、字幕输入／发送与 Cowork 重复标题栏；ASR 字幕上置，电平条复用 RecordingStrip，180px／64px、主题蓝色，实际绘制幅度按用户最后反馈减半。普通 composer 语音草稿不变。

TTS 修复：空回复初态不再取消／抑制当前回复，录音与朗读权限清理分离，避免旧朗读组件撤销新麦克风授权；分段缩至 32 字，避免长中文句段超过当前有限音频响应预算。通话播放和持续采集独立；本地播放同步先停再取消后端。短窗口 ASR preview 严格绑定 scope，不修改 transcript revision、不进入历史；仅 final 自动提交一次。MiMo 仍为有限录音接口，preview 不是原生流式 ASR。浏览器 AEC／降噪不能替代物理外放回声证据。

本轮 voice wire：`E:/Orbit/demobuddy/output/p3/voice-turn/run-BYWCKk/results.json`；局部端点检测 `node checks/turn-detector.mjs` 通过；最终通话／TTS 包含在 6 场景包回归 `E:/Orbit/demobuddy/output/p3/desktop-run-SKNtTN/results.json`（末次幅度减半为绘制参数调整，随后重新构建打包）。源／包产品扫描 220／163 文件、图标与 release Server 一致性通过。

本轮真实服务复验停止于 OS 凭据状态 `storage_error`，未发云端请求：`E:/Orbit/demobuddy/output/p3/live/run-cCZDAr/results.json`。配置仍 v30，未替换／清除用户凭据；不能用旧轮云端成功结论声称本轮实机 TTS 听感通过。已打包准备本人验收；原有本地推理与物理声学待验边界仍有效。

## v0.3alpha11 历史实现（2026-10-12）

用户明确确认“验证没有问题，请继续完成P3”，并对现有配置少量真实服务验证回复“ok”。下方旧版“未使用真实 Key／云端”的说明是对应历史轮次，不能覆盖本轮证据。

- 本轮开始 HEAD：`1b983e9df6d015af4c1928484a994b6eb882cdc7`；继承此前 GUI／模型／音频源文件改动与未跟踪授权资产，未回退它们。最终实现提交以本轮 `feat(p3): connect scoped voice calls and local model lifecycle` 为准。
- 当前 spec SHA256：`BAC1CC11821873B018F9981B7960CF3178860F2992AEDC28198BBC0CB8606F46`；外部规范保持原样。工具链仍 Node 26.10.0、npm 12.2.0、Rust 1.99.0、Electron 44.7.0。
- P3.1：最新间距、21px 轨道、模型字号、档位／reset 对齐已由用户确认通过。
- P3.2／P3.3：生产配置／凭据主路径、CAS／撤销与真实协议接入；追加 LLM 系统边界“不诊断、不强迫积极、不制造依赖”；worker 记录实际耗时／首 token，缺少 usage 仍未知。delta 队列有界，溢出终态失败而非完整回复。
- P3.4：电话入口接入 Server 权威 push-to-talk session：可信 main 写 renderer ID，conversation/turn/generation/config/revision 校验；ASR final 不写历史，用户可修改字幕，显式提交一次才写 user message 并启动真实 LLM。TTS 与 LLM 独立有界工作槽，父回复取消 fan-out，拒绝取消后的新 TTS。客户端先停止播放、清队列，再取消后端；静音不追读历史、切页／会话／挂断释放设备。沿用分段合成，未接自然连续全双工／流式 ASR。
- 本地机制：用户提供完整条目后注册、实际下载、取消／暂停、重启恢复、Range 续传、大小与 SHA256 校验、安装、删除；来源不含凭据信息，拒绝路径越界。下载与校验在 worker 上执行、退出可取消。没有用户型号／合法权重／推理后端加载证据，启用明确不可用，不宣称本地推理通过。
- 公共契约仍 schema v1，新增 voice-session-start／voice-scope／voice-session-command／model-catalog-entry／model-action；voice-request 追加可选 scope／parent_reply_id，assistant-message 追加可选真实测量值。config_version 仍原子递增（实际用户验证快照 v30）。59 contracts 全部 required/version/unknown-field 与 IPC parity 通过。

本轮证据（均是本轮实际运行，非旧阶段结论）：

| 检查 | 结果／绝对路径 |
|---|---|
| Windows 凭据与配置 | 11 项通过，`E:/Orbit/demobuddy/output/p3/config-check/run-mrEFWv/results.json` |
| 文字 HTTP/SSE | 14 组通过，`E:/Orbit/demobuddy/output/p3/reply-wire/run-mVEFb2/results.json` |
| voice scope／final／纠正／并发／联合取消 | 通过，`E:/Orbit/demobuddy/output/p3/voice-turn/run-DTuwcS/results.json` |
| 本地下载／取消／重启／Range／校验失败 | 通过，`E:/Orbit/demobuddy/output/p3/local-models/run-dAW7BO/results.json`；仅合成字节，不是模型推理 |
| 目录／音频协议 | 8 组通过，`E:/Orbit/demobuddy/output/p3/provider-discovery/run-e0fOiY/results.json` |
| 实际生产 Comfort 云端链路／取消 | `E:/Orbit/demobuddy/output/p3/live/run-7DYFyO/results.json`：MiMo ASR 728.5ms，DeepSeek LLM 1927.7ms／首 token 1732ms，MiMo TTS 2517.6ms／24kHz；取消 ack 18.4ms（单样本，不是 SLA） |
| 实际生产 Cowork 云端链路 | `E:/Orbit/demobuddy/output/p3/live/run-IU7JWD/results.json`：ASR 743.7ms，LLM 1795.2ms／首 token 1455ms，TTS 2166.9ms／24kHz；单样本 |
| P0／P1 Server／生命周期 | `E:/Orbit/demobuddy/output/p1/server-check/run-6CuaMj`；生命周期命令通过 |
| P2 实际 wire 回归 | `E:/Orbit/demobuddy/output/p2/wire-Iuf3VH`，仍 fake，不作为云端／声学证明 |
| 15 进程语音矩阵 | `E:/Orbit/demobuddy/output/p2/development-suite-sCiO8K/results.json`；本轮最新源与 Server，合成设备 |
| 最终包 6 场景＋通话 GUI | `E:/Orbit/demobuddy/output/p3/desktop-run-e2duMl/results.json`，含录音、释放 tracks、字幕修改一次提交、真实 localhost LLM／TTS、挂断、重启／失败矩阵 |
| 构建／检查 | workspace tests、15 Server 单测、59 schemas、9 GUI boundaries、19 presence、46 presets、finite audio／test-flight 均通过；Vite build 成功 |
| 最终产物 | `E:/Orbit/demobuddy/output/p3/windows/Withu-win32-x64/Withu.exe`；`manifest.json` 记录源产物散列。产品扫描 217 source／160 packaged files、EXE 图标与 release Server 一致性通过；包仍未签名 |

修复过程中发现旧 GUI 删除了 fake SpeechControls 挂载，使 P2 矩阵找不到面板；恢复现有能力门控组件（默认产品 fake 能力为 false），复跑 15 组通过。初次桌面重启测试计入上轮相同测试字幕，改为每轮唯一输入。Rust 链接短暂 LNK1104，未删除／强杀，锁释放后 workspace tests 通过。保留现有 >500kB bundle 提示。

真实服务样本来自仓库已知 synthetic probe WAV，三段接口实际调用用户已配置 DeepSeek／MiMo；没有录制用户声音，没有读取／输出原始 Key，没有保存音频或 wire／文本。专用测试会话结束删除，不改用户 provider／默认配置。

**P3 当前不能标记完全验收。** 实现与云端基础链路已推进到可实机验收；剩余本人麦克风／输出设备／听感／打断／退出指示／声学条件，及待用户提供名单的具体本地推理。操作清单：`E:/Orbit/demobuddy/docs/p3-device-acceptance.md`。没有物理数据时不填 p50/p95、CPU／声学 SLA，不宣称自然全双工。P4 未启动。

## P3.1 历史状态与基线（2026-10-10）

此段与其停止点是历史记录；用户后续已暂时通过并授权继续，当前状态见下方增量记录。

- 范围：**P3.1 GUI 已准备，等待用户本人视觉验收**；不是 P3 完全通过。没有执行 P3.2–P3.5、P4，没有派生代理或其他对话。
- 起始 HEAD：`399560edc37aeeeeff0657486a7d9b1c9004efb2`，起始工作树干净。
- spec SHA256：`4950B5D08E2D6DCE8ECC8B41B2043A601C9F070864EEBEB60CF27091868EE9E2`；当前 v3.4-draft。
- 工具链：Node `v26.10.0`、npm `12.2.0`、rustc `1.99.0 (b940084d7 2026-09-28)`、cargo `1.99.0 (5f94df478 2026-08-27)`。现有锁文件未改。
- 3D 取消决定覆盖正文中的 3D 描述；本轮仅沿用既有 2D，不修改其状态动画/幕布/导航。
- 可审阅 GUI 提交：见 Git 的 `feat(p3.1): add isolated model and voice configuration preview`；后续视觉反馈再做修改。

## 实现与权威映射

| 依据 | 本轮实现 | 尚未实施/证据边界 |
|---|---|---|
| R08/R14、§4.8/§5.5.3/§8.1 | 原 Settings/Connectors 内聚合提供商、新增/编辑/移除、秘密替换/清除的密码输入、高级地址、测试/保存示例；三类模型引用同一个 provider | 仅 fixture 内存。已知服务协议与 endpoint 的真实适配器、正式提交/CAS/凭据存储在 P3.2 后实施 |
| R14、§4.6/§8.2 | ASR/TTS 自动云端优先、显式云端/本地；配置来源/能力/连通性/健康独立显示；鉴权失败不转为无配置，不偷偷改服务 | 后端解析仅无副作用视图函数；没有实际调用 |
| §4.6/§5.5.3 | 普通声音与高级音色分开；只在明确标为示例的支持场景显示高级项；换模型清空能力、声音、设计和思考选择 | 不推断任何真实模型支持高级音色，未接真实声音测试 |
| §4.2/§4.8 | `model-config/view.mjs` 与 `view.d.ts` 固定无秘密显示 DTO v1，`public-config` v1/47 个既有 schema 保持不变；密码表单状态不在 DTO | 非新增 wire contract；真实公共配置/能力 DTO 随 P3.2 明确版本扩展，不绕过现有投影 |
| §5.5.3 | 本地目录/下载、暂停、校验、失败、安装、启用状态示意；管理按钮明确不可用，待用户名单，无真实型号/体积/硬件值 | 无下载器、权重、安装或本地推理证据 |
| R01/R02/R09、§5.5 | 两模式 Composer 共用模型设置入口；移除未验证模型下可误认为生效的思考滑块；未配置仍保留文字；2D 与八态 unchanged | 现有 P2 fake 语音不升级为真实能力 |
| §4.10/§5.6/§6 第6步/§7 | 模型设置与既有 AppSurface/媒体 fixture 不混为已支持能力；真实链路等配置与本人授权后开展 | Laya、记忆、工具、MCP/媒体、主动性不扩入本轮 |

## 本地预览与本人验收

- 启动命令：`npm run preview:p3`。
- URL：`http://127.0.0.1:4175/?models=1#/settings/connectors`。
- 绑定：仅 `127.0.0.1:4175`；用户数据隔离在 `E:/Orbit/demobuddy/output/p3/visual-userData/withu`，不覆盖 P1/P2 预览。
- 开发条件：Vite DEV + `models=1`；生产没有场景选择器、测试写入或虚构就绪模型。
- 示例保存不进入 server RPC/磁盘/浏览器缓存；输入仅应为虚构值，保存/取消/离开页清空密码。状态与默认选择刷新/离页即重置。

简短视觉清单：
1. 原 Connectors 布局、卡片/字段、滚动、浅色/深色与中文/English 文案是否合适。
2. 添加/编辑 provider，虚构密钥的替换/清除/保持及高级地址是否清楚；测试/保存的示例边界是否明显。
3. LLM/ASR/TTS 的提供商、模型、后端与独立健康信息是否容易理解；鉴权失败/不支持/断网/设备异常是否清楚。
4. 选择能力场景，检查普通声音与高级设计；修改 TTS 模型标识后，旧能力和设计应撤销。
5. 本地下载状态是示意而非假目录；Comfort/Cowork 模型入口能打开同一设置；文字与既有 2D 仍可用。

## 本轮命令和证据

- `npm run check:models:gui`：8 个 DTO/form boundary 检查通过。证据 `E:/Orbit/demobuddy/output/p3/gui-component-checks.json`。
- `npm run check`：47 schemas、required/version/unknown-field、IPC、凭据投影通过。
- `npm run build:contracts`：桥接语法通过。
- `npm run check:presence`：19 个现有八态/2D/取消呈现检查通过；不是新语音或用户视觉通过。
- `npm run build` 首次：Windows 拒绝覆盖被 preview 锁定的 `E:/Orbit/demobuddy/target/debug/withu-server.exe`（os error 5）。未删除、未强停。
- 使用 `CARGO_TARGET_DIR=E:/Orbit/demobuddy/output/p3/build-target` 的 `npm run build`：Rust workspace 与 Vite 构建通过；随后最新 GUI 再次 Vite 构建通过。存在 >500 kB chunk 提示，不虚报无警告。
- `npm run check:server`：实际 server CRUD/CAS/墓碑/故障/重启/取消等通过；本轮生成 `E:/Orbit/demobuddy/output/p1/server-check/run-1Kd9mL`（脚本固定 P1 输出，这是本轮新运行，不引用旧报告）。
- `npm run check:lifecycle`：stdio/reload/hide/PID/幂等 quit/EOF/资源退出通过。
- `npm run check:speech:server`：本轮实际 Rust wire 的 partial/final、PCM、迟到/打断/修正/替换/撤权/退出等通过；本轮新证据 `E:/Orbit/demobuddy/output/p2/wire-Z89z9S`，仍为 fake 后端，非真实声学/模型。
- 通过浏览器实际操作检查：鉴权失败场景；替换虚构密码后清空表单并撤销旧能力；能力场景选择普通声音再换模型后高级设计消失。截图 `E:/Orbit/demobuddy/output/p3/screenshots/settings-overview.png`、`provider-key.png`。仅自动自查，不能替代本人验收。

## 未验证与下一道门

真实 provider endpoint/模型能力、OS 凭据失败、API Key/配置 CAS 的真实链路、真实 LLM/ASR/TTS 请求/取消/收费、下载权重、Windows 物理设备/听感/声学、P3 Windows 包均未验证或尚未实施。没有使用任何真实 API Key，也没有为服务消耗配额。GUI 不承诺测试连通或正式保存成功。

**停止点：等待用户本人对 P3.1 的明确视觉通过及继续授权。** 未收到之前只处理 P3.1 视觉修改，不自动进下一阶段。

## P3.1 视觉反馈：统一下拉（2026-10-10）

- 用户反馈：右侧三角离边缘太近，所有同类下拉弹窗统一设计。
- 本轮将模型配置页全部下拉（开发场景、协议、提供商、后端、思考能力、普通声音）切到共用 `ModelSelect`，不再使用系统原生 select 弹窗。
- 箭头距右边 16px；菜单统一 12px 圆角、6px 内边距、选中勾选/柔和背景、主题 token 和细滚动条。Portal 避免被卡片裁切，窗口底部不足时向上展开。
- 支持方向键/Home/End/Enter、Escape、Tab 和外部点击关闭；浏览器实际验证 ASR 后端键盘切到“指定本地”，提供商菜单视觉自查通过。
- 最新截图：`E:/Orbit/demobuddy/output/p3/screenshots/unified-dropdown.png`。
- 构建和 8 项 GUI 边界检查通过，仍有已有大 chunk 警告。P3.1 继续等待用户本人验收，不执行下一阶段。

## P3.2 / P3.3 进展（本人已授权继续）

用户确认：“验证暂时通过，继续任务”。P3.1 为**暂时通过**，不是永久设计锁定；授权继续 P3.2–P3.5，不启动 P4。

续做基线 `58590b0e75f7ac78370dfb2968cd48287bd10899`，工作树干净，spec SHA256 未变。以下是增量工程证据，不将 P3 全阶段标为通过。

### 配置与 Windows 凭据（P3.2 已接主路径，能力验证仍部分）

- Rust Server 权威 public-config/config v1；新增闭合 `config-update` v1 和 `config-test` v1 DTO，public provider 可选 `display_name`。现有 required/version/unknown-field 负例扩至 52 schemas。
- Settings 的正式读写仅由可信 Electron 主 frame + 最小 preload 方法调用；网页 `models=1` 保留 fixture，不接受正式密钥、不进行真实服务请求。
- 本机 Windows Credential Manager（CredWriteW/CredReadW/CredDeleteW）；Withu 每个数据命名空间下随机引用。拒绝读取其他命名空间或其他应用的 Key；不使用 Codex/ChatGPT 登录。
- 更新先创建不可变的新凭据，SQLite 配置和审计同一事务 CAS 提交，失败删除本次暂存凭据。旧引用直到配置提交后才清除；遇清理失败返回 pending，不冒充清理完成。重启/get 在当前 namespace 重试孤立凭据回收。
- Key 不进入公共 DTO、引用不进 export；密码输入保存后清空；Rust 原始 stdio frame 和解析字符串 RAII zeroize。未宣称能够擦除 JS 引擎/HTTP 库的所有内部副本。
- URL 拒绝用户信息、query/fragment、非 HTTPS（明确 loopback HTTP 除外）；HTTP 客户端不跟随重定向。已知 OpenAI/xAI 默认 base URL 由 adapter 补齐；compatible 自定义地址位于高级项。不锁定首发 provider/model。
- LLM 的真实测试是显式最小请求，会告知可能消耗用户配额；没有本人配置的真实服务时只用本机 HTTP fixture。ASR/TTS/高级音色/思考能力不从协议或名字推断为支持，仍未验证。

### 可取消 HTTP/SSE 文字对话（P3.3 基础接入）

- 新增 `reply-start`/`reply-cancel`、server-only `assistant-message` v1，普通用户提交仍严格 role=user，不能伪造 assistant。`reply.updated` 和 `config.tested` 纳入事件枚举。
- OpenAI Chat Completions 兼容 SSE adapter；快照固定 endpoint、模型、Key 和 config_version。只发当前 conversation 的有限近期文字，同一 Withu 系统身份；不跨模式/项目注入、不发送文件内容、记忆、工具或审批。
- 正常默认配置改变影响下次请求；替换凭据、移除 provider 或更换 endpoint/protocol 会取消对应旧工作，绝不在途中改投其他服务。删除会话和退出传播取消。
- HTTP worker 异步，main loop 继续接取消。客户端立刻丢弃停止后的文本；取消实际 drop HTTP stream，迟到输出不会存为完成回复。partial 仅内存；只有 `[DONE]` + `finish_reason=stop` 才原子保存完整 assistant。
- 区分 auth_failed、rate_limited、断流、timeout、refusal、length/工具调用等；不做跨模型 fallback。当前 429 明确失败可重试，尚未实现完整自动退避/Retry-After；未夸大完成该项。
- 同一用户 input 的 durable reply-receipt 防重复请求；新回合必须显式提交。限并发与帧/响应/context 大小；不宣称当前工程值是所有 provider 的统一 SLA。
- UI 两模式共享配置入口/模型标签和流式 reply；支持停止生成；真实回复保存后可重开。统计/计费/token/TTFT 仍无已校验用量数据，不伪填。

### 本轮实际证据

- `npm run check:models:server`：**11** 个实际 Server/Windows Credential Manager 检查，包括真实写读、CAS、restart、清除、移除、DB/audit 无明文、OS 写失败和 SQLite 提交失败后的暂存凭据回滚。最新 `E:/Orbit/demobuddy/output/p3/config-check/run-v7KbY4/results.json`。全部测试值虚构，结束清理 Withu test namespace；初次失败 run-hOdgMZ 的孤立测试 Key 亦已专门清除。
- `npm run check:reply:wire`：**8** 组本机真实 HTTP/SSE fixture 检查：显式能力测试、双模式终态保存、scope/context、鉴权/限流/断流/拒答、连接关闭与迟到、provider 凭据替换取消、删除和 shutdown。最新 `E:/Orbit/demobuddy/output/p3/reply-wire/run-4xqGfB/results.json`。是协议 fixture，不是实际云端模型。
- `cargo test --workspace --locked`（隔离 build-target）：workspace 原有测试通过。新增 `cargo test -p withu-server --locked` 的 Windows OS 凭据 roundtrip/scope 单测通过。第一次单 crate link 临时 LNK1104；未删除测试产物，等待锁释放后同命令通过。
- `npm run check` 52 schemas，`check:models:gui` 8 checks，`check:presence` 19，桥接 syntax 与最新 Vite build 通过；保留 >500kB chunk 警告。
- 最新二进制 `E:/Orbit/demobuddy/output/p3/build-target/debug/withu-server.exe`。没有覆盖正在运行的原 preview `target/debug`。
- 最新二进制 `check:server`/`check:lifecycle`/`check:speech:server` 通过。证据 `E:/Orbit/demobuddy/output/p1/server-check/run-fKSR1C`、`E:/Orbit/demobuddy/output/p2/wire-xmdtmk`（现有脚本路径，均本轮新运行）。后者仍 fake ASR/TTS，非云端/物理声学。
- 实际 Electron 六场景矩阵通过：`E:/Orbit/demobuddy/output/p1/desktop-run-1Nj9LO/results.json`。设置 GUI + 虚构 Key 存 OS + reload 保留 + 清除 provider 的扩展六场景也通过：`E:/Orbit/demobuddy/output/p1/desktop-run-NoVnCt/results.json`（`WITHU_CHECK_CONFIG=1`，测试先后均保留独立 userData）。
- `checks/product-scan.mjs` 已参数化 `--p3`/`--p2`/`--archive=...`，尚未生成 P3 包，故未谎报 P3 包扫描通过。

### 剩余工作（不等于仅等用户 Key）

真实 ASR/TTS adapter 和非 fake speech session 链路、字幕纠错到 LLM/TTS、生产 audio-only 权限、实际后端替换/撤权/设备清理、本地下载/校验/安装通用机制、完整限流重试/用量/性能记录、P3 新 Windows 包及包回归均仍需实现或补齐。P3.2 的全部能力协议/验证与 P3.3 的所有故障/重启恢复验收也未完成。

本人尚未在正式桌面配置真实服务；无真实云模型整链路、权重加载/推理、物理麦克风/听感/回声证据。**P3 未完全验收**，不将当前 HTTP fixture 说成真实服务成功，不用本次进展自动启动 P4。

### 增量收敛与最新证据

- `reply-wire` 最新扩大为 **9** 组：加入分片 Key 回显不能穿过 delta，以及普通默认模型切换不取消/改写旧 config snapshot。最新 `E:/Orbit/demobuddy/output/p3/reply-wire/run-ZSqtkE/results.json`。
- 实际 Electron 配置 + Composer 本地 HTTP 回放六场景通过：`E:/Orbit/demobuddy/output/p1/desktop-run-cW3WpH/results.json`。点击停止后实际 HTTP response close，迟到 terminal 不出现第二条 assistant。
- 首次扩展 Electron 测试被旧 `exported.messages.every(role=user)` 断言阻止；按新增 server-only assistant-message 契约改为只允许 user 或带 operation/config 证据的 assistant。随后 restart 检查误读已有 assistant；改为相对本次起始消息数验证，最终六场景通过。没有绕过产品失败，记录为测试契约更新。
- 最新二进制跑原有 **15** 个独立 fake speech Electron 进程全部通过，证据 `E:/Orbit/demobuddy/output/p2/development-suite-6Jab23/results.json`。`speech-desktop-run` 现在尊重明确 `WITHU_SERVER_BINARY`，不再偷偷固定旧 P2 binary。这仍不是物理麦克风/声学或真实模型证明。
- 同步更新数据导出允许真实 server terminal assistant；删除会话同时 tombstone assistant/reply receipt，仍禁止从 renderer 直接提交 role=assistant。
- 正式页错误映射为普通用户文案，不直接展示 `generation/RPC` 等工程字段。测试态保留明确标识。

检查点只是 P3.2 配置主路径与 P3.3 对话基础，不表示 P3.2/P3.3 全部或 P3.4/P3.5 完成。不再等待 P3.1 授权；后续可沿已有授权继续，不把缺 Key 当成停止代码实现的理由。

## P3.2/P3.3 收敛与 P3.4 传输基础（2026-10-11）

- 继续授权已确认，不重问 P3.1，不启动 P4。续做 HEAD `1b983e9`；spec SHA256 与记录一致；外部产品文档未修改。
- 文字 adapter 对流开始前的 429/503 执行最多两次同快照重试：指数 1s/2s，Retry-After 秒/HTTP-date，拒绝无效或超过 30s 的等待。操作仍受 60s 超时及取消控制；不重试鉴权、网络歧义、部分输出/断流，不跨模型 fallback。
- 能力测试按 operation + provider/model/kind/config 关联。事件早于 start promise 时暂存，收到权威 operation ID 后再显示；忽略旧操作/重复终态/卸载后的返回，不因早到结果重新变成测试中。新增 `check:models:flight`。
- `apps/withu-server/src/audio_api.rs` 实现云端音频传输基础：ASR multipart 内存 WAV/16kHz/mono，TTS user-selected model/voice + 24kHz signed LE PCM；处理 HTTP 分块跨 sample 边界、大小/时间预算、鉴权/限流/格式错误及实际网络取消。不推断音色设计/能力，不自动重试音频，不写临时录音文件。
- **生产 speech session 尚未接入该 adapter**，权限/录音/字幕/LLM/TTS/播放链路和本地模型管理仍待实现。现有 16kHz fixture 播放不能直接当作 24kHz provider 播放，后续需支持其采样率或重采样。未启用用户麦克风，没有真实凭据或真实云调用。
- 官方协议实际读取：[speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text)、[text-to-speech](https://developers.openai.com/api/docs/guides/text-to-speech)，缓存仅在 ignored output/p3/api-docs。官方搜索入口返回 Forbidden；直接指南成功读取，未用搜索摘要推断格式。不照搬文档示例作为默认模型/声音目录。

### 本轮证据

- `check:reply:wire`：12 组本地实际 HTTP/SSE，新增 Retry-After 成功、过长等待不提前重试、等待期间取消后无新增请求。最新 `E:/Orbit/demobuddy/output/p3/reply-wire/run-mENcNc/results.json`。
- `check:audio:transport`：5 个 Rust 本地 HTTP 测试组，覆盖 multipart/请求体、PCM 奇数字节分片/帧顺序/采样率、状态/协议/空输出/资源上限、凭据回显拒绝、drop future 后实际 socket close。`E:/Orbit/demobuddy/output/p3/audio-transport/run-5tPWMh/results.json`。只证明传输，不证明云模型、麦克风或听感。
- `cargo test --workspace --locked` 最终通过；server 7 tests（音频 5、退避 1、OS 凭据 1）通过。首次音频取消测试在 runtime 外创建 timeout，测试自身 panic；移入 runtime 后通过。随后一次 workspace link 遇临时 LNK1104，未删除/强杀产物，重试通过。
- 52 schemas、8 GUI 边界、19 既有状态呈现、桥接 syntax、最新 Vite production build 通过；已有 >500kB chunk warning 保留。
- 最新二进制实际 Electron 配置/Composer 六场景通过：`E:/Orbit/demobuddy/output/p1/desktop-run-eHzRCN/results.json`（原脚本路径，本轮新执行）。生命周期 reload/hide/PID/退出/EOF 检查通过。

P3.2/P3.3 尚有能力恢复/用量/真实服务验收，P3.4 仅传输基础，P3.5 尚无新包/物理设备验收；不声称 P3 全完成。

## Windows 品牌图标与真实 Key 测试入口（2026-10-11）

- 用户指定使用对话“提取图片中的 logo”（01a12671-2394-7962-a1f1-e85ed5d81580）中的最终圆角正方形版本。复制该 SVG 到 client/withu-window/withu-icon.svg，保留原渐变/双环/白色圆角底板，未改写源对话产物。
- 本地 Chromium 将原 SVG 渲染为透明角 PNG；生成 16/20/24/32/48/64/128/256 多尺寸 ICO。窗口/托盘使用同一品牌资源，Windows AppUserModelID 为 com.withu.desktop。
- 新 P3 Windows 包 output/p3/windows/Withu-win32-x64/Withu.exe 嵌入最新 ICO，并使用本轮 release server；未覆盖 P1/P2 包。支持 --withu-model-settings 启动至正式配置页。
- checks/icon-package.mjs 验证 PE 8 个图标像素与源 ICO 完全一致、ASAR 图标与源码一致、任务栏身份/窗口/托盘路径及 release server 一致。资源验证不是任务栏/资源管理器实拍截图。
- 产品清洗扫描通过：161 个源码文件、88 个打包产品文件。新包仍 unsigned；打包成功不等于完整 P3 语音/设备验收。
- 真实 API Key 由用户本人在正式 App 密码框填写并存入 Windows Credential Manager；不要求发送到对话、不主动读取配置里的密钥、不自动调用付费服务。当前可测 LLM 显式接口与流式文字对话；生产语音整链路仍未接入。
- 新包实际 Electron 六场景（normal/restart/malformed/crash/eof/timeout）配置/Composer 回归通过，证据 E:/Orbit/demobuddy/output/p3/desktop-run-KI8Pqa/results.json；测试使用独立数据和虚构凭据。
- 已以 --withu-model-settings 启动正式 Withu.exe：PID 5984，窗口标题 Withu、非零 HWND；子 server PID 13336，路径为新包 resources/withu-server.exe。非 check/fake/网页 fixture，用户自行配置真实凭据；启动后未抓取界面或读取用户输入。

## 提供商简化与语音审视、用户补充 UI（2026-10-11）

- OpenChamber 对照 SHA 09494f3db599b9c81e0eecea86ba16e75cecf362：采用品牌选择/独立 Key/自定义协议思路。其内置目录来自 OpenCode integration.list，不假称仓库本身静态定义全部地址；不集成 OAuth 或读取其凭据。
- 原生文字协议已有 Chat Completions、Responses、Anthropic Messages 的实际本地 HTTP/SSE fixture；不是只改协议下拉名称。Responses 发送 store:false；Anthropic 专用鉴权/version/system/max_tokens；终态、拒答、断流、取消与不重放规则分别处理。
- CC Switch SHA df40d53c36b604e044b4d5b9091aeb961aa56990 官方/cn_official 元数据补充，合并相同区域/协议/地址别名：总共40项区域/套餐预设（不是40家厂商）。保留原有 OpenRouter/SiliconFlow，不新增第三方/聚合转发商或邀请链接。AWS Bedrock 的签名/专属协议、OAuth 服务不是通用三协议，不伪装接通。
- 新增 Kimi Coding、火山/豆包、BytePlus、腾讯、百度、阶跃、KAT-Coder、Longcat、百灵、小米等官方品牌及套餐。KAT-Coder 必须填写专属 endpoint，不能仅 Key；其他预设仍需用户选择模型并验证。预设是离线便利元数据，不是健康或厂商能力证明。
- Logo 从上述固定 commit 提取，本地打包，不远程加载；保留 MIT 许可证及商标 NOTICE。40项均有 Logo，网页观察无加载失败。
- 新建 Key 输入立即可编辑；编辑已有 Key 留空保持。眼睛按钮只切换当前输入的 text/password，不读取 OS Key；切换提供商/关闭/保存/清除后恢复隐藏。
- Field 改为独立 label 与容器，避免包裹多个按钮触发原 combobox 导致点击添加后误选品牌。各输入和 combobox 有名称；下拉菜单同一设计，滚动条22%文字色混合透明（亮色实际alpha约0.129），细条不抢眼。连接器页隐藏页面滚动条且保持滚动、宽度与其他设置一致。
- 图标内环主体等比例放大15%，底板与源 logo 文件不变；PE/ASAR/窗口/托盘资源通过验证，不冒称任务栏/资源管理器实拍验收。
- 语音审视见 [p3-voice-architecture-review.md](p3-voice-architecture-review.md)：生产三阶段仍未接通，先正确性/统一回合取消/采样率，再流式ASR/句段TTS/时长背压/指标，最后物理声学。此轮未实施语音整链路、未用真实Key/云调用/麦克风。

### 最新后端证据

- Rust server 8 tests通过；14组 reply HTTP/SSE：output/p3/reply-wire/run-hfIMXK/results.json。
- Windows凭据/CAS11项：output/p3/config-check/run-Or3ItU/results.json；40预设与8 GUI边界、52 schema、事件竞态通过。
- 先前16预设的新包六场景：output/p3/desktop-run-9FeMc8/results.json；40预设/眼睛按钮新包证据在后续记录，不与该轮混淆。
- 初次 debug build 未设隔离 CARGO_TARGET_DIR，旧 preview 锁住 target/debug/withu-server.exe 导致拒绝访问；未强杀用户/preview，改用 output/p3/build-target 后构建与测试通过。显隐更新导致旧源码测试固定 type=password 断言失败，更新为默认false、动态type和显隐断言，保留桌面真实交互覆盖。

- 最终40预设/Logo/眼睛显隐的新 Windows 包六场景全部通过：output/p3/desktop-run-rUuTxP/results.json。含虚构 Key 显隐保持值、重新编辑不回显、实际 OS 保存/reload、行宽和无可见页面滚动条检查。最终产品扫描184源码/131打包产品文件通过，PE图标和release server匹配；Vite大于500kB警告仍保留。

- 最终正式App启动PID34176，子release server PID34100。初次隐藏启动未得到可见窗口，随后正常启动利用single-instance打开原窗口；未读取正式配置或用户Key。

## 模型获取与 ASR/TTS 显式测试（2026-10-11）

- 模型标识改为“选择模型”。显式“获取模型列表”通过新增 versioned withu:models:list 发起 authenticated GET /models，由Server读取OS凭据；原生Anthropic x-api-key/version，其他Bearer。不在renderer持有Key、不用其他App认证。列表去重、2000项/1MB限额、只投影ID/已知MiMo任务标签，不把目录当能力证明。分页has_more明确提示部分列表，保留手动输入。
- 同一有界Replies worker用于目录与音频probe，操作ID/provider/config/kind快照、真实socket取消、退出/凭据替换取消共用；主stdio不等待HTTP，不自动重放音频或目录请求。事件仍config.tested且标注discovery，不改变对话记录。
- 三项均有“保存选择”和“保存并测试”，后者先CAS保存当前默认选择再使用新版本快照。ASR不再一律禁用；TTS必须显式选声音，无自动默认。
- MiMo官方文档通过 https://mimo.mi.com/llms.txt 定位并读取 [models](https://mimo.mi.com/static/docs/api/model/list-models.md)、[ASR](https://mimo.mi.com/static/docs/api/audio/Speech-Recognition.md)、[TTS](https://mimo.mi.com/static/docs/api/audio/tts.md)。MiMo音频不是通用/audio接口：ASR chat/completions input_audio WAV Base64，TTS assistant目标文本/audio.format=wav/voice、非流JSON音频响应。仅api.xiaomimimo.com/v1使用专用adapter，不按品牌名或模糊后缀发凭据。
- MiMo ASR限定mimo-v2.5-asr；普通TTS限定mimo-v2.5-tts，误填ASR/声音克隆/设计型号报任务不匹配，不假装支持高级功能。文档声音列表可选但仍待真实接口验证。
- ASR用App自带固定英文样本，Windows本机Zira语音生成、16kHz/mono，无麦克风/私人录音；返回内容须匹配关键语句才能ready。TTS固定短句返回PCM或MiMo WAV，格式/时长/非静音/1MB线路预算校验；返回音频仅内存proof，播放器需用户点击，不自动发声，不保存历史。
- 通用兼容音频用既有/audio/transcriptions及/audio/speech；原生Messages未音频适配会明确speech_protocol_unsupported。不能声称所有兼容厂商都支持语音。接口测试不是生产语音闭环/声学/延迟验收。
- 保留用户生产数据，本轮未读取真实Key，未调用真实服务。用户已从托盘退出旧版后才更新打包。

### 证据及修复过程

- 11 Rust server tests包含两种MiMo真实本机HTTP JSON wire和WAV/任务校验；6组目录+音频fixture output/p3/provider-discovery/run-Xd43xX/results.json，14组文字fixture output/p3/reply-wire/run-ze4Stb/results.json；11OS配置 output/p3/config-check/run-Z59r3k/results.json；53契约/8GUI/竞态检查通过。
- 开发Electron六场景包含真实目录GET与dropdown选择、ASR/TTS保存与测试、voice保存和audio元素：output/p3/desktop-run-JvLaw6/results.json。
- 首次目录check清理误用不存在的owner.shutdown，修正为正式shutdown并等待退出；首次GUI测试被Field覆盖手动input aria-label阻止，修复Field尊重显式标签；随后check沿用旧config版本清理触发CAS冲突，改为读取最新测试配置后清理。未修改生产CAS或绕过失败。Windows测试链接临时LNK1104，未删产物/强杀，等待后最终11tests通过。

- 最终Windows包含模型获取/选择及ASR/TTS保存与测试的六场景全通过：output/p3/desktop-run-XuVB2x/results.json。产品扫描187源码/132打包文件、图标及release server匹配检查通过。仍unsigned；保留Vite >500kB warning。

- 正式新版App PID32984以--withu-model-settings启动。保留生产配置，不读取密钥或截图真实输入；真实模型获取/接口测试等待用户显式点击。

## 2026-10-11 Chat ASR/TTS、验证状态与活动面板修复

根因：Composer 麦克风为设置占位；验证仅组件内存；App activities 固定空数组、send 未打开面板、渲染未限制 Chat。

已修复：有限短句录音 ASR 到可编辑草稿、显式短回复 TTS 朗读；通用 Audio/MiMo 实际协议复用、采样率正确、windowed sinc 降采样、10 秒输入输出限制/1000 字 TTS 上限；取消真实 HTTP，切会话/路由/配置/隐藏/退出释放资源并丢弃晚到结果；scoped verification metadata 持久化（无音频/key），未改配置保留、更换凭据引用/model/backend/voice 失效；发送自动开面板、仅 Chat 显示、实际消息和生成/失败/取消活动。

证据：
- `output/p3/provider-discovery/run-qb17TR/results.json`：8 组发现/probe+生产 Chat ASR、实际 LLM 后 TTS、消息归属/取消、持久验证与 credential/voice 失效。
- `output/p3/desktop-run-mihIYx/results.json`：开发 Electron 6 场景，合成麦克风可信点击/worklet→ASR 草稿、真实 localhost TTS、返回设置验证、活动规则。
- `output/p3/desktop-run-K9uWIp/results.json`：正式包 6 场景，相同测试 + 录音 stop/切页真实 MediaStreamTrack ended。
- `output/p3/reply-wire/run-Rhystt/results.json`：14 组文字 HTTP。
- 54 contracts、11 Rust 单元、test-flight、finite-audio 降采样 anti-alias/边界 PASS。

未使用真实用户 Key/麦克风/付费服务。未证明云端和物理设备，不声称全双工、流式低延迟或自动连续语音完成。旧版临时测试结果无法迁移，新版重新显式测试一次后持久化。配置/凭据保留。保留 bundle >500k warning 和未签名包限制。

## v0.3alpha1 通用设置/语音 GUI 与聊天增量

本轮实现 1–6、9–11 的设置和 GUI 需求；7 分开短句/电话模式；8 电话面板布局完成，但全双工/自动字幕链路未实现，面板明确未接入，不可视为语音通话验收。

- 通用页提供商/LLM卡片弹窗，语音总开关 + 独立 ASR/TTS 开关与卡片弹窗；语音关闭保留配置且隐藏麦克风/电话；电话只有双启用可打开。
- 原授权 GUI `E:/museee/GUI/source/src/components/RecordingStrip.jsx` + CSS 恢复，50ms真实电平；没有迁入其他项目的 AGPL 组件。
- GFM Markdown + HTML/远程图片不执行；朗读回复置于 assistant 操作区。
- 用户/Withu活动图区分，高不透明度hover glass；面板ball提示点击互动与真实短句状态presence视觉接线，spin/gaze保留。
- 主舞台左上新建/标题，首回复后同模型总结有界上下文写回列表；新增 title job 不写消息，不跨会话，删除/凭据变更取消。
- WAV 宽格式支持（PCM8/16/24/32、float32、stereo、EXTENSIBLE、8–96k）；12 Rust 测试通过，不宣称真实厂商失败修复。
- `output/p3/desktop-run-BVLZtc/results.json` 开发 6 场景；`output/p3/desktop-run-n1kcpR/results.json` 最终正式包 6 场景与 alpha-results/screenshots。测试 uses synthetic Chromium mic + local HTTP + fictitious Keys；包含模型标题、旧会话保留、电话 gating、Markdown、strip、ASR、LLM、TTS。

故障记录：新测试初版空 view fixture version、窗口隐藏许可、首屏GPU截图、录音acquiring timing先后修正；旧 reply suite 因标题CAS递增导致删除version假设失效，改为读当前版本；App发送更新会话亦读取最新版本。最终14组 reply wire `output/p3/reply-wire/run-h1GEdE/results.json`、8组 voice wire `output/p3/provider-discovery/run-rPMJiW/results.json` PASS。bundle >500k warning/unsigned限制保留。旧版临时验证不可恢复，新版历史验证metadata与用户配置仍保留。

## v0.3alpha2 设置与聊天细节

关于WithU弹窗、版本移到设置左下角、恢复添加提供商；全局浅色4px滚动条与聊天/设置贴边容器；录音红色垃圾桶取消，不发ASR且tracks ended。标题栏最终按用户补充取消下边线，消息顶部渐隐，三个浅色小图标和略增标题字距。TTS图标放在消息工具条更多前，合成旋转、播放呼吸、再次点击取消/停止，状态仅供辅助技术读取，不额外显示下方文字。

证据：开发六场景 `output/p3/desktop-run-7xWzYz/results.json`；打包六场景 `output/p3/desktop-run-y5HqDE/results.json`，包含生成中取消后晚到结果不播放、播放动画/停止及正常播放结束。54契约、finite-audio、test-flight、199源码/145打包产品文件扫描、EXE/ASAR图标与release server一致性通过。虚构Key、localhost、Chromium合成麦克风；未访问用户Key/物理设备/真实服务。测试长PCM初版全零被正常拒绝，fixture修正为非零PCM后通过，未放宽生产校验。

产物暂存 `output/p3/windows-alpha2-staged/Withu-win32-x64/Withu.exe`；尚未替换正式安装目录或启动生产App，等待用户确认托盘退出。全双工仍未实现，unsigned与bundle >500k警告保持。

## v0.3alpha3 自动朗读与模型选择

- 标题区域高48px，上移可见内容；About 副标题 `Powered by WithU`。
- 通用设置模型服务/语音服务使用分组容器和分隔行。提供商按配置顺序显示64px方卡；点击进入模型配置弹窗，可见系统凭据库中“已保存/未设置”状态（不读取或回显密钥）及供应商目录。
- 消息栏模型按钮现在可显式获取模型目录并保存选择；仅更新默认 llm provider/model 引用，原凭据不变。思考能力范围控件显示为未验证、禁用：目录没有reasoning能力证据，server请求合同也没有effort参数，故不能声称该设置生效。
- 打开TTS后，新回复按标点/换行分段请求当前已配置TTS，分段音频串行播放；标题栏静音会清空排队内容并取消当前请求/播放。解除静音不会追读当前或历史文本，下一条operation ID的新回复才进入播放队列。TTS调用仍是分段完整音频HTTP，不是provider websocket/音频字节的真正实时流式传输，且受1000字符与每片短音频约束。
- 开始静音会显式解锁本地AudioContext；不触碰物理设备或云端测试。

证据：开发桌面六场景 `output/p3/desktop-run-pD4xeZ/results.json`，打包六场景 `output/p3/desktop-run-igeFaE/results.json`。包含自动TTS请求、合成中静音、晚到音频抑制、取消后解除静音不重读、下一条较短新回复按 operation ID 重置分段偏移、目录选择+持久保存且不替换凭据。Rust 12单测、54契约、40提供商预置、有限音频处理通过；EXE/ASAR图标一致，release server散列一致；200源码/146打包产品文件扫描通过。未使用真实Key、物理麦克风或付费服务。全双工仍未实现，release unsigned，Vite bundle >500kB warning 保留。

产物暂存 `output/p3/windows-alpha3-staged/Withu-win32-x64/Withu.exe`。当前正式 Withu v0.3alpha2 可能仍在运行；本轮没有覆盖正式目录或读取用户配置，等待退出确认后再安装/启动。

## v0.3alpha4 聚合模型与自动朗读

- 模型服务与语音设置保留通用页的分隔行卡片结构；展开按钮增大。provider 卡片只显示 logo，无选中黑框；点卡片直接进入该 provider 的账号/模型详情，添加入口独立保留。
- Chat 标题栏电话右侧为浅色 TTS 静音/恢复按钮。
- `models-dev-catalog.json` 按 `https://models.dev/api.json` 获取，包含 14 个 Withu 内置 provider 的完整 model metadata。Chat 菜单按配置 provider 拉取真实账号模型目录，再叠加元数据；只在目录标识匹配时展示上下文/输出与 reasoning effort。effort 设置保存进 config，并在 OpenAI Chat Completions、Responses、Anthropic 请求体分别映射。没有真实 provider 调用验证，服务端参数映射有本地 Rust 单测。
- 自动朗读在第一段 delta 可用文本到达后立即发起合成，句子/短段顺序播报，长段切分以满足音频请求边界；完成事件短于已收到的 delta 时保留完整流式文本。隔离 Electron 测试还原完整回复所有文本的分段输入，并验证静音取消、解除静音不补读。该方案通过分段 TTS 请求覆盖流式文本回复，不是 provider 音频帧级实时流。
- `cargo test -p withu-server`: 13 tests PASS；`npm run check`: 54 schemas PASS；Renderer production build PASS；隔离 Electron 6 场景及 alpha UI fixture PASS。`output/p3/desktop-run-OiQeBy/normal/development/alpha-results.json` 为 UI 证据。所有测试 `realKeys:false`, `realCloud:false`。
- 真实 Withu 安装实例未替换或关闭，用户已有配置/Key 未读取。正式打包和启动待用户退出托盘实例后进行。

## v0.3alpha6 接续修复与正式包验收（2026-10-11 UTC+8）

用户要求：六项 GUI/配置/打包修复；用户明确暂停 TTS 逻辑变更，本轮保持已有按段合成行为，未接入双向流式 TTS 或全双工电话后端。

- Server：打包前由 cargo 编译 `output/p3/build-target/release/withu-server.exe`，失败即停止打包。独立输出 `output/p3/alpha6-windows`。包内 Server 与本轮编译产物 SHA256 一致：`d6638622ec444dd725e034574f4dc3922ad895ebdb3fc6e31a12b94a5741aac8`。
- 配置：正式包 GUI 实际删除当前提供商、清理默认模型引用；消息框实际切换到另一模型，保留凭据。
- 视觉：主舞台右上角语音/浅色朗读；先思考能力再点模型名展开现有聚合目录；账号/可用模型与过滤、持久显隐；设置大卡片和弹窗分行留白分隔线；Chevron SVG 居中。
- 配置/Windows 凭据 11 项：`E:/Orbit/demobuddy/output/p3/config-check/run-bzb4Dt`。
- discovery/audio probe 6 组：`E:/Orbit/demobuddy/output/p3/provider-discovery/run-jnoFiE`。
- reply wire 14 组：`E:/Orbit/demobuddy/output/p3/reply-wire/run-JyXKJs`。
- model-test-flight：事件/承诺顺序、scope、迟到操作、销毁检查通过。
- 最终正式包六场景（normal/restart/malformed/crash/eof/timeout）：`E:/Orbit/demobuddy/output/p3/desktop-run-eJnXTI/results.json`。GUI 截图与 alpha-results 位于 normal/packaged；restart 也重复执行 GUI 功能检查。
- 初版开发重启 GUI 检查读取上轮旧消息，改成测试开始建立独立新会话；筛选测试改用 React 受控 input 的 native setter，最终正式包通过。
- 产品名称扫描允许 models.dev 中具体的 Meta Muse Spark/Glimmer 型号与 family 元数据；不删除真实第三方型号，也不放宽旧产品 API/品牌检查。
- 验证只使用隔离目录、虚构 Key、本地 HTTP 与合成麦克风。没有读取真实 Key 或调用用户云服务，不将本轮回归视为真实云服务/物理声学验收。包未签名；Vite chunk 大小警告仍存在。

## v0.3alpha7 参数/滑杆/图标增量（2026-10-12）

- 重新获取 models.dev API，更新原有 provider 范围的目录；以其 api 精确匹配 provider 端点，修复 MiMo/腾讯与区域/套餐项缺失。共享模型只有能力字段一致时才回退匹配，未知型号不虚构参数。
- 模型详情与聚合目录显示模型上下文、最大输出、模态、reasoning/工具能力、每百万 token 价格，标注 models.dev 来源。MiMo 为 toggle 能力，没有 effort 档位，界面明确说明；本轮未接新 thinking toggle 协议。
- 恢复 P1 原有蓝色 effort-slider、effort-ticks、圆形滑块和 reset 交互；实际档位从 models.dev reasoning_options 来，不保留六档假设。
- 右上角语音/朗读采用授权源 Meta PhoneHandsetOutline、SpeakerHiOutline、SpeakerSlashOutline。Apple SF Symbols 官方页面已检查，最终采用现有授权 Meta 资源。
- TTS 按用户要求沿用既有首段开始/流式切片、静音取消与迟到丢弃，不改合成策略。
- Vite build、46 provider presets 与生产包产品扫描通过；包 `E:/Orbit/demobuddy/output/p3/alpha7-windows/Withu-win32-x64/Withu.exe`。
- 正式包六场景及 alpha GUI：`E:/Orbit/demobuddy/output/p3/desktop-run-mQ7FhS/results.json`。仅隔离虚构凭据、本地 HTTP 和合成麦克风；已有用户配置沿用，未调用真实服务。

## v0.3alpha13 本地语音设置 GUI（2026-10-13）

用户本轮明确先改设置 GUI，暂不配置 GLM-4-Voice。

- ASR/TTS 开关默认对应内置 GLM-4-Voice 套装，显示待部署；套装不进入自定义模型列表。
- 自定义设置展开两张并排分割线卡片。ASR：SenseVoice、Paraformer Online、Confucius4-R2T2；TTS：VoxCPM、CosyVoice、IndexTTS。点击名称打开官方 README 简介（中文摘要）及原文入口，安装按钮准备 Cowork 新对话与草稿。
- 本轮不执行权重下载、依赖安装或部署；Cowork shell/tool 执行链仍未接入，不能声明按钮已自动安装。旧通用权重导入表单与模型选择表单从本轮 GUI 移除，保留 server 管理机制。
- 云端语音暂关闭，生产语音明确返回 local_backend_unavailable；本地推理未验证。保留用户现有凭据、云端模型引用与文字模型功能，不以云端历史证据替代本地验收。
- ASR 临时识别文本以带下划线的编辑消息展示，final 提交后清除。通话电平条半幅保持不变。
- 官方来源于 2026-10-13 核对：github.com/QwenAudio/SenseVoice、github.com/OpenBMB/VoxCPM、github.com/QwenAudio/CosyVoice、github.com/index-tts/index-tts；Paraformer 为 modelscope.cn/models/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online。原文留在忽略目录 output/p3/local-sources，未猜测权重大小或硬件参数。
- 包：E:/Orbit/demobuddy/output/p3/windows/Withu-win32-x64/Withu.exe，未签名。本轮只是设置 GUI 验收，不宣称 P3 本地语音或完整实机验收完成。

- 补充用户要求：ASR/TTS 开关旁的三角在原位展开已下载模型选择列，不弹窗。仅显示目录 state=installed 的对应任务模型，选择以 speech_preferences.local_model_ref 原子保存；默认 GLM 套装始终保留但标待部署。安装文件事实不代表推理就绪。
- Confucius4-R2T2 官方 master/README.md 已核对（2026-10-13），属于基于 Qwen3-ASR 的稳定前缀流式识别，简介只陈述官方设计，不把官方延迟数字作为 Withu 实测结果。

- 最终 GUI/包检查：npm run check（59 schemas）、Vite production build、P3 app.asar 产品扫描通过；包六场景证据 E:/Orbit/demobuddy/output/p3/desktop-run-6WQI1O/results.json。新版 alpha GUI 检查含 3+3 并排卡片、简介弹窗与 Cowork 草稿创建，使用隔离虚构服务/凭据，无真实权重或设备验收。

- 最终 alpha GUI + 六场景全部通过：E:/Orbit/demobuddy/output/p3/desktop-run-nIP4Ud/results.json；GUI 证据 normal/packaged/alpha-results.json。模型切换检查在安装草稿验证后重载回独立 Comfort 测试，避免 Cowork 控件被旧选择器误读。

## v0.3alpha14 README 全文与 Cowork 白屏修复（2026-10-13）

- Cowork 空会话白屏根因：asrPreview 为 null、chat.id 为 undefined 时，旧 optional-chain 比较为真，随后访问 asrPreview.text 抛错。现在先检查 preview.text，再比较会话 ID。Electron 回归从空 Cowork 模式切入，保留独立截图，未用已有安装对话掩盖空会话问题。
- 本地模型卡片删除重复 border-top，保留设置页统一 inset 分割线。安装及标题旁仓库按钮采用主题色蓝色填充和阴影。GLM 文案统一为默认/默认模型。
- 全文来自官方仓库与模型页面，打包在 client/withu-renderer/src/model-config/readmes，sources.json 保存来源 URL 和 SHA256。SenseVoice/VoxCPM/IndexTTS/Confucius4-R2T2 提供官方中英文全文。CosyVoice 默认中文为本轮人工翻译，界面标明翻译来源、保留官方英文；Paraformer 保留指定魔搭模型卡中文全文，按用户决定不翻译英文。代码、表格值、引用保留，文档内容不是执行授权。
- README 渲染使用 Markdown/GFM 与 HTML sanitize；链接经外部浏览器入口打开，不运行文档脚本、命令或 iframe。图片/音视频以说明占位，原始资源在仓库查看，不改变原始正文。
- npm run check：59 schemas PASS；Vite build PASS（既有 chunk 警告）；正式包 alpha GUI + 六场景 PASS：E:/Orbit/demobuddy/output/p3/desktop-run-iauvLn/results.json。证据 normal/packaged/alpha-readme.png 与 alpha-cowork-switch.png，全部为隔离测试数据。
- Windows 包 E:/Orbit/demobuddy/output/p3/windows/Withu-win32-x64/Withu.exe，版本 v0.3alpha14，仍未签名；没有下载/部署语音权重或启用本地推理。

### alpha14 README 展示清理与图片（2026-10-13）

展示层去除 YAML front matter 与开头 README 语言导航，保持原文文件及 provenance SHA256 不变。README Markdown/HTML 图片解析官方文档相对地址，HTTPS 图片允许显示，魔搭相对文件地址映射模型文件接口；视频不提供播放。AI 回复仍使用独立 MarkdownMessage 图片占位。构建与文档清理/URL检查通过。隔离 alpha 正常场景通过，重启场景在既有录音按钮 focus boxShadow 断言失败，不宣称全部回归通过。证据 E:/Orbit/demobuddy/output/p3/desktop-run-HpHBtY。
