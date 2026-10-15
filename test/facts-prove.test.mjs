// taifoon facts and taifoon prove against recorded /v1 answers (test/fixtures/proof-tx-8453.json, recorded 2026-10-13) and the
// registry this CLI carries. What it holds to: addresses come from the registry, never typed here; a proof is "proven" only when the
// op proved it; held, failed and unproven are told apart; the exit code says which.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { factsChain, factsContracts, factsSuperroot, resolveChain, sameAddress, contractRows, verifierOf } from '../src/facts.mjs';
import { verdictOf, proveSale, proveTx, stepsOfSale, txOfKey } from '../src/prove.mjs';
import { handoff } from '../src/handoff.mjs';
import { REGISTRY } from '../src/registry.mjs';
import { main } from '../src/main.mjs';
import { sink } from './fixture-layer.mjs';

const FX = JSON.parse(readFileSync(new URL('./fixtures/proof-tx-8453.json', import.meta.url), 'utf8'));
const P = FX.proof_tx; const TX = P.tx;
const ROOT_CHAINS = { chains: [{ chain_id: 100, network_name: 'Gnosis', status: 'collecting', latest_block: 48737200, blocks_in_tree: 10, last_header_age_secs: 4, mini_mmr_root: '0x' + 'a'.repeat(64) }, { chain_id: 8453, network_name: 'Base', status: 'collecting', latest_block: 52304700, blocks_in_tree: 9, last_header_age_secs: 2, mini_mmr_root: '0x' + 'b'.repeat(64) }, { chain_id: 59144, network_name: 'Linea', status: 'collecting', latest_block: 1, blocks_in_tree: 1, last_header_age_secs: 3, mini_mmr_root: '0x' + 'c'.repeat(64) }] };
const getter = (routes) => async (path) => { const v = routes[path]; return v === undefined ? { ok: false, status: 404, json: { ok: false, error: `no route ${path}` } } : { ok: v.ok !== false, status: v.ok === false ? 409 : 200, json: v }; };

test('resolveChain: ids, aliases, registry names and the root’s chain names', () => {
  assert.equal(resolveChain('8453'), 8453); assert.equal(resolveChain('base'), 8453); assert.equal(resolveChain('Gnosis'), 100);
  assert.equal(resolveChain('arbitrum-one'), 42161); assert.equal(resolveChain('linea', { rootChains: ROOT_CHAINS.chains }), 59144);
  assert.equal(resolveChain('no-such-chain'), null);
});

test('facts contracts: rows come from the registry; TsulDonut is in the same-address set the registry declares', async () => {
  const out = await factsContracts({ chain: 'gnosis' });
  assert.equal(out.ok, true); assert.equal(out.public, true);
  const donut = REGISTRY.systems['coord-settlement'].contracts.find((c) => c.name === 'TsulDonut');
  assert.ok(out.contracts.some((c) => c.address === donut.address && c.chain === 100));
  const g = out.same_address.find((x) => x.address === donut.address);
  assert.ok(g, 'TsulDonut is in the same-address set'); assert.equal(g.declared, 'one address on every EVM chain (CREATE2)');
  assert.ok(out.contracts.every((c) => c.public === undefined), 'the public subset has no governance rows');
});

test('facts contracts with a full registry lists its governance rows, marked public: false, grouped by address across chains', async () => {
  const SAFE = '0x' + '5'.repeat(40);
  const full = { ...REGISTRY, governance: { public: false, entries: [8453, 5042, 100].map((chain) => ({ chain, system: 'taifoon-assurance', name: `Example Safe (owner on chain ${chain})`, address: SAFE, kind: 'multisig', status: 'live' })) } };
  const out = await factsContracts({}, { registry: full });
  assert.equal(out.public, false);
  const g = out.same_address.find((x) => x.address === SAFE);
  assert.deepEqual(g.chains, [100, 5042, 8453]); assert.equal(g.public, false);
  assert.equal(sameAddress(contractRows(REGISTRY)).some((x) => x.address === SAFE), false);
});

