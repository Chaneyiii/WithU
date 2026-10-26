import {useEffect,useState} from 'react';
import Icon from './Icon';
import {desktopBridge} from '../desktop-bridge';
import {configuredModels,modelMetadata,discover,saveProviderModels} from './ChatModelPicker';
import ModelParameters from './ModelParameters';
import ProviderLogo from './ProviderLogo';
import {PROVIDER_PRESETS,presetFor} from '../model-config/providers.mjs';
export default function ProviderDetails({provider,onBack,onEdit,onDelete}){
 const [items,setItems]=useState([]),[filter,setFilter]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const wire={provider_id:provider.provider_id,display_name:provider.name,endpoint:provider.endpoint,protocol:provider.adapter};
 useEffect(()=>{let disposed=false;(async()=>{try{const b=desktopBridge(),c=(await b.configGet()).config,stored=await b.viewGet({id:'client'}),cached=stored.object?.overrides?.providerModels?.[provider.provider_id];
 const list=cached?.endpoint===provider.endpoint?cached.items:(await configuredModels(c)).filter(m=>m.providerId===provider.provider_id).map(m=>({id:m.id}));if(!disposed)setItems(list);
 }catch{if(!disposed)setNotice('无法加载模型目录。');}})();return()=>{disposed=true;};},[provider.provider_id,provider.endpoint]);
 const update=async next=>{setBusy(true);try{await saveProviderModels(wire,next);setItems(next);setNotice('模型显示设置已保存。');}catch{setNotice('模型显示设置未保存，请重试。');}finally{setBusy(false);}};
 const refresh=async()=>{setBusy(true);try{const b=desktopBridge(),c=(await b.configGet()).config,found=await discover(b,wire,c.config_version);const next=found.map(m=>({id:m.id,hidden:items.find(i=>i.id===m.id)?.hidden||false}));await saveProviderModels(wire,next);setItems(next);setNotice('模型目录已更新。');}catch{setNotice('无法更新模型目录，请检查服务配置。');}finally{setBusy(false);}};
 return <div className="provider-details">
 <div className="provider-detail-heading"><button aria-label="返回提供商" onClick={onBack}><Icon name="chevronLeft" size={18}/></button><h3 className="provider-name"><ProviderLogo icon={PROVIDER_PRESETS.find(v=>v.id===presetFor(provider))?.icon}/>{provider.name}</h3><button disabled={busy} onClick={onDelete}>删除提供商</button></div>
 <section className="provider-detail-section"><div className="provider-detail-heading"><h3>账号</h3><button onClick={onEdit}>{provider.credential_state==='present'?'管理账号':'添加账号'}</button></div><div className="provider-account-row"><Icon name="lock" size={22}/><span>{provider.name}<small>{provider.credential_state==='present'?'API 密钥 · 已保存在系统凭据库':'尚未设置 API 密钥'}</small></span><button aria-label="编辑账号" onClick={onEdit}>···</button></div></section>
 <section className="provider-detail-section"><div className="provider-detail-heading"><h3>可用模型 ({items.length})</h3><div><button disabled={busy} onClick={()=>void update(items.map(m=>({...m,hidden:true})))}>全部隐藏</button><button disabled={busy} onClick={()=>void update(items.map(m=>({...m,hidden:false})))}>全部显示</button><button disabled={busy} onClick={()=>void refresh()}>更新目录</button></div></div>
 <input type="search" aria-label="筛选模型" placeholder="筛选模型…" value={filter} onChange={e=>setFilter(e.target.value)}/>
 {items.filter(m=>m.id.toLowerCase().includes(filter.toLowerCase())).map(m=>{const metadata=modelMetadata(wire,m.id);return <div className="provider-model-row" key={m.id}><span>{metadata?.name||m.id}<small>{m.id}</small></span><ModelParameters metadata={metadata}/><button aria-label={(m.hidden?'显示 ':'隐藏 ')+m.id} aria-pressed={!m.hidden} disabled={busy} onClick={()=>void update(items.map(i=>i.id===m.id?{...i,hidden:!i.hidden}:i))}>{m.hidden?<Icon name="eyeOff" size={18}/>:<Icon name="eye" size={18}/>}</button></div>;})}</section>
 {notice&&<p role="status">{notice}</p>}</div>;
}
