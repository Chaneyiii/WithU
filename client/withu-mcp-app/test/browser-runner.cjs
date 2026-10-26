const {app, BrowserWindow, ipcMain} = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
app.whenReady().then(async () => {
  let owner, dataDir;
  const d4 = process.env.WITHU_MCP_TEST_D4 === '1';
  let Owner;
  if (d4) {
    const {pathToFileURL} = require('node:url');
    const root = process.env.WITHU_D4_WORKTREE || process.cwd();
    ({ClientServerOwner:Owner} = await import(pathToFileURL(path.join(root,'client/withu-window/index.mjs')).href));
    dataDir = await require('node:fs/promises').mkdtemp(path.join(require('node:os').tmpdir(),'withu-mcp-d4-'));
    owner = new Owner(process.env.WITHU_SERVER_BINARY || path.join(root,'target/debug/withu-server.exe'), {dataDir,test:true});
    await owner.start();
    await owner.request('withu:conversation:update',{expected_version:0,object:{schema_version:1,conversation_id:'mcp-test-chat',mode:'comfort',project_id:null,title:'MCP test',last_activity_at:'1',task_refs:[],draft_ref:null,version:1}});
    await owner.request('withu:message:submit',{expected_version:0,object:{schema_version:1,id:'mcp-test-user',conversation_id:'mcp-test-chat',role:'user',text:'Please record a local annotation',file_refs:[],submitted_at:'1',version:1}});
  }
  const win = new BrowserWindow({show:false, webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:true,...(d4 ? {preload:path.join(__dirname,'browser-preload.cjs')} : {})}});
  for (const [method,channel] of Object.entries({actionPreview:'action:preview',actionDecide:'action:decide',actionExecute:'action:execute',annotationGet:'annotation:get'})) ipcMain.handle('mcp-test:'+method,(event,payload)=>{
    assert.equal(event.senderFrame, win.webContents.mainFrame);
    return owner.request('withu:'+channel,payload);
  });
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-frame-navigate',event=>{if(!require('../../withu-window/mcp-frame-policy.cjs').allowMcpFrameNavigation(event))event.preventDefault();});
  const errors = [];
  win.webContents.on('console-message', event => {if (event.level === 'error') errors.push(event.message);});
  try {
    await win.loadFile(path.resolve(process.argv[2]));
    const deadline = Date.now() + 15_000;
    let status = '';
    while (Date.now() < deadline) {
      status = await win.webContents.executeJavaScript("document.querySelector('[role=status]')?.textContent || ''");
      if (status.includes('connected') || status.includes('unavailable:') || status.includes('timed out')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(status, /Local MCP App connected/, JSON.stringify({status, errors}));
    const frame = win.webContents.mainFrame.frames.find(frame => frame.url === 'about:srcdoc');
    assert.ok(frame, 'App runs in a separate iframe');
    const boundary = await frame.executeJavaScript("({node:typeof require, desktop:typeof window.withuDesktop, origin:window.origin, csp:document.querySelector('meta[http-equiv]').content})");
    assert.equal(boundary.node, 'undefined');
    assert.equal(boundary.desktop, 'undefined');
    assert.equal(boundary.origin, 'null');
    assert.match(boundary.csp, /script-src 'nonce-/);
    assert.match(boundary.csp, /media-src data:/);
    await frame.executeJavaScript("document.querySelector('[data-play-media]').click()", true);
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await frame.executeJavaScript("document.querySelector('[data-local-media]').paused"),false,'local audio plays after user action');
    await win.webContents.executeJavaScript('window.withuTestMediaBusy(true)');
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(await frame.executeJavaScript("document.querySelector('[data-local-media]').paused"),true,'SDK context pauses actual audio element');
    assert.equal(await frame.executeJavaScript("document.querySelector('[data-play-media]').disabled"),true);
    await win.webContents.executeJavaScript('window.withuTestMediaBusy(false)');
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(await frame.executeJavaScript("document.querySelector('[data-local-media]').paused"),true,'voice completion never autoplays media');
    assert.equal(await frame.executeJavaScript("document.querySelector('[data-play-media]').disabled"),false);
    console.log('PASS browser media: local data audio, SDK pause, disabled playback during voice, explicit resume required');
    await frame.executeJavaScript("document.querySelector('button').click()");
    if (d4) {
      let approval;
      while(Date.now()<deadline) {
        approval=await win.webContents.executeJavaScript("document.querySelector('.withu-mcp-approval')?.textContent || ''");
        if(approval.includes('Allow once'))break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.match(approval,/Please record a local annotation/);
      assert.equal((await owner.request('withu:annotation:get',{schema_version:1,scope:'comfort:local',target_id:'demo-item'})).annotation,null,'No effect before Allow');
      await win.webContents.executeJavaScript("document.querySelector('.withu-mcp-approval button').click()");
      let applied;
      while(Date.now()<deadline) {
        applied=await win.webContents.executeJavaScript("document.body.textContent");
        if(applied.includes('effect_committed: true'))break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.match(applied,/effect_committed: true/);
      const annotation=(await owner.request('withu:annotation:get',{schema_version:1,scope:'comfort:local',target_id:'demo-item'})).annotation;
      assert.equal(annotation.value,'take a break');
      assert.equal(annotation.version,2);
      await owner.quit();
      owner=new Owner(owner.executable,{dataDir,test:true});
      await owner.start();
      assert.deepEqual((await owner.request('withu:annotation:get',{schema_version:1,scope:'comfort:local',target_id:'demo-item'})).annotation,annotation,'Local effect persists across restart');
      await owner.quit();
      console.log('PASS browser + D4 owner: App proposal, host explicit Allow, real receipt, SQLite annotation, restart durability');
      win.destroy();app.exit(0);return;
    }
    let detail = '';
    while (Date.now() < deadline) {
      detail = await frame.executeJavaScript("document.querySelector('[data-demo-status]').textContent");
      if (detail.includes('Not submitted')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(detail, /Not submitted:.*D4/);
    assert.match(detail, /No action was created/);
    console.log('PASS browser: SDK handshake, opaque sandbox, no Node/preload, nonce CSP and D4 fail-closed');
    win.destroy(); app.exit(0);
  } catch(error) {console.error(error); console.error(errors); await owner?.forceStop();win.destroy(); app.exit(1);}
});