test('facts chain: the registry entry, our contracts on it and its leaf in the superroot; an unread live list says so', async () => {
  const one = await factsChain({ chain: 'gnosis' }, { get: getter({ '/v1/root/chains': ROOT_CHAINS }) });
  assert.equal(one.ok, true); assert.equal(one.chain.id, 100); assert.equal(one.chain.superroot.status, 'collecting');
  assert.ok(one.chain.contracts.length > 0);
  const dead = await factsChain({ chain: 'gnosis' }, { get: async () => ({ ok: false, status: 503, json: null }) });
  assert.match(dead.chain.superroot, /^unread/);
  const all = await factsChain({}, { get: getter({ '/v1/root/chains': ROOT_CHAINS }) });
  assert.ok(all.chains.find((c) => c.id === 59144 && c.in_registry === false && c.superroot === 'collecting'));
  assert.equal((await factsChain({ chain: 'nowhere' }, { get: getter({ '/v1/root/chains': ROOT_CHAINS }) })).ok, false);
});

test('facts superroot: root, chains, the feed, the registry’s live verifier, and the trust line', async () => {
  const out = await factsSuperroot({}, { get: getter({ '/v1/root': FX.root, '/v1/root/latest': { ok: true, epoch: 1, root: 'ab', anchoredAt: 1791903466, cadence: { recompute_seconds: 10, anchor_age_seconds: 9 } } }) });
  assert.equal(out.ok, true); assert.equal(out.root, `0x${FX.root.root}`); assert.equal(out.chains_included, FX.root.chains_included.length);
  assert.equal(out.onchain_anchor, null); assert.deepEqual(out.verifier, verifierOf());
  assert.match(out.trust, /No superroot anchor is posted on any chain yet/);
});

test('verdictOf: proven with the v5 reference; reverted is failed; not proven yet is awaiting_proof; a mismatch is unproven', () => {
  const v = verdictOf(P);
  assert.equal(v.state, 'proven'); assert.equal(v.ref, `v5:8453:${TX}@0x${P.super_root_hash}#${P.batch_id}`);
  assert.equal(verdictOf({ ...P, checks: { ...P.checks, tx_succeeded: false } }).state, 'failed');
  assert.equal(verdictOf({ ...P, proven: false, proof_state: 'pending_proof' }).state, 'awaiting_proof');
  assert.equal(verdictOf({ ...P, checks: { ...P.checks, block_hash_matches: false } }).state, 'unproven');
  assert.equal(verdictOf({ ok: false, error: 'chain_not_in_root' }).state, 'unproven');
  assert.equal(verdictOf(null).state, 'unproven');
  // the op promises proven: true with every proof; an answer without it is not taken as one (the sale run's gate reads it the same way)
  const nf = verdictOf(FX.no_proven_field); assert.equal(nf.state, 'awaiting_proof'); assert.match(nf.why, /carries no proven: true/);
});

test('proveTx: refuses a malformed chain or tx before any call', async () => {
  let called = 0; const get = async () => { called += 1; return {}; };
  assert.equal((await proveTx({ chain: 'base', tx: TX }, { get })).ok, false);
  assert.equal((await proveTx({ chain: '8453', tx: '0x12' }, { get })).ok, false);
  assert.equal(called, 0);
});

const SUMMARY = (proofs) => ({ schema: 'taifoon.sale-run.summary.v1', generated_at: '2026-10-13T15:00:00Z', cells: [], ...(proofs ? { proofs } : {}) });
const KEY = `sale:8453:${TX}`;

