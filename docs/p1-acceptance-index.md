# Withu v3 P1 工程验收索引

这是工程实现与证据索引，不是独立产品权威。唯一产品权威仍为 `docs/product/withu-v3-spec.md`；来源 GUI、外部 spec、历史仓库保持原样。

- 实施基线：`b87783c9b95e13f54e64a4dabdba50f680069c97`。
- 当前 spec SHA256：`4950B5D08E2D6DCE8ECC8B41B2043A601C9F070864EEBEB60CF27091868EE9E2`。旧暂停索引中的 hash 已由此取代。
- 完成提交：本索引所在的 P1 提交；用 `git log -1 --format=%H` 获取。构建产物与最终提交对应关系另存忽略目录 `output/p1/completion.json`。
- 工具链：Node 26.10.0，npm 12.2.0，Rust/cargo 1.99.0，Git 2.56.0.windows.1，Electron 44.7.0（内嵌 Node 24.21.0，Chromium 152.0.7977.130），Electron Packager 20.3.0。
- P1.1 由用户在本对话明确视觉验收通过，随后授权继续 P1.2/P1.3。没有启动 P2 或创建其他对话/代理。

## 三个子阶段

| 子阶段 | 实际实现/验收 | 证据 |
|---|---|---|
| P1.1 | 指定 GUI 外框、导航、hash routes、模式切换、主题/i18n、Tooltip、SOUL/MEMORY shader、消息/活动面板、视觉编辑工具迁入。用户直接授权的幕布与 emotional ball 视觉修改保留。球体导入用户指定源码，支持拖拽/本地表情互动，活动面板共享状态；不称为情绪识别服务。 | 用户本人通过；`output/p1/visual-review/acceptance.md`、来源记录 |
| P1.2 | 版本化 stdio 请求/响应/事件/分类错误；main 唯一 owner。会话、项目、草稿、提交输入、Goals、Ideas、Library 引用、Search 和视图状态由 Rust/SQLite 持有。原子 CAS 写入与同事务最小审计，删除墓碑与检索失效；没有 provider 时仅保存用户文字。 | `checks/server.mjs`；`output/p1/server-check/run-3YIrTW/results.json` |
| P1.3 | 真实 Electron preload 与 Rust 链路、页面呈现、输入框持久化、文件实际导入、导出与 public config、关窗/重开/重载、跨进程重启恢复。开发程序和 Windows 打包程序分别覆盖正常、重启、启动失败、崩溃、EOF、退出超时。 | 开发：`output/p1/desktop-run-LdBeHX/`；最终打包：`output/p1/desktop-run-7C6gZj/` |

## 正式路径及边界

正式数据通道为结构化 stdio。main 创建和持有 Rust 子进程，preload 只暴露具体允许的方法，renderer 无任意 invoke、owner shutdown、测试 probe、凭据访问或任意执行通道。正式 server 不创建 HTTP listener，ready 的 `transport=stdio`、`bind_address=null`、`port=null` 如实表示没有网络 API；不将旧端口租约说成 API。

选择 stdio 的理由：同机单一 owner 可直接用独占 stdin/stdout 相关请求、事件序列和 EOF 清理，减少端口授权与事件流访问面。浏览器开发预览使用独立的 Vite main 代理，不是正式桌面网络 API。

窗口 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。原生窗口、主题、剪贴板、文件选择和导出留在 main。外链按完整域名白名单校验，带身份/端口或伪造子域被阻断；没有给外部 iframe preload 或设备权限。配置读取和导出按递归闭合 public schema 校验，嵌套私有字段负例继续通过。

SQLite `withu/withu-state-v1.sqlite` 从零建立，不读取 v1/v2 数据。同步 FULL、事务写入、expected-version、删除墓碑、JSON/SQLite 启动检查和独占数据库 owner 已接入。写入失败回滚保持最后有效值；损坏数据库启动失败，不自动覆盖。操作审计同事务保存 schema version、操作、对象 ID、时间、actor 和结果，不复制正文。Search 直接查当前有效数据，无持久搜索副本可复活删除内容。

项目删除将其会话原子转到无项目作用域并递增版本；会话删除原子删除草稿与已提交输入并墓碑化。两模式分别保留当前会话、草稿、滚动与展开标识。Ideas 沿用页面结构补创建/编辑/删除入口；Feed 无获准更新时保留真实空态，不生成模拟消息。

main 关窗仅隐藏，通过托盘或应用入口恢复；renderer 重载和切模式不重启 server。完全退出幂等停止接收工作、清理注册资源、返回真实 shutdown 结果并退出。测试 probe 是明确标识的定时工作/worker，不是 agent 任务。清理失败不发 complete、不返回 `resources_released=true`；退出超时由 main 有界清理进程树。

工程配置见 `client/withu-window/index.mjs`：启动 10000ms、请求 6000ms、shutdown 3500ms、强制退出等待 2000ms。worker 正常清理等待 750ms。它们是当前 Windows 测试配置，不是产品性能承诺。最终打包六组检查整组耗时见 JSON（含 Electron 启动、UI、截图和退出，不能当单次操作延迟）；故障清理在实测配置界限内完成。

