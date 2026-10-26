# 豆包 Seeduplex 实时语音接入

## 当前验收状态（2026-10-14 P3收尾）

千问/豆包实时适配已完成，用户已确认真实全双工通话及设备专项正常。两个入口统一Withu-Live，侧栏与活动面板Lumi均132px，只存时长摘要、不存逐句转写；仅用户挂断结束Live，可恢复网络错误复用已授权设备重连，设备/鉴权/配置故障释放资源。独立消息朗读支持豆包。最终包为`E:/Orbit/demobuddy/output/p3/windows-alpha16-final-20261014/Withu-win32-x64/Withu.exe`；基线已提交，收尾提交见`v0.3alpha16`历史。最终22项回归、真实云端测量及物理确认见`docs/p3-acceptance-index.md`。下方是按时间保留的历史，早期未接入/未验证、两入口分离或未提交结论不覆盖当前状态。

## 历史：初次适配

2026-10-14：原版本只有 volc-realtime 配置预设，server 实际拒绝该协议，因此“协议未接入”不代表用户服务未开通。

依据用户指定官方文档：https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh ，以及官方接入须知 https://www.volcengine.com/docs/6561/2549732 和文档附带 Python 示例。原始文档/示例保存在忽略的 output/p3/volc-*。

实现 X-Api-Key 鉴权、session.create/model=1.2.6.1、16kHz PCM16实时输入、24kHz pcm_s16le输出；默认 zh_female_vv_jupiter_bigtts。不发送工具、位置或网络搜索参数。连续采音/ASR编辑字幕/assistant流式消息/即时停止播放/取消晚到数据复用现有严格scope、generation和资源释放路径。session.close等待session.closed有界确认后关闭WebSocket。历史仅传成对user/assistant，最多20轮。

Seeduplex response.done是用量事件，不作为回复完成。文字done和音频done同时到齐才提交完整回复；重复done不重复提交。真实节点播放完成仍由客户端单独判定。

检查：Rust debug构建、千问9组wire回归 output/p3/realtime-wire/run-Hms1MK；豆包9组wire output/p3/volc-realtime-wire/run-sxmytX；豆包实际Electron合成设备/真实WebAudio/打断/字幕/侧栏/挂断历史/重载回归 output/p3/realtime-desktop/run-BeH0KC。

以上使用本地协议服务和合成麦克风。真实火山API Key、服务权限、云端ASR/TTS/声学听感尚未在本轮验证。用户在设置点击测试连接，仅做建立/关闭会话，成功后再实际通话验收。语音Key来自语音控制台，独立于方舟LLM Key。不提交Git。


## 2026-10-14 TLS 与 Withu-Live 修正

真实 wss 连接复现 Rustls 同时启用 aws-lc-rs/ring 时自动 CryptoProvider 选择失败；本地 ws fixture 没覆盖此路径。Server 启动显式安装 ring provider。探测线程退出／20 秒未结束均返回 config.tested 失败结果，界面增加 60 秒等待上限。

使用用户现有 Withu 配置执行一次真实 session 测试，返回 auth_failed，无线程异常；未发送用户音频。证据：`E:/Orbit/demobuddy/output/p3/volc-real-session-result.json`。此结果不代表服务或听感验收通过，须检查火山语音服务凭据／权限。

Composer 麦克风启动 Withu-Live，沿用配置的全双工后端。132px lumi、磨砂玻璃卡片、连接成功后计时。realtime-start 的可选 mode=live 在 server 抑制 user/assistant 历史写入及 reply.updated；音频、打断、状态正常推进。结束仅在 view.callHistory 存储时长和 mode，舞台／活动页显示摘要；普通通话保留原文字记录。现有记录没有 mode 时按普通通话处理。

检查：`node checks/realtime-tls.mjs`（官方 TLS + 无效 synthetic Key）；`node checks/realtime-desktop.mjs --volc` 和不带参数的千问版本均覆盖 Live 实际 Worklet/WebAudio、132px 球、毛玻璃、无转写持久化、挂断摘要。fixture 不是云端语音／物理设备证据。

打包实测：`output/p3/windows-alpha16-live-20261014/Withu-win32-x64`；实际包内 release server 与构建 SHA256 一致，包内 release server 真实云端探测仍为 auth_failed。`--volc --packaged` 使用包内 server 通过，证据 `output/p3/realtime-desktop/run-xmwegT`；此前一次截图抛出 Electron UnknownVizError，重试通过。千问开发包证据 `run-pqxJTa`。产物未签名，未提交 Git。


## 2026-10-14 入口调整与录音传输

用户进一步决定：Composer 麦克风为语音输入，ASR 草稿在输入栏实时下划线展示，识别结束后进入聊天记录；右上角电话为 Withu-Live，主舞台整体磨砂蒙版，中央 lumi，下方暖阳色 RecordingStrip、时长、挂断。删除小卡片样式。语音输入不生成通话时长记录；Live 仅保留时长摘要。

