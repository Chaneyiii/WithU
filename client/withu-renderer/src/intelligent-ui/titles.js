// D6 审批卡标题本地化：server chat_tools 的 goal_description 是英文固定串，
// 在渲染层统一映射为中文；未知标题原样返回（诚实降级，不吞内容）。
const TITLE_ZH = {
  'Create a local reminder': '创建本地提醒',
  'Edit a local reminder': '修改本地提醒',
  'Delete a local reminder': '删除本地提醒',
  'Add a local calendar event': '添加本地日程',
  'Edit a local calendar event': '修改本地日程',
  'Delete a local calendar event': '删除本地日程',
  'Save a local message draft': '保存消息草稿',
  'Edit a local message draft': '修改消息草稿',
  'Discard a local message draft': '丢弃消息草稿',
};
export function localizedTitle(title) {
  return typeof title === 'string' ? TITLE_ZH[title] ?? title : title;
}
// 回执摘要可读化：server 回执 summary 来自连接器（如 fake-local:life_reminder_create），
// 内部标识不上 UI；映射失败时返回 null（由调用方隐藏该行而不是显示原始 id）。
const RECEIPT_ZH = {
  life_reminder_create: '已创建提醒',
  life_reminder_edit: '已修改提醒',
  life_reminder_delete: '已删除提醒',
  life_reminder_pause: '已暂停提醒',
  life_reminder_resume: '已恢复提醒',
  life_calendar_create: '已创建日程',
  life_calendar_edit: '已修改日程',
  life_calendar_delete: '已删除日程',
  life_draft_create: '已保存草稿',
  life_draft_edit: '已修改草稿',
  life_draft_discard: '已删除草稿',
};
export function receiptSummaryText(summary) {
  if (typeof summary !== 'string' || summary.length === 0) return null;
  const match = summary.match(/^[a-z0-9-]+:([a-z_]+)$/);
  if (match) return RECEIPT_ZH[match[1]] ?? null;
  return summary;
}
