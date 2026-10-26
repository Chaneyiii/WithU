import {validateActionRef, validateReplyBlock} from './contract.js';

export function selectedOption(block, optionId) {
  const option = optionId && block.payload.options?.find(item => item.id === optionId);
  return option ? {option_id: option.id, option_version: option.version} : null;
}

export function createActionIntent(block, inputChannel = 'click', now = Math.floor(Date.now() / 1000), intentKind = 'submit', selection = null) {
  validateReplyBlock(block);
  if (!['click', 'voice'].includes(inputChannel)) throw new TypeError('input channel is unknown');
  if (intentKind !== 'submit') throw new TypeError('submit intent required');
  const ref = validateActionRef(block.action_ref, {required: true});
  const option = selection ? block.payload.options?.find(item => item.id === selection.option_id && item.version === selection.option_version) : null;
  if (selection && !option) throw new TypeError('selection option does not match block version');
  return Object.freeze({schema_version: 1, type: 'withu_action_intent', intent_kind: intentKind, input_channel: inputChannel, created_at: now, block_id: block.block_id, conversation_id: block.conversation_id, turn_id: block.turn_id, action_id: ref.action_id, expected_revision: ref.expected_revision, approval_ref: ref.approval_ref, idempotency_key: ref.idempotency_key, cancel_token: ref.cancel_token, expires_at: ref.expires_at, ...(option ? {option_id: option.id, option_version: option.version} : {})});
}

export function createCancelIntent(block, now = Math.floor(Date.now() / 1000)) {
  validateReplyBlock(block);
  const ref = validateActionRef(block.action_ref, {required: true});
  return Object.freeze({schema_version: 1, type: 'withu_action_intent', intent_kind: 'cancel', input_channel: 'control', created_at: now, block_id: block.block_id, conversation_id: block.conversation_id, turn_id: block.turn_id, action_id: ref.action_id, expected_revision: ref.expected_revision, approval_ref: ref.approval_ref, idempotency_key: ref.idempotency_key, cancel_token: ref.cancel_token, expires_at: ref.expires_at});
}

export function createActionAdapter(onAction) {
  if (typeof onAction !== 'function') throw new TypeError('onAction adapter is required');
  return intent => {
    if (!intent || intent.type !== 'withu_action_intent') throw new TypeError('typed action intent required');
    return onAction(intent);
  };
}
