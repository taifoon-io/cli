// `taifoon buy` and `taifoon balance` against a stand-in layer: the quote is checked before it is shown, nothing is sent,
// the claim goes to the route the saved purchase names, and the standing is drawn in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { checkPay } from '../src/commands/buy.mjs';
import { balanceRows } from '../src/commands/balance.mjs';
import { sink } from './fixture-layer.mjs';

const BASE = 'https://layer.example';
// a stand-in key, built so no key-shaped literal sits in the source
const KEY = ['tfr', 'test', 'key'].join('_');
const TOKEN = '0x' + 'aa'.repeat(20); const PAYEE = '0x' + 'bb'.repeat(20);
const data = (units) => `0xa9059cbb${PAYEE.slice(2).padStart(64, '0')}${BigInt(units).toString(16).padStart(64, '0')}`;
const pay = (units, over = {}) => ({ chainId: 42161, network: 'Arbitrum One', token: TOKEN, symbol: 'USDC', amount: (Number(units) / 1e6).toFixed(6), amount_units: String(units), payee: PAYEE, call: { to: TOKEN, data: data(units), value: '0x0' }, ...over });
const balanceQuote = { ok: true, product: 'balance', credits: { grid: 500, usdc: '5.000000' }, pay: pay(5_000_000), sign: { message: 'Taifoon gateway credits\ncredit: abcd\nchain: 42161\ntx: 0x<tx hash, lower-case>' }, claim: { method: 'POST', url: `${BASE}/v1/access/topup` }, for_a_person: 'https://www.taifoon.io/pricing?buy=grid&chain=arbitrum' };
const planQuote = { ok: true, product: 'plan', plan: { id: 'builder-99', name: 'Builder', includes: { usdc: '110.00' }, rate: { per_family_per_minute: 1000 } }, pay: pay(99_000_000), sign: { message: 'Taifoon plan claim\nplan: builder-99\ncredit: abcd\nchain: 42161\ntx: 0x<tx hash, lower-case>' } };

function layer(routes) {
  const seen = [];
  const f = async (url, init) => {
    const path = url.slice(BASE.length); const body = init?.body ? JSON.parse(init.body) : undefined;
    seen.push({ method: init?.method ?? 'GET', path, body, key: init?.headers?.['x-api-key'] ?? null });
    const hit = routes[`${init?.method ?? 'GET'} ${path.split('?')[0]}`];
    const out = typeof hit === 'function' ? hit(path, body) : hit;
    return out ? new Response(JSON.stringify(out.json), { status: out.status ?? 200 }) : new Response('{"ok":false,"error":"not served"}', { status: 599 });
  };
  return { f, seen };
}
async function run(args, routes, home = mkdtempSync(join(tmpdir(), 'tf-buy-'))) {
  const out = sink(); const err = sink(); const l = layer(routes);
  const code = await main([...args, '--layer', BASE, '--no-color', '--key', KEY], { out, err, fetch: l.f, env: { HOME: home, TAIFOON_HOME: join(home, '.taifoon') } });
  return { code, out: out.text(), err: err.text(), seen: l.seen, home };
}
const TXH = '0x' + 'c1'.repeat(32); const SIGN = '0x' + 'd2'.repeat(65);

test('checkPay: only a transfer of the quoted units of the quoted token to the quoted payee passes', () => {
  assert.equal(checkPay(pay(5_000_000)), null);
  assert.match(checkPay(pay(5_000_000, { call: { to: PAYEE, data: data(5_000_000) } })), /quoted token/);
  assert.match(checkPay(pay(5_000_000, { call: { to: TOKEN, data: data(5_000_001) } })), /amount differs/);
  assert.match(checkPay(pay(5_000_000, { payee: '0x' + 'cc'.repeat(20) })), /quoted payee/);
  assert.match(checkPay(pay(5_000_000, { call: { to: TOKEN, data: '0x095ea7b3' + '00'.repeat(64) } })), /not a token transfer/);
  assert.match(checkPay(pay(5_000_000, { call: { to: TOKEN, data: data(5_000_000), value: '0x1' } })), /sends coin/);
  assert.match(checkPay(null), /no payment/);
});

