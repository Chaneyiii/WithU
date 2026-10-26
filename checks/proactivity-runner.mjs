import assert from 'node:assert/strict';
import {createProactivityRunner} from '../client/withu-window/proactivity-runner.cjs';

let now = 1000, running = true, offers = [], delivered = [], ticks = 0;
const owner = {ready:true, async request(channel, payload) {
  if (channel === 'withu:life:tick') { ticks++; return {candidates:ticks === 1 ? [{schema_version:1,id:'r-v1',source:'d5_reminder',scope:'comfort',dedupe_key:'r-v1',title:'private',body:'private'}] : []}; }
  if (channel === 'withu:proactivity:candidate_offer') { offers.push(payload); return {decision:'eligible',item:{candidate_id:payload.candidate.id}}; }
  if (channel === 'withu:proactivity:notification_result') return {};
  throw Error(channel);
}};
const runner = createProactivityRunner({owner,isRunning:()=>running,now:()=>now,deliver:async id=>{delivered.push(id);return 'shown_by_os';}});
await runner.tick();
assert.equal(offers.length,1); assert.deepEqual(delivered,['r-v1']);
const advance=async seconds=>{for(let i=0;i<seconds;i+=30){now+=30;await runner.tick();}};
await advance(1800); assert.equal(offers.at(-1).candidate.source,'d8_greeting');
const count = offers.length;
await runner.tick(); assert.equal(offers.length,count,'no duplicate at same time');
now += 86400; await runner.tick(); assert.equal(offers.length,count,'missed timer discarded');
running = false; now += 7200; await runner.tick(); assert.equal(offers.length,count,'exit blocks candidates');
running = true; await runner.tick(); assert.equal(offers.length,count,'no catch up after stopped interval');
await advance(1800); assert.equal(offers.at(-1).candidate.source,'d8_greeting');
runner.stop(); now += 7200; await runner.tick(); assert.equal(offers.length,count+1);

let active=0,maxActive=0;
const delayedOwner={ready:true,async request(channel){if(channel==='withu:life:tick'){active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,10));active--;return {candidates:[]};}return {};}};
const serial=createProactivityRunner({owner:delayedOwner,isRunning:()=>true,now:()=>100,deliver:async()=>null});
await Promise.all([serial.tick(),serial.tick(),serial.tick()]); assert.equal(maxActive,1);
console.log('PASS production proactivity runner: real due flow, low frequency, missed/drop, exit, serialization');
