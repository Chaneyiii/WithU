import assert from 'node:assert/strict';
import {utteranceWav,pcmFloats} from '../client/withu-renderer/src/speech/finite-audio.mjs';
const rms=(bytes)=>{const v=new DataView(bytes.buffer);let sum=0;for(let i=44;i<bytes.length;i+=2)sum+=(v.getInt16(i,true)/32768)**2;return Math.sqrt(sum/((bytes.length-44)/2));};
const tone=(hz)=>Float32Array.from({length:4800},(_,i)=>0.5*Math.sin(2*Math.PI*hz*i/48000));
const audible=utteranceWav([tone(1000)],48000),alias=utteranceWav([tone(12000)],48000);
assert.equal(audible.length,3244);assert.equal(new DataView(audible.buffer).getUint32(24,true),16000);assert.ok(rms(alias)<rms(audible)*0.03);
assert.throws(()=>utteranceWav([],48000),/audio_input_limit/);assert.throws(()=>utteranceWav([new Float32Array(160001)],16000),/audio_input_limit/);
const floats=pcmFloats({format:'pcm16le',channels:1,sample_rate:24000,audio_base64:Buffer.from([0,128,255,127]).toString('base64')});assert.equal(floats[0],-1);assert.ok(floats[1]>0.99);
console.log('PASS finite WAV count/rate/tail, anti-alias suppression, size bounds and signed playback PCM');
