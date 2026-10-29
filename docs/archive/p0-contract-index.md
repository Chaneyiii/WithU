# Withu v3 P0 契约索引

此文件是实现索引，不定义新产品方向。唯一产品权威：
docs/product/withu-v3-spec.md，v3.3-draft，2026-10-10。
读取时 SHA256：246296ddccbc3ff8e93ae510373a57459bfd087df9f8fa817f656a29db90adbe。
权威顺序：用户明确决定 > 正文 §1–§9 > 附录官方引用 > 第三方背景。
所有本仓库 fixture 均由 v3 代码生成；旧阶段、测试与报告未进入验收。

| 契约 | spec 章节 | schema | 实现/检查 | 后续依赖 |
|---|---|---|---|---|
| 包职责、数据文件命名、独立 Git | §3.2–§3.6 | 1 | Cargo workspace；client 三包；source naming 检查 | GUI 接入保留指定外壳 |
| Client main 持有 server；renderer/window 独立 | R13、§4.1、§4.4、§8.4 | 1 | withu-window；实际子进程/端口回放 | Electron 主进程绑定 |
| status/shutdown、幂等退出、父通道断开 | §4.2、§4.4、§7.1 | 1 | server/shutdown schema；lifecycle.mjs | 接入实际任务与资源注册 |
| 会话八状态、VAD、barge-in、清理 | R02、R14、§4.6 | 1 | speech schema；withu-speech 清理测试 | fake provider 回放，再真实 ASR/TTS |
| 任务、团队、取消、部分产物作废 | R06、R08、§4.2、§4.7、§5.5.4 | 1 | task/team/specialist/message；withu-orchestrator | Primary 队列、依赖与预算调度 |
| Manual 默认、Auto 可选；高影响逐动作 Allow | R07、§4.2、§4.7 | 1 | approval/action；范围/版本/到期/一次使用测试 | 真实规则裁决与审批 UI |
| 稳定事实、证据、当前状态、摘要、可恢复事项 | R05、§4.2–§4.3 | 1 | memory/evidence/relationship-*；`withu-memory` + `withu-storage` SQLite memory v2 | server IPC/GUI 接线与派生检索索引 |
| 墓碑阻止候选、缓存和摘要复活 | §4.3 | 1 | deletion/background-candidate；派生失效与过时读取测试 | 磁盘墓碑、离线 token 与事务竞态 |
| 聚合 provider、原子版本提交、任务固定快照 | R14、§4.8、§8.1–§8.2 | 1 | config/provider；CAS 更新、固定快照、投影检查 | OS 凭据存储、持久原子提交 |
| 会话/项目作用域 | §4.2、§4.5、§5.5 | 1 | conversation/project；跨域索引边界 | 同一 server 索引与两模式列表 |
| 情绪候选、用户明示优先、支持计划 | §4.2、§4.9 | 1 | affect/support/outcome；withu-affect；未确认写入拒绝 | 本地 Laya、校准、误判恢复 |
| 最小审计、事件、错误分类 | §3.6、§4.3、§4.8 | 1 | audit/event/error schema；严格字段负例 | durable audit 与真实事件流 |
| 定时任务仅应用运行期间 | R04、§4.4、§5.5.4、§8.3 | 1 | scheduled-task；授权/暂停/应用门控 | 调度与通知权限 |

## 契约解释与停止条件

- IPC 白名单以 §3.6 命名和 spec 附录 E.1 示例为边界。domain 后的 verb 可有显式子动作，
  例如 withu:speech:backend:activate；不从字符串模式推导权限。正文仅给一般形式，附录给
  合法细分示例，P0 保留该示例，记录这种命名粒度。
- §4.9.2 要求本地 Laya；附录 B.20 第 1 项提及外部 Laya 服务，范围不一致。
  按正文采用本地适配器，不向维护者上传原始文本、音频或概率。LLM fallback 必须标来源。
- §3.3 排除旧测试；§5.2 将 GUI 存储/smoke 测试列为可保留。P0 按用户明确要求全部新建测试，
  未迁入旧测试结论或 fixture。
- §3.6 状态文件 withu-state-v1.json 与 §5.2 缓存旧壳命名示例有差异。
  P0 采用正文工程命名：用户数据 namespace withu/、withu-state-v1.json、withu-data-export.json。
- §9 的“本次只修订文档”描述源文档编写范围；本次用户明确授权目标仓库实现。
  外部历史代码与文档保持原样。
- schema_version=1 是尚未发布的 P0 序列化合同版本（本次修正闭合初始草案），config_version、对象 version、policy_version 和
  authorization_version 是各自的递增版本，不能互相代替。
