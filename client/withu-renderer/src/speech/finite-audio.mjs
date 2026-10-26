// Whole short utterances, not streaming/duplex. Windowed sinc resampling includes
// the tail and suppresses frequencies above the destination Nyquist frequency.
export function utteranceWav(frames, sourceRate) {
  const length=frames.reduce((n,f)=>n+f.length,0),input=new Float32Array(length);
  let offset=0;for(const f of frames){input.set(f,offset);offset+=f.length;}
  const count=Math.floor(length*16000/sourceRate);
  if(!count||count>160000)throw Error('audio_input_limit');
  const bytes=new Uint8Array(44+count*2),v=new DataView(bytes.buffer);
  const str=(at,s)=>{for(let i=0;i<s.length;i++)bytes[at+i]=s.charCodeAt(i);};
  str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
  str(36,'data');v.setUint32(40,count*2,true);
  const cutoff=Math.min(1,16000/sourceRate)*0.9, radius=32;
  for(let i=0;i<count;i++){
    const at=i*sourceRate/16000;let sum=0,weight=0;
    for(let j=Math.max(0,Math.ceil(at-radius));j<=Math.min(length-1,Math.floor(at+radius));j++){
      const x=j-at,z=Math.PI*x*cutoff;
      const w=(Math.abs(z)<1e-8?cutoff:Math.sin(z)/(Math.PI*x))*(0.5+0.5*Math.cos(Math.PI*x/radius));
      sum+=input[j]*w;weight+=w;
    }
    v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,weight?sum/weight:0))*32767),true);
  }
  return bytes;
}
export function encodeBytes(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function pcmFloats(details){
  if(details.format!=='pcm16le'||details.channels!==1||(!Number.isInteger(details.sample_rate)||details.sample_rate<8000||details.sample_rate>96000))throw Error('audio_format_invalid');
  const raw=atob(details.audio_base64);if(!raw.length||raw.length%2||raw.length>480000)throw Error('audio_response_limit');
  const samples=new Float32Array(raw.length/2);
  for(let i=0;i<samples.length;i++){let n=raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8);samples[i]=(n>=32768?n-65536:n)/32768;}
  return samples;
}
