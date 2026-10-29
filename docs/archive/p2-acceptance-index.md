# P2 工程验收索引

本文件仅记录实现、复现和证据，不定义产品决策。唯一产品权威：`docs/product/withu-v3-spec.md`；用户明确决定优先。外部 spec 与源 GUI 未修改。

## 权威输入与状态

- P1 基线：`dbcc23a7b35285dc53efb8a6efc4bb890176ec45`；P2.1 最后视觉修正提交：`679072ffd3249eaa86f140bbd1d8d4939ddfc4bd`。
- 本轮输入提交：`db608cab2a6eff4d0ec2425dcd907fef7d3f99a0`。spec SHA256：`4950B5D08E2D6DCE8ECC8B41B2043A601C9F070864EEBEB60CF27091868EE9E2`，本轮复核未更新。
- 2026-10-10 用户取消整个 3D Avatar 开发线。保留 2D 球体、原渐变和互动，不存在 3D 待办或资产请求。
- 用户 P2.1 验收记录：“p2.1验收暂时可通过，继续执行后面的任务”。这是暂时通过，不扩大为永久设计锁定。
- 最新用户范围：“修复除真实ASR和TTS以外的残余任务。真实的ASR和TTS要等后面配置模型才能测”。真实后端接入/识别与语音质量测量留待配置模型后，本轮不启动 P3。
- 当前：非真实 provider 的工程残余已修复，开发/包全矩阵通过；最终源码与包哈希证据在末节冻结。物理设备和声学效果不由合成回放证明。

## 实现与 spec 映射

| 依据 | 实现及边界 | 独立验证 |
|---|---|---|
| R01/R08、§5.5、§6 第4步 | 同一 Chat 的 2D 载体，保留导航、Comfort/Cowork、幕布、原本地互动。无新增常驻 Presence 导航 | P2.1 本人暂时通过；两模式/页面/草稿 GUI 回归 |
| 最新视觉决定 | listening→疑惑；degraded→出错；ended/interrupted→开心＋一次彩带，不额外自旋 | 19 presence 检查；不当作用户心理标签或任务成功 |
| R02/R14、§4.6、§6 第5步 | strict speech-start/session/command/update DTO；server 权威 conversation/renderer/turn/generation/config/version；独立 ASR/TTS traits、fake A/B、受约束合成回应与现场 PCM 生成 | 47 schemas、真实 Rust wire，实际开发/打包 Electron |
| §4.6、§7.1 | partial/final/修正/provider终态分离；重复final仅一次回应，陈旧修正被拒；测试 transcript 留在会话内存 | 实际 Electron matrix（不是只验证状态名） |
| R09、§4.6 | interrupt先stop/disconnect并清队列；generation取消未完成合成；静音/拒绝/安静/结束不自动复活 | 实际节点取消、晚到音频/文字、重复终态、两连续回合 |
| R05/R07、§4.9 | source与有效turn约束，媒体/TTS/广告不能成为用户final/新授权；不写消息/记忆/Goals，不派生任务或specialist | 错误来源/turn/generation negative、正式消息/Goals保持空、删除墓碑 |
| R13、§4.4/§5.5.4 | main管理server；renderer设备资源真实拆除；reload/window-hide/mode/page不杀server；旧renderer输出失效、不重播；完全退出等待清理ack | 实际 PID、queue/node/track/context teardown、原六组生命周期故障 |
| R10/R11、§4.6 | 可信 GUI main frame＋单次真实用户事件＋audio-only；camera/subframe/external/隐藏/未授权拒绝；撤权阻止后续mic输入 | 真实 Chromium getUserMedia拒绝与合成device授权/撤权；策略负例 |
| §7.2、§8.4 | 指标分离fake人工延迟与实际应用调度，无统一性能承诺 | 单轮 Windows 测量，仅调度/取消调用事实 |
| §4.10/§5.6 | 媒体只验证source/合成信号控制边界；既有幕布/卡片仍是独立预览 | 没有真实MCP/AppSurface/商业播放完成声明 |

