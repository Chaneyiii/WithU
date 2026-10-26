import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import Icon from './Icon';
import McpAppHost from './McpAppHost';
import { MediaScreen, MediaControls } from './MediaBoundaryPreview';

const previewStates = ['ready', 'loading', 'login', 'approval', 'failed', 'expired', 'closed', 'unavailable'];
const labels = {
  ready: '示例就绪', loading: '加载中', login: '待登录', approval: '待审批',
  failed: '失败', expired: '已过期', closed: '已关闭', unavailable: '未连接',
};

function PreviewPicker({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  return <div className="preview-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span>{t(label)}</span>
    <button className="preview-picker-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>{options.find(option => option.value === value)?.label && t(options.find(option => option.value === value).label)}</span><Icon name="down" size={14}/>
    </button>
    {open && <div className="preview-picker-menu popover" role="menu" aria-label={t(label)}>
      {options.map(option => <button key={option.value} role="menuitemradio" aria-checked={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }}>
        <span>{t(option.label)}</span>{option.value === value && <Icon name="check" size={15}/>}
      </button>)}
    </div>}
  </div>;
}

function ProjectedScreen({ card, cardState, fixture, mode, selected, displayKind, captions, setCaptions, dispatch, close, openSurface, onOpenInDrawer }) {
  const source = card?.source || 'Withu 原生 ResponseCard';
  const canOpenApp = fixture || card?.capabilities?.appSurface === true;
  // App 卡片就绪时把抽屉浏览器顶上来；每张卡只自动弹一次，之后靠消息里的按钮再开。
  const autoOpened = useRef(false);
  useEffect(() => {
    if (onOpenInDrawer && cardState === 'ready' && displayKind === 'app' && !autoOpened.current) {
      autoOpened.current = true;
      onOpenInDrawer();
    }
  }, [cardState, displayKind, onOpenInDrawer]);
  const message = {
    loading: '正在准备界面… 这是本地预览状态。',
    login: '需要登录后继续。当前没有连接器或登录会话。',
    approval: '此操作需要 Withu host 审批。',
    failed: '服务未连接，无法取得真实结果。',
    expired: '此界面会话已过期；不会自动重做之前的动作。',
    closed: '卡片已关闭。你可以继续文字对话。',
    unavailable: '此 host 未连接 MCP 或第三方服务。',
  }[cardState];

  return <div className="response-story">
    {fixture && <div className="response-preview-toolbar">
      <span>{t("开发预览 · 不代表服务已接入")}</span>
      <div className="response-preview-pickers">
        <PreviewPicker label="屏幕" value={displayKind} options={[{value:'search',label:'搜索结果'},{value:'app',label:'MCP App'},{value:'video',label:'视频窗口'},{value:'media',label:'媒体与语音'}]} onChange={value => dispatch({ type: 'display', value })}/>
        <PreviewPicker label="状态" value={cardState} options={previewStates.map(value => ({value,label:t(labels[value])}))} onChange={value => dispatch({ type: 'state', value })}/>
      </div>
    </div>}
    <article className={'response-card' + (displayKind === 'media' ? ' media-response-card' : '')} aria-label="Withu ResponseCard">
      <section className={'response-projection' + (['video', 'media'].includes(displayKind) ? ' projection-media' : '') + (displayKind === 'app' ? ' projection-app' : '')} aria-label={t("交互内容投影幕布")}>
        <div className="projection-screen">
        {cardState === 'ready' && <span className="projection-state state-ready">{t(labels[cardState])}</span>}
        {cardState === 'ready' && displayKind === 'app' && (onOpenInDrawer
          ? <div className="projection-app-hint" role="status">
              <p>{t("这个 MCP App 已在下方抽屉浏览器里打开。")}</p>
              <button type="button" onClick={onOpenInDrawer}>{t("打开抽屉")}</button>
            </div>
          : <McpAppHost variant="inline" proposalContext={card?.proposalContext}/>)}
        {cardState === 'ready' && (displayKind === 'video' ? <div className="projected-video-window" aria-label={t("本地视频窗口预览")}/> : displayKind === 'media' ? <MediaScreen/> : displayKind === 'app' ? null : <div className="projected-results" aria-label={t("搜索结果")}>
          <div><strong>{card?.title || t('本地示例结果')}</strong></div>
          <div><strong>{t("隔离界面预览")}</strong></div>
        </div>)}
        {cardState !== 'ready' && <div className="projected-status" role="status">
          <div className="projected-status-copy">
          <span className={'projection-state state-' + cardState}>{t(labels[cardState])}</span>
          {cardState === 'loading' && <div className="response-loading"><i/><i/><i/></div>}
          <span className="projected-status-message">{t(message)}</span>
          </div>
        </div>}
        </div>
      </section>
      {displayKind !== 'app' && <div className="response-projection-caption">
        <span className="response-source">{card?.source || t(source)}{fixture && ' · ' + t('本地预览')}</span>
      </div>}
      <div className="response-components" aria-label={t("幕布下的交互组件")}>
        {cardState === 'ready' && displayKind === 'search' && <>
          <button className={selected ? 'selected' : ''} onClick={() => dispatch({ type: 'select_result', target: { id: 'preview-result-1', version: 1 } })}>
            <Icon name={selected ? 'check' : 'chevron'} size={15}/><span>{t(selected ? '已选择' : '选择结果')}</span>
          </button>
          {canOpenApp && <button onClick={openSurface}><Icon name="external" size={15}/><span>{t("在消息内打开 MCP App")}</span></button>}
        </>}
        {cardState === 'ready' && displayKind === 'video' && <button className="control-disabled" disabled title={t("当前未连接媒体服务")}><Icon name="video" size={15}/><span>{t("播放不可用")}</span></button>}
        {cardState === 'ready' && displayKind === 'media' && <MediaControls captions={captions} setCaptions={setCaptions}/>}
        {cardState === 'approval' && <>
          <button disabled><Icon name="legal" size={15}/><span>{t("审批 · 服务未连接")}</span></button>
          <button onClick={close}><Icon name="close" size={15}/><span>{t("取消事务")}</span></button>
        </>}
        {cardState === 'login' && <button disabled><Icon name="identity" size={15}/><span>{t("登录 · 不可用")}</span></button>}
        {['failed', 'expired'].includes(cardState) && <button onClick={() => dispatch({ type: 'state', value: 'loading' })}><Icon name="reset" size={15}/><span>{t("重新检查预览状态")}</span></button>}
        {cardState === 'unavailable' && <button disabled><Icon name="external" size={15}/><span>{t("服务未连接")}</span></button>}
        {cardState !== 'closed' && displayKind !== 'app' && <button disabled={fixture ? false : card?.capabilities?.fullscreen !== true} onClick={() => dispatch({ type: 'fullscreen' })} title={t("仅在 host 与 app 协商后可展开")}><Icon name="external" size={15}/><span>{t("展开幕布")}</span></button>}
        {cardState !== 'closed' && <button onClick={close}><Icon name="close" size={15}/><span>{t("关闭卡片")}</span></button>}
      </div>
      {cardState === 'ready' && displayKind === 'media' && <small className="response-media-note">{t("媒体对白、字幕与进度不是用户命令；进度更新不触发 Withu 语音。外部播放器控制未验证。")}</small>}
      {fixture && selected && <small className="response-action-note">{t("本地选择引用 ")}<code>preview-result-1</code>{t("，版本 1；没有提交动作。")}</small>}
      {cardState === 'approval' && <small className="response-capability-note">{t("界面来源和工具按钮不是授权；高影响动作只能由可信 Withu host 完成审批。")}</small>}
    </article>
  </div>;
}

