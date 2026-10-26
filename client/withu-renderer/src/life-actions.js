import {createActionIntent} from './intelligent-ui/action-adapter.js';

export function lifeApprovalBlock(prepared,conversationId) {
  const action=prepared.approval.action;
  return {schema_version:1,block_id:`life:${prepared.operation_id}`,conversation_id:conversationId,turn_id:prepared.operation_id,source:'withu',status_version:1,visibility:'conversation',kind:'approval',action_ref:{action_id:action.action_id,expected_revision:action.action_version,approval_ref:prepared.approval.approval_id,idempotency_key:action.idempotency_key,cancel_token:action.cancel_token,expires_at:prepared.approval.expires_at},payload:{title:prepared.plan.goal.description,body:'批准后仅保存到这台设备。请核对下方内容，再选择“允许一次”。',decision:'pending'}};
}

export function createLifeActionHandler({prepared,block,bridge,afterApplied=()=>{}}) {
  let used=false;
  return async intent=>{
    const expected=createActionIntent(block,intent.intent_kind==='cancel'?'click':intent.input_channel,intent.created_at);
    for(const field of ['block_id','conversation_id','turn_id','action_id','expected_revision','approval_ref','idempotency_key','cancel_token','expires_at'])if(intent[field]!==expected[field])throw Error('action_reference_mismatch');
    const payload={schema_version:1,scope:'comfort',operation_id:prepared.operation_id};
    if(intent.intent_kind==='cancel'){await bridge.lifeCancel(payload);return null;}
    if(intent.intent_kind!=='submit'||intent.input_channel!=='click')throw Error('explicit_allow_required');
    if(used)throw Error('duplicate');
    used=true;
    await bridge.lifeDecide({...payload,decision:'allow',explicit_user_allow:true});
    const result=await bridge.lifeExecute(payload);
    await afterApplied(result.receipt);
    return result.receipt;
  };
}

// Chat-proposed action (T09/T10): the block itself carries the operation id
// in turn_id; allow runs the same life decide(allow) -> execute chain, cancel
// is a plain deny with zero side effects. Duplicate submits are refused
// locally so a double click cannot execute twice.
export function createChatActionHandler({block,bridge,afterApplied=()=>{}}) {
  let used=false;
  return async intent=>{
    const expected=createActionIntent(block,intent.intent_kind==='cancel'?'click':intent.input_channel,intent.created_at);
    for(const field of ['block_id','conversation_id','turn_id','action_id','expected_revision','approval_ref','idempotency_key','cancel_token','expires_at'])if(intent[field]!==expected[field])throw Error('action_reference_mismatch');
    const payload={schema_version:1,scope:'comfort',operation_id:block.turn_id};
    if(intent.intent_kind==='cancel'){await bridge.lifeCancel(payload);await afterApplied(null);return null;}
    if(intent.intent_kind!=='submit'||intent.input_channel!=='click')throw Error('explicit_allow_required');
    if(used)throw Error('duplicate');
    used=true;
    await bridge.lifeDecide({...payload,decision:'allow',explicit_user_allow:true});
    const result=await bridge.lifeExecute(payload);
    await afterApplied(result.receipt);
    return result.receipt;
  };
}
