# 版本记录

按版本倒序排列。发布说明写明该版本的用户可见变更、验证命令与未完成项；包哈希与源码对应关系见 `docs/delivery-manifest-*.json`。

| 版本 | 日期 | 显示版本 | npm/Electron | Windows 数值 | GitHub Release | 说明 |
|---|---|---|---|---|---|---|
| [v0.3.1go3](v0.3.1go3.md) | 2026-10-25 | v0.3.1go3 | 0.3.1-go.3 | 0.3.1.3 | [已发布](https://github.com/Chaneyiii/WithU/releases/tag/v0.3.1go3) | Demo Phase 2 收口与 GUI 冻结：浏览器抽屉、通知叠卡、日程页重做、打包与任务栏图标修复 |
| [v0.3.1go2](v0.3.1go2.md) | 2026-10-21 | v0.3.1go2 | 0.3.1-go.2 | 0.3.1.2 | [已发布](https://github.com/Chaneyiii/WithU/releases/tag/v0.3.1go2) | Demo Phase 1 界面收口：Chat 命名、灵感动静合并、图标与字体统一、通知胶囊交互 |
| v0.3.1go1 | 2026-10-18 | v0.3.1go1 | 0.3.1-go.1 | 0.3.1.1 | — | 首次 go1 交付包，见 `docs/delivery-manifest-2026-10-18.json` |

## 版本号规则

- `VERSION` 保存显示版本，格式 `vMAJOR.MINOR.PATCHgoN`。
- npm / Electron 版本为 `MAJOR.MINOR.PATCH-go.N`。
- Windows 可执行文件数值四元组由 `checks/package-windows.mjs` 从 `VERSION` 推导：`MAJOR.MINOR.PATCH.N`。
- 已交付版本不复用版本号；冻结后任何源码或包内容变化都要重新核对哈希与源码对应关系。
