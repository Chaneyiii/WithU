# 集成修复证据：版本串单一来源（2026-10-28）

类别：集成修复（代码在、行为错）　关联：J / T17-D 版本三元组、T17-C 关于页视觉验收

## 1. 缺陷

同一包里两个版本常量互不引用：

| 位置 | 原值 | 用途 |
|---|---|---|
| `client/withu-window/main.cjs:47` `withuVersion` | `v0.3.1go5` | 窗口标题、MCP client 握手 |
| `client/withu-renderer/src/version.js` `WITHU_VERSION` | `v0.3.1go4` | 关于页（`AboutWithU.jsx:10`）、设置页副标题（`Settings.jsx:45`） |

两者都不读 `VERSION` 文件。实测交付物：`output/p1/windows/.../resources/app.asar` 内只有
`client/withu-renderer/dist/assets/index-CX7qpKqD.js`，内容为 `v0.3.1go4`
→ go5 包的关于页显示 go4，标题栏显示 go5。

`check:product` 未发现的原因：`checks/product-scan.mjs` 扫描源码时显式跳过 `dist`
（`if(['node_modules','dist'].includes(entry.name))continue`），扫包内只查禁用词与文件计数，
**不比较源码 dist 与包内 dist 的内容**。

## 2. 改动

| 文件 | 改动 |
|---|---|
| `client/withu-renderer/src/version.js` | `v0.3.1go4` → `v0.3.1go5` |
| `client/withu-renderer/src/components/AboutWithU.jsx` | 发布于 2026年10月11日 → 2026年10月27日 |
| `checks/version-consistency.mjs`（新增） | 绑定 `VERSION` ↔ renderer 常量 ↔ `main.cjs` 常量 ↔ 根 `package.json` ↔ dist bundle；dist 缺失/带旧串即失败 |
| `package.json` | 新增脚本 `check:version` |

GUI 门禁足迹：`git diff --stat -- client/` = 2 files / 2 insertions / 2 deletions（纯文本、等长）。

## 3. 验证（四层）

| 层 | 证据 |
|---|---|
| 源码实现 | 上述 4 处改动 |
| 自动化 | `npm run check:version` → `PASS version consistency (5 places agree on v0.3.1go5)`；改造前运行同一脚本会报 2 条 FAIL（dist 无 go5 / 残留 go4），证明守卫有效 |
| 构建 | `npm run build` → 新 bundle `dist/assets/index-CrLwisEQ.js`，内含 `v0.3.1go5`、无 `go4` 残留 |
| GUI 回归 | `npm run check:chat:gui` → PASS 5（不白屏 / 卡片本地化并转终态 / 候选胶囊） |
| 真机 | 待重打包后由用户打开「设置→关于WithU」确认显示 v0.3.1go5 |

## 4. 未完成

- **未重打包**：`output/p1/windows` 仍是旧 asar（含 go4 bundle）。重打包会改变三个哈希，
  须同步更新 `docs/releases/v0.3.1go5.md`、manifest，并重跑 `check:packaged` 六场景。
- 6 个 `client/*/package.json` 的 `0.3.1-go.4` 未改（运行时零影响；`package-lock` 工作区版本
  更旧，停在 go.2，动它只会制造新不一致）。
- 首轮 `npm run build` 出现过一次不可复现的 rolldown 插件错误，随后连续两次全绿，未定位。
