import {createServer} from 'vite';
import path from 'node:path';
// P3.1 preview owns isolated P3 data. Model forms use memory only, no config RPC.
process.env.WITHU_PREVIEW_DATA_DIR=path.resolve('output/p3/visual-userData/withu');
const server=await createServer({configFile:'client/withu-renderer/vite.config.mjs',server:{host:'127.0.0.1',port:4175,strictPort:true}});
await server.listen();server.printUrls();
console.log('P3.1 GUI review: http://127.0.0.1:4175/#/settings/general');
