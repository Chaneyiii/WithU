import {PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
import {JSONRPCMessageSchema} from '@modelcontextprotocol/core';
import {isAcceptedAppMessage, validateAppToolIntent} from './fixture.js';

export const appIframePolicy = Object.freeze({
  sandbox: 'allow-scripts',
  referrerPolicy: 'no-referrer',
  allow: "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'",
});

// Retain the SDK wire transport and JSON-RPC parser, adding the host's opaque
// origin/session/size checks before messages reach AppBridge.
export function createGuardedAppTransport({source, sessionId, activeSession, transport, eventTarget = globalThis.window}) {
  const sdk = transport || new PostMessageTransport(source, source);
  let closed = false;
  const host = {
    sessionId,
    accept(event) {
      if (closed || !isAcceptedAppMessage(event, {source, origin: 'null', activeSessionId: activeSession(), sessionId})) return;
      const parsed = JSONRPCMessageSchema.safeParse(event.data);
      if (parsed.success) host.onmessage?.(parsed.data);
    },
    async start() { eventTarget?.addEventListener('message', host.accept); },
    async send(message, options) {
      if (closed || activeSession() !== sessionId) throw new Error('MCP App session closed');
      await sdk.send(message, options);
    },
    async close() {
      if (closed) return;
      closed = true;
      eventTarget?.removeEventListener('message', host.accept);
      await sdk.close();
      host.onclose?.();
    },
  };
  return host;
}

export async function invokeD4AppIntent(intent, bridge, context = {}) {
  if (!validateAppToolIntent(intent)) throw new Error('Invalid MCP App intent');
  if (!bridge?.actionPreview || !bridge.actionDecide || !bridge.actionExecute
    || !context.userEvidenceRef || !context.goalDescription || !context.requestApproval)
    throw new Error('D4 action RPC or trusted user evidence unavailable; no action was submitted');
  const check = () => {if (!context.isActive?.()) throw new Error('MCP App session expired');};
  check();
  const current = bridge.annotationGet ? await bridge.annotationGet({schema_version:1,scope:'comfort:local',target_id:'demo-item'}) : {annotation:null};
  check();
  const expectedVersion = current.annotation?.version ?? 1;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Invalid annotation version');
  const preview = await bridge.actionPreview({schema_version:1, scope:'comfort:local', operation:'local_annotation', target_id:'demo-item', expected_version:expectedVersion,
    goal_description:context.goalDescription, user_evidence_ref:context.userEvidenceRef, value:intent.value});
  check();
  if (preview?.plan?.external_effects !== false || preview?.plan?.actions?.length !== 1 || !preview.plan.actions[0].action_id
    || !preview?.approval?.approval_id || preview.approval.decision !== 'pending') throw new Error('D4 returned an invalid preview');
  const identity = {schema_version:1, action_id:preview.plan.actions[0].action_id, approval_id:preview.approval.approval_id, scope:'comfort:local'};
  const decision = await context.requestApproval(preview);
  check();
  if (decision !== 'allow_once') {
    await bridge.actionDecide({...identity, decision:'deny'});
    return {isError:true, content:[{type:'text',text:'Denied in Withu host. No action was submitted.'}], structuredContent:{status:'denied',submitted:false,effect_committed:false}};
  }
  const {approval: allowed} = await bridge.actionDecide({...identity, decision:'allow_once'});
  check();
  if (allowed?.decision !== 'allow' || allowed.explicit_user_allow !== true) throw new Error('D4 did not grant explicit Allow');
  const {receipt} = await bridge.actionExecute(identity);
  check();
  const committed = receipt?.status === 'applied' && receipt.effect_committed === true;
  return {isError:!committed, content:[{type:'text',text:receipt?.result?.summary || 'D4 returned no confirmed local effect.'}],
    structuredContent:{status:receipt?.status || 'unavailable', submitted:true, effect_committed:committed, receipt}};
}
