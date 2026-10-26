import {useEffect, useMemo, useRef, useState} from 'react';
import Icon from '../components/Icon';
import {createActionAdapter, createActionIntent, createCancelIntent, selectedOption} from './action-adapter.js';
import {initialSurfaceState, reduceSurfaceState} from './state-machine.js';
import {validateReplyBlock} from './contract.js';
import {localizedTitle, receiptSummaryText} from './titles.js';
import './intelligent-ui.css';

const statusCopy = {
  loading: '正在准备', ready: '可以继续', pending_approval: '等待批准', applied: '已收到回执',
  failed: '动作未完成', expired: '已过期', closed: '已关闭', recovering: '正在恢复'
};
const visibilityCopy = { conversation: '会话内', private: '仅自己可见', account: '本机可见' };
const receiptErrorCopy = { cancelled: '已在执行前取消', expired: '此操作已过期' };
const defaultNow = () => Math.floor(Date.now() / 1000);

function StatusPill({state}) {
  return <span className={`intelligent-status intelligent-status-${state}`} role="status"><span className="intelligent-status-dot" aria-hidden="true" />{statusCopy[state]}</span>;
}

function BlockBody({block, selected, onSelect}) {
  const {kind, payload} = block;
  if (kind === 'text') return <p className="intelligent-copy">{payload.text}</p>;
  if (kind === 'summary') return <div className="intelligent-summary"><strong>{payload.title}</strong><p>{payload.body}</p></div>;
  if (kind === 'list') return <div className="intelligent-list">{payload.items.map(item => <div className="intelligent-list-item" key={item.id}><span className="intelligent-list-mark" aria-hidden="true"><Icon name="check" size={14} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span></div>)}</div>;
  if (kind === 'selection') return <div className="intelligent-options" role="group" aria-label={payload.title}>{payload.options.map(option => <button key={option.id} className={selected === option.id ? 'intelligent-option is-selected' : 'intelligent-option'} onClick={() => onSelect(option.id)}><span><strong>{option.label}</strong><small>{option.description}</small></span><span aria-hidden="true">{selected === option.id ? <Icon name="check" size={16} /> : 'Select'}</span></button>)}</div>;
  if (kind === 'approval') return <div className="intelligent-approval"><div className="intelligent-approval-icon" aria-hidden="true"><Icon name="bell" size={18} /></div><div><strong>{localizedTitle(payload.title)}</strong><p>{payload.body}</p></div></div>;
  return <div className="intelligent-error"><Icon name="bell" size={18} aria-hidden="true" /><span><strong>{payload.code}</strong><small>{payload.message}</small></span></div>;
}

function ReceiptNotice({receipt}) {
  if (!receipt) return null;
  const applied = receipt.status === 'applied';
  // 内部回执标识（connector:action 形如 fake-local:life_reminder_create）不上 UI：
  // 映射不出可读文案就省略摘要行，只保留成功/失败状态。
  const summary = applied ? receiptSummaryText(receipt.result?.summary) : (receipt.error ? receiptErrorCopy[receipt.error.code] ?? receipt.error.message : null);
  const title = applied ? '已执行成功' : `未执行：${receipt.error?.code || receipt.status}`;
  return <div className={`intelligent-receipt intelligent-receipt-${receipt.status}`} role="status"><span>{applied ? <Icon name="check" size={15} /> : <Icon name="bell" size={15} />}</span><span><strong>{title}</strong>{summary ? <small>{summary}</small> : null}</span></div>;
}

