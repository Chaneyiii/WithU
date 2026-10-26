// Final P3 regression uses isolated data and synthetic credentials only.
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const exe=path.resolve(process.env.WITHU_PACKAGED_EXE||'output/p3/windows-alpha16-final-20261014/Withu-win32-x64/Withu.exe');
const server=path.resolve(process.env.WITHU_SERVER_BINARY || 'output/p3/build-target/debug/withu-server.exe');
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const spec=path.join(repoRoot,'docs/product/withu-v3-spec.md');
await mkdir('output/p3/closeout',{recursive:true});
const root=await mkdtemp(path.resolve('output/p3/closeout/run-'));
const sha=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const manifestPath=path.resolve(path.dirname(exe),'..','manifest.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const files={client:exe,server:path.join(path.dirname(exe),'resources','withu-server.exe'),appArchive:path.join(path.dirname(exe),'resources','app.asar')};
const hashes=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>[key,await sha(file)])));
const runtimeFiles=execFileSync('git',['ls-files','client','apps','crates','contracts','Cargo.toml','Cargo.lock','package.json','package-lock.json'],{encoding:'utf8'}).trim().split(/\r?\n/);
const sourceHash=createHash('sha256');for(const file of runtimeFiles){sourceHash.update(file+'\0');sourceHash.update(await readFile(file));}
const report={startedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtimeSourceSha256:sourceHash.digest('hex'),
  sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),specSha256:await sha(spec),
  node:process.version,hardware:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()},
  package:{exe,manifestPath,hashes,manifestMatches:Object.keys(hashes).every(key=>hashes[key]===manifest.sha256[key]),signed:manifest.signed},
  syntheticFixtures:true,realCloud:false,realDevice:false,checks:[]};
const checks=[
  ['contracts'],['lifecycle'],['presence'],['model-config-gui'],['provider-presets'],['service-config'],['service-isolation'],['model-test-flight'],['orb-behavior'],['realtime-client'],
  ['server'],['speech-server'],['model-config-server'],['reply-wire'],['provider-discovery'],['owner-retention'],['realtime-output-safety'],['realtime-wire'],['volc-realtime-wire'],
  ['speech-suite'],['desktop-run','--p3','--packaged'],['realtime-desktop','--packaged'],['realtime-desktop','--volc','--packaged'],
  ['product-scan','--p3','--archive='+files.appArchive]
];
const env={...process.env,WITHU_SERVER_BINARY:server,WITHU_PACKAGED_EXE:exe};delete env.ELECTRON_RUN_AS_NODE;
for(const [name,...args] of checks){
  const began=performance.now();let stdout='',stderr='';
  const child=spawn(process.execPath,['checks/'+name+'.mjs',...args],{env,windowsHide:true});
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const id=name+(args.includes('--volc')?'-volc':'');
  await writeFile(path.join(root,id+'.log'),stdout+'\n'+stderr);
  report.checks.push({name:id,args,code,durationMs:Math.round(performance.now()-began),log:path.join(root,id+'.log')});
  await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));
  console.log((code===0?'PASS ':'FAIL ')+id+' '+Math.round(performance.now()-began)+'ms');
}
report.completedAt=new Date().toISOString();report.success=report.package.manifestMatches&&report.checks.every(check=>check.code===0);
await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));
console.log('P3_CLOSEOUT '+root+' success='+report.success);if(!report.success)process.exitCode=1;
