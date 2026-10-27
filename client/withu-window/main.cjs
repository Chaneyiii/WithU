const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,clipboard,dialog,shell,nativeTheme}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises');
const speechCheck=process.argv.includes('--withu-speech-check');
const check=process.argv.includes('--withu-check')||speechCheck;
const fakeSpeech=process.argv.includes('--withu-fake-speech')||speechCheck;
if(fakeSpeech&&(!process.env.WITHU_CHECK_DATA||path.resolve(process.env.WITHU_CHECK_DATA).toLowerCase()===path.resolve(app.getPath('userData')).toLowerCase()))throw Error('fake speech requires isolated WITHU_CHECK_DATA');
const {trustedGuiUrl,permitsAudio}=require('./device-policy.cjs');
const {showProactivityNotification,settleInterruptedNotifications}=require('./proactivity-notifications.cjs');
const {createProactivityRunner}=require('./proactivity-runner.cjs');
const {createMcpClient}=require('../withu-mcp-client/index.mjs');
const {randomUUID}=require('node:crypto');
let rendererId=randomUUID(),audioArmedUntil=0,audioCaptureAuthorized=false,cleanupWaiter=null,cleanRendererId=null;
if(check||fakeSpeech)app.setPath('userData',process.env.WITHU_CHECK_DATA||path.resolve('output/p1/electron-userData'));
// Dev data isolation (2026-10-25, pre-Phase-3): unpackaged dev runs opt into a
// separate userData with --withu-dev-data so they never share the packaged
// app's user library (%AppData%\Withu). Location overridable via WITHU_DEV_DATA.
const devData=process.argv.includes('--withu-dev-data');
if(devData&&!app.isPackaged)app.setPath('userData',process.env.WITHU_DEV_DATA||path.resolve('output/dev-userData'));
if(speechCheck||(check&&process.env.WITHU_CHECK_CONFIG==='1'))app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.setName('Withu');
const withuVersion='v0.3.1go5';
// A custom AppUserModelID only helps when a matching Start Menu shortcut exists.
// shell.writeShortcutLink returns false on hosts that block the IShellLink COM
// object, so the shortcut never appeared and the taskbar fell back to a generic
// icon. Without an explicit AUMID Windows uses the executable's own icon, which
// is what this build ships.
let owner,win,tray,exiting=false,quitPromise,serverFailure,proactivityRunner,proactivityTimer;
const rendererRoot=path.resolve(__dirname,'../withu-renderer/dist'), entry=path.join(rendererRoot,'index.html');
const dev=process.env.WITHU_DEV_URL;
if(dev&&new URL(dev).origin!=='http://127.0.0.1:4173')throw new Error('unapproved development URL');
const binary=app.isPackaged?path.join(process.resourcesPath,'withu-server.exe'):process.env.WITHU_SERVER_BINARY||path.resolve(__dirname,'../../target/debug/withu-server.exe');
// MCP host wiring (B1). A configured server is started with the app, its tools
// are registered with the session, and every `mcp.invoke` is executed here —
// write-class tools only after the user agrees in a native dialog.
let mcpClient=null,mcpWrites=new Set();
async function startMcp(){
 if(!process.env.WITHU_MCP_COMMAND)return;
 try{
  mcpClient=createMcpClient({command:process.env.WITHU_MCP_COMMAND,args:(process.env.WITHU_MCP_ARGS||'').split(/\s+/).filter(Boolean),cwd:process.cwd()});
  await mcpClient.initialize({name:'withu-host',version:withuVersion});
  const {tools=[]}=await mcpClient.listTools();
  const server=process.env.WITHU_MCP_SERVER||'local';
  const defs=tools.map(tool=>({name:`mcp__${server}__${tool.name}`,description:tool.description||'',input_schema:tool.inputSchema||{type:'object'},write:Boolean(tool.annotations&&tool.annotations.destructiveHint)}));
  mcpWrites=new Set(defs.filter(entry=>entry.write).map(entry=>entry.name));
  await owner.request('withu:mcp:tools_register',{tools:defs});
 }catch(error){console.error('mcp bootstrap failed:',error.message);}
}
async function handleMcpEvent(event){
 const call=event?.record?.event==='mcp.invoke'?event.data?.mcp:null;
 if(!call||!mcpClient||!owner?.ready)return;
 const localName=call.name.split('__').slice(2).join('__');
 try{
  if(call.write){
   const {response}=await dialog.showMessageBox(win,{type:'question',buttons:['取消','允许一次'],defaultId:0,cancelId:0,title:'需要你确认',message:`${localName} 会修改本地数据。`,detail:'这是 MCP App 提供的写入工具，只有你允许后才会执行。',noLink:true});
   if(response!==1){await owner.request('withu:mcp:invoke_result',{operation_id:call.operation_id,ok:false,text:'你取消了这次调用。'});return;}
  }
  const result=await mcpClient.callTool(localName,call.arguments||{});
  const text=(result.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n')||'（没有文本结果）';
  await owner.request('withu:mcp:invoke_result',{operation_id:call.operation_id,ok:true,text});
 }catch(error){
  await owner?.request('withu:mcp:invoke_result',{operation_id:call.operation_id,ok:false,text:error.code||error.message}).catch(()=>{});
 }
}
app.on('before-quit',()=>{void mcpClient?.close().catch(()=>{});});
function trusted(event){if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame||!trustedGuiUrl(event.senderFrame?.url,entry,dev))throw Error('authorization: untrusted frame');}
async function cleanRenderer(reason){
 audioArmedUntil=0;audioCaptureAuthorized=false;
 if(cleanRendererId===rendererId)return true;
 if(!win||win.isDestroyed())return true;
 if(cleanupWaiter)return cleanupWaiter.promise;
 const nonce=randomUUID();let resolve;const promise=new Promise(r=>resolve=r);const timer=setTimeout(()=>{cleanupWaiter=null;resolve(false);},1000);cleanupWaiter={nonce,promise,resolve:value=>{clearTimeout(timer);cleanupWaiter=null;resolve(value);}};
 win.webContents.send('withu:speech:cleanup_request',{nonce,reason});
 const released=await promise;if(released)cleanRendererId=rendererId;
 await owner?.request('withu:speech:detach',{renderer_id:rendererId}).catch(()=>{});
 return released;
}
function register(channel,handler){ipcMain.handle(channel,(event,...args)=>{trusted(event);return handler(...args);});}
async function createWindow(){if(win&&!win.isDestroyed()){win.show();win.focus();return win;}win=new BrowserWindow({width:1440,height:858,minWidth:760,minHeight:600,titleBarStyle:'hidden',frame:false,thickFrame:true,autoHideMenuBar:true,show:true,title:'Withu '+withuVersion,icon:app.isPackaged?path.join(process.resourcesPath,'withu-icon.ico'):path.resolve(__dirname,'withu-icon.ico'),backgroundColor:'#fafbfc',webPreferences:{preload:path.resolve(__dirname,'../withu-preload/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:true}});win.setIcon(nativeImage.createFromPath(path.resolve(__dirname,'withu-icon.ico')));win.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>{const allowed=permitsAudio({trusted:contents===win.webContents&&trustedGuiUrl(details.requestingUrl,entry,dev),visible:win.isVisible(),armed:Date.now()<audioArmedUntil,permission,isMainFrame:details.isMainFrame,mediaTypes:details.mediaTypes});if(allowed){audioArmedUntil=0;audioCaptureAuthorized=true;}callback(allowed);});
const sendWindowState=()=>{if(win&&!win.isDestroyed())win.webContents.send('withu:window:state',{maximized:win.isMaximized(),fullscreen:win.isFullScreen()});};['maximize','unmaximize','enter-full-screen','leave-full-screen','resize'].forEach(name=>win.on(name,sendWindowState));win.webContents.on('did-finish-load',sendWindowState);
win.webContents.session.setPermissionCheckHandler((contents,permission,_origin,details)=>{const allowed=permitsAudio({trusted:contents===win.webContents&&trustedGuiUrl(details.requestingUrl,entry,dev),visible:win.isVisible(),armed:Date.now()<audioArmedUntil,permission,isMainFrame:details.isMainFrame,mediaType:details.mediaType});if(allowed)audioCaptureAuthorized=true;return allowed;});win.on('close',event=>{if(!exiting){event.preventDefault();void cleanRenderer('window_close').finally(()=>{win.hide();});}});win.on('show',()=>{cleanRendererId=null;win.webContents.send('withu:speech:reattach');});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-frame-navigate',event=>{if(!require('./mcp-frame-policy.cjs').allowMcpFrameNavigation(event))event.preventDefault();});win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(dev||'file://'))event.preventDefault();});win.webContents.on('render-process-gone',(_event,details)=>{audioArmedUntil=0;audioCaptureAuthorized=false;void owner?.request('withu:speech:detach',{renderer_id:rendererId}).catch(()=>{});
 // 渲染进程崩了不能把用户晾在那儿：窗口会变成一块点不动的死画面。
 // 这里直接把界面重新加载一遍，用户回到原地继续用（数据都在本地 Server 里）。
 if(win&&!win.isDestroyed()&&!exiting){if(!win.isVisible()){win.show();}try{win.webContents.reloadIgnoringCache();}catch{}}});
win.webContents.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace){audioArmedUntil=0;audioCaptureAuthorized=false;const previous=rendererId;rendererId=randomUUID();void owner?.request('withu:speech:detach',{renderer_id:previous}).catch(()=>{});}});await (dev?win.loadURL(dev):win.loadFile(entry,process.argv.includes('--withu-model-settings')?{hash:'/settings/general'}:{}));return win;}
async function completeExit(){if(quitPromise)return quitPromise;exiting=true;clearInterval(proactivityTimer);proactivityRunner?.stop();quitPromise=(async()=>{let result;try{const clientReleased=await cleanRenderer('app_quit');result=await owner?.quit();if(!clientReleased)result={...result,phase:'failed',resources_released:false,reason:'renderer_audio_cleanup_timeout_or_failure'};}catch(e){result={phase:'failed',resources_released:false,reason:e.message};await owner?.forceStop();}if(check)return result;tray?.destroy();app.exit(result?.phase==='complete'?0:1);return result;})();return quitPromise;}
app.on('before-quit',event=>{event.preventDefault();void completeExit();});
app.on('window-all-closed',()=>{});
app.on('activate',()=>void createWindow());
if(!app.requestSingleInstanceLock()){app.exit(0);}else{
app.on('second-instance',()=>void createWindow());
app.whenReady().then(async()=>{
 const {ClientServerOwner}=await import('./index.mjs');const {channels,validatePublicConfig}=await import('../withu-ipc/index.mjs');const {validateExternalUrl}=await import('./external-links.mjs');
 owner=new ClientServerOwner(binary,{dataDir:path.join(app.getPath('userData'),'withu'),test:check,fakeSpeech});
 owner.on('event',e=>{void handleMcpEvent(e);if(owner?.ready&&!exiting&&win&&!win.isDestroyed())win.webContents.send('withu:server:event',e);});owner.on('status',s=>{serverFailure=s;if(owner?.ready&&!exiting&&win&&!win.isDestroyed())win.webContents.send('withu:server:connection',s);});
 try{await owner.start();}catch(e){serverFailure={lifecycle:'failed',reason:e.message};}
  await startMcp().catch(()=>{});
 async function deliverProactivity(candidateId){if(!candidateId||!owner?.ready||exiting)return null;const entries=(await owner.request('withu:proactivity:feed_list')).items;const entry=entries.find(item=>item.candidate_id===candidateId);if(!entry||entry.notification_status!=='pending')return null;return showProactivityNotification({Notification:require('electron').Notification,eligible:true,appRunning:owner?.ready&&app.isReady()&&!exiting,preview:false,onClick:()=>{if(!win||win.isDestroyed())return;if(!win.isVisible())win.show();if(win.isMinimized())win.restore();win.focus();}});}
 if(owner.ready)await settleInterruptedNotifications({owner,appRunning:()=>!exiting}).catch(()=>{});
 if(owner.ready&&!check){proactivityRunner=createProactivityRunner({owner,isRunning:()=>owner.ready&&!exiting,deliver:deliverProactivity});proactivityTimer=setInterval(()=>void proactivityRunner.tick().catch(()=>{}),30000);}
 const blocked=['withu:server:shutdown','withu:speech:event','withu:task:events','withu:library:update','withu:speech:start','withu:speech:command','withu:speech:detach','withu:speech:stop','withu:voice:session:start','withu:voice:session:command','withu:voice:request','withu:realtime:start','withu:realtime:input','withu:realtime:command'];
 for(const channel of channels.filter(c=>!blocked.includes(c)&&!['withu:life:tick','withu:proactivity:candidate_offer','withu:proactivity:notification_result'].includes(c)))register(channel,async payload=>{if(!owner.ready||owner.failure||exiting)throw new Error(serverFailure?.reason||'server not ready');const result=await owner.request(channel,payload);if(result.config)result.config=validatePublicConfig(result.config);return result;});
 register('withu:speech:capability',()=>({enabled:fakeSpeech,synthetic:fakeSpeech,realProvidersConfigured:false}));
 register('withu:speech:start',payload=>{cleanRendererId=null;return owner.request('withu:speech:start',{...payload,renderer_id:rendererId});});
 register('withu:realtime:start',payload=>{if(payload.mode!=='read'&&!audioCaptureAuthorized)throw Error('microphone_permission_revoked');cleanRendererId=null;return owner.request('withu:realtime:start',{...payload,renderer_id:rendererId});});
 register('withu:realtime:input',async payload=>{if(check&&process.env.WITHU_CHECK_REALTIME==='1'&&payload.sequence===1)await new Promise(resolve=>setTimeout(resolve,300));if(!audioCaptureAuthorized)throw Error('microphone_permission_revoked');return owner.request('withu:realtime:input',{...payload,scope:{...payload.scope,renderer_id:rendererId}});});
 register('withu:realtime:command',payload=>owner.request('withu:realtime:command',{...payload,scope:{...payload.scope,renderer_id:rendererId}}));
 register('withu:voice:session:start',payload=>{cleanRendererId=null;return owner.request('withu:voice:session:start',{...payload,renderer_id:rendererId});});
 register('withu:voice:session:command',payload=>owner.request('withu:voice:session:command',{...payload,scope:{...payload.scope,renderer_id:rendererId}}));
 register('withu:voice:request',payload=>owner.request('withu:voice:request',{...payload,...(payload.scope?{scope:{...payload.scope,renderer_id:rendererId}}:{})}));
 register('withu:speech:command',async payload=>{if(payload?.command==='input'&&payload.source==='user_microphone'&&!audioCaptureAuthorized)throw Error('microphone_permission_revoked');if(speechCheck&&process.env.WITHU_SPEECH_CHECK_SCENARIO==='capture_pending_inputs'&&payload.command==='input')await new Promise(resolve=>setTimeout(resolve,160));if(payload?.command==='input'&&payload.source==='user_microphone'&&!audioCaptureAuthorized)throw Error('microphone_permission_revoked');return owner.request('withu:speech:command',{...payload,renderer_id:rendererId});});
 register('withu:speech:authorize_audio',async payload=>{if(!win.isVisible())throw Error('explicit_start_window_hidden');if(typeof payload?.gesture_token!=='string'||payload.gesture_token.length!==36)throw Error('explicit_start_gesture_token');cleanRendererId=null;audioArmedUntil=Date.now()+10000;return true;});
 register('withu:speech:revoke_audio',()=>{audioArmedUntil=0;audioCaptureAuthorized=false;return true;});
 register('withu:speech:cleanup_ack',({nonce,released})=>{if(cleanupWaiter?.nonce!==nonce)throw Error('cleanup_nonce');cleanupWaiter.resolve(released===true);return true;});
 register('withu:clipboard:copy',text=>{if(typeof text!=='string'||text.length>256000)throw new Error('text size');clipboard.writeText(text);return true;});
 register('withu:files:import',async files=>{const {importSelectedFiles}=await import('./file-import.mjs');return importSelectedFiles(owner,path.join(app.getPath('userData'),'withu'),files);});
 register('withu:dialog:files',async()=>{const {canceled,filePaths}=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections']});if(canceled)return[];const files=[];for(const p of filePaths){const stat=await fs.stat(p);const object={schema_version:1,id:require('node:crypto').randomUUID(),name:path.basename(p),path:p,size:stat.size,type:path.extname(p).slice(1),modified:stat.mtime.toISOString(),version:1};files.push((await owner.request('withu:library:update',{object,expected_version:0})).object);}return files;});
 register('withu:file:open',async id=>{if(typeof id!=='string')throw new Error('file id');const {object}=await owner.request('withu:library:get',{id});if(!object)throw new Error('file reference deleted');const error=await shell.openPath(object.path);if(error)throw new Error(error);return true;});
 register('withu:dialog:export',async()=>{const data={schema_version:1,config:validatePublicConfig((await owner.request('withu:config:get')).config)};for(const d of ['conversation','project','goals','ideas','library'])data[d]=d==='conversation'?[...(await owner.request('withu:conversation:list',{mode:'comfort',project_id:null})).items,...(await owner.request('withu:conversation:list',{mode:'cowork',project_id:null})).items]:(await owner.request(`withu:${d}:list`)).items;data.messages=[];for(const c of data.conversation)data.messages.push(...(await owner.request('withu:message:list',{conversation_id:c.conversation_id})).items);const {canceled,filePath}=await dialog.showSaveDialog(win,{defaultPath:'withu-data-export.json'});if(canceled)return false;await fs.writeFile(filePath,JSON.stringify(data,null,2));return true;});
 register('withu:source:css',async()=>{const files=await fs.readdir(path.resolve(__dirname,'../withu-renderer/src')).catch(()=>[]);return (await Promise.all(files.filter(f=>f.endsWith('.css')).map(f=>fs.readFile(path.resolve(__dirname,'../withu-renderer/src',f),'utf8')))).join('\n');});
 register('withu:dialog:html',async(name,html)=>{if(typeof html!=='string'||html.length>1048576)throw new Error('HTML size');const {canceled,filePath}=await dialog.showSaveDialog(win,{defaultPath:'withu-visual-export.html'});if(canceled)return false;await fs.writeFile(filePath,html);return true;});
 register('withu:link:open',url=>shell.openExternal(validateExternalUrl(url)));
 register('withu:window:close',()=>cleanRenderer('window_hide').finally(()=>win.hide()));register('withu:window:minimize',()=>{win.minimize();return true;});register('withu:window:maximize',()=>{win.isMaximized()?win.unmaximize():win.maximize();return win.isMaximized();});register('withu:theme:set',theme=>{if(!['light','dark','system'].includes(theme))throw new Error('theme');nativeTheme.themeSource=theme;return true;});
 register('withu:edit:action',action=>{if(!['undo','redo','cut','copy','paste','selectAll'].includes(action))throw new Error('edit action');win.webContents[action]();return true;});
 register('withu:app:quit',()=>{void completeExit();return true;});
 const image=nativeImage.createFromPath(path.resolve(__dirname,'./withu-icon.png'));tray=new Tray(image);tray.setToolTip('Withu');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Withu',click:()=>void createWindow()},{label:'退出 Withu',click:()=>void completeExit()}]));tray.on('click',()=>void createWindow());
 await createWindow();
 if(check){try{const {runElectronChecks}=await import(speechCheck?'../../checks/speech-electron.mjs':'../../checks/electron.mjs');await runElectronChecks({app,owner,getWindow:()=>win,createWindow,completeExit,packaged:app.isPackaged});tray.destroy();app.exit(0);}catch(e){console.error(e);await completeExit();tray.destroy();app.exit(1);}}
}).catch(async e=>{console.error(e);await owner?.forceStop();app.exit(1);});
}
