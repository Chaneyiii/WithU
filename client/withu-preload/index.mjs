import {assertChannel,channels} from '../withu-ipc/index.mjs';
const rendererChannels=Object.freeze(channels.filter(c=>!['withu:server:shutdown','withu:speech:event','withu:task:events','withu:life:tick','withu:proactivity:candidate_offer','withu:proactivity:notification_result','withu:mcp:tools_register'].includes(c)));
export function createBridge(invoke){return Object.freeze({invoke(channel,payload){assertChannel(channel);if(!rendererChannels.includes(channel))throw new Error('authorization: main-process channel');return invoke(channel,payload);}});}
