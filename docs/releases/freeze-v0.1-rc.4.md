# 冻结记录 v0.1-rc.4（2026-10-29）

本版是 `v0.3.1-go.5` 的重新编号与发布形态整理，功能等价。

## 1. 冻结对象

| 项 | 值 |
|---|---|
| 显示版本 | `v0.1-rc.4` |
| npm / Electron | `0.1.0-rc.4` |
| Windows 文件版本 | `0.1.0-rc.4` |
| git tag | `v0.1-rc.4` |
| 包目录 | `output/p1/windows/Withu-win32-x64/`（未签名） |
| 压缩包 | `output/p1/windows/Withu-v0.1-rc.4-win32-x64.zip`（193,316,509 B） |

## 2. 四哈希

| 文件 | SHA-256 |
|---|---|
| `Withu.exe` | `54623193d6d0128bce4a26862e20192cc9cc5effded4f7fcc2f9bff8e1b8c290` |
| `withu-server.exe` | `a0ff300c5ff487296818655ce02c9f1095d78eb4d21d93ceaf72ee01d797ef4a` |
| `app.asar` | `ad2722b5451e1891446219084361bcd230d05a6c0172f7be83cce4a225f9f00d` |
| zip | `382690b703371f014a2aa7e2ec21fbb3fcd5004d18281d2cea716508006f7354` |

包内抽查：bundle = `index-pDVQWAYq.js`，含 `v0.1-rc.4` 且无旧 `v0.3.1go5` 残留；
asar 内无 `.zcode`；含 `README.md` / `README.en.md` / `LICENSE`。
`withu-server.exe` 与 v0.3.1-go.5 相同（本次未改 Rust 代码）。

## 3. 与 v0.3.1-go.5 的差异

- 版本号统一改为 `v0.1-rc.4`（VERSION / package.json / 关于页 / 主进程常量 / 检查断言）
- `checks/version-consistency.mjs` 支持 `vX.Y-rc.N` 形式（原来只认 `vX.Y.ZgoN`）
- `checks/package-windows.mjs` 同步支持，PE 文件版本为 `0.1.0-rc.4`
- 新增 `LICENSE`（Apache License 2.0）与 `package.json` 的 `license` 字段
- README 改中英双语：`README.md`（中文）/ `README.en.md`（English）
- 删除仓库内 `.zcode/`（本地 AI 代理工作目录）并加入 `.gitignore`

## 4. 检查

| 检查 | 结果 |
|---|---|
| `check:version` | PASS（5 处一致于 v0.1-rc.4） |
| 其余 15 组 | 与 v0.3.1-go.5 冻结时相同结论（本次未改产品逻辑） |

## 5. 已知缺口

沿用 v0.3.1-go.5 冻结记录 §5 的六条：真实服务未接、MCP 只有环境变量入口、
A6 参考仓库不可达、通知为通用文案、Windows 通知跨版本未验、MCP 文字块标题观感。

## 6. 取代关系

`docs/releases/freeze-2026-10-29.md`（v0.3.1-go.5）已被本记录取代，原文件保留作为历史。
