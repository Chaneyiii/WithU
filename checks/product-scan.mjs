import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {listPackage,extractFile} from '@electron/asar';
const banned=new RegExp(['\\bMu'+'se\\b','mu'+'seDesktop','mu'+'se:','MU'+'SE_DEV_URL','\\bUn'+'sloth\\b','dic'+'tation','vendor[\\\\/]ha'+'tch'].join('|'),'i');
// Third-party Meta model identifiers/names in models.dev are not old product branding.
// Permit only those catalog terms; the product/API names remain banned.
const productText=text=>text.replace(/\b(?:meta\/)?muse-(?:spark|glimmer)[a-z0-9.-]*/gi,'MODEL_ID').replace(/\bMuse (?:Spark|Glimmer)\b/g,'MODEL_NAME').replace(/("?family"?\s*:\s*)"muse(?:-free)?"/g,'$1"MODEL_FAMILY"');
const files=[];
async function scan(root){for(const entry of await fs.readdir(root,{withFileTypes:true})){if(['node_modules','dist'].includes(entry.name))continue;const file=path.join(root,entry.name);if(entry.isDirectory())await scan(file);else if(/\.(rs|mjs|cjs|jsx|js|css|json|toml|html|svg)$/.test(file)){const text=await fs.readFile(file,'utf8');assert.ok(!banned.test(file.endsWith('models-dev-catalog.json')?productText(text):text),'forbidden product token '+file);files.push(file);}}}
for(const root of ['client','apps','crates','contracts'])await scan(root);
const stage=process.argv.includes('--p3')?'p3':process.argv.includes('--p2')?'p2':'p1';const explicit=process.argv.find(v=>v.startsWith('--archive='));const archive=path.resolve(explicit?explicit.slice('--archive='.length):'output/'+stage+'/windows/Withu-win32-x64/resources/app.asar');let productAssets=0;
for(const file of listPackage(archive)){if(!/^[/\\]client[/\\]/.test(file)||!/\.(js|mjs|cjs|jsx|css|json|html|svg)$/.test(file))continue;const text=extractFile(archive,file.replace(/^[/\\]/,'')).toString('utf8');assert.ok(!banned.test(productText(text)),'forbidden bundled token '+file);productAssets++;}
const report={sourceFiles:files.length,packagedProductFiles:productAssets,excluded:['docs/sources: factual provenance, not product UI','node_modules: third-party internals and license texts','output: isolated check data and evidence'],banned:String(banned),success:true};const output=path.resolve('output/'+stage+'/windows');await fs.mkdir(output,{recursive:true});report.archive=archive;report.stage=stage;await fs.writeFile(path.join(output,'source-scan.json'),JSON.stringify(report,null,2));console.log('PASS source/packaged product scan '+JSON.stringify(report));
