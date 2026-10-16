// _PRETTY_v1_: the terminal rendering of an answer — aligned scalars, tables for record lists, an agreement as the stream draws it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pretty } from '../src/pretty.mjs';
import { brand } from '../src/brand.mjs';

const p = brand({ isTTY: false }, {}, false);
const V = JSON.parse(readFileSync(new URL('../vendor/resale/runtime/coord-lang/agreement.json', import.meta.url), 'utf8'));

test('scalars align, ids and unix times read as written, record lists become a table, an agreement reads as its line + legs', () => {
  const out = pretty(p, { ok: true, status: 'live', jobs: [{ id: 81877, chainId: 8453, createdAt: 1792173453, skill: 'x' }, { id: 81876, chainId: 8453, createdAt: 1792169869, skill: 'y' }], agreement: V.cases.find((c) => c.ok).agreement }).join('\n');
  assert.match(out, /^ok {6}yes$/m);
  assert.match(out, /^status {2}live$/m);
  assert.match(out, /81877 +8453 +2026-10-16 17:57:33 UTC +x/);
  assert.match(out, /⇄ erc8183-base · job 81877 · paid 3\.02 USDC/);
  assert.match(out, /⚖ our fee 0\.5 → layer/);
  assert.match(pretty(p, Array.from({ length: 30 }, (_, i) => ({ a: i, b: 'x' }))).join('\n'), /… 10 more \(--json has them all\)/);
});
