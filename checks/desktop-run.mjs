import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';
const p2=process.argv.includes('--p2'),p3=process.argv.includes('--p3');
if(p2&&p3)throw Error('choose one check stage');
const packaged=process.argv.includes('--packaged');const exe=packaged?path.resolve(process.env.WITHU_PACKAGED_EXE||`output/${p3?'p3':p2?'p2':'p1'}/windows/Withu-win32-x64/Withu.exe`):electron;
const root=await fs.mkdtemp(path.resolve(p3?'output/p3/desktop-run-':p2?'output/p2/desktop-regression-':'output/p1/desktop-run-'));const results=[];
for(const scenario of ['normal','restart','malformed','crash','eof','timeout']){
 const data=path.join(root,['normal','restart'].includes(scenario)?'persistent-userData':scenario+'-userData');
 // This host's Chromium cannot start its GPU process; the switches are inert
 // on machines where it can, and without them every scenario dies before the app.
 const gpu=['--no-sandbox','--disable-gpu-sandbox','--disable-gpu'];
 const args=(packaged?['--withu-check']:['.','--withu-check']).concat(gpu);
 const env={...process.env,...(p2?{WITHU_SERVER_BINARY:path.resolve('target/p2/debug/withu-server.exe')}:{}),WITHU_CHECK_DATA:data,WITHU_CHECK_OUTPUT:path.join(root,scenario),WITHU_CHECK_SCENARIO:scenario,WITHU_CHECK_EXPECT_RESTORE:scenario==='restart'?'1':'0',WITHU_TEST_START:scenario==='malformed'?'malformed':scenario==='timeout'?'hang':''};
 delete env.ELECTRON_RUN_AS_NODE;const began=Date.now();const child=spawn(exe,args,{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const code=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('Desktop check timeout '+scenario));},45000);child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',c=>{clearTimeout(timeout);resolve(c);});});
 await fs.writeFile(path.join(root,scenario+'.log'),stdout+'\n'+stderr);assert.equal(code,0,scenario+' failed: '+stderr);assert.ok(stdout.includes('PASS Electron'),scenario+' did not run checks');results.push({scenario,code,durationMs:Date.now()-began});console.log('PASS '+(packaged?'packaged':'development')+' Electron '+scenario);
}
await fs.writeFile(path.join(root,'results.json'),JSON.stringify({exe,packaged,results,root},null,2));console.log('Desktop evidence '+root);
