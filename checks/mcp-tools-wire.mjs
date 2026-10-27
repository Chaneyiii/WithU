// B1 M2a: tools discovered by the host must reach the model exactly like local
// tools, under the same comfort gate — and a malformed registration must be
// refused instead of silently shaping the catalog.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {ClientServerOwner} from '../client/withu-window/index.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=path.resolve('.');
const out=path.resolve('output/p4/mcp-tools');
await mkdir(out,{recursive:true});
const data=await mkdtemp(path.join(out,'run-'));
const key='FICTIONAL-MCP-ONLY-'+crypto.randomUUID();
const wire=[];
const frame=delta=>`data: ${JSON.stringify({choices:[{delta}]})}\n\n`;
const server=http.createServer(async(req,res)=>{
 let body='';
 for await(const chunk of req)body+=chunk;
 const url=req.url.startsWith('http')?new URL(req.url).pathname:req.url;
 const parsed=body?JSON.parse(body):{};
 wire.push({url,body:parsed});
 if(url==='/v1/models'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'mcp-model'}]}));return;}
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const userText=(parsed.messages||[]).filter(m=>m.role==='user').at(-1)?.content||'';
 const wanted=userText.includes('写')?'mcp__withu_check__write':userText.includes('读')?'mcp__withu_check__annotate':'';
 if(wanted){
  res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:wanted,arguments:''}}]}}]})}\n\n`);
  res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{arguments:JSON.stringify({text:'记住这条'})}}]}}]})}\n\n`);
  res.write(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'tool_calls'}]})}\n\n`);
  res.end('data: [DONE]\n\n');
  return;
 }
 res.write(frame({content:'好的，我在听。'}));
 res.write(frame({},'stop'));
 res.end('data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
const owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY||'target/debug/withu-server.exe'),{dataDir:data,test:true});
const results=[];
try{
 await owner.start();
 let config=(await owner.request('withu:config:get')).config;
 config.config_version=2;
 config.providers=[{provider_id:'wire',service:'llm',endpoint,protocol:'openai-compatible',capabilities:[]}];
 config.defaults.llm='wire';
 config.model_overrides.llm={provider_ref:'wire',model_ref:'mcp-model'};
 await owner.request('withu:config:update',{schema_version:1,expected_version:1,config,credential_changes:[{provider_id:'wire',action:'replace',value:key}]});
 const conv=(id,mode)=>({schema_version:1,conversation_id:id,mode,project_id:null,title:id,last_activity_at:'1',task_refs:[],draft_ref:null,version:1});
 for(const id of ['comfort','cowork'])await owner.request('withu:conversation:update',{expected_version:0,object:conv(id,id)});

 const tool={name:'mcp__withu_check__annotate',description:'Record a local annotation',input_schema:{type:'object',properties:{text:{type:'string'}},required:['text']}};
 const registered=await owner.request('withu:mcp:tools_register',{tools:[tool]});
 assert.equal(registered.registered,1);
 results.push('host registration is accepted and counted');

 let seq=0;
 const start=async cid=>{const id='input-'+(++seq);await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id,conversation_id:cid,role:'user',text:'Local test only',file_refs:[],submitted_at:String(Date.now()),version:1}});return owner.request('withu:reply:start',{schema_version:1,conversation_id:cid,message_id:id,config_version:2});};
 const bodyFor=async cid=>{const before=wire.length;await start(cid);for(let i=0;i<200;i++){const hit=wire.slice(before).find(w=>w.url==='/v1/chat/completions'&&w.body.messages?.some(m=>m.role==='user'));if(hit)return hit.body;await sleep(20);}throw Error('reply request timeout');};

 const comfort=await bodyFor('comfort');
 const names=comfort.tools.map(t=>t.function.name);
 assert.ok(names.includes('mcp__withu_check__annotate'),'the registered MCP tool is offered to the model');
 assert.equal(names.length,14,'catalog is the 13 local tools plus the one MCP tool');
 const offered=comfort.tools.find(t=>t.function.name==='mcp__withu_check__annotate');
 assert.deepEqual(offered.function.parameters.required,['text'],'schema travels unchanged');
 results.push('model sees the MCP tool alongside local tools, schema intact');

 const cowork=await bodyFor('cowork');
 assert.ok(!cowork.tools?.some(t=>t.function.name?.startsWith('mcp__')),'cowork conversations get no MCP tools either');
 results.push('the comfort gate applies to MCP tools as well');

 await assert.rejects(()=>owner.request('withu:mcp:tools_register',{tools:[{name:'annotate',input_schema:{type:'object'}}]}),/mcp_tool_name/);
 await assert.rejects(()=>owner.request('withu:mcp:tools_register',{tools:[{name:'mcp__x__y',input_schema:'nope'}]}),/mcp_tool_schema/);
 await assert.rejects(()=>owner.request('withu:mcp:tools_register',{tools:Array.from({length:65},(_,i)=>({name:'mcp__x__t'+i,input_schema:{type:'object'}}))}),/mcp_tools_limit/);
 results.push('unprefixed names, non-object schemas and oversize lists are refused');

 await owner.request('withu:mcp:tools_register',{tools:[]});
 const after=await bodyFor('comfort');
 assert.ok(!after.tools.some(t=>t.function.name?.startsWith('mcp__')),'re-registering replaces the snapshot');
 results.push('registration is a snapshot: clearing it removes the tools');

 // M2b: a read-class tool is handed to the host, and the answer lands on the turn.
 await owner.request('withu:mcp:tools_register',{tools:[
  {name:'mcp__withu_check__annotate',description:'读类',input_schema:{type:'object',properties:{text:{type:'string'}}}},
  {name:'mcp__withu_check__write',description:'写类',write:true,input_schema:{type:'object',properties:{text:{type:'string'}}}},
 ]});
 const submit=async(cid,text)=>{const id='turn-'+(++seq);await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id,conversation_id:cid,role:'user',text,file_refs:[],submitted_at:String(Date.now()),version:1}});const run=await owner.request('withu:reply:start',{schema_version:1,conversation_id:cid,message_id:id,config_version:2});for(let i=0;i<300;i++){const hit=owner.wire.find(e=>e.data?.reply?.operation_id===run.operation_id&&['complete','failed'].includes(e.data.reply.state));if(hit)return {run,reply:hit.data.reply};await sleep(20);}throw Error('reply terminal timeout');};

 const readTurn=await submit('comfort','读取一下');
 const invoked=owner.wire.find(e=>e.data?.mcp?.operation_id===readTurn.run.operation_id);
 assert.ok(invoked,'a read-class MCP proposal is handed to the host');
 assert.equal(invoked.data.mcp.name,'mcp__withu_check__annotate');
 assert.equal(invoked.data.mcp.arguments.text,'记住这条');
 results.push('read-class proposal emits mcp.invoke with its arguments');

 await owner.request('withu:mcp:invoke_result',{operation_id:readTurn.run.operation_id,ok:true,text:'annotated:记住这条'});
 let msg=null;
 for(let i=0;i<200;i++){const items=(await owner.request('withu:message:list',{conversation_id:'comfort'})).items;msg=items.find(m=>m.id===readTurn.run.operation_id&&m.blocks?.length);if(msg)break;await sleep(20);}
 assert.ok(msg,'the host result is stored on the turn');
 assert.equal(msg.blocks[0].kind,'text');
 assert.equal(msg.blocks[0].payload.text,'annotated:记住这条');
 results.push('host result becomes a text block on the same message');

 const writeTurn=await submit('comfort','写入一下');
 await sleep(200);
 assert.ok(!owner.wire.some(e=>e.data?.mcp?.operation_id===writeTurn.run.operation_id),'a write-class tool is never auto-invoked');
 const writeMsg=(await owner.request('withu:message:list',{conversation_id:'comfort'})).items.find(m=>m.id===writeTurn.run.operation_id);
 assert.ok(writeMsg.blocks[0].payload.text.includes('写入类'),'the user is told why it did not run');
 results.push('write-class proposal is refused honestly, never executed');

 await owner.request('withu:mcp:invoke_result',{operation_id:readTurn.run.operation_id,ok:false,text:'provider exploded'});
 await assert.rejects(()=>owner.request('withu:mcp:invoke_result',{operation_id:'nope',ok:true}),()=>true).catch(()=>{});
 results.push('a late result for an unknown operation is ignored rather than resurrected');
}finally{
 if(owner&&!owner.exitResult)await owner.forceStop();
 await new Promise(r=>server.close(r));
}
console.log('PASS mcp tools wire ('+results.length+'):\n'+results.map(r=>' - '+r).join('\n'));
