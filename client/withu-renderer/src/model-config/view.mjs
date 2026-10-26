/** Secret-free form state. Provider records and credentials belong to one service. */
export const CONFIG_VIEW_VERSION = 2;
export const KINDS = ['llm','realtime'];
export const HEALTH = ['unconfigured','unverified','ready','auth_failed','unsupported','unavailable','device_error'];
export function emptyView() {
 return {view_version:2,config_version:1,source:'unconfigured',providers:[],defaults:Object.fromEntries(KINDS.map(k=>[k,{provider_ref:null,model_ref:'',capability:'unverified',connectivity:'unverified',health:'unconfigured',reasoning:[],effort:null,voice_id:''}]))};
}
export function resetSelection(value,patch) {
 return {...value,...patch,code:'',capability:'unverified',connectivity:'unverified',health:'unverified',reasoning:[],effort:null,voice_id:''};
}
export function removeProvider(view,id) {
 return {...view,providers:view.providers.filter(p=>p.provider_id!==id),defaults:Object.fromEntries(KINDS.map(k=>[k,view.defaults[k].provider_ref===id?{...emptyView().defaults[k]}:view.defaults[k]]))};
}
export const STORY_LABELS={empty:'未配置',ready:'已就绪',auth:'鉴权失败',unsupported:'协议尚未接入',offline:'服务不可用',device:'设备异常',capabilities:'不同模型能力'};
export function storyView(story) {
 const view=emptyView();view.source='fixture';if(story==='empty')return view;
 for(const k of KINDS){const id=`sample-${k}`;view.providers.push({provider_id:id,service:k,name:k==='llm'?'示例对话服务':'示例实时语音',adapter:k==='llm'?'openai-compatible':'custom-realtime',endpoint:'',credential_state:'present'});view.defaults[k]={...view.defaults[k],provider_ref:id,model_ref:`sample-${k}-model`,capability:'supported',connectivity:'connected',health:'ready'};}
 if(['auth','offline','unsupported','device'].includes(story))for(const k of KINDS)view.defaults[k]={...view.defaults[k],health:{auth:'auth_failed',offline:'unavailable',unsupported:'unsupported',device:'device_error'}[story],connectivity:story==='auth'?'auth_failed':story==='offline'?'unavailable':'connected',capability:story==='unsupported'?'unsupported':'supported'};
 if(story==='capabilities')view.defaults.llm.reasoning=['low','medium','high'];
 return view;
}
