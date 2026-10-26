import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {withuPreview} from '../withu-window/preview.mjs';
import {withuMcpAppResource} from '../withu-mcp-app/vite-plugin.mjs';
export default defineConfig({root:'client/withu-renderer',base:'./',plugins:[react(),withuPreview(),withuMcpAppResource()],build:{outDir:'dist',assetsInlineLimit:0},server:{host:'127.0.0.1',port:4173,strictPort:true}});
