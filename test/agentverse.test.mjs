// _AGENTVERSE_LANE_v1_: taifoon up on a Fetch.ai agent (agent1…) reads its own Almanac record, step by step (the same
// branch and the same step text as the site's wizard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgent, runStep } from '../src/steps.mjs';

const A = 'agent1qvtnt9s6uhua3c3jundxrpgqjsy9quc2h4s83anjg6r2m95g90dn2ruw8zm';
const body = { ok: true, address: A, almanac: { status: 'active', type: 'hosted', expiry: '2026-10-19T09:36:26Z' }, hire: [{ protocol_name: 'Average-Statistics', version: '0.1.0', request_model: 'model:a5', request: { fields: ['data'] } }], classes: [{ id: 'stats.describe', status: 'LIVE' }] };
const ctx = { get: async (path) => (path === `/v1/agentverse/agents/${A}` ? { status: 200, json: body } : { status: 404, json: { error: 'no' } }), host: 'coord.taifoon.dev', now: () => 0 };

test('taifoon up agent1…: readiness, probe, classes and quote read the Almanac record', async () => {
  assert.deepEqual(parseAgent(A), { chain: 8453, id: A });
  assert.equal((await runStep('readiness', { chain: 8453, id: A }, ctx)).fact, 'Fetch.ai agent · Almanac active · hosted · expires 2026-10-19T09:36:26Z');
  assert.match((await runStep('probe', { chain: 8453, id: A }, ctx)).fact, /^1 request\/response interaction\(s\): Average-Statistics 0\.1\.0/);
  const c = await runStep('classes', { chain: 8453, id: A }, ctx); assert.equal(c.mark, 'ok'); assert.equal(c.fact, 'stats.describe · this agent is the named worker');
  assert.equal((await runStep('quote', { chain: 8453, id: A }, ctx)).mark, 'warn');
});
