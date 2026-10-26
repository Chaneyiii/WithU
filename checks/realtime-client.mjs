import assert from 'node:assert/strict';
import {RealtimeCall} from '../client/withu-renderer/src/speech/realtime-call.mjs';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const commands=[],captions=[];
const bridge={speechAuthorizeAudio:async()=>{},speechRevokeAudio:async()=>commands.push('revoke'),realtimeCommand:async p=>commands.push(p.command)};
const callbacks={state(){},level(){},caption:s=>captions.push(s),submitted(){},interrupt(){},error(){}};
const call=new RealtimeCall(bridge,'chat',callbacks);call.scope={conversation_id:'chat',session_id:'s',generation:1};
const event=(type,rest={})=>call.event({data:{realtime:{scope:call.scope,type,generation:1,...rest}}});
event('speech_started');event('transcript_delta',{item_id:'u',text:'你'});event('transcript_delta',{item_id:'u',text:'你好'});
assert.equal(captions.at(-1),'你好');
event('speech_started',{generation:2});event('transcript_delta',{item_id:'u',text:'迟到'});assert.equal(captions.at(-1),'');
const cues=[];call.cb.cue=s=>cues.push(s);call.response='playing';event('speech_started',{generation:3});assert.equal(cues.at(-1),'interrupted');
event('response_started',{generation:3,response_id:'complete'});call.playedResponse=true;
const pendingNode={};call.sources.add(pendingNode);event('assistant_final',{generation:3});assert.equal(cues.at(-1),'interrupted');
call.sources.delete(pendingNode);call.finishResponse();assert.equal(cues.at(-1),'reply-ended');assert.equal(call.response,null);
let stops=0;call.sources.add({stop(){stops++;},disconnect(){}});call.response='old';event('speech_started',{generation:3});assert.equal(stops,1);assert.ok(call.blocked.has('old'));
await call.end();assert.ok(commands.includes('end'));
// A hangup while getUserMedia is unresolved must wait for its track release.
let release;const acquired=new Promise(r=>release=r);Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:()=>acquired}},configurable:true});
const pending=new RealtimeCall(bridge,'chat',callbacks);const start=pending.start();await Promise.resolve();let completed=false;const end=pending.end().then(r=>{completed=true;return r;});await Promise.resolve();assert.equal(completed,false);
let trackStopped=false;release({getTracks:()=>[{stop(){trackStopped=true;}}]});await start;assert.equal((await end).released,true);assert.ok(trackStopped);assert.ok(commands.includes('revoke'));
// The actual worklet code must emit exact 20ms frames at 16kHz from 48kHz.
let Processor;const frames=[];const context={sampleRate:48000,AudioWorkletProcessor:class{constructor(){this.port={postMessage:b=>frames.push(new Int16Array(b))};}},registerProcessor:(n,c)=>Processor=c};
vm.runInNewContext(await readFile('client/withu-renderer/src/speech/realtime-capture-worklet.js','utf8'),context);const processor=new Processor();
for(let i=0;i<100;i++)processor.process([[new Float32Array(128).fill(.5)]]);assert.ok(frames.length>=13);assert.ok(frames.every(f=>f.length===320&&f[0]===16384));assert.ok(processor.samples.length<4);
console.log('PASS realtime client: snapshot ASR, stale generation, immediate barge-in, late acquisition release, actual worklet resampling');

// A temporary IPC stall must queue bounded audio in order, without 50 concurrent requests.
let releaseInput,active=0,maxActive=0;const inputRequests=[];
const inputCall=new RealtimeCall({...bridge,realtimeInput:async p=>{inputRequests.push(p);active++;maxActive=Math.max(maxActive,active);if(inputRequests.length===1)await new Promise(r=>releaseInput=r);active--;}},'chat',callbacks);
inputCall.scope={conversation_id:'chat',session_id:'input',generation:1};
for(let i=0;i<30;i++)inputCall.enqueueInput(new Uint8Array(640).fill(i));
assert.equal(inputCall.stopped,false);assert.equal(inputRequests.length,1);releaseInput();
for(let i=0;i<20&&inputCall.inputSending;i++)await Promise.resolve();
assert.equal(maxActive,1);assert.equal(inputRequests.length,6);
assert.deepEqual(inputRequests.map(p=>p.sequence),[1,2,3,4,5,6]);
assert.ok(inputRequests.every(p=>Buffer.from(p.audio_base64,'base64').length===3200));
const bytes=Buffer.concat(inputRequests.map(p=>Buffer.from(p.audio_base64,'base64')));for(let i=0;i<30;i++)assert.equal(bytes[i*640],i);
await inputCall.end();assert.equal(inputCall.inputQueue.length,0);
console.log('PASS ordered 100ms audio batching with delayed IPC, bounded queue and hangup release');

