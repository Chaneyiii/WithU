import {useEffect,useRef,useState} from 'react';
import LiveGlass from './LiveGlass';

// The same five-second level history, now rendered as separate optical panes.
const BAR_COUNT=30;
export default function LiveMeter({level=0}){
 const current=useRef(level),[bars,setBars]=useState(()=>Array(BAR_COUNT).fill(.1));
 current.current=level;
 useEffect(()=>{
  let amplitude=0;
  const samples=setInterval(()=>{amplitude+=.35*(Math.max(0,Math.min(1,current.current))-amplitude);},50);
  const history=setInterval(()=>setBars(previous=>[...previous.slice(1),Math.max(.1,Math.max(0,amplitude-.03)**.55*.5)]),5000/BAR_COUNT);
  return()=>{clearInterval(samples);clearInterval(history);};
 },[]);
 return <div className="live-meter" role="status" aria-label="正在聆听">{bars.map((height,index)=><div className="live-meter-bar" key={index} style={{transform:`scaleY(${height})`,opacity:Math.min(1,(index+1)/4,(BAR_COUNT-index)/4)}}><LiveGlass className="meter-glass-pane" glassClassName="meter-liquid-glass" displacementScale={6} blurAmount={.1} cornerRadius={2}/></div>)}</div>;
}
