import {encodeBytes,pcmFloats} from './finite-audio.mjs';
import {mediaCoordinator} from '../../../withu-mcp-app/src/media.js';
export class RealtimeCall {
 constructor(bridge,cid,callbacks,mode='call'){this.mode=mode;this.bridge=bridge;this.cid=cid;this.cb=callbacks;this.stopped=false;this.sequence=0;this.inputQueue=[];this.inputSending=false;this.sources=new Set();this.nextPlay=0;this.blocked=new Set();this.inputTexts=new Map();this.early=[];this.muted=false;this.micMuted=false;this.generation=0;this.assistantText='';}
 // The live card shows what is being said right now, so the caption is not
 // enough: it only carries the user's ASR. This dedicated stream carries both
 // sides of the turn and is cleared whenever a new one starts.
 transcript(value){if(this.cb.transcript)this.cb.transcript(value?{conversationId:this.cid,...value}:null);}
 state(s){this.cb.state(s);}
 async start(){mediaCoordinator.setVoice(this,true);this.starting=this.acquire().catch(error=>{void this.end();throw error;});return this.starting;}
 async acquire(){
  if(this.mode!=='read'){await this.bridge.speechAuthorizeAudio();this.authorized=true;}if(this.stopped)return;
  const stream=this.mode==='read'?null:await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  if(this.stopped){stream?.getTracks().forEach(t=>t.stop());return;}this.stream=stream;stream?.getTracks().forEach(t=>t.onended=()=>this.fail(Error('device_disconnected')));
  const context=new AudioContext({latencyHint:'interactive'});this.context=context;
  if(this.mode==='read'){
   await context.resume();const config=(await this.bridge.configGet()).config;
   const run=await this.bridge.realtimeStart({schema_version:1,conversation_id:this.cid,renderer_id:'main-assigned',config_version:config.config_version,mode:'read',message_id:this.messageId});
   this.scope=run.scope;if(this.stopped){await this.command('end');return;}for(const event of this.early)this.event(event);this.early=[];return;
  }
  await context.audioWorklet.addModule(new URL('./realtime-capture-worklet.js',import.meta.url));if(this.stopped)return;
  this.node=new AudioWorkletNode(context,'realtime-capture');this.source=context.createMediaStreamSource(stream);this.source.connect(this.node);this.node.connect(context.destination);await context.resume();
  if(this.stopped)return;
  this.node.port.onmessage=e=>{if(this.stopped||!this.ready)return;const pcm=new Int16Array(e.data);let sum=0;for(const sample of pcm)sum+=sample*sample;this.cb.level(Math.min(1,Math.sqrt(sum/pcm.length)/7000));
   this.enqueueInput(new Uint8Array(e.data));
  };
  await this.connectRealtime();
 }
 async connectRealtime(){
  const config=(await this.bridge.configGet()).config;
  const run=await this.bridge.realtimeStart({schema_version:1,conversation_id:this.cid,renderer_id:'main-assigned',config_version:config.config_version,mode:this.mode});
  this.scope=run.scope;if(this.stopped){await this.command('end');return;}
  for(const event of this.early)this.event(event);this.early=[];
 }
 async reconnect(){
  await this.starting?.catch(()=>{});if(this.stopped)return;
  await this.command('end');if(this.stopped)return;
  this.scope=null;this.early=[];this.sequence=0;this.generation=0;this.response=null;this.inputTexts.clear();this.blocked.clear();this.assistantText='';this.transcript(null);
  await this.connectRealtime();
 }
 enqueueInput(bytes){
  if(this.stopped||this.micMuted)return;this.inputQueue.push(bytes);
  if(this.inputQueue.length>100){this.fail(Error('audio_input_backpressure'));return;}
  if(this.inputQueue.length>=5)void this.flushInput();
 }
 async flushInput(){
  if(this.inputSending||this.stopped||this.inputQueue.length<5)return;
  this.inputSending=true;
  try{while(!this.stopped&&this.inputQueue.length>=5){
   const frames=this.inputQueue.splice(0,5),bytes=new Uint8Array(frames.reduce((n,f)=>n+f.length,0));let offset=0;
   for(const frame of frames){bytes.set(frame,offset);offset+=frame.length;}
   await this.bridge.realtimeInput({schema_version:1,scope:this.scope,sequence:++this.sequence,audio_base64:encodeBytes(bytes)});
  }}catch(e){this.fail(e);}finally{this.inputSending=false;}
 }
 event(event){const data=event.data?.realtime;if(!data||data.scope?.conversation_id!==this.cid)return;
  if(!this.scope){if(this.early.length<128)this.early.push(event);return;}if(this.stopped||data.scope.session_id!==this.scope.session_id||data.scope.generation!==this.scope.generation)return;
  if(data.generation<this.generation)return;
  switch(data.type){
   case 'ready':if(!this.ready){this.connectedAt=Date.now();this.connectedTick=performance.now();this.cb.connected?.();}this.ready=true;if(this.muted)void this.command('mute').catch(e=>this.fail(e));this.state('listening');break;
   case 'speech_started':if(this.response||this.sources.size)this.cb.cue?.('interrupted');this.generation=data.generation;this.stopOutput();if(this.response)this.blocked.add(this.response);this.response=null;this.assistantText='';this.cb.interrupt();this.cb.caption('');this.transcript(null);this.state('recording');break;
   case 'speech_stopped':this.state('thinking');break;
   case 'transcript_delta':{const text=data.text||'';this.inputTexts.set(data.item_id,text);this.cb.caption(text);
    // Providers resend the whole utterance on every delta, so this replaces the
    // previous snapshot ("你" → "你好") instead of appending to it.
    this.transcript({role:'user',text,itemId:data.item_id,generation:data.generation,final:false});break;}
   case 'transcript_final':this.inputTexts.delete(data.item_id);this.cb.caption('');this.cb.submitted();
    // The final utterance stays on the card until the next turn really starts,
    // so it does not disappear the moment the caption is cleared.
    this.transcript({role:'user',text:data.text||'',itemId:data.item_id,generation:data.generation,final:true});
    if(this.mode==='call'){this.inputDone=true;this.inputQueue=[];if(this.node)this.node.port.onmessage=null;this.source?.disconnect();this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.cb.inputComplete?.();}break;
   case 'transcript_failed':this.cb.caption('');this.transcript(null);this.cb.error(Error(data.code));this.state('listening');break;
   case 'response_started':this.response=data.response_id;this.responseFinished=false;this.playedResponse=false;this.assistantText='';this.state('thinking');break;
   case 'audio':if(this.response===data.response_id&&!this.blocked.has(data.response_id)&&!this.muted)this.play(data);break;
   case 'assistant_delta':if(this.response!==data.response_id||this.blocked.has(data.response_id))break;this.assistantText+=data.text||'';this.transcript({role:'assistant',text:this.assistantText,responseId:data.response_id,generation:data.generation,final:false});break;
   case 'assistant_final':this.cb.submitted();this.responseFinished=true;
    // The provider's final text is authoritative and may revise the streamed
    // deltas, so it replaces the accumulated value rather than extending it.
    if(this.response===data.response_id&&!this.blocked.has(data.response_id)){this.assistantText=typeof data.text==='string'?data.text:this.assistantText;this.transcript({role:'assistant',text:this.assistantText,responseId:data.response_id,generation:data.generation,final:true});}
    if(!this.sources.size)this.finishResponse();break;
   case 'response_failed':this.stopOutput();this.state('listening');this.cb.error(Error(data.code));break;
   case 'failed':this.fail(Error(data.code));break;
  }
 }
 play(data){try{const c=this.context;if(!c||c.state==='closed')return;const samples=pcmFloats(data);const node=c.createBufferSource(),buffer=c.createBuffer(1,samples.length,data.sample_rate);buffer.copyToChannel(samples,0);node.buffer=buffer;if(!this.outputAnalyser){this.outputAnalyser=c.createAnalyser();this.outputAnalyser.fftSize=256;this.outputSamples=new Float32Array(256);this.outputAnalyser.connect(c.destination);}node.connect(this.outputAnalyser);
  // Providers can synthesize faster than real-time. Bound retained audio rather
  // than treating a normal reply with more than 3 seconds pending as a failure.
  const at=this.nextPlay>c.currentTime?this.nextPlay:c.currentTime+.08;if(at+buffer.duration-c.currentTime>60||this.sources.size>=2048){node.disconnect();this.fail(Error('audio_output_backpressure'));return;}this.nextPlay=at+buffer.duration;this.sources.add(node);this.playedResponse=true;this.state('playing');node.onended=()=>{node.disconnect();this.sources.delete(node);if(!this.sources.size&&!this.stopped&&this.responseFinished)this.finishResponse();};node.start(at);
 }catch(e){this.fail(e);}}
 finishResponse(){const response=this.response;if(!response)return;this.response=null;this.state('listening');if(this.playedResponse&&!this.muted)this.cb.cue?.('reply-ended');void this.command('playback_completed',response).catch(()=>{});if(this.inputDone){void this.end();this.cb.failed?.();}}
 stopOutput(){for(const node of this.sources){node.onended=null;try{node.stop();}catch{}node.disconnect();}this.sources.clear();this.nextPlay=0;}
 outputLevel(){if(!this.outputAnalyser||!this.sources.size)return 0;this.outputAnalyser.getFloatTimeDomainData(this.outputSamples);let sum=0;for(const sample of this.outputSamples)sum+=sample*sample;return Math.min(1,Math.sqrt(sum/this.outputSamples.length)*5);}
 command(command,response_id=null){if(!this.scope)return Promise.resolve();return this.bridge.realtimeCommand({schema_version:1,scope:this.scope,command,response_id});}
 setMuted(value){this.muted=value;if(value){
   // Stopping the output also removes every source's onended, so nothing would
   // finish the turn for audio that is still queued. Close it out here, or the
   // card would stay on Speaking for a reply the user can no longer hear.
   this.stopOutput();
   if(this.ready){if(this.responseFinished)this.finishResponse();else if(this.response)this.state('thinking');}
 }void this.command(value?'mute':'unmute').catch(e=>this.fail(e));}
 setMicMuted(value){this.micMuted=value;if(value)this.inputQueue=[];}
 fail(e){if(this.stopped)return;this.state('failed');this.cb.error(e);
  const reconnectable=this.mode==='live'&&this.stream&&this.context?.state!=='closed'&&['stream_disconnected','network_request_failed','request_timeout','rate_limited','service_unavailable','audio_input_backpressure'].includes(e.message);
  if(reconnectable){this.ready=false;this.inputQueue=[];this.stopOutput();this.response=null;this.assistantText='';this.cb.caption('');this.transcript(null);}else void this.end();
  this.cb.failed?.(e,Boolean(reconnectable));
 }
 end(){if(this.ending)return this.ending;this.stopped=true;if(this.connectedAt!==undefined&&this.scope)this.cb.ended?.({id:this.scope.session_id,conversationId:this.cid,mode:this.mode,startedAt:this.connectedAt,endedAt:Date.now(),durationMs:Math.max(0,Math.floor(performance.now()-this.connectedTick))});this.ready=false;this.inputQueue=[];this.stopOutput();this.cb.caption('');this.ending=(async()=>{
  try{await this.starting?.catch(()=>{});
  if(this.node){this.node.port.onmessage=null;this.node.port.close();this.node.disconnect();}this.source?.disconnect();this.outputAnalyser?.disconnect();this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});
  let released=true;try{if(this.context&&this.context.state!=='closed')await this.context.close();}catch{released=false;}
  await this.command('end').catch(()=>{released=false;});if(this.authorized)await this.bridge.speechRevokeAudio().catch(()=>{released=false;});
  return {released};}finally{mediaCoordinator.setVoice(this,false);}})();return this.ending;}
}
