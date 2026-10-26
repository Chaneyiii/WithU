import {readFileSync} from 'node:fs';
const contractDir=new URL('../../contracts/v1/',import.meta.url);
function read(name){return JSON.parse(readFileSync(new URL(name,contractDir)));}
const configSchema=read('config.schema.json'),publicSchema=read('public-config.schema.json');
function reject(){throw new Error('validation: invalid configuration shape');}
function validate(schema,value){
  if(schema.$ref)return validate(read(schema.$ref.replace('./','')),value);
  if(schema.const!==undefined&&value!==schema.const)reject();
  if(schema.enum&&!schema.enum.includes(value))reject();
  if(schema.type && ![schema.type].flat().some(t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isInteger(value):typeof value===t))reject();
  if(schema.minimum!==undefined&&value<schema.minimum)reject();
  if(Array.isArray(value)){if(schema.minItems!==undefined&&value.length<schema.minItems)reject();if(schema.items)for(const item of value)validate(schema.items,item);}
  if(schema.properties&&value!==null){for(const name of schema.required||[])if(!Object.hasOwn(value,name))reject();for(const name of Object.keys(value)){if(!Object.hasOwn(schema.properties,name)){if(schema.additionalProperties===false)reject();}else validate(schema.properties[name],value[name]);}}
}
export function validateConfig(config){validate(configSchema,config);}
export function publicConfig(config){
  validateConfig(config);
  const result={
    schema_version:config.schema_version,config_version:config.config_version,
    providers:config.providers.map(p=>({provider_id:p.provider_id,service:p.service,endpoint:p.endpoint,protocol:p.protocol,capabilities:[...p.capabilities],...(p.display_name?{display_name:p.display_name}:{})})),
    defaults:{llm:config.defaults.llm,realtime:config.defaults.realtime},
    // Deep cloning is safe only after recursive closed-schema validation.
    model_overrides:structuredClone(config.model_overrides),
    speech_preferences:structuredClone(config.speech_preferences)
  };
  validate(publicSchema,result);return result;
}

export function validatePublicConfig(config){validate(publicSchema,config);return structuredClone(config);}