## 本轮修复

1. 常驻 preload 清理接收方：Chat卸载时仍能确认退出；失败/悬挂client仍参与ack，不在卸载时丢失失败事实。
2. captureEpoch及入队session快照：旧AudioWorklet帧/排队请求不被重绑定到新回合；已在途请求结束前不报告释放完成。
3. 跟踪getUserMedia与worklet加载；迟到申请返回后立即stop tracks，不建立隐藏capture；申请/关闭悬挂触发有界失败，不能报告resources_released=true。
4. main记录实际audio授权，撤权后拒绝mic frames；设备ended/权限撤回进入degraded并断开processor/port/source、停止tracks，保留文字入口。
5. source/turn过滤覆盖字幕及PCM；synthetic回应来源修为withu_tts，测试字幕能实际到renderer，不错当control或用户。
6. 修正已卸载React回调、后端替换的command队列等待、退出重复确认及结束/打断控件被busy锁住的问题。
7. 新独立15进程suite与包冻结检查，逐run绑定Rust/app.asar哈希；测试检查不因P1通过而省略。

## 可复现检查入口

在 `E:\Orbit\demobuddy`：

```powershell
cargo build --workspace --locked --target-dir target/p2
cargo test --workspace --locked --target-dir target/p2
cargo fmt --all -- --check
cargo clippy --workspace --locked --target-dir target/p2 -- -D warnings
npm run check
npm run check:presence
npm run check:speech:server
npm run check:speech:suite
cargo build --release --workspace --locked --target-dir target/p2
npm exec vite build -- --config client/withu-renderer/vite.config.mjs
npm run package:p2
npm run check:speech:suite:packaged
node checks/desktop-run.mjs --p2
node checks/desktop-run.mjs --p2 --packaged
node checks/p2-package-freeze.mjs --suite=output/p2/<final-packaged-suite>/results.json
```

单case：`node checks/speech-desktop-run.mjs --scenario=<case> [--packaged]`。suite顺序运行15个独立client/server进程，normal内包含多断言，matrix内包含10个脚本场景和A/B/删除；不将“15进程”误写成只有15个断言。

测试case：normal、matrix、capture_permission_revoke、capture_device_ended、capture_pending_inputs、capture_late_acquisition、capture_worklet_failure、capture_explicit_end、capture_acquisition_timeout、cleanup_failure、cleanup_timeout、server_crash、device_denied、device_missing、device_busy。测试麦克风仅Chromium合成设备，所有内容/userData位于已忽略的output/p2。

P2包：`E:/Orbit/demobuddy/output/p2/windows/Withu-win32-x64/Withu.exe`；清单：`E:/Orbit/demobuddy/output/p2/windows/manifest.json`；冻结：`E:/Orbit/demobuddy/output/p2/package-freeze.json`。原P1包/预览用户数据未覆盖；Rust使用隔离target/p2，未删除用户被锁定的产物。

本轮核心复核：23 Rust单测、3 compile-fail文档测试、47 schema与负例、19 presence检查、fmt/Clippy通过。核心SQLite/CRUD/审计/墓碑回放：`E:/Orbit/demobuddy/output/p1/server-check/run-RlqSyY`；14组新speech wire：`E:/Orbit/demobuddy/output/p2/wire-HsAAs2`。开发六场景GUI/生命周期：`E:/Orbit/demobuddy/output/p2/desktop-regression-H49lhJ/results.json`；包六场景：`E:/Orbit/demobuddy/output/p2/desktop-regression-YKWmoq/results.json`。旧失败日志保留，不计为通过。

## 延期验证，不冒充工程残余已证明

