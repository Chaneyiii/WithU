// Captured samples are ephemeral. Downsample to the server's fixed PCM16/16 kHz boundary.
class WithuCapture extends AudioWorkletProcessor {
 constructor(){super();this.pending=[];this.phase=0;}
 process(inputs){const samples=inputs[0]?.[0];if(!samples)return true;for(const value of samples){this.phase+=16000;if(this.phase>=sampleRate){this.phase-=sampleRate;this.pending.push(Math.round(Math.max(-1,Math.min(1,value))*32767));if(this.pending.length===800){this.port.postMessage(this.pending);this.pending=[];}}}return true;}
}
registerProcessor('withu-capture',WithuCapture);
