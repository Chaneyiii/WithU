import React from 'react';
import {createRoot} from 'react-dom/client';
import McpAppHost from '../../withu-renderer/src/components/McpAppHost.jsx';
import {mediaCoordinator} from '../src/media.js';
window.withuTestMediaBusy = busy => mediaCoordinator.setVoice('browser-test',busy);
createRoot(document.getElementById('root')).render(<McpAppHost proposalContext={window.withuMcpTestContext}/>);
