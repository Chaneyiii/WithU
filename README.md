# Withu

本地优先的桌面陪伴应用：Electron 窗口 + 本机 Rust server + SQLite 持久化。
对话、提醒、日程、草稿、记忆都在本机处理；模型调用走用户自己配置的 provider。

**当前版本：`v0.3.1-go.5`（工程可交接版，2026-10-29 冻结）**
构建提交 `c0f658f`，tag `v0.3.1-go.5`。冻结记录（四哈希、全量检查结果、已知缺口）见
[docs/releases/freeze-2026-10-29.md](docs/releases/freeze-2026-10-29.md)。

> 「工程可交接版」的含义：代码、检查、证据链完整可接手；**真实模型服务、真实联网连接器、
> 真实声学回声**这三类不在本版验收范围内，边界逐条写在冻结记录 §5。

## 快速开始

需要 Windows、Rust/Cargo、Node.js 20+、Git。

```powershell
npm ci
cargo build --workspace --locked     # 产出 target\debug\withu-server.exe
npm run build                        # 构建 Rust workspace + 渲染层
npm start                            # 启动应用（npx electron .）
```

首次启动后在 **设置 → 模型** 里填自己的 provider（OpenAI 兼容协议的地址、模型名、API Key），
Key 存进 Windows 凭据管理器，不落库、不进仓库。

安装排障（Windows）：

- `npm ci` 后 vite/electron 不可用 → npm 阻止了 postinstall，执行 `npm install-scripts approve esbuild electron` 再 `npm rebuild`
- electron 二进制下载失败 → `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx install-electron --no`
- 检查脚本默认读 `target\debug\withu-server.exe`；换构建产物时用 `WITHU_SERVER_BINARY` 指过去

## 当前能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 文字对话（Comfort 模式） | ✅ | 流式回复，人格由 soul 模板注入，系统提示带当前时间与时区 |
| 提醒 / 日程 / 草稿 | ✅ | 模型出结构化工具提案 → 消息内审批卡 → 显式允许才落盘；取消零副作用，重复确认不重复执行 |
| 主动提醒（系统通知） | ✅ | 默认开启，可设安静时段；通知为通用文案（不含提醒内容，隐私取舍）；点击回到窗口 |
| 记忆 | ✅ | 候选以原子通知出现，用户显式保存；删除走墓碑不复活；中文语义检索不可用时如实降级 |
| 语音（豆包全双工 / 端到端） | ✅ 部分 | 通话结束恢复此前正在播放的本地媒体；真实声学未验收 |
| MCP App 内联渲染 | ✅ | 工具结果里的 MCP App 用 `withu-app:` 特权协议装载（独立源 + 独立 CSP），可握手、可隐藏重建 |
| 联网检索 | ⚠️ 桩 | 未配置连接器时如实说明，不编造结果 |

## 真机验收入口

| 场景 | 怎么做 |
|---|---|
| 通知四项（弹出 / 点击回窗口 / 安静时段 / 退出后零主动） | [docs/manual-acceptance-2026-10-28.md](docs/manual-acceptance-2026-10-28.md) §1–4 |
| MCP 端到端（工具调用 + 内联 App） | 先完全退出 Withu，再双击 `checks\run-with-mcp.cmd`（它会给这次进程挂上本地 MCP 服务器），然后说「用本地工具记一条注记：上课」 |
| 最小化后重建 | 上面那步之后，记下 App 里的 4 位 token，最小化 3 秒再恢复，token 变了就是重建成功 |

MCP 目前**只能通过环境变量启用**（`WITHU_MCP_COMMAND` / `WITHU_MCP_ARGS` / `WITHU_MCP_SERVER`），
还没有设置界面——这是已知缺口，不是 bug。

## 检查

```powershell
npm run check:version        # 5 处版本号一致
npm run check                # schema / IPC / 公开配置边界
npm run check:chat:tools     # 聊天工具提案线（14 组）
npm run check:realtime:tools # 实时语音工具线（11 组，含通话结束恢复）
npm run check:mcp:app        # MCP App 组件单测（19 项）
npm run check:mcp:client     # MCP 客户端（10 组）
npm run check:mcp:tools      # MCP 工具线（10 组，含 400KiB App 文档）
npm run check:mcp:lifecycle  # 内联 App 握手 / 隐藏释放 / 恢复重建（3 组）
npm run check:chat:gui       # GUI 端到端（5 组）
npm run check:renderer       # 渲染层映射
npm run check:soul           # 人格注入
npm run check:product        # 源码与包内一致性扫描

npm run package:windows      # 打 Windows 包到 output/p1/windows
npm run check:desktop        # 开发态六场景回放（含崩溃/超时/畸形输入）
npm run check:packaged       # 打包态六场景回放
```

`checks/*.mjs` 里的假模型服务都是自建的本地 fixture，**不访问云端**。
构建产物、证据、用户数据、音频一律不提交（`output/`、`target/`、`node_modules/`、`dist/` 已忽略）。

## 目录职责

```
apps/withu-server     本机 server：stdio 生命周期、SQLite、工具执行、凭据
crates/               运行时 / 记忆 / 语音 / IPC 等领域边界
client/withu-window   可信主进程：窗口、托盘、MCP 宿主与 withu-app: 协议
client/withu-preload  预加载桥（通道白名单）
client/withu-renderer React GUI
client/withu-mcp-app  MCP App 宿主与 demo 视图
contracts/v1          版本化 schema、事件、错误
checks/               自动化检查与 fixture（含 run-with-mcp.cmd）
docs/                 证据、发布记录、验收表；docs/audit 有仓库清点结果
```

产品权威：`docs/product/withu-v3-spec.md`。用户当面确认的决定优先于该文档。

## 已知边界

1. 真实模型服务、真实联网连接器、真实声学回声未验收（见冻结记录 §5）
2. MCP 配置只有环境变量入口，无设置界面
3. 通知为通用文案，不含提醒内容
4. Windows 文件版本号是 `0.3.1-go.5`（非数值型），未签名的包会触发 SmartScreen
5. 抽屉式 MCP App 入口已随死代码删除，如需该形态属新功能

## 历史阶段

阶段记录、每轮的根因与取证都在仓库里，不必翻 README：

- 发布记录：[docs/releases/](docs/releases/)（go2 → go5，go5 含逐次打包）
- 证据库：[docs/evidence/](docs/evidence/)（通知投递、CSP 阻塞、时钟注入、死代码决策…）
- 已归档文档：[docs/archive/README.md](docs/archive/README.md)
- 验收索引：[docs/demo-acceptance-index.md](docs/demo-acceptance-index.md)
