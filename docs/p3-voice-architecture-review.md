# Withu P3 语音链路审视（2026-10-11）

## 2026-10-12 实施状态

下文为历史差距与当时实现快照。当前 v0.3alpha11 已接入生产 Server 权威语音 session、字幕修改后显式单次提交、LLM 与分段 TTS 并行工作槽、联合取消与迟到结果隔离、有界文本／朗读队列。Comfort 和 Cowork 的现有配置真实 ASR／LLM／TTS 小样本均通过，详见 `docs/p3-acceptance-index.md`。这些样本使用合成输入；物理设备／听感／退出指示仍待本人验收。流式 ASR、自然连续全双工、按时长背压与物理性能统计尚未验证，本地具体模型仍待用户条目、合法权重和推理适配器。

## 原审视结论（修复前快照）

当前 Withu 有可复用的 **生命周期／取消／旧回合隔离基础**，但没有接通生产录音→真实 ASR→LLM→真实 TTS→播放链路。因此目前不能证明生产语音稳定性、首声延迟、全双工打断、回声分离或自然连续对话。文字 HTTP/SSE 和音频 HTTP 适配器的本地测试，不是云模型／声学验收。

用户指定参考：[全链路 AI 对话系统架构解析](https://dcheric.github.io/2026/04/10/AI-Dialogue-Flow/)。本文把该文章当作架构讨论材料，不把其中参数、供应商功能或型号判断当作已验证产品事实。产品权威仍为外部 withu-v3-spec 与用户决定；不引入 P4、工具执行、RAG、情绪推断或长期关系记忆。

## 逐层差距与改进

| 模块 | 当前源码事实 | 稳定性／延迟缺口 | 改进与验收方向 |
|---|---|---|---|
| 采集与格式 | capture-worklet 按比例抽样，800 samples/16kHz 一帧（50ms）；getUserMedia audio-only；采集积压超过约 12 个请求触发 device_failed | 抽样无抗混叠滤波；最后不足一帧尾音无显式 flush；背压以请求数而非音频时长；没有设备格式协商 | 抗混叠重采样、尾帧 flush、格式与时钟记录；按 buffered_ms 限制队列。覆盖 44.1/48kHz、短音尾音、设备中断、慢 consumer |
| VAD／终点 | fake session 使用固定 energy² 阈值 2500，仅发起点事件；结束来自显式 capture_end | 不是声学 VAD，也不是动态终点检测；无法排除环境噪声／播放回声；无前滚缓冲或滞回 | 先保留点击开始／结束的保守边界；接口化端点检测，后续验证神经／传统 VAD、noise floor、hysteresis、pre-roll、静音窗口及最长回合。无需先行下载未知模型 |
| ASR | fake partial/final/revision；audio_api 为有限 WAV 上传后 JSON final，不是连续输入流式 ASR | 首字必须等待收音完成；无生产 partial、final timeout、断连恢复；不宜对所有兼容厂商假设实时协议 | 正式流式 ASR adapter；session/turn/generation/revision 绑定；final 去重；结束后等待 final 的独立预算；失败明确呈现，不偷偷换服务 |
| 回合调度 | fake Session 有状态、generation、renderer/config/revision 校验；独立 Replies worker 可实际取消 HTTP | fake provider_complete 发固定回应并启动 FakeTts，没有真实 ASR→LLM；输入修正未驱动生产取消／替换；没统一 owns ASR/LLM/TTS 的 parent operation | Server-owned TurnCoordinator：一个回合 owns 三阶段工作；final 一次提交；修正取消依赖 revision 的子工作并显式重启；任何 late callback 先检查 scope。拒绝自动重放已收费／已播请求 |
| LLM | 流式 SSE、有限本会话文字、60s 总预算、1s/2s 限流退避、最多两次明确 429/503 拒绝重试；取消 drop 连接 | 60s 是硬上限不是低延迟控制；缺 TTFT、stall deadline、用户可见阶段进度；对语音而言 1–2s 退避可能明显不舒适 | 区分连接/首 token/流闲置/总预算；语音等待时提示故障并允许用户主动重试；不直接继承长文字请求策略。HTTP client/连接池复用需保留快照和不跟重定向策略 |
| LLM→TTS | 尚无生产接驳；TTS HTTP adapter 可流式收 PCM，但输入仍是一段完整 text | 等完整 LLM 结束再 TTS 会串行叠加延迟；不能每 token 一次 TTS 调用 | SentenceChunker：自然句界 + 最短/最长片段 + 最大等待；中文英文/数字/缩写/代码块规则；有界合成队列、片段顺序；不因 partial 修订把错误内容读给用户 |
| TTS／播放 | audio_api PCM 为 24kHz、3200 samples/帧（约133ms）；现有 fake 播放只接受16kHz，20ms 启播偏移、最多20 nodes；合成完成与播放完成分开 | 24kHz 不能直接交给16kHz consumer；133ms 组帧可能拖首声；按 node 数无法稳定描述积压时间；无 underrun/jitter 指标 | 采样率契约扩展或明确重采样；缩短首帧后按测量调整；以 queued_ms/样本数控制 high/low watermark；区分 first audio received / first scheduled / first audible，播放完成必须实际回执 |
| 打断 | fake client 本地立即 stop nodes、清 queue、epoch 过滤；Server generation 丢弃晚到；文字 cancel 真实关闭 HTTP | 未连通真实 ASR/LLM/TTS 三段联合取消；不能证明声音何时停止；中断后的上下文与听到的内容不一致风险 | 本地 stop/短淡出先于网络 ack；parent cancel fan-out；记录 cancel sent/ack/output ceased；已听/已生成/完整持久化分别建模。先不按文章“30%”阈值编造已听摘要 |
| 降噪／回声／双工 | getUserMedia 请求 audio:true，没有专门 AEC/NS 配置、getSettings 证据或声学验收；点击说话先停播放 | 播放语音可能回灌到 VAD/ASR；操作系统宣称 echo cancellation 不能替代实测 | 明确 echoCancellation/noiseSuppression/autoGainControl 约束并记录实际 settings；耳机与外放分别实测；只有声学分离合格才开放连续双工，未通过保留点击边界 |
| 传输／恢复 | 本机 renderer↔Server 为版本化 stdio，外部 adapter HTTPS/SSE；权限和卸载清理已有 fake 回归 | Server poll/stdio JSON 音频可能阻塞控制；mpsc 文本 update queue 本身没有容量上限；无共享音频环形缓冲或控制优先级 | 控制优先、有界媒体队列、producer backpressure；重新连接不自动重放，晚到包绑定 generation。单机桌面先优化本机音频交付，暂不因文章提 RTC 而增加 WebRTC/Opus/远端 relay 复杂度 |

## 优先级（后续实施计划，不冒充本轮完成）

### P0：正确性优先

1. 生产 TurnCoordinator 与真实三段 adapter 接入；统一取消、revision/config 快照、终态和清理。
2. 24kHz/16kHz 格式边界、抗混叠重采样、尾帧；用户手势 audio-only 权限和设备生命周期。
3. ASR final 去重／纠错，TTS 和输入积压有界且可撤销；播放侧先停，迟到输出不可复活。

### P1：感知延迟与稳定播放

4. 真正流式 ASR；final 才持久化与正式推理。partial 先用于字幕；预热/投机推理只在独立可取消、成本与修订规则明确后考虑，不先发声。
5. 句段式 TTS、按时长背压、首帧策略、缓冲/欠载监测；根据真实链路测量调参，而不是抄文章固定时间窗。
6. 分阶段 deadline、状态提示、cancel priority、连接池复用与 idle timeout。

### P2：声学与性能调优

7. 可替换 VAD/端点检测、AEC/NS/设备 settings 与物理噪声矩阵；用户提供本地目录名单后才确定本地依赖和权重。
8. 耳机/外放、安静/风扇/音乐、连续插话、网络抖动等物理测试；分别报告模式，不混为“全双工通过”。

## 延迟度量合同（目前没有这些云端／物理实测值）

使用单调时钟；不要直接相减未校准的 renderer/server 时钟。每次回合记录匿名 operation ID、generation、provider/model、格式/设备环境及阶段用时，**不记录音频、字幕全文或密钥**。用户导出诊断须显式操作。

- 采集结束→ASR final；采集开始→首 partial（若支持）。
- LLM request→first token（TTFT）；首 token→首可合成句段。
- TTS request→首音频字节；首字节→首播放排程／实际设备声音（后者要声学证据）。
- 用户话音结束→Withu 首声：当前需要真实声学终点，不能以点击结束时间冒充。
- 用户打断→本地 queue 清空／播放停止；cancel→各阶段网络关闭；清理耗时。
- queued_ms、underrun 次数、积压峰值、CPU/内存、错误类型与失败/超时/取消率。

报告 p50/p95/p99、样本数、失败/超时（不能只统计成功样本），注明机器、输出设备、外放/耳机、模型/区域、网络及 cold/warm。文章里的400/800ms、TTS150/200ms等只能是讨论目标，不能作 Withu 保证。样本不足时列原始测量范围而不伪填百分位。

## 不直接采纳的文章表述

- 不要求“ASR 未结束就正式让 LLM 开始并发声”；中间假设可能反转，先做字幕与 final，避免污染历史或付费噪声推理。
- 不直接按逗号/token 切 TTS，也不默认对所有声音做 crossfade：可能破坏韵律或截掉辅音，必须听感验证。
- 不把 Edge-TTS 当本机离线开源 TTS 引擎，不把模型输入/输出模态、克隆能力或耗时从文章泛化到全部厂商。能力需官方协议及真实测试证据。
- 不因 RTC 推荐直接加 WebRTC 到本机 stdio 链路；需先确认网络拓扑与测量瓶颈。
- 不引入情绪判断、工具调用、RAG 或长时记忆；这些不属于当前 P3 的语音可靠性任务。

## 本次实施范围

本轮只做用户指定的提供商交互/原生文字协议、连接器页样式和图标大小；此报告作为后续语音实现清单。未开启麦克风，未自动调用真实 Key。此前实际 socket cancel 和 fake 15-process suite 只在其证据边界内有效，不提升为本轮真实链路验收。

## 2026-10-11 Chat 修复增量

接通保守短句链路：真实设备显式录音（10 秒），有限内存、windowed-sinc 降采样至 16k，ASR → 用户草稿确认发送 → 现有 LLM → 显式点击 TTS 朗读。MiMo 与通用 Audio API 各自复用真实协议。返回音频按实际采样率播放，路由/会话/配置/窗口生命周期撤销旧结果并释放资源。测试结果按选择与凭据引用版本持久化，不保存音频/秘密。这补齐可测试的有限回合入口，不等于自然语音连续对话。

仍未实现：流式 ASR、句级合成重叠、时长背压队列、全双工 VAD/barge-in、延迟 percentile 与物理声学验收。当前 TTS 限短回复 1000 字且 10 秒/240k samples，不自动截断超限音频。合成麦克风测试验证执行路径，不证明用户麦克风权限/驱动/云端支持。
