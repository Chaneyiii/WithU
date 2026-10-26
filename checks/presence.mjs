import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PRESENCE_STATES,PRESENCE_MOODS,presentSpeech,applyPresenceTransition,initialPresence,presenceFixtureReducer as reduce,CAPTION_FIXTURE} from '../client/withu-renderer/src/presence/presentation.js';
const sources={'crates/withu-speech/src/lib.rs':await fs.readFile('crates/withu-speech/src/lib.rs','utf8')};
const results=[];
function check(name,fn){fn();results.push({name,status:'passed'});console.log('PASS '+name);}
const schema=JSON.parse(await fs.readFile('contracts/v1/speech.schema.json','utf8'));
check('schema defines all eight presentation states',()=>assert.deepEqual(PRESENCE_STATES,schema.properties.state.enum));
check('Rust required states match presentation',()=>{const rust=fsSync('crates/withu-speech/src/lib.rs');for(const state of PRESENCE_STATES)assert.ok(rust.includes('SpeechState::'+state[0].toUpperCase()+state.slice(1)));});
function fsSync(file){return sources[file];}

check('unknown and unversioned input never becomes speaking',()=>{assert.equal(presentSpeech({state:'speaking'}).state,'degraded');assert.equal(presentSpeech({schema_version:1,state:'happy'}).state,'degraded');assert.equal(presentSpeech(null).state,'degraded');});
check('states map to presentation not user psychology',()=>{for(const state of PRESENCE_STATES){assert.deepEqual(presentSpeech({schema_version:1,state}),{state,mood:PRESENCE_MOODS[state]});assert.equal(reduce(initialPresence(),{type:'state',state}).state,state);}});
check('user-selected listening, unavailable and terminal expressions',()=>{assert.equal(presentSpeech({schema_version:1,state:'listening'}).mood,'listening');assert.equal(presentSpeech({schema_version:1,state:'degraded'}).mood,'sad');assert.equal(presentSpeech(null).mood,'sad');assert.equal(presentSpeech({schema_version:1,state:'ended'}).mood,'happy');assert.equal(presentSpeech({schema_version:1,state:'interrupted'}).mood,'waiting');});
check('ended shows ribbons once without extra spin',()=>{for(const terminal of ['ended']){const calls=[];const ball={spin:()=>assert.fail('terminal state must not add spin'),showRibbons:()=>calls.push(['ribbons'])};assert.equal(applyPresenceTransition(ball,'speaking',terminal),true);assert.deepEqual(calls,[['ribbons']]);assert.equal(applyPresenceTransition(ball,terminal,terminal),false);assert.equal(calls.length,1);}});
check('opening, remounting and ordinary states do not replay terminal effects',()=>{const ball={spin:()=>assert.fail('unexpected spin'),showRibbons:()=>assert.fail('unexpected ribbons')};for(const state of PRESENCE_STATES){assert.equal(applyPresenceTransition(ball,state,state),false);assert.equal(applyPresenceTransition(ball,undefined,state),false);}for(const state of ['idle','listening','thinking','speaking','reconnecting','degraded'])assert.equal(applyPresenceTransition(ball,'idle',state),false);});
check('ordinary wait is thinking, not reconnecting',()=>{assert.equal(reduce(reduce(initialPresence(),{type:'demo'}),{type:'wait'}).state,'thinking');});
check('partial is not transcript final',()=>{let s=reduce(initialPresence(),{type:'demo'});s=reduce(s,CAPTION_FIXTURE[0]);assert.equal(s.caption.kind,'partial');assert.equal(s.transcript.length,0);s=reduce(s,CAPTION_FIXTURE[2]);assert.equal(s.transcript.length,1);assert.equal(s.caption.kind,'final');});
check('duplicate fixture final replaces rather than duplicates',()=>{let s=reduce(initialPresence(),{type:'demo'});s=reduce(s,CAPTION_FIXTURE[2]);s=reduce(s,CAPTION_FIXTURE[2]);assert.equal(s.transcript.length,1);});
check('caption correction retains source and changes only fixture text',()=>{let s=reduce(initialPresence(),{type:'demo'});s=reduce(s,CAPTION_FIXTURE[2]);const id=s.caption.id;s=reduce(s,{type:'correct',id,text:'更正的测试文本'});assert.equal(s.caption.corrected,true);assert.equal(s.transcript[0].speaker,'user');assert.equal(s.transcript[0].text,'更正的测试文本');});
check('interrupt and end do not revive from late fixture output',()=>{for(const type of ['interrupt','end']){let s=reduce(reduce(initialPresence(),{type:'demo'}),{type});for(const event of CAPTION_FIXTURE)s=reduce(s,event);assert.equal(s.state,type==='end'?'ended':'interrupted');assert.equal(s.playing,false);assert.equal(s.caption,null);assert.equal(s.transcript.length,0);}});
check('mute stops fixture captions and preserves typing boundary',()=>{let s=reduce(reduce(initialPresence(),{type:'demo'}),{type:'mute'});s=reduce(s,CAPTION_FIXTURE[2]);assert.equal(s.muted,true);assert.equal(s.playing,false);assert.equal(s.caption,null);assert.equal(s.state,'idle');});
check('quiet and refusal are stable, no automatic question',()=>{for(const type of ['quiet','refuse']){let s=reduce(reduce(initialPresence(),{type:'demo'}),{type});for(const event of CAPTION_FIXTURE)s=reduce(s,event);assert.equal(s.state,type==='quiet'?'idle':'ended');assert.equal(s.playing,false);assert.equal(s.caption,null);}});
check('ended interrupt is idempotent; restart is explicit',()=>{const ended=reduce(initialPresence(),{type:'end'});assert.deepEqual(reduce(ended,{type:'interrupt'}),ended);assert.equal(reduce(ended,{type:'start'}).state,'listening');});
check('reset drops transcript and captions',()=>{let s=reduce(initialPresence(),{type:'demo'});s=reduce(s,CAPTION_FIXTURE[2]);assert.deepEqual(reduce(s,{type:'reset'}),initialPresence());});
const preview=await fs.readFile('client/withu-renderer/src/components/PresencePreview.jsx','utf8');
const hook=await fs.readFile('client/withu-renderer/src/presence/usePresenceFixture.js','utf8');
check('fixture owns no microphone, playback, bridge, storage or messages',()=>{assert.doesNotMatch(preview+hook,/getUserMedia|AudioContext|desktopBridge|localStorage|api\(|messageSubmit/);assert.ok(hook.includes('timers.forEach(clearTimeout)'));});
check('2D only: user-canceled 3D line is absent from preview',()=>{assert.doesNotMatch(preview,/PresenceAvatar3D|WebGL|actualCarrier|setCarrier|3D 球体|模拟 3D/);});
const translations=JSON.parse(await fs.readFile('client/withu-renderer/src/translations.json','utf8'));
check('literal preview copy has English and Chinese dictionaries',()=>{for(const match of preview.matchAll(/\bt\('([^']+)'\)/g)){assert.ok(translations.English[match[1]],match[1]);assert.ok(translations['简体中文'][match[1]],match[1]);}});
await fs.mkdir('output/p2',{recursive:true});
await fs.writeFile('output/p2/presence-component-checks.json',JSON.stringify({scope:'P2.1 component/state checks only; no visual acceptance or speech session proof',results},null,2));
console.log(`${results.length} P2.1 checks passed. P2.1 user visual approval is recorded separately; these checks are not P2 speech acceptance.`);