旧录音路径每 20ms 发一次独立并发 IPC，12 个未完成请求即失败，相当于仅 240ms 阻塞容忍。替换为单个在途请求、5帧/100ms批次、有界2秒音频队列；server 每批拆成 640byte/20ms WebSocket 片段，保留 sequence/scope/cancellation；发送超时2秒停止，不静默丢帧或无限缓存。`checks/realtime-client.mjs` 模拟30帧输入遇在途阻塞，验证每帧顺序/内容、单个并发、批量长度与退出清理。桌面回归在首个真实 IPC handler 延迟300ms，验证两个入口、ASR草稿、播放/打断、暖阳电平条、Live不入逐句记录及摘要重启恢复。此证据仍不替代真实云端/设备听感验收。


最新包：`E:/Orbit/demobuddy/output/p3/windows-alpha16-live-stage-20261014/Withu-win32-x64/Withu.exe`。包内 server 桌面验证 `output/p3/realtime-desktop/run-uinIlx` 通过；千问 `run-279LFk`、豆包 `run-20hvMP`。源/包扫描通过。

当前用户保存配置真实豆包会话已连接成功（此前 auth_failed 结果仅对应当时配置）。包内 release server 发100批3200字节/100ms的生成静音，持续10秒，最大本机ACK1.15ms、均值0.57ms，没有失败或stderr。证据 `E:/Orbit/demobuddy/output/p3/real-silent-transport-result.json`。没有采集/保存用户音频；这只验证真实云端连接与录音传输，不证明ASR识别人声、回答/听感、物理声学打断已验收。未提交Git。


## 2026-10-14 回复终态与液态玻璃

真实生成系统语音输入复现：豆包输出 `response.output_audio.done` 不含 status_code，旧实现将其当 stream_incomplete 并终止session。官方同页 speech_text 示例也明确列出无该字段的 done。现在省略字段按正常完成处理，明确失败码仍拒绝。相同实际云端测试16秒/160音频批次完成ASR、assistant_final，无failed。证据 `output/p3/real-synthetic-speech-result.json`。这不证明客户端听感或实际回声消除通过。

Chat Completions 在明确 finish_reason 后干净EOF可以正常结束（不依赖可选DONE）；没有终态的断流仍失败。HTTP回归新增 stop-without-done，15组通过。当前保存 deepseek-flash 小请求真实验证返回stop+DONE并成功，没有复现全部截图场景，不将其声称彻底排除网络故障。

界面在complete时保留回复，直到同operation的server历史出现，消除刷新期间空白；失败保留部分文字并明确失败，不将半截内容写成已完成历史。

lumi wink同期同步原产物单侧弧线/胶囊眼与左右随机，其他映射保留。Live球198px。接入 `liquid-glass-react@1.1.1`（MIT），参考master官方源码，主舞台整片低模糊透明玻璃与挂断玻璃按钮共用SVG折射机制；红色电话图标。没有复制演示页面或新增状态。


## 2026-10-14 豆包音频分片与 Composer

实际云端生成测试语音收到 output_audio.started（有 response_id）后，output_audio.delta 只有 delta/event_id/type；旧代码要求每片都有 response_id，导致所有音频丢弃。现以当前 audio.started 绑定 delta；speech_started/interrupt/mute 清除绑定，cancelled generation 继续阻断。真实复测收到7个 normalized audio 和 assistant_final，16秒无failed、无stderr，未保存用户原始音频。证据 `output/p3/real-synthetic-speech-result.json`。wire与桌面fixture改为实际无response_id分片形式，覆盖播放和打断后的迟到丢弃。

Composer 录音状态为垃圾桶、暖阳电平条、右侧停止方框；隐藏模型/附件/发送控制，识别草稿保留实时下划线；垃圾桶退出并取消当前录音草稿，已自动提交的历史不删除。普通发送按钮为同款透明 liquid-glass-react。未提交Git。
# 2026-10-14：消息朗读与 Live 恢复

消息朗读使用官方 Python demo 的 `speech_text_buffer.append/commit`，同一 speech_id；不是 replacement 干预事件。server 从会话内已保存 assistant 消息解析文本，不接收 renderer 任意文本，复用实时语音凭据，read session 不写入消息历史，也不申请麦克风。当前朗读适配 Doubao；Qwen realtime 不冒充具有逐字 TTS 能力。

右上角控制新回复自动朗读，消息工具栏提供单条朗读/停止。新用户消息、切换对话、通话开始、页面隐藏均停止朗读。参考豆包公开网页 bundle 中 StopActiveTTSOnNewMessage、StopWebTTSOnHiddenMessage；尚未发现完整官方产品规则说明，不将局部证据称为完整复制。

真实接口证据 output/p3/read-real-result.json：27 audio chunks、正常完成、无 microphone；无用户音频留存。桌面证据 output/p3/realtime-desktop/run-AAeYem；61 schemas 检查通过。Live 无静音挂断计时器，可恢复连接故障保留界面并退避重连，非恢复性鉴权/设备故障保留错误状态，用户仍可挂断；应用退出/撤权等必要资源清理继续执行。

