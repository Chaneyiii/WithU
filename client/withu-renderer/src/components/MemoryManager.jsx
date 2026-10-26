import { useEffect, useMemo, useRef, useState } from 'react';
import { api, newId } from '../store';
import Icon, { IconButton } from './Icon';
import Select from './Select';
import './MemoryManager.css';
import { t } from '../i18n';

const REQUEST_DEFAULTS = {
  schema_version: 1,
  scope: 'comfort',
  retrieval: 'list',
  query: null,
  limit: 50,
  context_limit: 6,
};

function errorText(error) {
  const code = error?.code || error?.message || 'request_failed';
  return ({
    version_conflict: t('数据已变化，请刷新后再试。'),
    memory_query_required: t('请输入精确检索词。'),
    memory_scope: t('当前作用域不可访问。'),
    semantic_index_unavailable: t('语义检索暂不可用；当前只支持精确匹配。'),
    server_not_ready: t('Withu Server 尚未就绪。'),
    request_timeout: t('请求超时，请检查本地 Server。'),
  })[code] || `${t('记忆服务不可用')}：${code}`;
}

function formatEvidence(evidence) {
  return evidence.map(item => `${item.speaker} · ${item.turn_id} · ${item.version}`).join('；');
}

export default function MemoryManager({ notify }) {
  const [scope, setScope] = useState('comfort');
  const [query, setQuery] = useState('');
  const [retrieval, setRetrieval] = useState('list');
  const [items, setItems] = useState([]);
  const [context, setContext] = useState([]);
  const [stateVersion, setStateVersion] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retrievalStatus, setRetrievalStatus] = useState(null);
  const loadSequence = useRef(0);
  const [confirming, setConfirming] = useState(false);
  const [candidate, setCandidate] = useState({ subject: '', content: '', kind: 'stable_fact' });
  const [savePermission, setSavePermission] = useState(false);


  const selected = useMemo(() => items.find(item => item.record?.id === selectedId) || null, [items, selectedId]);

  async function load(next = {}) {
    const sequence = ++loadSequence.current;
    setSelectedId(null);
    setEdit(null);
    setConfirming(false);
    setItems([]);
    setContext([]);
    setLoading(true);
    setError('');
    try {
      const request = { ...REQUEST_DEFAULTS, scope, query: query.trim() || null, retrieval, ...next };
      const result = await api('memoryList', request);
      if (sequence !== loadSequence.current) return;
      setItems(result.items || []);
      setContext(result.context || []);
      setStateVersion(result.state_version || 0);
      setRetrievalStatus(result.retrieval || null);
      setSelectedId(current => (result.items || []).some(item => item.record?.id === current) ? current : null);
    } catch (e) {
      if (sequence !== loadSequence.current) return;
      setItems([]);
      setContext([]);
      setRetrievalStatus(null);
      setError(errorText(e));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [scope, retrieval]);

  function select(item) {
    setSelectedId(item.record.id);
    setEdit({ ...item.record });
    setConfirming(false);
  }

  async function save() {
    if (loading || scope !== 'comfort' || !savePermission || !candidate.subject.trim() || !candidate.content.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api('memorySave', {
        schema_version: 1, scope, subject: candidate.subject.trim(), content: candidate.content.trim(),
        kind: candidate.kind, explicit_save_permission: savePermission, expected_state_version: stateVersion,
      });
      setCandidate({ subject: '', content: '', kind: 'stable_fact' });
      setSavePermission(false);
      notify?.(t('记忆已保存'));
      setQuery('');
      setRetrieval('list');
      await load({ retrieval: 'list', query: null });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function correct() {
    if (!selected || !edit || !edit.subject.trim() || !edit.content.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api('memoryCorrect', {
        schema_version: 1,
        scope,
        record: { ...edit, subject: edit.subject.trim(), content: edit.content.trim(), version: selected.record.version + 1 },
        expected_object_version: selected.object_version,
        expected_state_version: stateVersion,
      });
      notify?.(t('记忆已纠正'));
      setEdit(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!selected || !confirming) return;
    setLoading(true);
    setError('');
    try {
      await api('memoryDelete', {
        schema_version: 1,
        scope,
        target_type: 'memory',
        target_id: selected.record.id,
        expected_object_version: selected.object_version,
        expected_state_version: stateVersion,
        sync_protection_token: newId(),
      });
      notify?.(t('记忆已删除，记忆与关联来源已写入墓碑'));
      setSelectedId(null);
      setEdit(null);
      setConfirming(false);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  return <section className="memory-manager" aria-label={t('关系记忆管理')}>
    <div className="memory-manager-toolbar">
      <div className="memory-scope">
        <Icon name="database" size={18} />
        <label>{t('作用域')}<input value={scope} onChange={e => setScope(e.target.value)} disabled={loading} aria-label={t('记忆作用域')} /></label>
      </div>
      <div className="memory-search">
        <Icon name="search" size={18} />
        <input value={query} disabled={loading} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder={t('精确检索记忆')} aria-label={t('精确检索记忆')} />
        <button className="memory-search-button" onClick={() => load()} disabled={loading} aria-label={t('检索')} title={t('检索')}><Icon name="search" size={16} /></button>
      </div>
      <div className="memory-retrieval" role="group" aria-label={t('检索方式')}>
        {['list', 'exact', 'semantic'].map(mode => <button key={mode} className={retrieval === mode ? 'active' : ''} onClick={() => setRetrieval(mode)} disabled={loading}>{mode === 'list' ? t('全部') : mode === 'exact' ? t('精确') : t('语义')}</button>)}
      </div>
    </div>
    {retrievalStatus?.status === 'unavailable' && <p className="memory-status" role="status">{t('语义检索暂不可用，未生成推测结果。')}</p>}
    {error && <p className="memory-error" role="alert">{error}<button onClick={() => load()}>{t('刷新')}</button></p>}
    <form className="memory-create" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={t('保存新的记忆')}>
      <strong>{t('保存新的记忆')}</strong>
      <p className="memory-create-note">{t('只填写你希望长期保存的事实、偏好或经历。内容在确认前仅保留于此表单。')}</p>
      <div className="memory-create-row">
        <label className="memory-field">{t('主题')}<input value={candidate.subject} maxLength={120} disabled={loading} onChange={e => { setCandidate(v => ({ ...v, subject: e.target.value })); setSavePermission(false); }} /></label>
        <label className="memory-field">{t('记忆类型')}<Select ariaLabel={t('记忆类型')} value={candidate.kind} disabled={loading} onChange={value => { setCandidate(v => ({ ...v, kind: value })); setSavePermission(false); }} options={[{ value: 'stable_fact', label: t('事实') }, { value: 'explicit_preference', label: t('偏好') }, { value: 'explicit_experience', label: t('经历') }]} /></label>
      </div>
      <label className="memory-field">{t('内容')}<textarea value={candidate.content} maxLength={1800} disabled={loading} onChange={e => { setCandidate(v => ({ ...v, content: e.target.value })); setSavePermission(false); }} /></label>
      <label className="memory-permission"><input type="checkbox" checked={savePermission} disabled={loading} onChange={e => setSavePermission(e.target.checked)} />{t('我确认将以上内容保存为长期记忆，并用于后续 Comfort 对话。')}</label>
      <div className="memory-actions"><button className="primary" type="submit" disabled={loading || scope !== 'comfort' || !savePermission || !candidate.subject.trim() || !candidate.content.trim()}><Icon name="check" size={16} />{t('确认保存记忆')}</button></div>
    </form>
    <div className="memory-manager-body">
      <div className="memory-list" aria-busy={loading}>
        {!loading && items.length === 0 && <p className="memory-empty">{t('当前作用域没有可显示的长期记忆。')}</p>}
        {items.map(item => <button className={`memory-item ${item.record.id === selectedId ? 'selected' : ''}`} key={item.record.id} onClick={() => select(item)}>
          <span className="memory-item-title">{item.record.subject}</span>
          <span className="memory-item-content">{item.record.content}</span>
          <span className="memory-item-meta">{t('版本')} {item.object_version} · {t('证据')} {item.evidence?.length || 0} · {t(item.record.status)}</span>
        </button>)}
      </div>
      <aside className="memory-detail" aria-label={t('记忆详情')}>
        {!selected && <p className="memory-empty">{t('选择一条记忆查看来源、证据与授权。')}</p>}
        {selected && edit && <>
          <header><div><h4>{edit.subject}</h4><small>{scope} · object v{selected.object_version} · state v{stateVersion}</small></div><IconButton icon="close" label={t('关闭详情')} size={28} onClick={() => { setSelectedId(null); setEdit(null); setConfirming(false); }} /></header>
          <label className="memory-field">{t('主题')}<input value={edit.subject} onChange={e => setEdit(v => ({ ...v, subject: e.target.value }))} /></label>
          <label className="memory-field">{t('内容')}<textarea value={edit.content} onChange={e => setEdit(v => ({ ...v, content: e.target.value }))} /></label>
          <dl className="memory-facts"><div><dt>{t('来源版本')}</dt><dd>{formatEvidence(selected.evidence || []) || t('无可用证据')}</dd></div><div><dt>{t('授权')}</dt><dd>{edit.save_permission && edit.confirmed ? t('用户已确认保存') : t('不可进入长期记忆')}</dd></div><div><dt>{t('有效期')}</dt><dd>{edit.valid_from}{edit.valid_to ? ` → ${edit.valid_to}` : ` → ${t('现在')}`}</dd></div></dl>
          <div className="memory-evidence" aria-label={t('来源证据')}>{(selected.evidence || []).map(item => <blockquote key={item.id}><p>{item.text_excerpt}</p><small>{item.turn_id} · {item.speaker} · v{item.version} · {item.redaction}</small></blockquote>)}</div>
          {selected.deletion_impact?.count > 0 && <p className="memory-impact">{t('删除将使')} {selected.deletion_impact.count} {t('条记忆、证据或派生引用失效，并写入持久墓碑。')}</p>}
          {confirming ? <div className="memory-confirm"><strong>{t('确认删除这条记忆？')}</strong><span>{t('此操作会立即隐藏记忆及其关联派生引用。')}</span><div><button onClick={() => setConfirming(false)}>{t('取消')}</button><button className="danger" onClick={remove} disabled={loading}>{t('确认删除')}</button></div></div> : <div className="memory-actions"><button className="primary" onClick={correct} disabled={loading || !edit.subject.trim() || !edit.content.trim()}><Icon name="check" size={16} />{t('保存纠正')}</button><button className="danger-link" onClick={() => setConfirming(true)}><Icon name="trash" size={16} />{t('删除')}</button></div>}
        </>}
      </aside>
    </div>
    <div className="memory-context"><strong>{t('有限上下文')}</strong><span>{context.length ? `${t('已装载')} ${context.length} ${t('条已确认记忆')}` : t('当前没有装载内容')}</span><small>{t('只使用用户已确认且带证据的记忆；Live 原始音频与逐句转写不会出现在这里。')}</small></div>
  </section>;
}