test('proveSale: the proofs index; each step asked of coord again; held awaiting_proof wins over a recorded ok', async () => {
  const OTHER = '0x' + 'd'.repeat(64);
  const get = getter({ [`/v1/proof/tx/8453/${TX}`]: P, [`/v1/proof/tx/8453/${OTHER}`]: { ...P, tx: OTHER, proven: false, proof_state: 'pending_proof' } });
  const out = await proveSale({ sale_key: KEY }, { get, fetchSummary: async () => SUMMARY([
    { sale_key: KEY, step: 'settled', outcome: 'ok', held_by: null, chain: '8453', tx: TX, proof: 'v5:…' },
    { sale_key: KEY, step: 'paid', outcome: 'held', held_by: 'awaiting_proof', chain: '8453', tx: OTHER, proof: null },
    { sale_key: 'sale:8453:0xother', step: 'paid', outcome: 'ok', held_by: null, chain: '8453', tx: OTHER, proof: null }]) });
  assert.equal(out.state, 'awaiting_proof'); assert.deepEqual(out.steps.map((s) => [s.step, s.state]), [['settled', 'proven'], ['paid', 'awaiting_proof']]);
  const proven = await proveSale({ sale_key: KEY }, { get, fetchSummary: async () => SUMMARY([{ sale_key: KEY, step: 'settled', outcome: 'ok', held_by: null, chain: '8453', tx: TX, proof: null }]) });
  assert.equal(proven.state, 'proven'); assert.equal(proven.ok, true);
  // a paid step held for another reason (no payout address) names no transaction: shown as no_tx, not counted against the sale
  const held = await proveSale({ sale_key: KEY }, { get, fetchSummary: async () => SUMMARY([{ sale_key: KEY, step: 'settled', outcome: 'ok', held_by: null, chain: '8453', tx: TX, proof: null }, { sale_key: KEY, step: 'paid', outcome: 'held', held_by: 'held_no_payee', chain: '8453', tx: null, proof: null }]) });
  assert.equal(held.state, 'proven'); assert.deepEqual(held.steps.map((x) => x.state), ['proven', 'no_tx']);
  const only = await proveSale({ sale_key: KEY }, { get, fetchSummary: async () => SUMMARY([{ sale_key: KEY, step: 'paid', outcome: 'held', held_by: 'held_no_payee', chain: '8453', tx: null, proof: null }]) });
  assert.equal(only.state, 'unproven'); assert.match(only.why, /names a transaction yet/);
});

test('proveSale: an older summary (no proofs index) falls back to the cells; no step at all falls back to the key’s own transaction', async () => {
  const s = { ...SUMMARY(null), cells: [{ stage: 'settled', last: { sale_key: KEY, outcome: 'ok', tx: TX, proof: null, held_by: null } }, { stage: 'graded', last: { sale_key: KEY, outcome: 'ok' } }] };
  assert.deepEqual(stepsOfSale(s, KEY).steps.map((x) => x.step), ['settled']);
  const get = getter({ [`/v1/proof/tx/8453/${TX}`]: P });
  const own = await proveSale({ sale_key: KEY }, { get, fetchSummary: async () => SUMMARY([]) });
  assert.equal(own.state, 'proven'); assert.equal(own.key_tx.tx, TX);
  assert.deepEqual(txOfKey(`bridge:8453:${TX}:3`), { chain: '8453', tx: TX, step: 'the burn the key is derived from' });
  assert.equal(txOfKey('job:36927:42'), null);
  const none = await proveSale({ sale_key: 'job:36927:42' }, { get, fetchSummary: async () => SUMMARY([]) });
  assert.equal(none.state, 'not_found');
  const unread = await proveSale({ sale_key: 'job:36927:42' }, { get, fetchSummary: async () => { throw new Error('HTTP 502'); } });
  assert.equal(unread.state, 'not_found'); assert.match(unread.why, /unread/);
});

