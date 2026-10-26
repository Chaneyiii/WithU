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
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mode==='leak'?{data:[{id:key}]}:{data:[{id:'model-a'},{id:'model-b'},{id:'model-a'}],has_more:true}));return;}
 if(req.url==='/v1/audio/transcriptions'){assert.ok(body.includes('RIFF'));assert.ok(body.includes('filename="utterance.wav"'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:mode==='bad'?'wrong output':'Hello. This is a speech recognition test.'}));return;}
 if(req.url==='/v1/audio/speech'){const v=JSON.parse(body);assert.equal(v.model,'tts-user-model');assert.equal(v.voice,'user-voice');assert.ok(!body.includes(key));res.setHeader('Content-Type','audio/pcm');res.end(Buffer.from([1,0,2,0,3,0]));return;}
 if(req.url==='/v1/chat/completions'){res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'Fixture reply'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;}
 throw Error('unexpected route '+req.url);
});fixture.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:root,test:true});
try{
 await owner.start();let config=(await owner.request('withu:config:get')).config;config.config_version=2;config.providers=[{provider_id:'p',endpoint:`http://127.0.0.1:${fixture.address().port}/v1`,protocol:'openai-compatible',capabilities:[]}];await owner.request('withu:config:update',{schema_version:1,expected_version:1,config,credential_changes:[{provider_id:'p',action:'replace',value:key}]});
 const finish=async run=>{for(let i=0;i<250;i++){const proof=owner.wire.find(e=>e.data?.verification?.operation_id===run.operation_id)?.data.verification;if(proof)return proof;await sleep(20)}throw Error('probe timeout');};
 const list=()=>owner.request('withu:models:list',{schema_version:1,provider_id:'p',config_version:2,kind:'llm'});
 let proof=await finish(await list());assert.equal(proof.health,'ready');assert.equal(proof.capability,'unverified');assert.equal(proof.details.partial,true);assert.deepEqual(proof.details.items.map(i=>i.id),['model-a','model-b']);results.push('actual authenticated model GET, bounded projection, dedup, partial status; no fake capability proof');
 for(const [scenario,code]of [['auth','auth_failed'],['leak','sensitive_provider_output']]){mode=scenario;proof=await finish(await list());assert.equal(proof.code,code);}results.push('auth failure and credential reflection rejected without provider body disclosure');
 mode='normal';const probe=kind=>owner.request('withu:config:test',{schema_version:1,provider_id:'p',config_version:2,kind,model_ref:kind==='tts'?'tts-user-model':'asr-user-model',...(kind==='tts'?{voice_id:'user-voice'}:{})});
 proof=await finish(await probe('asr'));assert.equal(proof.health,'ready');assert.equal(proof.details.sample_verified,true);mode='bad';assert.equal((await finish(await probe('asr'))).code,'asr_sample_mismatch');results.push('ASR actual sample multipart and matching transcript required, arbitrary response rejected');
 mode='normal';proof=await finish(await probe('tts'));assert.equal(proof.health,'ready');assert.equal(proof.voice_id,'user-voice');assert.equal(proof.details.sample_rate,24000);assert.equal(Buffer.from(proof.details.audio_base64,'base64').length,6);results.push('TTS explicit model/voice, actual PCM sample returned only in transient proof');
 mode='slow';const run=await list();await sleep(100);const before=closed;await owner.request('withu:reply:cancel',{schema_version:1,operation_id:run.operation_id,conversation_id:run.conversation_id});await sleep(100);assert.ok(closed>before);results.push('model discovery actual network cancellation without replay');
 // Save actual per-task selections, then verify durable proof across unrelated saves.
 config.config_version=3;config.defaults={llm:'p',asr:'p',tts:'p'};config.model_overrides={llm:{provider_ref:'p',model_ref:'model-a'},asr:{provider_ref:'p',model_ref:'asr-user-model'},tts:{provider_ref:'p',model_ref:'tts-user-model'}};config.speech_preferences={asr:{backend_id:'cloud'},tts:{backend_id:'cloud',voice_id:'user-voice'}};
 await owner.request('withu:config:update',{schema_version:1,expected_version:2,config,credential_changes:[]});mode='normal';
 for(const kind of ['asr','tts'])await finish(await owner.request('withu:config:test',{schema_version:1,provider_id:'p',config_version:3,kind,model_ref:kind==='tts'?'tts-user-model':'asr-user-model',...(kind==='tts'?{voice_id:'user-voice'}:{})}));
 let publicView=await owner.request('withu:config:get');assert.equal(publicView.verifications.asr.health,'ready');assert.equal(publicView.verifications.tts.health,'ready');assert.ok(!JSON.stringify(publicView.verifications).includes('audio_base64'));
 config.config_version=4;await owner.request('withu:config:update',{schema_version:1,expected_version:3,config,credential_changes:[]});assert.equal((await owner.request('withu:config:get')).verifications.tts.health,'ready');
 const {randomUUID}=await import('node:crypto');const cid=randomUUID();await owner.request('withu:conversation:update',{object:{schema_version:1,conversation_id:cid,mode:'comfort',project_id:null,title:'Fixture voice',last_activity_at:String(Date.now()),task_refs:[],draft_ref:null,version:1},expected_version:0});
 const voiceFinish=async run=>{for(let i=0;i<250;i++){const v=owner.wire.find(e=>e.data?.voice?.operation_id===run.operation_id)?.data.voice;if(v)return v;await sleep(20)}throw Error('voice timeout')};
 const {readFile}=await import('node:fs/promises');const audio=(await readFile('apps/withu-server/assets/asr-probe.wav')).toString('base64');
 let v=await voiceFinish(await owner.request('withu:voice:request',{schema_version:1,conversation_id:cid,kind:'asr',config_version:4,audio_base64:audio}));assert.equal(v.state,'complete');assert.equal(v.details.text,'Hello. This is a speech recognition test.');
 const mid=randomUUID();await owner.request('withu:message:submit',{object:{schema_version:1,id:mid,conversation_id:cid,role:'user',text:'Fixture input',file_refs:[],submitted_at:String(Date.now()),version:1},expected_version:0});
 const rr=await owner.request('withu:reply:start',{schema_version:1,conversation_id:cid,message_id:mid,config_version:4});
 for(let i=0;i<250&&!owner.wire.some(e=>e.data?.reply?.operation_id===rr.operation_id&&e.data.reply.state==='complete');i++)await sleep(20);
 const tts=await voiceFinish(await owner.request('withu:voice:request',{schema_version:1,conversation_id:cid,kind:'tts',config_version:4,message_id:rr.operation_id}));assert.equal(tts.state,'complete');assert.equal(tts.details.sample_rate,24000);assert.equal(Buffer.from(tts.details.audio_base64,'base64').length,6);
 await assert.rejects(owner.request('withu:voice:request',{schema_version:1,conversation_id:cid,kind:'tts',config_version:4,message_id:'missing'}),/message_missing/);
 assert.equal((await owner.request('withu:message:list',{conversation_id:cid})).items.length,2,'voice transient result never becomes assistant message');
 mode='slow';const vr=await owner.request('withu:voice:request',{schema_version:1,conversation_id:cid,kind:'asr',config_version:4,audio_base64:audio});await sleep(100);await owner.request('withu:reply:cancel',{schema_version:1,conversation_id:cid,operation_id:vr.operation_id});assert.equal((await voiceFinish(vr)).state,'cancelled');
 config.config_version=5;config.speech_preferences.tts.voice_id='changed-voice';await owner.request('withu:config:update',{schema_version:1,expected_version:4,config,credential_changes:[]});publicView=await owner.request('withu:config:get');assert.equal(publicView.verifications.tts,undefined);assert.equal(publicView.verifications.asr.health,'ready');
 config.config_version=6;await owner.request('withu:config:update',{schema_version:1,expected_version:5,config,credential_changes:[{provider_id:'p',action:'replace',value:key}]});assert.deepEqual((await owner.request('withu:config:get')).verifications,{});
 results.push('durable scoped verification: unchanged saves retained; voice/credential revisions invalidate; no audio proof persistence');results.push('actual finite Chat ASR wire, conversation/message scope, transient text and explicit cancellation');
 assert.ok(!JSON.stringify(owner.wire).includes(key));await assert.rejects(owner.request('withu:models:list',{schema_version:1,provider_id:'p',kind:'llm',config_version:1}),/config_version_conflict/);results.push('stale config rejected, no credentials in wire');
 config.config_version=7;config.providers=[];config.defaults={llm:null,asr:null,tts:null};config.model_overrides={};await owner.request('withu:config:update',{schema_version:1,expected_version:6,config,credential_changes:[]});
 await writeFile(path.join(root,'results.json'),JSON.stringify({results,requests,realCloud:false,realKeys:false},null,2));console.log('PASS '+results.length+' provider discovery/audio probe groups; Evidence '+root);
}finally{await owner.request('withu:server:shutdown',{}).catch(()=>{});await owner.exited;for(const s of sockets)s.destroy();await new Promise(r=>fixture.close(r));}
