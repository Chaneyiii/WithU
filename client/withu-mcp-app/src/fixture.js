import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import {EXTENSION_ID, RESOURCE_MIME_TYPE, getUiCapability, registerAppResource, registerAppTool} from '@modelcontextprotocol/ext-apps/server';
import {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';

export const APP_RESOURCE_URI = 'ui://withu/demo-app.html';
export const APP_TOOL_NAME = 'request-demo-intent';
export const APP_MESSAGE_LIMIT = 65_536;
export const MCP_APP_PROTOCOL_VERSION = '2025-11-21';
export const DEFAULT_APP_HTML = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="__WITHU_APP_CSP__"></head><body><script nonce="__WITHU_APP_NONCE__"></script></body></html>';

export function validateAppNavigation(url) {
  return url === APP_RESOURCE_URI;
}

export function validateAppSize(size) {
  return Number.isFinite(size?.width) && Number.isFinite(size?.height)
    && size.width >= 280 && size.width <= 1200 && size.height >= 120 && size.height <= 900;
}

export function validateAppToolIntent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== 'operation' || keys[1] !== 'value' || keys[2] !== 'version'
    || value.operation !== 'local_annotation' || value.version !== 1 || typeof value.value !== 'string' || [...value.value].length > 120) return null;
  return {operation: value.operation, version: value.version, value: value.value};
}

const UI_CSP = Object.freeze({resourceDomains: [], connectDomains: [], frameDomains: [], redirectDomains: []});

export function makeAppDocument(resourceHtml, nonce) {
  if (typeof resourceHtml !== 'string' || new TextEncoder().encode(resourceHtml).byteLength > 1_048_576) throw new TypeError('MCP App resource size is invalid');
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(nonce)) throw new TypeError('MCP App nonce is invalid');
  if (!resourceHtml.includes('__WITHU_APP_CSP__') || !resourceHtml.includes('__WITHU_APP_NONCE__')) throw new TypeError('MCP App resource is missing host security placeholders');
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return resourceHtml.replaceAll('__WITHU_APP_CSP__', csp).replaceAll('__WITHU_APP_NONCE__', nonce);
}

/**
 * Wrap a *third-party* App document. The bundled demo carries its own
 * placeholders, but a standard MCP App arrives as plain HTML, so the host has
 * to supply the policy itself: same CSP as the bundled path, plus a nonce on
 * every inline script (otherwise a `script-src 'nonce-…'` policy blocks them).
 */
export function makeRuntimeAppDocument(resourceHtml, nonce) {
  if (typeof resourceHtml !== 'string' || new TextEncoder().encode(resourceHtml).byteLength > 1_048_576) throw new TypeError('MCP App resource size is invalid');
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(nonce)) throw new TypeError('MCP App nonce is invalid');
  if (resourceHtml.includes('__WITHU_APP_CSP__')) return makeAppDocument(resourceHtml, nonce);
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const withNonce = resourceHtml.replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
  if (/<head[^>]*>/i.test(withNonce)) return withNonce.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  if (/<html[^>]*>/i.test(withNonce)) return withNonce.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  return `<head>${meta}</head>` + withNonce;
}

export function isAcceptedAppMessage(event, {source, origin, activeSessionId, sessionId, maxBytes = APP_MESSAGE_LIMIT}) {
  if (!source || event?.source !== source || event?.origin !== origin || origin !== 'null' || !sessionId || activeSessionId !== sessionId) return false;
  try {
    const payload = JSON.stringify(event.data);
    return typeof payload === 'string' && new TextEncoder().encode(payload).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

export async function createDemoMcpFixture({resourceHtml = DEFAULT_APP_HTML, invokeHostIntent} = {}) {
  const server = new McpServer({name: 'withu-local-demo-app', version: '1.0.0'}, {capabilities: {resources: {}, tools: {extensions: {[EXTENSION_ID]: {mimeTypes: [RESOURCE_MIME_TYPE]}}}}});
  let negotiated = false;
  server.server.oninitialized = () => {
    const ui = getUiCapability(server.server.getClientCapabilities());
    negotiated = Boolean(ui?.mimeTypes?.includes(RESOURCE_MIME_TYPE));
    if (!negotiated) return;

    registerAppResource(server, 'Withu Local Demo App', APP_RESOURCE_URI, {
      description: 'Local fixture UI for the Withu Comfort demo.',
      _meta: {ui: {csp: UI_CSP}},
    }, async () => ({contents: [{uri: APP_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: resourceHtml, _meta: {ui: {csp: UI_CSP}}}]}));

    registerAppTool(server, APP_TOOL_NAME, {
      title: 'Request local demo action',
      description: 'Propose a local annotation. The trusted host requires a separate explicit Allow before D4 executes it.',
      inputSchema: z.object({operation: z.literal('local_annotation'), version: z.literal(1), value: z.string().max(120)}).strict(),
      _meta: {ui: {resourceUri: APP_RESOURCE_URI}},
    }, async intent => {
      const typedIntent = validateAppToolIntent(intent);
      if (!typedIntent) return intentUnavailable('Invalid action intent.');
      if (!invokeHostIntent) return intentUnavailable('The D4 action RPC is not connected.');
      try {
        return await invokeHostIntent(typedIntent);
      } catch (error) {
        return intentUnavailable(error instanceof Error ? error.message : 'The host action RPC failed.');
      }
    });
  };

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'withu-local-demo-host', version: '1.0.0'}, {
    capabilities: {extensions: {[EXTENSION_ID]: {mimeTypes: [RESOURCE_MIME_TYPE]}}},
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    resourceUri: APP_RESOURCE_URI,
    get negotiated() { return negotiated; },
    async createBridge(transport) {
      const bridge = new AppBridge(client, {name: 'Withu Comfort', version: '1.0.0'}, {serverTools: {}}, {strict: true});
      await bridge.connect(transport);
      return bridge;
    },
    async close() {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

function intentUnavailable(reason) {
  return {
    isError: true,
    content: [{type: 'text', text: `Not submitted: ${reason} No action was created.`}],
    structuredContent: {status: 'unavailable', submitted: false, effect_committed: false},
  };
}
