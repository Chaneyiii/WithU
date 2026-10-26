// Local endpoint detection over the echo-cancelled microphone. No raw audio storage.
export class TurnDetector {
 constructor(rate,{onStart,onEnd,onPartial=()=>{},onLevel=()=>{}}){this.rate=rate;this.onStart=onStart;this.onEnd=onEnd;this.onPartial=onPartial;this.onLevel=onLevel;this.reset();}
 reset(){this.noise=.002;this.pre=[];this.preSamples=0;this.frames=[];this.samples=0;this.voiced=0;this.silence=0;this.active=false;this.nextPartial=this.rate*1.2;}
 push(frame,playing=false){
  let energy=0;for(const x of frame)energy+=x*x;
  const rms=Math.sqrt(energy/frame.length),ms=frame.length*1000/this.rate;
  this.onLevel(Math.min(1,rms*5));
  const threshold=Math.max(playing?.018:.008,this.noise*(playing?4:3));
  const voice=rms>threshold;
  if(!this.active){
   if(!voice)this.noise=this.noise*.995+Math.min(rms,.012)*.005;
   this.pre.push(frame);this.preSamples+=frame.length;
   while(this.preSamples>this.rate*.3&&this.pre.length>1)this.preSamples-=this.pre.shift().length;
   this.voiced=voice?this.voiced+ms:0;
   if(this.voiced>=160){this.active=true;this.frames=this.pre;this.samples=this.preSamples;this.pre=[];this.preSamples=0;this.silence=0;this.onStart();}
   return;
  }
  this.frames.push(frame);this.samples+=frame.length;this.silence=voice?0:this.silence+ms;
  if(this.samples>=this.nextPartial&&this.silence<300){this.nextPartial+=this.rate*1.5;this.onPartial(this.frames.slice());}
  if(this.silence>=700||this.samples>=this.rate*9.5){
   const frames=this.frames;this.frames=[];this.samples=0;this.active=false;this.voiced=0;this.silence=0;this.nextPartial=this.rate*1.2;this.onEnd(frames);
  }
 }
}
