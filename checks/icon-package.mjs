import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Data,NtExecutable,NtExecutableResource,Resource} from 'resedit';
import {extractFile} from '@electron/asar';
const root=path.resolve(process.env.WITHU_PACKAGE_ROOT||'output/p3/windows/Withu-win32-x64');
const resources=NtExecutableResource.from(NtExecutable.from(await fs.readFile(path.join(root,'Withu.exe'))));
const groups=Resource.IconGroupEntry.fromEntries(resources.entries);assert.equal(groups.length,1);
const embedded=groups[0].getIconItemsFromEntries(resources.entries);
const source=Data.IconFile.from(await fs.readFile('client/withu-window/withu-icon.ico')).icons.map(i=>i.data);
assert.equal(embedded.length,8);assert.equal(source.length,8);
const hash=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
assert.deepEqual(embedded.map(i=>hash(i.bin)).sort(),source.map(i=>hash(i.bin)).sort(),'EXE icon pixels differ from approved ICO');
const archive=path.join(root,'resources/app.asar');
for(const name of ['withu-icon.svg','withu-icon.png','withu-icon.ico']){
 const file='client/withu-window/'+name;
 assert.equal(hash(extractFile(archive,file.split('/').join(path.sep))),hash(await fs.readFile(file)),file+' package differs');
}
const main=extractFile(archive,path.join('client','withu-window','main.cjs')).toString();
assert.ok(main.includes("app.setAppUserModelId('com.withu.desktop')"));
assert.ok(main.includes("icon:path.resolve(__dirname,'withu-icon.ico')"));
assert.ok(main.includes("nativeImage.createFromPath(path.resolve(__dirname,'./withu-icon.png'))"));
assert.ok(main.includes('--withu-model-settings'));
assert.equal(hash(await fs.readFile(path.join(root,'resources/withu-server.exe'))),hash(await fs.readFile('output/p3/build-target/release/withu-server.exe')));
await fs.writeFile('output/p3/windows/icon-check.json',JSON.stringify({success:true,exe:path.join(root,'Withu.exe'),iconSizes:embedded.map(i=>[i.width,i.height]),checks:['EXE PE icon PNGs match approved ICO','ASAR SVG/PNG/ICO match source','window/tray icon paths and taskbar identity','settings startup option present','packaged server matches latest release'],limits:'Resource verification; not a screenshot of Windows taskbar or Explorer.'},null,2));
console.log('PASS EXE embedded icon, window/tray assets, app identity and latest release server');
