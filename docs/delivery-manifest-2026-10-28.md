# 交付物状态（2026-10-28，过渡版）

> 这不是最终交付清单。冻结重打包之后，`npm run package:windows` 会生成
> `output/p1/windows/manifest.json`（三哈希 + 版本），届时以那份为准，并把本文标注为历史。
> 之所以先写这一份：现在的包**落后于源码**，只看包会误判。

## 1. 版本三元组

| 项 | 值 | 来源 / 备注 |
|---|---|---|
| 显示版本 | `v0.3.1go5` | `VERSION` 与 `client/withu-renderer/src/version.js`（`check:version` 绑定 5 处） |
| npm / Electron | `0.3.1-go.5` | 根 `package.json`；6 个 client 子包仍是 `0.3.1-go.4`（运行时无影响） |
| Windows 文件版本 | **实际 `0.3.1-go.5`** | 取值自根 `package.json`。发布记录里写的 `0.3.1.5` **不成立**：本机没装 `@electron/rcedit`，`packager` 静默跳过 PE 元数据改写 |

## 2. 当前包

- 路径：`output/p1/windows/Withu-win32-x64/Withu.exe`（未签名，无 zip）
- 三哈希（实测）：

| 文件 | SHA-256 |
|---|---|
| `Withu.exe` | `288b58ac9e17365526b9f8a845eb8607958982de1dac95e626466b119de60f6c` |
| `withu-server.exe` | `cbb95211f5dcbdad1c199c1181828508bd30340c78ca75c8b0aad294520c0902` |
| `app.asar` | `ac4874ab86c6d3ceb0e12a4a8b2efd9910e300cbfb56c177659bc011c15ad588` |

- 该包构建于提交 `dace75c`（2026-10-28 00:24）。

## 3. 包与源码的差距（重要）

包构建之后又落了两个产品改动，**包里没有**：

| 提交 | 改动 | 在包里的位置 |
|---|---|---|
| `1ac1d98` | A4 双入口幂等（同一句话不产生两条提醒） | `withu-server.exe` —— **缺** |
| `dc2b1fe` | B6 无 UI 能力降级（协商失败给文字、不留空框） | `app.asar` 内 `dist` —— **缺** |

`check:product` **发现不了这两处**：它扫描源码时跳过 `dist`，扫包内只查禁用词与文件计数，既不比对 `dist` 内容也不比对 server 二进制。

## 4. 检查现状（2026-10-28 13:4x 实测）

| 检查 | 结果 |
|---|---|
| `check:version` | PASS（5 处一致） |
| `check:chat:tools` | PASS 14 |
| `check:realtime:tools` | PASS 11（2 秒内退出） |
| `check:mcp-app` | 19 pass |
| `check:chat:gui` | PASS 5 |
| `check:product` / `check:packaged` / `check:desktop` | PASS（各 6 场景） |
| `cargo test` | 12 个 crate 126 项全绿；server 自有 42 项因安全策略拒绝写 `deps/withu_server-*.exe` **未跑** |

## 5. 未闭合（交接时必须如实写）

- **真实服务**：真实模型、真实联网连接器、语音真实后端，全部未接入（fixture 只证明接线）。
- **真机**：Windows 通知点击回跳、安静时段、暂停、退出后零主动、M4 隐藏窗口释放 iframe、MCP 读写端到端、图标 —— 见 `manual-verification-2026-10-27.md`。
- **参考对照（A6）**：B.6/B.7/B.19/B.21 仍为空；roadmap 规定空着按「未参考」处理。
- **M4 自动化**：隐藏窗口后 iframe 归零目前只能人工看。
- **交付形态**：无 zip；Windows 文件版本号非数值（见 §1）。

## 6. 冻结前必做

1. 重打包（含 A4/B6），重跑 `check:product` + `check:packaged` 六场景。
2. 用新包三哈希替换本文 §2，并写入 `releases/v0.3.1go5.md`。
3. 决定 Windows 版本号：写实际值 `0.3.1-go.5`，或安装 `@electron/rcedit` 后重打包得到 `0.3.1.5`。
4. 需要 zip 就一并产出并记录 zip 哈希。
