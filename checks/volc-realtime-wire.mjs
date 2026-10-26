import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function volcFixture(){
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 const clients=new Set(),commands=[];let auth='',model='',mode='normal';
 server.on('connection',(ws,request)=>{clients.add(ws);auth=request.headers['x-api-key'];assert.equal(request.headers.authorization,undefined);assert.equal(new URL(request.url,'http://fixture').searchParams.get('model'),null);ws.on('close',()=>clients.delete(ws));ws.on('message',raw=>{const e=JSON.parse(raw);commands.push(e);if(e.type==='session.close')ws.send(JSON.stringify({type:'session.closed'}));if(e.type==='session.create'){model=e.session.model;
  if(mode==='auth'){ws.send(JSON.stringify({type:'error',error:{code:'invalid_api_key',message:'private provider body'}}));return;}
  assert.equal(e.session.audio.input.format.type,'pcm');assert.equal(e.session.audio.input.format.rate,16000);assert.equal(e.session.audio.output.format.type,'pcm_s16le');assert.equal(e.session.audio.output.format.rate,24000);assert.equal(e.session.audio.output.voice,'zh_female_vv_jupiter_bigtts');assert.equal(e.session.tools,undefined);ws.send(JSON.stringify({type:'session.created',session:{id:'fixture'}}));
 }});});
 return {server,clients,commands,get auth(){return auth;},get model(){return model;},set mode(v){mode=v;},endpoint:`ws://127.0.0.1:${server.address().port}/realtime`,send(value){for(const ws of clients)ws.send(JSON.stringify(value));},async close(){for(const ws of clients)ws.terminate();await new Promise(r=>server.close(r));}};
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
 const fixture=await volcFixture();await mkdir('output/p3/volc-realtime-wire',{recursive:true});const data=await mkdtemp(path.resolve('output/p3/volc-realtime-wire/run-'));const key='FICTIONAL-REALTIME-'+crypto.randomUUID();const checks=[];
 const owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:data,test:true});
 const until=async predicate=>{for(let i=0;i<200;i++){const result=predicate();if(result)return result;await delay(20);}await writeFile(path.join(data,'timeout-events.json'),JSON.stringify(owner.wire.map(e=>({error:e.error,event:e.record?.event,data:e.data})),null,2));console.log({commands:fixture.commands.map(e=>e.type),clients:fixture.clients.size,stderr:owner.stderr});throw Error('wire wait '+data);};
 const events=type=>owner.wire.filter(e=>e.data?.realtime?.type===type).map(e=>e.data.realtime);
 try{
  await owner.start();let config=(await owner.request('withu:config:get')).config;config={...config,config_version:2,providers:[{provider_id:'voice',service:'realtime',protocol:'volc-realtime',endpoint:fixture.endpoint,capabilities:[]}],defaults:{llm:null,realtime:'voice'},model_overrides:{realtime:{provider_ref:'voice',model_ref:'1.2.6.1'}}};
  await owner.request('withu:config:update',{schema_version:1,expected_version:1,config,credential_changes:[{provider_id:'voice',action:'replace',value:key}]});
  for(const mode of ['comfort','cowork'])await owner.request('withu:conversation:update',{expected_version:0,object:{schema_version:1,conversation_id:mode,mode,project_id:null,title:'New chat',last_activity_at:'1',task_refs:[],draft_ref:null,version:1}});
  const probe=await owner.request('withu:config:test',{schema_version:1,provider_id:'voice',kind:'realtime',model_ref:'1.2.6.1',config_version:2});
  const proof=await until(()=>owner.wire.find(e=>e.data?.verification?.operation_id===probe.operation_id)?.data.verification);assert.equal(proof.health,'ready');assert.equal(proof.details.audio_inference_verified,false);await until(()=>fixture.clients.size===0);checks.push('authenticated session.create probe returns honest session-only verification and closes transport');
  assert.equal(fixture.auth,key);assert.equal(fixture.model,'1.2.6.1');
  let scope;for(const mode of ['comfort','cowork']){
   ({scope}=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:mode,renderer_id:'renderer',config_version:2}));await until(()=>events('ready').some(e=>e.scope.session_id===scope.session_id));
   await owner.request('withu:realtime:input',{schema_version:1,scope,sequence:1,audio_base64:Buffer.alloc(640,1).toString('base64')});await until(()=>fixture.commands.some(e=>e.type==='input_audio_buffer.append'));assert.equal(Buffer.from(fixture.commands.find(e=>e.type==='input_audio_buffer.append').audio,'base64').length,640);
   await assert.rejects(owner.request('withu:realtime:input',{schema_version:1,scope,sequence:1,audio_base64:'AAA='}),/realtime_audio_sequence/);
   await assert.rejects(owner.request('withu:realtime:input',{schema_version:1,scope:{...scope,renderer_id:'other'},sequence:2,audio_base64:'AAA='}),/realtime_scope/);
   fixture.send({type:'conversation.item.input_audio_transcription.started',item_id:'user-1'});fixture.send({type:'conversation.item.input_audio_transcription.delta',item_id:'user-1',delta:'用户'});
   await until(()=>events('transcript_delta').some(e=>e.scope.session_id===scope.session_id));assert.equal((await owner.request('withu:message:list',{conversation_id:mode})).items.length,0);
   fixture.send({type:'conversation.item.input_audio_transcription.delta',item_id:'user-1',delta:'用户完成'});
   await until(()=>events('transcript_delta').some(e=>e.scope.session_id===scope.session_id&&e.text==='用户完成'));
   assert.equal(events('transcript_delta').filter(e=>e.scope.session_id===scope.session_id).at(-1).text,'用户完成');
   fixture.send({type:'conversation.item.input_audio_transcription.completed',item_id:'user-1',transcript:'用户完成'});fixture.send({type:'conversation.item.input_audio_transcription.completed',item_id:'user-1',transcript:'用户完成'});
   await until(()=>events('transcript_final').some(e=>e.scope.session_id===scope.session_id));assert.equal((await owner.request('withu:message:list',{conversation_id:mode})).items.filter(m=>m.role==='user').length,1);
   fixture.send({type:'response.output_audio.started',response_id:'answer-1'});fixture.send({type:'response.output_audio.delta',delta:Buffer.alloc(480,1).toString('base64')});fixture.send({type:'response.output_text.delta',response_id:'answer-1',delta:'回答'});
   await until(()=>events('audio').some(e=>e.scope.session_id===scope.session_id));
   fixture.send({type:'conversation.item.input_audio_transcription.started',item_id:'user-2'});await until(()=>fixture.commands.some(e=>e.type==='response.cancel'));
   const before=events('audio').filter(e=>e.scope.session_id===scope.session_id).length;fixture.send({type:'response.output_audio.delta',delta:'AQABAA=='});fixture.send({type:'response.output_audio.done',response_id:'answer-1',status_code:'20000002'});await delay(100);assert.equal(events('audio').filter(e=>e.scope.session_id===scope.session_id).length,before);assert.equal((await owner.request('withu:message:list',{conversation_id:mode})).items.filter(m=>m.role==='assistant').length,0);
   fixture.send({type:'response.output_audio.started',response_id:'answer-2'});fixture.send({type:'response.output_text.delta',response_id:'answer-2',delta:'完整回答'});fixture.send({type:'response.output_text.done',text:'完整回答'});fixture.send({type:'response.done',response_id:'answer-2',usage:{}});await delay(60);assert.equal(events('assistant_final').filter(e=>e.scope.session_id===scope.session_id).length,0);fixture.send({type:'response.output_audio.done',response_id:'answer-2'});fixture.send({type:'response.output_audio.done',response_id:'answer-2',status_code:'20000002'});await until(()=>events('assistant_final').some(e=>e.scope.session_id===scope.session_id));assert.equal((await owner.request('withu:message:list',{conversation_id:mode})).items.filter(m=>m.role==='assistant').length,1);
   await owner.request('withu:realtime:command',{schema_version:1,scope,command:'end'});await until(()=>fixture.clients.size===0);await assert.rejects(owner.request('withu:realtime:input',{schema_version:1,scope,sequence:2,audio_base64:'AAA='}),/realtime_session_ended/);
   checks.push(mode+' PCM wire, scope/sequence rejection, partial isolation, duplicate final, barge-in cancel/late drop, final history, end release');
  }
  const messages=(await owner.request('withu:message:list',{conversation_id:'comfort'})).items;const message=messages.find(m=>m.role==='user');
  await assert.rejects(owner.request('withu:message:correct',{schema_version:1,conversation_id:'cowork',message_id:message.id,expected_version:1,text:'corrected'}),/transcript_reference_invalid/);
  await owner.request('withu:message:correct',{schema_version:1,conversation_id:'comfort',message_id:message.id,expected_version:1,text:'corrected'});
  await assert.rejects(owner.request('withu:message:correct',{schema_version:1,conversation_id:'comfort',message_id:message.id,expected_version:1,text:'stale'}),/version_conflict/);checks.push('transcript correction scoped reference and CAS');
  ({scope}=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'renderer',config_version:2}));await until(()=>fixture.clients.size===1);
  await assert.rejects(owner.request('withu:config:update',{schema_version:1,expected_version:1,config:{...config,config_version:3},credential_changes:[]}),/version_conflict/);assert.equal(fixture.clients.size,1);
  await owner.request('withu:config:update',{schema_version:1,expected_version:2,config:{...config,config_version:3},credential_changes:[]});await until(()=>fixture.clients.size===0);checks.push('failed CAS preserves active socket, committed config cancels it');
  config.config_version=3;
  fixture.mode='auth';const probe2=await owner.request('withu:config:test',{schema_version:1,provider_id:'voice',kind:'realtime',model_ref:'1.2.6.1',config_version:3});const failed=await until(()=>owner.wire.find(e=>e.data?.verification?.operation_id===probe2.operation_id)?.data.verification);assert.equal(failed.health,'auth_failed');assert.ok(!JSON.stringify(owner.wire).includes('private provider body'));checks.push('provider authentication failure and error body isolation');
  fixture.mode='normal';({scope}=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'renderer',config_version:3}));await until(()=>fixture.clients.size===1);await owner.request('withu:speech:detach',{renderer_id:'renderer'});await until(()=>fixture.clients.size===0);checks.push('renderer detach closes in-flight actual WebSocket');
  ({scope}=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'renderer',config_version:3}));await until(()=>events('ready').some(e=>e.scope.session_id===scope.session_id));for(const socket of fixture.clients)socket.close();await until(()=>events('failed').some(e=>e.scope.session_id===scope.session_id));await until(()=>fixture.clients.size===0);checks.push('provider disconnect becomes terminal failure');
  ({scope}=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'renderer',config_version:3}));await until(()=>fixture.clients.size===1);
  assert.ok(!JSON.stringify(owner.wire).includes(key));await owner.quit();await until(()=>fixture.clients.size===0);checks.push('shutdown closes active transport');const db=await readFile(path.join(data,'withu-state-v1.sqlite'));assert.ok(!db.includes(Buffer.from(key)));assert.ok(!db.includes(Buffer.from('private provider body')));
  await writeFile(path.join(data,'results.json'),JSON.stringify({checks,realCloud:false,realDevice:false},null,2));console.log('PASS Seeduplex wire '+checks.length+' groups; evidence '+data);
 }finally{if(!owner.exitResult)await owner.forceStop();await fixture.close();}
}

