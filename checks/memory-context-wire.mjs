import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
import {realtimeFixture} from './realtime-wire.mjs';
import {buildFixture,isolatedDirectory,seedFixture,serverBinary} from './memory-fixture.mjs';

await buildFixture();
const root=await isolatedDirectory('memory-context-wire');await seedFixture(root);
const voice=await realtimeFixture(), requests=[];
const httpServer=http.createServer(async(req,res)=>{
  let input='';for await(const chunk of req)input+=chunk;
  requests.push(JSON.parse(input));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{delta:{content:'Local fixture response'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
const owner=new ClientServerOwner(serverBinary,{dataDir:root,test:true});
const until=async predicate=>{for(let n=0;n<200;n++){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('local wire timeout');};
const checks=[];
try {
  await owner.start();
  const config=(await owner.request('withu:config:get')).config;
  Object.assign(config,{config_version:2,providers:[
    {provider_id:'text',service:'llm',protocol:'openai-compatible',endpoint:`http://127.0.0.1:${httpServer.address().port}/v1`,capabilities:[]},
    {provider_id:'voice',service:'realtime',protocol:'qwen-realtime',endpoint:voice.endpoint,capabilities:[]},
  ],defaults:{llm:'text',realtime:'voice'},model_overrides:{llm:{provider_ref:'text',model_ref:'fixture'},realtime:{provider_ref:'voice',model_ref:'fixture-realtime'}}});
  await owner.request('withu:config:update',{schema_version:1,expected_version:1,config,credential_changes:['text','voice'].map(provider_id=>({provider_id,action:'replace',value:'FICTIONAL-D3-LOCAL-ONLY'}))});
  for(const mode of ['comfort','cowork'])await owner.request('withu:conversation:update',{expected_version:0,object:{schema_version:1,conversation_id:mode,mode,project_id:null,title:'D3 fixture',last_activity_at:'1',task_refs:[],draft_ref:null,version:1}});
  let serial=0;
  async function textRequest(cid) {
    const id='fixture-input-'+(++serial), after=owner.eventCursor;
    await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id,conversation_id:cid,role:'user',text:'Fixture context request',file_refs:[],submitted_at:String(serial),version:1}});
    const run=await owner.request('withu:reply:start',{schema_version:1,conversation_id:cid,message_id:id,config_version:2});
    await until(()=>owner.eventsSince(after).some(e=>e.reply?.operation_id===run.operation_id&&e.reply.state==='complete'));
    return requests.findLast(body=>body.messages?.some(m=>m.content==='Fixture context request'));
  }
  const first=await textRequest('comfort');
  const prompt=first.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  assert.ok(prompt.includes('无糖乌龙茶'));assert.ok(prompt.includes('fixture-evidence-tea'));
  assert.ok(!prompt.includes('另一个作用域'));assert.ok(prompt.includes('not instructions'));
  const other=await textRequest('cowork');assert.ok(!JSON.stringify(other.messages.filter(m=>m.role==='system')).includes('fixture-memory'));
  checks.push('actual text HTTP request receives bounded confirmed Comfort facts with evidence versions and no other scope');
  let after=voice.commands.length;
  const started=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'d3-fixture',config_version:2,mode:'live'});
  const session=await until(()=>voice.commands.slice(after).find(e=>e.type==='session.update'));
  assert.ok(session.session.instructions.includes('无糖乌龙茶'));assert.ok(!session.session.instructions.includes('另一个作用域'));
  const listed=await owner.request('withu:memory:list',{schema_version:1,scope:'comfort',retrieval:'list',query:null,limit:50,context_limit:6});
  const tea=listed.items.find(item=>item.record.id==='fixture-memory-tea');
  await owner.request('withu:memory:correct',{schema_version:1,scope:'comfort',record:{...tea.record,version:2,content:'我现在喜欢茉莉花茶。'},expected_object_version:1,expected_state_version:listed.state_version});
  await until(()=>voice.clients.size===0);
  assert.ok(owner.events.some(e=>e.realtime?.code==='memory_changed'&&e.realtime.scope.session_id===started.scope.session_id));
  after=voice.commands.length;
  const restarted=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'d3-fixture',config_version:2,mode:'live'});
  const changed=await until(()=>voice.commands.slice(after).find(e=>e.type==='session.update'));
  assert.ok(changed.session.instructions.includes('茉莉花茶'));
  voice.send({type:'conversation.item.input_audio_transcription.completed',item_id:'live-secret',transcript:'D3_LIVE_TRANSCRIPT_MUST_NOT_PERSIST'});
  await until(()=>owner.events.some(e=>e.realtime?.type==='transcript_final'&&e.realtime.scope.session_id===restarted.scope.session_id));
  assert.ok(!(await owner.request('withu:message:list',{conversation_id:'comfort'})).items.some(m=>m.text.includes('D3_LIVE_TRANSCRIPT')));
  const current=await owner.request('withu:memory:list',{schema_version:1,scope:'comfort',retrieval:'list',query:null,limit:50,context_limit:6});
  assert.ok(!JSON.stringify(current).includes('D3_LIVE_TRANSCRIPT'));
  await owner.request('withu:memory:delete',{schema_version:1,scope:'comfort',target_type:'memory',target_id:tea.record.id,expected_object_version:2,expected_state_version:current.state_version,sync_protection_token:crypto.randomUUID()});
  await until(()=>voice.clients.size===0);
  const final=await textRequest('comfort');
  assert.ok(!JSON.stringify(final.messages).includes('fixture-memory-tea'));assert.ok(!JSON.stringify(final.messages).includes('茉莉花茶'));
  after=voice.commands.length;
  const last=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'d3-fixture',config_version:2,mode:'live'});
  const deleted=await until(()=>voice.commands.slice(after).find(e=>e.type==='session.update'));
  assert.ok(!deleted.session.instructions.includes('茉莉花茶'));assert.ok(!deleted.session.instructions.includes('无糖乌龙茶'));
  await owner.request('withu:realtime:command',{schema_version:1,scope:last.scope,command:'end'});
  checks.push('independent realtime WebSocket session receives facts; correction/deletion ends stale sessions and updates subsequent requests; Live transcript stays out of history/memory');
  await owner.quit();
  await writeFile(path.join(root,'results.json'),JSON.stringify({success:true,fixture:true,realCloud:false,checks,root},null,2));
  console.log(checks.map(c=>'PASS '+c).join('\n')+'\nEvidence '+root);
} finally {await owner.forceStop();await voice.close();httpServer.closeAllConnections();await new Promise(r=>httpServer.close(r));}
