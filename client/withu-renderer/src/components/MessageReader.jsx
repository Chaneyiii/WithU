import {useEffect,useRef,useState} from 'react';
import {RealtimeCall} from '../speech/realtime-call.mjs';
import {desktopBridge} from '../desktop-bridge';
import {errorCopy} from '../model-config/error-copy.mjs';
import {IconButton} from './Icon';
export function useMessageReader({chat,callOpen,onNotice}){
 const [automatic,setAutomatic]=useState(false),[reading,setReading]=useState(null);
 const current=useRef(null),seen=useRef(new Set()),request=useRef(0);
 const stop=()=>{request.current++;const active=current.current;current.current=null;setReading(null);void active?.end();};
 const read=async message=>{
  if(callOpen)return;if(reading===message.id){stop();return;}
  const previous=current.current;stop();const ticket=request.current;await previous?.end();if(ticket!==request.current)return;
  const bridge=desktopBridge();const instance=new RealtimeCall(bridge,chat.id,{state:s=>{if(s==='listening'&&instance.playedResponse)stop();},level(){},caption(){},submitted(){},interrupt(){},error:e=>onNotice(errorCopy(e.message)),failed:stop},'read');
  instance.messageId=message.id;current.current=instance;setReading(message.id);
  const unsubscribe=bridge.onEvent(e=>instance.event(e));const end=instance.end.bind(instance);instance.end=()=>{unsubscribe();return end();};
  try{await instance.start();}catch(e){instance.fail(e);}
 };
 useEffect(()=>{seen.current=new Set(chat.messages.map(m=>m.id));stop();},[chat.id]);
 useEffect(()=>{
  const added=chat.messages.filter(m=>!seen.current.has(m.id));seen.current=new Set(chat.messages.map(m=>m.id));
  if(added.some(m=>m.role==='user')||callOpen)stop();
  if(automatic&&!callOpen){const message=added.filter(m=>m.role==='assistant').at(-1);if(message)void read(message);}
 },[chat.messages,automatic,callOpen]);
 useEffect(()=>{const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);return()=>{document.removeEventListener('visibilitychange',hidden);stop();};},[]);
 return {automatic,reading,toggle:()=>{if(automatic)stop();setAutomatic(!automatic);},button:message=><IconButton icon={reading===message.id?'stop':'speaker'} label={reading===message.id?'停止朗读':'朗读消息'} size={28} iconSize={16} disabled={callOpen} onClick={()=>void read(message)}/>};
}
