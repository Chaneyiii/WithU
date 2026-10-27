import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
import {validateReplyBlock} from '../client/withu-renderer/src/intelligent-ui/contract.js';

// T09/T10 chat tool-proposal wire: a local SSE fixture drives the real server
// through propose -> approve -> execute, plus every failure path. No cloud
// model is contacted; this proves wiring, not real-service quality.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const output=path.resolve('output/p3/chat-tools-wire');await mkdir(output,{recursive:true});
const root=await mkdtemp(path.join(output,'run-'));
const key='FICTIONAL-CHAT-TOOLS-'+crypto.randomUUID();
const wire=[];let mode='text';const sockets=new Set();
const frame=delta=>`data: ${JSON.stringify({choices:[{delta}]})}\n\n`;
const finishFrame=reason=>`data: ${JSON.stringify({choices:[{delta:{},finish_reason:reason}]})}\n\n`;
const toolCall=(name,args)=>[
  `data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call_'+Math.random().toString(36).slice(2,8),type:'function',function:{name,arguments:''}}]}}]})}\n\n`,
  `data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{arguments:JSON.stringify(args)}}]}}]})}\n\n`,
];
const proposals={
  'tool-reminder':()=>toolCall('create_local_reminder',{text:'明天下午三点提醒我开会',due_at_local:'2026-10-26T15:00:00',timezone:'Asia/Taipei'}),
  'tool-draft':()=>toolCall('create_message_draft',{text:'这是一条只会保存在本机的草稿'}),
  'tool-edit-reminder':()=>toolCall('edit_local_reminder',{find_text:'提醒我开会',new_text:'开会（改到线上）'}),
  'tool-edit-missing':()=>toolCall('edit_local_reminder',{find_text:'不存在的条目',new_text:'x'}),
  'tool-retrieve':()=>toolCall('retrieve_local_information',{query:'会议纪要'}),
  'tool-organize':()=>toolCall('organize_local_content',{lines:['周三交周报','周五体检']}),
  'tool-web':()=>toolCall('search_web_information',{query:'本周天气'}),
  'tool-bad-offset':()=>toolCall('create_local_reminder',{text:'带偏移的时间',due_at_local:'2026-10-26T15:00:00+08:00',timezone:'Asia/Taipei'}),
  'tool-bad-zone':()=>toolCall('create_local_reminder',{text:'错误时区',due_at_local:'2026-10-26T15:00:00',timezone:'Mars/Olympus'}),
  'tool-unknown':()=>toolCall('send_email',{to:'nobody@example.invalid',body:'x'}),
};
// Read-only tools trigger one bounded follow-up model turn; the fixture
// emits a proposal only for the request whose user message matches the
// scenario marker. Title-generation requests never match, so no async
// request can steal a scenario's proposal, and the loop provably terminates.
let armedMarker=null;const arm=m=>{mode=m;};
const server=http.createServer(async(req,res)=>{
  let data='';for await(const c of req)data+=c;
  const reqPath=req.url.startsWith('http')?new URL(req.url).pathname:req.url;
  const body=JSON.parse(data);wire.push({url:reqPath,body});
  assert.ok(!data.includes(key),'key material never travels in request bodies');
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(reqPath==='/v1/chat/completions'){
    const armed=Boolean(armedMarker)&&body.messages.some(m=>m.role==='user'&&m.content===armedMarker);
    if(mode==='text'||!armed){res.write(frame({content:'好的，我在听。'}));res.end(finishFrame('stop')+'data: [DONE]\n\n');return;}
    armedMarker=null;
    const [start,args]=proposals[mode]();
    res.write(frame({content:'我来准备这个本地事务。'}));
    res.write(start);res.write(args);
    res.end(finishFrame('tool_calls')+'data: [DONE]\n\n');return;
  }
  res.end();
});server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
const binary=path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe');
let owner=new ClientServerOwner(binary,{dataDir:root,test:true});
const results=[];
try{
 await owner.start();
 let config=(await owner.request('withu:config:get')).config;
 config.config_version=2;config.providers=[{provider_id:'wire',service:'llm',endpoint,protocol:'openai-compatible',capabilities:[]}];config.defaults.llm='wire';config.model_overrides.llm={provider_ref:'wire',model_ref:'user-model'};
 await owner.request('withu:config:update',{schema_version:1,expected_version:1,config,credential_changes:[{provider_id:'wire',action:'replace',value:key}]});
 const conv=(id,mode='comfort')=>({schema_version:1,conversation_id:id,mode,project_id:null,title:id,last_activity_at:'1',task_refs:[],draft_ref:null,version:1});
 for(const id of ['comfort','cowork'])await owner.request('withu:conversation:update',{expected_version:0,object:conv(id,id)});
 let seq=0;
 const startTool=async(cid,text,scenario)=>{armedMarker=text;mode=scenario;return start(cid,text);};
 const start=async(cid='comfort',text='Local test only')=>{const id='input-'+(++seq);await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id,conversation_id:cid,role:'user',text,file_refs:[],submitted_at:String(Date.now()),version:1}});return owner.request('withu:reply:start',{schema_version:1,conversation_id:cid,message_id:id,config_version:config.config_version});};
 const terminal=async operation=>{for(let i=0;i<350;i++){const event=owner.wire.find(e=>e.data?.reply?.operation_id===operation.operation_id&&['complete','failed','cancelled'].includes(e.data.reply.state));if(event)return event.data.reply;await sleep(20);}throw Error('reply terminal timeout');};
 const messages=async(cid='comfort')=>(await owner.request('withu:message:list',{conversation_id:cid})).items.filter(m=>m.role==='assistant');
 const pendingBlock=message=>{const block=message?.blocks?.[0];if(!block)throw Error('expected approval block');assert.doesNotThrow(()=>validateReplyBlock(block),'block matches reply-block contract');assert.equal(block.kind,'approval');assert.equal(block.payload.decision,'pending');return block;};
 const refreshMessage=async(cid,messageId)=>{for(let i=0;i<50;i++){const hit=(await messages(cid)).find(m=>m.id===messageId);if(hit&&hit.blocks?.some(b=>b.payload.decision!=='pending'))return hit;await sleep(20);}throw Error('block decision sync timeout');};

 // 1. Text-only regression: no tools requested -> no tools in request body.
 mode='text';const textRun=await start();assert.equal((await terminal(textRun)).state,'complete');
 assert.equal((await messages()).at(-1).text,'好的，我在听。');
 assert.ok(!wire.at(-1).body.tools,'text reply offers no tools when conversation is Cowork or none apply');
 results.push('plain-text reply path unchanged');

 // 2. Cowork requests carry no tool definitions (life scope is comfort-only).
 // Title-generation requests land on the same wire asynchronously, so each
 // target body is matched by its submitted marker text, never by position.
 const bodyFor=async(cid,marker)=>{const before=wire.length;await start(cid,marker);for(let i=0;i<150;i++){const hit=wire.slice(before).find(w=>w.url==='/v1/chat/completions'&&w.body.messages.some(m=>m.content.includes(marker)));if(hit)return hit.body;await sleep(20);}throw Error('reply request timeout for '+marker);};
 mode='text';const coworkBody=await bodyFor('cowork','cowork-marker-2');
 assert.ok(!coworkBody.tools,'cowork conversation must not offer life tools');
 assert.ok(coworkBody.messages[0].content.includes('No tools are available'),'cowork system prompt keeps no-tools wording');
 // Comfort system prompt carries the proposal guidance and tools.
 const comfortBody=await bodyFor('comfort','comfort-marker-2');
 assert.equal(comfortBody.tools?.length,13,'comfort offers the local life tool catalog plus the honest web stub and schedule listing');
 assert.ok(comfortBody.messages[0].content.includes('proposals only'),'comfort system prompt marks tools as proposal-only');
 results.push('tool definitions scoped to Comfort with proposal-only guidance');

 // 3. Happy path: proposal -> block -> explicit allow -> execute -> reminder.
 const proposeRun=await startTool('comfort','明天下午三点提醒我开会','tool-reminder');
 const done=await terminal(proposeRun);assert.equal(done.state,'complete');
 const proposed=(await messages()).find(m=>m.id===proposeRun.operation_id);
 const block=pendingBlock(proposed);
 assert.equal(proposed.blocks.length,1);
 assert.ok(block.payload.body.includes('明天下午三点提醒我开会'));
 assert.ok(block.action_ref.expires_at>0&&block.action_ref.cancel_token&&block.action_ref.approval_ref);
 // Execute before any decision is refused and has zero side effects.
 await assert.rejects(()=>owner.request('withu:life:execute',{schema_version:1,scope:'comfort',operation_id:block.turn_id}),/life_explicit_decision_required|authorization/);
 let life=(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'}));
 assert.ok(!life.reminders.some(r=>r.text==='明天下午三点提醒我开会'),'no reminder exists before approval');
 // Duplicate confirm on the client is refused locally (createChatActionHandler);
 // on the server, executing twice returns the same receipt without re-running.
 const decide={schema_version:1,scope:'comfort',operation_id:block.turn_id,decision:'allow',explicit_user_allow:true};
 await owner.request('withu:life:decide',decide);
 const receipt=(await owner.request('withu:life:execute',{schema_version:1,scope:'comfort',operation_id:block.turn_id})).receipt;
 assert.equal(receipt.status,'applied');
 assert.equal(receipt.effect_committed,true);
 const receiptAgain=(await owner.request('withu:life:execute',{schema_version:1,scope:'comfort',operation_id:block.turn_id})).receipt;
 assert.equal(receiptAgain.status,receipt.status,'duplicate execute replays the same terminal receipt');
 life=(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'}));
 const reminder=life.reminders.find(r=>r.text==='明天下午三点提醒我开会');
 assert.ok(reminder,'applied reminder exists in life store');
 assert.equal(reminder.due_at,1792998000,'2026-10-26 15:00 Asia/Taipei converted to the correct unix instant');
 assert.equal(reminder.timezone,'Asia/Taipei');
 const decidedMsg=await refreshMessage('comfort',proposeRun.operation_id);
 assert.equal(decidedMsg.blocks[0].payload.decision,'allow','persisted block mirrors the allow decision');
 results.push('proposal -> preview card -> allow -> execute applies once with correct timezone instant');

 // 4. Restart recovery: the reminder survives a server restart.
 await owner.quit();
 owner=new ClientServerOwner(binary,{dataDir:root,test:true});await owner.start();
 life=(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'}));
 assert.ok(life.reminders.some(r=>r.text==='明天下午三点提醒我开会'),'reminder persisted across restart');
 results.push('approved reminder recoverable after server restart');

 // 5. Cancel path: zero side effects, block mirrors deny.
 const cancelRun=await startTool('comfort','再建一个提醒然后取消','tool-reminder');
 await terminal(cancelRun);
 const cancelBlock=pendingBlock((await messages()).find(m=>m.id===cancelRun.operation_id));
 await owner.request('withu:life:cancel',{schema_version:1,scope:'comfort',operation_id:cancelBlock.turn_id});
 const cancelledMsg=await refreshMessage('comfort',cancelRun.operation_id);
 assert.equal(cancelledMsg.blocks[0].payload.decision,'deny','cancel mirrors deny on the block');
 life=(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'}));
 assert.equal(life.reminders.filter(r=>r.text==='明天下午三点提醒我开会').length,1,'cancel created no reminder');
 results.push('cancel has zero side effects and never creates data');

 // 6. Supersede: a second proposal invalidates the first pending card.
 const firstRun=await startTool('comfort','第一次提议','tool-reminder');
 await terminal(firstRun);
 const firstBlock=pendingBlock((await messages()).find(m=>m.id===firstRun.operation_id));
 const secondRun=await startTool('comfort','改成草稿','tool-draft');
 await terminal(secondRun);
 const firstMsg=await refreshMessage('comfort',firstRun.operation_id);
 assert.equal(firstMsg.blocks[0].payload.decision,'expired','superseded card is expired');
 await assert.rejects(()=>owner.request('withu:life:decide',{schema_version:1,scope:'comfort',operation_id:firstBlock.turn_id,decision:'allow',explicit_user_allow:true}),/life_pending_missing/,'old operation no longer decidable');
 const secondMsg=(await messages()).find(m=>m.id===secondRun.operation_id);
 assert.doesNotThrow(()=>pendingBlock(secondMsg),'new proposal carries a fresh pending card');
 results.push('modification supersedes the old card; stale approval can never execute');

 // 7. Natural-language edit: find_text resolves the stored item, versions
 // come from storage, and the change still requires explicit approval.
 const editRun=await startTool('comfort','把提醒改成线上','tool-edit-reminder');
 await terminal(editRun);
 const editMsg=(await messages()).find(m=>m.id===editRun.operation_id);
 const editBlock=pendingBlock(editMsg);
 assert.ok(editBlock.payload.body.includes('开会（改到线上）'),'edit preview shows the new content');
 assert.ok(editBlock.payload.body.includes('提醒我开会'),'edit preview identifies the matched item');
 await owner.request('withu:life:decide',{schema_version:1,scope:'comfort',operation_id:editBlock.turn_id,decision:'allow',explicit_user_allow:true});
 const editReceipt=(await owner.request('withu:life:execute',{schema_version:1,scope:'comfort',operation_id:editBlock.turn_id})).receipt;
 assert.equal(editReceipt.status,'applied');
 life=(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'}));
 assert.ok(life.reminders.some(r=>r.text==='开会（改到线上）'),'edited reminder text stored');
 assert.ok(!life.reminders.some(r=>r.text==='明天下午三点提醒我开会'),'old text replaced');
 results.push('natural-language edit resolves the stored item and still requires approval');

 // 8. Edit with no unique match: honest conversational notice, no approval,
 // no data change.
 const missRun=await startTool('comfort','改一个不存在的','tool-edit-missing');
 await terminal(missRun);
 const missMsg=(await messages()).find(m=>m.id===missRun.operation_id);
 assert.ok(missMsg,'notice message persisted');
 assert.equal(missMsg.blocks.length,1);
 assert.equal(missMsg.blocks[0].kind,'text','zero-match yields a text notice, not an approval');
 assert.ok(missMsg.blocks[0].payload.text.includes('没有找到'),'notice explains the miss honestly');
 assert.equal(missMsg.blocks[0].action_ref,null,'notice carries no action reference');
 life=(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'}));
 assert.equal(life.reminders.filter(r=>r.text==='开会（改到线上）').length,1,'notice changed nothing');
 results.push('unmatched edit asks the user instead of guessing');

 // 9. Read-only retrieval: executes without approval and feeds exactly one
 // bounded follow-up turn; the result JSON travels as data, not authority.
 const wireBefore=wire.length;
 const retrieveRun=await startTool('comfort','帮我找会议纪要','tool-retrieve');
 const r2={operation_id:retrieveRun.operation_id+'#r2'};
 const retrieveDone=await terminal(r2);
 assert.equal(retrieveDone.state,'complete','follow-up turn completes');
 assert.equal(retrieveDone.text,'好的，我在听。','final answer comes from the follow-up model call');
 assert.ok(!(await messages()).some(m=>m.id===retrieveRun.operation_id),'round 1 stays an internal step');
 assert.ok(wire.length-wireBefore>=2,'proposal and follow-up both hit the model');
 const followupBody=wire.slice(wireBefore).find(w=>w.body.messages.some(m=>m.role==='system'&&m.content.includes('Result JSON:')))?.body;
 assert.ok(followupBody,'follow-up request carries the tool result');
 assert.ok(!followupBody.tools,'follow-up turn offers no tools (loop is bounded)');
 const retrieveMsg=(await messages()).find(m=>m.id===r2.operation_id);
 assert.ok(retrieveMsg,'final retrieval answer persisted');
 results.push('local retrieval runs approval-free and answers from one bounded follow-up turn');

 // 10. Content organizing follows the same read-only path.
 const organizeBefore=wire.length;
 const organizeRun=await startTool('comfort','帮我整理这两行','tool-organize');
 const o2={operation_id:organizeRun.operation_id+'#r2'};
 assert.equal((await terminal(o2)).state,'complete');
 const organizeFollowup=wire.slice(organizeBefore).find(w=>w.body.messages.some(m=>m.role==='system'&&m.content.includes('Result JSON:')))?.body;
 assert.ok(organizeFollowup&&!organizeFollowup.tools,'organize follow-up also ends in a text-only turn');
 assert.ok((await messages()).some(m=>m.id===o2.operation_id),'organized answer persisted');
 results.push('content organizing shares the bounded read-only loop');

 // 10.5 T12 stub: web search resolves honestly — no connector configured
 // yields an explicit unconfigured result with empty sources; the follow-up
 // turn must receive that state and never fabricated links.
 const webBefore=wire.length;
 const webRun=await startTool('comfort','帮我上网查一下','tool-web');
 const w2={operation_id:webRun.operation_id+'#r2'};
 assert.equal((await terminal(w2)).state,'complete','web-stub turn completes');
 const webFollowup=wire.slice(webBefore).map(w=>w.body).find(b=>b.messages.some(m=>m.role==='system'&&m.content.includes('Result JSON:')));
 assert.ok(webFollowup,'web stub result reaches the follow-up turn');
 const webResult=webFollowup.messages.find(m=>m.role==='system'&&m.content.includes('Result JSON:')).content;
 assert.ok(webResult.includes('"unconfigured"')&&webResult.includes('"sources":[]'),'unconfigured state and empty sources are explicit');
 assert.ok(!/"uri":\s*"http/.test(webResult),'no fabricated source links');
 results.push('web search stub reports unconfigured honestly with no fabricated sources');

 // 11. Invalid proposals fail honestly: no card, no data, real reason.
 for(const [scenario] of [['tool-bad-offset'],['tool-bad-zone'],['tool-unknown']]){
  const badRun=await startTool('comfort','无效提议 '+scenario,scenario);
  const bad=await terminal(badRun);
  assert.equal(bad.state,'failed');
  assert.equal(bad.code,'tool_arguments_invalid',scenario+' must fail with the honest validation code');
  assert.ok(!(await messages()).some(m=>m.id===badRun.operation_id),'failed proposal persists no assistant message');
 }
 life=(await owner.request('withu:life:list',{schema_version:1,scope:'comfort'}));
 assert.equal(life.reminders.length,1,'invalid proposals created nothing beyond the approved one');
 assert.ok(!JSON.stringify(owner.wire).includes(key),'no credential material in any event');
 results.push('offset/unknown-timezone/unknown-tool proposals rejected honestly with zero persistence');

 await writeFile(path.join(root,'results.json'),JSON.stringify({success:true,results,fixture:'local SSE fixture, not a real cloud model',requests:wire.length,root},null,2));
 console.log('PASS '+results.length+' chat tool-proposal wire checks\nEvidence '+root);
}finally{if(owner&&!owner.exitResult)await owner.forceStop();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
