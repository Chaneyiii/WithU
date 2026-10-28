# 真实模型不知道当前时间（2026-10-28）

类别：集成修复（提示词缺上下文）　症状来源：真实 provider 实测

## 1. 症状

用户对真实模型说「提醒我两分钟后去上课」，模型回答：

> 我还是看不到现在几点，所以「两分钟后」对我来说落不到具体时刻上。你随手看一眼手机，
> 报个时间给我（比如「14:32」），我马上帮你建好这条提醒。

也就是说：模型**不敢直接建提醒**，反过来问用户要时间。链路本身没坏，是它没有时钟。

## 2. 根因（读代码确认）

系统提示由 `apps/withu-server/src/main.rs::identity_prompt` 拼装，内容只有：

1. `SOUL_MD`（人格正文）
2. 名字规则
3. `guidance`（工具只提案、不许猜参数）

**没有任何当前时间/日期/时区**。语音路径 `realtime.rs` 的 `instructions` 也一样
（人格 + 名字 + 语言/安全规则 + 提案规则）。

而工具要的是绝对时间：`create_local_reminder` 的必填参数是
`due_at_local` + `timezone`（IANA 名）。模型没有「现在」，就没法把「两分钟后」换算成
`14:51`，于是按提案规则里「缺少参数不要猜」的要求，去问用户。

补充证据：`grep -rn "当前时间\|current time" apps/withu-server/src/*.rs` 为空——
这个上下文从来没被注入过；能跑通「明天下午三点」是因为那是绝对说法，不依赖当前日期。

## 3. 修法

`main.rs` 新增两个函数：

- `local_zone_name(offset_seconds)`：`chrono::Local` 只给 UTC 偏移、不给 IANA 名，
  所以用当前偏移在候选表里匹配（Asia/Shanghai、Asia/Taipei、Asia/Tokyo、Europe/London、
  America/New_York……），偏移为 0 直接 `UTC`。
- `local_clock_line()`：产出 `现在是 2026-10-28 14:49（Asia/Shanghai，UTC+08:00）。`

文本系统提示改为三条规则，第三条就是这句话 + 换算要求；语音 `instructions` 追加同样一条
（规则 3）。

实测截取（真实 server，本地 SSD fixture 上游）：

```
3. 现在是 2026-10-28 14:49（Asia/Shanghai，UTC+08:00）。 用户说「两分钟后」「明天下午三点」
   这类相对或口语时间，一律以这个时刻和时区为基准换算；调用工具时 due_at_local 与 timezone
   用同一时区，不要向用户索要当前时间或时区。
```

## 4. 断言（防回归）

- `check:chat:tools`：系统提示必须匹配
  `现在是 \d{4}-\d{2}-\d{2} \d{2}:\d{2}（<zone>，UTC±HH:MM）`
- `check:realtime:tools`：语音 `instructions` 必须包含 `现在是 YYYY-MM-DD HH:MM`
- `check:soul` 仍通过（人格注入未被挤掉）

## 5. 边界（如实记）

- **时区名是推断出来的**：同一偏移可能对应多个 IANA 区（如 +08:00 有上海/台北/香港/新加坡）。
  候选表按常见度排序取第一个，因此 +08:00 会记成 `Asia/Shanghai`。对「几分钟后」「明天」
  这类换算没有影响（同一时刻）；只有跨 DST 切换点的远期日程，理论上会因选错区而偏一小时。
- 时间**每轮重新计算**，不做缓存。
- 这次只保证模型「拿到时间」；真实模型是否会正确换算、是否会稳定调用工具，仍属
  T17-C 真机验收（需要在真实 provider 上复测「两分钟后提醒我」）。

## 6. 顺带完成：删除两处死代码

同一提交里按用户决定删除：

| 文件 | 行数 | 原因 |
|---|---|---|
| `ResponseCard.jsx` | 136 | 唯一渲染点依赖 `m.responseCard`，服务端无 `response_card`、渲染层也不构造 → 永不渲染 |
| `LifeToolsPanel.jsx` | 64 | 没有任何文件 import |
| `MediaBoundaryPreview.jsx` | 15 | 只被 `ResponseCard` 使用 |
| `life-tools.css` | — | 只被 `LifeToolsPanel` import |

同时移除 `Chat.jsx` 中 `ResponseCard` 的 import/渲染行与 `onOpenDrawer` 属性，以及
`App.jsx` 里只服务于它的 `openDrawerApp` 与属性传递。

影响：用户可见**无变化**（都渲染不到）；`check:chat:gui` 仍 PASS 5；
`check:product` 的源文件数 361 → 357。详见
[dead-code-decision-2026-10-28.md](../dead-code-decision-2026-10-28.md)。
