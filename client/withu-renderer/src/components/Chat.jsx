import {useMessageReader} from './MessageReader';
import SpeechControls from './SpeechControls';
import MarkdownMessage from './MarkdownMessage';
import Loader from './Loader';
import {errorCopy} from '../model-config/error-copy.mjs';
import { t } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon, { IconButton, MessageIconScope } from "./Icon";
import Composer from "./Composer";
import MessageActions from "./MessageActions";
import ResponseCard from "./ResponseCard";
import EmotionalBall from "./EmotionalBall";
import VoiceCall from "./VoiceCall";
import {desktopBridge} from '../desktop-bridge';
import {IntelligentSurface} from '../intelligent-ui';
import {localizedTitle} from '../intelligent-ui/titles.js';
import {createChatActionHandler} from '../life-actions';
import './ChatHeader.css';

// 模型在回答末尾带上这个标记，就说明这条会话需要底部的浏览器抽屉。
export const SURFACE_TAG='[[surface:arch]]';
// 联网搜索标记：[[surface:web:查询词]] —— 渲染时剥除，并驱动抽屉浏览器
// 自动打开与搜索（与 SURFACE_TAG 同一套模型文本协议）。
export const WEB_TAG_RE=/\[\[surface:web:([^\]]*)\]\]/;

// T10：助手消息携带的交互块（模型提议的本地事务审批卡）。pending 决策走
// IntelligentSurface 的允许一次/取消；已决策的块如实显示当时的决定，
// 不伪造成功。同一动作重复确认被 createChatActionHandler 本地拒绝。
const decidedCopy={allow:'已允许执行；结果以当时回执为准。',deny:'已拒绝；没有产生任何改动。',expired:'此提议已被新的修改取代或过期，不会再执行。'};
function MessageBlocks({blocks}){
  const bridge=desktopBridge();
  const pending=blocks.filter(block=>!(block.kind==='approval'&&block.payload?.decision&&block.payload.decision!=='pending'));
  const decided=blocks.filter(block=>block.kind==='approval'&&block.payload?.decision&&block.payload.decision!=='pending');
  const pendingKey=pending.map(block=>`${block.block_id}:v${block.status_version}`).join('|');
  const handlers=useMemo(()=>{
    const map=new Map();
    // 决策（允许/取消）落库后由 App/活动面板/日程页监听 withu:life:changed
    // 重新拉取：消息块镜像成静态「已允许/已拒绝」，生活列表立即出现新条目。
    if(bridge)for(const block of pending)map.set(block.block_id,createChatActionHandler({block,bridge,afterApplied:()=>{window.dispatchEvent(new Event('withu:life:changed'));}}));
    return map;
  },[pendingKey,bridge]);
  const onAction=intent=>handlers.get(intent?.block_id)?.(intent);
  return <div className="chat-message-blocks">
    {pending.length>0&&handlers.size>0&&<IntelligentSurface compact blocks={pending} onAction={onAction}/>}
    {decided.map(block=><div key={block.block_id} className="intelligent-surface intelligent-surface-compact" role="status">
      <div className="intelligent-block">
        <div className="intelligent-block-top"><div><span className="intelligent-source"><span className="intelligent-source-mark" aria-hidden="true">W</span>Withu</span><h2>{localizedTitle(block.payload.title)}</h2></div><span className="intelligent-status" role="status"><span className="intelligent-status-dot" aria-hidden="true"/>{block.payload.decision==='allow'?'已允许':block.payload.decision==='deny'?'已拒绝':'已失效'}</span></div>
        <p className="intelligent-copy">{decidedCopy[block.payload.decision]}</p>
      </div>
    </div>)}
  </div>;
}

