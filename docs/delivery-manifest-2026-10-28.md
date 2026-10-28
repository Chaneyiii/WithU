# 交付物状态（2026-10-28 14:20，已与源码对齐）

> 本文记录**当前交付包**与源码的对应关系。最终机器可读的 manifest 由
> `npm run package:windows` 生成在 `output/p1/windows/manifest.json`（含三哈希）。

## 1. 版本三元组

| 项 | 值 | 来源 |
|---|---|---|
| 显示版本 | `v0.3.1go5` | `VERSION`、`client/withu-renderer/src/version.js`、`main.cjs` 常量（`check:version` 绑定 5 处） |
| npm / Electron | `0.3.1-go.5` | 根 `package.json`（6 个 client 子包仍是 `0.3.1-go.4`，运行时无影响） |
| Windows 文件版本 | **实际 `0.3.1-go.5`** | 根 `package.json`。发布记录里写的 `0.3.1.5` **不成立**：本机未装 `@electron/rcedit`，packager 静默跳过 PE 元数据改写 |

## 2. 当前包

- 目录：`output/p1/windows/Withu-win32-x64/`（未签名）
- 压缩包：`output/p1/windows/Withu-v0.3.1go5-win32-x64.zip`（192,733,240 B）
- 构建提交：`21302fc`（工作区干净）

| 文件 | SHA-256 |
|---|---|
| `Withu.exe` | `0ca43959285eeb33c0cd4e809453019dd095c702b46a0f6328be7944172ff6f3` |
| `withu-server.exe` | `d49a1cb45ef3fc23991e5210eff1f1f333d9376188fcf61a32b203edd8be5f69` |
| `app.asar` | `bbaa4d24bac496b24325b99dc6d53de1ba0985f754b89d4a618a8efd0836474f` |
| `Withu-v0.3.1go5-win32-x64.zip` | `77b4da24c3523e9017c56584bce25e1739e7b528013df6920b081fa2dff3a89a` |

包内抽查（拆 asar / 扫二进制）：

- bundle = `client/withu-renderer/dist/assets/index-C_UGDV8I.js`，含 `v0.3.1go5` 与 `payload.app` 校验文案
- `main.cjs` 含 `readResource` 与 `mcpAppUris`（B1 宿主资源读取）
- `withu-server.exe` 含 A4 文案「这条提醒已经有了」

## 3. 与源码的对应

本轮四个产品改动全部在包里：

| 提交 | 改动 | 位置 |
|---|---|---|
| `1ac1d98` | A4 双入口幂等 | `withu-server.exe` |
| `dc2b1fe` | B6 无 UI 能力降级 | asar 内 `dist` |
| `21302fc` | B1 宿主资源读取 + 渲染层 `payload.app` 契约 + M4 检查 | `main.cjs` + `dist` |
| `26a6744` | 版本串统一 | `dist` |

该包上复跑：`check:product` PASS（361 源 / 241 包内）、`check:packaged` 六场景 6/6 PASS。

**注意 `check:product` 的边界**：它扫描源码时跳过 `dist`、扫包内只查禁用词与文件计数，
既不比对 `dist` 内容也不比对 server 二进制。所以「PASS」不等于「包是新构建的」——
本轮是靠拆包抽查（上一节）确认的，不能只靠它。

## 4. 检查现状（2026-10-28 14:15 前后实测）

| 检查 | 结果 |
|---|---|
| `check:version` | PASS（5 处一致） |
| `check:chat:tools` | PASS 14 |
| `check:realtime:tools` | PASS 11（2 秒内退出） |
| `check:mcp-app` | 19 pass |
| `check:mcp:lifecycle` | PASS 2 |
| `check:chat:gui` | PASS 5 |
| `check:product` / `check:packaged` / `check:desktop` | PASS（各 6 场景） |
| `cargo test` | 12 个 crate 126 项全绿；server 自有 42 项因安全策略拒绝写 `deps/withu_server-*.exe` **未跑** |

## 5. 未闭合（交接必须如实写）

- **真实服务**：真实模型、真实联网连接器、语音真实后端均未接入（fixture 只证明接线）。
- **真机**：Windows 通知点击回跳、安静时段、暂停、退出后零主动、MCP 读写端到端、物理最小化（M4 的自动化用的是 CDP 页面冻结，不是系统最小化）、图标——见 `manual-verification-2026-10-27.md`。
- **A6 参考对照**：已按官方文档摘录填完（`docs/evidence/a6-reference-matrix-2026-10-28.md`），但 `E:/Orbit/withu-refs` 已不存在，**参考仓库源码这一路未重新对照**。
- **Windows 文件版本号**：实际为 `0.3.1-go.5`（非数值 `0.3.1.5`）。要得到数值版本需先装 `@electron/rcedit` 再打包。
- **死代码**：`ResponseCard`（`responseCard` 无生产者）与 `LifeToolsPanel`（无人 import）没有入口，留 T17-D 决定删除或接线。

## 6. 剩下的事

1. T17-C 真机验收（六项，需要用户本人）。
2. 决定 Windows 版本号口径，或安装 rcedit 后重打一次。
3. 处理两处死代码（删/接线）。
4. T17-A 冻结终审：逐 T 项核对四层记录，锁定提交与标签。
