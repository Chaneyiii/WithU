import assert from 'node:assert/strict';
import {OrbBehavior} from '../client/withu-renderer/src/emotional-ball/behavior.mjs';
import {ORB_STATES,resolveOrbState} from '../client/withu-renderer/src/emotional-ball/states.mjs';
const states=[];let timer,id=0;const ball={setState:s=>states.push(s)};
let random=0;
const behavior=new OrbBehavior(ball,{random:()=>random,schedule:fn=>{timer=fn;return ++id;},cancel:()=>{timer=null;}});
assert.equal(resolveOrbState('idle','degraded'),'sad');assert.ok(!ORB_STATES.includes('error'));
behavior.baseState('idle','listening');behavior.cue('interrupted');assert.equal(states.at(-1),'angry');behavior.baseState('idle','thinking');assert.equal(states.at(-1),'angry');timer();assert.equal(states.at(-1),'waiting');
random=.9;behavior.cue('interrupted');assert.equal(states.at(-1),'waiting');
behavior.cue('reply-ended');assert.equal(states.at(-1),'music');behavior.baseState('idle','listening');assert.equal(states.at(-1),'music');
behavior.baseState('idle','speaking');assert.equal(states.at(-1),'speaking');assert.equal(timer,null);
for(const [value,expected] of [[0,'idle'],[.5,'happy'],[.9,'wink']]){random=value;behavior.interact();assert.equal(states.at(-1),'curious');const first=id;behavior.interact();assert.ok(id>first);timer();assert.equal(states.at(-1),expected);}
behavior.interact();behavior.destroy();assert.equal(timer,null);
console.log('PASS original orb states, error→sad, interruption choices, response finish, interaction timer reset/random return, cleanup');
