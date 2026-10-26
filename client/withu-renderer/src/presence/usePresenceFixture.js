import {useEffect,useReducer} from 'react';
import {presenceFixtureReducer,initialPresence,CAPTION_FIXTURE} from './presentation';
export function usePresenceFixture(enabled, scope) {
  const [presence,dispatch]=useReducer(presenceFixtureReducer,undefined,initialPresence);
  useEffect(()=>{dispatch({type:'reset'});},[scope,enabled]);
  useEffect(()=>{
    if(!enabled || !presence.playing)return;
    const timers=CAPTION_FIXTURE.map(step=>setTimeout(()=>dispatch(step),step.at));
    return ()=>timers.forEach(clearTimeout);
  },[enabled,presence.playing,presence.sequence]);
  return [presence,dispatch];
}
