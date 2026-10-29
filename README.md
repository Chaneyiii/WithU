<div align="center">

# Withu

### 本地优先的桌面陪伴 Agent

[English](README.en.md) · 中文

把对话、提醒、日程、草稿与记忆都放在你自己的机器上

<a href="docs/releases/freeze-v0.1-rc.4.md">冻结记录</a> · <a href="docs/manual-acceptance-2026-10-28.md">真机验收</a> · <a href="docs/demo-acceptance-index.md">文档地图</a> · <a href="https://github.com/Chaneyiii/WithU/issues">Issues</a> · <a href="https://github.com/Chaneyiii/WithU/releases">Releases</a>

<p>
  <a href="https://github.com/Chaneyiii/WithU/commits/main"><img src="https://img.shields.io/github/last-commit/Chaneyiii/WithU?color=c4f042&labelColor=black&style=flat-square" alt="last commit"></a>
  <a href="https://github.com/Chaneyiii/WithU"><img src="https://img.shields.io/github/stars/Chaneyiii/WithU?labelColor=black&style=flat-square&color=ffcb47" alt="stars"></a>
  <a href="https://github.com/Chaneyiii/WithU/issues"><img src="https://img.shields.io/github/issues/Chaneyiii/WithU?labelColor=black&style=flat-square&color=ff80eb" alt="issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?labelColor=black&style=flat-square" alt="license"></a>
  <a href="https://github.com/Chaneyiii/WithU"><img src="https://img.shields.io/badge/version-v0.1--rc.4-369eff?labelColor=black&style=flat-square" alt="version"></a>
</p>

</div>

***

## What is Withu

Withu 是一个跑在本机的桌面陪伴应用。Electron 负责窗口，**Rust server 持有全部持久化**（SQLite），模型调用走你自己配置的 provider。

大多数"AI 助手"把记忆和日程放在云端：你只能相信它记住了，看不到它到底存了什么。Withu 反过来——每个提醒、每条记忆、每次工具调用都落在本机数据库里，界面上能翻、能改、能删；模型只是提议者，**真正写入需要你点一次允许**。

它不做的事同样明确：不替你发消息、不悄悄联网、不在没有依据时编一个答案。

## Why Withu

