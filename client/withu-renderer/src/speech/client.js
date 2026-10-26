export const speechCommand=(session,command,patch={})=>({schema_version:1,session_id:session.session_id,conversation_id:session.conversation_id,renderer_id:session.renderer_id,turn_id:session.turn_id,generation:session.generation,config_version:session.config_version,command,source:'control',frame_sequence:0,captured_at:Date.now(),samples:[],text:'',expected_transcript_revision:0,...patch});

export class SpeechClient {
 constructor(bridge,conversation,onChange=()=>{}) {
  this.bridge=bridge;this.conversation=conversation;this.onChange=onChange;this.session=null;this.context=null;this.nodes=new Set();this.history=[];this.caption=null;this.receipts=[];this.epoch=0;this.nextTime=0;this.audioSequence=0;this.synthesisDone=false;this.allowOutput=false;this.disposed=false;this.queue=Promise.resolve();this.frameSequence=0;this.pendingInputs=0;this.captureEpoch=0;this.acquisitions=new Set();this.captureTasks=new Set();this.stream=null;this.captureNode=null;this.micSource=null;this.silentGain=null;this.unsubscribe=bridge.onEvent(e=>this.receive(e));
  this.connectionListener=bridge.onConnection?.(status=>{if(status.lifecycle==='failed'){this.record('server_connection_failed');void this.dispose().catch(()=>{});this.changed();}});
  this.cleanupListener=bridge.onSpeechCleanup?.(async()=>{await this.dispose();return {released:!this.context&&!this.stream&&this.nodes.size===0};});
 }
 record(kind,extra={}){this.receipts.push({kind,time:performance.now(),session_id:this.session?.session_id,generation:this.session?.generation,...extra});if(this.receipts.length>300)this.receipts.shift();}
 changed(){this.onChange({session:this.session,caption:this.caption,transcript:[...this.history],receipts:[...this.receipts],resources:this.resources()});}
 async audioContext(){if(!this.context)this.context=new AudioContext({latencyHint:'interactive'});if(this.context.state==='suspended')await this.context.resume();if(this.context.state!=='running')throw Error('audio_context_not_running');return this.context;}
 async start(backend='fake-a',scenario='normal') {
  if(this.disposed)throw Error('speech_client_disposed');
  await this.queue;
  if(this.session&&this.session.state!=='ended')await this.action('end');
  await this.audioContext();
  const {speech_session}=await this.bridge.speechStart({schema_version:1,conversation_id:this.conversation,renderer_id:'main-assigned',backend_id:backend,config_version:1,scenario});
  this.session=speech_session;this.caption=null;this.history=[];this.allowOutput=true;this.audioSequence=0;this.record('session_started',{backend,synthetic:true});this.changed();return this.session;
 }
 command(command,patch={}) {
  const inputSession=command==='input'&&this.session?{...this.session}:null;const inputEpoch=this.captureEpoch;
  const run=async()=>{if(inputSession&&(inputEpoch!==this.captureEpoch||this.disposed)){this.record('stale_capture_discarded');return this.session;}if(!this.session)throw Error('speech_session_missing');if(this.disposed&&command!=='detach')throw Error('speech_client_disposed');const {speech_session}=await this.bridge.speechCommand(speechCommand(inputSession||this.session,command,patch));if(this.disposed&&command!=='detach')return speech_session;this.session=speech_session;this.changed();return speech_session;};
  const result=this.queue.then(run);this.queue=result.catch(()=>{});return result;
 }
 cancelPlayback(reason) {
  this.allowOutput=false;this.epoch++;this.synthesisDone=false;const count=this.nodes.size;
  for(const node of this.nodes){node.onended=null;try{node.stop();}catch{}node.disconnect();}
  this.nodes.clear();this.nextTime=0;this.audioSequence=0;this.record('playback_cancelled',{reason,nodesStopped:count,queueRemaining:0});
 }
 async action(command) {
  this.record('control_requested',{command});
  if(['interrupt','end','detach','mute','quiet','refuse','device_failed'].includes(command))this.captureEpoch++;
  if(['interrupt','end','detach','mute','quiet','refuse','device_failed'].includes(command)){this.cancelPlayback(command);await this.stopMicrophone();}
  const result=await this.command(command);
  if(['end','detach','refuse'].includes(command)&&this.context){await this.context.close();this.context=null;}
  if(command==='resume'){this.allowOutput=true;this.audioSequence=0;this.caption=null;this.record('explicit_resume');}
  return result;
 }
 receive(envelope) {
  const update=envelope?.data?.speech;if(!update||this.disposed||!this.session)return;
  const snapshot=update.session;
  if(snapshot.session_id!==this.session.session_id||snapshot.conversation_id!==this.conversation||snapshot.renderer_id!==this.session.renderer_id)return;
  if(snapshot.config_version!==this.session.config_version||snapshot.generation<this.session.generation||snapshot.version<this.session.version){this.record('stale_output_discarded');this.changed();return;}
  if(update.kind==='audio'&&(snapshot.generation!==this.session.generation||snapshot.turn_id!==this.session.turn_id||!this.allowOutput||update.source!=='withu_tts')){this.record('stale_audio_discarded');this.changed();return;}
  const textKind=['partial','final','corrected','response'].includes(update.kind);
  if(textKind&&(snapshot.generation!==this.session.generation||snapshot.turn_id!==this.session.turn_id||(update.kind==='response'?update.source!=='withu_tts':!['user_microphone','user_fixture'].includes(update.source)))){this.record('stale_text_discarded');this.changed();return;}
  this.session=snapshot;
  if(['ended','interrupted','reconnecting','degraded'].includes(snapshot.state)||update.kind==='cancelled'){this.cancelPlayback(snapshot.state);this.caption=null;void this.stopMicrophone().catch(error=>this.record('capture_cleanup_failed',{reason:error.message}));}
  if(['partial','final','corrected','response'].includes(update.kind)&&this.allowOutput){
   this.caption={kind:update.kind,source:update.source,text:update.text,revision:update.revision,turn_id:snapshot.turn_id};
   if(update.kind!=='partial'){this.history=this.history.filter(v=>v.turn_id!==snapshot.turn_id||v.source!==update.source);this.history.push(this.caption);}this.record(update.kind,{revision:update.revision});
  }
  if(update.kind==='audio')this.play(update);
  if(update.kind==='synthesis_complete'){this.synthesisDone=true;this.record('synthesis_complete');this.maybeFinished();}
  this.changed();
 }
 play(update) {
  if(!this.context||this.context.state!=='running'||update.frame_sequence!==this.audioSequence+1||update.sample_rate!==16000||!update.samples.length||this.nodes.size>=20){this.record('audio_rejected');this.cancelPlayback('invalid_audio_or_context');void this.command('device_failed').catch(()=>{});return;}
  this.audioSequence=update.frame_sequence;const buffer=this.context.createBuffer(1,update.samples.length,16000);const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=update.samples[i]/32768;
  const node=this.context.createBufferSource();node.buffer=buffer;node.connect(this.context.destination);const epoch=this.epoch;
  node.onended=()=>{node.disconnect();this.nodes.delete(node);if(epoch!==this.epoch||this.disposed)return;this.record('node_ended',{frame:update.frame_sequence});this.maybeFinished();this.changed();};
  const at=Math.max(this.context.currentTime+.02,this.nextTime);this.nextTime=at+buffer.duration;this.nodes.add(node);node.start(at);this.record('node_scheduled',{frame:update.frame_sequence,contextTime:at,duration:buffer.duration,nodeCount:this.nodes.size});
  if(this.audioSequence===1)void this.command('playback_started',{source:'withu_tts'}).catch(()=>{});
 }
 maybeFinished(){if(this.synthesisDone&&this.nodes.size===0&&this.allowOutput){this.synthesisDone=false;this.record('playback_engine_completed',{notUserAcceptance:true});void this.command('playback_completed',{source:'withu_tts'}).catch(e=>this.record('playback_ack_failed',{reason:e.message}));}}
 async fixtureInput() {
  if(!this.session||this.session.state==='ended')await this.start();
  await this.action('resume');await this.command('capture_begin');this.frameSequence=0;
  for(let frame=0;frame<4;frame++){const samples=Array.from({length:800},(_,i)=>Math.round(Math.sin(i*.15)*1200));await this.command('input',{source:'user_fixture',frame_sequence:++this.frameSequence,samples});}
  this.record('input_finished',{source:'user_fixture',sampleCount:3200});await this.command('capture_end');
 }
 async beginMicrophone() {
  if(this.disposed)throw Error('speech_client_disposed');
  let captureEpoch=++this.captureEpoch;
  this.cancelPlayback('push_to_talk');
  try{
   if(this.session&&['speaking','thinking','listening'].includes(this.session.state)){await this.command('interrupt');await this.stopMicrophone();captureEpoch=++this.captureEpoch;}
   await this.bridge.speechAuthorizeAudio();
   const acquisition=navigator.mediaDevices.getUserMedia({audio:true,video:false});this.acquisitions.add(acquisition);
   let stream;try{stream=await acquisition;}finally{this.acquisitions.delete(acquisition);}
   if(this.disposed||captureEpoch!==this.captureEpoch){for(const track of stream.getTracks())track.stop();this.record('late_microphone_acquisition_released',{allEnded:stream.getTracks().every(t=>t.readyState==='ended')});this.changed();return;}
   this.stream=stream;
   if(!this.session||this.session.state==='ended')await this.start();
   if(this.disposed||captureEpoch!==this.captureEpoch){await this.stopMicrophone();return;}
   await this.action('resume'); // resume does not reopen capture or grant permissions.
   await this.command('capture_begin');if(this.disposed||captureEpoch!==this.captureEpoch){await this.stopMicrophone();return;}this.frameSequence=0;
   const context=await this.audioContext();const loading=context.audioWorklet.addModule(new URL('./capture-worklet.js',import.meta.url));this.acquisitions.add(loading);try{await loading;}finally{this.acquisitions.delete(loading);}
   if(this.disposed||captureEpoch!==this.captureEpoch){await this.stopMicrophone();return;}
   this.micSource=context.createMediaStreamSource(this.stream);this.captureNode=new AudioWorkletNode(context,'withu-capture');this.silentGain=context.createGain();this.silentGain.gain.value=0;this.micSource.connect(this.captureNode);this.captureNode.connect(this.silentGain);this.silentGain.connect(context.destination);
   this.captureNode.port.onmessage=e=>{if(!this.captureNode||this.disposed||this.session?.state!=='listening')return;if(this.pendingInputs>12){void this.action('device_failed').catch(()=>{});return;}this.pendingInputs++;this.record('capture_frame_queued',{frame:this.frameSequence+1});const task=this.command('input',{source:'user_microphone',frame_sequence:++this.frameSequence,samples:e.data}).catch(error=>{this.record('capture_send_failed',{reason:error.message});if(!this.disposed&&this.captureNode)void this.action('device_failed').catch(()=>{});}).finally(()=>{this.pendingInputs--;this.captureTasks.delete(task);this.changed();});this.captureTasks.add(task);};
   for(const track of this.stream.getTracks())track.onended=()=>{if(this.stream)void this.action('device_failed').catch(()=>{});};
   this.record('microphone_tracks_started',{count:this.stream.getTracks().length});
  }catch(error){await this.stopMicrophone();if(this.session&&!this.disposed)await this.action('device_failed').catch(()=>{});this.record('device_failed',{reason:error.name||error.message});this.changed();throw error;}
 }
 async stopMicrophone() {
  this.captureEpoch++;
  if(this.captureNode){this.captureNode.port.onmessage=null;this.captureNode.disconnect();this.captureNode.port.close();this.captureNode=null;this.record('capture_processor_released');}
  this.micSource?.disconnect();this.micSource=null;this.silentGain?.disconnect();this.silentGain=null;
  if(this.stream){const tracks=this.stream.getTracks();for(const track of tracks){track.onended=null;track.stop();}this.record('microphone_tracks_stopped',{count:tracks.length,allEnded:tracks.every(t=>t.readyState==='ended')});this.stream=null;}
  await this.bridge.speechRevokeAudio?.();
 }
 async endMicrophone(){await this.stopMicrophone();if(this.session?.state==='listening')await this.command('capture_end');}
 async correct(text,revision){return this.command('correct',{text,expected_transcript_revision:revision});}
 resources(){return {nodes:this.nodes.size,tracks:this.stream?.getTracks().length||0,pendingInputs:this.pendingInputs,acquisitions:this.acquisitions.size,captureTasks:this.captureTasks.size,processorAttached:Boolean(this.captureNode),contextState:this.context?.state||'closed',disposed:this.disposed};}
 async dispose(){if(this.disposePromise)return this.disposePromise;this.disposed=true;this.cancelPlayback('dispose');this.unsubscribe?.();this.connectionListener?.();this.record('subscriptions_removed');this.disposePromise=(async()=>{await this.stopMicrophone();await Promise.allSettled([...this.acquisitions,...this.captureTasks]);let detachError;if(this.session)await this.command('detach').catch(error=>{this.record('detach_failed',{reason:error.message});detachError=error;});if(this.context){await this.context.close();this.context=null;}this.record('client_resources_released',{nodes:this.nodes.size,tracks:0,pendingInputs:this.pendingInputs,acquisitions:this.acquisitions.size,captureTasks:this.captureTasks.size,contextClosed:this.context===null});if(detachError)throw detachError;this.cleanupListener?.();this.changed();})();return this.disposePromise;}
}
