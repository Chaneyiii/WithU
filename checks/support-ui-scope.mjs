import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Execute the actual non-JSX support handlers with deterministic hook and RPC fixtures.
const source=await readFile(new URL('../client/withu-renderer/src/components/Chat.jsx',import.meta.url),'utf8');
const handlers=source.slice(source.indexOf('  const [supportOpen,'),source.indexOf('  const saveCorrection='));
const build=new Function('useState','useRef','useEffect','chat','desktopBridge','crypto','onNotice','errorCopy',
  handlers+'\nreturn {createSupportPlan,submitSupportFeedback,supportPlan,supportBusy,supportDone};');
const slots=[], effects=[], calls=[], notices=[];
let cursor=0,effectCursor=0;
const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=value;}];};
const useRef=initial=>{const i=cursor++;return slots[i]??=( {current:initial} );};
const useEffect=(run,deps)=>{const i=effectCursor++,old=effects[i];if(!old||deps.some((d,n)=>d!==old.deps[n])){old?.cleanup?.();effects[i]={deps,cleanup:run()};}};
const rpc=payload=>new Promise((resolve,reject)=>calls.push({payload,resolve,reject}));
const render=id=>{cursor=0;effectCursor=0;return build(useState,useRef,useEffect,{id},()=>({affectPlan:rpc,affectFeedback:rpc}),{randomUUID:()=>String(calls.length)},m=>notices.push(m),m=>m);};
const plan={plan:{turn_id:'a-turn',primary_action:'listen'}};
let a=render('a');
let pending=a.createSupportPlan();
assert.equal(calls[0].payload.conversation_id,'a');
render('b');
calls[0].resolve(plan);await pending;
assert.equal(render('b').supportPlan,null,'late plan from a must not appear in b');
assert.equal(render('b').supportBusy,false);
a=render('a');pending=a.createSupportPlan();calls[1].resolve(plan);await pending;
a=render('a');assert.deepEqual(a.supportPlan,plan);
pending=a.submitSupportFeedback('improved');assert.equal(calls[2].payload.conversation_id,'a');
render('b');const current=render('b').createSupportPlan();
calls[2].resolve({});await pending;
assert.equal(render('b').supportBusy,true,'stale feedback must not clear a new request busy state');
assert.equal(render('b').supportDone,false);
calls[3].resolve(plan);await current;
pending=render('b').createSupportPlan();render('a');calls[4].reject(new Error('stale error'));await pending;
assert.deepEqual(notices,[],'stale errors must not appear in another conversation');
for(const effect of effects)effect.cleanup?.();
console.log('PASS support handlers: scoped payloads, late plan/feedback/error isolation and busy state after conversation switch');
