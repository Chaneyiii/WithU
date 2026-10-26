import {useEffect,useState} from 'react';
import {desktopBridge} from '../desktop-bridge';
import {t} from '../i18n';
import EffortDial from './EffortDial';
import './EffortDial.css';

import modelsCatalog from '../model-config/models-dev-catalog.json' with {type:'json'};

// Effort stops are model-reported; these labels just name the common ones.
const EFFORT_LABELS={none:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'};

export function catalogSlug(provider){
 if(provider.protocol==='azure')return 'azure';if(provider.protocol==='bedrock')return 'amazon-bedrock';
 const normalized=provider.endpoint.replace(/\/$/,'');
 const matching=Object.entries(modelsCatalog.providers).find(([,entry])=>entry.api?.replace(/\/$/,'')===normalized);if(matching)return matching[0];
 const host=new URL(provider.endpoint).hostname;
 if(host==='api.openai.com')return 'openai';if(host.includes('googleapis.com'))return 'google';if(host==='api.anthropic.com')return 'anthropic';if(host==='api.deepseek.com')return 'deepseek';if(host==='openrouter.ai')return 'openrouter';if(host==='api.perplexity.ai')return 'perplexity';if(host==='integrate.api.nvidia.com')return 'nvidia';if(host==='opencode.ai')return provider.endpoint.includes('/go/')?'opencode-go':'opencode';if(host.endsWith('.amazonaws.com')&&host.startsWith('bedrock.'))return 'amazon-bedrock';if(host.includes('azure.com')||host.endsWith('.services.ai.azure.com'))return 'azure';if(host==='api.x.ai')return 'xai';if(host.includes('siliconflow'))return 'siliconflow';if(host.includes('dashscope'))return host.includes('intl')?'alibaba':'alibaba-cn';if(host.includes('moonshot'))return 'moonshotai';if(host==='open.bigmodel.cn')return 'zhipuai';if(host==='api.z.ai')return 'zai';if(host==='api.minimax.cn')return 'minimax-cn';if(host==='api.minimax.io')return 'minimax';return '';
}
export function modelMetadata(provider,id){
 const models=modelsCatalog.providers[catalogSlug(provider)]?.models||{};
 const direct=models[id]||Object.values(models).find(item=>item.id===id||item.canonical_model_id===id);if(direct)return direct;
 const matches=Object.values(modelsCatalog.providers).flatMap(entry=>Object.values(entry.models||{})).filter(item=>item.id===id||item.canonical_model_id===id);
 if(matches.length===1)return matches[0];
 // Shared upstream model metadata can be reused when its capability fields agree.
 const signature=m=>JSON.stringify([m.limit,m.modalities,m.reasoning,m.reasoning_options]);
 return matches.length&&matches.every(m=>signature(m)===signature(matches[0]))?matches[0]:null;
}

export function discover(bridge,provider,configVersion){
 return new Promise(async(resolve,reject)=>{
  let timer,off;
  const finish=(error,value)=>{clearTimeout(timer);off?.();error?reject(error):resolve(value);};
  timer=setTimeout(()=>finish(Error('获取模型列表超时')),20000);
  off=bridge.onEvent(event=>{const item=event.data?.verification;if(item?.discovery&&item.provider_id===provider.provider_id&&item.kind==='llm'&&item.config_version===configVersion)finish(item.health==='ready'?null:Error(item.code||'模型列表不可用'),item.details?.items||[]);});
  try{await bridge.modelList({schema_version:1,provider_id:provider.provider_id,kind:'llm',config_version:configVersion});}
  catch(error){finish(error);}
 });
}

export async function configuredModels(config){
 const stored=await desktopBridge().viewGet({id:'client'});
 const catalogs=stored.object?.overrides?.providerModels||{};
 return config.providers.filter(provider=>provider.service==='llm').flatMap(provider=>{
  const cached=catalogs[provider.provider_id];
  const entries=cached?.endpoint===provider.endpoint?cached.items:Object.values(modelsCatalog.providers[catalogSlug(provider)]?.models||{}).filter(m=>m.modalities?.output?.includes('text'));
  const items=[...entries];const selected=config.model_overrides.llm;
  if(selected?.provider_ref===provider.provider_id&&selected.model_ref&&!items.some(m=>m.id===selected.model_ref))items.unshift({id:selected.model_ref});
  return items.filter(m=>!m.hidden).map(m=>({id:m.id,providerId:provider.provider_id,providerName:provider.display_name,metadata:modelMetadata(provider,m.id)}));
 });
}
export async function saveProviderModels(provider,items){
 const bridge=desktopBridge(),record=await bridge.viewGet({id:'client'}),object=record.object;
 if(!object)throw Error('界面配置不可用');
 await bridge.viewUpdate({expected_version:object.version,object:{...object,version:object.version+1,overrides:{...object.overrides,providerModels:{...object.overrides?.providerModels,[provider.provider_id]:{endpoint:provider.endpoint,items}}}}});
}
// 占位模型：还没有连任何提供商时，也留一行带 5 档思考强度的模型，
// 好让「思考能力」滑杆能被看到、被拖到。它只在界面里选中，不写回配置。
const DEMO_MODEL_ID='gpt-6.1-sol';
const DEMO_MODEL={
 id:DEMO_MODEL_ID,
 providerId:'demo-placeholder',
 providerName:'占位模型 · 演示用',
 demo:true,
 metadata:modelMetadata({endpoint:'https://api.openai.com/v1',protocol:'openai'},DEMO_MODEL_ID)||{reasoning_options:[{type:'effort',values:['low','medium','high','xhigh','max']}]},
};
export default function ChatModelPicker(){
 const [config,setConfig]=useState(null),[models,setModels]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[effort,setEffort]=useState('');
 useEffect(()=>{let disposed=false;(async()=>{try{const current=(await desktopBridge().configGet()).config;const list=await configuredModels(current);if(!disposed){setConfig(current);setModels(list);}}catch{if(!disposed)setError('无法加载模型配置。');}finally{if(!disposed)setLoading(false);}})();return()=>{disposed=true;};},[]);
 // 弹层里只有这一张卡：模型名在「思考强度」上面，模型本身去设置里换。
 const stored=config?.model_overrides.llm;
 const selected=models.find(item=>item.id===stored?.model_ref&&item.providerId===stored?.provider_ref)||DEMO_MODEL;
 const reasoningOptions=selected?.metadata?.reasoning_options;
 const effortOptions=(Array.isArray(reasoningOptions)?reasoningOptions:reasoningOptions?[reasoningOptions]:[]).find(option=>option.type==='effort')?.values||[];
 const storedEffort=stored?.reasoning_effort;
 const currentEffort=effortOptions.includes(effort)?effort:effortOptions.includes(storedEffort)?storedEffort:effortOptions[Math.floor(effortOptions.length/2)]||'';
 const saveEffort=async value=>{
  if(!value)return;
  // 占位模型只在界面里预览，不写回配置。
  if(selected===DEMO_MODEL||!config)return;
  if(value===config.model_overrides.llm?.reasoning_effort)return;
  setLoading(true);setError('');try{const updated={...config,config_version:config.config_version+1,model_overrides:{...config.model_overrides,llm:{...config.model_overrides.llm,reasoning_effort:value}}};await desktopBridge().configUpdate({schema_version:1,expected_version:config.config_version,config:updated,credential_changes:[]});setConfig(updated);}catch{setError('思考强度未保存，请重试。');}finally{setLoading(false);}
 };
 return <div className="popover composer-popup model-popup chat-model-picker">
  {effortOptions.length>1
   ? <EffortDial model={selected.id} options={effortOptions} value={currentEffort} labels={EFFORT_LABELS} disabled={loading} onChange={setEffort} onCommit={v=>void saveEffort(v)}/>
   : <div className="effort-dial is-simple">
      <span className="ed-model">{selected.id}</span>
      <p className="ed-simple-note">{loading?'正在读取模型…':(Array.isArray(reasoningOptions)&&reasoningOptions.some(o=>o.type==='toggle'))?'这个模型只有思考开关，没有强度档位':'这个模型没有可调档位'}</p>
     </div>}
  {error&&<p className="model-error" role="alert">{error}</p>}
 </div>;
}
