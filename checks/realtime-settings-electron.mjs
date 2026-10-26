import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function realtimeSettingsChecks({wc,root}) {
 const js=s=>wc().executeJavaScript(s,true);
 const wait=async s=>{for(let i=0;i<80;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,80));}throw Error('UI timeout '+s);};
 const call=(m,p={})=>js(`window.withuDesktop.${m}(${JSON.stringify(p)})`);
 await js("location.hash='/settings/general'");
 await wait("document.querySelectorAll('[data-service]').length===2");
 assert.deepEqual(await js("[...document.querySelectorAll('[data-service]')].map(e=>e.dataset.service)"),['llm','realtime']);
 assert.equal(await js("!!document.querySelector('.local-voice-list,.voice-installed-list')"),false);
 await js("document.querySelector('[data-service=\"realtime\"] .model-expand-icon').click()");
 await wait("!!document.querySelector('.provider-dialog-toolbar')");
 await js("document.querySelector('.provider-dialog-toolbar button').click()");
 await wait("!!document.querySelector('.model-secret input')");
 await js("(()=>{const e=document.querySelector('.model-secret input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'FICTIONAL-SETTINGS-ONLY');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await js("[...document.querySelectorAll('.model-editor button')].find(e=>e.textContent==='保存提供商').click()");
 await wait("!document.querySelector('.model-editor')");
 let config=(await call('configGet')).config;
 assert.equal(config.providers.length,1);assert.equal(config.providers[0].service,'realtime');assert.equal(config.model_overrides.realtime.model_ref,'1.2.6.1');assert.equal(config.defaults.llm,null);
 assert.ok(!JSON.stringify(config).includes('FICTIONAL-SETTINGS-ONLY'));
 await js("document.querySelector('.modal header .icon-button').click()");
 await js("document.querySelector('[data-config-card=realtime]').click()");
 await wait("!!document.querySelector('input[aria-label=\"实时语音模型／版本\"]')");
 assert.equal(await js("(()=>{const e=document.querySelector('input[aria-label=\"实时语音模型／版本\"]');return Boolean(e?.disabled||e?.readOnly)})()"),true);
 await js("[...document.querySelectorAll('.model-actions button')].find(e=>e.textContent==='测试连接').click()");
 await wait("document.querySelector('.model-result')?.textContent.includes('实时语音协议尚未接入')");
 for(let attempt=0;attempt<4;attempt++){try{await fs.writeFile(path.join(root,'realtime-settings.png'),(await wc().capturePage()).toPNG());break;}catch(e){if(attempt===3)throw e;await new Promise(r=>setTimeout(r,300));}}
 await js("document.querySelector('.modal header .icon-button').click();location.hash='/chat'");
 await wait("!!document.querySelector('.composer textarea')");
 assert.equal(await js("document.querySelectorAll('.chat-cowork-topbar').length"),0);
 config=(await call('configGet')).config;
 await call('configUpdate',{schema_version:1,expected_version:config.config_version,config:{...config,config_version:config.config_version+1,providers:[],defaults:{llm:null,realtime:null},model_overrides:{},speech_preferences:{}},credential_changes:[]});
 console.log('PASS Electron independent realtime settings, synthetic credential save, fixed model, unsupported status, chat render');
}

