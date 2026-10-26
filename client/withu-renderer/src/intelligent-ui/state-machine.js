import {SURFACE_STATES, validateReceipt, validateSurfaceState} from './contract.js';

export const initialSurfaceState = (block, {surfaceId = `surface:${block.block_id}`, now = Math.floor(Date.now() / 1000)} = {}) => validateSurfaceState({schema_version: 1, surface_id: surfaceId, block_id: block.block_id, state: 'loading', state_version: 1, source_status_version: block.status_version, visibility: block.visibility, action_ref: block.action_ref, receipt: null, updated_at: now});

const next = (current, state, now, receipt = current.receipt) => validateSurfaceState({...current, state, state_version: current.state_version + 1, receipt, updated_at: now});

export function reduceSurfaceState(current, event, now = Math.floor(Date.now() / 1000)) {
  if (!current || !SURFACE_STATES.includes(current.state)) throw new TypeError('surface state is invalid');
  switch (event?.type) {
    case 'block_ready': return next(current, 'ready', now);
    case 'action_requested': return next(current, event.requiresApproval ? 'pending_approval' : 'loading', now);
    case 'receipt_received': {
      if (current.state === 'closed') return current;
      const receipt = validateReceipt(event.receipt);
      if (receipt.action_id !== current.action_ref?.action_id || receipt.idempotency_key !== current.action_ref?.idempotency_key) throw new Error('receipt does not match the bound action');
      if (receipt.status === 'applied') return next(current, 'applied', now, receipt);
      if (receipt.error?.code === 'expired') return next(current, 'expired', now, receipt);
      return next(current, 'failed', now, receipt);
    }
    case 'sync_block': {
      if (current.state === 'closed' || event.block.status_version <= current.source_status_version) return current;
      return validateSurfaceState({...current, source_status_version: event.block.status_version, visibility: event.block.visibility, action_ref: event.block.action_ref, receipt: null, state: 'ready', state_version: current.state_version + 1, updated_at: now});
    }
    case 'close': return current.state === 'closed' ? current : next(current, 'closed', now);
    case 'retry': return ['failed', 'expired'].includes(current.state) ? next(current, 'loading', now, null) : current;
    case 'recover': return current.state === 'closed' || current.state === 'failed' || current.state === 'expired' ? next(current, 'recovering', now) : current;
    case 'recovered': return current.state === 'recovering' ? next(current, 'ready', now) : current;
    default: throw new Error(`unknown surface event ${event?.type || 'missing'}`);
  }
}
