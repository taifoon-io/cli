// A live smoke test against https://coord.taifoon.dev (or TAIFOON_LAYER). Runs only with RUN_LIVE=1.
// It asserts the shape, not the numbers: the layer's answers change as jobs settle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { sink } from './fixture-layer.mjs';

const skip = process.env.RUN_LIVE === '1' ? false : 'set RUN_LIVE=1 to call the live layer';

test('live: taifoon up 8453:95902 --json reads all five steps, reads only', { skip, timeout: 120_000 }, async () => {
  const seen = [];
  const spy = (url, init) => { seen.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`); return fetch(url, init); };
  const out = sink();
  const env = { TAIFOON_HOME: mkdtempSync(join(tmpdir(), 'taifoon-live-')), ...(process.env.TAIFOON_LAYER ? { TAIFOON_LAYER: process.env.TAIFOON_LAYER } : {}) };
  const code = await main(['up', '8453:95902', '--json'], { out, err: sink(), env, fetch: spy });
  const rows = out.text().trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.step), ['readiness', 'probe', 'classes', 'quote', 'jev']);
  assert.equal(code, 0, rows.filter((r) => r.mark === 'fail').map((r) => r.fact).join('; '));
  for (const r of rows) for (const c of r.calls) assert.equal(c.status, 200, `${c.method} ${c.path}`);
  assert.ok(Array.isArray(rows[3].record?.wilson) || rows[3].record?.wilson === null, 'the quote carries the layer\'s record');
  for (const s of seen) assert.match(s, /^(GET |POST \/v1\/pools\/quote$)/, s);
});
