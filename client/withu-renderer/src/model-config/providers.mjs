import ccOfficialPresets from './cc-official-presets.json' with {type:'json'};
// Offline convenience presets, not capability/model/health evidence.
// API URLs checked against models.dev metadata and vendor documentation.
export const PROVIDER_PRESETS = [
 {id:'openai',name:'OpenAI',adapter:'openai-compatible',endpoint:'https://api.openai.com/v1'},
 {id:'google',name:'Google Gemini',adapter:'openai-compatible',endpoint:'https://generativelanguage.googleapis.com/v1beta/openai'},
 {id:'anthropic',name:'Anthropic',adapter:'anthropic',endpoint:'https://api.anthropic.com/v1'},
 {id:'minimax-cn',name:'MiniMax · 中国区',adapter:'anthropic',endpoint:'https://api.minimax.cn/anthropic/v1'},
 {id:'minimax',name:'MiniMax · 国际区',adapter:'anthropic',endpoint:'https://api.minimax.io/anthropic/v1'},
 {id:'deepseek',name:'DeepSeek',adapter:'openai-compatible',endpoint:'https://api.deepseek.com'},
 {id:'openrouter',name:'OpenRouter',adapter:'openai-compatible',endpoint:'https://openrouter.ai/api/v1'},
 {id:'perplexity',name:'Perplexity',adapter:'openai-compatible',endpoint:'https://api.perplexity.ai'},
 {id:'nvidia',name:'NVIDIA NIM',adapter:'openai-compatible',endpoint:'https://integrate.api.nvidia.com/v1'},
 {id:'opencode',name:'OpenCode Zen',adapter:'openai-compatible',endpoint:'https://opencode.ai/zen/v1'},
 {id:'opencode-go',name:'OpenCode Go',adapter:'openai-compatible',endpoint:'https://opencode.ai/zen/go/v1'},
 {id:'azure',name:'Azure AI Foundry',adapter:'azure',endpoint:'',requiresEndpoint:true},
 {id:'amazon-bedrock',name:'Amazon Bedrock',adapter:'bedrock',endpoint:'https://bedrock.us-east-1.amazonaws.com',requiresRegion:true},
 {id:'xai',name:'xAI',adapter:'openai-compatible',endpoint:'https://api.x.ai/v1'},
 {id:'siliconflow-cn',name:'硅基流动 · 中国区',adapter:'openai-compatible',endpoint:'https://api.siliconflow.cn/v1'},
 {id:'siliconflow',name:'SiliconFlow · 国际区',adapter:'openai-compatible',endpoint:'https://api.siliconflow.com/v1'},
 {id:'alibaba-cn',name:'阿里云百炼 · 中国区',adapter:'openai-compatible',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1'},
 {id:'alibaba',name:'Alibaba Cloud · 国际区',adapter:'openai-compatible',endpoint:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'},
 {id:'moonshot-cn',name:'月之暗面 · 中国区',adapter:'openai-compatible',endpoint:'https://api.moonshot.cn/v1'},
 {id:'moonshotai',name:'Moonshot AI · 国际区',adapter:'openai-compatible',endpoint:'https://api.moonshot.ai/v1'},
 {id:'zhipuai',name:'智谱 AI',adapter:'openai-compatible',endpoint:'https://open.bigmodel.cn/api/paas/v4'},
 {id:'zai',name:'Z.AI · 国际区',adapter:'openai-compatible',endpoint:'https://api.z.ai/api/paas/v4'},
];
PROVIDER_PRESETS.push(...ccOfficialPresets);
const brandIcons={openai:'openai',google:'gemini',anthropic:'anthropic',minimax:'minimax',deepseek:'deepseek',openrouter:'openrouter',perplexity:'perplexity',nvidia:'nvidia',opencode:'opencode', 'opencode-go':'opencode',azure:'azure','amazon-bedrock':'amazon-bedrock',xai:'xai',siliconflow:'siliconflow',alibaba:'alibaba',moonshot:'kimi',moonshotai:'kimi',zhipuai:'zhipu',zai:'zhipu'};
for(const p of PROVIDER_PRESETS)p.icon ||= brandIcons[p.id]||brandIcons[p.id.replace(/-cn$/,'')];
export const PROTOCOLS=[
 {id:'openai-compatible',name:'OpenAI Chat Completions'},
 {id:'openai-responses',name:'OpenAI Responses'},
 {id:'anthropic',name:'Anthropic Messages'},
 {id:'azure',name:'Azure OpenAI-compatible (api-key)'},
 {id:'bedrock',name:'Amazon Bedrock ConverseStream'},
];
// Service definitions are form presets only; no runtime readiness is inferred.
export const REALTIME_PRESETS=[
 {id:'qwen-realtime',name:'千问 AI · Qwen-Audio-3.0-Realtime-Plus',icon:'qianwenai',adapter:'qwen-realtime',endpoint:'wss://maas.qianwenaiapi.com/api-ws/v1/realtime',model:'qwen-audio-3.0-realtime-plus'},
 {id:'volc-realtime',name:'豆包实时语音 · 火山引擎',icon:'doubao',adapter:'volc-realtime',endpoint:'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue',model:'1.2.6.1',fixedModel:true},
 {id:'openai-realtime',name:'OpenAI Realtime',icon:'openai',adapter:'openai-realtime',endpoint:'wss://api.openai.com/v1/realtime'},
 {id:'gemini-live',name:'Google Gemini Live',icon:'gemini',adapter:'gemini-live',endpoint:'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'},
];
export const REALTIME_PROTOCOLS=[{id:'qwen-realtime',name:'千问实时语音'},{id:'volc-realtime',name:'豆包 Seeduplex'},{id:'openai-realtime',name:'OpenAI Realtime'},{id:'gemini-live',name:'Gemini Live'},{id:'custom-realtime',name:'自定义实时语音协议'}];
export function presetsFor(service='llm'){return service==='realtime'?REALTIME_PRESETS:PROVIDER_PRESETS;}
export function presetFor(provider) {
 return presetsFor(provider.service).find(p=>(p.requiresEndpoint?p.name===provider.name:p.endpoint.replace(/\/$/,'')===provider.endpoint?.replace(/\/$/,'')) && p.adapter===provider.adapter)?.id||'custom';
}
export function newProvider(id='openai',service='llm') {
 const preset=presetsFor(service).find(p=>p.id===id);
 return {provider_id:'',service,name:preset?.name||'',adapter:preset?.adapter||(service==='realtime'?'custom-realtime':'openai-compatible'),endpoint:preset?.endpoint||'',credential_state:'missing',preset:id,...(preset?.requiresEndpoint?{requiresEndpoint:true}:{})};
}
export function selectPreset(editor,id) {
 const next=newProvider(id,editor.service);
 return {...next,provider_id:editor.provider_id,credential_state:editor.credential_state};
}
export function credentialEdit(provider) {return provider?.credential_state==='present'?'keep':'replace';}
