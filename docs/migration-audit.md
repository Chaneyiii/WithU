# 迁移候选审计（P0）

来源：spec §3.2–§3.4、附录 D 仅作资产定位。下面只记录与产品无关的约束候选。
P0 没有复制旧实现、测试、表结构、配置、RPC、路由或报告，也没有兼容层。
“保留”表示保留工程约束，所有实现按 v3 schema 重写；候选存在不表示迁移完成。

| 来源（只读定位） | 通用工程约束 | 保留/重写边界 | 丢弃语义与状态 |
|---|---|---|---|
| E:/Orbit/withu-desktop-v2/backend/crates/withu-agent-memory/src/sqlite_store.rs（version 字段与更新） | 版本递增与冲突检测 | 保留思想；重写为 v3 对象/状态版本、墓碑与派生来源检查 | 旧 SQL 表、旧记忆分类和旧 fixture；尚未迁移存储 |
| E:/Orbit/withu-desktop-v2/backend/crates/withu-server/src/approval.rs | 可见动作与批准范围一致 | 保留范围约束；重写为 Manual/Auto、逐动作 Allow 和版本绑定 | 旧授权模型、来源产品决策、旧 RPC；未复制代码 |
| E:/Orbit/withu-desktop-v2/backend/crates/withu-agent-provider/src/boundary.rs | provider 候选边界与可检测失败 | 待逐块核查；只能按 v3 schema/error 重写 adapter | 旧 prompt、旧默认配置、产品政策、通用故障转移 |
| E:/Orbit/withu-plus/runtime/crates/withu-voice/src/lib.rs | 输入生命周期、幂等取消与资源清理候选 | 只作后续只读资产入口；按统一 speech session 全部重新验收 | 旧语音流程不能证明 duplex 或 backend 策略完成 |
| spec §5.1–§5.3 指定 GUI source | 窗口/主题/菜单/i18n 等工程资产 | 下一阶段逐块命名清洗、接 server 权威状态，保留用户指定布局 | 专属账户/支付/训练/bundle，不保留旧产品接口 |

P0 资产核查只确认以上本地路径及版本/审批结构线索。候选代码未经全部审查，不能据此宣称安全复用。
旧阶段门槛和报告一律丢弃为验收依据；源仓库内容未改动。withu/ 是新用户数据 namespace，
不检测或导入旧数据，不新增“旧数据自动升级”分支。