export default function IntelligentSurface({blocks = [], onAction, now = defaultNow, testPreview = false, compact = false}) {
  const validBlocks = useMemo(() => blocks.map(validateReplyBlock), [blocks]);
  const [surfaces, setSurfaces] = useState(() => new Map(validBlocks.map(block => [block.block_id, initialSurfaceState(block, {now: now()})])));
  const [selected, setSelected] = useState({});
  const [lastIntent, setLastIntent] = useState(null);
  const generations = useRef(new Map());
  const adapter = useMemo(() => createActionAdapter(intent => { setLastIntent(intent); return onAction?.(intent); }), [onAction]);

  useEffect(() => { setSurfaces(current => {
    const next = new Map();
    validBlocks.forEach(block => {
      const existing = current.get(block.block_id);
      if (!existing) next.set(block.block_id, initialSurfaceState(block, {now: now()}));
      else if (block.status_version > existing.source_status_version) next.set(block.block_id, reduceSurfaceState(existing, {type: 'sync_block', block}, now()));
      else next.set(block.block_id, existing);
    });
    if (next.size === current.size && [...next].every(([id, value]) => value === current.get(id))) return current;
    return next;
  }); }, [validBlocks, now]);
  useEffect(() => { validBlocks.forEach(block => { transitionReady(block.block_id); }); }, [validBlocks]);

  const transitionReady = blockId => setSurfaces(current => { const surface = current.get(blockId); if (!surface || surface.state !== 'loading') return current; const next = new Map(current); next.set(blockId, reduceSurfaceState(surface, {type: 'block_ready'}, now())); return next; });
  const transition = (blockId, event) => setSurfaces(current => { const surface = current.get(blockId); if (!surface) return current; const next = new Map(current); next.set(blockId, reduceSurfaceState(surface, event, now())); return next; });
  const requestAction = (block, channel, requiresApproval = block.kind === 'approval', selection = null) => {
    const generation = (generations.current.get(block.block_id) || 0) + 1;
    generations.current.set(block.block_id, generation);
    if (now() >= block.action_ref.expires_at) {
      transition(block.block_id, {type: 'receipt_received', receipt: {schema_version:1, action_id:block.action_ref.action_id, idempotency_key:block.action_ref.idempotency_key, status:'rejected', result:null, error:{schema_version:1, code:'expired', message:'This action reference has expired.', retryable:false, action_id:block.action_ref.action_id, committed_targets:[]}, effect_committed:false, observed_at:now()}});
      return;
    }
    let intent;
    try { intent = createActionIntent(block, channel, now(), 'submit', selection); }
    catch (error) { transition(block.block_id, {type: 'receipt_received', receipt: failureReceipt(block, 'validation', error.message)}); return; }
    transition(block.block_id, {type: 'action_requested', requiresApproval});
    Promise.resolve(adapter(intent)).then(receipt => {
      if (generations.current.get(block.block_id) !== generation) return;
      if (receipt && receipt.schema_version === 1 && receipt.action_id) transition(block.block_id, {type: 'receipt_received', receipt});
      else transition(block.block_id, {type: 'receipt_received', receipt: failureReceipt(block, 'lifecycle', 'Host adapter returned no receipt.')});
    }).catch(error => {
      if (generations.current.get(block.block_id) === generation) transition(block.block_id, {type: 'receipt_received', receipt: failureReceipt(block, 'lifecycle', error.message || 'Host adapter failed.')});
    });
  };
  const close = block => { generations.current.set(block.block_id, (generations.current.get(block.block_id) || 0) + 1); const surface = surfaces.get(block.block_id); if (surface?.action_ref && ['loading', 'ready', 'pending_approval'].includes(surface.state)) Promise.resolve(adapter(createCancelIntent(block, now()))).catch(() => {}); transition(block.block_id, {type: 'close'}); };
  const restore = (block, retry = false) => { transition(block.block_id, {type: retry ? 'retry' : 'recover'}); if(retry)transitionReady(block.block_id);else transition(block.block_id,{type:'recovered'}); };

  const failureReceipt = (block, code, message) => ({schema_version:1, action_id:block.action_ref.action_id, idempotency_key:block.action_ref.idempotency_key, status:'rejected', result:null, error:{schema_version:1, code, message, retryable:code === 'lifecycle', action_id:block.action_ref.action_id, committed_targets:[]}, effect_committed:false, observed_at:now()});

  return <section className={'intelligent-surface' + (compact ? ' intelligent-surface-compact' : '')} aria-label="Withu intelligent reply blocks">
    {!compact && <header className="intelligent-surface-header"><div><span className="intelligent-eyebrow">WITHU INTELLIGENT UI</span><h1>Small actions, clear control</h1><p>Comfort reply blocks keep the decision visible and the action with the trusted host.</p></div>{testPreview && <span className="intelligent-preview-badge">TEST PREVIEW · local adapter only</span>}</header>}
    <div className="intelligent-blocks">{validBlocks.map(block => { const surface = surfaces.get(block.block_id); const selectedId = selected[block.block_id]; const hasAction = Boolean(block.action_ref); return <article key={block.block_id} className={`intelligent-block intelligent-block-${surface?.state || 'loading'}`} aria-labelledby={`${block.block_id}-title`}>
      <div className="intelligent-block-top"><div><span className="intelligent-source"><span className="intelligent-source-mark" aria-hidden="true">W</span>{block.source === 'withu' ? 'Withu' : block.source === 'local_adapter' ? 'Local adapter' : 'You'} · {visibilityCopy[block.visibility] ?? block.visibility}</span><h2 id={`${block.block_id}-title`}>{localizedTitle(block.payload.title) || (block.kind === 'text' ? 'Withu reply' : block.kind)}</h2></div><StatusPill state={surface?.state || 'loading'} /></div>
      <BlockBody block={block} selected={selectedId} onSelect={id => setSelected(value => ({...value, [block.block_id]: id}))} />
      <ReceiptNotice receipt={surface?.receipt} />
      {surface?.state === 'closed' ? <div className="intelligent-closed"><Icon name="close" size={16} />此卡已关闭，其操作不会被重放。<button onClick={() => restore(block)}><Icon name="refresh" size={15} />恢复</button></div> : <div className="intelligent-actions">
        {hasAction && <button className="intelligent-primary" disabled={['loading', 'pending_approval', 'applied', 'expired'].includes(surface?.state)} onClick={() => requestAction(block, 'click', block.kind === 'approval', selectedOption(block, selectedId))}><Icon name="send" size={15} />{block.kind === 'approval' ? '允许一次' : '继续'}</button>}
        {hasAction && testPreview && <button className="intelligent-secondary" disabled={['loading', 'pending_approval', 'applied', 'expired'].includes(surface?.state)} onClick={() => requestAction(block, 'voice', false, selectedOption(block, selectedId))}><Icon name="mic" size={15} />Voice intent</button>}
        {surface?.state === 'failed' || surface?.state === 'expired' ? <><button className="intelligent-secondary" onClick={() => restore(block, true)}><Icon name="refresh" size={15} />重试</button><button className="intelligent-secondary" onClick={() => restore(block)}><Icon name="refresh" size={15} />恢复</button></> : null}
        <button className="intelligent-icon-action" aria-label="关闭此卡" title="关闭此卡" onClick={() => close(block)}><Icon name="close" size={16} /></button>
      </div>}
      {testPreview && lastIntent?.block_id === block.block_id && <p className="intelligent-preview-note"><Icon name="document" size={13} />Typed intent received by preview adapter: <code>{lastIntent.input_channel}</code>. No production side effect was executed.</p>}
    </article>; })}</div>
  </section>;
}
