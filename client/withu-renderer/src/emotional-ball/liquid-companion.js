// Adapted from the user-selected voice-orb.html, thread 01a1366d-6065-7672-a6f6-0b4c3920e894.
// Rendering only: no microphone, network, dialogue, storage or inferred user emotion.
import {ORB_STATES,MOOD_TO_ORB} from './states.mjs';
export class LiquidCompanion{
constructor(stage){
this.stage=stage;stage.innerHTML='<canvas class="orb-material" aria-hidden="true"></canvas><canvas class="orb-face" aria-hidden="true"></canvas>';this.canvas=stage.querySelector('.orb-material');this.face=stage.querySelector('.orb-face');this.ctx=this.face.getContext('2d');this.state='idle';this.t=0;this.real=0;this.last=0;this.volume=0;this.energy=0;this.replyBars=[24,36,24];this.hasVolume=false;this.weights={happy:0,sleepy:0,music:0,curious:0,angry:0,sad:0,waiting:0,voice:0};this.gaze={x:0,y:0};this.pointer={x:0,y:0};this.position={x:0,y:0};this.velocity={x:0,y:0};this.target={x:0,y:0};this.dragging=false;this.press=0;this.pressTarget=0;this.bounce=0;this.blinkAt=2.2;this.blinkStart=-10;this.winkStart=-10;this.lastInteraction=0;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.ready=false;this.dead=false;this.stateTime=0;this.nextWink=0;this.pose={roll:0,pitch:0,drop:0,shock:0,eye:1};
this.gl=this.canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,powerPreference:'low-power'});try{if(!this.gl)throw Error('WebGL unavailable');this.initGL();this.ready=true;}catch(e){this.stage.dataset.material='canvas';if(this.gl){this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);}const fallback=document.createElement('canvas');fallback.className='orb-material';fallback.setAttribute('aria-hidden','true');this.canvas.replaceWith(fallback);this.canvas=fallback;this.gl=null;}
this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.stage);this.resize();this.onLost=e=>{e.preventDefault();this.ready=false;};this.onRestored=()=>{try{this.initGL();this.resize();this.ready=true;}catch(e){console.warn(e);}};this.canvas.addEventListener('webglcontextlost',this.onLost);this.canvas.addEventListener('webglcontextrestored',this.onRestored);this.tick=this.tick.bind(this);this.raf=requestAnimationFrame(this.tick);
}
setState(name){if(!ORB_STATES.includes(name))name='idle';if(this.state!==name){this.stateTime=0;this.interact();}this.state=name;this.stage.dataset.state=name;if(name==='wink')this.wink();}
setMood(name){this.setState(MOOD_TO_ORB[name]||name);}
setManaged(value){this.managed=value;}
setGazeFocus(x,y){const b=this.stage.getBoundingClientRect();this.pointer.x=Math.max(-1,Math.min(1,(x-b.left-b.width/2)/(b.width*.38)));this.pointer.y=Math.max(-1,Math.min(1,(y-b.top-b.height/2)/(b.height*.38)));}

