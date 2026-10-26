// Opt-in small real calls; secrets remain inside the server. No wire/audio/text dump.
import assert from 'node:assert/strict';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
if(!process.argv.includes('--authorized-small-calls'))throw Error('explicit small-call authorization required');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),exec=promisify(execFile);
await mkdir('output/p3/real-metrics',{recursive:true});const root=await mkdtemp(path.resolve('output/p3/real-metrics/run-'));
const owner=new ClientServerOwner(path.resolve(process.env.WITHU_PACKAGED_SERVER||'output/p3/windows-alpha16-final-20261014/Withu-win32-x64/resources/withu-server.exe'),{dataDir:path.join(process.env.APPDATA,'Withu','withu')});
const report={startedAt:new Date().toISOString(),realCloud:true,realDevice:false,userAudioSaved:false,input:'generated system greeting; 16kHz PCM mono; no microphone',playback:'not performed; timings end at received PCM',hardware:{cpu:os.cpus()[0]?.model,totalMemoryBytes:os.totalmem()},runs:[],success:false};
const ownConversations=[];let scope,config;
const stats=async()=>{const {stdout}=await exec('powershell',['-NoProfile','-Command',`$p=Get-Process -Id ${owner.child.pid} -ErrorAction Stop; @{workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;cpuSeconds=$p.CPU}|ConvertTo-Json -Compress`],{windowsHide:true});return JSON.parse(stdout);};
const until=async predicate=>{for(let i=0;i<400;i++){const value=predicate();if(value)return value;await delay(50);}throw Error('cloud_terminal_timeout');};
try{
 await owner.start();config=(await owner.request('withu:config:get')).config;
 const selection=config.model_overrides.realtime,provider=config.providers.find(p=>p.provider_id===selection?.provider_ref);assert.ok(provider,'speech_unconfigured');
 report.speech={protocol:provider.protocol,model:selection.model_ref,voice:config.speech_preferences.realtime?.voice_id||'provider default'};
 const wav=await readFile('output/p3/synthetic-greeting.wav');let pcm;
 for(let at=12;at+8<wav.length;){const size=wav.readUInt32LE(at+4),kind=wav.toString('ascii',at,at+4);if(kind==='fmt '){assert.equal(wav.readUInt16LE(at+8),1);assert.equal(wav.readUInt16LE(at+10),1);assert.equal(wav.readUInt32LE(at+12),16000);assert.equal(wav.readUInt16LE(at+22),16);}if(kind==='data'){pcm=wav.subarray(at+8,at+8+size);break;}at+=8+size+(size%2);}
 assert.ok(pcm?.length);report.inputDurationMs=pcm.length/32;
 for(const mode of ['comfort','cowork']){
  const cid=crypto.randomUUID();ownConversations.push(cid);await owner.request('withu:conversation:update',{expected_version:0,object:{schema_version:1,conversation_id:cid,mode,project_id:null,title:'P3 generated sample verification',last_activity_at:String(Date.now()),task_refs:[],draft_ref:null,version:1}});
  const run={mode,interrupt:mode==='cowork',events:[],samples:[]},began=performance.now();let firstAudio=null,finalAt=null,failed=null,finished=false,interruptAt=null;
  const receive=e=>{const v=e.data?.realtime;if(v?.scope.session_id!==scope?.session_id)return;const at=performance.now()-began;
   if(v.type!=='audio'&&v.type!=='transcript_delta'&&v.type!=='assistant_delta')run.events.push({type:v.type,atMs:Math.round(at),...(v.code?{code:v.code}:{})});
   if(v.type==='audio'){firstAudio??=at;run.audioChunks=(run.audioChunks||0)+1;run.audioBytes=(run.audioBytes||0)+Buffer.from(v.audio_base64,'base64').length;}
   if(v.type==='transcript_final')finalAt??=at;if(v.type==='assistant_final')finished=true;if(v.type==='failed')failed=v.code;
  };owner.on('event',receive);
  try{
   run.samples.push(await stats());({scope}=await owner.request('withu:realtime:start',{schema_version:1,conversation_id:cid,renderer_id:'p3-generated-metrics',config_version:config.config_version,mode:'live'}));
   await until(()=>run.events.find(e=>e.type==='ready')||failed);assert.equal(failed,null);const inputBegan=performance.now(),acks=[];
   for(let i=1;i<=240;i++){
    const frame=Buffer.alloc(3200);pcm.subarray((i-1)*3200,i*3200).copy(frame);const at=performance.now();await owner.request('withu:realtime:input',{schema_version:1,scope,sequence:i,audio_base64:frame.toString('base64')});acks.push(performance.now()-at);
    if(i===60||i===120)run.samples.push(await stats());
    if(failed)throw Error(failed);
    if(firstAudio!==null&&run.interrupt){interruptAt=performance.now()-began;const started=performance.now();await owner.request('withu:realtime:command',{schema_version:1,scope,command:'interrupt'});run.interruptAckMs=performance.now()-started;break;}
    if(finished)break;await delay(Math.max(0,inputBegan+i*100-performance.now()));
   }
   if(!run.interrupt)await until(()=>finished||failed);assert.equal(failed,null);assert.ok(firstAudio!==null,'no_audio');assert.ok(run.interrupt?interruptAt!==null:finished,'reply_not_complete');
   run.firstAudioFromSessionStartMs=firstAudio;run.transcriptFinalFromStartMs=finalAt;run.finalToFirstAudioMs=finalAt===null?null:firstAudio-finalAt;
   run.meanInputAckMs=acks.reduce((a,b)=>a+b,0)/acks.length;run.maxInputAckMs=Math.max(...acks);run.samples.push(await stats());
   const ended=performance.now();await owner.request('withu:realtime:command',{schema_version:1,scope,command:'end'});run.endAckMs=performance.now()-ended;
   await assert.rejects(owner.request('withu:realtime:input',{schema_version:1,scope,sequence:acks.length+1,audio_base64:'AAA='}),/realtime_session_ended/);
   assert.equal((await owner.request('withu:message:list',{conversation_id:cid})).items.length,0);run.noDurableTranscripts=true;
   const seconds=(performance.now()-began)/1000;run.durationMs=seconds*1000;run.serverCpuOneCorePercent=100*(run.samples.at(-1).cpuSeconds-run.samples[0].cpuSeconds)/seconds;
   run.peakSampledServerWorkingSetBytes=Math.max(...run.samples.map(s=>s.workingSetBytes));run.success=true;
  }finally{owner.off('event',receive);if(scope)await owner.request('withu:realtime:command',{schema_version:1,scope,command:'end'}).catch(()=>{});scope=null;report.runs.push(run);}
 }
 report.success=true;
}catch(e){report.failure=e.code||e.message;}finally{
 for(const cid of ownConversations){const c=(await owner.request('withu:conversation:get',{id:cid}).catch(()=>({}))).object;if(c)await owner.request('withu:conversation:delete',{id:cid,expected_version:c.version});}
 if(owner.ready&&!owner.failure){report.shutdown=await owner.quit();report.serverExited=(await owner.exited).code===0;}else if(!owner.exitResult)await owner.forceStop();
 report.completedAt=new Date().toISOString();await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));
 console.log('P3_REAL_METRICS '+root+' success='+report.success+(report.failure?' code='+report.failure:''));if(!report.success)process.exitCode=1;
}
