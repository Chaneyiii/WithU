import test from 'node:test';
import assert from 'node:assert/strict';
import {App} from '@modelcontextprotocol/ext-apps';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import {InMemoryTransport} from '@modelcontextprotocol/client';
import {createDemoMcpFixture} from '../src/fixture.js';
import {createMediaCoordinator, bindMediaElement} from '../src/media.js';
import {mediaCoordinator} from '../src/media.js';
import {RealtimeCall} from '../../withu-renderer/src/speech/realtime-call.mjs';

test('trusted voice runtime marks acquisition busy and releases after hangup or acquisition failure', async () => {
  const states=[];
  const unsubscribe=mediaCoordinator.subscribe(value=>states.push(value.voiceBusy));
  const callbacks={state(){},caption(){},error(){}};
  try {
    let release;
    const call=new RealtimeCall({},'media-test',callbacks);
    call.acquire=()=>new Promise(resolve=>{release=resolve;});
    const starting=call.start();
    assert.equal(states.at(-1),true,'busy before capture acquisition completes');
    const ending=call.end();
    assert.equal(states.at(-1),true,'keep media paused while capture is pending');
    release();await starting;await ending;
    assert.equal(states.at(-1),false);
    const failed=new RealtimeCall({},'media-failed',callbacks,'read');
    failed.acquire=async()=>{throw Error('capture_denied');};
    await assert.rejects(failed.start(),/capture_denied/);await failed.end();
    assert.equal(states.at(-1),false,'failed acquisition cannot leave media blocked');
  } finally {unsubscribe();}
});

test('overlapping voice sessions pause media through SDK host context; ending requires explicit playback', async () => {
  const fixture = await createDemoMcpFixture();
  const [hostTransport, appTransport] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(fixture.client, {name:'Host',version:'1'}, {serverTools:{}}, {strict:true});
  const app = new App({name:'App',version:'1'}, {}, {strict:true,autoResize:false});
  const coordinator = createMediaCoordinator();
  const media = {paused:false, pause(){this.paused=true;this.pauses=(this.pauses||0)+1;}, play(){throw Error('must never autoplay');}};
  const states = [];
  const binding = bindMediaElement(media, value => states.push(value));
  app.onhostcontextchanged = context => binding.update(context.withuMedia);
  let unsubscribe = () => {};
  bridge.oninitialized = () => {unsubscribe = coordinator.subscribe(value => bridge.setHostContext({withuMedia:value}));};
  try {
    await bridge.connect(hostTransport);await app.connect(appTransport);
    coordinator.setVoice('call',true);coordinator.setVoice('reader',true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(media.paused,true);assert.equal(states.at(-1),true);
    coordinator.setVoice('call',false);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(states.at(-1),true);
    coordinator.setVoice('reader',false);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(states.at(-1),false);assert.equal(media.paused,true);
    binding.close();coordinator.setVoice('late',true);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(states.at(-1),false,'closed player ignores late context');
  } finally {unsubscribe();await bridge.close();await app.close();await fixture.close();}
});
