// Runs in the trusted Electron main process, independently of renderer routes.
function createProactivityRunner({owner,isRunning,deliver,now=()=>Math.floor(Date.now()/1000)}) {
  let stopped=false,busy=false,last=now(),greetingAt=last+1800,topicAt=last+7200;
  const reset=time=>{greetingAt=time+1800;topicAt=time+7200;};
  async function offer(candidate) {
    if(stopped||!isRunning()||!owner.ready)return;
    const result=await owner.request('withu:proactivity:candidate_offer',{app_running:true,candidate});
    if(result.decision!=='eligible'||stopped||!isRunning())return;
    const status=await deliver(result.item.candidate_id);
    if(status&&owner.ready&&!stopped&&isRunning())await owner.request('withu:proactivity:notification_result',{candidate_id:result.item.candidate_id,expected_version:0,status});
  }
  async function tick() {
    if(stopped||busy)return;
    busy=true;
    try {
      const time=now(),missed=time-last>90||time<last;
      last=time;
      if(!isRunning()||!owner.ready){reset(time);return;}
      // The owner also drops overdue reminders after restart or a missed tick.
      const due=await owner.request('withu:life:tick',{schema_version:1,scope:'comfort',app_running:true});
      for(const candidate of due.candidates)await offer(candidate);
      if(missed){reset(time);return;}
      for(const [source,at,title,body] of [
        ['d8_greeting',greetingAt,'Withu 在这里','忙了一会儿，要不要停一下，喝口水？'],
        ['d8_topic',topicAt,'一个轻松的话题','今天有没有一个小瞬间，让你觉得还不错？想聊的时候，我在这里。'],
      ]) {
        if(time<at)continue;
        if(source==='d8_greeting')greetingAt=time+86400;else topicAt=time+86400;
        const key=`${source}:${Math.floor(time/86400)}`;
        await offer({schema_version:1,id:key,source,scope:'comfort',dedupe_key:key,title,body});
      }
    } finally {busy=false;}
  }
  return {tick,stop(){stopped=true;}};
}
module.exports={createProactivityRunner};
