# Demo 验收索引

> ## 当前状态（2026-10-28，以此为准）
>
> 本文件以下内容是 **v0.3.1go1 时期（2026-10-17）的历史索引**，保留作沿革记录。当前交付请看：
>
> - 发行版：[v0.3.1go5](releases/v0.3.1go5.md)（版本三元组、三哈希、已知限制）
> - 验收步骤：[v0.3.1go5-acceptance.md](releases/v0.3.1go5-acceptance.md)（自动化清单 + 手工步骤）
> - 真机待办：[manual-verification-2026-10-27.md](manual-verification-2026-10-27.md)
> - 真机对照表（可勾选）：[manual-acceptance-2026-10-28.md](manual-acceptance-2026-10-28.md)
> - 冻结终审清单：[releases/t17a-freeze-checklist-2026-10-29.md](releases/t17a-freeze-checklist-2026-10-29.md)
> - 交付物状态：[delivery-manifest-2026-10-28.md](delivery-manifest-2026-10-28.md)（并声明 2026-10-18 的 JSON manifest 已过时）
> - 完成度实测：[../验收前实测报告-2026-10-27.md](../../验收前实测报告-2026-10-27.md)
> - 参考对照（A6）：[evidence/a6-reference-matrix-2026-10-28.md](evidence/a6-reference-matrix-2026-10-28.md)
>
> 一句话结论：**工程包可交接，产品验收未完成**（真实模型、真实连接器、真实声学、Windows 通知真机项未闭合）。

---

# v0.3.1go1 Demo 集成提交索引

日期：2026-10-17。基线为 alpha17/alpha18 Comfort Demo。本索引区分独立模块、生产接线和真实设备/provider 验收。

## 当前交付

- 显示版本 `v0.3.1go1`；npm/Electron 内部版本 `0.3.1-go.1`；Windows 数值版本 `0.3.1.1`。
- `VERSION`、renderer 版本、主进程关于菜单、npm/lock 与新包 manifest 一致；打包脚本从 `VERSION` 派生发行版本。
- 当前包路径、manifest 与哈希待本轮打包后补录；Windows 包未签名。
- GUI 在原模式标题位置固定显示 Comfort，没有下拉箭头或切换菜单；搜索打开旧 Cowork 会话时保持当前 Comfort 会话。不删除旧 Cowork 会话、草稿和项目，不修改 server 两模式合同。
- 所有检查使用隔离数据、虚构凭据、本地服务和合成设备；未读取用户生产凭据、付费云端接口或重新录制用户声音。

## 当前集成与待验证

- 集成人已运行 Rust workspace、96 schemas、contracts、MCP 13 项与 Vite build；结果通过。最终全功能专项、打包与 packaged lifecycle 证据待补录。
- D7 为本地 bundled 标准 MCP App：SDK resource/tool 注册、Client/AppBridge/PostMessageTransport、CSP/source/session/size/teardown 已接入。它不是第三方 App 或外部服务接入；D4 host RPC 未就绪时必须拒绝并显示未提交，fixture 不冒充生产成功。
- D8 policy core、owner persistence、runner、Feed 与通用通知投影已接入；真实 Windows 通知中心、Focus Assist、权限和长时行为未验。
- D1 conversation 绑定、TTL 与一次性投影的文字/Realtime/球体消费待最终验证；云模型效果与声学回声分离未证。
- D4/D5 为本地效果：消息草稿不发送，无预约、购买或付款；Live 只保存时长摘要。

## 验收证据

### D1-D6 模块级验收（历史基线）

各模块专项记录见 [D1 情绪支持](affect-support.md)、[D2 记忆持久化](demo-d2-memory-persistence.md)、[D3 记忆检索](demo-d3-memory-retrieval.md)、[D4 动作执行链](d4-comfort-action-chain.md)、[D5 生活工具](demo-d5-life-tools.md) 与 [D6 Intelligent UI](demo-d6-intelligent-ui.md)。这些文档区分独立 crate/契约/replay 与生产 UI/owner 接线；当前 D1/D4/D5/D6 主路径已有接入，D1 conversation/TTL/一次投影消费与全流程证据仍待补录。完整差异复审找到并修复两项问题：调度器 stale lease 会泄漏并发槽位且早期修复缺少 controller 身份；memory RPC 接受未绑定项目 capability 的 Cowork scope。回归覆盖见 `crates/withu-scheduler/src/lib.rs`、`checks/memory-rpc.mjs` 和 `checks/memory-gui.cjs`。

### Alpha18 Windows 包（历史证据，不代表 go1）

