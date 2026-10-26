import LiquidGlass from 'liquid-glass-react';
import {useLayoutEffect,useRef} from 'react';

export default function LiveGlass({children,className='live-glass-pane',glassClassName='stage-liquid-glass',displacementScale=100,blurAmount=.5,cornerRadius=32}){
 const pane=useRef(null);
 useLayoutEffect(()=>{
  const warp=pane.current.querySelector('.glass__warp');
  // Sample the stage before the library's transformed/clipped content group.
  // Keep its SVG optics and blur, but apply both to the actual backdrop plane.
  pane.current.style.backdropFilter=`${warp.style.backdropFilter} ${warp.style.filter}`;
 },[]);
 return <div ref={pane} className={className}><LiquidGlass className={`backdrop-glass ${glassClassName}`} mode="standard" displacementScale={displacementScale} blurAmount={blurAmount} saturation={140} aberrationIntensity={2} elasticity={0} cornerRadius={cornerRadius} padding="0" style={{position:'absolute',top:'50%',left:'50%',width:'100%',height:'100%'}}>{children}</LiquidGlass></div>;
}