- **真实ASR/TTS**：用户明确延期，模型/provider配置后另测识别、音质、延迟、真流式取消和后端错误；fake不进入真实provider目录、不会上传音频。
- **物理硬件**：本轮证明真实WebAudio/MediaStream API在Chromium合成设备中的行为，不证明Windows物理mic指示器、真实拔出/占用/撤权、扬声器或用户实际听见。物理硬件手动测量仍需实机证据。
- **声学回声/连续双工**：source标记和合成VAD不证明声学分离；当前点击唤起/停止入口是保守边界，不宣称已解决echo。真实媒体协作按§6的自有UI→标准MCP App→真实媒体依赖顺序验证。
- **模型/服务资源**：fake用定时工作描述和现场PCM，无外部fake worker进程；未调用OS TTS，没有真实模型句柄/权重/LLM/Laya/关系记忆服务/团队/MCP/商业媒体。
- **包安全及性能**：包未签名；前端仍有>500kB chunk构建警告，不是功能失败。无测试用户原始音频、密钥或构建产物入Git。

## 最终冻结记录

本节在最终源码提交后填写最终suite/源码revision/哈希及最小指标。任何重打包或运行代码修改必须重新核对冻结证据，不把中间包当最终包。

- **工程范围结案**：除用户明确延期的真实 ASR/TTS 及实机声学/物理硬件测量外，原列出的非真实provider残余已完成修复和独立回放。没有追加P3。
- 最终运行源码提交：`452843dc4662cdbd8cc7c310f9fa09f39bfdd29a`。在该提交干净工作树上完成冻结，`sourceTreeDirty=false`。本节后的提交仅更新工程索引，不改变包内运行代码。
- 开发版完整15进程suite：`E:/Orbit/demobuddy/output/p2/development-suite-0BozgF/results.json`，全部退出码0。
- 包完整15进程suite：`E:/Orbit/demobuddy/output/p2/packaged-suite-c5zPmP/results.json`，全部退出码0；每个进程evidencePath、case、硬件和Rust/app.asar哈希在receipt中。
- 最终包GUI/持久化/生命周期六场景回归：`E:/Orbit/demobuddy/output/p2/desktop-regression-n2yz0o/results.json`；产品扫描通过。
- 冻结复现：`node checks/p2-package-freeze.mjs --suite=output/p2/packaged-suite-c5zPmP/results.json`，136文件逐项核对、最终Rust/exe/app.asar与manifest核对、15run哈希核对全部通过。package.json严格核对packager生产投影，不忽略未知改动。

| 最终产物 | SHA256 |
|---|---|
| Withu.exe | `968ee9b0e3f3067a513a6a5e2a8c0d042b1d18b49b25b2c4f3de4e8a703596ad` |
| withu-server.exe | `fb853271f860e3c0ec3a922c9b0d86850f8bf88361790fe9e06261a68f1c247b` |
| app.asar | `86611bb542ee333a4736c9b51a381262b6c4a67d585925cc9eb4d89c5da9b0fe` |

最终包单轮指标：`E:/Orbit/demobuddy/output/p2/electron-counaN/evidence/results.json`。Intel Core Ultra7 155H，22逻辑CPU，16,641,941,504 bytes RAM，Electron44.7.0/Chromium152.0.7977.130；3200合成PCM samples/16kHz。输入发送完成→partial57.5ms、final205.1ms、合成回应293.0ms、首播放节点调度323.5ms。中断stop/disconnect/清队列在同一计时刻度内完成，测得0ms是计时分辨率与同步调用事实，**不是零声学延迟或物理声音即时消失**。fake人工delay为40/180/260/终态后30ms；数值包括IPC、20msserver tick和renderer调度开销，不冒充真实模型性能、跨平台SLA或用户已听见。

设备结束回放为真实Chromium测试MediaStreamTrack.stop加synthetic ended通知；设备拒绝/缺失/忙碌为DOMException故障注入；在途输入回放在测试main中注入160ms延迟，清理前确认至少2帧排队。它们证明生命周期错误路径，不证明物理拔出。失败/超时case成功指断言正确报告failed及resources_released=false，而不是把悬挂资源假称释放成功。