export default function ResponseCard({ card, fixture = false, mode = 'comfort', initialDisplay = 'search', onDismiss, onOpenInDrawer }) {
  const initial = previewStates.includes(card?.state) ? card.state : 'ready';
  const [state, setState] = useState(initial);
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState(false);
  const [displayKind, setDisplayKind] = useState(initialDisplay);
  const [captions, setCaptions] = useState(true);
  const dispatch = action => {
    if (action.type === 'state' && previewStates.includes(action.value)) setState(action.value);
    if (action.type === 'display' && ['search', 'app', 'video', 'media'].includes(action.value)) setDisplayKind(action.value);
    if (action.type === 'select_result' && action.target.id === 'preview-result-1' && action.target.version === 1) setSelected(true);
    if (action.type === 'fullscreen') setFull(true);
  };
  const close = () => { if (onDismiss) onDismiss(); else setState('closed'); };
  const content = <ProjectedScreen card={card} cardState={state} fixture={fixture} mode={mode} selected={selected} displayKind={displayKind} captions={captions} setCaptions={setCaptions} dispatch={dispatch} close={close} openSurface={() => setDisplayKind('app')} onOpenInDrawer={onOpenInDrawer}/>;

  // One canvas instance at a time: expanding re-parents the same card so a mounted
  // MCP App session is never duplicated (two hosts would revoke each other).
  return <>
    {!full && content}
    {full && <div className="surface-backdrop">
      <section className="response-fullscreen" role="dialog" aria-label="ResponseCard fullscreen">
        <header><button onClick={() => setFull(false)}><Icon name="back" size={18}/>{t("返回原消息")}</button><strong>{t("Withu 交互幕布")}</strong><span>{t(fixture ? '本地 host fixture · inline + fullscreen' : 'fullscreen 已协商')}</span></header>
        <div className="fullscreen-content">{content}</div>
      </section>
    </div>}
  </>;
}
