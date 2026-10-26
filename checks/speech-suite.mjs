import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const packaged=process.argv.includes('--packaged');const one=process.argv.find(a=>a.startsWith('--only='));
const cases=one?[one.slice('--only='.length)]:['normal','matrix','capture_permission_revoke','capture_device_ended','capture_pending_inputs','capture_late_acquisition','capture_worklet_failure','capture_explicit_end','capture_acquisition_timeout','cleanup_failure','cleanup_timeout','server_crash','device_denied','device_missing','device_busy'];
const root=await fs.mkdtemp(path.resolve(packaged?'output/p2/packaged-suite-':'output/p2/development-suite-'));const runs=[];
// Deliberately serial: each run has independent userData, owner, resources and failure injection.
for(const scenario of cases){
 const env={...process.env,WITHU_SPEECH_CHECK_SCENARIO:''};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(process.execPath,['checks/speech-desktop-run.mjs','--scenario='+scenario,...(packaged?['--packaged']:[])],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';let errors='';child.stdout.on('data',b=>{output+=b;process.stdout.write(b);});child.stderr.on('data',b=>{errors+=b;process.stderr.write(b);});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});await fs.writeFile(path.join(root,scenario+'.log'),output+'\n'+errors);
 const line=output.split('\n').find(line=>line.startsWith('P2_RUN_RECEIPT '));const receipt=line?JSON.parse(line.slice('P2_RUN_RECEIPT '.length)):null;
 runs.push({scenario,code,receipt});await fs.writeFile(path.join(root,'results.json'),JSON.stringify({packaged,root,runs,realAsrTts:'deferred until model configuration',physicalHardware:'not measured; synthetic device lifecycle only'},null,2));assert.equal(code,0,'Failed '+scenario);assert.ok(receipt);await fs.access(receipt.evidencePath);
}
console.log('PASS P2 '+(packaged?'packaged':'development')+' suite '+runs.length+' isolated runs; '+root);
