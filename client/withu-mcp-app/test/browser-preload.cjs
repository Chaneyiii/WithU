const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('withuMcpTestContext', {userEvidenceRef:'mcp-test-user', goalDescription:'Please record a local annotation'});
contextBridge.exposeInMainWorld('withuDesktop', Object.fromEntries(['actionPreview','actionDecide','actionExecute','annotationGet'].map(method => [method,payload => ipcRenderer.invoke('mcp-test:'+method,payload)])));
