import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),key='FICTIONAL-DISCOVERY-ONLY';
await mkdir('output/p3/provider-discovery',{recursive:true});const root=await mkdtemp(path.resolve('output/p3/provider-discovery/run-'));
let mode='normal',requests=0,closed=0;const results=[],sockets=new Set();
const fixture=http.createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,'Bearer '+key);requests++;let body='';for await(const part of req)body+=part;
 res.on('close',()=>closed++);
 if(mode==='slow'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');return;}
 if(mode==='auth'){res.writeHead(401);res.end(key);return;}
 const reqPath=req.url.startsWith('http')?new URL(req.url).pathname:req.url;if(reqPath==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mode==='leak'?{data:[{id:key}]}:{data:[{id:'model-a'},{id:'model-b'},{id:'model-a'}],has_more:true}));return;}
 if(reqPath==='/v1/audio/transcriptions'){assert.ok(body.includes('RIFF'));assert.ok(body.includes('filename="utterance.wav"'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:mode==='bad'?'wrong output':'Hello. This is a speech recognition test.'}));return;}
 if(reqPath==='/v1/audio/speech'){const v=JSON.parse(body);assert.equal(v.model,'tts-user-model');assert.equal(v.voice,'user-voice');assert.ok(!body.includes(key));res.setHeader('Content-Type','audio/pcm');res.end(Buffer.from([1,0,2,0,3,0]));return;}
 throw Error('unexpected route '+req.url);
});fixture.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:root,test:true});
try{
 await owner.start();let config=(await owner.request('withu:config:get')).config;config.config_version=2;config.providers=[{provider_id:'p',service:'llm',endpoint:`http://127.0.0.1:${fixture.address().port}/v1`,protocol:'openai-compatible',capabilities:[]}];await owner.request('withu:config:update',{schema_version:1,expected_version:1,config,credential_changes:[{provider_id:'p',action:'replace',value:key}]});
 const finish=async run=>{for(let i=0;i<250;i++){const proof=owner.wire.find(e=>e.data?.verification?.operation_id===run.operation_id)?.data.verification;if(proof)return proof;await sleep(20)}throw Error('probe timeout');};
 const list=()=>owner.request('withu:models:list',{schema_version:1,provider_id:'p',config_version:2,kind:'llm'});
 let proof=await finish(await list());assert.equal(proof.health,'ready');assert.equal(proof.capability,'unverified');assert.equal(proof.details.partial,true);assert.deepEqual(proof.details.items.map(i=>i.id),['model-a','model-b']);results.push('actual authenticated model GET, bounded projection, dedup, partial status; no fake capability proof');
 for(const [scenario,code]of [['auth','auth_failed'],['leak','sensitive_provider_output']]){mode=scenario;proof=await finish(await list());assert.equal(proof.code,code);}results.push('auth failure and credential reflection rejected without provider body disclosure');
 await assert.rejects(owner.request('withu:config:test',{schema_version:1,provider_id:'p',config_version:2,kind:'realtime',model_ref:'voice'}),/provider_service_mismatch/);results.push('voice probes cannot use LLM credentials');
 mode='slow';const run=await list();await sleep(100);const before=closed;await owner.request('withu:reply:cancel',{schema_version:1,operation_id:run.operation_id,conversation_id:run.conversation_id});await sleep(100);assert.ok(closed>before);results.push('model discovery actual network cancellation without replay');
 assert.ok(!JSON.stringify(owner.wire).includes(key));await assert.rejects(owner.request('withu:models:list',{schema_version:1,provider_id:'p',kind:'llm',config_version:1}),/config_version_conflict/);results.push('stale config rejected, no credentials in wire');
 config.config_version=3;config.providers=[];await owner.request('withu:config:update',{schema_version:1,expected_version:2,config,credential_changes:[]});
 await writeFile(path.join(root,'results.json'),JSON.stringify({results,requests,realCloud:false,realKeys:false},null,2));console.log('PASS '+results.length+' provider discovery/audio probe groups; Evidence '+root);
}finally{await owner.request('withu:server:shutdown',{}).catch(()=>{});await owner.exited;for(const s of sockets)s.destroy();await new Promise(r=>fixture.close(r));}
