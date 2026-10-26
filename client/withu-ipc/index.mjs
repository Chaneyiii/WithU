import { readFileSync } from 'node:fs';
export const contract = JSON.parse(readFileSync(new URL('../../contracts/v1/ipc.json', import.meta.url)));
export const channels = Object.freeze(contract.channels);
export function assertChannel(channel) { if (!channels.includes(channel)) throw new Error('validation: unknown channel'); }
export {publicConfig,validateConfig,validatePublicConfig} from './config-boundary.mjs';
