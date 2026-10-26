import {resolveOrbState} from './states.mjs';
const choose=(items,random)=>items[Math.min(items.length-1,Math.floor(random()*items.length))];
// Only presentation timing: no audio capture, inference or persistence.
export class OrbBehavior {
 constructor(ball,{random=Math.random,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}={}){this.ball=ball;this.random=random;this.schedule=schedule;this.cancel=cancel;this.base='idle';}
 clear(){this.cancel(this.timer);this.timer=null;}
 baseState(mood,presence){this.base=resolveOrbState(mood,presence);if(presence==='interrupted'){this.cue('interrupted');return;}if(this.timer&&['listening','thinking'].includes(presence))return;this.clear();this.ball.setState(this.base);}
 temporary(state,ms,after){this.clear();this.ball.setState(state);this.timer=this.schedule(()=>{this.timer=null;this.ball.setState(after());},ms);}
 interact(){this.temporary('curious',4000,()=>choose(['idle','happy','wink'],this.random));}
 cue(kind){if(kind==='interrupted')this.temporary(choose(['angry','waiting'],this.random),2500,()=>this.base);else if(kind==='reply-ended')this.temporary('music',3500,()=>this.base);}
 destroy(){this.clear();}
}
