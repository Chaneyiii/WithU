// Explicitly authorized, small live calls. Never dump config, wire, keys or audio.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
if(!process.argv.includes('--authorized-small-calls'))throw Error('Explicit user authorization required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mode=process.argv.includes('--cowork')?'cowork':'comfort';
await mkdir('output/p3/live',{recursive:true});const root=await mkdtemp(path.resolve('output/p3/live/run-'));
const owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:path.join(process.env.APPDATA,'Withu','withu')});
const report={mode,realCloud:true,physicalMicrophone:false,physicalPlayback:false,userAudioSaved:false,success:false,checks:[],root};let cid;
const wait=async(id,kind)=>{for(let i=0;i<650;i++){const e=owner.wire.find(e=>e.data?.[kind]?.operation_id===id&&['complete','failed','cancelled'].includes(e.data[kind].state));if(e)return e.data[kind];await sleep(100);}throw Error('request_timeout');};
try{
 await owner.start();const {config,credential_states}=await owner.request('withu:config:get');
 report.config_version=config.config_version;
 report.services=Object.fromEntries(['llm','asr','tts'].map(k=>[k,{provider:config.providers.find(p=>p.provider_id===config.model_overrides[k]?.provider_ref)?.display_name||config.model_overrides[k]?.provider_ref||null,model:config.model_overrides[k]?.model_ref||null,credentialState:credential_states[config.model_overrides[k]?.provider_ref]||'unknown',credentialPresent:credential_states[config.model_overrides[k]?.provider_ref]==='present'}]));
 for(const k of ['llm','asr','tts'])if(!report.services[k].model||!report.services[k].credentialPresent)throw Error(k+'_unconfigured');
 cid=crypto.randomUUID();await owner.request('withu:conversation:update',{expected_version:0,object:{schema_version:1,conversation_id:cid,mode,project_id:null,title:'P3 验证 · 合成样本',last_activity_at:String(Date.now()),task_refs:[],draft_ref:null,version:1}});
 const wav=await readFile('apps/withu-server/assets/asr-probe.wav');let began=performance.now();
 const asr=await owner.request('withu:voice:request',{schema_version:1,conversation_id:cid,kind:'asr',config_version:config.config_version,audio_base64:wav.toString('base64')});
 const recognized=await wait(asr.operation_id,'voice');report.checks.push({kind:'asr',state:recognized.state,code:recognized.code,elapsed_ms:performance.now()-began});assert.equal(recognized.state,'complete',recognized.code);assert.ok(recognized.details.text.trim());
 const mid=crypto.randomUUID();await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id:mid,conversation_id:cid,role:'user',text:recognized.details.text,file_refs:[],submitted_at:String(Date.now()),version:1}});
 began=performance.now();const llm=await owner.request('withu:reply:start',{schema_version:1,conversation_id:cid,message_id:mid,config_version:config.config_version});const replied=await wait(llm.operation_id,'reply');
 report.checks.push({kind:'llm',state:replied.state,code:replied.code,elapsed_ms:performance.now()-began,first_token_ms:replied.first_token_ms,output_characters:replied.text.length});assert.equal(replied.state,'complete',replied.code);
 began=performance.now();const tts=await owner.request('withu:voice:request',{schema_version:1,conversation_id:cid,kind:'tts',config_version:config.config_version,text:replied.text.slice(0,96),parent_reply_id:llm.operation_id});const spoken=await wait(tts.operation_id,'voice');
 report.checks.push({kind:'tts',state:spoken.state,code:spoken.code,elapsed_ms:performance.now()-began,sample_rate:spoken.details?.sample_rate,audio_bytes:spoken.details?.audio_base64?Buffer.from(spoken.details.audio_base64,'base64').length:0});assert.equal(spoken.state,'complete',spoken.code);
 if(process.argv.includes('--cancel')){
  const input=crypto.randomUUID();await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id:input,conversation_id:cid,role:'user',text:'For a cancellation test, count from 1 to 100, one number per line.',file_refs:[],submitted_at:String(Date.now()),version:1}});
  const active=await owner.request('withu:reply:start',{schema_version:1,conversation_id:cid,message_id:input,config_version:config.config_version});
  for(let i=0;i<600&&!owner.wire.some(e=>e.data?.reply?.operation_id===active.operation_id&&e.data.reply.state==='delta');i++)await sleep(20);
  const at=performance.now();const cancelled=await owner.request('withu:reply:cancel',{schema_version:1,conversation_id:cid,operation_id:active.operation_id});
  assert.equal(cancelled.cancelled,true);await sleep(300);
  const messages=(await owner.request('withu:message:list',{conversation_id:cid})).items;assert.ok(!messages.some(m=>m.operation_id===active.operation_id));
  report.checks.push({kind:'live_llm_cancel',cancelled:true,ack_ms:performance.now()-at-300,durablePartial:false});
 }
 report.success=true;
}catch(e){report.failure=e.message;}finally{
 if(cid){const current=(await owner.request('withu:conversation:get',{id:cid}).catch(()=>({}))).object;if(current)await owner.request('withu:conversation:delete',{id:cid,expected_version:current.version}).catch(()=>{});}
 if(owner.ready)await owner.quit();else if(!owner.exitResult)await owner.forceStop();
 // No raw wire, transcript, audio, credential values or private refs in evidence.
 await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.success)process.exitCode=1;
}
