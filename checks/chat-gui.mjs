// GUI regression for the chat surface (P5.3): a real Electron window, a real
// server, a scripted SSE fixture — and no dependency on a leftover profile.
//
// Bootstrap choice (C): the provider is written through the app's own
// `withu:config:update` IPC from the renderer bridge, i.e. the exact channel
// the settings page uses. That keeps the data directory fresh (so assertions
// cannot be satisfied by yesterday's messages) without driving DOM controls.
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require=createRequire('D:/ccc2/Desktop/ai/withu/WithU-0.3.1go4/package.json');
const WebSocket=require('ws');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=path.resolve('.');
const out=path.resolve('output/p4/chat-gui');
await mkdir(out,{recursive:true});
const data=await mkdtemp(path.join(out,'profile-'));
const key='FICTIONAL-GUI-ONLY-'+crypto.randomUUID();
const wire=[];
const frame=delta=>`data: ${JSON.stringify({choices:[{delta}]})}\n\n`;
const toolFrame=(name,args)=>[
 `data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call_'+Math.random().toString(36).slice(2,8),type:'function',function:{name,arguments:''}}]}}]})}\n\n`,
 `data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{arguments:JSON.stringify(args)}}]}}]})}\n\n`,
];
// Fixture behaviour is keyed on what the user said, not on a global mode: two
// GUI turns run concurrently with the app's own title-generation request.
const plan=text=>{
 if(text.includes('提醒我'))return 'tool';
 if(text.includes('记住')||text.includes('偏好'))return 'text';
 return 'text';
};
const due=(offsetDays,hour)=>{
 const now=new Date(Date.now()+8*3600000);
 const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+offsetDays));
 const p=n=>String(n).padStart(2,'0');
 return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}T${p(hour)}:00:00`;
};
const server=http.createServer(async(req,res)=>{
 let raw='';
 for await(const chunk of req)raw+=chunk;
 const url=req.url.startsWith('http')?new URL(req.url).pathname:req.url;
 assert.ok(url==='/v1/chat/completions'||url==='/v1/models','unexpected provider path '+url);
 if(url==='/v1/models'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'gui-model'}]}));return;}
 const body=JSON.parse(raw);
 wire.push({url,body});
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const user=[...body.messages].reverse().find(m=>m.role==='user');
 const text=user?.content||'';
 if(plan(text)==='tool'&&body.tools?.some(t=>t.function?.name==='create_local_reminder')){
  for(const chunk of toolFrame('create_local_reminder',{text:'开会',due_at_local:due(1,15),timezone:'Asia/Shanghai'}))res.write(chunk);
  res.write(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'tool_calls'}]})}\n\n`);
  res.end('data: [DONE]\n\n');
  return;
 }
 res.write(frame({content:'好的，我在听。'}));
 res.write(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\n`);
 res.end('data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;

const port=9300+Math.floor(Math.random()*400);
const env={...process.env,WITHU_DEV_DATA:data};
delete env.ELECTRON_RUN_AS_NODE;
const flags=['.','--withu-dev-data',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu-sandbox','--disable-gpu'];
const app=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),flags,{cwd:root,env,stdio:['ignore','pipe','pipe']});
let stderr='',stdout='';
app.stderr.on('data',chunk=>{stderr+=chunk;});
app.stdout.on('data',chunk=>{stdout+=chunk;});
let socket=null,msgId=0;
const pending=new Map();
const cdp=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++msgId;
 const timer=setTimeout(()=>{pending.delete(id);reject(new Error('cdp timeout '+method));},15000);
 pending.set(id,{resolve,reject,timer});
 socket.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=>{
 const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
 if(result.exceptionDetails)throw new Error('eval failed: '+(result.exceptionDetails.exception?.description||result.exceptionDetails.text));
 return result.result?.value;
};
const results=[];
let body='';
try{
 for(let i=0;i<80;i++){
  try{
   const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
   const page=list.find(t=>t.type==='page'&&/withu|index\.html/i.test(t.title+t.url));
   if(page){socket=new WebSocket(page.webSocketDebuggerUrl,{maxPayload:256*1024*1024});break;}
  }catch{}
  await sleep(250);
 }
 assert.ok(socket,'devtools page never appeared');
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 socket.on('message',raw=>{
  const message=JSON.parse(raw.toString());
  if(message.id&&pending.has(message.id)){
   const {resolve,reject,timer}=pending.get(message.id);
   pending.delete(message.id);
   clearTimeout(timer);
   message.error?reject(new Error(message.error.message)):resolve(message.result);
  }
 });
 await cdp('Runtime.enable');

 // 1. A fresh profile must really be fresh, or every later assertion is hollow.
 let config=null;
 for(let i=0;i<80;i++){
  const ready=await evaluate(`(async()=>{if(!window.withuDesktop)return 'no-bridge';const r=await window.withuDesktop.configGet().catch(()=>null);return r?'ok':'no-config';})()`).catch(()=>null);
  if(ready==='ok'){config=await evaluate(`(async()=>(await window.withuDesktop.configGet()).config)()`);break;}
  await sleep(250);
 }
 assert.ok(config,'renderer bridge never became ready');
 assert.ok(!config.model_overrides?.llm?.model_ref,'fresh profile must not already have a text model');
 results.push('fresh profile confirmed before configuring anything');

 // 2. Configure through the renderer's own authorised IPC (same as settings).
 const expected=config.config_version;
 config.config_version=expected+1;
 config.providers=[{provider_id:'gui',service:'llm',endpoint,protocol:'openai-compatible',capabilities:[]}];
 config.defaults={...(config.defaults||{}),llm:'gui'};
 config.model_overrides={...(config.model_overrides||{}),llm:{provider_ref:'gui',model_ref:'gui-model'}};
 await evaluate(`(async()=>{await window.withuDesktop.configUpdate(${JSON.stringify({schema_version:1,expected_version:expected,config,credential_changes:[{provider_id:'gui',action:'replace',value:key}]})});return 'ok';})()`);
 const after=await evaluate(`(async()=>(await window.withuDesktop.configGet()).config)()`);
 assert.equal(after.model_overrides?.llm?.model_ref,'gui-model','configuration is committed and readable back');
 results.push('provider configured through withu:config:update, verified by read-back');

 // 3. Send a message: no white screen, reply appears, soul body reached the model.
 const waitComposer=async()=>{
  for(let i=0;i<80;i++){
   const ready=await evaluate(`Boolean(document.querySelector('textarea')&&document.querySelector('button.send-button'))`).catch(()=>false);
   if(ready)return;
   await sleep(250);
  }
  throw new Error('composer never appeared; body='+(await evaluate('document.body.innerText')).slice(-400));
 };
 const type=async text=>{
  await waitComposer();
  // React must commit the input event before the key handler reads the draft,
 // otherwise send() sees an empty composer and silently does nothing.
 const how=await evaluate(`(async()=>{const el=document.querySelector('textarea');if(!el)return 'NOEL';const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();await new Promise(r=>setTimeout(r,150));const send=document.querySelector('button.send-button');if(send&&!send.disabled){send.click();return 'clicked';}el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));return 'enter';})()`);
 assert.notEqual(how,'NOEL','composer textarea must exist');
 };
 const text=async()=>evaluate('document.body.innerText');
 const until=async(predicate,label,ms=12000)=>{
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
   if(await predicate())return;
   await sleep(200);
  }
  const count=await evaluate(`(async()=>{try{const l=await window.withuDesktop.messageList({conversation_id:'x'});return l.items?.length??-1;}catch(e){return 'err:'+e.message;}})()`).catch(()=>null);
  throw new Error('timeout '+label+'\nwire='+wire.length+' messages='+count+'\nbody: '+(await text()).slice(-600)+'\nevents: '+stdout.slice(-900));
 };

 await type('你好');
 await until(async()=>(await text()).includes('好的，我在听。'),'first reply');
 assert.ok(await evaluate(`document.querySelector('#root')?.children.length>0`),'root stays populated (no white screen)');
 assert.ok(wire.length>0,'the model was actually called');
 const system=wire[0].body.messages.find(m=>m.role==='system')?.content||'';
 assert.ok(system.includes('以上是你的灵魂文档'),'soul body is injected into the real request');
 results.push('first turn renders without a white screen and carries the soul prompt');

 // 4. Proposal card reaches its terminal state on click (BUG-3 regression).
 await type('明天下午三点提醒我开会');
 await until(async()=>(await text()).includes('允许一次'),'approval card');
 assert.ok((await text()).includes('创建本地提醒'),'card title is localised');
 await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='允许一次');if(!b)return 'NOBTN';b.click();return 'ok';})()`);
 await until(async()=>(await text()).includes('已允许'),'allowed state');
 const buttons=await evaluate(`[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(x=>x==='允许一次').length`);
 assert.equal(buttons,0,'the approve button disappears in the terminal state');
 results.push('proposal card: appears, localised, and flips to a terminal state on click');

 // 5. Memory candidate capsule (BUG-2 regression), still without a reload.
 await type('我偏好安静的工作环境。');
 await until(async()=>(await text()).includes('要记住这条吗'),'memory candidate capsule');
 results.push('memory candidate capsule appears for an explicit preference');
}catch(error){
 console.error('server/electron stderr tail:\n'+stderr.slice(-1200));
 throw error;
}finally{
 socket?.close();
 // Kill only the tree this check started; never by image name, which would
 // also close a window the user is working in.
 await new Promise(resolve => {
  const kill = spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  kill.once('exit', resolve);
  kill.once('error', () => { try { app.kill(); } catch {} resolve(); });
 });
 server.close();
}
console.log('PASS chat gui ('+results.length+'):\n'+results.map(r=>' - '+r).join('\n'));
