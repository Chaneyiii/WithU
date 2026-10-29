# 交付物状态（2026-10-29 13:44，v0.1-rc.4 已与源码对齐）

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
- 压缩包：`output/p1/windows/Withu-v0.1-rc.4-win32-x64.zip`（193,316,509 B）
- 构建提交：`5f14841`+`06bbfc9`+本轮帧上限修复（工作区干净）

| 文件 | SHA-256 |
|---|---|
| `Withu.exe` | `54623193d6d0128bce4a26862e20192cc9cc5effded4f7fcc2f9bff8e1b8c290` |
| `withu-server.exe` | `a0ff300c5ff487296818655ce02c9f1095d78eb4d21d93ceaf72ee01d797ef4a` |
| `app.asar` | `ad2722b5451e1891446219084361bcd230d05a6c0172f7be83cce4a225f9f00d` |
| `Withu-v0.3.1go5-win32-x64.zip` | `382690b703371f014a2aa7e2ec21fbb3fcd5004d18281d2cea716508006f7354` |

包内抽查（拆 asar / 扫二进制）：

- bundle = `client/withu-renderer/dist/assets/index-pDVQWAYq.js`，含 `withu-app://doc/` 与 `payload.app` 校验文案
- `main.cjs` 含 `readResource` 与 `mcpAppUris`（B1 宿主资源读取）
- `withu-server.exe` 含「现在是 」（时钟注入）与 A4 文案「这条提醒已经有了」
- asar 内**没有** `ResponseCard` / `LifeToolsPanel`（死代码已删）

## 3. 与源码的对应

本轮四个产品改动全部在包里：

| 提交 | 改动 | 位置 |
|---|---|---|
| `1ac1d98` | A4 双入口幂等 | `withu-server.exe` |
| `dc2b1fe` | B6 无 UI 能力降级 | asar 内 `dist` |
| `21302fc` | B1 宿主资源读取 + 渲染层 `payload.app` 契约 + M4 检查 | `main.cjs` + `dist` |
| `26a6744` | 版本串统一 | `dist` |
| `d8fe1d1` | 系统提示注入当前时间与时区（文本 + 语音）+ 删除两处死代码 | `withu-server.exe` + `dist` |

该包上复跑：`check:product` PASS（357 源 / 237 包内）、`check:packaged` 六场景 6/6 PASS。

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
- **真实模型的相对时间换算**：时钟已注入，但真 provider 下「两分钟后提醒我」是否稳定走通仍需复测（T17-C）。

## 6. 剩下的事

1. T17-C 真机验收（六项，需要用户本人）。
2. 决定 Windows 版本号口径，或安装 rcedit 后重打一次。
3. T17-A 冻结终审：逐 T 项核对四层记录，锁定提交与标签。
