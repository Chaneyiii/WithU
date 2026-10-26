import {createServer} from 'vite';
import {buildFixture,isolatedDirectory,seedFixture} from './memory-fixture.mjs';

await buildFixture();
const root=await isolatedDirectory('visual-preview');
await seedFixture(root);
process.env.WITHU_PREVIEW_DATA_DIR=root;
process.env.WITHU_MEMORY_TEST_PREVIEW='1';
const server=await createServer({configFile:'client/withu-renderer/vite.config.mjs',server:{host:'127.0.0.1',port:4176,strictPort:true}});
await server.listen();
console.log('D3_TEST_PREVIEW: isolated synthetic fixture; all memory RPCs use the real Rust server.');
console.log('Data: '+root);
console.log('D3 GUI review: http://127.0.0.1:4176/#/settings/data-privacy');
