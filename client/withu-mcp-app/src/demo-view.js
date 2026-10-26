import {App, PostMessageTransport} from '@modelcontextprotocol/ext-apps';
import {bindMediaElement, localToneWav} from './media.js';

export async function startDemoView({transport = new PostMessageTransport(window.parent, window.parent)} = {}) {
  const app = new App({name: 'Withu Local Demo App', version: '1.0.0'}, {}, {strict: true});
  const button = document.querySelector('[data-request-demo]');
  const status = document.querySelector('[data-demo-status]');
  if (!button || !status) throw new Error('demo app resource is incomplete');

  let stopped = false;
  const media = document.querySelector('[data-local-media]');
  const mediaButton = document.querySelector('[data-play-media]');
  const mediaStatus = document.querySelector('[data-media-status]');
  let mediaBusy = true;
  const binding = media && mediaButton && mediaStatus ? bindMediaElement(media, busy => {
    mediaBusy = busy;mediaButton.disabled = busy;
    mediaStatus.textContent = busy ? '语音进行中，媒体已暂停。' : '本地测试音频 · 点击播放；语音结束后需手动继续。';
  }) : null;
  if (media) {media.src=localToneWav();media.volume=.2;}
  const playMedia = async () => {
    if (stopped || mediaBusy || !media) return;
    if (!media.paused) {media.pause();return;}
    try {await media.play();} catch {mediaStatus.textContent='音频无法播放，请再次点击或检查音频输出。';}
  };
  const guardPlayback = () => {if (stopped || mediaBusy) media.pause();};
  mediaButton?.addEventListener('click',playMedia);
  media?.addEventListener('play',guardPlayback);
  app.onhostcontextchanged = context => binding?.update(context.withuMedia);
  const cleanupMedia = () => {binding?.close();mediaButton?.removeEventListener('click',playMedia);media?.removeEventListener('play',guardPlayback);media?.removeAttribute('src');media?.load();};
  // 架构图的交互：悬停预览、点击钉住，右下角随时能切深浅色。
  const board = document.querySelector('[data-arch]');
  const stage = board?.querySelector('.stage');
  const detail = document.querySelector('[data-detail]');
  const nodes = [...(stage?.querySelectorAll('[data-node]') || [])];
  const hint = detail?.textContent || '';
  let pinned = null;
  const show = node => {
    nodes.forEach(item => item.classList.toggle('is-active', item === node));
    stage?.classList.toggle('has-active', Boolean(node));
    if (!detail) return;
    detail.textContent = '';
    if (node) {
      const name = document.createElement('b');
      name.textContent = node.dataset.name || '';
      detail.append(name, node.dataset.desc || '');
    } else {
      detail.textContent = hint;
    }
  };
  const onEnter = node => () => { if (!pinned) show(node); };
  const onLeave = () => { if (!pinned) show(null); };
  const onClick = node => () => { pinned = pinned === node ? null : node; show(pinned); };
  nodes.forEach(node => {
    node.addEventListener('pointerenter', onEnter(node));
    node.addEventListener('pointerleave', onLeave);
    node.addEventListener('click', onClick(node));
  });
  const themeButton = document.querySelector('[data-theme-toggle]');
  const toggleTheme = () => {
    if (!board) return;
    board.classList.toggle('is-dark');
    themeButton.textContent = board.classList.contains('is-dark') ? '浅色' : '深色';
  };
  themeButton?.addEventListener('click', toggleTheme);
  const teardownBoard = () => {
    nodes.forEach(node => {
      node.removeEventListener('pointerenter', onEnter(node));
      node.removeEventListener('pointerleave', onLeave);
      node.removeEventListener('click', onClick(node));
    });
    themeButton?.removeEventListener('click', toggleTheme);
  };

  const requestAction = async () => {
    button.disabled = true;
    status.textContent = '正在提交到 Withu…';
    try {
      const result = await app.callServerTool({name: 'request-demo-intent', arguments: {operation: 'local_annotation', version: 1, value: 'take a break'}});
      const detail = result.structuredContent;
      status.textContent = detail?.effect_committed === true && detail?.receipt?.status === 'applied'
        ? `已在本地保存：${result.content?.[0]?.text || '已生效。'}`
        : result.content?.[0]?.text || '未提交：没有生成确认结果。';
    } catch {
      status.textContent = '不可用：host 没有接受这次请求。';
    } finally {
      if (!stopped) button.disabled = false;
    }
  };
  button.addEventListener('click', requestAction);
  app.onteardown = async () => {
    stopped = true;
    cleanupMedia();
    teardownBoard();
    button.removeEventListener('click', requestAction);
    return {};
  };
  await app.connect(transport);
  binding?.update(app.getHostContext()?.withuMedia);
  button.disabled = false;
  status.textContent = '已连接 Withu；操作会在可信 host 中单独确认。';
  return async () => {
    stopped = true;
    cleanupMedia();
    teardownBoard();
    button.removeEventListener('click', requestAction);
    await app.close().catch(() => {});
  };
}
