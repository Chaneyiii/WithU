import { t } from '../i18n';
import { WITHU_VERSION } from '../version';
import ModelConfiguration from './ModelConfiguration';
import { api, exportData } from '../store';
import Icon, { IconButton } from './Icon';
import ProactivitySettings from './ProactivitySettings';

export const SETTINGS_TABS = [
  ['general', 'General', 'general'],
  ['proactivity', 'Proactivity', 'feed'],
  ['connectors', 'Connectors', 'connectors'],
  ['permissions', 'Permissions', 'permissions'],
  ['devices', 'Devices', 'devices'],
  ['help-support', 'Help & support', 'help'],
];

export function SettingsCard({ children }) {
  return <div className="settings-card">{children}</div>;
}

export function SettingsRow({ title, subtitle, icon, accessory, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag className="settings-row" onClick={onClick}>
    {icon && <Icon name={icon} size={24} />}
    <div className="settings-row-text"><span>{t(title)}</span>{subtitle && <small>{t(subtitle)}</small>}</div>
    {accessory || (onClick && <Icon name="chevron" size={16} />)}
  </Tag>;
}

export default function Settings({ tab, state, update, onNavigate, onModal, onEditMode, onSourceStudio, status, onRefresh, onNotice, policy, onPolicy }) {
  return <section className="settings-window">
    <main className="settings-main">
      <header className="route-header settings-page-header">
        <div><h1>{t('Settings')}</h1></div>
      </header>
      <nav className="page-tabs" role="tablist" aria-label={t('Settings')}>
        {SETTINGS_TABS.map(([key, label]) => <button key={key} role="tab" aria-selected={key === tab} className={'page-tab ' + (key === tab ? 'active' : '')} onClick={() => onNavigate('settings/' + key)}><span>{t(label)}</span></button>)}
      </nav>
      <div className={'settings-content' + (tab === 'connectors' ? ' settings-connectors' : '')}>
        {tab === 'general' && <><SettingsCard><SettingsRow title="Language" onClick={() => onModal({ type: 'language' })} /></SettingsCard><h3>{t('Appearance')}</h3><SettingsCard><SettingsRow title="Mode" accessory={<div className="theme-control">{['light', 'dark', 'system'].map(mode => <IconButton key={mode} label={mode} icon={mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'system'} className={state.theme === mode ? 'active' : ''} onClick={() => update({ theme: mode })} />)}</div>} /></SettingsCard><ModelConfiguration voice={state.voice} onVoice={voice => update({ voice })} /><p className="settings-description">通知未授权；主动问候、登录启动尚未接入。</p></>}
        {tab === 'proactivity' && (policy ? <ProactivitySettings policy={policy} onPolicy={onPolicy}/> : <p className="settings-description">动态设置暂不可用。</p>)}
        {tab === 'connectors' && <><h3>{t('连接器')}</h3><p className="settings-connection-empty">{t('尚未接入连接器')}</p></>}
        {tab === 'permissions' && <><SettingsCard><SettingsRow title="Manual（默认）" subtitle="动作暂停并逐项询问 Allow / Deny；执行链尚未接入" /><SettingsRow title="Auto（可选）" subtitle="只读可继续；写入或副作用须经规则判断。当前无法启用执行" /></SettingsCard><h3>连接器权限</h3><SettingsCard>{[['Always allow', '工具级偏好，不能越过高影响动作的显式 Allow'], ['Needs approval', '需要逐项批准'], ['Blocked', '禁止该连接器动作']].map(([a, b]) => <SettingsRow key={a} title={a} subtitle={b} />)}</SettingsCard><p>永久删除、购买、付款、发消息、发布、预约确认和账户变化始终需要显式 Allow。</p></>}
        {tab === 'devices' && <><SettingsCard><SettingsRow title="Withu Server" subtitle={status?.status ? `PID ${status.status.pid} · ${status.status.lifecycle} · stdio` : '未就绪'} accessory={<button onClick={onRefresh}>刷新</button>} /><SettingsRow title="启动时间" subtitle={status?.status ? new Date(Number(status.status.started_at)).toLocaleString() : '未知'} /><SettingsRow title="运行资源" subtitle={status?.resources?.length ? status.resources.map(r => `${r.id}: ${r.status}`).join('；') : '当前没有运行中的工作'} /></SettingsCard><p className="settings-description">隐藏或关闭主窗口时应用继续运行；从托盘重新打开。选择“退出 Withu”时，本地 Server 一同退出。</p></>}
        {(tab === 'help-support' || tab === 'data-privacy') && <><SettingsCard><SettingsRow title="关于WithU" subtitle={WITHU_VERSION} onClick={() => onModal({ type: 'about' })} /><SettingsRow title="Keyboard shortcuts" onClick={() => onModal({ type: 'shortcuts' })} /></SettingsCard><h3>{t('数据控制')}</h3><SettingsCard><SettingsRow title="导出用户数据" onClick={() => exportData()} /><SettingsRow title="数据存储" subtitle="本机 Withu Server SQLite；从零建立 v3 数据，不导入旧格式" /></SettingsCard><p>删除会话会同步删除其已提交文字与草稿，并立即从搜索结果排除。长期记忆只保存用户确认且带证据的必要事实；Live 原始音频与逐句转写不入库。</p><p>记忆的查看与管理在活动面板的“身份”标签，通过记忆卡片打开；本页不展示记忆列表。</p></>}
      </div>
    </main>
  </section>;
}
