

import ChatModelPicker from './ChatModelPicker';
import {t} from '../i18n';
import {useRef,useLayoutEffect,useState,useEffect} from 'react';
import Icon,{IconButton} from './Icon';
export default function Composer({onLive,callOpen,voiceEnabled,modelLabel,replyRunning,onCancelGeneration,onSend,onAttach,attachments=[],onRemove,busy,onNotice,text,onText,mode,messages=[]}){
 const ref=useRef(),root=useRef();const [menu,setMenu]=useState(null);
 // 底部那根浏览器指示条要贴着输入框上沿、并与输入框水平居中。comfort / cowork
 // 的输入框高矮差很多，干脆由输入框自己把「离舞台底边多远」「中心 x」写进变量，
 // 指示条直接读；活动面板开合、窗口缩放时 ResizeObserver 会跟着重算。
 useLayoutEffect(()=>{
  const el=root.current;if(!el)return;
  const stage=el.closest('.workspace-stage')||document.documentElement;
  const sync=()=>{const r=el.getBoundingClientRect(),b=stage.getBoundingClientRect();if(!r.height)return;stage.style.setProperty('--composer-rest',Math.round(b.bottom-r.top+12)+'px');stage.style.setProperty('--composer-center-x',Math.round(r.left+r.width/2-b.left)+'px');};
  sync();
  const observer=new ResizeObserver(sync);observer.observe(el);observer.observe(stage);
  // 活动面板开合只挪 composer 的位置不改它自身的尺寸，额外盯住
  // main-workspace 的宽度变化才能让指示条跟着居中。
  const workspace=el.closest('.main-workspace');
  const workspaceObserver=workspace?new ResizeObserver(sync):null;
  if(workspaceObserver)workspaceObserver.observe(workspace);
  window.addEventListener('resize',sync);
  return()=>{observer.disconnect();workspaceObserver?.disconnect();window.removeEventListener('resize',sync);};
 },[]);
 useLayoutEffect(()=>{const e=ref.current;e.style.height=mode==='cowork'?'42px':'30px';e.style.height=Math.min(160,e.scrollHeight)+'px';},[text,mode]);
 useEffect(()=>{const close=e=>{if(!root.current?.contains(e.target))setMenu(null);};const escape=e=>{if(e.key==='Escape')setMenu(null);};const blur=()=>setMenu(null);document.addEventListener('pointerdown',close);document.addEventListener('focusin',close);window.addEventListener('blur',blur);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('focusin',close);document.removeEventListener('keydown',escape);window.removeEventListener('blur',blur);};},[]);
 const submit=()=>{if(!busy&&!replyRunning&&(text.trim()||attachments.length))onSend(text.trim());};
 const cowork=mode==='cowork';
 const toggle=name=>setMenu(menu===name?null:name);
 const usage=messages.filter(m=>m.usage);const total=usage.length?usage.reduce((n,m)=>n+(m.usage.total_tokens||0),0):null;
 return <div ref={root} className={'composer-region '+(cowork?'cowork-composer':'')}><div className="composer-attachments">{attachments.map(f=><div className="attachment-chip" key={f.id}><span>{f.name}</span><IconButton icon="close" label={'Remove '+f.name} size={24} onClick={()=>onRemove(f.id)}/></div>)}</div><div className="composer">
 {!cowork&&<IconButton icon="plus" label={t('Attach file')} onClick={onAttach}/>}<textarea ref={ref} aria-label={t('Message')} placeholder={cowork?t("发消息或创建任务，/ 调用指令，@ 文件或对话"):t('Message')} rows={cowork?2:1} value={text} onChange={e=>onText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit();}}}/>
 <div className="composer-controls">{cowork&&<IconButton icon="plus" label={t('Attach file')} onClick={onAttach}/>}{cowork&&<div className="composer-control-wrap"><button className="composer-text-button" aria-expanded={menu==='approval'} onClick={()=>toggle('approval')}><Icon name="legal" size={16}/>{t("逐项审批")}<Icon name="down" size={12}/></button>{menu==='approval'&&<div className="popover composer-popup approval-popup"><strong>{t("审批权限")}</strong><button disabled><span>{t("Manual · 逐项审批")}</span><Icon name="check" size={16}/></button><button disabled>{t("Auto · 规则审批")}</button><small>{t("执行服务尚未接入，当前无法启用。")}</small></div>}</div>}
 {cowork&&<div className="composer-control-spacer"/>}{<div className="composer-control-wrap"><button className="composer-text-button model-chip-icon" aria-expanded={menu==='model'} aria-label={t(modelLabel||'模型未配置')} title={t(modelLabel||'模型未配置')} onClick={()=>toggle('model')}><Icon name="brain" size={17}/><Icon name="down" size={11}/></button>{menu==='model'&&<ChatModelPicker label={modelLabel} onNotice={onNotice} onClose={()=>setMenu(null)}/>}</div>}
 {voiceEnabled&&<button data-speech-activate-audio className="icon-button" aria-label="启动 Withu-Live" title="Withu-Live" disabled={callOpen} onClick={onLive}><Icon name="mic" size={18}/></button>}
 {replyRunning&&<button className="composer-text-button" onClick={onCancelGeneration}>{t('停止生成')}</button>}<div className="send-glass"><IconButton icon="send" label={busy?t("正在保存"):t('Send')} className="send-button" size={34} iconSize={19} disabled={busy||replyRunning||(!text.trim()&&!attachments.length)} onClick={submit}/></div></div></div>
 {cowork&&<div className="session-metrics">{[['stats','gauge',`${messages.filter(m=>m.role==='assistant').length} · ${t('会话统计')}`],['tokens','database',total==null?`${t('Token 用量')} —`:`${total.toLocaleString()} tok`],['context','activity',t("上下文 —")]].map(([key,icon,label])=><div className="metric-wrap" key={key} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setMenu(null);}}><button className={menu===key?'active':''} aria-expanded={menu===key} onClick={()=>toggle(key)}><Icon name={icon} size={16}/>{label}</button>{menu===key&&<div className="popover metric-popup"><strong>{key==='stats'?t("会话统计"):key==='tokens'?t("Token 用量"):t("上下文窗口")}</strong>{(key==='stats'?[[t("消息数"),String(messages.length)],[t("模型用时"),'—'],[t("工具调用用时"),'—'],[t("首 token 平均（TTFT）"),'—'],[t("输出速度（TPS）"),'—']]:key==='tokens'?[[t("总用量"),total==null?'—':`${total.toLocaleString()} tok`],[t("缓存命中"),'—'],[t("未缓存输入"),'—'],[t("缓存读取"),'—'],[t("输出"),'—']]:[[t("上下文已用"),'—'],[t("窗口容量"),'—'],[t("系统提示词"),'—'],[t("工具定义"),'—'],[t("对话消息"),'—']]).map(([name,value])=><div className="metric-row" key={name}><span>{name}</span><span>{value}</span></div>)}<small>{t("模型尚未接入，暂无运行用量数据。")}</small></div>}</div>)}</div>}
 <small className="provider-note">{t('AI 可能会犯错，请核查重要信息。')}</small></div>;
}
