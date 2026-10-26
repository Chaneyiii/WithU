# P3 真实语音与设备验收

2026-10-14 用户确认界面和真实全双工对话通过，随后在设备专项提问中回复“都正确”，覆盖说话打断、挂断后麦克风指示消失、设备拔出及断网报错/恢复。实际设备型号与耳机/扬声器选择未提供，不推导跨环境回声质量保证。

当前包：E:/Orbit/demobuddy/output/p3/windows-alpha16-final-20261014/Withu-win32-x64/Withu.exe（未签名）。

生产程序经“文件→退出Withu”正常退出后，原Withu及包内server实际进程释放，没有强杀。自动桌面检查另验证真实合成MediaStreamTrack.stop/ended、AudioContext.closed和实际WebSocket断连恢复，合成设备不替代物理声学证据。

真实云端测量：E:/Orbit/demobuddy/output/p3/real-metrics/run-LBC883/results.json。生成3.010秒16kHz单声道语音；两模式定稿到首段接收PCM约563ms/415ms，服务器采样工作集峰值约12.5/12.7MiB。接收PCM不等于已听见；ACK不等于停止发声耗时；服务器内存不包括Electron/GPU。整App进程工作集另见最终realtime-desktop的process-metrics.json（Electron内存单位KiB）。两次小样本不报告p50/p95或SLA。

两个入口统一进入Withu-Live，仅保存时长摘要。静音不自动挂断，可恢复断网只重建云端session、沿用同次通话授权；挂断、设备丢失和退出释放资源。未采集或保存用户原始音频，生成语音验证对话已清理。

音色克隆、持续学习、联网工具、本地模型及其他实时提供商不属于本轮P3收尾。未验证项仅为具体硬件条件、定量回声/实际发声停止延迟、长时间压力表现及跨设备性能；不伪造通过。
