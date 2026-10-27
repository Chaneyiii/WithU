// Actual localhost sockets, synthetic credentials/PCM and isolated Windows storage.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
import {realtimeFixture} from './realtime-wire.mjs';
import {volcFixture} from './volc-realtime-wire.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async predicate=>{for(let i=0;i<250;i++){const result=predicate();if(result)return result;await sleep(20);}throw Error('output safety timeout');};
await mkdir('output/p3/output-safety',{recursive:true});
const root=await mkdtemp(path.resolve('output/p3/output-safety/run-'));
const checks=[];
for(const volc of [false,true]){
 const fixture=await (volc?volcFixture():realtimeFixture());
 const protocol=volc?'volc-realtime':'qwen-realtime';
 const data=path.join(root,protocol);
 const key='FICTIONAL-SAFETY-'+randomUUID(),split=Math.floor(key.length/2);
 const owner=new ClientServerOwner(process.env.WITHU_SERVER_BINARY||path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:data,test:true});
 const observed=[];let pcmFrames=0;
 owner.on('event',m=>{if(m.data?.realtime){const e=m.data.realtime;if(e.type==='audio'){assert.equal(Buffer.from(e.audio_base64,'base64').length,24000);pcmFrames++;}else observed.push(e);}});
 let config;
 const send=(value,escaped=false)=>{let raw=JSON.stringify(value);if(escaped)raw=raw.replaceAll(key,[...key].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));for(const socket of fixture.clients)socket.send(raw);};
 const beginResponse=id=>send(volc?{type:'response.output_audio.started',response_id:id}:{type:'response.created',response:{id}});
 const delta=(id,text)=>send({type:volc?'response.output_text.delta':'response.audio_transcript.delta',response_id:id,delta:text});
 const finalText=(id,text,escaped=false)=>send(volc?{type:'response.output_text.done',response_id:id,text}:{type:'response.audio_transcript.done',response_id:id,transcript:text},escaped);
 const finish=id=>{if(volc)send({type:'response.output_audio.done',response_id:id});else send({type:'response.done',response:{id,status:'completed'}});};
 const start=async live=>{const {scope}=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'safe',renderer_id:'safety',config_version:2,...(live?{mode:'live'}:{})});await wait(()=>observed.some(e=>e.type==='ready'&&e.scope.session_id===scope.session_id));return scope;};
 const end=async scope=>{await owner.request('withu:realtime:command',{schema_version:1,scope,command:'end'});await wait(()=>fixture.clients.size===0);};
 const forScope=scope=>observed.filter(e=>e.scope.session_id===scope.session_id);
 try{
  await owner.start();config=(await owner.request('withu:config:get')).config;
  config={...config,config_version:2,providers:[{provider_id:'voice',service:'realtime',protocol,endpoint:fixture.endpoint,capabilities:[]}],defaults:{llm:null,realtime:'voice'},model_overrides:{realtime:{provider_ref:'voice',model_ref:volc?'1.2.6.1':'fixture-qwen'}}};
  await owner.request('withu:config:update',{schema_version:1,expected_version:1,config,credential_changes:[{provider_id:'voice',action:'replace',value:key}]});
  await owner.request('withu:conversation:update',{expected_version:0,object:{schema_version:1,conversation_id:'safe',mode:'comfort',project_id:null,title:'Output safety',last_activity_at:'1',task_refs:[],draft_ref:null,version:1}});
  for(const live of [false,true]){
   for(const scenario of ['split','escaped-final','asr-preview','asr-final','escaped-id']){
    const scope=await start(live),id=randomUUID();
    if(scenario==='split'){beginResponse(id);delta(id,'ordinary '+key.slice(0,split));await sleep(50);delta(id,key.slice(split));finalText(id,'ordinary final');finish(id);}
    if(scenario==='escaped-final'){beginResponse(id);delta(id,'ordinary');finalText(id,key,true);finish(id);}
    if(scenario==='asr-preview')send(volc?{type:'conversation.item.input_audio_transcription.delta',item_id:id,delta:key}:{type:'conversation.item.input_audio_transcription.delta',item_id:id,text:key.slice(0,split),stash:key.slice(split)},true);
    if(scenario==='asr-final')send({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:key},true);
    if(scenario==='escaped-id')send(volc?{type:'response.output_audio.started',response_id:key}:{type:'response.created',response:{id:key}},true);
    await wait(()=>forScope(scope).some(e=>e.type==='failed'));
    const events=forScope(scope);
    // Flake note (2026-10-28): this assert failed 2 times in ~19 runs before the
    // line below existed, both times on escaped-final, and never reproduced in
    // 53 later runs. Print the observed events so the next failure explains
    // itself instead of needing a separate debug copy.
    if(!events.some(e=>e.code==='sensitive_provider_output'))console.error('observed events '+protocol+' '+scenario+' live='+live+': '+JSON.stringify(events.map(e=>({type:e.type,code:e.code}))));
    assert.ok(events.some(e=>e.code==='sensitive_provider_output'),protocol+' '+scenario);
    assert.equal(events.some(e=>['assistant_final','transcript_final'].includes(e.type)),false);
    assert.equal(events.filter(e=>e.type==='assistant_delta').map(e=>e.text).join('').includes(key),false);
    assert.equal(JSON.stringify(events).includes(key),false);
    assert.equal(JSON.stringify((await owner.request('withu:message:list',{conversation_id:'safe'})).items).includes(key),false);
    await end(scope);checks.push(protocol+' '+(live?'live':'history')+' '+scenario);
   }
   const scope=await start(live),id=randomUUID(),benign='正常中文 '+key.slice(0,8);
   beginResponse(id);delta(id,benign);await wait(()=>forScope(scope).some(e=>e.type==='assistant_delta'));
   assert.equal(forScope(scope).filter(e=>e.type==='assistant_delta').map(e=>e.text).join(''),'正常中文 ');
   finalText(id,benign);finish(id);await wait(()=>forScope(scope).some(e=>e.type==='assistant_final'));
   assert.equal(forScope(scope).filter(e=>e.type==='assistant_delta').map(e=>e.text).join(''),benign,'benign held suffix flushes at completion');
   const cancelled=randomUUID();beginResponse(cancelled);delta(cancelled,key.slice(0,split));
   const cancels=fixture.commands.filter(e=>e.type==='response.cancel').length;
   await owner.request('withu:realtime:command',{schema_version:1,scope,command:'interrupt'});
   await wait(()=>fixture.commands.filter(e=>e.type==='response.cancel').length>cancels);
   await sleep(50);const fresh=randomUUID();beginResponse(fresh);delta(fresh,key.slice(split));finish(fresh);
   if(volc)finalText(fresh,key.slice(split));
   await wait(()=>forScope(scope).some(e=>e.type==='assistant_final'&&e.response_id===fresh));
   assert.equal(forScope(scope).some(e=>e.type==='failed'),false,'held prefixes do not cross responses');
   const item=randomUUID();send(volc?{type:'conversation.item.input_audio_transcription.delta',item_id:item,delta:'用户'}:{type:'conversation.item.input_audio_transcription.delta',item_id:item,text:'用',stash:'户'});
   send(volc?{type:'conversation.item.input_audio_transcription.delta',item_id:item,delta:'用户完成'}:{type:'conversation.item.input_audio_transcription.delta',item_id:item,text:'用户',stash:'完成'});
   await wait(()=>forScope(scope).some(e=>e.type==='transcript_delta'&&e.text==='用户完成'));
   assert.deepEqual(forScope(scope).filter(e=>e.type==='transcript_delta').map(e=>e.text),['用户','用户完成']);
   await end(scope);checks.push(protocol+' '+(live?'live':'history')+' benign streaming, suffix flush, interruption reset and ASR snapshots');
  }
  if(!volc){
   for(let call=0;call<3;call++){
    const scope=await start(true),id=randomUUID(),before=pcmFrames;beginResponse(id);
    for(let frame=0;frame<200;frame++){send({type:'response.audio.delta',response_id:id,delta:Buffer.alloc(24000,1).toString('base64')});await sleep(8);}
    await wait(()=>pcmFrames===before+200);await end(scope);
    assert.ok(owner.events.length<=512);assert.ok(owner.wire.length<=3000);
    assert.equal(JSON.stringify([owner.events,owner.wire]).includes('audio_base64'),false,'repeated calls retain no audio payload');
   }
   checks.push('three actual Live sockets: 600 PCM frames delivered; no raw audio retained after hangup');
  }
  await owner.request('withu:config:update',{schema_version:1,expected_version:2,config:{...config,config_version:3,providers:[],defaults:{llm:null,realtime:null},model_overrides:{}},credential_changes:[]});
  await owner.quit();assert.equal((await readFile(path.join(data,'withu-state-v1.sqlite'))).includes(Buffer.from(key)),false,'SQLite contains no synthetic key');
 }finally{if(!owner.exitResult)await owner.forceStop();await fixture.close();}
}
await writeFile(path.join(root,'results.json'),JSON.stringify({success:true,checks,realCloud:false,realDevice:false,syntheticCredentials:true},null,2));
console.log('PASS '+checks.length+' realtime output safety groups; evidence '+root);
