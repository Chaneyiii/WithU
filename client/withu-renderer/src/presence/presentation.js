import speechContract from '../../../../contracts/v1/speech.schema.json' with { type: 'json' };

// Read-only presentation boundary. No RPC, input routing, task or memory authority.
export const PRESENCE_STATES = Object.freeze([...speechContract.properties.state.enum]);
export const PRESENCE_LABELS = Object.freeze({idle:'准备好了', listening:'正在倾听', thinking:'正在思考', speaking:'正在说话', interrupted:'已打断', reconnecting:'正在重新连接', degraded:'语音暂不可用', ended:'通话已结束'});
export const PRESENCE_MOODS = Object.freeze({idle:'idle',listening:'listening',thinking:'waiting',speaking:'speaking',interrupted:'waiting',reconnecting:'waiting',degraded:'sad',ended:'happy'});
export function presentSpeech(snapshot) {
  if (!snapshot || snapshot.schema_version !== 1 || !PRESENCE_STATES.includes(snapshot.state)) return {state:'degraded', mood:PRESENCE_MOODS.degraded};
  return {state:snapshot.state, mood:PRESENCE_MOODS[snapshot.state]};
}
// User-selected visual cues only; never represent the user's psychological state.
// Terminal effects are one-shot transitions, not a loop or a replay on remount.
export function applyPresenceTransition(character, previous, current) {
  if (!character || previous === current || !PRESENCE_STATES.includes(previous)) return false;
  if (current !== 'ended') return false;
  character.showRibbons();
  return true;
}
export const initialPresence = () => ({state:'idle', muted:false, quiet:false, refused:false, caption:null, transcript:[], sequence:0, playing:false});
export function presenceFixtureReducer(current, action) {
  switch(action.type) {
    case 'reset': return initialPresence();
    case 'start': return {...initialPresence(), state:'listening'};
    case 'state': return PRESENCE_STATES.includes(action.state) ? {...current,state:action.state,quiet:false,refused:false,playing:false,caption:null} : current;
    case 'end': return {...current,state:'ended',quiet:false,playing:false,caption:null};
    case 'interrupt': return current.state==='ended' ? current : {...current,state:'interrupted',playing:false,caption:null};
    case 'mute': return {...current,muted:!current.muted,playing:false,caption:null,state:current.state==='ended'?'ended':'idle'};
    case 'quiet': return current.state==='ended' ? current : {...current,state:'idle',quiet:true,refused:false,playing:false,caption:null};
    case 'refuse': return {...current,state:'ended',refused:true,quiet:false,playing:false,caption:null};
    case 'demo': return {...current,state:'listening',quiet:false,refused:false,muted:false,playing:true,caption:null,sequence:current.sequence+1};
    case 'caption': {
      if(!current.playing || current.muted || current.state==='ended') return current;
      const caption={id:`fixture-${current.sequence}-${action.speaker}`,speaker:action.speaker,text:action.text,kind:action.kind};
      return {...current,caption,state:action.speaker==='withu'?'speaking':'listening',transcript:action.kind==='final'?[...current.transcript.filter(v=>v.id!==caption.id),caption]:current.transcript};
    }
    case 'wait': return current.playing ? {...current,state:'thinking',caption:null} : current;
    case 'finish': return current.playing ? {...current,playing:false,state:'idle'} : current;
    case 'correct': return {...current,transcript:current.transcript.map(v=>v.id===action.id?{...v,text:action.text,corrected:true}:v),caption:current.caption?.id===action.id?{...current.caption,text:action.text,corrected:true}:current.caption};
    default: return current;
  }
}
export const CAPTION_FIXTURE = Object.freeze([
  {at:250,type:'caption',speaker:'user',kind:'partial',text:'今天想去公…'},
  {at:1150,type:'caption',speaker:'user',kind:'partial',text:'今天想去公园走走'},
  {at:2100,type:'caption',speaker:'user',kind:'final',text:'今天想去公园走走。'},
  {at:3200,type:'wait'},
  {at:4500,type:'caption',speaker:'withu',kind:'partial',text:'好，我们…'},
  {at:5500,type:'caption',speaker:'withu',kind:'final',text:'好，我们可以慢慢聊。'},
  {at:7000,type:'finish'},
]);
