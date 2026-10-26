import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {extractFile,listPackage} from '@electron/asar';
const root=path.resolve('output/p2/windows');const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));const archive=path.join(root,'Withu-win32-x64/resources/app.asar');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');const sha=async file=>digest(await fs.readFile(file));
const checks=[];
assert.equal(await sha(manifest.exe),manifest.sha256.client);assert.equal(await sha(manifest.server),manifest.sha256.server);assert.equal(await sha(archive),manifest.sha256.appArchive);assert.equal(await sha('target/p2/release/withu-server.exe'),manifest.sha256.server);checks.push('manifest client/server/archive and release Rust hash match');
const names=listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,''));const files=names.filter(name=>/^(client|contracts)\//.test(name)&&/\.(json|jsx|js|mjs|cjs|html|css|svg|png|ico|md)$/.test(name));files.push('checks/electron.mjs','checks/speech-electron.mjs','package.json');
const artifacts=[];
for(const file of files){const disk=await fs.readFile(path.resolve(file));const packed=extractFile(archive,path.normalize(file));if(file==='package.json'){const expected=JSON.parse(disk.toString());for(const field of ['scripts','devDependencies','private','workspaces'])delete expected[field];assert.deepEqual(JSON.parse(packed.toString()),expected,'verify exact packager production metadata projection');}else assert.equal(digest(disk),digest(packed),'packed source/asset mismatch '+file);artifacts.push({path:file,sha256:digest(packed)});}
assert.ok(files.some(file=>/^client\/withu-renderer\/dist\/assets\/capture-worklet-.*\.js$/.test(file)));assert.ok(!names.some(name=>/^(output|target|\.git)\//.test(name)));checks.push('packed contracts/bridges/source/built assets and AudioWorklet exactly match workspace; no output/userData');
const requested=process.argv.find(a=>a.startsWith('--suite='));let suite=null;
if(requested){suite=JSON.parse(await fs.readFile(path.resolve(requested.slice(8)),'utf8'));assert.equal(suite.packaged,true);assert.equal(suite.runs.length,15);for(const run of suite.runs){assert.equal(run.code,0);assert.equal(run.receipt.serverSha256,manifest.sha256.server);assert.equal(run.receipt.appArchiveSha256,manifest.sha256.appArchive);await fs.access(run.receipt.evidencePath);}checks.push('all 15 independent package runs exercised this exact immutable app archive and Rust binary');}
const result={schema_version:1,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTreeDirty:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim().length>0,checks,sha256:manifest.sha256,suiteRoot:suite?.root||null,artifacts,realAsrTts:'deferred until user configures models',signed:false};
await fs.writeFile(path.resolve('output/p2/package-freeze.json'),JSON.stringify(result,null,2));console.log('PASS P2 frozen package '+files.length+' files and '+(suite?.runs.length||0)+' verified run hashes');
