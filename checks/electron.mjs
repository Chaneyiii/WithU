import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function capture(contents){for(let attempt=0;attempt<3;attempt++){try{return await contents.capturePage();}catch(e){if(attempt===2)throw e;await sleep(250);}}}
export async function runElectronChecks({app,owner,getWindow,createWindow,completeExit,packaged}){
 const root=path.resolve(process.env.WITHU_CHECK_OUTPUT||'output/p1/electron-check',packaged?'packaged':'development');await fs.mkdir(root,{recursive:true});
 const evidence={packaged,electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,serverPid:owner.child.pid,checks:[]};
 if(owner.failure){
   for(let i=0;i<30;i++){const text=await getWindow().webContents.executeJavaScript('document.body.textContent');if(text.includes('未就绪'))break;await sleep(100);}
   const text=await getWindow().webContents.executeJavaScript('document.body.textContent');assert.ok(text.includes('未就绪'));
   await fs.writeFile(path.join(root,'server-unavailable.png'),(await capture(getWindow().webContents)).toPNG());
   evidence.checks.push('actual malformed/startup failure renders unavailable, no fake success');evidence.success=true;evidence.failure=owner.failure.message;await completeExit();await fs.writeFile(path.join(root,'unavailable-results.json'),JSON.stringify(evidence,null,2));console.log('PASS Electron unavailable');return;
 }
 if(process.env.WITHU_CHECK_ORB==='1')getWindow().webContents.on('console-message',(_event,...args)=>console.log('ORB CONSOLE',...args));
 const wc=()=>getWindow().webContents;
 const js=source=>wc().executeJavaScript(source,true);
 const wait=async source=>{for(let i=0;i<100;i++){if(await js(source))return;await sleep(80);}throw Error('UI wait '+source+' '+await js('document.body.innerText'));};
 const call=(method,payload={})=>js(`window.withuDesktop[${JSON.stringify(method)}](${JSON.stringify(payload)})`);
 const route=async value=>{await js(`location.hash=${JSON.stringify('/'+value)}`);await sleep(250);};
 const screenshot=async name=>{console.log('Electron capture '+name);getWindow().show();const image=await capture(wc());await fs.writeFile(path.join(root,name+'.png'),image.toPNG());};
 await wait('document.documentElement.dataset.ready === "true" && !!document.querySelector(".composer textarea")');
 if(process.env.WITHU_CHECK_ORB==='1'){getWindow().show();const {emotionBallChecks}=await import('./emotion-ball-electron.mjs');await emotionBallChecks({wc,root});await completeExit();return;}
 if(process.env.WITHU_CHECK_REALTIME==='1'){getWindow().show();getWindow().focus();const {realtimeElectronChecks}=await import('./realtime-electron.mjs');await realtimeElectronChecks({wc,owner});await completeExit();return;}
 if(process.env.WITHU_CHECK_SERVICE_GUI==='1'){const {realtimeSettingsChecks}=await import('./realtime-settings-electron.mjs');await realtimeSettingsChecks({wc,root});await completeExit();return;}

 assert.deepEqual(await js(`Array.from(document.querySelectorAll('.nav-rail .sidebar-item:not(.sidebar-extra) > span')).map(e=>e.textContent.trim()).filter(Boolean)`),['对话','日程','灵感','资料库','设置']);
 assert.equal(await js('typeof window.require'),'undefined');assert.equal(await js('typeof window.process'),'undefined');
 assert.equal(await js('typeof window.withuDesktop.invoke'),'undefined');assert.equal(await js('typeof window.withuDesktop.shutdown'),'undefined');
 const prefs=wc().getLastWebPreferences();assert.ok(prefs.contextIsolation&&prefs.sandbox&&!prefs.nodeIntegration);
 const scenario=process.env.WITHU_CHECK_SCENARIO;
 if(['crash','eof','timeout'].includes(scenario)){
   const worker=(await owner.request('withu:probe:start',{id:'failure-worker',duration_ms:60000,worker:true,cleanup_failure:false})).resource.worker_pid;
   if(scenario==='crash'){await assert.rejects(owner.request('withu:probe:crash'));await owner.exited;await wait('!!document.querySelector(".server-unavailable")');await screenshot('server-crash');}
   if(scenario==='eof'){owner.child.stdin.end();await owner.exited;assert.ok(owner.events.some(e=>e.event==='server.shutdown.complete'));}
   const result=await completeExit();if(scenario==='timeout'){assert.equal(result.phase,'failed');assert.equal(result.resources_released,false);}
   await sleep(100);for(const pid of [owner.child.pid,worker])assert.throws(()=>process.kill(pid,0));
   evidence.checks.push('actual Electron main '+scenario+' cleans Rust and worker');evidence.result=result;evidence.success=true;await fs.writeFile(path.join(root,scenario+'-results.json'),JSON.stringify(evidence,null,2));console.log('PASS Electron '+scenario);return;
 }
 if(process.env.WITHU_CHECK_ALPHA==='1'){const {alphaChecks}=await import('./alpha-ui.mjs');await alphaChecks({owner,wc,completeExit,root,getWindow});return;}
 await screenshot('comfort');evidence.checks.push('default Comfort/navigation; sandbox, isolated preload, no Node/arbitrary channel/shutdown');
 if(process.env.WITHU_CHECK_EXPECT_RESTORE==='1'){
   const goals=(await call('goalsList')).items;assert.ok(goals.some(g=>g.title==='Electron goal'));
   const work=(await call('conversationList',{mode:'cowork',project_id:null})).items;assert.ok(work.length);
   const drafts=await Promise.all(work.map(c=>call('draftGet',{id:c.conversation_id})));assert.ok(drafts.some(d=>['Cowork draft persists','Typed Comfort draft'].includes(d.object?.text)));evidence.checks.push('new Electron process restores previous application run data and drafts');
 }
 assert.ok((await call('readSourceCss')).includes('.composer'));evidence.checks.push('visual editor source CSS present');
 if(process.env.WITHU_CHECK_CONFIG==='1'){
  await route('settings/connectors');await wait("document.body.textContent.includes('Windows')");
  const click=text=>js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`);
  const fill=(selector,value)=>js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('添加提供商');await wait("!!document.querySelector('.model-editor input[type=password]')");
   assert.equal(await js("document.querySelector('.model-editor input[type=password]').disabled"),false,'new provider Key must be editable without Replace click');
   assert.equal(await js("getComputedStyle(document.querySelector('.settings-content')).scrollbarWidth"),'none');
   await js("document.querySelector('.model-editor details').open=true");await fill('.model-editor input:not([type=password]):not([type=url])','Desktop test provider');
   await fill('.model-editor input[type=password]','FICTIONAL-DESKTOP-ONLY');await js("document.querySelector('button[aria-label=\"显示 API Key\"]').click()");await wait("document.querySelector('.model-secret input').type==='text'");assert.equal(await js("document.querySelector('.model-secret input').value"),'FICTIONAL-DESKTOP-ONLY');await js("document.querySelector('button[aria-label=\"隐藏 API Key\"]').click()");await wait("document.querySelector('.model-secret input').type==='password'");await fill('.model-editor input[type=url]','http://127.0.0.1:9999/v1');await click('保存提供商');await wait("document.body.textContent.includes('已保存密钥')");
   await js("document.querySelector('.model-provider .model-actions button').click()");await wait("!!document.querySelector('.model-editor input[type=password]')");assert.equal(await js("document.querySelector('.model-editor input[type=password]').disabled"),false);assert.equal(await js("document.querySelector('.model-editor input[type=password]').value"),'');await click('保存提供商');await wait("!document.querySelector('.model-editor')");
   await route('settings/general');const rowWidth=await js("document.querySelector('.settings-card').getBoundingClientRect().width");await route('settings/connectors');
   assert.equal(await js("document.querySelector('.model-section').getBoundingClientRect().width"),rowWidth,'model rows must use same settings content width');
   await js("document.querySelector('.settings-content').scrollTop=100000");assert.equal(await js("document.querySelector('.settings-content').scrollTop>0"),true,'hidden scrollbar must not disable access to bottom actions');await js("document.querySelector('.settings-content').scrollTop=0");
   let config=(await call('configGet')).config;assert.equal(config.providers[0].display_name,'Desktop test provider');assert.ok(!JSON.stringify(config).includes('FICTIONAL-DESKTOP-ONLY'));assert.ok(!JSON.stringify(config).includes('credential_ref'));
  await js('location.reload()');await wait("document.body.textContent.includes('Desktop test provider')");assert.equal((await call('configGet')).credential_states[config.providers[0].provider_id],'present');
  const http=await import('node:http');let slowReply=false,streamClosed=0,requestCount=0;const fixture=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;assert.equal(req.headers.authorization,'Bearer FICTIONAL-DESKTOP-ONLY');const reqPath=req.url.startsWith('http')?new URL(req.url).pathname:req.url;if(reqPath==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'desktop-model'},{id:'desktop-asr'},{id:'desktop-tts'}]}));return;}if(reqPath==='/v1/audio/transcriptions'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'Hello. This is a speech recognition test.'}));return;}if(reqPath==='/v1/audio/speech'){assert.equal(JSON.parse(body).voice,'desktop-voice');res.setHeader('Content-Type','audio/pcm');res.end(Buffer.from([1,0,2,0]));return;}assert.equal(JSON.parse(body).model,'desktop-model');requestCount++;res.on('close',()=>streamClosed++);res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'桌面真实协议'},finish_reason:null}]})+'\n\n');if(slowReply)await sleep(1800);if(!res.destroyed)res.end('data: '+JSON.stringify({choices:[{delta:{content:'回放'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  try{config={...config,config_version:config.config_version+1,providers:config.providers.map(p=>({...p,endpoint:'http://127.0.0.1:'+fixture.address().port+'/v1'})),defaults:{...config.defaults,llm:config.providers[0].provider_id},model_overrides:{llm:{provider_ref:config.providers[0].provider_id,model_ref:'desktop-model'}}};await call('configUpdate',{schema_version:1,expected_version:config.config_version-1,config,credential_changes:[]});await js('location.reload()');await wait("document.documentElement.dataset.ready === 'true'");await route('settings/connectors');await wait("!!document.querySelector('#model-choice-llm')");
   await js("document.querySelectorAll('.model-service')[0].querySelector('.model-field .model-actions button').click()");await wait("document.body.textContent.includes('已获取提供商模型列表')");await js("document.querySelector('#model-choice-llm').click()");await wait("!!document.querySelector('.model-select-menu')");await js("[...document.querySelectorAll('.model-select-option')].find(e=>e.textContent==='desktop-model').click()");await wait("!document.querySelector('.model-select-menu')");
   for(const [index,model]of [[1,'desktop-asr'],[2,'desktop-tts']]){
    await js(`document.querySelector('#model-provider-${index===1?'asr':'tts'}').click()`);await wait("!!document.querySelector('.model-select-menu')");await js("[...document.querySelectorAll('.model-select-option')].find(e=>e.textContent==='Desktop test provider').click()");await wait("!document.querySelector('.model-select-menu')");
    await js(`document.querySelectorAll('.model-service')[${index}].querySelector('.model-field .model-actions button:nth-child(2)').click()`);await wait(`!!document.querySelectorAll('.model-service')[${index}].querySelector('input[aria-label=\"手动模型标识\"]')`);await fill(`.model-service:nth-child(${index+2}) input[aria-label="手动模型标识"]`,model);
    if(index===2)await fill('.model-service:nth-child(4) input[aria-label="普通声音"]','desktop-voice');
    await js(`[...document.querySelectorAll('.model-service')[${index}].querySelectorAll('button')].find(b=>b.textContent==='保存并测试').click()`);await wait(`document.querySelectorAll('.model-service')[${index}].textContent.includes('已就绪')`);
   }
   assert.equal((await call('configGet')).config.model_overrides.asr.model_ref,'desktop-asr');assert.equal((await call('configGet')).config.model_overrides.tts.model_ref,'desktop-tts');assert.equal((await call('configGet')).config.speech_preferences.tts.voice_id,'desktop-voice');assert.ok(await js("!!document.querySelector('.model-audio-preview audio')"));evidence.checks.push('actual model GET/dropdown selection, ASR/TTS save-and-test and transient playable audio with explicit voice');
   await route('chat');
  // Real renderer worklet/gesture permission path, Chromium synthetic microphone only.
  await js("(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const stream=await original(c);window.__fixtureTracks=stream.getTracks();return stream;};})()");
  const micPosition=await js("(()=>{const r=document.querySelector('[data-speech-activate-audio]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  wc().sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...micPosition});wc().sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...micPosition});
  await wait("document.querySelector('.chat-voice-controls').textContent.includes('录音中')");await sleep(400);
  await js("document.querySelector('[aria-label=\"结束录音并识别\"]').click()");
  await wait("document.querySelector('.composer textarea').value==='Hello. This is a speech recognition test.'");
  assert.equal(await js("document.querySelector('.chat-voice-controls [role=status]')===null"),true);
  assert.equal(await js("window.__fixtureTracks.every(t=>t.readyState==='ended')"),true);
  wc().sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...micPosition});wc().sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...micPosition});await wait("document.querySelector('.chat-voice-controls').textContent.includes('录音中')");
  await route('settings/general');await wait("window.__fixtureTracks.every(t=>t.readyState==='ended')");await route('chat');
  evidence.checks.push('trusted microphone click, synthetic Chromium capture/worklet/resample, actual ASR fixture -> editable draft (no auto send)');
  const sendText=async text=>{await js(`(()=>{const e=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(80);await js('document.querySelector(".send-button").click()');};
  const assistantBefore=await js("document.querySelectorAll('.message.assistant').length");await sendText('Desktop HTTP fixture only');await wait("document.querySelectorAll('.message.assistant').length>"+assistantBefore+"&&[...document.querySelectorAll('.message.assistant')].at(-1).textContent.includes('桌面真实协议回放')");assert.ok(requestCount>0);
  await js("[...document.querySelectorAll('.chat-voice-controls button')].find(b=>b.textContent==='朗读回复').click()");await wait("!document.querySelector('.chat-voice-controls [role=status]')");
  await route('settings/connectors');await wait("document.querySelectorAll('.model-service').length===3");
  assert.ok(await js("[...document.querySelectorAll('.model-service')].slice(1).every(s=>s.textContent.includes('已就绪'))"));
  await route('chat');evidence.checks.push('actual Chat TTS fixture and playback cleanup, Settings navigation restores durable ASR/TTS verification');
  slowReply=true;await sendText('Cancel local fixture reply');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='停止生成')");await wait("document.querySelectorAll('.message.assistant').length>="+(assistantBefore+2));const beforeClosed=streamClosed;await click('停止生成');await sleep(250);assert.ok(streamClosed>beforeClosed);await sleep(1800);assert.equal(await js("document.querySelectorAll('.message.assistant').length"),assistantBefore+1);evidence.checks.push('actual Electron composer receives Rust HTTP stream and stops network/output on click; late completion does not appear');
  }finally{fixture.closeAllConnections();await new Promise(r=>fixture.close(r));}
  config=(await call('configGet')).config;config={...config,config_version:config.config_version+1,providers:[],defaults:{llm:null,asr:null,tts:null},model_overrides:{},speech_preferences:{}};await call('configUpdate',{schema_version:1,expected_version:config.config_version-1,config,credential_changes:[]});
  evidence.checks.push('actual Electron Settings saves fictitious key to Windows credential manager, survives renderer reload without exposing key, then removes provider');
  await route('chat');
 }
 const status=await call('serverStatus');assert.equal(status.status.pid,owner.child.pid);assert.equal(status.provider.llm,'unconfigured');
 const pid=owner.child.pid;const probe=(await owner.request('withu:probe:start',{id:'electron-worker',duration_ms:60000,worker:true,cleanup_failure:false})).resource;
 const loaded=once(wc(),'did-finish-load');wc().reload();await loaded;await wait('document.documentElement.dataset.ready === "true"');assert.equal((await call('serverStatus')).status.pid,pid);
 getWindow().close();for(let i=0;i<50&&getWindow().isVisible();i++)await sleep(40);assert.equal(getWindow().isVisible(),false);assert.equal((await owner.status()).pid,pid);await createWindow();assert.ok(getWindow().isVisible());assert.equal((await call('serverStatus')).status.pid,pid);evidence.checks.push('renderer reload/close hides/reopen retain server PID and worker');
 const id='electron-'+randomUUID();const c={schema_version:1,conversation_id:id,mode:'comfort',project_id:null,title:'Electron input',last_activity_at:String(Date.now()),task_refs:[],draft_ref:null,version:1};
 await call('conversationUpdate',{object:c,expected_version:0});const draft={schema_version:1,id,conversation_id:id,text:'Comfort draft persists',file_refs:[],version:1};await call('draftUpdate',{object:draft,expected_version:0});
 await assert.rejects(call('conversationUpdate',{object:c,expected_version:0}));assert.equal((await call('draftGet',{id})).object.text,draft.text);
 const preserved={...c,conversation_id:id+'-cowork',mode:'cowork',title:'Preserved Cowork record'};await call('conversationUpdate',{object:preserved,expected_version:0});await call('draftUpdate',{object:{...draft,id:preserved.conversation_id,conversation_id:preserved.conversation_id,text:'Cowork draft persists'},expected_version:0});
 const view=(await call('viewGet',{id:'client'})).object||{schema_version:1,id:'client',theme:'light',themeColor:'avatar',language:'简体中文',active:{comfort:null,cowork:null},expanded:[],scroll:{comfort:0,cowork:0},overrides:{},sceneEdits:{},version:0};await call('viewUpdate',{object:{...view,active:{...view.active,comfort:id,cowork:preserved.conversation_id},version:view.version+1},expected_version:view.version});
 const reloaded=once(wc(),'did-finish-load');wc().reload();await reloaded;await wait('document.documentElement.dataset.ready === "true"');
 assert.ok(await js('!!document.querySelector(".nav-rail")'),'main nav present');assert.equal(await js('!!document.querySelector(".mode-menu")'),false);evidence.checks.push('Comfort conversation restored with preserved Cowork data; main nav present, no mode menu');
 assert.equal(await js('document.querySelector(".composer textarea").value'),draft.text);
 await js(`const e=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Typed Comfort draft');e.dispatchEvent(new Event('input',{bubbles:true}));`);
 for(let i=0;i<40;i++){if((await call('draftGet',{id})).object.text==='Typed Comfort draft')break;await sleep(50);}
 assert.equal((await call('draftGet',{id})).object.text,'Typed Comfort draft');evidence.checks.push('composer DOM input persists through preload to Rust');
 await js("document.querySelector('.send-button').click()");await wait("!!document.querySelector('.activity-panel') && document.querySelector('.activity-panel').textContent.includes('消息已发送')");
 await route('settings/general');assert.equal(await js("!!document.querySelector('.activity-panel')"),false);
 await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'.',ctrlKey:true,bubbles:true}))");assert.equal(await js("!!document.querySelector('.activity-panel')"),false);
 await route('chat');assert.equal(await js("!!document.querySelector('.activity-panel')"),false);
 evidence.checks.push('send auto opens real activity; direct Settings hash and Ctrl+. cannot leak panel');
 const sentDraft=(await call('draftGet',{id})).object;await call('draftUpdate',{object:{...sentDraft,text:'Typed Comfort draft',version:sentDraft.version+1},expected_version:sentDraft.version});