- Rust workspace 测试通过；controller 身份修复后 scheduler 6 项测试全部通过，新增跨 controller stale lease 用例在旧行为下失败、修复后通过。
- `npm run check` 通过 83 个 schemas；真实 owner/server memory RPC 回归通过，包含 Cowork list、correct、delete scope 拒绝和 Comfort CRUD/CAS/墓碑行为。
- `npm run build` 与 `npm run package:p3` 通过。alpha18 packaged Electron normal/restart/malformed/crash/eof/timeout 六个场景全部通过：`output/p3/desktop-run-e3ipJ9/results.json`。
- 包：`output/demo/v0.3alpha18/Withu-win32-x64/Withu.exe`；manifest：`output/demo/v0.3alpha18/manifest.json`；未签名。
- SHA-256：client `89468725be7938a9d87420b9791e58ecb52d3a48348107b68bc370a11e32c8a3`；server `233c12eb4b4cd2341b72dedd02e73896a16918d38bacfd5f9b49fcd21c32a364`；app.asar `7746630d9e91bd30b153d9b9614cdbb6b3bbfd6eaf62e88f9203a06ffb9529c0`。
- alpha18 的六场景包回归证明既有桌面生命周期行为；它不验证 D1/D4/D5/D6 的生产路由接线，也不代表 D8/D9 完成。

### Alpha17 继承验收证据

下表与路径记录的是 alpha17 基线包的历史回归，不代表 alpha18 包本身；alpha18 的新包验证和哈希另见本节后的记录。

最终汇总：`E:/Orbit/demobuddy/output/demo/v0.3alpha17/acceptance.json`，accepted=true。

| 检查 | 结果与证据 |
|---|---|
| 生产构建、脚本语法、61 schemas、配置 GUI 边界 | 通过；Vite 保留已有大 chunk 提示 |
| 完整 24 项回归 | 首轮 23/24 通过：`output/p3/closeout/run-ngLzb9/results.json`；唯一失败为已有 P2 fake-speech 预览的 `speech_scope` 间歇问题 |
| P2 完整复核 | 同一源码无变更，15 个独立进程全部通过：`output/p2/development-suite-h2GKB5/results.json`；首轮失败原样保留，不声称根因已修复 |
| 新包六个桌面场景 | normal/restart/malformed/crash/eof/timeout 全部通过：`output/p3/desktop-run-9xFKRn/results.json`；实际 preload、Rust、草稿、导入/导出、窗口重开与退出清理 |
| 固定 Comfort 与数据边界 | 六场景内检查旧 Cowork active 引用/草稿保留、无模式菜单、真实 Comfort 输入持久化、搜索不能切入 Cowork；截图 `output/p3/desktop-run-9xFKRn/normal/packaged/comfort-fixed.png` 已读取核验 |
| 新包千问/豆包 Live | 两协议都通过；具体 realtime-desktop 证据目录见完整回归日志，含新 Comfort 会话、时长摘要、重载、打断、重连及设备结束清理 |
| 实时输出与诊断历史 | closeout 内 `realtime-output-safety`、`owner-retention` 均通过；继续保留 P3 的凭据隔离和无原始音频留存边界 |
| 源码/包一致与版本 | `output/demo/v0.3alpha17/source-package-match.json`：131 个 client 源文件、36 个 renderer 产物、包内检查脚本、production package metadata、VERSION、manifest 与 release Server 均匹配 |

运行源码 SHA256：`7668daa3f12293094a8d9ef20cf4adc4342739134d62108a833956bf2ba0b12e`。
新包 SHA256：

- Client：`0e7dbf1629da48fbe06cef8ceafeebb66a28fe93e65247c71e1f40a5c255359d`
- Server：`f37f246640c4a578a947949ab205fcb88a99487aaefa99c630dccc16fc4ee0dc`
- app.asar：`0ed3b5ca66a96e65cddb51606d64671c2ddd376c60f979979c4df97468f25e2c`

Rust/server 本次未改动，新包 Server 与已验收 alpha16 完全相同；此前 Rust 单元/文档测试、格式与严格 Clippy 的证据仍在 P3 索引，本次不冒称重新执行。
本轮是自动 GUI/合成设备验收，不替用户本人做新的视觉或物理声学确认；保留此前用户已确认的 P3 界面、真实全双工与设备结论。

## 后续任务

见 `docs/demo-release-plan.md` 的当前任务表。D1 消费与 D9 完整包验证待证据补录；真实云端/实机声学、Windows 通知中心/Focus Assist/权限由用户确认。正式版 Cowork 工作区/团队/专业能力继续后置。
