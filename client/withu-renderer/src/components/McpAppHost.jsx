import {useEffect, useRef, useState} from 'react';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import appResource from 'virtual:withu-mcp-app-resource';
import {createDemoMcpFixture, makeAppDocument, makeRuntimeAppDocument, validateAppSize} from '../../../withu-mcp-app/src/fixture.js';
import {appIframePolicy, createGuardedAppTransport, invokeD4AppIntent} from '../../../withu-mcp-app/src/host.js';
import {mediaCoordinator} from '../../../withu-mcp-app/src/media.js';
import {classifyAppFailure, appFallbackNotice} from '../../../withu-mcp-app/src/app-fallback.js';
import {desktopBridge} from '../desktop-bridge';
import {t} from '../i18n';
import './mcp-app-host.css';

// Mount one instance per host view. Unmounting revokes the session immediately.
// This entry is a bundled local MCP server/App, not an external connector.
// `variant="inline"` renders the same session as an in-message card inside the
// Intelligence UI canvas instead of a separate window.
/** `resourceHtml` lets a host-rendered third-party App reuse this surface. When
 *  absent the bundled local App is used exactly as before — the two existing
 *  mounts pass nothing, so their behaviour cannot change. */
export default function McpAppHost({onClose, proposalContext, variant = 'standalone', resourceHtml}) {
  const inline = variant === 'inline';
  const curtain = variant === 'curtain';
  const mount = useRef(null);
  const active = useRef(null);
  const [status, setStatus] = useState(t('正在连接本地 MCP App…'));
  const [pending, setPending] = useState(null);
  const [receipt, setReceipt] = useState(null);
  // B6: set when the App cannot give us a usable UI; the view then shows text only.
  const [fallback, setFallback] = useState(null);
  // Close-to-tray keeps the renderer alive; a hidden page must not hold the
  // App iframe, media token or MCP session, so the session is torn down while
  // hidden and rebuilt when the window comes back.
  const [pageHidden, setPageHidden] = useState(false);
  const consent = useRef(null);
  const props = useRef({onClose, proposalContext});
  props.current = {onClose, proposalContext};
  useEffect(() => {
    const onVisibility = () => setPageHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (pageHidden) return undefined;
    const sessionId = crypto.randomUUID();
    active.current = sessionId;
    let fixture, bridge, frame, timer, unsubscribeMedia, destroyed = false, loaded = false;
    const live = () => !destroyed && active.current === sessionId;
    const stop = async () => {
      if (destroyed) return;
      destroyed = true;
      active.current = null;
      clearTimeout(timer);
      unsubscribeMedia?.();
      consent.current?.('deny');
      consent.current = null;
      frame?.remove();
      // Revoke source/session before closing SDK transports so queued traffic
      // cannot submit a request while the React view is being torn down.
      await bridge?.close().catch(() => {});
      await fixture?.close();
    };
    void (async () => {
      try {
        const runtime = typeof resourceHtml === 'string' && resourceHtml.trim() ? resourceHtml : null;
        fixture = await createDemoMcpFixture({resourceHtml: runtime || appResource, invokeHostIntent: async intent => {
          const result = await invokeD4AppIntent(intent, desktopBridge(), {...props.current.proposalContext,
            isActive:live,
            requestApproval: preview => {
              if (!live() || consent.current) throw new Error('Host approval is already pending or expired');
              setPending(preview);
              return new Promise(resolve => {consent.current = resolve;});
            },
          });
          if (live()) setReceipt(result.structuredContent);
          return result;
        }});
        if (!live()) { await fixture.close(); return; }
        // B6: no UI capability is a normal answer, not a crash. Say so and let
        // the message text carry the result; do not render an empty App frame.
        if (!fixture.negotiated) {
          if (live()) { setFallback('no_ui'); setStatus(t(appFallbackNotice('no_ui'))); }
          await stop();
          return;
        }
        const read = await fixture.client.readResource({uri: fixture.resourceUri});
        const resource = read.contents.find(item => item.uri === fixture.resourceUri && item.mimeType === 'text/html;profile=mcp-app');
        if (!resource) {
          if (live()) { setFallback('no_resource'); setStatus(t(appFallbackNotice('no_resource'))); }
          await stop();
          return;
        }
        if (!live()) { await stop(); return; }
        const nonce = crypto.randomUUID().replaceAll('-', '');
        // A third-party document has no host placeholders; wrap it instead.
        const document = runtime ? makeRuntimeAppDocument(resource.text, nonce) : makeAppDocument(resource.text, nonce);
        frame = window.document.createElement('iframe');
        frame.name = 'withu-mcp-app';
        frame.setAttribute('aria-label', 'Withu local MCP App');
        for (const [key, value] of Object.entries(appIframePolicy)) frame.setAttribute(key === 'referrerPolicy' ? 'referrerpolicy' : key, value);
        frame.addEventListener('load', () => {
          if (!frame.srcdoc) return;
          if (loaded) { if (live()) setStatus(t('App 导航已被阻止；重新打开以重连')); void stop(); }
          loaded = true;
        });
        mount.current.append(frame);
        const source = frame.contentWindow;
        const transport = createGuardedAppTransport({source, sessionId, activeSession: () => active.current});
        bridge = new AppBridge(fixture.client, {name: 'Withu Comfort', version: '1.0.0'}, {serverTools: {}}, {strict: true});
        bridge.oninitialized = () => {
          if (!live()) return;
          unsubscribeMedia?.();
          unsubscribeMedia = mediaCoordinator.subscribe(value => bridge.setHostContext({withuMedia:value}));
          clearTimeout(timer);
          setStatus(t('本地 MCP App 已连接 · 操作需在 Withu 审批'));
        };
        bridge.onsizechange = size => {
          if (live() && validateAppSize(size)) frame.style.height = `${size.height}px`;
        };
        bridge.onopenlink = async () => ({isError: true});
        bridge.onrequestteardown = () => { void stop(); props.current.onClose?.(); };
        await bridge.connect(transport);
        if (!live()) { await bridge.close(); return; }
        timer = setTimeout(() => { if (live()) {setStatus(t('MCP App 握手超时；重新打开可重试')); void stop();} }, 10_000);
        frame.srcdoc = document;
      } catch (error) {
        const kind = classifyAppFailure(error);
        if (live()) { setFallback(kind); setStatus(t(appFallbackNotice(kind))); }
        await stop();
      }
    })();
    return () => { void stop(); };
  }, [pageHidden]);

  const decide = decision => {
    const resolve = consent.current;
    consent.current = null;
    setPending(null);
    resolve?.(decision);
  };

  return <section className={'withu-mcp-host' + (inline ? ' is-inline' : '') + (curtain ? ' is-curtain' : '')} aria-label="Withu MCP App host">
    {!curtain && <header>
      <div>
        <strong>{inline ? 'MCP App' : 'Withu Local MCP App'}</strong>
        {inline ? <p className="withu-mcp-inline-status" role="status">{status}</p> : <p>{t('本地标准 MCP App · 未连接第三方账号或服务')}</p>}
      </div>
      {onClose && <button type="button" onClick={onClose}>{t('关闭')}</button>}
    </header>}
    {!inline && !curtain && <p role="status">{status}</p>}
    {curtain && <p className="withu-mcp-curtain-status" role="status">{status}</p>}
    {pending && <section className="withu-mcp-approval" aria-label="Withu host action approval">
      <strong>确认本次本地操作</strong>
      <p>{pending.plan?.goal?.description || '将保存一条本地注记'}。影响范围：仅这台设备，不连接第三方服务。</p>
      <p>保存内容：{String(pending.plan?.actions?.[0]?.parameters?.value?.value ?? pending.plan?.actions?.[0]?.parameters?.value ?? '请展开详情核对内容')}</p>
      <button type="button" onClick={() => decide('allow_once')}>Allow once · 仅允许这次</button>
      <button type="button" onClick={() => decide('deny')}>拒绝</button>
      <details><summary>查看技术详情</summary><pre>{JSON.stringify(pending, null, 2)}</pre></details>
    </section>}
    {receipt && <p className="withu-mcp-receipt" role="status">{receipt.status === 'applied' && receipt.effect_committed ? '已完成：本地操作已保存。' : '未完成：没有写入本地内容。'}</p>}
    {/* B6: without a usable UI there is no frame; the status line above already
        says the result is text, and an empty box would only pretend otherwise. */}
    {!fallback && <div className="withu-mcp-frame" ref={mount}/>}
    {!inline && !curtain && <footer>{t('操作请求仅进入可信 host 的 typed intent 边界。缺少 D4 RPC 或已提交的用户消息证据时不提交操作。成功仅以 D4 receipt 为准。')}</footer>}
  </section>;
}
