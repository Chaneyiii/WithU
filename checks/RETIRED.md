# 已退役的检查脚本

这里记录**被删除**的检查及其原因。删除不等于放弃覆盖：每一项都说明覆盖搬到了哪里，
或说明该能力本身已经从产品里移除。

## 2026-10-28：finite ASR/TTS wire（`chat-voice-wire.mjs`、`voice-turn-wire.mjs`）

**删除原因：被测接口已退役，脚本按设计永远无法通过。**

- `withu:voice:request` 现在是 tombstone：校验载荷与 `config_version` 后**无条件**返回
  `provider / realtime_protocol_unsupported`，注释原文是
  “Retired finite ASR/TTS requests never resolve realtime credentials.”
  （`apps/withu-server/src/main.rs:1537`）
- 这两条脚本的其余步骤也全部基于已移除的配置面：
  `providers[].service` 现在只允许 `llm|realtime`，`defaults` / `model_overrides` /
  `speech_preferences` 也只有 `llm|realtime` 键（`contracts/v1/public-config.schema.json`），
  而脚本仍在写 `defaults.{asr,tts}`、`speech_preferences.{asr,tts}` 和没有 `service` 的 provider。
- 因此它们卡在第一个 `config:update` 就抛 `configuration_update_schema`；补上 `service`
  之后又停在 `config:test`（`config_test_schema`），继续改也没有意义。

**它们原来覆盖什么**：有限时长 ASR/TTS 请求（麦克风 10 秒 WAV → 识别、回复 → 朗读）、
预览作用域、会话过期、provider discovery 与凭据隔离。

**覆盖搬到哪里**：

| 原覆盖点 | 现在的检查 |
|---|---|
| 实时语音会话、打断、工具调用、O1 只落证据句 | `checks/realtime-tools.mjs`、`checks/realtime-wire.mjs` |
| 不落原始音频/逐句转写 | `checks/realtime-output-safety.mjs` |
| 本地语音后端（speech 通道） | `checks/speech-server.mjs`、`speech-desktop-run.mjs`、`speech-suite.mjs` |
| provider discovery / 凭据隔离 | `checks/provider-discovery.mjs`、`checks/chat-tools-wire.mjs`（凭据不出现在 wire） |

**没有覆盖到的**：有限 ASR/TTS 这条产品路径本身已经不在了，不是「未测」，是「无此功能」。

**如果哪天恢复有限 ASR/TTS**：先恢复 `withu:voice:request` 的真实实现与
`public-config` 的 asr/tts 键，再从 git 历史取回这两个脚本（本文件所在的删除提交之前），
按新契约重写后重新入册。

## 其他仍然提到退役接口的脚本

- `checks/p3-live.mjs` 仍在调用 `withu:voice:request`，但它没有注册到任何 npm script，
  属于历史阶段脚本；如要复用需先按当前契约重写。
