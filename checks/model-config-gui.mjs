import './service-config.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const src=await readFile('client/withu-renderer/src/components/ModelConfiguration.jsx','utf8');
for(const banned of ['fetch(', 'localStorage','sessionStorage','console.log','credential_ref','LocalModels','local-voice'])assert.ok(!src.includes(banned));
assert.ok(src.includes("type={showSecret?'text':'password'}"));
assert.ok(src.includes('aria-pressed={showSecret}'));
console.log('PASS configuration secret form boundary and local manager removal');
