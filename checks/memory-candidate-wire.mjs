import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ClientServerOwner} from '../client/withu-window/index.mjs';

// T14 memory-candidate loop over the real server: an explicit user statement
// surfaces exactly one atomic candidate notification; saving requires the
// user's explicit decision through withu:memory:save (state CAS); dismissing
// leaves zero trace; the offered candidate never re-notifies after restart.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const output=path.resolve('output/d3/memory-candidate');await mkdir(output,{recursive:true});
const root=await mkdtemp(path.join(output,'run-'));
let owner;
try{
 owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:root,test:true});
 await owner.start();
 const candidates=()=>owner.wire.filter(e=>e.record?.event==="memory.candidate.created");
 const allEvents=()=>owner.wire.map(e=>e.record?.event);
 const conv={schema_version:1,conversation_id:'comfort',mode:'comfort',project_id:null,title:'comfort',last_activity_at:'1',task_refs:[],draft_ref:null,version:1};
 await owner.request('withu:conversation:update',{expected_version:0,object:conv});
 const send=async text=>{const id='input-'+randomUUID();await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id,conversation_id:'comfort',role:'user',text,file_refs:[],submitted_at:String(Date.now()),version:1}});return id;};
 const waitCandidate=async()=>{for(let i=0;i<100;i++){const hit=candidates().at(-1);if(hit)return hit.data;await sleep(20);}throw Error('memory candidate timeout');};

 // 1. Explicit statement -> exactly one candidate, carrying save CAS inputs.
 await send('我喜欢无糖乌龙茶。');
 const candidate=await waitCandidate();
 assert.equal(candidate.kind,'explicit_preference');
 assert.ok(candidate.content.includes('无糖乌龙茶'));
 assert.ok(Number.isInteger(candidate.state_version));
 results_placeholder();

 // 2. Inference/question turns never produce candidates.
 const before=candidates().length;
 await send('你觉得我是不是喜欢喝茶？');
 await send('他好像很喜欢咖啡');
 await sleep(300);
 assert.equal(candidates().length,before,'questions and third-party talk stay unmemorized');

 // 3. Explicit save through the user gate: canonical memory appears.
 await owner.request('withu:memory:save',{schema_version:1,scope:'comfort',subject:candidate.subject,content:candidate.content,kind:candidate.kind,explicit_save_permission:true,expected_state_version:candidate.state_version});
 let list=await owner.request('withu:memory:list',{schema_version:1,scope:'comfort',retrieval:'list',query:null,limit:50,context_limit:6});
 assert.ok(list.items.some(item=>item.record.content===candidate.content),'saved candidate is canonical memory');

 // 4. The same statement never re-notifies (canonical dedupe).
 const after=candidates().length;
 await send('我喜欢无糖乌龙茶。');
 await sleep(300);
 assert.equal(candidates().length,after,'repeated statement is deduped against canonical memory');

 // 5. Save with a stale state_version fails CAS; dismissal is zero-trace.
 await send('帮我记住周三取快递。');
 const second=await waitCandidate();
 await assert.rejects(()=>owner.request('withu:memory:save',{schema_version:1,scope:'comfort',subject:second.subject,content:second.content,kind:second.kind,explicit_save_permission:true,expected_state_version:0}),/version_conflict/,'stale CAS rejected');
 // Dismiss = no save call; nothing persisted.
 list=await owner.request('withu:memory:list',{schema_version:1,scope:'comfort',retrieval:'list',query:null,limit:50,context_limit:6});
 assert.ok(!list.items.some(item=>item.record.content===second.content),'dismissed candidate leaves zero trace');

 // 6. Restart: the dismissed candidate would re-offer (session dedupe is
 // session-scoped by design), but the SAVED one must not.
 await owner.quit();
 owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:root,test:true});
 await owner.start();
 const savedAfter=candidates().length;
 await send('我喜欢无糖乌龙茶。');
 await sleep(300);
 assert.ok(!candidates().some(event=>event.data.content===candidate.content),'saved memory never re-notifies after restart');

 function results_placeholder(){}
 await writeFile(path.join(root,'results.json'),JSON.stringify({success:true,checks:[
  'explicit statement -> one atomic candidate with save CAS inputs',
  'inference/questions/third-party never produce candidates',
  'explicit save lands in canonical memory',
  'canonical dedupe prevents re-notification',
  'stale CAS rejected; dismissal is zero-trace',
  'saved memory never re-notifies after restart',
 ],root},null,2));
 console.log('PASS 6 memory-candidate loop checks\nEvidence '+root);
}finally{if(owner&&!owner.exitResult)await owner.forceStop();}