test('handoff: a plan becomes the kms-access line; a bad plan is refused; nothing runs', async () => {
  const ok = await handoff({ plan: { to: '0x' + '1'.repeat(40), data: '0x1234', value: '1000', chainId: 8453 }, project: 'taifoon' });
  assert.equal(ok.ok, true); assert.equal(ok.executed, false); assert.match(ok.command[1], /--value-wei 1000$/);
  assert.equal((await handoff({ plan: { data: '0x' } })).ok, false);
  assert.equal((await handoff({ plan: { to: '0x12', data: '0x', chainId: 1 } })).ok, false);
  assert.equal((await handoff({ plan: { to: '0x' + '1'.repeat(40), data: '0x', chainId: 1, value: 'lots' } })).ok, false);
  assert.equal((await handoff({ plan: '{not json' })).ok, false);
});

async function run(argv, routes = {}, extra = {}) {
  const out = sink(); const err = sink(); const seen = [];
  const fetch = async (url) => { seen.push(url); const path = url.replace(/^https:\/\/coord\.test/, ''); const v = routes[path] ?? routes[url]; return new Response(JSON.stringify(v ?? { ok: false, error: 'no route' }), { status: v ? 200 : 404 }); };
  const code = await main([...argv, '--layer', 'https://coord.test'], { out, err, fetch, env: { TAIFOON_HOME: mkdtempSync(join(tmpdir(), 'taifoon-prove-')), NO_COLOR: '1', ...extra }, exec: () => ({ status: 44, stdout: '', stderr: '' }) });
  return { code, out: out.text(), err: err.text(), seen };
}

test('taifoon prove tx: prints proven with the reference and exits 0; awaiting_proof exits 3; failed exits 1; no key is sent', async () => {
  const ok = await run(['prove', 'tx', '8453', TX], { [`/v1/proof/tx/8453/${TX}`]: P }, { TAIFOON_API_KEY: 'tfr_' + 'Z'.repeat(32) });
  assert.equal(ok.code, 0, ok.err); assert.match(ok.out, /proven {2}v5:8453:0x/); assert.match(ok.out, /TaifoonV5ProofVerifier/);
  const wait = await run(['prove', 'tx', '8453', TX], { [`/v1/proof/tx/8453/${TX}`]: { ...P, proven: false, proof_state: 'pending_proof' } });
  assert.equal(wait.code, 3); assert.match(wait.out, /held awaiting_proof/);
  const bad = await run(['prove', 'tx', '8453', TX], { [`/v1/proof/tx/8453/${TX}`]: { ...P, checks: { ...P.checks, tx_succeeded: false } } });
  assert.equal(bad.code, 1); assert.match(bad.out, /failed/);
  const j = await run(['prove', 'tx', '8453', TX, '--json'], { [`/v1/proof/tx/8453/${TX}`]: P });
  assert.equal(JSON.parse(j.out).state, 'proven');
  assert.equal((await run(['prove', 'tx', 'base'])).code, 2);
});

test('taifoon prove sale reads a summary file; taifoon facts prints JSON; taifoon act prints the hand-off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taifoon-sum-')); const f = join(dir, 'sale-run.json');
  writeFileSync(f, JSON.stringify(SUMMARY([{ sale_key: KEY, step: 'settled', outcome: 'ok', held_by: null, chain: '8453', tx: TX, proof: null }])));
  const s = await run(['prove', 'sale', KEY, '--summary', f], { [`/v1/proof/tx/8453/${TX}`]: P });
  assert.equal(s.code, 0, s.err); assert.match(s.out, /settled +proven/);
  const missing = await run(['prove', 'sale', 'job:36927:42', '--summary', f]);
  assert.equal(missing.code, 4);
  const facts = await run(['facts', 'contracts', 'gnosis']);
  assert.equal(facts.code, 0); assert.equal(JSON.parse(facts.out).filter.chain, 100);
  const plan = join(dir, 'plan.json'); writeFileSync(plan, JSON.stringify({ to: '0x' + '2'.repeat(40), data: '0x', chainId: 36927 }));
  const act = await run(['act', plan, '--project', 'taifoon']);
  assert.equal(act.code, 0); assert.match(act.out, /kms-access send taifoon --chain 36927/); assert.equal(act.seen.length, 0, 'the hand-off makes no call');
});
