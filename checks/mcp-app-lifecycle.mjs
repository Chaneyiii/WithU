// M4 (T16-B lifecycle): hiding the page must release the inline MCP App, and
// showing it again must rebuild the session.
//
// What is real here: the app, the Rust server, the MCP server (a stdio fixture),
// the tool call round trip, the App document read by the host, the inline host
// in the message, and Chromium's own page-hidden lifecycle.
// What is simulated: the "hide" is `Page.setWebLifecycleState('frozen')` rather
// than a real OS minimize, because Electron 44 does not expose
// `Browser.getWindowForTarget` and the app has no window-control IPC. That still
// drives the exact code path (`visibilitychange` → pageHidden), so the release
// and rebuild logic is exercised for real. The physical minimize stays a manual
// step in manual-verification-2026-10-27.md.
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
const out=path.resolve('output/p4/mcp-lifecycle');
await mkdir(out,{recursive:true});
const data=await mkdtemp(path.join(out,'profile-'));
const key='FICTIONAL-M4-'+crypto.randomUUID();
const frame=delta=>`data: ${JSON.stringify({choices:[{delta}]})}\n\n`;
const seen=[];

// The model fixture answers one thing: "读…" means call the MCP tool.
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const url=req.url.startsWith('http')?new URL(req.url).pathname:req.url;
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 if(url!=='/v1/chat/completions'){res.end();return;}
 const body=JSON.parse(raw);
 seen.push({model:body.model,tools:(body.tools||[]).map(t=>t.function?.name),user:(body.messages||[]).find(m=>m.role==='user')?.content?.slice(0,40)});
 const user=[...body.messages].reverse().find(m=>m.role==='user');
 const text=user?.content||'';
 if(text.includes('读')&&body.tools?.some(t=>t.function?.name==='mcp__local__annotate')){
  res.write(frame({content:'我去读一下。'}));
  res.write(frame({tool_calls:[{index:0,id:'c1',type:'function',function:{name:'mcp__local__annotate',arguments:''}}]}));
  res.write(frame({tool_calls:[{index:0,function:{arguments:JSON.stringify({text:'记住这条'})}}]}));
  res.end(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  return;
 }
 res.write(frame({content:'好的，我在听。'}));
 res.end(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const endpoint=`http://127.0.0.1:${server.address().port}/v1`;

const port=9700+Math.floor(Math.random()*200);
const env={...process.env,WITHU_FIXTURE_MODEL:'off',WITHU_DEV_DATA:data,
 WITHU_MCP_COMMAND:'node',WITHU_MCP_ARGS:'checks/fixtures/mcp-app-server.mjs',WITHU_MCP_SERVER:'local'};
delete env.ELECTRON_RUN_AS_NODE;
const app=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),
 ['.','--withu-dev-data',`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu-sandbox','--disable-gpu'],
 {cwd:root,env,stdio:['ignore','pipe','pipe']});
let stderr='';
app.stderr.on('data',chunk=>{stderr+=chunk;});

let socket=null,msgId=0;
const pending=new Map();
const cdp=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++msgId;
 const timer=setTimeout(()=>{pending.delete(id);reject(new Error('cdp timeout '+method));},20000);
 pending.set(id,{resolve,reject,timer});
 socket.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=>{
 const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
 if(result.exceptionDetails)throw new Error('eval failed: '+(result.exceptionDetails.exception?.description||result.exceptionDetails.text));
 return result.result?.value;
};
const results=[];
 let appProbe=null;
try{
 for(let i=0;i<100;i++){
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
  if(message.method==='Runtime.exceptionThrown'){
   const d=message.params?.exceptionDetails;
   console.error('RENDERER EXCEPTION:',d?.exception?.description||d?.text);
  }
  if(message.method==='Runtime.consoleAPICalled'&&message.params?.type==='error'){
   console.error('RENDERER console.error:',(message.params.args||[]).map(a=>a.value??a.description).join(' ').slice(0,600));
  }
  if(message.id&&pending.has(message.id)){
   const {resolve,reject,timer}=pending.get(message.id);
   pending.delete(message.id);
   clearTimeout(timer);
   message.error?reject(new Error(message.error.message)):resolve(message.result);
  }
 });
 await cdp('Runtime.enable');
 // The App lives in a sandboxed iframe (opaque origin): the page cannot read it,
 // but CDP can evaluate inside its execution context. Needed to tell "app script
 // never ran" apart from "app ran and failed the handshake".
 const contexts=[];
 socket.on('message',raw=>{
  try{const m=JSON.parse(raw.toString());if(m.method==='Runtime.executionContextCreated')contexts.push(m.params.context);}catch{}
 });

 // 1. The App only shows up if the host read the resource the server declared:
 //    that is the B1 wiring this check also guards.
 // Wait for a *complete* config, not merely a resolved promise: right after the
 // window opens the bridge can answer with an empty object.
 const configExpr="(async()=>{if(!window.withuDesktop)return null;try{const r=await window.withuDesktop.configGet();if(!r)return {shape:'null-result'};if(!r.config)return {shape:'no-config-key',keys:Object.keys(r)};return r.config;}catch(e){return {shape:'rejected',error:String(e&&e.message)};}})()";
 let config=null;
 for(let i=0;i<100;i++){
  config=await evaluate(configExpr).catch(()=>null);
  if(config&&Number.isInteger(config.schema_version)&&Number.isInteger(config.config_version))break;
  config=null;
  await sleep(250);
 }
 assert.ok(config,'renderer bridge never returned a complete config');
 const expected=config.config_version;
 config.config_version=expected+1;
 config.providers=[{provider_id:'m4',service:'llm',endpoint,protocol:'openai-compatible',capabilities:[]}];
 config.defaults={...(config.defaults||{}),llm:'m4'};
 config.model_overrides={...(config.model_overrides||{}),llm:{provider_ref:'m4',model_ref:'m4-model'}};
 const updatePayload={schema_version:1,expected_version:expected,config,credential_changes:[{provider_id:'m4',action:'replace',value:key}]};
 const updateResult=await evaluate(`(async()=>{try{await window.withuDesktop.configUpdate(${JSON.stringify(updatePayload)});return 'ok';}catch(e){return 'ERR '+e.message+' payload='+${JSON.stringify(JSON.stringify({version:updatePayload.config.config_version,providers:updatePayload.config.providers,defaults:updatePayload.config.defaults,overrides:updatePayload.config.model_overrides,keys:Object.keys(updatePayload.config)}))};}})()`);
 assert.equal(updateResult,'ok','configuration update failed: '+updateResult);

 const waitComposer=async()=>{
  for(let i=0;i<100;i++){
   if(await evaluate(`Boolean(document.querySelector('textarea')&&document.querySelector('button.send-button'))`).catch(()=>false))return;
   await sleep(250);
  }
  throw new Error('composer never appeared');
 };
 const type=async text=>{
  await waitComposer();
  await evaluate(`(async()=>{const el=document.querySelector('textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();await new Promise(r=>setTimeout(r,150));const send=document.querySelector('button.send-button');if(send&&!send.disabled){send.click();return 'clicked';}el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));return 'enter';})()`);
 };
 const body=async()=>evaluate('document.body.innerText');
 const frames=async()=>evaluate(`document.querySelectorAll('.withu-mcp-frame iframe').length`);
 // Runtime Apps are loaded from a blob: URL (srcdoc would inherit the host CSP),
 // so the document can be in either attribute.
 const srcdoc=async()=>evaluate(`(()=>{const f=document.querySelector('.withu-mcp-frame iframe');if(!f)return 0;return (f.getAttribute('srcdoc')||'').length||(f.getAttribute('src')||'').length||0;})()`);
 // Presence of an iframe is not proof of a working App: a static page also mounts
 // one and then times out at the handshake (seen on a real run 2026-10-28).
 const statusText=async()=>evaluate(`[...document.querySelectorAll('.withu-mcp-inline-status')].map(n=>n.textContent).join(' | ')`);
 // Sandboxed srcdoc iframes are out-of-process, so they show up as their own
 // CDP target instead of an execution context of the page.
 // Evaluate inside every execution context: the App may be an out-of-process
 // frame (own target) or share the page's process (extra context).
 const appState=async()=>{
  const out=[];
  for(const ctx of contexts){
   try{
    const r=await cdp('Runtime.evaluate',{expression:"JSON.stringify({state:(document.getElementById('state')||{}).textContent||null,head:(document.documentElement&&document.documentElement.outerHTML||'').slice(0,80)})",contextId:ctx.id,returnByValue:true});
    out.push({id:ctx.id,origin:ctx.origin,name:ctx.name||'',value:r.result?.value});
   }catch(error){out.push({id:ctx.id,error:String(error.message).slice(0,60)});}
  }
  return out;
 };
 const until=async(predicate,label,ms=20000)=>{
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
   if(await predicate())return;
   await sleep(250);
  }
  const diag=await evaluate(`JSON.stringify({frames:document.querySelectorAll('.withu-mcp-frame iframe').length,hosts:document.querySelectorAll('.withu-mcp-host').length,status:[...document.querySelectorAll('.withu-mcp-inline-status,.withu-mcp-curtain-status')].map(n=>n.textContent),vis:document.visibilityState})`).catch(()=>'diag failed');
  throw new Error('timeout '+label+'\napp: '+JSON.stringify(appProbe)+'\nseen: '+JSON.stringify(seen).slice(-400)+'\ndiag: '+diag+'\nbody: '+(await body()).slice(-300)+'\nstderr: '+stderr.slice(-600));
 };

 await type('读一下本地记录');
 await until(async()=>(await body()).includes('annotated:记住这条'),'MCP tool result in the message');
 await until(async()=>(await frames())===1,'inline MCP App iframe');
 assert.ok((await srcdoc())>0,'the iframe really carries the App document');
 // Sample the App's own state before the 10s host timeout tears the frame down.
 await sleep(1500);
 appProbe=await appState().catch(()=>null);
 await until(async()=>(await statusText()).includes('已连接'),'App handshake completes');
 assert.ok(!(await statusText()).includes('超时'),'the host must not end in a handshake timeout');
 results.push('a real MCP tool call renders its App inline and the bridge connects');

 // 2. Page hidden -> the App session is released; page visible again -> rebuilt.
 //    Chromium defers React's commit while the page is frozen, so the DOM churn
 //    is observed right after the page thaws. A MutationObserver records the
 //    frame count timeline, which proves the sequence instead of guessing.
 await evaluate(`(()=>{window.__m4=[];const rec=()=>window.__m4.push({t:Date.now(),n:document.querySelectorAll('.withu-mcp-frame iframe').length});rec();window.__m4obs=new MutationObserver(rec);window.__m4obs.observe(document.body,{childList:true,subtree:true});return 1;})()`);
 assert.equal(await evaluate('document.visibilityState'),'visible');
 await cdp('Page.setWebLifecycleState',{state:'frozen'});
 await sleep(1500);
 assert.equal(await evaluate('document.visibilityState'),'hidden','the page really reports itself hidden');
 await cdp('Page.setWebLifecycleState',{state:'active'});
 await cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
 await until(async()=>(await evaluate('document.visibilityState'))==='visible','page visible again');
 await until(async()=>{
  const seen=await evaluate('window.__m4.map(x=>x.n)');
  const now=await frames();
  return seen.includes(0)&&now===1;
 },'release then rebuild');
 const timeline=await evaluate('window.__m4.map(x=>x.n)');
 assert.ok(timeline.includes(0),'the App frame was removed while hidden (timeline '+JSON.stringify(timeline)+')');
 assert.ok((await frames())===1,'the frame is back after returning');
 assert.ok((await srcdoc())>0,'the rebuilt iframe carries the App document again');
 await until(async()=>(await statusText()).includes('已连接'),'rebuilt App handshakes too');
 results.push('the rebuilt App connects, not just renders');
 results.push('hiding the page releases the App session; returning rebuilds it');
}catch(error){
 console.error('electron stderr tail:\n'+stderr.slice(-1200));
 throw error;
}finally{
 socket?.close();
 await new Promise(resolve=>{
  const kill=spawn('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  kill.once('exit',resolve);
  kill.once('error',()=>{try{app.kill();}catch{}resolve();});
 });
 server.close();
}
console.log('PASS mcp app lifecycle ('+results.length+'):\n'+results.map(r=>' - '+r).join('\n'));