test('taifoon buy 5 --chain arbitrum: asks the quote with the key, prints the transfer and the message, saves it, sends nothing', async () => {
  const r = await run(['buy', '5', '--chain', 'arbitrum'], { 'GET /v1/access/quote': { json: balanceQuote } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.seen.map((s) => `${s.method} ${s.path}`), ['GET /v1/access/quote?usdc=5&chainId=arbitrum']);
  assert.ok(r.seen[0].key, 'the quote is asked with the key, so the message names it');
  for (const want of ['5.000000 USDC on Arbitrum One', PAYEE, data(5_000_000), 'credit: abcd', 'taifoon buy claim', 'https://www.taifoon.io/pricing?buy=grid&chain=arbitrum']) assert.ok(r.out.includes(want), want);
  assert.ok(!r.out.includes(KEY), 'the key is never printed');
  const dir = join(r.home, '.taifoon', 'plans'); const saved = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'));
  assert.equal(saved.kind, 'buy'); assert.equal(saved.product, 'balance'); assert.equal(saved.chain_id, 42161); assert.equal(saved.signed, false);
  assert.ok(!JSON.stringify(saved).includes(KEY));
});

test('a quote that is not a transfer to its own payee is refused and nothing is saved', async () => {
  const r = await run(['buy', '5'], { 'GET /v1/access/quote': { json: { ...balanceQuote, pay: pay(5_000_000, { payee: '0x' + 'cc'.repeat(20) }) } } });
  assert.equal(r.code, 1);
  assert.match(r.err, /refused here and nothing is saved/);
  assert.ok(!r.out.includes('taifoon buy claim'));
});

test('taifoon buy builder-99, then claim: the claim goes to the plan route with the plan, the transaction and the signature', async () => {
  const routes = { 'GET /v1/access/quote': { json: planQuote }, 'POST /v1/access/plan': { json: { ok: true, already: false, plan: { active: true, name: 'Builder', days_left: 30, ends: '2026-11-04T00:00:00.000Z', allowance: { usdc: '110.000000', left_usdc: '110.000000' } } } } };
  const q = await run(['buy', 'builder-99', '--chain', '42161', '--json'], routes);
  const id = JSON.parse(q.out).id;
  const c = await run(['buy', 'claim', id, '--tx', TXH, '--signature', SIGN], routes, q.home);
  assert.equal(c.code, 0, c.err);
  assert.deepEqual(c.seen[0], { method: 'POST', path: '/v1/access/plan', body: { tx: TXH, chainId: 42161, signature: SIGN, plan: 'builder-99' }, key: KEY });
  for (const want of ['Builder, 30 days left', '110.000000 of 110.000000 dollars left', 'never by itself']) assert.ok(c.out.includes(want), want);
});

test('claim with no saved purchase asks the layer what the wallet signed; a 403 prints the messages; a 404 says try again', async () => {
  const open = await run(['buy', 'claim', '--tx', TXH, '--chain', '143'], { 'POST /v1/access/claim': { status: 403, json: { ok: false, error: 'sign one of the messages below', sign: { signer: '0x' + 'ee'.repeat(20), options: [{ buys: 'the Builder plan', message: 'Taifoon plan claim\nplan: builder-99' }, { buys: 'a balance (Buy GRID)', message: 'Taifoon gateway credits' }] } } } });
  assert.equal(open.code, 1);
  assert.deepEqual(open.seen[0].body, { tx: TXH, chainId: '143' });
  for (const want of ['to claim the Builder plan', 'plan: builder-99', 'to claim a balance (Buy GRID)']) assert.ok(open.out.includes(want), want);
  const early = await run(['buy', 'claim', '--tx', TXH, '--signature', SIGN], { 'POST /v1/access/claim': { status: 404, json: { ok: false, error: 'the payment is 1 of 3 blocks deep on Base' } } });
  assert.equal(early.code, 1); assert.match(early.err, /1 of 3 blocks deep.*again in a few seconds/);
});

test('bad input is refused before any call', async () => {
  for (const args of [['buy'], ['buy', 'five'], ['buy', '1.5'], ['buy', 'claim', '--tx', '0x12'], ['buy', 'claim', '--tx', TXH, '--signature', '0x12'], ['buy', 'claim', 'pl_nope', '--tx', TXH]]) {
    const r = await run(args, {});
    assert.equal(r.code, 2, args.join(' ')); assert.equal(r.seen.length, 0, args.join(' '));
  }
});

test('taifoon balance: the balance, the plan with its days left, and how to renew in the last week', async () => {
  const standing = { ok: true, key: { prefix: 'tfr_free_ab' }, tier: 'plan', balance: { usdc: '4.250000', grid: 425 }, limits: { per_family_per_minute: 1000 },
    plan: { active: true, plan: 'builder-99', name: 'Builder', days_left: 5, ends: '2026-10-10T09:00:00.000Z', allowance: { usdc: '110.000000', left_usdc: '37.500000' }, renew: { offered: true } } };
  const r = await run(['balance'], { 'GET /v1/access/key': { json: standing } });
  assert.equal(r.code, 0, r.err);
  for (const want of ['4.250000 dollars (425 GRID)', 'Builder, 5 days left (ends 2026-10-10)', '37.500000 of 110.000000 dollars left', 'never by itself', 'taifoon buy builder-99', '1000 calls a minute']) assert.ok(r.out.includes(want), want);
  assert.deepEqual(balanceRows({ balance: { usdc: '0.000000', grid: 0 }, plan: null }).map((x) => x[0]), ['balance', 'plan']);
  assert.match(balanceRows({ balance: { usdc: '1.000000', grid: 100 }, plan: { active: false, ended: { plan: 'team-199', on: '2026-10-01T00:00:00Z' } } })[1][1], /team-199 ended 2026-10-01 · taifoon buy team-199/);
  const j = await run(['balance', '--json'], { 'GET /v1/access/key': { json: standing } });
  assert.equal(JSON.parse(j.out).plan.days_left, 5);
});
