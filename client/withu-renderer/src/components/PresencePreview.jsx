import {useEffect,useState} from 'react';
import {t} from '../i18n';
import EmotionalBall from './EmotionalBall';
import {PRESENCE_STATES,PRESENCE_LABELS,presentSpeech} from '../presence/presentation';
import {usePresenceFixture} from '../presence/usePresenceFixture';
import '../presence/presence.css';

export default function PresencePreview({scope,onPresence}) {
 const [opened,setOpened]=useState(()=>new URLSearchParams(location.search).get('presence')==='1');
 const [review,setReview]=useState(false),[editing,setEditing]=useState(null),[correction,setCorrection]=useState('');
 const [presence,dispatch]=usePresenceFixture(opened,scope);
 const mapped=presentSpeech({schema_version:1,state:presence.state});
 useEffect(()=>{onPresence(opened?presence:null);return()=>onPresence(null);},[opened,presence,onPresence]);
 useEffect(()=>{setEditing(null);setReview(false);},[scope,opened]);
 const label=presence.refused?'已停止互动':presence.quiet?'一起安静一会儿':presence.muted&&presence.state==='idle'?'麦克风已静音':PRESENCE_LABELS[mapped.state];
 const captionsEmpty=presence.state==='ended'?'没有继续录音或自动重新开始':presence.quiet?'不用说话，也不必回应':presence.muted?'可以继续使用文字输入':'实时字幕会显示在这里';
 const correct=item=>{setEditing(item.id);setCorrection(item.text);};
 const apply=e=>{e.preventDefault();if(!correction.trim())return;dispatch({type:'correct',id:editing,text:correction.trim()});setEditing(null);};
 return <section className={'presence-preview '+(opened?'is-open':'')} aria-label={t('Presence 开发预览')} data-presence-state={presence.state} data-presence-open={opened}>
  <header className="presence-preview-header"><span>{t('Presence 开发预览')}</span><small>{t('仅视觉 fixture · 不录音、不播放、不写入历史')}</small><button aria-expanded={opened} onClick={()=>setOpened(v=>!v)}>{t(opened?'收起预览':'打开预览')}</button></header>
  {opened&&<>
   <div className={'presence-stage state-'+presence.state+(presence.quiet?' is-quiet':'')}>
    <div className="presence-visual">
     <EmotionalBall mood={mapped.mood} presenceState={presence.state} presentationOnly/>
    </div>
    <span className="presence-status" role="status"><i/>{t(label)}</span>
    <div className={'presence-caption '+(presence.caption?.kind||'empty')} aria-live="polite" aria-atomic="true">
     {presence.caption?<><small>{t(presence.caption.speaker==='user'?'你 · 测试字幕':'Withu · 测试字幕')} · {t(presence.caption.kind==='partial'?(presence.caption.speaker==='user'?'识别中 · 可能变化':'生成中 · 可能变化'):'已定稿')}{presence.caption.corrected&&' · '+t('已修正')}</small><p>{t(presence.caption.text)}</p>{presence.caption.kind==='final'&&presence.caption.speaker==='user'&&<button onClick={()=>correct(presence.caption)}>{t('修正文字')}</button>}</>:<p>{t(captionsEmpty)}</p>}
    </div>
    <div className="presence-call-controls" role="group" aria-label={t('通话控件预览')}>
     <button className="presence-start" onClick={()=>dispatch({type:'start'})}>{t(presence.state==='ended'?'重新开始（预览）':'开始（预览）')}</button>
     <button aria-pressed={presence.muted} disabled={presence.state==='ended'} onClick={()=>dispatch({type:'mute'})}>{t(presence.muted?'取消静音':'静音')}</button>
     <button disabled={presence.state==='ended'||presence.state==='idle'} onClick={()=>dispatch({type:'interrupt'})}>{t('打断')}</button>
     <button className="presence-end" disabled={presence.state==='ended'} onClick={()=>dispatch({type:'end'})}>{t('结束')}</button>
    </div>
   </div>
   <details className="presence-fixture-tools" open><summary>{t('开发 fixture · 手动状态与字幕')}</summary>
    <div className="presence-state-grid" role="group" aria-label={t('八种会话状态')}>{PRESENCE_STATES.map(id=><button key={id} aria-pressed={presence.state===id} onClick={()=>dispatch({type:'state',state:id})}>{t(PRESENCE_LABELS[id])}</button>)}</div>
    <div className="presence-fixture-actions"><button onClick={()=>dispatch({type:'demo'})}>{t('演示 partial → final')}</button><button onClick={()=>dispatch({type:'quiet'})}>{t('共同安静')}</button><button onClick={()=>dispatch({type:'refuse'})}>{t('拒绝互动')}</button><button aria-expanded={review} onClick={()=>setReview(v=>!v)}>{t('回顾测试 transcript')}</button></div>
   </details>
   {editing&&<form className="presence-correction" onSubmit={apply}><label>{t('修正测试字幕')}<textarea autoFocus value={correction} onChange={e=>setCorrection(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setEditing(null);}}/></label><button type="submit" disabled={!correction.trim()}>{t('应用到本次预览')}</button><button type="button" onClick={()=>setEditing(null)}>{t('取消')}</button><small>{t('仅修改测试 transcript；不发送消息，不保存记忆。')}</small></form>}
   {review&&<div className="presence-transcript"><strong>{t('本次预览 transcript')}</strong><small>{t('仅保留定稿；收起、切换或刷新后不恢复，不进入搜索。')}</small>{presence.transcript.length?presence.transcript.map(item=><article key={item.id}><small>{t(item.speaker==='user'?'你':'Withu')}{item.corrected&&' · '+t('已修正')}</small><p>{t(item.text)}</p>{item.speaker==='user'&&<button onClick={()=>correct(item)}>{t('修正文字')}</button>}</article>):<p>{t('还没有定稿字幕')}</p>}</div>}
   <footer>{t('状态表示会话运行，不是你的情绪判断。真实语音仍未配置。')}</footer>
  </>}
 </section>;
}
