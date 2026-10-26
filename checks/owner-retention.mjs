import assert from 'node:assert/strict';
import {ClientServerOwner} from '../client/withu-window/index.mjs';
import {randomUUID} from 'node:crypto';

const owner=new ClientServerOwner('unused');
let delivered=0;
owner.on('event',m=>{assert.equal(m.data.realtime.audio_base64,'SYNTHETIC_PCM_PAYLOAD');assert.equal(m.data.realtime.samples.length,320);delivered++;});
const session=owner.session;
function event(sequence,event='realtime.updated'){
 return {schema_version:1,request_id:null,client_session_id:session,
  record:{schema_version:1,event_id:randomUUID(),event,occurred_at:new Date().toISOString(),object_id:'retention',object_version:1,sequence,config_version:1,payload_ref:null},
  data:{realtime:{type:'audio',audio_base64:'SYNTHETIC_PCM_PAYLOAD',samples:Array(320).fill(1),sample_rate:24000}}};
}
for(let sequence=1;sequence<=4000;sequence++)owner.receive(event(sequence));
assert.equal(delivered,4000);
assert.equal(owner.eventCursor,4000,'cursor is absolute');
assert.equal(owner.events.length,512,'history is bounded');
assert.ok(owner.events.filter(e=>e.realtime?.type==='audio').length<=512,'event metadata history is bounded');
assert.equal(owner.events.some(e=>e.realtime?.audio_base64||e.realtime?.samples),false,'event history omits raw audio');
assert.equal(owner.wire.some(e=>e.data?.realtime?.audio_base64||e.data?.realtime?.samples),false,'wire diagnostics omit raw audio');
assert.equal(owner.wire.length,3000,'wire diagnostics remain bounded');
const after=owner.eventCursor;
const marker=owner.waitFor('realtime.updated',after,1000);
owner.receive(event(4001));
assert.equal((await marker).event,'realtime.updated','waiters use absolute cursors after rollover');
assert.equal(owner.eventsSince(after).length,1);
assert.equal((await owner.waitFor('realtime.updated',4000)).sequence,4001,'already received events are found using the same cursor');
console.log('PASS owner event retention: live audio delivered, retained history bounded and payload-free, rollover cursor waits');
