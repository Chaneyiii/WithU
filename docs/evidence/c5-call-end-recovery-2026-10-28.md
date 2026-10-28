# 验收补证：C5 通话结束后恢复投递（2026-10-28）

类别：验收补证（T16-C「语音与通知协调」的后半句）

## 1. 缺什么

`withu:proactivity:candidate_offer` 在通话进行中会返回 `suppressed / voice_busy`（C5 前半句，已有断言）。
但「**通话结束后策略恢复**」这一半此前没有断言：旧实现找不到结束通话的命令形状，断言被删掉了。
只验前半句的话，「一直忙」和「忙完恢复」在测试上无法区分。

## 2. 命令形状（本轮确认）

```js
await owner.request('withu:realtime:command', {schema_version:1, scope, command:'end'});
```

`scope` 用 `withu:realtime:start` 返回的完整 scope（`voice-scope` 契约）。服务端在
`realtime.rs::command` 里对 `end` 只校验 scope 与 session 是否匹配，然后 `self.end(session_id)`，
不占用音频发送通道，因此随时可调用。

## 3. 断言（`check:realtime:tools` 第 9、10 条）

1. 通话进行中（`stillBusy`）：即使**把主动性策略打开**，候选仍返回 `voice_busy` —— 说明这道闸在策略之前。
2. `command:'end'` 之后轮询投递（最多 120 × 50ms）：拿到 `decision: eligible`，说明策略闸重新生效。

顺序上先打开策略再验，是为了避免「恢复」其实只是「换了个抑制原因（disabled）」——这是本条断言的关键设计。

## 4. 验证

`node checks/realtime-tools.mjs` → **PASS 11**（原 10 条 + 1 条恢复）；整条检查仍在 2 秒内自行退出。
新增两条输出：

```
- C5: an active call suppresses candidates with voice_busy before the policy gate
- C5: ending the call restores normal candidate delivery
```

## 5. 边界

- 这是**服务端策略**层面的恢复；真实声学设备上「挂断后是否立刻不再打扰」仍归 T17-C 真机验收。
- `voice_busy` 的判定是「任一 realtime 会话 `active`」；如果用户开两个会话，结束其中一个不会恢复投递 —— 符合「还在通话中就不打扰」的意图，未额外设断言。
