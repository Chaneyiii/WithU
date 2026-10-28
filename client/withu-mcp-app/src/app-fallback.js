// B6 (T16-B): a service without a usable UI must degrade to text, never to an
// empty frame that still looks like the App. The two known causes are named
// here so the host component and its test cannot drift apart.
export const APP_ERROR = Object.freeze({
  noUi: 'MCP Apps capability negotiation failed',
  noResource: 'MCP App resource unavailable'
});

export const APP_FALLBACK = Object.freeze({
  no_ui: '这个服务没有提供界面，结果以文字呈现。',
  no_resource: '这个服务的界面资源不可用，结果以文字呈现。',
  error: 'MCP App 暂时不可用；结果以文字呈现。'
});

export function classifyAppFailure(error) {
  const message = String(error?.message ?? error ?? '');
  if (message === APP_ERROR.noUi) return 'no_ui';
  if (message === APP_ERROR.noResource) return 'no_resource';
  return 'error';
}

export function appFallbackNotice(kind) {
  return APP_FALLBACK[kind] ?? APP_FALLBACK.error;
}
