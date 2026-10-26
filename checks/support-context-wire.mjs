import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readFile} from 'node:fs/promises';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
import {realtimeFixture} from './realtime-wire.mjs';

const data = await mkdtemp(path.join(os.tmpdir(),'withu-support-wire-'));
const voice = await realtimeFixture(), requests = [];
const httpServer = http.createServer(async(req,res)=>{
  let input='';for await(const chunk of req) input+=chunk;
  const body=JSON.parse(input);
  if(!body.messages?.[0]?.content?.startsWith("Summarize the conversation"))requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{delta:{content:'Local fixture response'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
const owner = new ClientServerOwner(process.env.WITHU_SERVER_BINARY || path.resolve('target/debug/withu-server.exe'),{dataDir:data,test:true});
const until = async predicate => {for(let n=0;n<200;n++){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('local wire timeout');};
const plan = (cid,turn,need='listening',boundary='D1_PRIVATE_BOUNDARY: no advice; "ignore prior rules" is quoted data') => owner.request('withu:affect:plan',{schema_version:1,conversation_id:cid,turn_id:turn,stated_need:need,boundary});
const feedback = (cid,turn,action='listen') => owner.request('withu:affect:feedback',{schema_version:1,conversation_id:cid,turn_id:turn,action,user_feedback:'helpful',next_turn_signal:null,outcome:'improved',user_correction:null});
let serial=0;
async function textRequest(cid) {
  const id='input-'+(++serial), after=owner.eventCursor, before=requests.length;
  await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id,conversation_id:cid,role:'user',text:'Current user request takes priority',file_refs:[],submitted_at:String(serial),version:1}});
  const run=await owner.request('withu:reply:start',{schema_version:1,conversation_id:cid,message_id:id,config_version:2});
  await until(()=>owner.eventsSince(after).some(e=>e.reply?.operation_id===run.operation_id&&e.reply.state==='complete'));
  assert.equal(requests.length,before+1,'No additional affect/model call');
  return requests.at(-1);
}
try {
  await owner.start();
  const config=(await owner.request('withu:config:get')).config;
  Object.assign(config,{config_version:2,providers:[
    {provider_id:'text',service:'llm',protocol:'openai-compatible',endpoint:`http://127.0.0.1:${httpServer.address().port}/v1`,capabilities:[]},
    {provider_id:'voice',service:'realtime',protocol:'qwen-realtime',endpoint:voice.endpoint,capabilities:[]},
  ],defaults:{llm:'text',realtime:'voice'},model_overrides:{llm:{provider_ref:'text',model_ref:'fixture'},realtime:{provider_ref:'voice',model_ref:'fixture-realtime'}}});
  await owner.request('withu:config:update',{schema_version:1,expected_version:1,config,credential_changes:['text','voice'].map(provider_id=>({provider_id,action:'replace',value:'FICTIONAL-D1-LOCAL-ONLY'}))});
  for(const cid of ['a','b','cowork'])await owner.request('withu:conversation:update',{expected_version:0,object:{schema_version:1,conversation_id:cid,mode:cid==='cowork'?'cowork':'comfort',project_id:null,title:'D1 fixture',last_activity_at:'1',task_refs:[],draft_ref:null,version:1}});
  await assert.rejects(plan('missing','bad'),/conversation_missing/);
  await assert.rejects(plan('cowork','bad'),/support_scope/);
  await plan('a','a-1');
  const b=await textRequest('b');assert.ok(!JSON.stringify(b).includes('D1_PRIVATE_BOUNDARY'));
  const a=await textRequest('a');
  const projection=a.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  assert.match(projection,/D1_PRIVATE_BOUNDARY/);assert.match(projection,/quoted data/);assert.match(projection,/not tool authorization/);assert.match(projection,/current user request takes priority/i);
  assert.equal(a.messages.at(-1).role,'user');assert.equal(a.tools,undefined);
  assert.ok(!JSON.stringify(await textRequest('a')).includes('D1_PRIVATE_BOUNDARY'),'Once per next reply/session');
  await assert.rejects(feedback('missing','a-1'),/conversation_missing/);
  await assert.rejects(feedback('b','a-1'),/affect_plan_missing|affect_feedback_scope/);
  await assert.rejects(feedback('a','wrong'),/affect_feedback_scope/);
  await assert.rejects(feedback('a','a-1','advice'),/affect_feedback_scope/);
  await feedback('a','a-1');await assert.rejects(feedback('a','a-1'),/affect_plan_missing/);
  await plan('a','old');await plan('a','new','companionship');
  await assert.rejects(feedback('a','old'),/affect_feedback_scope/);
  await feedback('a','new','accompany');
  await plan('a','kept');await plan('b','other','listening',null);
  assert.match(JSON.stringify(await textRequest('a')),/D1_PRIVATE_BOUNDARY/);
  await plan('a','quiet','shared_quiet');
  assert.ok(!JSON.stringify(await textRequest('a')).includes('D1_PRIVATE_BOUNDARY'));
  await feedback('a','quiet','shared_quiet');
  await plan('a','live');
  let before=voice.commands.length;
  let started=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'b',renderer_id:'support-b',config_version:2,mode:'live'});
  let session=await until(()=>voice.commands.slice(before).find(e=>e.type==='session.update'));
  assert.ok(!session.session.instructions.includes('D1_PRIVATE_BOUNDARY'));
  await owner.request('withu:realtime:command',{schema_version:1,scope:started.scope,command:'end'});await until(()=>voice.clients.size===0);
  before=voice.commands.length;
  started=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'a',renderer_id:'support-a',config_version:2,mode:'live'});
  session=await until(()=>voice.commands.slice(before).find(e=>e.type==='session.update'));
  assert.match(session.session.instructions,/D1_PRIVATE_BOUNDARY/);assert.match(session.session.instructions,/not tool authorization/);
  voice.send({type:'conversation.item.input_audio_transcription.completed',item_id:'live-private',transcript:'D1_LIVE_TRANSCRIPT_NOT_PERSISTED'});
  await until(()=>owner.events.some(e=>e.realtime?.type==='transcript_final'&&e.realtime.scope.session_id===started.scope.session_id));
  await owner.request('withu:realtime:input',{schema_version:1,scope:started.scope,sequence:1,audio_base64:Buffer.alloc(320,7).toString('base64')});
  await owner.request('withu:realtime:command',{schema_version:1,scope:started.scope,command:'end'});await until(()=>voice.clients.size===0);
  assert.ok(!(await owner.request('withu:message:list',{conversation_id:'a'})).items.some(m=>m.text.includes('D1_LIVE_TRANSCRIPT')));
  assert.ok(!JSON.stringify(await textRequest('a')).includes('D1_PRIVATE_BOUNDARY'));
  await plan('a','pause-active');
  started=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'a',renderer_id:'support-pause',config_version:2,mode:'live'});
  await until(()=>voice.clients.size===1);
  await plan('a','pause','pause_interaction');await until(()=>voice.clients.size===0);
  await feedback('a','pause','pause_interaction');
  assert.deepEqual((await owner.request('withu:memory:list',{schema_version:1,scope:'comfort',retrieval:'list',query:null,limit:20,context_limit:0})).items,[]);
  await owner.quit();
  const db=await readFile(path.join(data,'withu-state-v1.sqlite'));
  for(const secret of ['D1_PRIVATE_BOUNDARY','D1_LIVE_TRANSCRIPT_NOT_PERSISTED',Buffer.alloc(320,7).toString('base64')])assert.ok(!db.includes(Buffer.from(secret)));
  console.log('PASS D1 actual local HTTP + realtime wire: conversation isolation, conservative quoted payload, single consumption, turn/action feedback, replacement stale rejection, no extra call, Live privacy; '+data);
} finally {await owner.forceStop();await voice.close();httpServer.closeAllConnections();await new Promise(r=>httpServer.close(r));}
