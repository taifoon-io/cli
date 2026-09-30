// `taifoon metrics` over recorded /v1/metrics + /v1/network answers (test/fixtures/metrics-2026-09-29.json, live 2026-09-29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { main } from '../src/main.mjs';
import { metricsLines } from '../src/metrics.mjs';
import { fixtureFetch, loadFixture, sink } from './fixture-layer.mjs';

const fx = loadFixture('metrics-2026-09-29');
async function run(args, io = {}) {
  const out = sink(); const err = sink(); const { f, seen } = fixtureFetch(fx);
  const code = await main(['metrics', ...args, '--layer', fx.base, '--no-color'], { out, err, fetch: f, env: {}, ...io });
  return { code, out: out.text(), err: err.text(), seen };
}

test('taifoon metrics renders today · yesterday · 7-day, routes, customers, fees, funnel, network', async () => {
  const r = await run([]);
  assert.equal(r.code, 0, r.err);
  const snap = new URL('./snapshots/metrics-2026-09-29.txt', import.meta.url);
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(snap)) writeFileSync(snap, r.out);
  assert.equal(r.out, readFileSync(snap, 'utf8'));
  for (const want of ['through us · 2026-09-29', 'TODAY', 'YESTERDAY', '7-DAY AVG', 'top routes today', 'top customers today (hashed)', 'would have charged', 'funnel', 'discovered', 'paid', 'network (the hourly auto-connect run)', 'route 8453 → 5042']) assert.ok(r.out.includes(want), want);
  assert.deepEqual(r.seen.map((s) => s.k), ['GET /v1/metrics', 'GET /v1/network']);
});
test('--json prints both answers for agents; --day asks that day', async () => {
  const j = await run(['--json']);
  const o = JSON.parse(j.out);
  assert.equal(o.metrics.schema, 'taifoon.metrics.v1'); assert.equal(o.network.schema, 'taifoon.network.v1');
  const d = await run(['--day', '2026-09-28', '--json']);
  assert.equal(d.seen[0].k, 'GET /v1/metrics?day=2026-09-28');
  assert.equal((await run(['--day', 'yesterday'])).code, 2);
});
test('--watch re-reads on its period (two ticks, no real sleep)', async () => {
  const slept = [];
  const r = await run(['--watch', '10', '--json'], { metrics: { ticks: 2, sleep: async (ms) => { slept.push(ms); } } });
  assert.equal(r.code, 0);
  assert.equal(r.out.trim().split('\n').length, 2);
  assert.deepEqual(slept, [10_000, 10_000]);
});
test('a layer that does not answer is said plainly', () => {
  assert.deepEqual(metricsLines({ ok: false, error: 'HTTP 503' }, null), [['fail', '/v1/metrics did not answer: HTTP 503']]);
});
