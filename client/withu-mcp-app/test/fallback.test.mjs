import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_ERROR, APP_FALLBACK, classifyAppFailure, appFallbackNotice} from '../src/app-fallback.js';

test('a service without UI is classified, never reported as compatible', () => {
  assert.equal(classifyAppFailure(new Error(APP_ERROR.noUi)), 'no_ui');
  assert.equal(classifyAppFailure(new Error(APP_ERROR.noResource)), 'no_resource');
  assert.equal(classifyAppFailure(new Error('boom')), 'error');
  assert.equal(classifyAppFailure(undefined), 'error');
});

test('every fallback notice promises text and never a rendered App', () => {
  for (const kind of ['no_ui', 'no_resource', 'error']) {
    const text = appFallbackNotice(kind);
    assert.match(text, /文字/, kind + ' must say the result is text');
    assert.doesNotMatch(text, /已连接|已加载|正常/, kind + ' must not claim a working App');
  }
  assert.notEqual(appFallbackNotice('no_ui'), appFallbackNotice('no_resource'), 'the two causes stay distinguishable');
});

test('an unknown cause falls back to the generic notice instead of nothing', () => {
  assert.equal(appFallbackNotice('mystery'), APP_FALLBACK.error);
});
