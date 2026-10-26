import {emptyView,KINDS} from './view.mjs';
export function configurationView(result){
 const view=emptyView(),config=result.config;view.source=result.source;view.config_version=config.config_version;
 view.providers=config.providers.map(p=>({provider_id:p.provider_id,service:p.service,name:p.display_name||p.provider_id,adapter:p.protocol,endpoint:p.endpoint,credential_state:result.credential_states[p.provider_id]||'missing'}));
 for(const kind of KINDS){const selected=config.model_overrides[kind];const provider_ref=selected?.provider_ref||config.defaults[kind];view.defaults[kind]={...view.defaults[kind],provider_ref,model_ref:selected?.model_ref||'',effort:kind==='llm'?selected?.reasoning_effort||null:null,voice_id:kind==='realtime'?config.speech_preferences.realtime?.voice_id||'':'',health:provider_ref?'unverified':'unconfigured',...(result.verifications?.[kind]||{})};}
 return view;
}
export function configurationPayload(view,credential_changes=[]){
 const providers=view.providers.map(p=>({provider_id:p.provider_id,service:p.service,display_name:p.name,endpoint:p.endpoint,protocol:p.adapter,capabilities:[]}));
 const defaults={},model_overrides={};for(const kind of KINDS){const s=view.defaults[kind];defaults[kind]=s.provider_ref;model_overrides[kind]={provider_ref:s.provider_ref,model_ref:s.model_ref||null,...(kind==='llm'?{reasoning_effort:s.effort||null}:{})};}
 return {schema_version:1,expected_version:view.config_version,config:{schema_version:2,config_version:view.config_version+1,providers,defaults,model_overrides,speech_preferences:{realtime:{voice_id:view.defaults.realtime.voice_id||null}}},credential_changes};
}
