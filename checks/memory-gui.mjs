import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'vite';
import {buildFixture,isolatedDirectory,seedFixture,run} from './memory-fixture.mjs';

await buildFixture();
const root=await isolatedDirectory('memory-gui');await seedFixture(root);
process.env.WITHU_PREVIEW_DATA_DIR=root;process.env.WITHU_MEMORY_TEST_PREVIEW='1';
const server=await createServer({configFile:'client/withu-renderer/vite.config.mjs',server:{host:'127.0.0.1',port:4177,strictPort:true}});
try {
  await server.listen();
  const rejected=await fetch('http://127.0.0.1:4177/__withu_preview/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'memoryList',payload:{}})});
  assert.equal(rejected.status,403);
  process.env.WITHU_D3_GUI_ROOT=root;
  const electron=path.resolve('node_modules/electron/dist/electron.exe');
  console.log(await run(electron,['checks/memory-gui.cjs']));
  console.log('Evidence '+root);
} finally {await server.close();}
