import {createServer} from 'vite';
import path from 'node:path';
// Separate from P1 preview and normal Electron userData. No fixture RPC is exposed.
process.env.WITHU_PREVIEW_DATA_DIR=path.resolve('output/p2/visual-userData/withu');
const server=await createServer({configFile:'client/withu-renderer/vite.config.mjs',server:{host:'127.0.0.1',port:4174,strictPort:true}});
await server.listen();
server.printUrls();
console.log('P2.1 visual review: http://127.0.0.1:4174/?presence=1#chat');