// Adjacent PCM chunks must retain exact samples and contiguous playback times.
const starts=[],buffers=[];
const audioCall=new RealtimeCall(bridge,'chat',callbacks);
audioCall.context={state:'running',currentTime:1,destination:{},createBuffer:(_channels,length,rate)=>{const b={duration:length/rate,copyToChannel:s=>buffers.push([...s])};return b;},createBufferSource:()=>({connect(){},disconnect(){},stop(){},start:at=>starts.push(at)}),createAnalyser:()=>({connect(){}})};
const chunk={format:'pcm16le',channels:1,sample_rate:24000,audio_base64:Buffer.alloc(960).toString('base64')};
audioCall.play(chunk);audioCall.context.currentTime=1.01;audioCall.play(chunk);audioCall.context.currentTime=1.015;audioCall.play(chunk);
assert.ok(Math.abs(starts[0]-1.08)<1e-9);assert.ok(Math.abs(starts[1]-starts[0]-.02)<1e-9);assert.ok(Math.abs(starts[2]-starts[1]-.02)<1e-9);assert.ok(buffers.every(b=>b.length===480&&b.every(s=>s===0)));audioCall.stopOutput();assert.equal(audioCall.sources.size,0);
console.log('PASS initial jitter buffer, contiguous PCM chunks and unchanged sample data');

// Reconnecting an active Live socket reuses its authorized track and context.
let authorizations=0,revocations=0,trackStops=0;const retryCalls=[],failures=[];
const retryScope={conversation_id:'retry',session_id:'old',generation:1};
const retryCall=new RealtimeCall({speechAuthorizeAudio:async()=>authorizations++,speechRevokeAudio:async()=>revocations++,configGet:async()=>({config:{config_version:2}}),realtimeCommand:async p=>retryCalls.push(p),realtimeStart:async()=>({scope:{...retryScope,session_id:'new'}})},'retry',{...callbacks,failed:(e,recoverable)=>failures.push({code:e.message,recoverable})},'live');
retryCall.scope=retryScope;retryCall.context={state:'running',close:async()=>{retryCall.context.state='closed';}};
retryCall.stream={getTracks:()=>[{stop(){trackStops++;}}]};retryCall.authorized=true;retryCall.ready=true;retryCall.response='old-response';
retryCall.fail(Error('stream_disconnected'));assert.equal(retryCall.stopped,false);assert.equal(retryCall.ready,false);assert.equal(trackStops,0);assert.equal(failures.at(-1).recoverable,true);
await retryCall.reconnect();assert.equal(retryCall.scope.session_id,'new');assert.equal(authorizations,0);assert.equal(revocations,0);assert.equal(trackStops,0);
retryCall.fail(Error('device_disconnected'));assert.equal(retryCall.stopped,true);assert.equal(failures.at(-1).recoverable,false);await retryCall.end();assert.equal(trackStops,1);assert.equal(revocations,1);
console.log('PASS Live reconnect reuses authorized capture; device loss releases resources');

// Hanging up while the replacement session is still pending releases capture
// and ends the late session rather than reading a null scope or reviving audio.
let connectReplacement;const lateReplacement=new Promise(resolve=>connectReplacement=resolve),lateCommands=[];
const hangupRetry=new RealtimeCall({configGet:async()=>({config:{config_version:2}}),realtimeStart:()=>lateReplacement,realtimeCommand:async p=>lateCommands.push(p),speechRevokeAudio:async()=>{}},'retry',callbacks,'live');
hangupRetry.scope=retryScope;hangupRetry.connectedAt=Date.now();hangupRetry.connectedTick=performance.now();let lateTrackStopped=false;
hangupRetry.stream={getTracks:()=>[{stop(){lateTrackStopped=true;}}]};hangupRetry.context={state:'running',close:async()=>{hangupRetry.context.state='closed';}};
const replacing=hangupRetry.reconnect();for(let i=0;i<5;i++)await Promise.resolve();assert.equal(hangupRetry.scope,null);
assert.equal((await hangupRetry.end()).released,true);assert.ok(lateTrackStopped);assert.equal(hangupRetry.context.state,'closed');
connectReplacement({scope:{...retryScope,session_id:'late'}});await replacing;assert.ok(lateCommands.some(p=>p.scope.session_id==='late'&&p.command==='end'));assert.equal(hangupRetry.ready,false);
console.log('PASS hangup during reconnect releases capture and closes late session');
