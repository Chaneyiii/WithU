import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PROVIDER_PRESETS,PROTOCOLS,newProvider,selectPreset,presetFor,credentialEdit} from '../client/withu-renderer/src/model-config/providers.mjs';
import {configurationPayload,configurationView} from '../client/withu-renderer/src/model-config/production.mjs';
import {emptyView} from '../client/withu-renderer/src/model-config/view.mjs';
for(const preset of PROVIDER_PRESETS){
 const icon=preset.icon==='longcat'?'longcat-color':preset.icon;assert.ok(icon);assert.ok(['svg','png'].some(ext=>existsSync('client/withu-renderer/src/assets/provider-logos/'+icon+'.'+ext)),preset.name+' logo missing');
 const p=newProvider(preset.id);assert.equal(p.name,preset.name);assert.equal(p.endpoint,preset.endpoint);assert.equal(presetFor(p),preset.id);
 if(!preset.requiresEndpoint)assert.equal(new URL(p.endpoint).protocol,'https:');else assert.equal(p.endpoint,'');assert.equal(credentialEdit(p),'replace');assert.ok(PROTOCOLS.some(v=>v.id===p.adapter));
 const view=emptyView();view.providers=[{...p,provider_id:'test'}];const payload=configurationPayload(view);
 assert.equal(payload.config.providers[0].endpoint,p.endpoint);assert.equal(payload.config.providers[0].protocol,p.adapter);
 assert.ok(!JSON.stringify(payload).includes('preset'));assert.deepEqual(payload.config.providers[0].capabilities,[]);
 const restored=configurationView({config:payload.config,credential_states:{test:'present'},source:'user'});assert.equal(presetFor(restored.providers[0]),preset.id);assert.equal(credentialEdit(restored.providers[0]),'keep');
}
for(const id of ['perplexity','nvidia','opencode','opencode-go','azure','amazon-bedrock','openrouter'])assert.equal(PROVIDER_PRESETS.filter(p=>p.id===id).length,1,id+' preset must appear once');
assert.equal(PROVIDER_PRESETS.find(p=>p.id==='azure').adapter,'azure');
assert.equal(PROVIDER_PRESETS.find(p=>p.id==='amazon-bedrock').adapter,'bedrock');
assert.equal(PROVIDER_PRESETS.find(p=>p.id==='openrouter').endpoint,'https://openrouter.ai/api/v1');
assert.equal(credentialEdit(), 'replace');assert.equal(credentialEdit({credential_state:'storage_error'}),'replace');
const custom=selectPreset({...newProvider(),provider_id:'stable'},'custom');assert.equal(custom.provider_id,'stable');assert.equal(custom.name,'');assert.equal(custom.endpoint,'');assert.equal(custom.adapter,'openai-compatible');
assert.equal(presetFor({endpoint:'https://custom.example/v1',adapter:'anthropic'}),'custom');
assert.equal(presetFor(newProvider('custom')),'custom');
console.log(`PASS ${PROVIDER_PRESETS.length} presets, secret-edit defaults, custom switching and roundtrip projections`);
