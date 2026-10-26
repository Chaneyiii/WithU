// Only trusted voice runtimes own these tokens. No transcript or audio crosses
// the App boundary; an app receives only the aggregate playback restriction.
export function createMediaCoordinator() {
  const sessions = new Set(), listeners = new Set();
  const snapshot = () => ({version:1, voiceBusy:sessions.size > 0});
  return {
    setVoice(token, busy) {
      if (!token) return;
      const before = sessions.size > 0;
      if (busy) sessions.add(token); else sessions.delete(token);
      if (before !== (sessions.size > 0)) for (const listener of listeners) listener(snapshot());
    },
    subscribe(listener) {listeners.add(listener);listener(snapshot());return () => listeners.delete(listener);},
  };
}
export const mediaCoordinator = createMediaCoordinator();

// Playback always needs a user click after speech. Never infer consent from
// the contents of media, nor autoplay after a call, reconnect or teardown.
export function bindMediaElement(media, onBusy = () => {}) {
  let closed = false;
  return {
    update(value) {
      if (closed || value?.version !== 1 || typeof value.voiceBusy !== 'boolean') return;
      if (value.voiceBusy) media.pause();
      onBusy(value.voiceBusy);
    },
    close() {closed=true;media.pause();},
  };
}

export function localToneWav() {
  const samples=8000, bytes=new Uint8Array(44+samples*2), view=new DataView(bytes.buffer);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true);
  for(let i=0;i<samples;i++)view.setInt16(44+i*2,Math.sin(2*Math.PI*220*i/8000)*1800*Math.min(i/400,(samples-i)/400,1),true);
  return 'data:audio/wav;base64,'+btoa(String.fromCharCode(...bytes));
}
