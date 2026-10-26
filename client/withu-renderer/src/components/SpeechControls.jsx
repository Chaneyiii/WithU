import {useEffect,useRef,useState} from 'react';
import {t} from '../i18n';
import {SpeechClient} from '../speech/client';
import {PRESENCE_LABELS,PRESENCE_MOODS} from '../presence/presentation';
import EmotionalBall from './EmotionalBall';
import Select from './Select';
import '../presence/presence.css';

export default function SpeechControls({conversationId,onPresence}) {
 const [capturing,setCapturing]=useState(false);
 const [correction,setCorrection]=useState(''),[editing,setEditing]=useState(null);
 const [enabled,setEnabled]=useState(false),[data,setData]=useState({session:null,caption:null,transcript:[],receipts:[]}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[backend,setBackend]=useState('fake-a'),[scenario,setScenario]=useState('normal'),[review,setReview]=useState(false),[reattach,setReattach]=useState(0);
 const client=useRef(null),bridge=window.withuDesktop;
 useEffect(()=>{let current=true;bridge?.speechCapability?.().then(result=>{if(current)setEnabled(result.enabled);});return()=>{current=false;};},[bridge]);
 useEffect(()=>bridge?.onSpeechReattach?.(()=>setReattach(value=>value+1)),[bridge]);
 useEffect(()=>{
  if(!enabled)return;
  let mounted=true;const instance=new SpeechClient(bridge,conversationId,value=>{if(!mounted)return;setData(value);if(value.session?.state!=='listening')setCapturing(false);onPresence(value.session?{...value.session,quiet:false}:null);});
  client.current=instance;setData({session:null,caption:null,transcript:[],receipts:[]});setCapturing(false);
  const unload=()=>{void instance.dispose().catch(()=>{});};window.addEventListener('beforeunload',unload);
  return()=>{mounted=false;client.current=null;onPresence(null);window.removeEventListener('beforeunload',unload);void instance.dispose().catch(()=>{});};
 },[enabled,conversationId,bridge,onPresence,reattach]);
 const run=async fn=>{setError('');setBusy(true);try{await fn();}catch(e){setError(e.name==='NotAllowedError'?t('麦克风权限被拒绝，可继续使用文字'):e.message);}finally{setBusy(false);}};
 if(!enabled)return null;
 const session=data.session,terminal=!session||session.state==='ended',state=session?.state||'idle';
 return <section className="presence-preview is-open speech-session-panel" aria-label={t('测试语音会话')} data-speech-busy={String(busy)} data-speech-state={state} data-speech-session={JSON.stringify(session)} data-speech-receipts={JSON.stringify(data.receipts)} data-speech-resources={JSON.stringify(data.resources||{})}>
  <header className="presence-preview-header"><span>{t('fake ASR / TTS 测试会话')}</span><small>{t('合成测试音 · 非真人语音识别或正常 AI 回复')}</small></header>
  <div className={'presence-stage state-'+state}>
   <div className="presence-visual"><EmotionalBall presentationOnly mood={PRESENCE_MOODS[state]} presenceState={session?.state}/></div>
   <span className="presence-status" role="status"><i/>{t(!session?'真实语音未配置':PRESENCE_LABELS[state])}</span>
   <div className={'presence-caption '+(data.caption?.kind||'empty')} aria-live="polite">{data.caption?<><small>{t(data.caption.kind==='partial'?'识别中 · 可能变化':'已定稿')} · {t('测试字幕')}</small><p>{t(data.caption.text)}</p></>:<p>{t('点击唤起或按住说话；不自动开始录音')}</p>}</div>
   <div className="presence-call-controls">
    <button disabled={busy} onClick={()=>run(()=>client.current.start(backend,scenario))}>{t('开始测试会话')}</button>
    <button disabled={busy||terminal} onClick={()=>run(()=>client.current.fixtureInput())}>{t('合成输入回放')}</button>
    <button data-speech-activate-audio disabled={busy||terminal} onClick={()=>run(async()=>{if(capturing){await client.current.endMicrophone();setCapturing(false);}else{await client.current.beginMicrophone();setCapturing(Boolean(client.current?.stream));}})}>{t(capturing?'停止收音（测试）':'点击说话（测试）')}</button>
    <button disabled={busy||terminal} aria-pressed={session?.muted||false} onClick={()=>run(()=>client.current.action(session.muted?'unmute':'mute'))}>{t(session?.muted?'取消静音':'静音')}</button>
    <button disabled={terminal} onClick={()=>run(()=>client.current.action('interrupt'))}>{t('打断')}</button>
    <button disabled={busy||terminal} onClick={()=>run(()=>client.current.action('quiet'))}>{t('共同安静')}</button>
    <button disabled={terminal} onClick={()=>run(()=>client.current.action('end'))}>{t('结束')}</button>
   </div>
  </div>
  {error&&<p role="alert" className="presence-fixture-tools">{t('语音暂不可用')} · {error} · {t('可以继续使用文字输入')}</p>}
  <details className="presence-fixture-tools"><summary>{t('开发测试后端与回顾')}</summary><label>{t('测试后端')} <Select ariaLabel={t('测试后端')} data-speech-backend value={backend} onChange={value=>setBackend(value)} options={[{value:'fake-a',label:'fake A'},{value:'fake-b',label:'fake B'}]}/></label><label>{t('测试场景')}<Select ariaLabel={t('测试场景')} data-speech-scenario value={scenario} onChange={value=>setScenario(value)} options={['normal','revision','duplicate_final','no_input','overlap','refuse','quiet','disconnect','fail','delayed','late','cleanup_failure'].map(value=>({value,label:value}))}/></label><button disabled={busy||session?.state!=='reconnecting'} onClick={()=>run(()=>client.current.action('reconnect'))}>{t('重新连接（测试）')}</button><button disabled={busy||terminal} onClick={()=>run(()=>client.current.action('refuse'))}>{t('拒绝互动')}</button><button onClick={()=>setReview(v=>!v)}>{t('回顾测试 transcript')}</button><small>{t('切换后端须明确开始新会话；不改变关系或权限')}</small></details>
  {review&&<div className="presence-transcript">{data.transcript.map(item=><article key={item.turn_id+item.source}><p>{t(item.text)}</p>{item.source!=='withu_tts'&&<button onClick={()=>{setCorrection(item.text);setEditing(item);}}>{t('修正文字')}</button>}</article>)}</div>}
<form className="presence-correction" hidden={!editing} onSubmit={e=>{e.preventDefault();void run(async()=>{await client.current.correct(correction,editing.revision);setEditing(null);});}}><label>{t('修正测试字幕')}<textarea value={correction} onChange={e=>setCorrection(e.target.value)}/></label><button disabled={busy||!correction.trim()}>{t('应用到本次预览')}</button><button type="button" onClick={()=>setEditing(null)}>{t('取消')}</button></form>
  <footer>{t('测试字幕仅会话内保存，不进入消息历史、搜索、任务或记忆。实际回声分离尚未验证。')}</footer>
 </section>;
}
