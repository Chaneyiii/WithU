import { t } from '../i18n';
import { useEffect, useRef } from 'react';
import { LiquidCompanion } from '../emotional-ball/liquid-companion';
import {OrbBehavior} from '../emotional-ball/behavior.mjs';
import '../emotional-ball/liquid-companion.css';
import { applyPresenceTransition } from '../presence/presentation';

// 悬停时说的话：不再解释怎么点，而是像在旁边随口搭一句。
// 每进一次洗一副牌，保证连着几次尽量不重样。
const HINTS = [
  '今天想聊点什么？',
  '我一直在这儿。',
  '要不要先歇一会儿？',
  '慢一点也没关系。',
  '陪你待着就挺好。',
  '有什么想说的，尽管说。',
  '我在这儿，不着急。',
  '今天过得怎么样？',
  '深呼吸一下，再继续。',
  '要不要我帮你理一理？',
  '嗯，我在听。',
  '有点累了？先喝口水。',
  '你不说，我也在旁边。',
  '刚才那件事，我还记着。',
  '想到什么就说什么。',
  '喝口茶再回来也行。',
];

export default function EmotionalBall({ mood, onMood, floating = false, pulse = 0, onInteract, presentationOnly = false, presenceState }) {
  const mount = useRef(), character = useRef(), behavior = useRef(), drag = useRef(), clickTimer = useRef(), lastTap = useRef(-1000);
  const touch = useRef(null), bag = useRef([]), lastHint = useRef('');
  const previousPresence = useRef(presenceState);
  const previousPulse = useRef(pulse);
  useEffect(() => {
    const ball = new LiquidCompanion(mount.current); character.current = ball;
    const controller=new OrbBehavior(ball);behavior.current=controller;
    const cue=e=>controller.cue(e.detail.kind);window.addEventListener('withu-ball-cue',cue);
    const gaze = event => { if (event.pointerType !== 'touch') ball.setGazeFocus(event.clientX, event.clientY); };
    const clear = () => ball.clearGazeFocus();
    document.addEventListener('pointermove', gaze); document.addEventListener('pointerleave', clear);
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('withu-ball-cue',cue);clearTimeout(clickTimer.current);controller.destroy();document.removeEventListener('pointermove', gaze); document.removeEventListener('pointerleave', clear); window.removeEventListener('blur', clear); ball.destroy(); };
  }, []);
  useEffect(() => { character.current?.setManaged(Boolean(presenceState&&presenceState!=='idle'));behavior.current?.baseState(mood,presenceState); }, [mood,presenceState]);
  useEffect(()=>{const volume=e=>{if(presenceState==='speaking'||presenceState==='listening')character.current?.setVolume(e.detail.level);};window.addEventListener('withu-voice-level',volume);if(!['speaking','listening'].includes(presenceState))character.current?.clearVolume();return()=>window.removeEventListener('withu-voice-level',volume);},[presenceState]);
  useEffect(() => {
    applyPresenceTransition(character.current, previousPresence.current, presenceState);
    previousPresence.current = presenceState;
  }, [presenceState]);
  useEffect(() => { if (pulse!==previousPulse.current) behavior.current?.interact();previousPulse.current=pulse; }, [pulse]);
  const interact = () => { behavior.current?.interact();onInteract?.(); };
  const double = () => {clearTimeout(clickTimer.current);lastTap.current=-1000;character.current.bounce=.16;interact();};
  const down = event => {
    if (presentationOnly || event.button !== 0) return;
    clearTimeout(clickTimer.current);
    drag.current = { x:event.clientX,y:event.clientY,moved:false };
    character.current.pressTarget=1;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = event => {
    if (!drag.current) return;
    const dx=event.clientX-drag.current.x,dy=event.clientY-drag.current.y;
    if(Math.hypot(dx,dy)>7){drag.current.moved=true;const ball=character.current;ball.dragging=true;ball.pressTarget=.2;ball.target.x=Math.max(-.38,Math.min(.38,dx/ball.w*3.05));ball.target.y=Math.max(-.32,Math.min(.32,-dy/ball.w*3.05));behavior.current?.interact();}
  };
  const up = event => {
    if(!drag.current)return;
    const moved=drag.current.moved;drag.current=null;const ball=character.current;
    ball.pressTarget=0;ball.dragging=false;ball.target.x=0;ball.target.y=0;
    if(event.type==='pointercancel')return;
    if(moved){ball.bounce=.08;interact();return;}
    const now=performance.now();if(now-lastTap.current<310){double();return;}
    lastTap.current=now;clickTimer.current=setTimeout(()=>{ball.wink();interact();},230);
  };
  // 选一句：一副洗好的牌，抽完再洗；新一轮第一张不与上一句重复。
  const speak = () => {
    if (!bag.current.length) {
      const next = HINTS.slice();
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      if (next[next.length - 1] === lastHint.current && next.length > 1) {
        [next[0], next[next.length - 1]] = [next[next.length - 1], next[0]];
      }
      bag.current = next;
    }
    const line = bag.current.pop();
    lastHint.current = line;
    if (touch.current) touch.current.dataset.tooltip = line;
  };
  // 用原生 pointerenter 而不是 React 的合成事件：每次真的移进来都要换一句，
  // 合成事件在 pointerover 没有 relatedTarget 时会漏掉后几次。
  useEffect(() => {
    const el = touch.current;
    if (!el || presentationOnly) return undefined;
    const say = () => speak();
    el.addEventListener("pointerenter", say);
    el.addEventListener("focus", say);
    return () => {
      el.removeEventListener("pointerenter", say);
      el.removeEventListener("focus", say);
    };
  }, [presentationOnly]);

  return <div className={'emotional-ball ' + (floating ? 'floating-ball' : 'panel-ball')}>
    <button ref={touch} className="ball-touch" aria-label={t(presentationOnly ? "lumi 2D 球体 · 会话状态预览" : "与 lumi 情绪球互动")} data-tooltip={presentationOnly ? undefined : HINTS[0]} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={presentationOnly?undefined:event=>{if(event.detail===0){character.current.wink();interact();}}} onContextMenu={event=>{event.preventDefault();if(!presentationOnly)double();}}><span ref={mount} className="ball-render"/></button>
  </div>;
}
