# 提醒没弹出来：实测取证（2026-10-28 15:07 那次）

结论先说：**服务端到 Windows 平台这一段是通的**——提醒按时建了、候选按时生成、
Windows 也收到了 toast 并在 15:07:22 记了一行。**没有证据表明链路断了**；
断点在「系统有没有真的把横幅画出来」这一段，需要现场确认。

## 1. 数据侧（应用自己的库）

库：`%APPDATA%\Withu\withu\withu-state-v1.sqlite`（只读副本 `output/probe/user-db.sqlite`）

| 事实 | 值 |
|---|---|
| 用户消息 | 「提醒我两分钟后去上课」，submitted_at `1793171106663` = **15:05:06** |
| 提醒条目 | id `chat-d8aa1b93-c84c-4332-9287-22bbdb9fb7ea`，文本「去上课」，`status=active` |
| 提醒到期 | `due_at=1793171220` = **15:07:00**（正好是 15:05:06 + 约 2 分钟） |
| 执行回执 | 回执 `applied`，`observed_at` **15:05:09** |

→ **时钟修复生效了**：模型拿到「现在是 15:05」，自己算出 15:07，没有反问用户。

## 2. 主动投递侧（同一库里的 proactivity 对象）

| 事实 | 值 |
|---|---|
| 策略 | `enabled=true`、`paused=false`、`quiet_hours=null`、时区 `Asia/Shanghai` |
| 候选 | `life-reminder:chat-d8aa1b93…:v1`，标题 `Reminder`，正文「去上课」 |
| 候选生成 | `created_at=1793171242` = **15:07:22** |
| 投递状态 | `notification_status = shown_by_os`，`notification_updated_at` 同为 15:07:22 |

`shown_by_os` 的含义：Electron 主进程调 `new Notification().show()` 后收到了 `show` 事件
（`client/withu-window/proactivity-notifications.cjs`）。这是「已交给系统」，不是「用户看见了」。

## 3. 平台侧（Windows 通知库，只读副本 `output/probe/wpn/`）

库：`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db`

| 事实 | 值 |
|---|---|
| 处理者 | id **425**，AUMID **`electron.app.Withu`**，创建时间 `2026-10-28 07:07:22`（UTC）= **15:07:22 本地** |
| 通知行 | 1 条，`Type=toast`，`ArrivalTime` = `2026-10-28 07:07:22.574` UTC |
| 该处理者设置 | `s:toast=1`、`s:banner=1`、`s:audio=1` → **横幅没被关** |

对照：`Withu.Desktop.App`（id 423）只有 1 条历史（2026-10-27 08:35），
那是还设置自定义 AUMID 的版本；`com.withu.desktop`（id 414）是更早的。

开始菜单快捷方式 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Withu.lnk` 存在，
其内嵌 AUMID 是 `electron.app.Withu`（与 425 一致），目标指向当前包目录。

→ **Windows 确实接收并记录了这条 toast，且横幅开关是开的。**

## 4. 那为什么没看见

按证据排除之后，只剩三种可能：

1. **勿扰/专注助手当时开着**（会拦横幅但通常仍记进通知中心）。
2. **横幅只显示约 5 秒，当时没看那个角落**（尤其在全屏或别的窗口里）。
3. **你说的「提醒窗口」其实是应用内弹窗**——那产品目前根本没有：到点只发系统 toast，
   应用内只有通知胶囊/列表，不会弹窗。

第 3 条不是猜测：`grep -rn "Notification" client/withu-renderer/src` 里没有任何「到点弹窗」逻辑，
应用内的提醒入口是 `NotificationCapsule`（铃铛/列表），不是窗口。

## 5. 怎么一次定论（2 分钟）

现场做一次，盯着屏幕右下角：

1. 应用保持前台，对模型说「**提醒我一分钟后喝水**」。
2. 点「允许一次」。
3. 到点前 5 秒开始看右下角，别切窗口。

然后把结果告诉我。我这边同步查两件事：库里有没有新候选、Windows 有没有新的 toast 行
（以及与上一次相比处理者 id 是否相同）。两者都新增而你没看见 → 是系统侧显示问题
（勿扰/横幅），不是链路问题。

## 6. 附：顺带发现的两处历史遗留

- `checks/icon-package.mjs:21` 仍断言 `app.setAppUserModelId('com.withu.desktop')`，
  而该行已在 `bda4e5e` 被删除，且当前实际 AUMID 是 `electron.app.Withu`——
  这个检查没接进 `npm run check:*`，所以一直没人发现它已经过时。
- 自定义 AUMID 与快捷方式那套在 `bda4e5e` 被移除（当时 `shell.writeShortcutLink` 在本机返回 false），
  但开始菜单里仍留着旧 .lnk；现在两者恰好都叫 `electron.app.Withu`，属于巧合而非设计。