## 可复现命令

在 `E:/Orbit/demobuddy`：

```powershell
npm ci
npm run build
npm start
npm run preview:gui
```

网页预览 `http://127.0.0.1:4173/` 使用单独 `output/p1/visual-userData/withu`，保留开发 fixture 标签。原生文件选择、托盘/窗口与正式生命周期以 Electron 回放为证，不拿浏览器或自动截图代替用户 P1.1 验收。

```powershell
npm run check
npm run check:lifecycle
npm run check:server
npm run check:desktop
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --target-dir output/p1/rust-tests -j 1
cargo build --release --workspace
npm run package:windows
npm run check:packaged
npm run check:product
```

本轮检查结果均通过。Rust 单元测试 23 项、compile-fail 文档测试 3 项，43 schema 的版本/必填/未知字段负例及 IPC parity、批准/保存许可/墓碑、public 配置投影不变量持续通过。原 `target/debug/deps` 最终测试曾出现 Windows LNK1104 文件打开失败；独立 `output/p1/rust-tests` 新编译并执行全部测试通过，未复用旧通过报告。

`check:server` 使用实际 Rust 报文，通过 owner 验证正式 envelopes/单调 sequence，覆盖 CAS、模式/项目过滤、重复请求、故障事务回滚、重启恢复、删除/检索/不可复活、最小 durable audit、独占 owner、真实 worker/定时完成/取消/重复取消/清理失败、启动损坏、崩溃、超时、数据库损坏不覆盖和外链负例。

`check:desktop` / `check:packaged` 每轮使用新 userData，并在第二次真正的 Electron 进程里核对上次数据。测试 DOM 输入经实际 preload 保存至 Rust；正常和故障退出后检查 server/worker PID 已消失。错误日志中的 version_conflict、外链阻断和 malformed stdout 是被断言的负例，不是静默通过。

## Windows 产物与本次截图

- 可启动便携产物：`E:/Orbit/demobuddy/output/p1/windows/Withu-win32-x64/Withu.exe`。
- 随包 Rust binary：`E:/Orbit/demobuddy/output/p1/windows/Withu-win32-x64/resources/withu-server.exe`。
- Electron、Rust 和 app.asar 的 SHA256：`output/p1/windows/manifest.json`。当前产物未签名。
- 最终产物的六组回放：`output/p1/desktop-run-7C6gZj/results.json`。
- 默认 Comfort/Cowork/Devices/Goals/Ideas/Library/Feed 截图：`output/p1/desktop-run-7C6gZj/normal/packaged/*.png`。
- 真实启动失败：`output/p1/desktop-run-7C6gZj/malformed/packaged/server-unavailable.png`。
- 真实崩溃：`output/p1/desktop-run-7C6gZj/crash/packaged/server-crash.png`。
- 收到的 server 报文和实际导出：各正常 Electron 回放目录的 `wire.json`、`withu-data-export.json`。这些只包含本次测试专用对象，不进入源码提交。
- 扫描：129 个自有源码/契约文件与 69 个打包产品文件通过；报告 `output/p1/windows/source-scan.json`。排除 `docs/sources`（来源事实）、第三方 node_modules 内部代码与许可证、忽略输出证据；HTML meta/JS metadata 不被误当 Meta 品牌。

所有输出、userData、依赖缓存、编译/打包产物均在 gitignore 范围；源码提交不包括它们。授权来源见 `docs/sources/gui-provenance.md`，球体来源见 renderer 的 `emotional-ball/README.md`；依赖许可证随 npm 模块保存，来源记录随包放在 resources/sources。

## 未实现边界与后续依赖

- LLM、真实 ASR/TTS、下载首批模型名单、Laya/情绪校准、长期关系记忆、agent 计划/外部工具、审批执行、specialist 团队和主动问候未接入。不给假回复/测试成功，不接受 provider Key 保存。
- 幕布是用户已验收的共享 GUI 与开发状态预览；标准 MCP App/AppBridge、真实服务 action、流式 assistant 回复、播放器/网站登录/播放不是 P1 完成项。静态隔离占位不证明 MCP host 已验收。
- emotional ball 仅本地互动和共享视觉状态；用户显式增加此 GUI 资产的决定优先于 spec 旧排除描述。不声称其代表用户真实情绪或完整 P2 presence。
- Library 保存用户选择/导入的文件引用，不索引文件全文；删除引用不是删除用户原文件。项目文件引用不等于文件夹授权，也不全部注入 Comfort。
- Feed 当前没有已授权更新来源；网页预览无法验收原生文件对话框或托盘行为。正式 Electron 中的原生选择/导出职责已经接入，自动检查实际导入/导出与引用读取。
- P2 及以后仍须依赖本轮 server/lifecycle 边界，分别验收完整 presence、fake speech 回放、真实 provider、情绪/记忆、审批和工具。该对话到 P1 结束，不继续启动它们。
