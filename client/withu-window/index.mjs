import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const dir=new URL('../../contracts/v1/',import.meta.url), ajv=new Ajv2020({strict:false});
for(const file of readdirSync(dir).filter(f=>f.endsWith('.schema.json'))){const schema=JSON.parse(readFileSync(new URL(file,dir)));const resolveRefs=value=>{if(!value||typeof value!=='object')return;if(value.$ref)value.$ref='withu://contracts/v1/'+value.$ref.replace('./','').replace('.schema.json','');for(const child of Object.values(value))resolveRefs(child);};resolveRefs(schema);ajv.addSchema(schema,file);}
const valid=(name,value)=>ajv.validate(name+'.schema.json',value);
export const runtimeConfig=Object.freeze({startupDeadlineMs:10000,requestDeadlineMs:6000,shutdownDeadlineMs:3500,forcedExitDeadlineMs:2000});
const RETAINED_EVENT_LIMIT=512;
const AUDIO_FIELDS=new Set(['audio_base64','samples','audio']);
function withoutRawAudio(value,key=''){
 if(AUDIO_FIELDS.has(key))return undefined;
 if(Array.isArray(value))return value.map(item=>withoutRawAudio(item)).filter(item=>item!==undefined);
 if(value&&typeof value==='object'){
  const clean={};for(const [name,item] of Object.entries(value)){const safe=withoutRawAudio(item,name);if(safe!==undefined)clean[name]=safe;}return clean;
 }
 return value;
}
export class ClientServerOwner extends EventEmitter {
 constructor(executable,options={}){super();this.executable=executable;this.options=typeof options==='number'?{requestDeadlineMs:options}:options;this.config={...runtimeConfig,...this.options};this.session=randomUUID();this.events=[];this.wire=[];this.pending=new Map();this.waiters=[];this.stderr='';this.accepting=true;this.lastSequence=0;}
 get eventCursor(){return this.lastSequence;}
 eventsSince(after=0){return this.events.filter(e=>e.sequence>after);}
 async start(){if(this.child)throw new Error('server already owned');this.child=spawn(this.executable,[],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,WITHU_CLIENT_SESSION:this.session,...(this.options.dataDir?{WITHU_DATA_DIR:this.options.dataDir}:{}),WITHU_FAKE_SPEECH_MODE:this.options.fakeSpeech?'1':'0',...(this.options.test?{WITHU_TEST_MODE:'1'}:{}),...(this.options.testStart?{WITHU_TEST_START:this.options.testStart}:{})}});
 this.child.stderr.on('data',b=>{this.stderr=(this.stderr+b).slice(-8192);});this.child.stdin.on('error',e=>this.fail(e));
 this.exited=new Promise(resolve=>{this.child.once('error',error=>{this.fail(error);resolve({code:null,error:error.message});});this.child.once('exit',(code,signal)=>{this.exitResult={code,signal};this.fail(new Error('server exited: '+code));resolve(this.exitResult);});});
 // A single frame can legitimately carry an MCP App document (contract allows
 // app.html up to 1 MiB); JSON escaping ~doubles it and message:list batches many
 // messages, so 1 MiB was too tight and broke message:list (measured 2026-10-29).
 createInterface({input:this.child.stdout,crlfDelay:Infinity}).on('line',line=>{try{if(line.length>8388608)throw new Error('server frame too large');const m=JSON.parse(line);this.receive(m);}catch(e){this.fail(new Error('malformed server stdout: '+e.message));void this.forceStop();}});
 try {this.ready=await this.waitFor('server.ready',0,this.config.startupDeadlineMs);return this.ready;}catch(e){await this.forceStop();throw e;}
 }
 receive(m){const type=m.record?'event-envelope':m.error?'error-response':'response';if(!valid(type,m)||m.client_session_id!==this.session)throw new Error('envelope validation');const seq=m.record?.sequence??m.sequence;if(seq<=this.lastSequence)throw new Error('nonmonotonic sequence');this.lastSequence=seq;
 if(m.data?.status&&!valid('server',m.data.status)||m.result?.status&&!valid('server',m.result.status)||m.data?.shutdown&&!valid('shutdown',m.data.shutdown)||m.result?.shutdown&&!valid('shutdown',m.result.shutdown))throw new Error('domain schema');
 if(m.data?.speech&&!valid('speech-update',m.data.speech)||m.result?.speech_session&&!valid('speech-session',m.result.speech_session))throw new Error('speech domain schema');
 const responseChannel=this.pending.get(m.request_id)?.channel;
 if(responseChannel==='withu:affect:plan'&&m.result&&(!valid('support-plan',m.result.plan)||!valid('affect-hypothesis',m.result.hypothesis)))throw new Error('support domain schema');
 const actionDomain=Boolean(responseChannel?.startsWith('withu:action:'))||responseChannel==='withu:affect:plan',lifeDomain=Boolean(responseChannel?.startsWith('withu:life:'));if(lifeDomain&&m.result&&(responseChannel==='withu:life:prepare'&&!(typeof m.result.operation_id==='string'&&m.result.plan&&m.result.approval&&m.result.approval.approval_id)||responseChannel==='withu:life:execute'&&!(m.result.receipt&&typeof m.result.receipt.status==='string')))throw new Error('life domain schema');if(actionDomain&&((responseChannel==='withu:action:preview'||m.result?.plan&&responseChannel!=='withu:affect:plan')&&m.result&&!valid('action-preview-response',m.result)||m.result?.approval&&!valid('approval-card',m.result.approval)||m.result?.receipt&&!valid('action-receipt',m.result.receipt)))throw new Error('action domain schema');
 if(m.result?.annotation&&!valid('local-annotation',m.result.annotation))throw new Error('annotation domain schema');
 const retained=withoutRawAudio(m);this.wire.push(retained);if(this.wire.length>3000)this.wire.shift();
 if(m.record){const safeData=retained.data;const normalized={...m.record,...safeData,...(safeData.status||{}),...(safeData.shutdown||{})};this.events.push(normalized);if(this.events.length>RETAINED_EVENT_LIMIT)this.events.shift();this.emit('event',m);for(const w of [...this.waiters])if(w.name===normalized.event&&seq>w.after){this.waiters.splice(this.waiters.indexOf(w),1);clearTimeout(w.timer);w.resolve(normalized);}}
 else {const p=this.pending.get(m.request_id);if(!p)return;this.pending.delete(m.request_id);clearTimeout(p.timer);if(m.error){const e=new Error(m.error.code);e.category=m.error.category;e.code=m.error.code;p.reject(e);}else p.resolve(m.result);}
 }
 fail(error){this.failure=error;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();for(const w of this.waiters){clearTimeout(w.timer);w.reject(error);}this.waiters=[];this.emit('status',{lifecycle:'failed',reason:error.message});}
 waitFor(name,after=0,deadline=this.config.requestDeadlineMs){const found=this.eventsSince(after).find(e=>e.event===name);if(found)return Promise.resolve(found);if(this.failure)return Promise.reject(this.failure);return new Promise((resolve,reject)=>{const w={name,after,resolve,reject};w.timer=setTimeout(()=>{this.waiters=this.waiters.filter(x=>x!==w);reject(new Error('timeout: '+name));},deadline);this.waiters.push(w);});}
 request(channel,payload={},requestId=randomUUID(),deadline=this.config.requestDeadlineMs){if(!this.accepting&&channel!=='withu:server:shutdown')return Promise.reject(new Error('server draining'));if(this.failure)return Promise.reject(this.failure);if(this.pending.has(requestId))return Promise.reject(new Error('duplicate pending request'));const m={schema_version:1,request_id:requestId,client_session_id:this.session,channel,payload};if(!valid('request',m)||JSON.stringify(m).length>1048576)return Promise.reject(new Error('request schema'));return new Promise((resolve,reject)=>{const p={resolve,reject,channel};p.timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('request timeout: '+channel));},deadline);this.pending.set(requestId,p);this.child.stdin.write(JSON.stringify(m)+'\n');});}
 rendererReload(){return this.ready;}
 windowHide(){return this.ready;}
 async status(){return (await this.request('withu:server:status')).status;}
 quit(){if(!this.shutdown)this.shutdown=this.finishQuit();return this.shutdown;}
 async finishQuit(){this.accepting=false;try{const result=await this.request('withu:server:shutdown',{},randomUUID(),this.config.shutdownDeadlineMs);this.child.stdin.end();let timer;const exit=await Promise.race([this.exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('server exit timeout')),this.config.shutdownDeadlineMs);})]).finally(()=>clearTimeout(timer));if(exit.code!==0)throw new Error('server failed to exit');return {...result.shutdown,event:result.shutdown.phase==='complete'?'server.shutdown.complete':'server.shutdown.failed'};}catch(error){await this.forceStop();throw error;}}
 async forceStop(){if(!this.child||this.exitResult)return;if(process.platform==='win32'){await new Promise(resolve=>{const kill=spawn('taskkill',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.once('error',resolve);kill.once('exit',resolve);});}else this.child.kill('SIGKILL');let timer;await Promise.race([this.exited,new Promise(resolve=>{timer=setTimeout(resolve,this.config.forcedExitDeadlineMs);})]).finally(()=>clearTimeout(timer));}
}
