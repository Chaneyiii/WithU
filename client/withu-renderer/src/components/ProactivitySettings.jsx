import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import Switch from './Switch';
import Select from './Select';
import TimeField from './TimeField';
import './ProactivitySettings.css';

function Setting({ title, subtitle, children }) {
  return <div className="settings-row"><span className="settings-row-text"><span>{title}</span>{subtitle && <small>{subtitle}</small>}</span>{children}</div>;
}

// 时区一律跟着系统走：用户不用选，也不用填 UTC 偏移。
// 每次保存都顺手把当前的系统时区一并写回去，机器换时区后下一次保存就自动纠正。
function systemClock() {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    utc_offset_minutes: -new Date().getTimezoneOffset(),
  };
}

function clockLabel(clock) {
  const sign = clock.utc_offset_minutes >= 0 ? '+' : '−';
  const abs = Math.abs(clock.utc_offset_minutes);
  return `${clock.timezone} · UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export default function ProactivitySettings({ policy, onPolicy }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const clock = systemClock();
  const synced = useRef(false);

  // 首次挂载时把库里存的时区悄悄对齐到系统时区，之后不再重复写入。
  useEffect(() => {
    if (!policy || synced.current) return;
    synced.current = true;
    if (policy.timezone === clock.timezone && policy.utc_offset_minutes === clock.utc_offset_minutes) return;
    (async () => {
      try { await onPolicy({ ...policy, ...clock, version: policy.version + 1 }); } catch { /* 下一次保存会再对齐 */ }
    })();
  }, [policy?.timezone, policy?.utc_offset_minutes]);

  if (!policy) return null;

  async function save(patch) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await onPolicy({ ...policy, ...clock, ...patch, version: policy.version + 1 }); }
    catch { setError('设置未保存，请稍后重试。'); }
    finally { setBusy(false); }
  }
  const toggle = (checked, change, disabled = false) => <Switch checked={checked} onChange={change} disabled={disabled} />;

  return <fieldset className="proactivity-settings" disabled={busy} aria-busy={busy}>
    <h3>主动更新</h3>
    <div className="settings-card">
      <Setting title={t('Allow local reminders and updates')} subtitle="接收本地提醒、低频问候和轻松话题，默认关闭。">{toggle(policy.enabled, enabled => save({ enabled }))}</Setting>
      <Setting title={t('Pause proactive updates')} subtitle="暂时休息，保留当前更新偏好。">{toggle(policy.paused, paused => save({ paused }), !policy.enabled)}</Setting>
      <Setting title="每日更新上限" subtitle="控制每天收到主动更新的数量。"><Select ariaLabel="每日主动更新上限" value={policy.rate_limit} options={[1, 2, 3, 4].map(value => ({ value, label: `${value} 条 / 天` }))} onChange={value => save({ rate_limit: Number(value) })} /></Setting>
    </div>
    <h3>时间与静默</h3>
    <div className="settings-card">
      <Setting title="静默时段" subtitle="在这段时间里暂停主动提醒。">{toggle(Boolean(policy.quiet_hours), enabled => save({ quiet_hours: enabled ? { start_minute: 1320, end_minute: 480 } : null }))}</Setting>
      {policy.quiet_hours && <div className="settings-row proactivity-quiet-times">
        <span className="proactivity-quiet-label">静默开始</span>
        <TimeField ariaLabel="静默开始" value={policy.quiet_hours.start_minute} onChange={value => save({ quiet_hours: { ...policy.quiet_hours, start_minute: value } })} />
        <span className="proactivity-quiet-label">静默结束</span>
        <TimeField ariaLabel="静默结束" value={policy.quiet_hours.end_minute} onChange={value => save({ quiet_hours: { ...policy.quiet_hours, end_minute: value } })} />
      </div>}
      <div className="settings-row proactivity-clock-row">
        <span className="settings-row-text"><span>时区</span><small>按系统时区自动计算，无需手动设置。</small></span>
        <span className="proactivity-clock" aria-label="系统时区">{clockLabel(clock)}</span>
      </div>
    </div>
    <h3>通知</h3>
    <div className="settings-card">
      <div className="settings-row"><span className="settings-row-text"><span>通知预览</span><small>系统通知仅显示通用文案，保护个人内容。</small></span><button className="secondary" onClick={() => setPreview(true)}>{t('Preview test notification')}</button></div>
      {preview && <p className="settings-description proactivity-preview" role="status">{t('Test preview only. No notification was sent.')}</p>}
    </div>
    <p className="settings-description">应用退出时不会发送更新，错过的提醒也不会补发。</p>
    {error && <p className="settings-description" role="alert">{error}</p>}
  </fieldset>;
}
