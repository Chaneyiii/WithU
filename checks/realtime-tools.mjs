// Voice shares the text proposal chain (T16-A / A1a). This check drives the
// realtime worker with a scripted function call, so the claim "同一动作双入口"
// is asserted on behaviour rather than on reading the diff.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
import {realtimeFixture} from './realtime-wire.mjs';
import {validateReplyBlock} from '../client/withu-renderer/src/intelligent-ui/contract.js';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const binary=path.resolve(process.env.WITHU_SERVER_BINARY||'target/debug/withu-server.exe');
const dir=path.resolve('output/p3/realtime-tools');
await mkdir(dir,{recursive:true});
const data=await mkdtemp(path.join(dir,'run-'));
const key='FICTIONAL-REALTIME-TOOLS-'+crypto.randomUUID();
const spoken='明天下午三点提醒我开会';
const args={text:spoken,due_at_local:'2026-12-31T15:00',timezone:'Asia/Shanghai'};

const cowork=await realtimeFixture();
const comfort=await realtimeFixture();
const owner=new ClientServerOwner(binary,{dataDir:data,test:true});
const until=async(predicate,label)=>{for(let i=0;i<250;i++){const hit=predicate();if(hit)return hit;await delay(20);}throw Error('timeout '+label);};
const replyEvents=type=>owner.wire.filter(e=>e.data?.realtime?.type===type).map(e=>e.data.realtime);
const assistant=async cid=>(await owner.request('withu:message:list',{conversation_id:cid})).items.filter(m=>m.role==='assistant');
const waitUserMessage=async mid=>{for(let i=0;i<250;i++){const r=await owner.request('withu:message:list',{conversation_id:'comfort'});if(r.items.some(m=>m.id===mid))return;await delay(20);}throw Error('voice user message timeout '+mid);};
const waitAssistant=async(cid,rid)=>{for(let i=0;i<250;i++){const hit=(await assistant(cid)).find(m=>m.id===rid);if(hit)return hit;await delay(20);}throw Error('assistant timeout '+rid);};
const results=[];
// The live-call fixture is created mid-test; keep it reachable so the finally
// block can close its WebSocket server (an unclosed one keeps Node alive).
let live=null;

