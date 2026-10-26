import {useEffect,useRef,useState} from 'react';
import {desktopBridge} from '../desktop-bridge';
import {RealtimeCall} from '../speech/realtime-call.mjs';
import {errorCopy} from '../model-config/error-copy.mjs';
import './ChatVoice.css';
export default function VoiceCall({conversationId,onSubmitted,onInterrupt,onNotice,onPreview=()=>{},onConnected,onEnded,onFailed,onLevel,onInputComplete,onTranscript=()=>{},muted,micMuted=false,mode='call'}){
 const [phase,setPhase]=useState('acquiring'),[level,setLevel]=useState(0),runtime=useRef(),callbacks=useRef(),liveRecord=useRef(null);
 callbacks.current={onSubmitted,onInterrupt,onNotice,onPreview,onConnected,onEnded,onFailed,onLevel,onInputComplete,onTranscript};
 const audioPhase=useRef(phase),inputLevel=useRef(level),micMutedRef=useRef(micMuted);audioPhase.current=phase;inputLevel.current=level;micMutedRef.current=micMuted;
 useEffect(()=>{let disposed=false,reconnect,retries=0;const b=desktopBridge(),call=new RealtimeCall(b,conversationId,{ended:record=>{if(mode!=='live')callbacks.current.onEnded?.(record);},connected:()=>{retries=0;if(mode!=='live'||!liveRecord.current){if(mode==='live')liveRecord.current={id:call.scope.session_id,conversationId,mode,startedAt:Date.now(),tick:performance.now()};callbacks.current.onConnected?.();}},state:setPhase,level:value=>setLevel(value),caption:text=>{if(mode!=='live')callbacks.current.onPreview(text?{conversationId,text}:null);},transcript:value=>{if(mode!=='live')return;callbacks.current.onTranscript(value);},inputComplete:()=>callbacks.current.onInputComplete?.(),submitted:()=>{if(mode!=='live')callbacks.current.onSubmitted();},interrupt:()=>callbacks.current.onInterrupt(),cue:kind=>window.dispatchEvent(new CustomEvent('withu-ball-cue',{detail:{kind}})),error:e=>callbacks.current.onNotice(mode==='live'?'语音连接暂不可用，通话保持中。':errorCopy(e.message)),failed:(e,reconnectable)=>{if(mode!=='live'){callbacks.current.onFailed?.();return;}if(!reconnectable||disposed)return;clearTimeout(reconnect);setPhase('acquiring');reconnect=setTimeout(()=>{if(!disposed)void call.reconnect().catch(error=>call.fail(error));},Math.min(10000,1000*2**Math.min(retries++,4)));}},mode);runtime.current=call;
  const events=b.onEvent(e=>{if(e.record?.event==='config.committed'){call.fail(Error('config_version_conflict'));}else call.event(e);});
  const cleanup=b.onSpeechCleanup(()=>call.end()),connection=b.onConnection(s=>{if(s.lifecycle==='failed')call.fail(Error('service_unavailable'));});
  const start=setTimeout(()=>{void call.start().catch(e=>call.fail(e));},0);
 const meter=setInterval(()=>{const current=audioPhase.current;const value=current==='playing'?call.outputLevel():current==='recording'&&!micMutedRef.current?inputLevel.current:0;callbacks.current.onLevel?.(value);window.dispatchEvent(new CustomEvent('withu-voice-level',{detail:{level:value}}));},50);
 return()=>{disposed=true;clearTimeout(reconnect);clearTimeout(start);clearInterval(meter);callbacks.current.onTranscript(null);callbacks.current.onLevel(0);callbacks.current.onPreview(null);void call.end();events();cleanup();connection();};
 },[conversationId,mode]);
 useEffect(()=>()=>{const record=liveRecord.current;if(record){const {tick,...saved}=record;callbacks.current.onEnded?.({...saved,endedAt:Date.now(),durationMs:Math.floor(performance.now()-tick)});liveRecord.current=null;}},[conversationId,mode]);
 useEffect(()=>runtime.current?.setMuted(muted),[muted]);
 useEffect(()=>runtime.current?.setMicMuted(micMuted),[micMuted]);
 useEffect(()=>{const states={acquiring:'reconnecting',listening:'listening',recording:'listening',thinking:'thinking',playing:'speaking',failed:'degraded'};window.dispatchEvent(new CustomEvent('withu-voice-presence',{detail:{state:states[phase]||'idle'}}));return()=>window.dispatchEvent(new CustomEvent('withu-voice-presence',{detail:{state:'idle'}}));},[phase]);
 return <span hidden data-call-phase={phase}/>;
}
