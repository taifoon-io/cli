// _POOLS_LIVE_v1_ + _COVER_PREVIEW_v1_ (launch round 11): `pools ls --live` and `network --pools` render the layer's live pools
// read (unread stays "unread", never 0); `demand post --dry-run` shows the quote-only cover preview. Against a fake layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { poolRow } from '../src/pools-live.mjs';
import { sink } from './fixture-layer.mjs';

const BASE = 'https://coord.test';
const DEMO = '0x2f8e5378a2d850a18d857ad8ad30f242b89e3a58';
const LAYER = '0x522728b431e8eb80e0cfde3c0a0ae8604afb32b0';
const JOB = '0x5bf26c8eece0ca8a7cd3df7389860e323291b002f7e6ab6ce07470bf73a7027d';
const TX = '0xc606d00fed64e912585bbc93feb15a9289cfcde94289f49f7c74a7a468903116';
const MAX = ((1n << 256n) - 1n).toString();
const full = {
  schema: 'taifoon.pools.live.v1', score: { registry_pools: 32, listed_of_registry: 32, pools_listed: 35, values_shown: 245, values_read: 243, unread: 2 },
  chains: [{ chain_id: 8453, chain: 'Base', registry_pools: 29, listed: 29, factories: [{ address: '0x91f078d10e3f0d05febcea35f114063c696aef54', pool_count: 28 }], not_in_registry: [] },
    { chain_id: 5042, chain: 'Arc', registry_pools: 0, listed: 0, factories: [{ address: '0x317d55623c974197b6dd1c107cb0cfc3ef04f1eb', pool_count: 0 }], not_in_registry: [] }],
  pools: [
    { chain_id: 8453, address: DEMO, tenant: 'moonbeam', system: 'moonbeam-acp', asset: { symbol: 'GLMR', decimals: 18 }, tvl: '20100000000000000000', cover_capacity: '20100000000000000000', encumbered: '0',
      premium_rate: { rate: 0.01 }, deposits: { on_chain: 'open', max_deposit: MAX, open: false }, last_covered_job: { job_id: JOB, tx: TX, ending: 'completed' }, unread: [] },
    { chain_id: 8453, address: LAYER, tenant: 'layer', system: 'taifoon-assurance', asset: { symbol: 'USDC', decimals: 6 }, tvl: '0', cover_capacity: null, encumbered: null,
      premium_rate: { rate: null }, deposits: { on_chain: 'open', max_deposit: MAX, open: true }, last_covered_job: null, unread: ['cover_capacity', 'encumbered'] },
  ],
};

async function run(argv, answer) {
  const out = sink(); const err = sink(); const seen = [];
  const fetch = async (url, init) => {
    const path = url.slice(BASE.length); const body = init?.body ? JSON.parse(init.body) : undefined;
    seen.push({ path, method: init?.method ?? 'GET', body });
    const [status, json] = answer(path, init?.method ?? 'GET', body);
    return new Response(JSON.stringify(json), { status });
  };
  const code = await main([...argv, '--layer', BASE], { out, err, fetch, sleep: async () => {}, exec: () => ({ status: 44, stdout: '', stderr: '' }), env: { TAIFOON_HOME: mkdtempSync(join(tmpdir(), 'taifoon-pools-live-')) } });
  return { code, out: out.text(), err: err.text(), seen };
}

test('poolRow: a failed read prints "unread", a read 0 prints 0, Moonbeam on Base is closed by policy while the chain accepts', () => {
  const layer = poolRow(full.pools[1]);
  assert.equal(layer.capacity, 'unread'); assert.equal(layer.encumbered, 'unread'); assert.equal(layer.tvl, '0.00'); assert.equal(layer.deposits, 'open');
  const demo = poolRow(full.pools[0]);
  assert.equal(demo.premium, '1.00 %'); assert.equal(demo.deposits, 'closed (policy)'); assert.equal(demo.last_job, JOB);
  // the compact /v1/network shape reads the same
  const compact = poolRow({ chain_id: 36927, address: LAYER, tenant: 'layer', asset: null, decimals: null, tvl: null, cover_capacity: null, encumbered: null, premium_rate: null, open_for_deposits: null, deposits_on_chain: 'unread', last_covered_job: null, unread: ['asset', 'tvl', 'deposits'] });
  assert.equal(compact.asset, 'unread'); assert.equal(compact.tvl, 'unread'); assert.equal(compact.deposits, 'unread');
});

test('pools ls --live reads /v1/pools/state?chain=all once and prints every pool with full addresses, the job and its tx', async () => {
  const r = await run(['pools', 'ls', '--live'], () => [200, { ok: true, ...full }]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.seen.map((s) => s.path), ['/v1/pools/state?chain=all']);
  for (const s of [DEMO, LAYER, JOB, TX, '32/32 registry pools listed', '243/245 values read', 'unread', 'closed (policy)']) assert.ok(r.out.includes(s), s);
});

test('network --pools renders the pools section of /v1/network, even on its 404 (no snapshot yet); --json passes it through', async () => {
  const net = { ok: false, error: 'no snapshot published yet', pools: { ...full, full: '/v1/pools/state?chain=all' } };
  const r = await run(['network', '--pools'], () => [404, net]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.seen.map((s) => s.path), ['/v1/network']);
  assert.ok(r.out.includes(DEMO) && r.out.includes('GET /v1/network'));
  const j = await run(['network', '--pools', '--json'], () => [200, { ...net, ok: true, error: undefined }]);
  assert.equal(j.code, 0, j.err + j.out);
  const lines = j.out.trim().split('\n');
  assert.equal(JSON.parse(lines[0]).pools.score.registry_pools, 32);
  const bad = await run(['network', '--pools'], () => [200, { ok: true, pools: { unread: true, why: 'the pools read took longer than 12 s' } }]);
  assert.equal(bad.code, 1); assert.ok(bad.err.includes('unread') && bad.err.includes('12 s'));
});

test('demand post --dry-run prints the cover preview the layer quoted: the pool (or none), the premium, deposit-only, quote only', async () => {
  const preview = { quote_only: true, source: 'POST /v1/pools/quote', seller_of_record: '0x7E0246B56D431Cf7Aa87bD8E49d559Af61a632Cf', pool: null, covered: false, premium: '13491', premium_ratio: 0.2698, premium_label: '1.0%–27.0% · thin record (16 settled)',
    deposit: '100000', deposit_rung: '2x', why: ['the seller has no pool on this chain/tenant'], settles_with: 'pool: null — the auto-match loop names no pool in its hires today' };
  const r = await run(['demand', 'post', 'the keccak256 hash of "hello world"', '--dry-run'], () => [200, { ok: true, dry_run: true, class: 'mcp.digest', input: { algorithm: 'keccak256', text: 'hello world' }, price_units: '50000', cover_preview: preview, kept: false }]);
  assert.equal(r.code, 0);
  for (const s of ['cover preview · quote only', 'deposit-only', '13491 units (27.0 % of the price)', '100000 units (2x) for a price of 50000', '0x7E0246B56D431Cf7Aa87bD8E49d559Af61a632Cf', 'pool: null']) assert.ok(r.out.includes(s), s);
  const u = await run(['demand', 'post', 'the keccak256 hash of "x"', '--dry-run'], () => [200, { ok: true, dry_run: true, class: 'mcp.digest', input: {}, cover_preview: { quote_only: true, unread: true, why: 'observatory down' }, kept: false }]);
  assert.ok(u.out.includes('unread') && u.out.includes('observatory down'));
});
