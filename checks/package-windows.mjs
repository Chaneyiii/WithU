import { packager } from '@electron/packager';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const version=(await fs.readFile(new URL('../VERSION',import.meta.url),'utf8')).trim();
const release=/^v(\d+)\.(\d+)\.(\d+)go(\d+)$/.exec(version);if(!release)throw Error('unsupported VERSION format; expected vMAJOR.MINOR.PATCHgoN');
const windowsVersion=`${release[1]}.${release[2]}.${release[3]}.${release[4]}`;
const p2=process.argv.includes('--p2'),p3=process.argv.includes('--p3');
if(p2&&p3)throw Error('choose one package stage');
const out=path.resolve(process.env.WITHU_PACKAGE_OUTPUT||(p3?'output/p3/windows':p2?'output/p2/windows':'output/p1/windows'));await fs.mkdir(out,{recursive:true});
const serverBinary=path.resolve(process.env.WITHU_SERVER_BINARY||(p3?'output/p3/build-target/release/withu-server.exe':p2?'target/p2/release/withu-server.exe':'target/release/withu-server.exe'));
if(p3){const built=spawnSync('cargo',['build','--release','-p','withu-server','--target-dir',path.dirname(path.dirname(serverBinary))],{stdio:'inherit',windowsHide:true});if(built.status!==0)throw Error('Server release build failed; packaging aborted');}
await fs.access(serverBinary);
const cache=path.join(process.env.LOCALAPPDATA,'electron','Cache');
let electronZipDir;
for(const directory of await fs.readdir(cache)){const candidate=path.join(cache,directory);try{await fs.access(path.join(candidate,'electron-v44.7.0-win32-x64.zip'));electronZipDir=candidate;break;}catch{}}
const result=await packager({electronZipDir,dir:path.resolve('.'),out,name:'Withu',platform:'win32',arch:'x64',electronVersion:'44.7.0',asar:true,prune:true,overwrite:true,icon:path.resolve('client/withu-window/withu-icon.ico'),extraResource:[serverBinary,path.resolve('docs/sources'),path.resolve('client/withu-window/withu-icon.ico')],ignore:[/^\/output($|\/)/,/^\/target($|\/)/,/^\/\.git($|\/)/,/^\/crates($|\/)/,/^\/apps($|\/)/,/^\/docs($|\/)/,/^\/checks\/(?!electron\.mjs$|speech-electron\.mjs$|alpha-ui\.mjs$|realtime-electron\.mjs$|realtime-settings-electron\.mjs$|emotion-ball-electron\.mjs$)/],win32metadata:{CompanyName:'Withu',FileDescription:'Withu Client',ProductName:'Withu',ProductVersion:windowsVersion,FileVersion:windowsVersion}});
const exe=path.join(result[0],'Withu.exe'),server=path.join(result[0],'resources/withu-server.exe');const sha=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({version,exe,server,electronVersion:'44.7.0',packagerVersion:'20.3.0',sha256:{client:await sha(exe),server:await sha(server),appArchive:await sha(path.join(result[0],'resources/app.asar'))},signed:false},null,2));console.log('PACKAGED '+exe);