await screenshot('comfort-fixed');evidence.checks.push('real preload Comfort conversation CRUD, conflict, typed draft restore; preserved Cowork data');
 await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))");await wait('!!document.querySelector(".search-field input")');await js("(()=>{const e=document.querySelector('.search-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Preserved Cowork record');e.dispatchEvent(new Event('input',{bubbles:true}));})()");await wait('!!document.querySelector(".search-result")');await js('document.querySelector(".search-result").click()');await wait('!document.querySelector(".modal")');assert.equal(await js('!!document.querySelector(".cowork-composer")'),false);assert.equal((await call('viewGet',{id:'client'})).object.active.comfort,id);evidence.checks.push('search cannot open a Cowork conversation or replace active Comfort session');
 const goal={schema_version:1,id:'goal-'+id,title:'Electron goal',description:'Explicit user goal',done:false,version:1};await call('goalsUpdate',{object:goal,expected_version:0});
 const idea={schema_version:1,id:'idea-'+id,title:'Electron idea',description:'User authored',version:1};await call('ideasUpdate',{object:idea,expected_version:0});
 const files=await call('importFiles',[{name:'electron-note.txt',base64:Buffer.from('Actual file bytes').toString('base64')}]);assert.equal(await fs.readFile(files[0].path,'utf8'),'Actual file bytes');
 const afterData=once(wc(),'did-finish-load');wc().reload();await afterData;await wait('document.documentElement.dataset.ready === "true"');
 await route('goals');await wait(`document.body.textContent.includes('Electron goal')`);await screenshot('goals');
 await route('ideas');await wait(`document.body.textContent.includes('Electron idea')`);await screenshot('ideas');
 await route('library/files');await wait(`document.body.textContent.includes('electron-note.txt')`);await screenshot('library');
 const {dialog}=await import('electron');const exportFile=path.join(root,'withu-data-export.json');const save=dialog.showSaveDialog;
 try{dialog.showSaveDialog=async()=>({canceled:false,filePath:exportFile});await call('exportData');}finally{dialog.showSaveDialog=save;}
 const exported=JSON.parse(await fs.readFile(exportFile,'utf8'));assert.ok(exported.messages.every(m=>m.role==='user'||m.role==='assistant'&&m.operation_id&&Number.isInteger(m.config_version)));assert.ok(!JSON.stringify(exported.config).includes('credential_'));evidence.checks.push('real main export writes domain objects and public config only');
 const search=await call('searchQuery',{query:'Electron idea'});assert.ok(search.items.some(r=>r.kind==='ideas'));
 await call('ideasDelete',{id:idea.id,expected_version:1});assert.equal((await call('searchQuery',{query:'Electron idea'})).items.length,0);
 await assert.rejects(call('openExternal','https://github.com.evil.test/'));
 await route('settings/devices');await screenshot('devices');await route('feed');await screenshot('feed');evidence.checks.push('Goals/Ideas/Library real data render, file import bytes, search/delete invalidation, Devices, actual empty Feed, blocked external domain');
 const wire=owner.wire;await fs.writeFile(path.join(root,'wire.json'),JSON.stringify(wire,null,2));
 const workerPid=probe.worker_pid;const a=completeExit(),b=completeExit();const result=await a;assert.deepEqual(await b,result);assert.equal(result.phase,'complete');assert.ok(result.resources_released);await owner.exited;
 for(const deadPid of [pid,workerPid])assert.throws(()=>process.kill(deadPid,0));evidence.checks.push('repeat complete exit same result, acknowledged cleanup, Rust and worker process gone');
 evidence.shutdown=result;evidence.success=true;await fs.writeFile(path.join(root,'results.json'),JSON.stringify(evidence,null,2));console.log('PASS Electron '+JSON.stringify(evidence));
}
