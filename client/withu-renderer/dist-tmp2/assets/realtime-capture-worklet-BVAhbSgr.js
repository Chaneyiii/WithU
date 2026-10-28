// Streaming mono resampling with a carried sample clock. Frames are exactly 20ms.
class RealtimeCapture extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.position=0;this.frame=new Int16Array(320);this.offset=0;}
 process(inputs){const input=inputs[0]?.[0];if(!input)return true;this.samples.push(...input);
  const step=sampleRate/16000;while(this.position+1<this.samples.length){const i=Math.floor(this.position),f=this.position-i;const value=this.samples[i]*(1-f)+this.samples[i+1]*f;this.frame[this.offset++]=Math.round(Math.max(-1,Math.min(1,value))*32767);this.position+=step;if(this.offset===320){this.port.postMessage(this.frame.buffer,[this.frame.buffer]);this.frame=new Int16Array(320);this.offset=0;}}
  const consumed=Math.min(Math.floor(this.position),this.samples.length-1);this.samples.splice(0,consumed);this.position-=consumed;return true;
 }
}
registerProcessor('realtime-capture',RealtimeCapture);
