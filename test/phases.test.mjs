// `taifoon phases` in served mode (what an npm install does): the layer's /v1/landscape/phases over a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/main.mjs';
import { logLine, PHASES_SCHEMA } from '../src/phases.mjs';
import { sink } from './fixture-layer.mjs';

const POINT = { v: PHASES_SCHEMA, read_at: 1791052000, metrics: [
  { phase: 0, metric: 'gate', value: 0, outside: null, by: { item: 'split' }, source: 'packages/addresses/policy.json premium_split_bps + approved_by', note: 'premium split not written' },
  { phase: 4, metric: 'pools_funded', value: 3, outside: null, by: { tenant: 'moonbeam' }, source: '/v1/pools/state live.totalAssets > 0' },
  { phase: 'reach', metric: 'venue_jobs_read', value: 121, outside: true, by: { venue: 'virtuals-acp' }, source: 'acp-observatory/stats observed_jobs', note: '177 events in 24 h' },
  { phase: 'reach', metric: 'venue_jobs_read', value: null, outside: true, by: { venue: 'olas-mech' }, source: 'no read-only lane yet (board item 9)' },
] };
const served = (status, json) => async (url) => { assert.match(url, /\/v1\/landscape\/phases$/); return new Response(JSON.stringify(json), { status }); };
const run = async (args, fetchImpl) => { const out = sink(), err = sink(); const code = await main(args, { out, err, env: {}, fetch: fetchImpl }); return { code, out: out.text(), err: err.text() }; };

test('phases --served: one line per metric, the layer\'s line, a summary on stderr', async () => {
  const r = await run(['phases', '--served'], served(200, POINT));
  assert.equal(r.code, 0);
  assert.equal(r.out, POINT.metrics.map(logLine).join('\n') + '\n');
  assert.equal(r.out.split('\n')[1], 'phase=4 metric=pools_funded value=3 outside=mixed by=tenant:moonbeam src="/v1/pools/state live.totalAssets > 0"');
  assert.match(r.err, /^4 metrics, 1 null · read_at 2026-10-03T18:26:40.000Z · \/v1\/landscape\/phases\n$/);
});

test('phases --phase / --venue filter; --json prints the point with the filtered metrics', async () => {
  const a = await run(['phases', '--served', '--phase', 'reach', '--venue', 'virtuals-acp'], served(200, { latest: POINT }));
  assert.equal(a.code, 0); assert.equal(a.out.trim().split('\n').length, 1); assert.match(a.out, /venue:virtuals-acp/);
  const j = await run(['phases', '--served', '--phase', '4', '--json'], served(200, { points: [POINT, { ...POINT, read_at: 1 }] }));
  const p = JSON.parse(j.out); assert.equal(p.v, PHASES_SCHEMA); assert.equal(p.read_at, 1791052000); assert.deepEqual(p.metrics.map((m) => m.metric), ['pools_funded']);
  const none = await run(['phases', '--served', '--venue', 'nowhere'], served(200, POINT));
  assert.equal(none.code, 1); assert.match(none.err, /no metric matches venue nowhere/);
});

test('phases --served before the layer serves the board: says so, exit 1, no stack', async () => {
  const r = await run(['phases', '--served'], served(404, { ok: false }));
  assert.equal(r.code, 1); assert.match(r.err, /does not serve \/v1\/landscape\/phases yet \(phase board item 5\)/);
  const no = await run(['phases', '--served'], async () => { throw new Error('offline'); });
  assert.equal(no.code, 1); assert.match(no.err, /did not answer/);
});

test('phases: reads only — GET, no body, no key sent unless given', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push(init); return new Response(JSON.stringify(POINT), { status: 200 }); };
  await run(['phases', '--served'], f);
  assert.equal(seen.length, 1); assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].body, undefined); assert.equal(seen[0].headers['x-api-key'], undefined);
});

test('phases: an extra positional is refused like the other commands', async () => {
  const r = await run(['phases', 'extra', '--served'], served(200, POINT));
  assert.equal(r.code, 2); assert.match(r.err, /unexpected argument extra/);
});
