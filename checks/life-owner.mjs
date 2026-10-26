import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
const binary=process.env.WITHU_SERVER_BINARY||path.resolve('target/debug/withu-server.exe');
const dir=await mkdtemp(path.join(tmpdir(),'withu-life-owner-'));
let child,pending=new Map();
async function start(){
 child=spawn(binary,[],{env:{...process.env,WITHU_DATA_DIR:dir,WITHU_CLIENT_SESSION:'life-isolated',WITHU_TEST_MODE:'1'},stdio:['pipe','pipe','pipe']});
 let readyResolve,readyReject;const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;});
 let stderr='';child.stderr.on('data',b=>stderr+=b);
 child.on('exit',code=>{readyReject(new Error(`server exit ${code}: ${stderr}`));for(const p of pending.values())p.reject(new Error(`server exit ${code}: ${stderr}`));pending.clear();});
 createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);if(m.record?.event==='server.ready')readyResolve();const p=pending.get(m.request_id);if(p){pending.delete(m.request_id);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result??m.data);}});
 await ready;
}
function rpc(name,b={}){return new Promise((resolve,reject)=>{const request_id=randomUUID();pending.set(request_id,{resolve,reject});child.stdin.write(JSON.stringify({schema_version:1,request_id,client_session_id:'life-isolated',channel:`withu:life:${name}`,payload:{schema_version:1,scope:'comfort',...b}})+'\n');});}
async function stop(){const p=child;await new Promise(resolve=>{p.once('exit',resolve);p.stdin.end();});}
async function prepare(operation_id,operation,extra={}){return rpc('prepare',{operation_id,operation,user_evidence_ref:'user:isolated-request',goal_description:'User requested local task',...extra});}
async function apply(id){await rpc('decide',{operation_id:id,decision:'allow',explicit_user_allow:true});return rpc('execute',{operation_id:id});}
try{
 await start();
 assert.deepEqual((await rpc('list')).drafts,[]);
 await prepare('draft',{kind:'draft_create',id:'draft',conversation_id:'local',text:'Never sent',file_refs:[]});
 assert.deepEqual((await rpc('list')).drafts,[],'prepare has no object effect');
 await assert.rejects(rpc('execute',{operation_id:'draft'}),/life_explicit_decision_required/);
 await assert.rejects(rpc('decide',{operation_id:'draft',decision:'allow',explicit_user_allow:false}));
 const applied=await apply('draft');assert.equal(applied.receipt.status,'applied');
 assert.deepEqual(await rpc('execute',{operation_id:'draft'}),applied);
 assert.equal((await rpc('read',{kind:'draft',id:'draft'})).value.text,'Never sent');
 await assert.rejects(prepare('stale',{kind:'draft_edit',id:'draft',text:'stale',file_refs:[],expected_version:0}));
 await assert.rejects(rpc('list',{scope:'cowork'}),/life_scope/);
 await prepare('edit',{kind:'draft_edit',id:'draft',text:'Edited, never sent',file_refs:[],expected_version:1});
 await prepare('racing-edit',{kind:'draft_edit',id:'draft',text:'Stale racing text',file_refs:[],expected_version:1});
 await apply('edit');
 await rpc('decide',{operation_id:'racing-edit',decision:'allow',explicit_user_allow:true});
 const staleReceipt=await rpc('execute',{operation_id:'racing-edit'});
 assert.equal(staleReceipt.receipt.status,'rejected');assert.equal(staleReceipt.receipt.error.code,'version');
 assert.equal((await rpc('read',{kind:'draft',id:'draft'})).value.text,'Edited, never sent');
 assert.ok((await rpc('list')).receipts.some(r=>r.action_id==='life-action:racing-edit'&&r.status==='rejected'));
 const calendar={id:'event',title:'Local appointment',starts_at:100,ends_at:200,timezone:'UTC',notes:'Local only'};
 await prepare('calendar-create',{kind:'calendar_create',...calendar});await apply('calendar-create');
 await prepare('calendar-edit',{kind:'calendar_edit',...calendar,title:'Changed',expected_version:1});await apply('calendar-edit');
 assert.equal((await rpc('read',{kind:'calendar',id:'event'})).value.version,2);
 await prepare('calendar-delete',{kind:'calendar_delete',id:'event',expected_version:2});await apply('calendar-delete');
 assert.equal((await rpc('read',{kind:'calendar',id:'event'})).value,null);
 const reminder={id:'manage',text:'Manage me',due_at:Math.floor(Date.now()/1000)+3600,timezone:'UTC'};
 await prepare('manage-create',{kind:'reminder_create',...reminder});await apply('manage-create');
 await prepare('manage-edit',{kind:'reminder_edit',...reminder,text:'Edited reminder',expected_version:1});await apply('manage-edit');
 await prepare('manage-pause',{kind:'reminder_pause',id:'manage',expected_version:2});await apply('manage-pause');
 assert.equal((await rpc('read',{kind:'reminder',id:'manage'})).value.status,'paused');
 await prepare('manage-resume',{kind:'reminder_resume',id:'manage',expected_version:3});await apply('manage-resume');
 await prepare('manage-delete',{kind:'reminder_delete',id:'manage',expected_version:4});await apply('manage-delete');
 assert.equal((await rpc('read',{kind:'reminder',id:'manage'})).value.status,'deleted');
 await prepare('cancel',{kind:'draft_create',id:'cancel',conversation_id:'local',text:'Cancel me',file_refs:[]});
 assert.equal((await rpc('cancel',{operation_id:'cancel'})).receipt.status,'rejected');
 assert.equal((await rpc('read',{kind:'draft',id:'cancel'})).value,null);
 await prepare('pending',{kind:'draft_create',id:'pending',conversation_id:'local',text:'Pending',file_refs:[]});
 await rpc('decide',{operation_id:'pending',decision:'allow',explicit_user_allow:true});
 const now=Math.floor(Date.now()/1000);
 await assert.rejects(prepare('expired',{kind:'draft_create',id:'expired',conversation_id:'local',text:'Expired',file_refs:[]},{expires_at:now-1}));
 await prepare('due',{kind:'reminder_create',id:'due',text:'Drink water',due_at:now+2,timezone:'UTC'});await apply('due');
 await rpc('tick',{app_running:false});
 await new Promise(r=>setTimeout(r,2200));
 assert.equal((await rpc('tick',{app_running:true})).candidates.length,1);
 assert.deepEqual((await rpc('tick',{app_running:true})).candidates,[]);
 await assert.rejects(rpc('tick',{app_running:true,now:0}),/life_schema/);
 await stop();await start();
 assert.equal((await rpc('list')).drafts.length,1);
 await assert.rejects(rpc('execute',{operation_id:'pending'}),/life_pending_missing/);
 await assert.rejects(prepare('draft',{kind:'draft_create',id:'new',conversation_id:'local',text:'Duplicate',file_refs:[]}),/life_duplicate_operation/);
 assert.deepEqual((await rpc('tick',{app_running:true})).candidates,[]);
 const retrieved=await rpc('retrieve',{operation_id:'retrieve',user_evidence_ref:'user:query',query:'weather',limit:3});
 assert.equal(retrieved.value[0].status,'unavailable');assert.equal(retrieved.value[0].content,null);
 const organized=await rpc('organize',{operation_id:'organize',user_evidence_ref:'user:items',items:[{item_id:'i',fields:{category:'home',text:'Only supplied facts'}}],group_by:'category',summary_limit:100});
 assert.equal(organized.value.groups[0].summary,'Only supplied facts');
 console.log('PASS life real owner SQLite: approval, CAS, cancellation, scope, expiry, idempotency, restart, trusted due tick and honest retrieval');
} finally {if(child?.exitCode===null)await stop();}
