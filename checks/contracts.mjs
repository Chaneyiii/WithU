import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { channels, publicConfig, validateConfig, validatePublicConfig } from '../client/withu-ipc/index.mjs';
import { createBridge } from '../client/withu-preload/index.mjs';
const dir=new URL('../contracts/v1/',import.meta.url);
const schemas=new Map();for(const f of await readdir(dir)) if(f.endsWith('.schema.json'))schemas.set(f,JSON.parse(await readFile(new URL(f,dir))));
// P0 validator implements precisely the keywords used by this contract set.
function validate(s,v) {
  if(s.$ref)return validate(schemas.get(s.$ref.replace('./','')),v);
  if(s.const!==undefined) assert.deepEqual(v,s.const);
  if(s.enum)assert.ok(s.enum.includes(v));
  if(s.type){const types=[s.type].flat();assert.ok(types.some(t=>t==='null'?v===null:t==='array'?Array.isArray(v):t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):t==='integer'?Number.isInteger(v):typeof v===t));}
  if(s.minimum!==undefined)assert.ok(v>=s.minimum);if(s.maximum!==undefined)assert.ok(v<=s.maximum);
  if(Array.isArray(v)){if(s.minItems!==undefined)assert.ok(v.length>=s.minItems);if(s.maxItems!==undefined)assert.ok(v.length<=s.maxItems);if(s.items)for(const x of v)validate(s.items,x);}
  if(s.properties && v!==null && typeof v==='object'){for(const k of s.required||[])assert.ok(Object.hasOwn(v,k),'required '+k);if(s.additionalProperties===false)for(const k of Object.keys(v))assert.ok(Object.hasOwn(s.properties,k),'unexpected '+k);for(const[k,p]of Object.entries(s.properties))if(Object.hasOwn(v,k))validate(p,v[k]);}
}
function fixture(s){if(s.$ref)return fixture(schemas.get(s.$ref.replace('./','')));if(s.const!==undefined)return s.const;if(s.enum)return s.enum[0];if(Array.isArray(s.type))return s.type.includes('null')?null:fixture({...s,type:s.type[0]});if(s.type==='object')return Object.fromEntries(Object.entries(s.properties||{}).map(([k,v])=>[k,fixture(v)]));if(s.type==='array')return Array.from({length:s.minItems||0},()=>fixture(s.items));if(s.type==='null')return null;if(s.type==='string')return 'v3-fixture';if(s.type==='boolean')return false;if(['integer','number'].includes(s.type))return s.minimum??0;throw new Error('unsupported schema');}
for(const[name,s]of schemas){assert.ok([1,2].includes(s.properties.schema_version.const));assert.equal(s.additionalProperties,false);const f=fixture(s);validate(s,f);assert.throws(()=>validate(s,{...f,schema_version:s.properties.schema_version.const+1}));for(const key of s.required) {const bad={...f};delete bad[key];assert.throws(()=>validate(s,bad),name+' '+key);}assert.throws(()=>validate(s,{...f,unexpected:'field'}));}
assert.equal(new Set(channels).size,channels.length);
assert.ok(channels.every(c=>/^withu:[a-z]+:[a-z_]+(?::[a-z_]+)?$/.test(c)));
const rust=await readFile(new URL('../crates/withu-ipc/src/lib.rs',import.meta.url),'utf8');for(const c of channels)assert.ok(rust.includes(JSON.stringify(c)));
const bridge=createBridge((c,p)=>({c,p}));assert.throws(()=>bridge.invoke('withu:server:shutdown',{}));assert.throws(()=>bridge.invoke('withu:unknown:action',{}));
const emptyConfig={schema_version:2,config_version:1,providers:[],credential_refs:[],defaults:{llm:null,realtime:null},model_overrides:{},speech_preferences:{}};
validateConfig(emptyConfig);validate(schemas.get('public-config.schema.json'),publicConfig(emptyConfig));
const privateConfig={...emptyConfig,providers:[{schema_version:1,provider_id:'p',service:'llm',endpoint:'local',protocol:'compatible',capabilities:['llm'],credential_ref:'synthetic-ref'}],credential_refs:['synthetic-ref'],model_overrides:{llm:{provider_ref:'p',model_ref:'model'}},speech_preferences:{realtime:{voice_id:'voice'}}};
const projected=publicConfig(privateConfig);validate(schemas.get('public-config.schema.json'),projected);
validatePublicConfig(projected);
assert.throws(()=>validatePublicConfig({...projected,speech_preferences:{realtime:{nested:{token:'synthetic-token'}}}}));
assert.ok(!JSON.stringify(projected).includes('synthetic-ref'));
assert.equal(projected.model_overrides.llm.model_ref,'model');
for(const patch of [
 {model_overrides:{llm:{api_key:'synthetic-secret',credential_ref:'synthetic-ref'}}},
 {speech_preferences:{realtime:{nested:{token:'synthetic-token'}}}},
 {model_overrides:{llm:{provider_ref:'p',model_ref:'model',credential_ref:'synthetic-ref'}}},
 {speech_preferences:{realtime:{voice_id:'voice',unknown:'value'}}},
 {model_overrides:{unknown:{model_ref:'model'}}},
 {defaults:{llm:{token:'synthetic-token'},realtime:null}}
]) {const bad={...privateConfig,...patch};assert.throws(()=>validateConfig(bad));assert.throws(()=>publicConfig(bad));assert.throws(()=>validate(schemas.get('config.schema.json'),bad));}
assert.throws(()=>validate(schemas.get('public-config.schema.json'),{...projected,credential_refs:['synthetic-ref']}));
assert.throws(()=>validate(schemas.get('memory.schema.json'),{...fixture(schemas.get('memory.schema.json')),kind:'affect_hypothesis'}));
async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(['.git','target','node_modules','output','dist'].includes(e.name))continue;const u=new URL(e.name+(e.isDirectory()?'/':''),dir);if(e.isDirectory())await scan(u);else if(/\.(rs|mjs|cjs|jsx|js|css|json|toml)$/.test(e.name)&&u.pathname!==import.meta.url.replace('file://','')){const text=await readFile(u,'utf8');const banned=[['mu','se:'].join(''),['mu','seDesktop'].join(''),['dic','tation'].join('')];for(const token of banned)assert.ok(!text.includes(token),'forbidden product interface '+u.pathname);}}}
await scan(new URL('../',import.meta.url));console.log('PASS '+schemas.size+' schemas with required/version/unknown-field negatives; IPC parity; main-only shutdown; credential projection; source naming');
