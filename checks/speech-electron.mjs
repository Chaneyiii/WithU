import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function runElectronChecks({owner,getWindow,createWindow,completeExit,packaged}) {
 const root=path.resolve(process.env.WITHU_CHECK_OUTPUT);await fs.mkdir(root,{recursive:true});let win=getWindow();const contents=()=>win.webContents;
 const read=()=>contents().executeJavaScript(`(()=>{const p=document.querySelector('.speech-session-panel');return p?{state:p.dataset.speechState,session:JSON.parse(p.dataset.speechSession),receipts:JSON.parse(p.dataset.speechReceipts),busy:p.dataset.speechBusy==='true',resources:JSON.parse(p.dataset.speechResources||'{}'),text:p.textContent,body:document.body.textContent}:null;})()`);
 const until=async(predicate,ms=12000)=>{const began=Date.now();while(Date.now()-began<ms){const data=await read();if(data&&predicate(data))return data;await sleep(40);}throw Error('Electron speech condition timeout: '+JSON.stringify(await read()));};
 const click=async(label)=>{let ready=false;for(let attempt=0;attempt<250;attempt++){ready=await contents().executeJavaScript(`(()=>{const e=[...document.querySelectorAll('.speech-session-panel button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});return Boolean(e&&!e.disabled);})()`);if(ready)break;await sleep(40);}assert.ok(ready,'button not enabled: '+label);const rect=await contents().executeJavaScript(`(()=>{const e=[...document.querySelectorAll('.speech-session-panel button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)throw Error('button disabled/missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);contents().sendInputEvent({type:'mouseDown',...rect,button:'left',clickCount:1});contents().sendInputEvent({type:'mouseUp',...rect,button:'left',clickCount:1});};
 const results=[];const mark=name=>{results.push(name);console.log('PASS Electron speech '+name);};
 win.showInactive();await until(()=>true);
 if(process.env.WITHU_SPEECH_CHECK_SCENARIO?.startsWith('capture_'))return runCaptureMatrix({owner,win,read,until,click,completeExit,root,packaged,mark,results,scenario:process.env.WITHU_SPEECH_CHECK_SCENARIO});
 if(process.env.WITHU_SPEECH_CHECK_SCENARIO==='matrix'){return runResidualMatrix({owner,win,read,until,click,completeExit,root,packaged,mark,results});}
 const serverPid=owner.child.pid;
 await click('开始测试会话');await until(d=>d.session&&d.state==='idle');await click('合成输入回放');let data=await until(d=>d.receipts.some(r=>r.kind==='node_scheduled'));
 assert.ok(data.receipts.some(r=>r.kind==='partial'));assert.ok(data.receipts.some(r=>r.kind==='final'));assert.equal(data.session.synthetic,true);mark('renderer → preload/main → Rust → actual AudioBufferSourceNode queue');
 const fault=process.env.WITHU_SPEECH_CHECK_SCENARIO;
 if(fault){
  if(fault.startsWith('device_')){const name={device_denied:'NotAllowedError',device_missing:'NotFoundError',device_busy:'NotReadableError'}[fault];await contents().executeJavaScript(`navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('synthetic device failure','${name}'));true`);if(!win.isVisible()){win.showInactive();await until(d=>d.session===null);await click('开始测试会话');await until(d=>d.session&&d.state==='idle');}await click('点击说话（测试）');await until(d=>d.state==='degraded');const deviceResult=await completeExit();assert.equal(deviceResult.resources_released,true);mark(fault+' degrades with text fallback and cleans resources');await fs.writeFile(path.join(root,'results.json'),JSON.stringify({packaged,fault,deviceResult,results},null,2));console.log('PASS Electron P2 device '+fault);return;}
  if(fault==='cleanup_failure')await contents().executeJavaScript("AudioContext.prototype.close=function(){return Promise.reject(Error('synthetic close failure'));};true");
  if(fault==='cleanup_timeout')await contents().executeJavaScript("AudioContext.prototype.close=function(){return new Promise(()=>{});};true");
  if(fault==='server_crash'){await owner.request('withu:probe:crash',{}).catch(()=>{});await until(d=>d.receipts.some(r=>r.kind==='server_connection_failed'));await sleep(200);data=await read();assert.ok(data.receipts.some(r=>r.kind==='playback_cancelled'&&r.queueRemaining===0));}
  const result=await completeExit();assert.equal(result.resources_released,false);assert.equal(result.phase,'failed');mark(fault+' does not claim resources released');await fs.writeFile(path.join(root,'results.json'),JSON.stringify({packaged,fault,result,results},null,2));console.log('PASS Electron P2 fault '+fault);return;
 }
 await click('打断');data=await until(d=>d.state==='interrupted');assert.ok(data.receipts.some(r=>r.kind==='playback_cancelled'&&r.nodesStopped>0&&r.queueRemaining===0));const scheduled=data.receipts.filter(r=>r.kind==='node_scheduled').length;await sleep(1200);data=await read();assert.equal(data.receipts.filter(r=>r.kind==='node_scheduled').length,scheduled);mark('mid-TTS stop() / disconnect() / queue empty; no late replay');
 await click('合成输入回放');data=await until(d=>d.state==='idle'&&d.receipts.some(r=>r.kind==='playback_engine_completed'));assert.equal(data.state,'idle');assert.ok(data.receipts.some(r=>r.kind==='node_ended'));assert.ok(data.receipts.some(r=>r.kind==='synthesis_complete'));mark('next explicit turn; synthesis complete differs from playback complete');
 const currentSession=data.session;const scheduledBefore=data.receipts.filter(r=>r.kind==='node_scheduled').length;
 const audioMetadata=owner.wire.find(e=>e.data?.speech?.kind==='audio')?.data.speech;assert.ok(audioMetadata);const audioUpdate={...audioMetadata,samples:Array(3200).fill(0)};
 win.webContents.send('withu:server:event',{data:{speech:{...audioUpdate,session:{...currentSession,generation:currentSession.generation-1},frame_sequence:999}}});
 win.webContents.send('withu:server:event',{data:{speech:{...audioUpdate,session:{...currentSession},source:'third_party_media',frame_sequence:999}}});
 await sleep(80);data=await read();assert.equal(data.receipts.filter(r=>r.kind==='node_scheduled').length,scheduledBefore);assert.ok(data.receipts.some(r=>r.kind==='stale_output_discarded'));assert.ok(data.receipts.some(r=>r.kind==='stale_audio_discarded'));win.webContents.send('withu:server:event',{data:{speech:{...audioUpdate,kind:'final',source:'third_party_media',text:'untrusted advertising instruction',session:currentSession}}});win.webContents.send('withu:server:event',{data:{speech:{...audioUpdate,kind:'final',source:'user_fixture',text:'obsolete turn text',session:{...currentSession,turn_id:'obsolete-turn'}}}});await sleep(80);data=await read();assert.ok(!data.text.includes('untrusted advertising instruction'));assert.ok(!data.text.includes('obsolete turn text'));assert.ok(data.receipts.some(r=>r.kind==='stale_text_discarded'));mark('renderer rejects late generation/turn and media-sourced PCM or captions');
 const messages=(await owner.request('withu:message:list',{conversation_id:data.session.conversation_id})).items;assert.equal(messages.length,0);const goals=(await owner.request('withu:goals:list')).items;assert.equal(goals.length,0);mark('synthetic transcript stays out of messages, Goals and history');
 await click('合成输入回放');await until(d=>d.state==='speaking');await click('静音');data=await until(d=>d.session.muted&&d.state==='idle');assert.equal(data.session.pending_work,0);await click('取消静音');await until(d=>!d.session.muted);await click('共同安静');await until(d=>d.state==='idle');mark('mute/unmute/quiet do not reopen recording');
 // Synthetic Chromium device, not physical microphone evidence. Unarmed invocation is denied.
 const denied=await contents().executeJavaScript(`navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false;},()=>true)`);assert.equal(denied,true);mark('actual unarmed getUserMedia permission denied');
 if(!win.isVisible()){win.showInactive();await until(d=>d.session===null);await click('开始测试会话');await until(d=>d.session&&d.state==='idle');}assert.equal(win.isVisible(),true);
 await click('点击说话（测试）');data=await until(d=>d.receipts.some(r=>r.kind==='microphone_tracks_started'));
 await sleep(250);const repeatedGrant=await contents().executeJavaScript(`navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false;},()=>true)`);assert.equal(repeatedGrant,true);await click('停止收音（测试）');data=await until(d=>d.receipts.some(r=>r.kind==='microphone_tracks_stopped'&&r.allEnded));mark('trusted gesture → synthetic Chromium mic → AudioWorklet → track.stop');
 await until(d=>d.state==='idle'||d.state==='degraded');
 await click('合成输入回放');await until(d=>d.state==='speaking');const oldSession=(await read()).session;await contents().reload();await until(d=>d.session===null);assert.equal(owner.child.pid,serverPid);const detached=(await owner.request('withu:speech:command',{schema_version:1,session_id:oldSession.session_id,conversation_id:oldSession.conversation_id,renderer_id:oldSession.renderer_id,turn_id:oldSession.turn_id,generation:oldSession.generation,config_version:1,command:'status',source:'control',frame_sequence:0,captured_at:0,samples:[],text:'',expected_transcript_revision:0})).speech_session;assert.equal(detached.state,'ended');assert.equal(detached.pending_work,0);assert.equal((await read()).receipts.length,0);mark('renderer reload retains server PID; old output detached; no historical replay');
 await click('开始测试会话');await until(d=>d.session&&d.state==='idle');await click('合成输入回放');await until(d=>d.state==='speaking');
 const beforeHide=owner.eventCursor;win.close();await sleep(1200);assert.equal(win.isVisible(),false);assert.equal(owner.child.pid,serverPid);assert.ok(owner.eventsSince(beforeHide).some(e=>e.speech?.kind==='cancelled'));await createWindow();win=getWindow();await until(d=>d.session===null);mark('window close/hide cleanup without killing server; reopen does not capture');
 await click('开始测试会话');await until(d=>d.session&&d.state==='idle');await click('合成输入回放');await until(d=>d.state==='speaking');const routed=(await read()).session;
 await contents().executeJavaScript("location.hash='/goals';true");await sleep(200);const routedEnded=(await owner.request('withu:speech:command',{schema_version:1,session_id:routed.session_id,conversation_id:routed.conversation_id,renderer_id:routed.renderer_id,turn_id:routed.turn_id,generation:routed.generation,config_version:1,command:'status',source:'control',frame_sequence:0,captured_at:0,samples:[],text:'',expected_transcript_revision:0})).speech_session;assert.equal(routedEnded.state,'ended');assert.equal(routedEnded.pending_work,0);await contents().executeJavaScript("location.hash='/chat';true");await until(d=>d.session===null);mark('hidden composer/page switch detaches without routing speech into draft');
 await click('开始测试会话');await until(d=>d.session&&d.state==='idle');await click('合成输入回放');await until(d=>d.state==='speaking');const modeSession=(await read()).session;
 await contents().executeJavaScript("document.querySelector('[aria-label=\"对话历史\"]').click();true");await sleep(80);assert.equal(await contents().executeJavaScript("!!document.querySelector('.mode-heading>button,.mode-menu')"),false);await contents().executeJavaScript("document.querySelector('.new-chat').click();true");await sleep(150);const modeEnded=(await owner.request('withu:speech:command',{schema_version:1,session_id:modeSession.session_id,conversation_id:modeSession.conversation_id,renderer_id:modeSession.renderer_id,turn_id:modeSession.turn_id,generation:modeSession.generation,config_version:1,command:'status',source:'control',frame_sequence:0,captured_at:0,samples:[],text:'',expected_transcript_revision:0})).speech_session;assert.equal(modeEnded.state,'ended');assert.equal(modeEnded.pending_work,0);mark('new Comfort conversation cancels active output without speech-to-draft routing; mode fixed');
 const clean=await completeExit();assert.equal(clean.phase,'complete');assert.equal(clean.resources_released,true);mark('renderer audio cleanup acknowledgement plus server shutdown');
 const first=data.receipts;const inputEnd=first.find(r=>r.kind==='input_finished');const interruptRequest=first.find(r=>r.kind==='control_requested'&&r.command==='interrupt');const cancellation=first.find(r=>r.kind==='playback_cancelled'&&r.reason==='interrupt');const deltasMs=inputEnd?Object.fromEntries(['partial','final','response','node_scheduled'].map(kind=>[kind,first.find(r=>r.kind===kind)?.time-inputEnd.time])):{};if(interruptRequest&&cancellation)deltasMs.interruptStop=cancellation.time-interruptRequest.time;
 const hardware={platform:process.platform,arch:process.arch,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model,totalMemoryBytes:os.totalmem()};
 await fs.writeFile(path.join(root,'results.json'),JSON.stringify({packaged,hardware,deltasMs,input:{source:"synthetic",sampleRate:16000,samples:3200},artificialBackendDelaysMs:{firstPartial:40,final:180,providerTerminal:260,firstAudioAfterTerminal:30,frameDeliveryInterval:90,framePlaybackDuration:200},serverPid,electron:process.versions.electron,chrome:process.versions.chrome,results,receipts:data.receipts,physicalDeviceRelease:'unverified',echoSeparation:'unverified',fakeBackend:'controlled PCM tone and scripted ASR',scope:'synthetic actual Electron chain only'},null,2));
 console.log('PASS Electron P2 speech; evidence '+root);
}

async function runResidualMatrix({owner,win,read,until,click,completeExit,root,packaged,mark,results}) {
 const js=code=>win.webContents.executeJavaScript(code);
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const select=async(selector,value)=>{await js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('missing '+${JSON.stringify(selector)});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);};
 const command=(session,command,patch={})=>owner.request('withu:speech:command',{schema_version:1,session_id:session.session_id,conversation_id:session.conversation_id,renderer_id:session.renderer_id,turn_id:session.turn_id,generation:session.generation,config_version:session.config_version,command,source:'control',frame_sequence:0,captured_at:Date.now(),samples:[],text:'',expected_transcript_revision:0,...patch});
 const start=async(scenario='normal',backend='fake-a')=>{const previous=(await read()).session?.session_id;await select('[data-speech-scenario]',scenario);await select('[data-speech-backend]',backend);await click('开始测试会话');return until(d=>d.session&&d.session.session_id!==previous&&d.state==='idle'&&!d.busy);};
 await js("document.querySelector('.speech-session-panel details').open=true;true");
 const scenarios=[];
 for(const [scenario,state] of [['duplicate_final','idle'],['revision','idle'],['no_input','idle'],['overlap','degraded'],['refuse','ended'],['quiet','idle'],['disconnect','reconnecting'],['fail','degraded'],['delayed','idle'],['late','idle']]) {
  const beginning=await start(scenario);const sessionId=beginning.session.session_id;await click('合成输入回放');await until(d=>!d.busy);await sleep(400);
  let data=await until(d=>d.state===state&&(state!=='idle'||['no_input','quiet'].includes(scenario)||d.receipts.some(r=>r.kind==='playback_engine_completed'&&r.session_id===sessionId)));
  const events=owner.wire.filter(e=>e.data?.speech?.session.session_id===sessionId).map(e=>e.data.speech);
  const finals=events.filter(e=>e.kind==='final');const responses=events.filter(e=>e.kind==='response');const nodes=data.receipts.filter(r=>r.kind==='node_scheduled'&&r.session_id===sessionId);
  if(['duplicate_final','revision','delayed','late'].includes(scenario)) {assert.equal(finals.length,1);assert.equal(responses.length,1);assert.ok(data.receipts.some(r=>r.kind==='response'&&r.session_id===sessionId),'response must reach renderer');assert.ok(data.text.includes('测试提示音'),'synthetic response must be visible');assert.equal(nodes.length,10);assert.ok(events.findIndex(e=>e.kind==='provider_complete')<events.findIndex(e=>e.kind==='audio'));}
  else assert.equal(nodes.length,0,scenario+' must not synthesize');
  if(scenario==='late'){assert.ok(data.session.discarded_stale>0);assert.ok(!data.text.includes('obsolete'));}
  if(scenario==='disconnect'){await click('重新连接（测试）');await until(d=>d.state==='idle'&&!d.busy);await sleep(120);assert.equal((await read()).receipts.filter(r=>r.kind==='node_scheduled'&&r.session_id===sessionId).length,0);}
  if(scenario==='revision') {
   await click('回顾测试 transcript');await until(d=>d.text.includes('修正文字'));await click('修正文字');
   await js("(()=>{const textarea=document.querySelector('.presence-correction textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'合成更正：明天去公园。');textarea.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
   await click('应用到本次预览');data=await until(d=>d.text.includes('合成更正：明天去公园。')&&!d.busy);assert.ok(data.receipts.some(r=>r.kind==='corrected'));
   await assert.rejects(()=>command(data.session,'correct',{text:'陈旧更正',expected_transcript_revision:3}),/stale_transcript/);
   assert.equal(owner.wire.filter(e=>e.data?.speech?.session.session_id===sessionId&&e.data.speech.kind==='response').length,1);
  }
  scenarios.push({scenario,sessionId,finals:finals.length,scheduledNodes:nodes.length,state});mark('matrix '+scenario);
 }
 const first=await start();await click('合成输入回放');await until(d=>d.state==='speaking');const old=(await read()).session;
 await start('normal','fake-b');let replacement=(await read()).session;assert.notEqual(replacement.session_id,old.session_id);assert.equal(replacement.backend_id,'fake-b');await assert.rejects(()=>command(old,'resume'),/session_missing|ended/);await click('合成输入回放');await until(d=>d.state==='idle'&&!d.busy&&d.receipts.some(r=>r.kind==='playback_engine_completed'&&r.session_id===replacement.session_id));mark('matrix A/B replacement retires old session without changing real provider config');
 const view=(await owner.request('withu:view:get',{id:'client'})).object;const realConfig=(await owner.request('withu:config:get')).config;assert.equal(realConfig.config_version,1);assert.deepEqual(realConfig.providers,[]);if(view)assert.equal(view.active.comfort,replacement.conversation_id);
 await start();await click('合成输入回放');await until(d=>d.state==='speaking');const active=(await read()).session;
 const conversation=(await owner.request('withu:conversation:get',{id:active.conversation_id})).object;await owner.request('withu:conversation:delete',{id:conversation.conversation_id,expected_version:conversation.version});
 await until(d=>d.state==='ended');const count=(await read()).receipts.filter(r=>r.kind==='node_scheduled').length;await sleep(200);assert.equal((await read()).receipts.filter(r=>r.kind==='node_scheduled').length,count);
 await assert.rejects(()=>command(active,'input',{source:'user_fixture',frame_sequence:99,samples:[1000]}),/stale_generation|ended/);await assert.rejects(()=>owner.request('withu:message:list',{conversation_id:active.conversation_id}),/conversation_missing/);assert.equal((await owner.request('withu:conversation:get',{id:active.conversation_id})).object,null);mark('matrix deleting active conversation stops actual output and prevents resurrection');
 const configAfter=(await owner.request('withu:config:get')).config;assert.deepEqual(configAfter,realConfig);
 const shutdown=await completeExit();assert.equal(shutdown.resources_released,true);await fs.writeFile(path.join(root,'results.json'),JSON.stringify({packaged,scenarios,results,shutdown,realProviders:'unconfigured',physicalHardware:'not tested'},null,2));
 console.log('PASS Electron P2 residual matrix; evidence '+root);
}

async function runCaptureMatrix({owner,win,read,until,click,completeExit,root,packaged,mark,results,scenario}) {
 const js=code=>win.webContents.executeJavaScript(code);
 const command=(session,command,patch={})=>owner.request('withu:speech:command',{schema_version:1,session_id:session.session_id,conversation_id:session.conversation_id,renderer_id:session.renderer_id,turn_id:session.turn_id,generation:session.generation,config_version:session.config_version,command,source:'control',frame_sequence:0,captured_at:Date.now(),samples:[],text:'',expected_transcript_revision:0,...patch});
 await js(`(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__p2Tracks=[];window.__p2Contexts=[];const NativeAudioContext=AudioContext;window.AudioContext=class extends NativeAudioContext{constructor(...args){super(...args);window.__p2Contexts.push(this);}};navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__p2Tracks.push(...stream.getTracks());return stream;};return true;})()`);
 await click('开始测试会话');await until(d=>d.session&&d.state==='idle'&&!d.busy);
 if(scenario==='capture_late_acquisition'||scenario==='capture_acquisition_timeout'){
  await js(`(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);${scenario==='capture_acquisition_timeout'?'await new Promise(()=>{});':'await new Promise(resolve=>setTimeout(resolve,350));'}return stream;};return true;})()`);
  await click('点击说话（测试）');await sleep(70);await js("location.hash='/goals';true");
  const shutdown=await completeExit();
  if(scenario==='capture_acquisition_timeout'){assert.equal(shutdown.resources_released,false);assert.equal(shutdown.phase,'failed');}
  else {assert.equal(shutdown.resources_released,true);const states=await js('window.__p2Tracks.map(track=>track.readyState)');assert.ok(states.length>0);assert.ok(states.every(state=>state==='ended'));assert.ok((await js('window.__p2Contexts.map(context=>context.state)')).every(state=>state==='closed'));}
  mark(scenario+' pending request cannot revive hidden capture');await fs.writeFile(path.join(root,'results.json'),JSON.stringify({packaged,scenario,results,shutdown,physicalHardware:'not tested'},null,2));return;
 }
 if(scenario==='capture_worklet_failure')await js("AudioWorklet.prototype.addModule=()=>Promise.reject(Error('synthetic worklet failure'));true");
 await click('点击说话（测试）');
 if(scenario==='capture_worklet_failure'){await until(d=>d.state==='degraded'&&!d.busy);const tracks=await js('window.__p2Tracks.map(track=>track.readyState)');assert.ok(tracks.length>0&&tracks.every(state=>state==='ended'));}
 else {
  await until(d=>d.receipts.some(r=>r.kind==='microphone_tracks_started')&&!d.busy);const session=(await read()).session;
  if(scenario!=='capture_pending_inputs')await until(()=>owner.wire.some(e=>e.record?.event==='speech.session.updated'&&e.data?.speech.kind==='vad_started'&&e.data.speech.source==='user_microphone'));
  else await until(d=>d.resources.pendingInputs>=2);
  if(scenario==='capture_permission_revoke'){
   await js('window.withuDesktop.speechRevokeAudio()');await until(d=>d.state==='degraded');
   await assert.rejects(()=>js(`window.withuDesktop.speechCommand(${JSON.stringify({...speechCommandForTest(session,'input'),source:'user_microphone',frame_sequence:999,samples:[1000]})})`),/permission_revoked/);
  }else if(scenario==='capture_device_ended'){
   // Synthetic end notification follows a real test MediaStreamTrack stop, not a physical unplug claim.
   await js("window.__p2Tracks.forEach(track=>{track.stop();track.dispatchEvent(new Event('ended'));});true");await until(d=>d.state==='degraded');
  }else if(scenario==='capture_pending_inputs'){
   await until(d=>d.resources.pendingInputs>=2);await js("location.hash='/goals';true");await sleep(150);
  }else if(scenario==='capture_explicit_end') {await click('结束');await until(d=>d.state==='ended'&&!d.busy);}
  else throw Error('unknown capture scenario');
  const final=(await command(session,'status')).speech_session;assert.ok(['ended','degraded'].includes(final.state));assert.equal(final.pending_work,0);assert.equal(final.attached,false);
  if(scenario!=='capture_pending_inputs'){await until(d=>d.resources.tracks===0&&!d.resources.processorAttached&&d.resources.pendingInputs===0);}
  const length=owner.wire.length;await sleep(120);assert.ok(!owner.wire.slice(length).some(e=>['audio','partial','final'].includes(e.data?.speech?.kind)));
  const states=await js('window.__p2Tracks.map(track=>track.readyState)');assert.ok(states.length>0&&states.every(state=>state==='ended'));
 }
 const shutdown=await completeExit();assert.equal(shutdown.resources_released,true);const contexts=await js('window.__p2Contexts.map(context=>context.state)');assert.ok(contexts.every(state=>state==='closed'));const states=await js('window.__p2Tracks.map(track=>track.readyState)');assert.ok(states.every(state=>state==='ended'));
 mark(scenario+' processor/tracks/queued inputs released; contexts closed');await fs.writeFile(path.join(root,'results.json'),JSON.stringify({packaged,scenario,results,shutdown,contexts,trackStates:states,artificialInputDelayMs:scenario==='capture_pending_inputs'?160:0,physicalHardware:'not tested'},null,2));console.log('PASS Electron P2 capture '+scenario);
}
function speechCommandForTest(session,command){return {schema_version:1,session_id:session.session_id,conversation_id:session.conversation_id,renderer_id:session.renderer_id,turn_id:session.turn_id,generation:session.generation,config_version:session.config_version,command,source:'control',frame_sequence:0,captured_at:Date.now(),samples:[],text:'',expected_transcript_revision:0};}
