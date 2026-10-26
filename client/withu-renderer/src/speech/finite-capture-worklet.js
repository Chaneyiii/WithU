class FiniteCapture extends AudioWorkletProcessor {
  process(inputs,outputs){
    const channels=inputs[0];if(channels?.[0]){
      const mono=new Float32Array(channels[0].length);
      for(const c of channels)for(let i=0;i<mono.length;i++)mono[i]+=c[i]/channels.length;
      this.port.postMessage(mono,[mono.buffer]);
    }
    for(const channel of outputs[0]||[])channel.fill(0);
    return true;
  }
}
registerProcessor('finite-capture',FiniteCapture);
