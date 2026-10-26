import assert from 'node:assert/strict';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
await mkdir('output/p3/tls-probe',{recursive:true});const data=await mkdtemp(path.resolve('output/p3/tls-probe/run-'));const owner=new ClientServerOwner(path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe'),{dataDir:data,test:true});
try{await owner.start();const config=(await owner.request('withu:config:get')).config;
await owner.request('withu:config:update',{schema_version:1,expected_version:config.config_version,config:{...config,config_version:config.config_version+1,providers:[{provider_id:'voice',service:'realtime',protocol:'volc-realtime',endpoint:'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue',capabilities:[]}],defaults:{llm:null,realtime:'voice'},model_overrides:{realtime:{provider_ref:'voice',model_ref:'1.2.6.1'}}},credential_changes:[{provider_id:'voice',action:'replace',value:'SYNTHETIC-INVALID-KEY'}]});
const run=await owner.request('withu:config:test',{schema_version:1,provider_id:'voice',kind:'realtime',model_ref:'1.2.6.1',config_version:config.config_version+1});
await new Promise(r=>setTimeout(r,18000));const proof=owner.wire.find(e=>e.data?.verification?.operation_id===run.operation_id)?.data.verification;
const evidence={proof,stderr:owner.stderr,endpoint:'official TLS, deliberately invalid synthetic credential'};await writeFile(path.join(data,'result.json'),JSON.stringify(evidence,null,2));assert.ok(proof,'TLS connection must report a terminal verification');assert.equal(proof.code,'auth_failed');assert.equal(owner.stderr,'');console.log('PASS official TLS with synthetic invalid credential; bounded auth failure, no worker panic; '+data);}finally{await owner.quit();}
