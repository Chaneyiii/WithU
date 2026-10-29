// Version consistency guard (non-GUI).
//
// Two hardcoded constants drifted from VERSION before go5: the window title
// said v0.3.1go5 while the About page said v0.3.1go4, and nothing failed.
// This check binds every place a version is written down to the VERSION file,
// so the next bump cannot silently update only one of them.
import {readFile} from 'node:fs/promises';
import {readdirSync} from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const fail=[];
const ok=[];

const version=(await readFile(path.join(root,'VERSION'),'utf8')).trim();
const goForm=/^v(\d+)\.(\d+)\.(\d+)go(\d+)$/.exec(version);
const rcForm=/^v(\d+)\.(\d+)-rc\.(\d+)$/.exec(version);
if(!goForm&&!rcForm)throw Error(`VERSION must look like vMAJOR.MINOR.PATCHgoN or vMAJOR.MINOR-rc.N, got ${JSON.stringify(version)}`);
const npmVersion=goForm
  ?`${goForm[1]}.${goForm[2]}.${goForm[3]}-go.${goForm[4]}`
  :`${rcForm[1]}.${rcForm[2]}.0-rc.${rcForm[3]}`;
ok.push(`VERSION=${version} (npm form ${npmVersion})`);

const expect=(label,actual)=>{
  if(actual===version)ok.push(label);
  else fail.push(`${label}: expected ${version}, got ${actual}`);
};

// 1. Renderer constant (About page + Settings row).
const renderer=await readFile(path.join(root,'client/withu-renderer/src/version.js'),'utf8');
expect('renderer version.js', /WITHU_VERSION\s*=\s*'([^']+)'/.exec(renderer)?.[1]);

// 2. Main process constant (window title, MCP client handshake).
const main=await readFile(path.join(root,'client/withu-window/main.cjs'),'utf8');
expect('main.cjs withuVersion', /const withuVersion\s*=\s*'([^']+)'/.exec(main)?.[1]);

// 3. Root package.json (electron-packager uses it for the exe version).
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if(pkg.version===npmVersion)ok.push('package.json version');
else fail.push(`package.json version: expected ${npmVersion}, got ${pkg.version}`);

// 4. Built bundle, when present: it is what the window actually loads.
const assets=path.join(root,'client/withu-renderer/dist/assets');
let bundles=[];
try{bundles=readdirSync(assets).filter(name=>name.endsWith('.js'));}catch{bundles=[];}
if(!bundles.length){
  ok.push('dist bundle absent (run `vite build` before packaging)');
}else{
  const stale=new Set();
  let seen=false;
  for(const name of bundles){
    const text=await readFile(path.join(assets,name),'utf8');
    if(text.includes(version))seen=true;
    for(const hit of text.matchAll(/v\d+\.\d+\.\d+go\d+|v\d+\.\d+-rc\.\d+/g))if(hit[0]!==version)stale.add(hit[0]);
  }
  if(!seen)fail.push(`dist bundle does not carry ${version}; rebuild with \`vite build\``);
  if(stale.size)fail.push(`dist bundle still carries stale ${[...stale].join(', ')}; rebuild with \`vite build\``);
  if(seen&&!stale.size)ok.push('dist bundle carries the current version');
}

for(const line of ok)console.log('  PASS '+line);
for(const line of fail)console.error('  FAIL '+line);
if(fail.length){
  console.error(`version consistency: ${fail.length} mismatch(es)`);
  process.exit(1);
}
console.log(`PASS version consistency (${ok.length} places agree on ${version})`);