export default function Chat({
  chat, messageFocus, modelLabel, ballPresence='idle', replyRun, asrPreview, onCancelGeneration,onPresencePreview,
  state,
  onSend,
  onAttach,
  attachments,
  onRemove,
  onChats,
  busy,
  onEditMessage,
  onActivity,onLive,onHangup,onCallEnded,onPreview,onSubmitted,onInterrupt,onNewChat,callOpen=false,ttsMuted=false,onToggleTts=()=>{},
  callLevel=0,onCallLevel=()=>{},micMuted=false,onMicMuted=()=>{},onTranscript=()=>{},
  onReply,
  onReaction,
  onCopy,
  onSources,
  onRecall=()=>{},
  replyTo,
  onCancelReply,
  onNotice,
  text, onText, mode, ballMood, onBallMood, ballPulse, onBallInteract,
  onOpenDrawer,
  onWebSearch,
}) {
  const end = useRef();
  const messagesRef = useRef();
  const reader=useMessageReader({chat,callOpen,onNotice});


  const [correction,setCorrection]=useState(null),[savingCorrection,setSavingCorrection]=useState(false);
 // Support handlers are retained verbatim for the T06/T14 re-home and stay covered by checks/support-ui-scope.mjs; the T04 heading entry itself was removed per the locked GUI requirement.
  const [supportOpen,setSupportOpen]=useState(false),[supportNeed,setSupportNeed]=useState('listening'),[supportBoundary,setSupportBoundary]=useState(''),[supportPlan,setSupportPlan]=useState(null),[supportBusy,setSupportBusy]=useState(false),[supportDone,setSupportDone]=useState(false);
  const supportScope=useRef(chat.id),supportGeneration=useRef(0);
  // Invalidate immediately on render so an old promise cannot update the next chat before its effect runs.
  if(supportScope.current!==chat.id){supportScope.current=chat.id;supportGeneration.current++;}
  useEffect(()=>{setSupportPlan(null);setSupportDone(false);setSupportOpen(false);setSupportBusy(false);setSupportNeed('listening');setSupportBoundary('');return()=>{supportGeneration.current++;};},[chat.id]);
  const createSupportPlan=async()=>{const generation=++supportGeneration.current;const current=()=>generation===supportGeneration.current&&supportScope.current===chat.id;setSupportBusy(true);try{const plan=await desktopBridge().affectPlan({schema_version:1,conversation_id:chat.id,turn_id:crypto.randomUUID(),stated_need:supportNeed,boundary:supportBoundary.trim()||null});if(current()){setSupportPlan(plan);setSupportDone(false);}}catch(e){if(current())onNotice(errorCopy(e.message));}finally{if(current())setSupportBusy(false);}};
  const submitSupportFeedback=async outcome=>{if(!supportPlan)return;const generation=++supportGeneration.current;const current=()=>generation===supportGeneration.current&&supportScope.current===chat.id;setSupportBusy(true);try{await desktopBridge().affectFeedback({schema_version:1,conversation_id:chat.id,turn_id:supportPlan.plan.turn_id,action:supportPlan.plan.primary_action,user_feedback:outcome,next_turn_signal:null,outcome,user_correction:null});if(current()){setSupportDone(true);setSupportPlan(null);}}catch(e){if(current())onNotice(errorCopy(e.message));}finally{if(current())setSupportBusy(false);}};
  const saveCorrection=async()=>{setSavingCorrection(true);try{await onEditMessage(correction.message,correction.text);setCorrection(null);}catch(e){onNotice(errorCopy(e.message));}finally{setSavingCorrection(false);}};
  // 联网搜索标记：每条助手消息只触发一次抽屉搜索（历史重读不重复弹）。
  const webHandled=useRef(new Set());
  useEffect(()=>{
    for(const m of chat.messages||[]){
      if(m.role!=='assistant'||webHandled.current.has(m.id))continue;
      const match=WEB_TAG_RE.exec(m.text||'');
      webHandled.current.add(m.id);
      if(match&&match[1])onWebSearch?.(decodeURIComponent(match[1]));
    }
  },[chat.messages,onWebSearch]);
  // 只滚消息列表自己。scrollIntoView 会连 overflow:hidden 的主舞台一起滚，
  // 空会话时整页会被顶上去，输入框看起来就飞了。
  useEffect(() => {
    const box = messagesRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length,asrPreview?.text,replyRun?.text]);
  useEffect(()=>{
    if(!messageFocus)return;
    const box = messagesRef.current;
    const message=[...(box || end.current?.parentElement)?.querySelectorAll('[data-message-id]')||[]].find(e=>e.dataset.messageId===messageFocus.id);
    if(!message)return;
    if(box){
      const mr=message.getBoundingClientRect(),br=box.getBoundingClientRect();
      box.scrollTo({top:box.scrollTop+(mr.top-br.top)-(br.height-mr.height)/2,behavior:'smooth'});
    }
    const content=message.querySelector('.message-content');
    const glow='0 0 0 2px color-mix(in srgb,var(--fill-blue) 30%,transparent),0 4px 22px color-mix(in srgb,var(--fill-blue) 28%,transparent)';
    const animation=content.animate([{boxShadow:'0 0 0 0 transparent',offset:0},{boxShadow:glow,offset:.45},{boxShadow:'0 0 0 0 transparent',offset:1}],{duration:900,iterations:2,easing:'ease-in-out'});
    return()=>animation.cancel();
  },[messageFocus,chat.id]);
 // Empty conversation: no committed message yet (call summaries count as content).
 // The composer keeps its normal spot at the bottom; only the message rows hide.
  const conversationEmpty = !chat.messages.length;
  // The bundled app may only propose against a committed user message; reuse the latest one.
  const lastUserMessage = [...chat.messages].reverse().find(m=>m.role==='user');
  // 撤回只支持最近发出的一条用户消息；更早的悬停与点击都给委婉提示。
  const lastRecallableId = lastUserMessage?.id;
  // Call case copy: the case labels the voice state, shows the live transcript
  // with a softer tail, and keeps a four-pill control row under both views.
  return (
    <section className={"chat-view "+(callOpen?'live-active':'')+(conversationEmpty?' conversation-empty':'')}>
      <header className="chat-heading">
      <div className="chat-heading-actions" role="group" aria-label="对话操作">
      <IconButton icon="k-newchat" label="新建对话" title="新建对话" size={40} iconSize={18} onClick={onNewChat}/>
      <div className="stage-controls-pill">
        <IconButton icon={reader.automatic?'speaker':'speakerMuted'} label={reader.automatic?'关闭自动朗读':'开启自动朗读'} size={32} iconSize={18} aria-pressed={reader.automatic} disabled={callOpen} onClick={reader.toggle}/>
        <span className="pill-divider" aria-hidden="true"/>
        {state.voice?.enabled&&<div className="voice-call-anchor">
          <button data-speech-activate-audio className="icon-button call-toggle" aria-label="Withu-Live 通话" disabled={callOpen} title="WithU-Live 通话" onClick={onLive}><Icon name="call" size={18}/></button>
        </div>}
        {state.voice?.enabled&&<span className="pill-divider" aria-hidden="true"/>}
        <IconButton
          icon="k-list-rows"
          label={t("Open activity panel")}
          iconSize={17}
          size={32}
          disabled={callOpen}
          onClick={onActivity}
        />
      </div>
      </div>
      </header>
      {state.connection === "error" && <div className="server-unavailable" role="status">{t("Withu Server 未就绪")}</div>}
      {/* GO1 icons are restored for the message rows only. The sheet the case
          icons were traced from covers navigation art; when the app icon was
          reworked these message slots started pointing at sheet entries with the
          wrong meaning (copy showed a window, reaction a heart). */}
      <div className="chat-messages" ref={messagesRef} aria-label={t("Chat messages")}>
        <MessageIconScope>
        {chat.messages.map((m) => m.role==='call'?<article className="live-call-record" key={m.id} data-message-id={m.id}><div className="message-content">{m.text}</div></article>:(
          <article className={"message " + m.role} key={m.id} data-message-id={m.id}>
            <div className="message-content">
              {m.replyTo && (
                <div className="inline-reply">
                  <Icon name="reply" size={14} />
                  <span>{m.replyTo.text}</span>
                </div>
              )}
              {mode==='cowork'&&m.role==='assistant'&&(m.thinking||m.work_trace?.length>0)&&<details className="work-trace"><summary>{m.duration_ms!=null?`用时 ${Math.round(m.duration_ms/1000)} 秒`:'思考与工作轨迹'}</summary>{m.thinking&&<p>{m.thinking}</p>}{m.work_trace?.map((step,i)=><p key={i}>{typeof step==='string'?step:step.summary}</p>)}</details>}
              {correction?.message.id===m.id?<div className="transcript-correction"><textarea aria-label="纠正语音转写" value={correction.text} maxLength={16000} onChange={e=>setCorrection({...correction,text:e.target.value})}/><button disabled={savingCorrection||!correction.text.trim()} onClick={saveCorrection}>保存纠正</button><button disabled={savingCorrection} onClick={()=>setCorrection(null)}>取消</button><small>保存后结束当前通话；重新开始会使用纠正后的文字。</small></div>:m.role==='assistant'?<MarkdownMessage text={(m.summary||m.text).replace(SURFACE_TAG,'').replace(WEB_TAG_RE,'').trim()}/>:m.summary||m.text}              {m.responseCard&&<ResponseCard card={m.responseCard} mode={mode} onOpenInDrawer={onOpenDrawer} />}
              {m.role==='assistant'&&m.blocks?.length>0&&<MessageBlocks blocks={m.blocks}/>}
              {m.attachments?.map((f) => (
                <div className="message-attachment" key={f.id}>
                  <Icon name="document" size={18} />
                  {f.name}
                </div>
              ))}
            </div>
            {m.role === "assistant" ? (
              <>
                <MessageActions
                  message={m}
                  voiceAction={reader.button(m)}
                  onReply={onReply}
                  onReaction={onReaction}
                  onCopy={onCopy}
                  onEdit={onEditMessage}
                  onMore={onSources}
                />

                {mode==='cowork'&&<small className="message-token-usage">用量 {m.usage?.total_tokens!=null?`${m.usage.total_tokens.toLocaleString()} tok`:'暂无数据'}</small>}
                {m.reactions?.length > 0 && (
                  <div className="message-reactions">
                    {m.reactions.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => onReaction(m.id, emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              // 自己发出的消息：返回箭头＝撤回（连同它下面的回复一起收回，原文回到输入框）。
              // 语音转写消息额外保留一个纠正入口，那是通话中才会出现的特殊消息。
              <div className="message-actions">
                {m.id.startsWith('rt-')&&<IconButton
                  icon="edit"
                  label={t("Edit message")}
                  size={24}
                  onClick={() => setCorrection({message:m,text:m.text})}
                />}
                <IconButton
                  icon="reply"
                  label={m.id===lastRecallableId? t("Recall message"): t("时间有点久了，只有最新的一条消息可以撤回")}
                  size={24}
                  onClick={() => onRecall(m)}
                />
              </div>
            )}
          </article>
        ))}
        {replyRun&&['running','complete','failed','cancelled'].includes(replyRun.state)&&!chat.messages.some(m=>m.id===replyRun.operation_id)&&<article className="message assistant"><div className="message-content" aria-live="polite">{replyRun.text?<MarkdownMessage text={replyRun.text.replace(WEB_TAG_RE,'')}/>:replyRun.state==='running'?<Loader label={t('正在等待模型回应…')} size={17}/>:null}</div></article>}
        {replyRun?.state==='failed'&&<p role="status">{t(errorCopy(replyRun.code))}</p>}
        {busy && (
          <div className="typing" aria-label={t("Waiting for reply")}>
            <i />
            <i />
            <i />
          </div>
        )}

        <div ref={end} />
        </MessageIconScope>
      </div>
      {callOpen?<VoiceCall key={chat.id} conversationId={chat.id} mode="live" onFailed={onHangup} onLevel={onCallLevel} onTranscript={onTranscript} onEnded={onCallEnded} onPreview={onPreview} onSubmitted={onSubmitted} onInterrupt={onInterrupt} onNotice={onNotice} muted={ttsMuted} micMuted={micMuted}/>:null}
      {!callOpen&&<EmotionalBall floating presenceState={ballPresence} mood={ballMood} onMood={onBallMood} pulse={ballPulse} onInteract={onBallInteract}/>}
      <SpeechControls conversationId={chat.id} onPresence={onPresencePreview}/>

      <Composer
        {...{
          conversationId:chat.id,onSend,onLive,callOpen,voiceEnabled:state.voice?.enabled, modelLabel,replyRunning:replyRun?.state==='running',onCancelGeneration,
          onAttach,
          attachments,
          onRemove,
          busy,
          replyTo,
          onCancelReply,
          language: state.language,
          onNotice,
          text, onText, mode, messages:chat.messages,
        }}
      />
    </section>
  );
}
