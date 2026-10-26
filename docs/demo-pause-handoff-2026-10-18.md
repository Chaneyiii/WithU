# 用户暂停与后续 GUI 要求（2026-10-18）

用户因费用超出承受范围要求立即暂停开发、测试、打包，先完成 D1–D9 状态汇报。未经用户恢复指令，不继续执行任务。

## 已记录、尚未实施的 GUI 改动

1. 主动性与通知设置从 Feed 动态页移入 Settings，复用既有 GUI 组件与 tokens。
2. 用户质疑的“生活支持”入口位于主舞台**右上角**；它与主舞台“生活事务”横条均为集成时擅加的入口，不是方向文档要求的布局。后续收掉常驻入口，依方向文档梳理对话内承载。
3. 常驻侧栏参考下列示例调整颜色，**不改内容**。
4. 顶部栏参考下列示例改为**标签页形式**，并调整颜色。
5. 参考图 URL：
   - https://cdn.collectui.com/media/HKOLZo8aUAAkYFf.avif
   - https://cdn.collectui.com/media/HJu3rRnbsAAZOsK.avif
6. 参考图尚未在本轮打开或分析。以上要求先记录，恢复后统一处理，不自行追加设计。

## 暂停时源码状态

- 实际集成树：`C:/Users/yueeh/.codex/worktrees/d9-demo-closeout`，分支 `codex/d9-demo-closeout`；有大量未提交集成变更，禁止 reset/stash 覆盖或整体 cherry-pick 旧分支。
- 本轮新增 `ProactivitySettings.jsx`、`ProactivitySettings.css` 草稿，尚未接入 Settings，尚未验证。Feed 设置、Chat 右上角支持按钮和生活事务横条**尚未移除或迁移**。
- D3 显式授权记忆保存代码正在收尾；暂停前 agent 报告格式化完成，编译曾遇到运行中 server 文件占用，最终结果尚未确认。不要声明完成。
- D7 agent 已交付本地标准 MCP App 音频与语音 busy 协调，报告 MCP 15 项、realtime-client、Electron iframe 媒体及 Vite 验证通过；真实会话触发、第三方媒体与设备声学未验。
- 本轮 preview session 69746 已停止；相关 agent 已中断或完成。没有运行新的打包或统一提交。
- 版本源码写为 `v0.3.1go1` / `0.3.1-go.1`；尚无本轮完成验收的新 go1 包与哈希。

## 汇报必须保留的真实缺口

- 不能再把独立模块、replay 和 RPC 通过统称为 D1–D9 产品完成。
- D1 没有自然对话情绪推断；D3 semantic index 明确 unavailable，也无会话自动候选提取。
- 当前生产文字 prompt 声明没有可用工具；D4–D7 尚无完整的自然对话委托、工具派发、消息内交互闭环。手动表单不能代替这条链路。
- D5 的本地检索不是联网检索；草稿不会发送。
- D8 本地策略/runner/通知投影已有，但 GUI 位置待纠正；真实 Windows 通知与长时行为未验。
- D9 仍缺最终冻结、统一提交、新包、packaged 六场景、hash/source match 和交付；历史 alpha 包证据不能代替 go1。
- 恢复后子 agent 统一使用用户指定 `gpt-6.1-sol`、中等思考，优先复用、窄任务、避免重复全量扫描和测试。
