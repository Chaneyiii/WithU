# 归档说明（2026-10-29）

本目录收的是**已被取代、但保留作为历史依据**的文档。
当前有效文档在 `docs/` 根下与 `docs/releases/`，入口是 `docs/demo-acceptance-index.md`。

## 已移入本目录（6 份）

| 文档 | 原位置 | 为什么归档 | 由谁取代 |
|---|---|---|---|
| `demo-phase0-baseline-2026-10-20.md` | `docs/` | go1 期的 Phase 0 基线审计 | `releases/v0.3.1go5.md` + `manual-acceptance-2026-10-28.md` |
| `demobuddy-file-index-2026-10-18.md` | `docs/` | 另一台机器（`E:\Orbit\demobuddy`）的文件索引 | 已无对应仓库，索引本身失效 |
| `status-2026-10-27.md` | `docs/` | 10-27 的进度快照 | `manual-acceptance-2026-10-28.md` |
| `p0-contract-index.md` | `docs/` | p0 阶段的契约索引 | `p3-acceptance-index.md` / `releases/` |
| `p1-acceptance-index.md` | `docs/` | p1 阶段的验收索引 | 同上 |
| `p2-acceptance-index.md` | `docs/` | p2 阶段的验收索引 | 同上 |

## 已过时但**留在原地**（被多处引用，移动会断链）

| 文档 | 状态 | 说明 |
|---|---|---|
| `releases/v0.3.1go2.md`、`go3.md`、`go4.md` | 过时 | 分别被 4/7/7 处文档引用；最后一版记录 `v0.3.1go5.md` 已含全过程 |
| `delivery-manifest-2026-10-18.json` | 过时 | 6 处引用；正文自认过时，现行清单是 `delivery-manifest-2026-10-28.md` |
| `manual-verification-2026-10-27.md` | 过时 | 6 处引用；现行是 `manual-acceptance-2026-10-28.md` |
| `demo-handover-report-2026-10-18.md`、`demo-pause-handoff-2026-10-18.md` | 过时 | go1 期交接材料，作为背景保留 |
| `p3-acceptance-index.md` | 部分过时 | p3 阶段索引，仍有 4 处引用 |

> 如果以后要真正删除这些，先改引用再删；不要直接删文件。

## 相关

- 全量清点审计：`docs/audit/folder-audit-2026-10-29.md`
- 冻结记录：`docs/releases/freeze-2026-10-29.md`
