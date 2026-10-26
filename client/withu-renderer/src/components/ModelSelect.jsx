import ProviderLogo from './ProviderLogo';
import {Children,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

/** One shared dropdown for model settings, with viewport-safe portal placement. */
export default function ModelSelect({children,value,onChange,disabled,id,...accessibility}) {
 const options=Children.toArray(children).flatMap(child=>child.type===Symbol.for('react.fragment')?Children.toArray(child.props.children):[child]).filter(Boolean);
 const uid=useId(),trigger=useRef(null),menu=useRef(null);
 const [open,setOpen]=useState(false),[active,setActive]=useState(0),[position,setPosition]=useState(null);
 const selected=options.findIndex(o=>String(o.props.value??o.props.children)===String(value));
 const label=options[selected>=0?selected:0]?.props.children;
 const enabled=options.map((o,i)=>o.props.disabled?-1:i).filter(i=>i>=0);
 const close=()=>{setOpen(false);trigger.current?.focus();};
 const choose=index=>{const option=options[index];if(!option||option.props.disabled)return;onChange?.({target:{value:String(option.props.value??option.props.children)}});close();};
 const show=()=>{if(disabled)return;setActive(selected>=0?selected:enabled[0]??0);setOpen(true);};
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{const rect=trigger.current.getBoundingClientRect();const height=Math.min(options.length*38+14,280);const below=innerHeight-rect.bottom-16;const above=rect.top-16;const up=below<height&&above>below;const maxHeight=Math.max(60,Math.min(height,up?above:below));setPosition({left:Math.max(8,Math.min(rect.left,innerWidth-rect.width-8)),top:up?rect.top-maxHeight-6:rect.bottom+6,width:rect.width,maxHeight});};
  place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open,options.length]);
 useEffect(()=>{
  if(!open)return;
  const outside=e=>{if(!trigger.current?.contains(e.target)&&!menu.current?.contains(e.target))setOpen(false);};
  const blur=()=>setOpen(false);
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);window.addEventListener('blur',blur);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);window.removeEventListener('blur',blur);};
 },[open]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{if(open)menu.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[open,active]);
 const keyboard=e=>{
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();if(!open){show();return;}let index=enabled.indexOf(active);setActive(e.key==='Home'?enabled[0]:e.key==='End'?enabled.at(-1):enabled[(index+(e.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length]);}
  else if(e.key==='Enter'||e.key===' '){e.preventDefault();open?choose(active):show();}
  else if(e.key==='Escape'){e.preventDefault();close();}
  else if(e.key==='Tab')setOpen(false);
 };
 return <><button type="button" {...accessibility} id={id} ref={trigger} className="model-select-trigger" role="combobox" disabled={disabled} aria-expanded={open} aria-haspopup="listbox" aria-controls={open?uid:undefined} aria-activedescendant={open?`${uid}-${active}`:undefined} onKeyDown={keyboard} onClick={()=>open?setOpen(false):show()}><span className="model-option-label"><ProviderLogo icon={options[selected>=0?selected:0]?.props['data-icon']}/>{label}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
 {open&&position&&createPortal(<div ref={menu} id={uid} className="model-select-menu" role="listbox" style={position}>{options.map((option,index)=><div key={option.key??index} id={`${uid}-${index}`} role="option" aria-selected={index===selected} aria-disabled={option.props.disabled||undefined} data-option-index={index} className={'model-select-option'+(active===index?' is-active':'')} onPointerMove={()=>!option.props.disabled&&setActive(index)} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(index)}><span className="model-option-label"><ProviderLogo icon={option.props['data-icon']}/>{option.props.children}</span>{index===selected&&<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}</div>)}</div>,document.body)}</>;
}

