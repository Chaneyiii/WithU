import assert from 'node:assert/strict';
import {ClientServerOwner} from '../client/withu-window/index.mjs';

const support = {
  plan: {schema_version:1,turn_id:'turn',primary_action:'listen',secondary_option:null,
    permission_needed:false,language_constraints:[],presence_cues:{pace:null,pause:null,intensity:null},
    creates_task:false,specialist_dispatched:false},
  hypothesis: {schema_version:1,session_id:'session',hypothesis_id:'hypothesis',valence:0,arousal:0,
    affect_candidates:[],support_need_candidates:[],confidence:0,answer_confidence:0,
    abstention:true,conflict:false,sarcasm_or_ambiguity:false,calibrated:false,evidence_refs:[],
    model_version:'rules',source:'rules_fallback',calibration_version:null,degraded:true,
    degradation_reason:'fixture',user_correction:null,language:'und',input_modality:'text'},
};

async function response(channel,result,error) {
  const owner=new ClientServerOwner('unused');
  // Exercise request() as well as receive(): the channel must survive the wire round trip.
  owner.child={stdin:{write(line){
    const request=JSON.parse(line);
    const envelope={schema_version:1,request_id:request.request_id,client_session_id:owner.session,sequence:1,result};
    if(error){assert.throws(()=>owner.receive(envelope),error);owner.fail(new Error('fixture rejected'));}
    else owner.receive(envelope);
  }}};
  if(error) await assert.rejects(owner.request(channel,{}),/fixture rejected/);
  else assert.deepEqual(await owner.request(channel,{}),result);
}

await response('withu:affect:plan',support);
await response('withu:affect:plan',{...support,plan:{...support.plan,creates_task:'invalid'}},/support domain schema/);
await response('withu:affect:plan',{plan:support.plan},/support domain schema/);
await response('withu:action:preview',support,/action domain schema/);
await response('withu:action:preview',{},/action domain schema/);
console.log('PASS owner request channel distinguishes support/action plans and rejects malformed or crossed contracts');
