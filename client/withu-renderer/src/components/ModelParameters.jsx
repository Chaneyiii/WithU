// Reference metadata from models.dev; absent fields remain unknown.
export default function ModelParameters({metadata:m}) {
 if(!m)return <small className="model-parameters">models.dev 暂无此模型参数</small>;
 const number=v=>v==null?'未知':Number(v).toLocaleString();
 const modes={text:'文字',image:'图像',audio:'音频',video:'视频',pdf:'PDF'};
 const effort=(Array.isArray(m.reasoning_options)?m.reasoning_options:[]).find(o=>o.type==='effort');
 return <small className="model-parameters">
  <span>上下文 {number(m.limit?.context)} · 最大输出 {number(m.limit?.output)}</span>
  <span>输入 {(m.modalities?.input||[]).map(v=>modes[v]||v).join('／')||'未知'} · 输出 {(m.modalities?.output||[]).map(v=>modes[v]||v).join('／')||'未知'}</span>
  <span>思考 {effort?effort.values.join('／'):m.reasoning?'支持':'不支持'} · 工具 {m.tool_call?'支持':'不支持'}</span>
  {m.cost&&<span>每百万 token：输入 ${number(m.cost.input)} · 输出 ${number(m.cost.output)}{m.cost.cache_read!=null?` · 缓存读取 $${number(m.cost.cache_read)}`:''}</span>}
  <span>参数来源：models.dev</span>
 </small>;
}