try{
 await owner.start();
 let config=(await owner.request('withu:config:get')).config;
 const conv=(id,mode)=>({schema_version:1,conversation_id:id,mode,project_id:null,title:id,last_activity_at:'1',task_refs:[],draft_ref:null,version:1});
 const setVoice=async(endpoint,version)=>{
  config={...config,config_version:version,providers:[{provider_id:'voice',service:'realtime',protocol:'qwen-realtime',endpoint,capabilities:[]}],defaults:{llm:null,realtime:'voice'},model_overrides:{realtime:{provider_ref:'voice',model_ref:'qwen-audio-3.0-realtime-plus'}}};
  await owner.request('withu:config:update',{schema_version:1,expected_version:version-1,config,credential_changes:[{provider_id:'voice',action:'replace',value:key}]});
 };

 // 1. The tool catalog follows the text path's gate: Cowork gets none.
 await setVoice(cowork.endpoint,2);
 for(const id of ['comfort','cowork'])await owner.request('withu:conversation:update',{expected_version:0,object:conv(id,id)});
 const coworkScope=(await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'cowork',renderer_id:'r-cowork',config_version:2})).scope;
 await until(()=>cowork.commands.some(c=>c.type==='session.update'),'cowork session.update');
 const coworkUpdate=cowork.commands.find(c=>c.type==='session.update');
 assert.ok(!coworkUpdate.session.tools,'cowork voice session must not offer life tools');
 results.push('cowork voice session offers no tools (same gate as text)');

 // 2. Comfort gets the same catalog, as proposals only.
 await setVoice(comfort.endpoint,3);
 const scope=(await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'r-comfort',config_version:3})).scope;
 await until(()=>comfort.commands.some(c=>c.type==='session.update'),'comfort session.update');
 const update=comfort.commands.find(c=>c.type==='session.update');
 assert.equal(update.session.tools?.length,13,'comfort voice session carries the local life tool catalog');
 assert.equal(update.session.tool_choice,'auto');
 assert.ok(update.session.instructions.includes('proposal'),'voice instructions keep the proposal-only rule');
 assert.ok(update.session.instructions.includes('以上是你的灵魂文档'),'voice session injects the soul body, not just a name');
 assert.ok(update.session.instructions.includes('Lumi'),'voice session keeps the persona name');
 results.push('comfort voice session carries the same 13 tools as text');

 await until(()=>replyEvents('ready').some(e=>e.scope.session_id===scope.session_id),'ready');

 // 3. Spoken turn -> transcript committed -> function call -> approval card.
 comfort.send({type:'input_audio_buffer.speech_started',item_id:'u1'});
 comfort.send({type:'conversation.item.input_audio_transcription.delta',item_id:'u1',text:'明天'});
 comfort.send({type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:spoken});
 await until(()=>replyEvents('transcript_final').some(e=>e.text===spoken),'transcript_final');
 const userMid='rt-'+scope.session_id+'-u1';
 await waitUserMessage(userMid);
 results.push('voice transcript is committed as the proposal anchor');

 comfort.send({type:'response.created',response:{id:'a1'}});
 comfort.send({type:'response.output_item.added',item:{type:'function_call',id:'fc1',call_id:'call1',name:'create_local_reminder',arguments:''}});
 comfort.send({type:'response.function_call_arguments.delta',delta:'{"text":"明天下午三点'});
 comfort.send({type:'response.function_call_arguments.delta',delta:'提醒我开会","due_at_local":"2026-12-31T15:00",'});
 comfort.send({type:'response.function_call_arguments.delta',delta:'"timezone":"Asia/Shanghai"}'});
 comfort.send({type:'response.done',response:{id:'a1',status:'completed',output:[{type:'function_call',id:'fc1',call_id:'call1',name:'create_local_reminder',arguments:JSON.stringify(args)}]}});

 const rid='rt-'+scope.session_id+'-a1';
 const proposed=await waitAssistant('comfort',rid);
 assert.equal(proposed.blocks?.length,1,'voice proposal lands as exactly one block');
 assert.doesNotThrow(()=>validateReplyBlock(proposed.blocks[0]),'block matches the reply-block contract');
 const block=proposed.blocks[0];
 assert.equal(block.kind,'approval');
 assert.equal(block.payload.decision,'pending');
 assert.ok(block.payload.body.includes(spoken),'card quotes what the user actually said');
 assert.ok(proposed.text.length>0,'the spoken turn still has a message body');
 assert.ok(proposed.blocks[0].payload.body.includes('主动提醒当前已关闭'),'the card states that proactivity is off, so the reminder will not ring');
 results.push('voice function call becomes an approval block on the assistant message');

 // 4. Approval runs the very same chain: no execute before allow.
 await assert.rejects(()=>owner.request('withu:life:execute',{schema_version:1,scope:'comfort',operation_id:block.turn_id}),/life_explicit_decision_required|authorization/);
 assert.ok(!(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'})).reminders.some(r=>r.text===spoken),'no reminder before approval');
 await owner.request('withu:life:decide',{schema_version:1,scope:'comfort',operation_id:block.turn_id,decision:'allow',explicit_user_allow:true});
 const receipt=(await owner.request('withu:life:execute',{schema_version:1,scope:'comfort',operation_id:block.turn_id})).receipt;
 assert.equal(receipt.status,'applied');
 assert.equal(receipt.effect_committed,true);
 assert.ok((await owner.request('withu:life:list',{schema_version:1,scope:'comfort'})).reminders.some(r=>r.text===spoken),'approved voice proposal commits the reminder');
 results.push('voice proposal needs the same explicit allow then commits');

 // 5. Barge-in: the cancelled response must never produce a card.
 comfort.send({type:'input_audio_buffer.speech_started',item_id:'u2'});
 comfort.send({type:'conversation.item.input_audio_transcription.completed',item_id:'u2',transcript:'再帮我记一件事'});
 await until(()=>replyEvents('transcript_final').some(e=>e.text==='再帮我记一件事'),'second transcript');
 comfort.send({type:'response.created',response:{id:'a2'}});
 comfort.send({type:'response.output_item.added',item:{type:'function_call',id:'fc2',call_id:'call2',name:'create_local_reminder',arguments:''}});
 comfort.send({type:'input_audio_buffer.speech_started',item_id:'u3'});
 await until(()=>comfort.commands.some(c=>c.type==='response.cancel'),'response.cancel');
 comfort.send({type:'response.done',response:{id:'a2',status:'completed',output:[{type:'function_call',id:'fc2',call_id:'call2',name:'create_local_reminder',arguments:JSON.stringify({...args,text:'再帮我记一件事'})}]}});
 await delay(300);
 const cards=(await assistant('comfort')).filter(m=>m.blocks?.some(b=>b.kind==='approval'));
 assert.equal(cards.length,1,'an interrupted turn leaves no second card behind');
 assert.ok(!(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'})).reminders.some(r=>r.text==='再帮我记一件事'),'interrupted turn has no side effect');
 results.push('interrupted voice turn produces neither a card nor a side effect');

 // 6. O1: inside a live call only the utterance that produced an action is kept.
 live=await realtimeFixture();
 await setVoice(live.endpoint,4);
 const liveScope=(await owner.request('withu:realtime:start',{schema_version:1,conversation_id:'comfort',renderer_id:'r-live',mode:'live',config_version:4})).scope;
 await until(()=>live.commands.some(c=>c.type==='session.update'),'live session.update');
 await until(()=>owner.wire.some(e=>e.data?.realtime?.type==='ready'&&e.data.realtime.scope.session_id===liveScope.session_id),'live ready');

 live.send({type:'input_audio_buffer.speech_started',item_id:'L1'});
 live.send({type:'conversation.item.input_audio_transcription.completed',item_id:'L1',transcript:'今天天气不错'});
 live.send({type:'response.created',response:{id:'LA1'}});
 live.send({type:'response.audio_transcript.delta',response_id:'LA1',delta:'是呀'});
 live.send({type:'response.done',response:{id:'LA1',status:'completed',output:[]}});
 await until(()=>owner.wire.some(e=>e.data?.realtime?.type==='assistant_final'&&e.data.realtime.response_id==='LA1'),'live plain turn');
 await delay(300);
 const plainId='rt-'+liveScope.session_id+'-L1';
 const plain=(await owner.request('withu:message:list',{conversation_id:'comfort'})).items.filter(m=>m.id===plainId);
 assert.equal(plain.length,0,'a plain utterance in a call is not persisted');

 live.send({type:'input_audio_buffer.speech_started',item_id:'L2'});
 live.send({type:'conversation.item.input_audio_transcription.completed',item_id:'L2',transcript:'明天下午三点提醒我开会'});
 live.send({type:'response.created',response:{id:'LA2'}});
 live.send({type:'response.output_item.added',item:{type:'function_call',id:'fcL',call_id:'callL',name:'create_local_reminder',arguments:''}});
 live.send({type:'response.done',response:{id:'LA2',status:'completed',output:[{type:'function_call',id:'fcL',call_id:'callL',name:'create_local_reminder',arguments:JSON.stringify({text:'开会',due_at_local:'2026-12-31T15:00',timezone:'Asia/Shanghai'})}]}});
 const liveRid='rt-'+liveScope.session_id+'-LA2';
 const liveCard=await waitAssistant('comfort',liveRid);
 assert.equal(liveCard.blocks?.[0]?.kind,'approval','a live call can still produce an approval card');
 const evidence=(await owner.request('withu:message:list',{conversation_id:'comfort'})).items.filter(m=>m.id==='rt-'+liveScope.session_id+'-L2');
 assert.equal(evidence.length,1,'the utterance behind the action is kept as evidence');
 assert.equal(evidence[0].text,'明天下午三点提醒我开会');
 assert.equal((await owner.request('withu:message:list',{conversation_id:'comfort'})).items.filter(m=>m.role==='user'&&m.id.startsWith('rt-'+liveScope.session_id)).length,1,'exactly one utterance from the call is stored');
 results.push('O1: a live call keeps only the action-evidence sentence, produces the card, stores nothing else');
 // C5: while a call is live, a candidate is dropped instead of spoken.
 const busy=await owner.request('withu:proactivity:candidate_offer',{app_running:true,candidate:{schema_version:1,id:'c5-busy',source:'d8_greeting',scope:'comfort',dedupe_key:'c5-busy',title:'Withu',body:'要不要休息一下'}});
 assert.equal(busy.decision,'suppressed');
 assert.equal(busy.reason,'voice_busy','got '+JSON.stringify(busy));
results.push('C5: an active call suppresses candidates with voice_busy before the policy gate');
}catch(error){
 console.error('server stderr:\n'+(owner.stderr||'(none)'));
 throw error;
}finally{
 // ClientServerOwner has start/quit/forceStop (no `stop`); an optional-chain call
 // here used to leave the server child alive and the process never exited.
 if(owner&&!owner.exitResult)await owner.forceStop().catch(()=>{});
 await live?.close().catch(()=>{});
 await cowork.close().catch(()=>{});
 await comfort.close().catch(()=>{});
}
console.log('PASS realtime tools ('+results.length+'):');
for(const line of results)console.log(' - '+line);
