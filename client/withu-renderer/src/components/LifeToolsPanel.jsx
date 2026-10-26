import {useEffect,useState} from 'react';
import {desktopBridge} from '../desktop-bridge';
import {IntelligentSurface} from '../intelligent-ui';
import {createLifeActionHandler,lifeApprovalBlock} from '../life-actions';
import McpAppHost from './McpAppHost';
import Modal from './Modal';
import Select from './Select';
import './life-tools.css';

const base={schema_version:1,scope:'comfort'};
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const datetime=seconds=>new Date(seconds*1000).toLocaleString();
const operationLabels={draft_create:'保存消息草稿',draft_edit:'修改消息草稿',draft_discard:'丢弃消息草稿',calendar_create:'添加本地日程',calendar_edit:'修改本地日程',calendar_delete:'删除本地日程',reminder_create:'创建本地提醒',reminder_edit:'修改本地提醒',reminder_delete:'删除本地提醒',reminder_pause:'暂停提醒',reminder_resume:'恢复提醒'};

export default function LifeToolsPanel({conversationId,userMessage}) {
  const [appOpen,setAppOpen]=useState(false);
  const [open,setOpen]=useState(false),[kind,setKind]=useState('reminder'),[text,setText]=useState(''),[time,setTime]=useState(''),[end,setEnd]=useState(''),[items,setItems]=useState({drafts:[],calendar:[],reminders:[]}),[prepared,setPrepared]=useState(null),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null),[query,setQuery]=useState('');
  const bridge=desktopBridge();
  const refresh=async()=>setItems(await bridge.lifeList(base));
  const run=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{if(open)void run(refresh);},[open,conversationId]);
  useEffect(()=>()=>{if(prepared)void bridge.lifeCancel({...base,operation_id:prepared.operation_id}).catch(()=>{});},[prepared,conversationId]);
  const prepare=async operation=>{
    if(prepared)await bridge.lifeCancel({...base,operation_id:prepared.operation_id}).catch(()=>{});
    const operationId=crypto.randomUUID();
    const value=await bridge.lifePrepare({...base,operation_id:operationId,user_evidence_ref:`life-form:${conversationId}:${operationId}`,goal_description:operationLabels[operation.kind],operation});
    setPrepared(value);setResult(null);
  };
  const submit=()=>run(async()=>{
    if(!text.trim())throw Error('请填写内容');
    const common={kind:`${kind}_${editing?'edit':'create'}`,id:editing?.id||crypto.randomUUID(),...(editing?{expected_version:editing.version}:{})};
    if(kind==='draft')await prepare({...common,...(!editing?{conversation_id:conversationId}:{}),text:text.trim(),file_refs:[]});
    if(kind==='reminder'){const due=Math.floor(new Date(time).getTime()/1000);if(!Number.isFinite(due)||due<=Date.now()/1000)throw Error('请选择未来的提醒时间');await prepare({...common,text:text.trim(),due_at:due,timezone:zone()});}
    if(kind==='calendar'){const start=Math.floor(new Date(time).getTime()/1000),ends=Math.floor(new Date(end).getTime()/1000);if(!Number.isFinite(start)||!Number.isFinite(ends)||ends<=start)throw Error('请填写有效的起止时间');await prepare({...common,title:text.trim(),starts_at:start,ends_at:ends,timezone:zone(),notes:editing?.notes||''});}
  });
  const edit=(type,item)=>{setKind(type);setEditing(item);setText(item.text||item.title);const local=seconds=>{const date=new Date(seconds*1000);return new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};setTime(item.due_at||item.starts_at?local(item.due_at||item.starts_at):'');setEnd(item.ends_at?local(item.ends_at):'');};
  const block=prepared?lifeApprovalBlock(prepared,conversationId):null;
  const preview=prepared?.approval?.action?.parameters||{};
  const action=prepared?createLifeActionHandler({prepared,block,bridge,afterApplied:async receipt=>{setResult(receipt.status==='applied'?'已保存到本机。':receipt.error?.message||'未完成');if(receipt.status==='applied'){setEditing(null);setText('');}await refresh();}}):null;
  return <section className="life-tools">
    <button className="life-tools-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}>生活事务 <span>{open?'收起':'草稿 · 日历 · 提醒'}</span></button>
    {open&&<div className="life-tools-content">
      <p>内容保存在本机。提醒需要在 Feed 中允许主动更新，并保持应用运行。</p>
      <form onSubmit={e=>{e.preventDefault();void submit();}}>
        <label>事务类型<Select ariaLabel="事务类型" value={kind} onChange={value=>{setKind(value);setEditing(null);setText('');}} options={[{value:'reminder',label:'本地提醒'},{value:'calendar',label:'本地日历'},{value:'draft',label:'消息草稿（仅保存）'}]}/></label>
        <label>{kind==='calendar'?'日程标题':'内容'}<textarea aria-label="生活事务内容" value={text} maxLength={kind==='calendar'?256:8192} onChange={e=>setText(e.target.value)}/></label>
        {kind!=='draft'&&<label>{kind==='reminder'?'提醒时间':'开始时间'}<input aria-label="事务时间" type="datetime-local" value={time} onChange={e=>setTime(e.target.value)}/></label>}
        {kind==='calendar'&&<label>结束时间<input aria-label="日程结束时间" type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>}
        <button disabled={busy}>{editing?'预览修改':'预览并确认'}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setText('');}}>取消编辑</button>}
      </form>
      {prepared&&<div className="life-approval"><div className="life-approval-summary"><strong>{prepared.plan?.goal?.description||'准备执行本地事务'}</strong>{(preview.text||preview.title)&&<p>{preview.text||preview.title}</p>}{preview.due_at&&<p>提醒时间：{datetime(preview.due_at)}</p>}{preview.starts_at&&<p>{datetime(preview.starts_at)} — {datetime(preview.ends_at)}</p>}<p>只会写入这台设备。请核对内容后选择“允许一次”。</p></div><IntelligentSurface key={prepared.operation_id} blocks={[block]} onAction={action}/><details><summary>查看技术详情</summary><pre>{JSON.stringify(prepared.approval.action.parameters,null,2)}</pre></details></div>}
      {error&&<p role="alert">{error}</p>}{result&&<p role="status">{result}</p>}
      <div className="life-saved" aria-label="已保存的生活事务">
        {items.reminders?.filter(item=>item.status!=='deleted').map(item=><article key={item.id}><strong>{item.text}</strong><small>{datetime(item.due_at)} · {item.status==='paused'?'已暂停':'已启用'}</small><div><button disabled={busy} onClick={()=>edit('reminder',item)}>编辑</button><button disabled={busy} onClick={()=>run(()=>prepare({kind:item.status==='paused'?'reminder_resume':'reminder_pause',id:item.id,expected_version:item.version}))}>{item.status==='paused'?'恢复':'暂停'}</button><button disabled={busy} onClick={()=>run(()=>prepare({kind:'reminder_delete',id:item.id,expected_version:item.version}))}>删除</button></div></article>)}
        {items.calendar?.map(item=><article key={item.id}><strong>{item.title}</strong><small>{datetime(item.starts_at)} — {datetime(item.ends_at)}</small><div><button onClick={()=>edit('calendar',item)}>编辑</button><button disabled={busy} onClick={()=>run(()=>prepare({kind:'calendar_delete',id:item.id,expected_version:item.version}))}>删除</button></div></article>)}
        {items.drafts?.filter(item=>item.status==='active'&&item.conversation_id===conversationId).map(item=><article key={item.id}><strong>消息草稿</strong><p>{item.text}</p><div><button onClick={()=>edit('draft',item)}>编辑</button><button disabled={busy} onClick={()=>run(()=>prepare({kind:'draft_discard',id:item.id,expected_version:item.version}))}>丢弃</button></div></article>)}
      </div>
      <details><summary>检索与内容整理</summary><label>查询或逐行输入内容<textarea aria-label="检索与整理内容" value={query} maxLength={8000} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy||!query.trim()} onClick={()=>run(async()=>{const r=await bridge.lifeRetrieve({...base,operation_id:crypto.randomUUID(),user_evidence_ref:`life-form:${conversationId}`,query:query.slice(0,256),limit:5});setResult(JSON.stringify(r.value,null,2));})}>检索本地来源</button><button disabled={busy||!query.trim()} onClick={()=>run(async()=>{const r=await bridge.lifeOrganize({...base,operation_id:crypto.randomUUID(),user_evidence_ref:`life-form:${conversationId}`,items:query.split('\n').filter(Boolean).slice(0,100).map((text,i)=>({item_id:`line-${i+1}`,fields:{category:'我的内容',text}})),group_by:'category',summary_limit:4000});setResult(JSON.stringify(r.value,null,2));})}>整理输入内容</button></details>
      <button className="secondary" disabled={!userMessage||appOpen} onClick={()=>setAppOpen(true)}>打开本地 MCP App</button>
      {!userMessage&&<small>先提交一条明确的请求，再打开 App。</small>}
      {appOpen&&<Modal title="本地 MCP App" wide onClose={()=>setAppOpen(false)}><McpAppHost key={conversationId} onClose={()=>setAppOpen(false)} proposalContext={{userEvidenceRef:userMessage?.id,goalDescription:userMessage?.text}}/></Modal>}
    </div>}
  </section>;
}
