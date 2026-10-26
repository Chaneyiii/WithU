// T14 记忆候选事件 → 胶囊数据。抽出为纯函数：
// 1) server 的 `memory.candidate.created` payload 是扁平字段
//    （conversation_id/kind/subject/content/state_version/message_id 直接在 data 上）；
// 2) 兼容旧嵌套形状（data.memory_candidate / memory_candidate_created / candidate）。
// 此前渲染层只读嵌套键导致胶囊永远不弹；该模块由 checks/renderer-mapping.mjs
// 用与 server 实发一致的样本回归。
export function memoryCandidateFromEvent(event) {
  const data = event?.data;
  if (!data || typeof data !== 'object') return null;
  const nested = data.memory_candidate ?? data.memory_candidate_created ?? data.candidate;
  // 扁平字段只可能在 memory.candidate.created 事件上出现；其他事件即使
  // 恰好带同名字段也不能当成候选。
  const flatAllowed = event?.record?.event === 'memory.candidate.created';
  const source = nested && typeof nested === 'object' ? nested : (flatAllowed ? data : null);
  if (!source) return null;
  if (typeof source.content !== 'string' || source.content.length === 0) return null;
  if (source.state_version == null || source.message_id == null) return null;
  return {
    conversation_id: source.conversation_id ?? null,
    kind: typeof source.kind === 'string' ? source.kind : 'stable_fact',
    subject: typeof source.subject === 'string' ? source.subject : '记忆',
    content: source.content,
    state_version: source.state_version,
    message_id: source.message_id,
  };
}