clearGazeFocus(){this.pointer={x:0,y:0};}
clearVolume(){this.hasVolume=false;this.volume=0;}
showRibbons(){this.ribbonUntil=this.real+2.2;}
drawMaterialFallback(){const canvas=this.canvas;if(!this.fallback)this.fallback=canvas.getContext('2d');const c=this.fallback;if(!c)return;const w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);const x=w/2,y=h/2,r=Math.min(w,h)*.256;const g=c.createRadialGradient(x-r*.3,y-r*.3,r*.05,x,y,r);g.addColorStop(0,'#FFC300');g.addColorStop(.7,this.state==='angry'?'#fa527b':this.state==='sad'?'#a8abb5':'#FF7A29');g.addColorStop(1,'#edf5ff');c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
initGL(){const gl=this.gl;
const vertex=`attribute vec2 a; varying vec2 uv; void main(){uv=a*.5+.5;gl_Position=vec4(a,0.,1.);}`;
const fragment=`precision highp float;
varying vec2 uv;uniform vec2 u_res,u_pos,u_gaze;uniform float u_time,u_haloTime,u_energy,u_press,u_bounce;uniform vec4 u_feel,u_mood,u_pose;
mat2 rotate(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 transform(vec3 p){
  float tilt=u_pose.x+sin(u_time*.85)*(.012+u_feel.x*.04+u_feel.z*.04);
  p.xy=rotate(-tilt)*(p.xy-u_pos-vec2(-u_gaze.x*u_feel.w*1.35,-u_pose.z));
  p.y-=sin(u_time*1.1)*.018+u_bounce;
  float squash=u_press*.07;p.x/=1.+squash;p.y/=1.-squash;
  return p;
}
float field(vec3 p){return length(transform(p))-.78;}
vec3 normalAt(vec3 p){vec2 e=vec2(.003,0);return normalize(vec3(field(p+e.xyy)-field(p-e.xyy),field(p+e.yxy)-field(p-e.yxy),field(p+e.yyx)-field(p-e.yyx)));}
void main(){
vec2 screen=(uv-.5)*u_res/min(u_res.x,u_res.y)*3.05;
vec3 ro=vec3(screen,3.),rd=vec3(0.,0.,-1.);float dist=1.65,hit=0.;vec3 p;
for(int i=0;i<44;i++){p=ro+rd*dist;float h=field(p);if(h<.0025){hit=1.;break;}dist+=h*.9;if(dist>4.6)break;}
if(hit<.5){
  // The halo has its own fixed stage coordinates and animation clock.
  vec2 haloPoint=screen;
  float angle=atan(haloPoint.y,haloPoint.x),time=u_haloTime;
  float gap=max(0.,length(haloPoint)-.78);
  float current=sin(angle*2.-time*.72)*.5+sin(angle*3.+time*.43)*.25;
  // Each broad sector inhales on its own phase; no shared radial scale.
  float breath=sin(angle*2.-time*1.22+sin(time*.37)*.55)*.50
              +sin(angle*3.+time*.87+1.4)*.30
              +sin(angle-time*.53-1.1)*.20;
  float spread=.19+current*.025+breath*.07;
  float halo=exp(-pow(gap/spread,2.))*(.40+.07*sin(angle-time*.62));
  float tint=.5+.5*sin(angle-time*.55+sin(angle*2.+time*.31)*.45-gap*3.);
  vec3 haloColor=mix(vec3(1.,.62,.30),vec3(1.,.83,.25),tint);
  gl_FragColor=vec4(haloColor,halo);return;
}
vec3 n=normalAt(p),q=transform(p)/.78;float t=u_time;
// The shell stays circular. Only broad flowing color masses live inside it.
vec3 flow=q;flow.xz=rotate(t*.28)*flow.xz;flow.yz=rotate(u_pose.y*.26)*flow.yz;
// Continuous low-frequency advection; no lattice noise or thresholded fragments.
vec2 warp=vec2(sin(flow.y*2.5+t*.61)+sin(flow.z*2.1-t*.47),cos(flow.x*2.3-t*.57)+sin(flow.y*1.8+t*.49))*.075;
vec2 liquid=q.xy+warp*(1.+u_energy*u_mood.w*.35);
vec2 blueCenter=vec2(-.10+sin(t*.95)*.28,.38+cos(t*.75)*.18);
vec2 purpleCenter=vec2(.10+cos(t*.83)*.31,-.24+sin(t*.98)*.34);
float blue=exp(-dot((liquid-blueCenter)/vec2(.74,.81),(liquid-blueCenter)/vec2(.74,.81)));
float purple=exp(-dot((liquid-purpleCenter)/vec2(.66,.53),(liquid-purpleCenter)/vec2(.66,.53)));
float cyan=exp(-dot((liquid-vec2(.36+sin(t*.91)*.24,.20+cos(t*.66)*.22))/vec2(.47,.68),(liquid-vec2(.36+sin(t*.91)*.24,.20+cos(t*.66)*.22))/vec2(.47,.68)));
vec3 orange=vec3(1.,122./255.,41./255.);
vec3 warmYellow=vec3(1.,195./255.,0.);
float warmBlend=smoothstep(.22,.78,(blue+cyan*.47)/(blue+cyan*.47+purple+.001));
vec3 pigment=mix(orange,warmYellow,warmBlend);
// All moods recolor these same three broad, smoothly moving masses.
vec3 anger=mix(vec3(1.,.91,.94),vec3(.99,.09,.19),blue*.99);
anger=mix(anger,vec3(1.,.34,.26),cyan*.40);
anger=mix(anger,vec3(1.,.26,.42),purple*.94);
pigment=mix(pigment,anger,u_mood.x);
float gray=dot(pigment,vec3(.2126,.7152,.0722))*.72+.16;
pigment=mix(pigment,vec3(gray),u_mood.y);
float r=length(q.xy);vec3 color=pigment;
// Thick milky glass volume with a fine white reflection, rather than a colored outline.
float shell=smoothstep(.773,.96,r);color=mix(color,vec3(.985,.99,1.),shell*.95);
float inner=exp(-pow((r-.86)/.06,2.));color=mix(color,vec3(.78,.85,.97),inner*.07);
float bevel=exp(-pow((r-.933)/.037,2.));color=mix(color,vec3(.97,.985,1.),bevel*.30);
float outer=exp(-pow((r-.973)/.014,2.));color=mix(color,vec3(1.),outer*.78);
float highlight=exp(-pow((q.y-.88)/.045,2.))*exp(-pow((q.x+.22)/.33,2.));color=mix(color,vec3(1.),highlight*.45);
vec3 reflection=reflect(rd,n);float sheen=pow(max(dot(reflection,normalize(vec3(-.75,1.15,1.1))),0.),17.);color=mix(color,vec3(1.),sheen*.17);
gl_FragColor=vec4(clamp(color,0.,1.),1.);}`;
const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(this.program);const b=gl.createBuffer();this.buffer=b;gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(this.program,'a');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);this.u={};for(const k of ['res','pos','gaze','time','haloTime','energy','press','bounce','feel','mood','pose'])this.u[k]=gl.getUniformLocation(this.program,'u_'+k);
}
resize(){const b=this.stage.getBoundingClientRect();this.w=b.width;this.h=b.height;this.dpr=Math.min(devicePixelRatio||1,1.5);const d=Math.min(this.dpr,720/Math.max(this.w,this.h));this.canvas.width=Math.round(this.w*d);this.canvas.height=Math.round(this.h*d);this.face.width=Math.round(this.w*this.dpr);this.face.height=Math.round(this.h*this.dpr);if(this.gl)this.gl.viewport(0,0,this.canvas.width,this.canvas.height);}
interact(){this.lastInteraction=this.real;}setVolume(v){this.volume=Math.max(0,Math.min(1,Number(v)||0));this.hasVolume=true;}
wink(){this.winkStart=this.real;this.winkSide=Math.random()<.5?0:1;this.nextWink=this.real+1.8+Math.random()*1.8;}
updatePose(dt){
 const p=this.pose;let roll=0,pitch=0,drop=0,shock=0,eye=1,phase='awake';
 const time=this.stateTime;
 if(this.state==='sleepy'){
  const cycle=time%7.2;
  if(cycle<3.8){const progress=Math.min(1,cycle/3.8);pitch=progress*progress*.96;drop=pitch*.15;eye=0;phase='nodding';}
  else if(cycle<4.03){const progress=(cycle-3.8)/.23;const ease=1-Math.pow(1-progress,3);pitch=.96-(1.20*ease);drop=.145-.195*ease;shock=ease;eye=1.25;phase='startled';}
  else if(cycle<5.05){const elapsed=cycle-4.03;pitch=-.24*Math.exp(-elapsed*3);drop=-.05*Math.exp(-elapsed*3);roll=Math.sin(elapsed*43)*.18*Math.exp(-elapsed*2.8);shock=Math.exp(-elapsed*3);eye=1+.25*shock;phase='shaking';}
  else {const elapsed=cycle-5.05;eye=1;pitch=0;drop=0;phase='settling';}
 }else if(this.state==='curious'){
  // The face looks toward the pointer while the head tilts in the opposite direction.
  roll=-this.pointer.x*.24+Math.sin(time*6.2)*.055*Math.abs(this.pointer.x);
  pitch=this.pointer.y*.07;phase='opposite-tilt';
 }else if(this.state==='listening'){
  roll=-this.pointer.x*.11+Math.sin(time*2)*.024;
  pitch=.10+Math.sin(time*3.2)*(.04+this.energy*.09);drop=this.energy*.022;phase='attentive';
 }else if(this.state==='speaking'){
  roll=Math.sin(time*4.6)*(.045+this.energy*.095);pitch=Math.sin(time*5.4)*.035;drop=-Math.abs(Math.sin(time*3))*.025;phase='responding';
 }else if(this.state==='waiting'){
  roll=Math.sin(time*1.8)*.055;phase='waiting';
 }
 const ease=1-Math.exp(-dt*(this.state==='sleepy'?32:9));
 p.roll+=(roll-p.roll)*ease;p.pitch+=(pitch-p.pitch)*ease;p.drop+=(drop-p.drop)*ease;p.shock=shock;p.eye=eye;
 this.stage.dataset.phase=phase;this.stage.dataset.tilt=p.roll.toFixed(3);this.stage.dataset.focus=this.pointer.x.toFixed(3);
 this.stage.dataset.wink=this.state==='wink'?(this.winkSide===0?'left':'right'):'both';
}
tick(ms){
 if(this.dead)return;const dt=Math.min(.045,(ms-(this.last||ms))/1000);this.last=ms;
 if(!document.hidden&&this.w>0&&this.h>0){
  this.real+=dt;this.stateTime+=dt*(this.reduced?.1:1);
  this.t+=dt*(this.reduced?.16:1)*(this.state==='sleepy'?.7:this.state==='speaking'?1.6+this.energy:this.state==='listening'?1.15+this.energy:1.12);
  const targets={happy:this.state==='happy'?1:0,sleepy:this.state==='sleepy'?1:0,music:this.state==='music'?1:0,curious:['curious','wink'].includes(this.state)?1:0,angry:this.state==='angry'?1:0,sad:this.state==='sad'?1:0,waiting:this.state==='waiting'?1:0,voice:['listening','speaking'].includes(this.state)?1:0};
  for(const key in this.weights)this.weights[key]+=(targets[key]-this.weights[key])*(1-Math.exp(-dt*(key==='angry'?1.3:key==='sad'?1.8:4)));
  const automatic=Math.max(0,Math.sin(this.t*4.3)+Math.sin(this.t*7.1)*.3)*.5;
  const input=this.hasVolume?this.volume:automatic;this.energy+=(input-this.energy)*(1-Math.exp(-dt*9));this.press+=(this.pressTarget-this.press)*(1-Math.exp(-dt*12));
  for(const key of ['x','y']){this.velocity[key]+=(this.target[key]-this.position[key])*70*dt;this.velocity[key]*=Math.exp(-dt*8);this.position[key]+=this.velocity[key]*dt;this.gaze[key]+=(this.pointer[key]*.067-this.gaze[key])*(1-Math.exp(-dt*6));}
  this.updatePose(dt);this.bounce*=Math.exp(-dt*5.5);
  if(this.state==='wink'&&this.real>this.nextWink)this.wink();
  if(this.ready){const g=this.gl,w=this.weights,p=this.pose;g.uniform2f(this.u.res,this.canvas.width,this.canvas.height);g.uniform2f(this.u.pos,this.position.x,this.position.y);g.uniform2f(this.u.gaze,this.gaze.x,this.gaze.y);g.uniform1f(this.u.time,this.t);g.uniform1f(this.u.haloTime,this.real*(this.reduced?.16:1));g.uniform1f(this.u.energy,this.energy);g.uniform1f(this.u.press,this.press);g.uniform1f(this.u.bounce,this.bounce);g.uniform4f(this.u.feel,w.happy,w.sleepy,w.music,w.curious);g.uniform4f(this.u.mood,w.angry,w.sad,w.waiting,w.voice);g.uniform4f(this.u.pose,p.roll,p.pitch,p.drop,p.shock);g.drawArrays(g.TRIANGLES,0,6);}
  if(!this.ready)this.drawMaterialFallback();
  this.drawFace(dt);
  if(!this.managed&&this.state==='idle'&&this.real-this.lastInteraction>20)this.setState('sleepy');
 }
 this.raf=requestAnimationFrame(this.tick);
}
eyePath(c,x,y,kind,open,side,color='#fff'){
 c.save();c.translate(x,y);c.scale(1,Math.max(.07,open));c.fillStyle=color;c.strokeStyle=color;c.lineCap='round';c.lineWidth=12;
 if(kind==='closed'){c.beginPath();c.moveTo(-14,0);c.lineTo(14,0);c.lineWidth=6;c.stroke();}
 else if(kind==='happy'){c.beginPath();c.moveTo(-13,3);c.quadraticCurveTo(0,-14,13,3);c.stroke();}
 else if(kind==='music'){c.beginPath();c.moveTo(-13,-3);c.quadraticCurveTo(0,14,13,-3);c.stroke();}
 else if(kind==='wink'){c.beginPath();c.moveTo(-14,3);c.quadraticCurveTo(0,-12,14,3);c.stroke();}
 else if(kind==='angry'){c.beginPath();if(side===0){c.moveTo(-16,-9);c.quadraticCurveTo(-1,9,14,8);}else{c.moveTo(-14,8);c.quadraticCurveTo(1,9,16,-9);}c.stroke();}
 else{c.beginPath();c.roundRect(-16.5,-19,33,38,16.5);c.fill();}
 c.restore();
}
note(c,x,y,s,a,color){c.save();c.translate(x,y);c.rotate(a);c.scale(s,s);c.strokeStyle=color;c.fillStyle=color;c.lineWidth=3.7;c.lineCap='round';c.beginPath();c.moveTo(0,0);c.lineTo(0,-18);c.lineTo(12,-22);c.lineTo(12,-4);c.stroke();c.beginPath();c.ellipse(-4,1,5.8,4.2,-.6,0,Math.PI*2);c.ellipse(8,-3,5.8,4.2,-.6,0,Math.PI*2);c.fill();c.restore();}
drawFace(dt=1/60){
 const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.w,this.h);
 const s=this.w/500,t=this.t,w=this.weights,p=this.pose;c.save();c.translate(this.w/2,this.h/2);c.scale(s,s);
 const surrounding=Math.max(w.happy,w.music,w.angry,w.sad);
 if(surrounding>.01){for(let i=0;i<5;i++){const a=t*(.25+i*.035)+i*1.256,r=140+(i%2)*22;c.globalAlpha=surrounding*(.35+i*.1);c.fillStyle=w.sad>.5?'#b5b5b8':['#61dff1','#e1a0fa','#faafdf','#b6a5ff','#7bf0d5'][i];c.beginPath();c.arc(Math.cos(a)*r,Math.sin(a)*r*.85,1.8+(i%2)*1.2,0,Math.PI*2);c.fill();}}
 c.globalAlpha=1;
 if(w.music>.01){c.globalAlpha=w.music;for(let i=0;i<4;i++){const phase=(t*.19+i*.25)%1,a=-Math.PI*.9+i*.9+t*.1,r=132+phase*40;this.note(c,Math.cos(a)*r,Math.sin(a)*r,.62+phase*.22,Math.sin(t+i)*.35,['#66d6f0','#a98ae9','#e2a0d4','#75bbf9'][i]);}c.globalAlpha=1;}
 if(w.angry>.01){c.globalAlpha=w.angry;c.strokeStyle='#c590ba';c.lineWidth=3.5;c.beginPath();for(let i=0;i<4;i++){const a=i*Math.PI/2+.45;c.moveTo(118+Math.cos(a)*6,-70+Math.sin(a)*6);c.lineTo(118+Math.cos(a)*13,-70+Math.sin(a)*13);}c.stroke();c.globalAlpha=1;}
 const tilt=p.roll+Math.sin(t*.85)*(.012+w.happy*.04+w.music*.04);
 c.translate((this.position.x-this.gaze.x*w.curious*1.35)*500/3.05,-this.position.y*500/3.05+p.drop*500/3.05-Math.sin(t*1.1)*500/3.05*.018-this.bounce*500/3.05);
 c.rotate(this.state==='speaking'?0:tilt);c.scale(1+this.press*.07,1-this.press*.07);
 const waitingGaze=w.waiting*Math.sin(this.stateTime*1.9)*12;
 const faceGaze=this.state==='speaking'?0:1;
 c.translate(this.gaze.x*135*faceGaze+waitingGaze,this.state==='speaking'?0:this.gaze.y*135+6+p.pitch*24);
 if(this.real>this.blinkAt){this.blinkStart=this.real;this.blinkAt=this.real+2.5+Math.random()*3.5;}
 const blinkPhase=this.real-this.blinkStart;
 const blink=blinkPhase>=0&&blinkPhase<.23?1-Math.sin(blinkPhase/.23*Math.PI)*.96:1;
 let kind=this.state;
 if(kind==='sleepy')kind=p.eye<.5?'closed':'idle';
 const sadness=w.sad;const eyeColor='#fff';
 if(this.state==='speaking'){
  c.fillStyle=eyeColor;
  const phase=(this.stateTime*(this.reduced?.35:4.8)/(Math.PI*2))%1;
  const sweep=2-phase*3;
  const amplitude=this.hasVolume?this.energy:.72+Math.sin(this.real*1.3)*.08;
  for(let i=0;i<3;i++){
   const distance=i-sweep;
   const pulse=[distance-3,distance,distance+3].reduce((sum,d)=>sum+Math.exp(-Math.pow(d/.72,2)),0);
   const target=24+52*amplitude*pulse;
   this.replyBars[i]+=(target-this.replyBars[i])*(1-Math.exp(-dt*14));
   const height=this.replyBars[i];
   c.beginPath();c.roundRect((i-1)*30-10,-height/2,20,height,10);c.fill();
  }
 }else{
  const wide=this.state==='sleepy'?p.eye:1;c.save();c.scale(1,Math.max(.7,wide));
  if(this.state==='wink'){
   this.eyePath(c,-40,0,this.winkSide===0?'wink':'idle',1,0,eyeColor);
   this.eyePath(c,40,0,this.winkSide===1?'wink':'idle',1,1,eyeColor);
  }else{
   this.eyePath(c,-40,0,kind,blink,0,eyeColor);
   this.eyePath(c,40,0,kind,blink,1,eyeColor);
  }c.restore();
 }
 if(sadness>.01){c.globalAlpha=sadness;c.fillStyle='#fff';c.beginPath();c.roundRect(-62,17,11,12,3);c.roundRect(51,17,11,12,3);c.fill();c.globalAlpha=sadness*.7;c.beginPath();c.roundRect(-15,34,30,12,6);c.fill();c.strokeStyle='#9999a388';c.lineWidth=3;c.beginPath();c.moveTo(59,-32);c.lineTo(77,-32);c.moveTo(65,-24);c.lineTo(89,-24);c.moveTo(68,-16);c.lineTo(78,-16);c.stroke();}
 if(this.ribbonUntil>this.real){const age=2.2-(this.ribbonUntil-this.real);for(let i=0;i<14;i++){c.save();const a=i*2.4;c.translate(Math.cos(a)*(90+age*24),Math.sin(a)*65+age*16);c.rotate(a+age*2);c.globalAlpha=Math.min(1,(this.ribbonUntil-this.real)*2);c.fillStyle=['#61dff1','#b6a5ff','#faafdf'][i%3];c.fillRect(-3,-8,6,16);c.restore();}}
 c.restore();
}
destroy(){this.dead=true;cancelAnimationFrame(this.raf);this.observer.disconnect();this.canvas.removeEventListener('webglcontextlost',this.onLost);this.canvas.removeEventListener('webglcontextrestored',this.onRestored);if(this.gl){this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.stage.replaceChildren();}
}
