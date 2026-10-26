import {useEffect,useState} from 'react';
import {t} from '../i18n';
export default function AudioProbePreview({details}) {
 const [url,setUrl]=useState('');
 useEffect(()=>{
  if(!details?.audio_base64){setUrl('');return;}
  const raw=atob(details.audio_base64),bytes=new Uint8Array(44+raw.length),v=new DataView(bytes.buffer);
  const str=(at,text)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
  str(0,'RIFF');v.setUint32(4,36+raw.length,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,details.sample_rate,true);v.setUint32(28,details.sample_rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,raw.length,true);
  for(let i=0;i<raw.length;i++)bytes[44+i]=raw.charCodeAt(i);
  const next=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));setUrl(next);
  return()=>URL.revokeObjectURL(next);
 },[details]);
 return url?<div className="model-audio-preview"><p>{t('合成接口测试通过，点击播放检查声音；未验证实际设备或整链路。')}</p><audio controls preload="metadata" src={url} aria-label={t('播放测试声音')}/></div>:null;
}
