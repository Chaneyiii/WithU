import assert from 'node:assert/strict';
import {emptyView,storyView,resetSelection,removeProvider,KINDS} from '../client/withu-renderer/src/model-config/view.mjs';
import {configurationPayload,configurationView} from '../client/withu-renderer/src/model-config/production.mjs';
import {validatePublicConfig} from '../client/withu-ipc/config-boundary.mjs';
import {newProvider,REALTIME_PRESETS,presetFor} from '../client/withu-renderer/src/model-config/providers.mjs';
const view=storyView('ready');
assert.deepEqual(KINDS,['llm','realtime']);assert.equal(emptyView().local,undefined);
const payload=configurationPayload(view);validatePublicConfig(payload.config);
const restored=configurationView({config:payload.config,source:'user',credential_states:{}});
assert.equal(restored.defaults.realtime.health,'unverified');
assert.equal(restored.defaults.llm.provider_ref,'sample-llm');
assert.equal(restored.defaults.realtime.provider_ref,'sample-realtime');
const removed=removeProvider(view,'sample-realtime');
assert.equal(removed.defaults.realtime.provider_ref,null);assert.deepEqual(removed.defaults.llm,view.defaults.llm);
assert.equal(resetSelection({...view.defaults.realtime,voice_id:'old'},{model_ref:'new'}).voice_id,'');
assert.throws(()=>validatePublicConfig({...payload.config,defaults:{llm:null,asr:null,tts:null}}));
for(const p of REALTIME_PRESETS){const provider=newProvider(p.id,'realtime');assert.equal(provider.service,'realtime');assert.equal(presetFor(provider),p.id);assert.equal(new URL(provider.endpoint).protocol,'wss:');}
assert.ok(!JSON.stringify(payload).includes('credential_ref'));
console.log('PASS service-separated form roundtrip, proof reset, reference deletion, retired-field rejection, realtime presets');
