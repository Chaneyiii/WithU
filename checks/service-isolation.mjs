import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
await mkdir('output/p3/service-isolation',{recursive:true});const data=await mkdtemp(path.resolve('output/p3/service-isolation/run-'));
const owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:data,test:true});
try{
 await owner.start();let c=(await owner.request('withu:config:get')).config;
 c={...c,config_version:2,providers:[{provider_id:'text',service:'llm',endpoint:'http://127.0.0.1:9999/v1',protocol:'openai-compatible',capabilities:[]},{provider_id:'voice',service:'realtime',endpoint:'wss://example.test/dialogue',protocol:'custom-realtime',capabilities:[]}],defaults:{llm:'text',realtime:'voice'},model_overrides:{llm:{provider_ref:'text',model_ref:'chat'},realtime:{provider_ref:'voice',model_ref:'realtime'}}};
 await owner.request('withu:config:update',{schema_version:1,expected_version:1,config:c,credential_changes:[]});
 const update=config=>owner.request('withu:config:update',{schema_version:1,expected_version:2,config:{...config,config_version:3},credential_changes:[]});
 await assert.rejects(update({...c,defaults:{llm:'voice',realtime:'voice'}}),/provider_service_mismatch/);
 await assert.rejects(update({...c,providers:c.providers.map(p=>p.provider_id==='text'?{...p,service:'realtime',protocol:'custom-realtime'}:p),defaults:{llm:null,realtime:'voice'},model_overrides:{realtime:c.model_overrides.realtime}}),/provider_service_immutable/);
 await assert.rejects(owner.request('withu:config:test',{schema_version:1,provider_id:'text',kind:'realtime',model_ref:'realtime',config_version:2}),/provider_service_mismatch/);
 await assert.rejects(owner.request('withu:config:test',{schema_version:1,provider_id:'voice',kind:'llm',model_ref:'chat',config_version:2}),/provider_service_mismatch/);
 await assert.rejects(owner.request('withu:config:test',{schema_version:1,provider_id:'voice',kind:'realtime',model_ref:'realtime',config_version:2}),/realtime_protocol_unsupported/);
 assert.equal((await owner.request('withu:config:get')).config.config_version,2);
 console.log('PASS server default/override isolation, immutable provider role, cross-service probes, unsupported realtime without credential/network access');
}finally{await owner.quit();}