- 情绪假设类型只属于当前回合，不属于可提交长期库的 MemoryKind。用户明确经历可转换为
  ExplicitExperience，但必须独立 save_permission、confirmed 和非空 source_evidence（id/version）。
  MemoryStore 检查来源存在、版本匹配、来源/对象墓碑和当前读取版本；删除来源递归失效派生缓存/摘要。D2 的 `PersistentMemoryStore` 将同一规则放入 SQLite 事务，持久化全局 state CAS、scope、证据/依赖关系和墓碑；启动时向前失败检查 schema/JSON/依赖图。server IPC 与 GUI 尚未接线。
  确认感受不等于允许保存。原 `MemoryStore` 继续作为 P0 内存契约兼容层；D2 的持久 facade 才是 SQLite canonical memory 边界。
- primary_action 是单一枚举，不承载诊断、风险评分或事务授权；事务必须另有明确委托与审批。

## 未决工程参数

生产 shutdown deadline、异常终止与崩溃恢复、Windows Job Object/进程树、生产参数与跨版本迁移、
凭据存储适配器、并发/预算/限流阈值、配置磁盘原子提交、情绪保留期与校准阈值、Laya 固定版本/许可证/来源，
模型下载首批名单均待对应阶段证据。P0 本地测试 timeout=5000ms 仅用于检查，不是产品指标。
Rust edition 2021 是构建选择，无第三方依赖；代码授权许可证尚未由用户确定。

遇到权威正文冲突或需要新增产品决策，停止该项并记录“超出 P0 权威契约”。遇到用户文件冲突、
不安全的 Git 初始化、依赖/工具链失败，保留安全变更并报告具体命令，不引用旧工程验收。

## 范围与后续阶段

P0 完成独立仓库、可构建模块、版本化对象/事件/错误/IPC 和最小可执行不变量。
实际进程只实现 owner stdio status/shutdown（P0 简化 token transport），回环端口租约未承载 HTTP API；
其余 IPC 是冻结边界，尚无 server handler。完整 event/ServerStatus/shutdown 对象是下一阶段协议目标，
当前进程诊断事件是最小 bootstrap 报文，不冒称已实现完整序列化传输。

未实现 GUI 视觉/React 外壳/实际 Electron 绑定、真实 ASR/TTS、Laya worker、外部连接器、主动问候、
完整 Cowork/Primary 调度、server IPC/GUI memory 接线、语义派生检索、真实凭据保存和恢复。SQLite canonical memory v2 已在 D2 交付；依据用户 P0 排除项与 §6 顺序，
这些必须在后续阶段接入后重新验收，不能由 P0 fixture 证明完成。

下一步先按 §6.2 接 GUI 外壳和桥接，再按 §6.3 实现完整生命周期资源注册、持久化与正式报文；
随后 fake speech 回放、聚合配置后端、情绪校准、关系记忆和 Primary/审批。高影响连接器与主动性最后接入。

## 独立验收后的 P0 修正

- 来源注册与删除更新 store 读取版本；墓碑 ID 不可再次注册，换新候选 ID 不能绕过已删证据。
- config/public-config 使用递归闭合字段：model_overrides 仅 llm/asr/tts 的 provider_ref/model_ref，
  speech_preferences 仅 asr.backend_id 和 tts.backend_id/voice_id。无 provider、null 默认模型的空状态合法。
  公共 DTO 不含 credential_ref/credential_refs，未知嵌套字段在投影前拒绝；字段仅描述已有选择边界。
- runtime ApprovalRequest 仅描述记录，移除 permits；唯一执行许可入口为 ApprovalAuthority.consume。
  grant 私有不可 Clone，issue 要求显式 Allow；批准 ID 不可重复导入，消费状态留在 authority。
  高影响 Auto 不绕过用户 Allow；范围、policy/auth 版本、到期和撤销均检查。
  P0 record 的输入是 server 已验证来源的批准记录，尚未接真实用户批准 transport。
- status 请求串行并使用各自事件游标，连续或并发请求不能读旧响应。正式 request_id transport 留后续阶段。

### 删除对象及派生图边界补充（§4.3）

删除已保存 memory 会同时墓碑其 source_evidence ID，并排除使用这些证据的其他候选/对象与派生缓存/摘要。
P0 以 evidence ID 作为最小删除范围；使用共享证据的对象也会失效，不相关 evidence ID 保持有效。
删除对应来源后不能用新 memory ID 恢复，也不能重新注册该证据 ID；不做自然语言语义判重。
派生图允许合法多层依赖，但 add_derivative 仅创建新 ID，不允许覆写已有派生、基础对象或证据 ID，
并拒绝自引用；来源须已可见，因此新建节点不能形成环。查询使用当前访问路径集合，
遇到损坏的自环/多节点环返回不可见，删除失效扫描同样使用此防护。