- **模型提案，用户裁决。** 提醒/日程/草稿的创建、编辑、删除都要经过消息内审批卡：允许一次才落盘，取消零副作用，重复确认不重复执行，改期后旧卡自动失效。 → [验收 §1](docs/manual-acceptance-2026-10-28.md)
- **诚实降级，不留空白。** 联网检索未配置时如实说明；MCP App 连不上时降级成文字卡而不是空框；语义检索不可用时回退并说明。 → [B6 降级证据](docs/evidence/mcp-app-csp-blocked-2026-10-29.md)
- **运行时 App 跑在独立源里。** MCP App 不走 `srcdoc`（会继承宿主 CSP 并吞掉第三方脚本），改用 `withu-app:` 特权协议装载：独立源、独立 CSP、可隐藏释放、可恢复重建。 → [为什么这样做](docs/evidence/mcp-app-csp-blocked-2026-10-29.md)
- **主动打扰是有限的。** 通知默认通用文案（不含提醒内容）、可设安静时段、完全退出后不再有任何主动行为。 → [验收 §3–4](docs/manual-acceptance-2026-10-28.md)
- **密钥只进凭据管理器。** provider 的 API Key 存 Windows 凭据库，不落数据库、不入仓库；配置里只有引用 ID。 → [安全检查](#security-and-privacy)

## Proof it works

当前版本 **`v0.1-rc.4`**（构建提交与四哈希见冻结记录）。

| 验证 | 结果 |
|---|---|
| 自动化检查 | 15 组全绿：`chat:tools 14` / `realtime:tools 11` / `output-safety 25` / `mcp:app 19` / `mcp:client 10` / `mcp:tools 10` / `mcp:lifecycle 3` / `chat:gui 5` / `renderer 6` / `product 357·237` / `packaged 6/6` / `desktop 6/6` |
| 真机验收（人工） | 通知弹出 / 点击回窗口 / 安静时段 / 退出后零主动 / MCP 内联 App 握手 / 最小化 3 秒重建 —— **6 项全过** |
| 打包 | `output/p1/windows` 未签名；四哈希与冻结记录逐字节一致 |

四哈希、检查明细、已知缺口见 [冻结记录](docs/releases/freeze-v0.1-rc.4.md)。

## Quick start

需要 Windows、Rust/Cargo、Node.js 20+、Git。

```powershell
npm ci
cargo build --workspace --locked     # 产出 target\debug\withu-server.exe
npm run build                        # 构建 Rust workspace + 渲染层
npm start                            # 启动应用
```

首次启动后到 **设置 → 模型** 填 provider（OpenAI 兼容地址 / 模型名 / API Key），Key 进 Windows 凭据管理器。

<details>
<summary>Windows 安装排障</summary>

- `npm ci` 后 vite/electron 不可用 → npm 阻止了 postinstall：`npm install-scripts approve esbuild electron` 再 `npm rebuild`
- electron 二进制下载失败 → `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx install-electron --no`
- 检查脚本默认读 `target\debug\withu-server.exe`；换产物时设 `WITHU_SERVER_BINARY`

</details>

### 打包与真机验收

```powershell
npm run package:windows     # 输出到 output/p1/windows
npm run check:packaged      # 打包态六场景回放
```

MCP 端到端验收：先完全退出 Withu，双击 `checks\run-with-mcp.cmd`（给这次进程挂上本地 MCP 服务器），
然后说「用本地工具记一条注记：上课」。看到 `annotated:上课` + 一行「本地 MCP App 已连接」即通过。
最小化 3 秒再恢复，App 内 4 位 token 变化 = 会话释放并重建。

## 能力现状

| 能力 | 状态 | 边界 |
|---|---|---|
| 文字对话（Comfort） | ✅ | 流式；系统提示注入当前时间与时区，相对时间可换算 |
| 提醒 / 日程 / 草稿 | ✅ | 全部走审批卡；取消零副作用 |
| 主动提醒 | ✅ | 系统通知 + 安静时段；文案不含内容 |
| 记忆 | ✅ | 显式保存、删除走墓碑；语义检索不可用时降级 |
| 语音（豆包全双工） | ✅ 部分 | 通话结束恢复本地媒体播放；真实声学未验收 |
| MCP App 内联 | ✅ | `withu-app:` 协议；仅环境变量可配置，无设置界面 |
| 联网检索 | ⚠️ 桩 | 未配置时如实说明 |

## 架构

```
Electron main ──stdio──> withu-server (Rust)
     │                        │
     │  withu-app: 协议        ├─ SQLite（会话/提醒/记忆）
     ├─ 内联 MCP App           ├─ 工具执行（提案 → 审批 → 落盘）
     └─ 窗口 / 托盘 / 通知     └─ Windows 凭据管理器（API Key）
```

| 目录 | 职责 |
|---|---|
| `apps/withu-server` | 本机 server：stdio 生命周期、SQLite、工具执行、凭据 |
| `crates/` | 运行时 / 记忆 / 语音 / IPC 等领域边界 |
| `client/withu-window` | 可信主进程：窗口、托盘、MCP 宿主与 `withu-app:` 协议 |
| `client/withu-preload` | 预加载桥（通道白名单） |
| `client/withu-renderer` | React GUI |
| `client/withu-mcp-app` | MCP App 宿主与 demo 视图 |
| `contracts/v1` | 版本化 schema、事件、错误 |
| `checks/` | 自动化检查与本地 fixture（不访问云端） |
| `docs/` | 证据、发布记录、验收表、仓库清点 |

## 检查

| 命令 | 覆盖 |
|---|---|
| `npm run check:version` | 5 处版本号一致 |
| `npm run check` | schema / IPC / 公开配置边界 |
| `npm run check:chat:tools` | 聊天工具提案线（14 组） |
| `npm run check:realtime:tools` | 实时语音工具线（11 组） |
| `npm run check:mcp:app` / `mcp:client` / `mcp:tools` | MCP 组件、客户端、工具线（19 / 10 / 10） |
| `npm run check:mcp:lifecycle` | 内联握手 / 隐藏释放 / 恢复重建（3 组） |
| `npm run check:chat:gui` | GUI 端到端（5 组） |
| `npm run check:product` | 源码与包内一致性扫描 |
| `npm run check:desktop` / `check:packaged` | 开发态 / 打包态六场景回放 |

## 文档地图

- **冻结与发布**：[freeze-v0.1-rc.4.md](docs/releases/freeze-v0.1-rc.4.md) · [releases/](docs/releases/)
- **证据库**：[docs/evidence/](docs/evidence/)（通知投递、CSP 阻塞、时钟注入、死代码决策…）
- **真机验收**：[manual-acceptance-2026-10-28.md](docs/manual-acceptance-2026-10-28.md)
- **产品权威**：[docs/product/withu-v3-spec.md](docs/product/withu-v3-spec.md)（用户当面确认优先于文档）
- **历史归档**：[docs/archive/README.md](docs/archive/README.md)

## Community & Contributing

- **Issue**：bug 与新功能都欢迎，建议附上复现步骤与相关证据目录
- **改动流程**：先加一条会失败的断言 → 修 → 断言转绿 → 重打包 → 更新冻结记录里的哈希
- **提交规范**：一个提交只做一件事，提交信息写清"症状 / 根因 / 验证"
- 详见 [CONTRIBUTING.md](CONTRIBUTING.md)

## Security and privacy

- API Key 只进 Windows 凭据管理器，数据库只存引用 ID；仓库与日志里没有明文密钥
- 内联 MCP App 跑在 `withu-app:` 独立源 + `sandbox="allow-scripts"` 里，无同源权限、无网络能力
- 所有遥测/联网行为需用户显式配置；未配置时如实降级，不静默外发
- 漏洞报告：请开 issue 并标注 `security`，不要公开利用细节

## License

Apache License 2.0，全文见 [LICENSE](LICENSE)。Copyright © 2026 Withu contributors.

<details>
<summary>历史阶段（go1 → go4）</summary>

阶段记录与每轮根因都在仓库里：

- [releases/v0.3.1go2.md](docs/releases/v0.3.1go2.md) · [go3](docs/releases/v0.3.1go3.md) · [go4](docs/releases/v0.3.1go4.md) · [go5](docs/releases/v0.3.1go5.md)
- [docs/archive/](docs/archive/README.md) 存放已被取代的交接与阶段材料
- [docs/demo-acceptance-index.md](docs/demo-acceptance-index.md) 是全部文档的入口索引

</details>
