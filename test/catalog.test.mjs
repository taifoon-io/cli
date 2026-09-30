// taifoon catalog (_CLI_CATALOG_v1_): list / one entry / buy, each one /v1 call, against a fake layer. What it holds to: the
// filters reach GET /v1/catalog as query parameters; a buy is POST /v1/demands with the catalog id and the input as given;
// --json prints the layer's answer; the key rides along on a buy and is never printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { listQuery, buyBody } from '../src/commands/catalog.mjs';
import { sink } from './fixture-layer.mjs';

const BASE = 'https://coord.test';
const KEY = 'tfr_' + 'D'.repeat(32);
const DOC = JSON.parse(readFileSync(new URL('./fixtures/catalog-2026-09-30.json', import.meta.url), 'utf8'));
const ID = DOC.rows[0].id;

async function run(argv, answer) {
  const out = sink(); const err = sink(); const seen = [];
  const fetch = async (url, init) => {
    const path = url.slice(BASE.length); const body = init?.body ? JSON.parse(init.body) : undefined;
    seen.push({ path, method: init?.method ?? 'GET', body, headers: init?.headers ?? {} });
    const [status, json] = answer(path, init?.method ?? 'GET', body);
    return new Response(JSON.stringify(json), { status });
  };
  const code = await main([...argv, '--layer', BASE], { out, err, fetch, sleep: async () => {}, exec: () => ({ status: 44, stdout: '', stderr: '' }), env: { TAIFOON_HOME: mkdtempSync(join(tmpdir(), 'taifoon-catalog-')) } });
  return { code, out: out.text(), err: err.text(), seen };
}

test('listQuery and buyBody: filters as parameters, a buy is the catalog id plus the input or the words', () => {
  assert.equal(listQuery({ status: 'buy_now', class: 'mcp.digest', limit: 5 }).qs, '?status=buy_now&class=mcp.digest&limit=5');
  assert.match(listQuery({ status: 'nope' }).error, /--status/);
  assert.match(listQuery({ limit: 500 }).error, /limit/);
  assert.deepEqual(buyBody(ID, { input: '{"algorithm":"sha256","text":"hi"}', label: 'me' }).body, { catalog_id: ID, input: { algorithm: 'sha256', text: 'hi' }, buyer_label: 'me' });
  assert.deepEqual(buyBody(ID, { need: 'the sha256 hash of "hi"', 'dry-run': true }).body, { catalog_id: ID, need: 'the sha256 hash of "hi"', dry_run: true });
  assert.match(buyBody('cat_x', { input: '{}' }).error, /usage/);
  assert.match(buyBody(ID, {}).error, /--input/);
});

test('catalog lists the entries with the counts and the fee; the filters reach the layer', async () => {
  const r = await run(['catalog', '--status', 'buy_now', '--limit', '5'], () => [200, DOC]);
  assert.equal(r.code, 0);
  assert.equal(r.seen[0].path, '/v1/catalog?status=buy_now&limit=5');
  assert.match(r.out, /listed 2 · buy now 1/); assert.match(r.out, /fee 49 bps/); assert.ok(r.out.includes(ID));
});

test('catalog <id> shows one entry: price with the fee, cover, the buy call', async () => {
  const r = await run(['catalog', ID], (path) => [200, { ok: true, entry: DOC.rows[0] }]);
  assert.equal(r.code, 0); assert.equal(r.seen[0].path, `/v1/catalog/${ID}`);
  assert.match(r.out, /seller 0 \+ fee 0 \(49 bps\)/); assert.match(r.out, /covered/); assert.match(r.out, /POST \/v1\/demands/);
  const q = await run(['catalog', DOC.rows[1].id], () => [200, { ok: true, entry: DOC.rows[1] }]);
  assert.match(q.out, /quote on request/); assert.match(q.out, /openable/);
});

test('catalog --buy posts the demand with the catalog id, sends the key, never prints it; --json prints the answer', async () => {
  const demand = { id: 'dm_' + 'b'.repeat(24), state: 'open', price_units: '50000', token: 'dUSDC', chainId: 36927, catalog: { id: ID, seller: 'belt.fabtally.com' } };
  const r = await run(['catalog', '--buy', ID, '--input', '{"algorithm":"sha256","text":"hi"}', '--key', KEY], () => [201, { ok: true, demand }]);
  assert.equal(r.code, 0);
  assert.equal(r.seen[0].method, 'POST'); assert.equal(r.seen[0].path, '/v1/demands');
  assert.deepEqual(r.seen[0].body, { catalog_id: ID, input: { algorithm: 'sha256', text: 'hi' } });
  assert.ok(JSON.stringify(r.seen[0].headers).includes(KEY));
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY));
  assert.match(r.out, /taifoon demand status dm_b+ --watch/);
  const j = await run(['catalog', '--json'], () => [200, DOC]);
  assert.equal(JSON.parse(j.out).counts.listed, 2);
});
