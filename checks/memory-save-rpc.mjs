import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ClientServerOwner} from '../client/withu-window/index.mjs';

const root=await mkdtemp(path.join(os.tmpdir(),'withu-memory-save-'));
const owners=[];
const start=async()=>{const o=new ClientServerOwner(process.env.WITHU_SERVER_BINARY||path.resolve('target/debug/withu-server.exe'),{dataDir:root,test:true});owners.push(o);await o.start();return o;};
const list=o=>o.request('withu:memory:list',{schema_version:1,scope:'comfort',retrieval:'list',query:null,limit:50,context_limit:6});
const input={schema_version:1,scope:'comfort',subject:'饮品偏好',content:'我喜欢无糖乌龙茶。',kind:'explicit_preference',explicit_save_permission:true,expected_state_version:0};
const save=(o,extra={})=>o.request('withu:memory:save',{...input,...extra});
try {
  let o=await start();
  await o.request('withu:storage:fail',{});
  await assert.rejects(save(o),/commit|injected|storage/);
  assert.equal((await list(o)).state_version,0,'failed atomic save must not advance state');
  assert.deepEqual((await list(o)).items,[],'failed save must not expose memory or evidence');
  const saved=await save(o);
  assert.ok(saved.state_version>0);
  let response=await list(o);
  assert.equal(response.items.length,1);
  const item=response.items[0];
  assert.equal(item.record.id,saved.item.record.id);
  assert.equal(item.record.kind,'explicit_preference');
  assert.equal(item.record.confirmed,true);assert.equal(item.record.save_permission,true);
  assert.equal(item.evidence.length,1);assert.equal(item.evidence[0].speaker,'user');
  assert.match(item.evidence[0].text_ref,/^user-entry:/);
  assert.equal(item.evidence[0].text_excerpt,input.subject+'\n'+input.content);
  assert.equal(item.record.source_evidence[0].version,item.evidence[0].version);
  await assert.rejects(save(o),/version_conflict/);
  for(const patch of [{explicit_save_permission:false},{explicit_save_permission:null},{kind:'affect_hypothesis'},
    {audio_base64:'AQABAA=='},{transcript:'Do not persist Live'},{source_evidence:[]},{content:' '.repeat(3)},
    {subject:' '.repeat(3)},{content:'a'.repeat(1801)},{scope:'cowork:project'}]) {
    await assert.rejects(save(o,{expected_state_version:saved.state_version,...patch}),/memory_save_schema|memory_save_empty|memory_scope/);
  }
  assert.equal((await list(o)).state_version,saved.state_version,'rejected candidates must not write evidence or memory');
  await o.quit();o=await start();
  response=await list(o);assert.equal(response.items.length,1);assert.equal(response.items[0].evidence[0].text_excerpt,item.evidence[0].text_excerpt);
  const corrected=await o.request('withu:memory:correct',{schema_version:1,scope:'comfort',record:{...item.record,version:2,content:'我现在喜欢茉莉花茶。'},expected_object_version:1,expected_state_version:response.state_version});
  await assert.rejects(o.request('withu:memory:correct',{schema_version:1,scope:'comfort',record:{...item.record,version:2},expected_object_version:1,expected_state_version:corrected.state_version}),/version_conflict/);
  const deleted=await o.request('withu:memory:delete',{schema_version:1,scope:'comfort',target_type:'memory',target_id:item.record.id,expected_object_version:2,expected_state_version:corrected.state_version,sync_protection_token:randomUUID()});
  assert.equal(deleted.impact.count,2);
  assert.deepEqual((await list(o)).items,[]);
  await assert.rejects(o.request('withu:memory:correct',{schema_version:1,scope:'comfort',record:{...item.record,version:3},expected_object_version:2,expected_state_version:deleted.state_version}),/deleted/);
  await o.quit();o=await start();assert.deepEqual((await list(o)).items,[]);
  console.log('PASS explicit memory save: atomic user evidence, permission/schema/scope/CAS rejection, restart, correction and durable deletion; '+root);
} finally {for(const o of owners)await o.forceStop();}
