// `taifoon up` / status / curl against recorded layer answers (test/fixtures, recorded by test/record-fixtures.mjs).
// The rendered output is snapshotted in test/snapshots; UPDATE_SNAPSHOTS=1 rewrites them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { fakeClock, fixtureFetch, loadFixture, sink } from './fixture-layer.mjs';

const SNAP = new URL('./snapshots/', import.meta.url);
function snapshot(name, text) {
  const file = new URL(name, SNAP);
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(file)) {
    mkdirSync(SNAP, { recursive: true });
    writeFileSync(file, text);
    if (process.env.UPDATE_SNAPSHOTS !== '1') assert.fail(`wrote a new snapshot ${name}; check it and run again`);
    return;
  }
  assert.equal(text, readFileSync(file, 'utf8'), `snapshot ${name} (UPDATE_SNAPSHOTS=1 to accept)`);
}

/** Run the CLI over a fixture. Returns { code, out, err, seen }. */
async function run(args, { fx, over, home, clock, env = {} } = {}) {
  const out = sink(); const err = sink();
  const { f, seen } = fixtureFetch(fx, over);
  const code = await main([...args, '--layer', fx.base], { out, err, fetch: f, now: clock ?? fakeClock(), env: { TAIFOON_HOME: home ?? mkdtempSync(join(tmpdir(), 'taifoon-t-')), ...env } });
  return { code, out: out.text(), err: err.text(), seen };
}

const CASES = [
  ['hireable-not-assured-8453-95902', '8453:95902'],
  ['no-endpoint-8453-95134', '8453:95134'],
  ['pilot-seller-8453-0xdca0', '8453:0xdca0f0166bbc52a94073781d3971d8aa1938ef20'],
  ['uncovered-chain-56-310070', '56:310070'],
];

for (const [name, ref] of CASES) {
  test(`up ${ref} renders the recorded walk (${name})`, async () => {
    const fx = loadFixture(name);
    const r = await run(['up', ref], { fx });
    snapshot(`up-${name}.txt`, r.out);
    assert.equal(r.err, '');
    assert.doesNotMatch(r.out, /\u001b\[/, 'no colour off a TTY');
    // reads only: GET, and the read-only POST /v1/pools/quote
    for (const s of r.seen) assert.match(s.k, /^(GET |POST \/v1\/pools\/quote )/, s.k);
    assert.ok(!r.seen.some((s) => s.k.includes('unrecorded')));
  });
}

test('the hireable agent: every step read, one warn (the quote), exit 0', async () => {
  const r = await run(['up', '8453:95902'], { fx: loadFixture('hireable-not-assured-8453-95902') });
  assert.equal(r.code, 0);
  assert.match(r.out, /^✓ hireable · 8 ok · 2 missing · 0 pending · 3 blocked · \d+ ms$/m);
  assert.match(r.out, /^! not guaranteed · premium 0\.0%–65\.8% · thin record \(2 settled\) · deposit 2x · at 1 USDC/m);
  // the Wilson numbers are the layer's (record.wilson from /v1/pools/quote), printed, not computed
  assert.match(r.out, /95% Wilson interval on the incorrect rate 0–0\.6576 · n 2 · 0 incorrect · not calibrated \(from \/v1\/pools\/quote\)/);
  assert.match(r.out, /curl -s -X POST https:\/\/coord\.taifoon\.dev\/v1\/hire\/pad .*"phase":"quote","chainId":8453,"seller":"0x3574999dd4c96eb73bd6e11d4177010c83e14f5b"/);
});

test('the no-endpoint agent: probe and classes warn, enrich is a printed instruction for the owner', async () => {
  const r = await run(['up', '8453:95134'], { fx: loadFixture('no-endpoint-8453-95134') });
  assert.equal(r.code, 0);
  assert.match(r.out, /^! not hireable/m);
  assert.match(r.out, /^→ enrich: sign with your owner wallet at https:\/\/coord\.taifoon\.dev\/v1\/agents\/8453\/95134\/enrich \(GET it for the message, sign it, POST the signature back\)$/m);
  assert.match(r.out, /^! no class matched/m);
});

test('an uncovered chain: the quote is refused for the chain, in the layer\'s words, and the walk goes on (no retry offered)', async () => {
  const r = await run(['up', '56:310070'], { fx: loadFixture('uncovered-chain-56-310070') });
  assert.equal(r.code, 0);
  assert.match(r.out, /^! no quote on chain 56: chain 56 is not a chain this layer covers \(the assurance layer quotes on Base 8453, Arc 5042 and the devnet 36927\)/m);
  assert.doesNotMatch(r.out, /could not be read \(400\)/);
  assert.match(r.out, /\[5\/5\]/);
});

test('the pilot seller covered: a guaranteed quote prints ✓ (quote answer patched from the recorded one: guaranteed, pooled)', async () => {
  // SYNTHETIC: on 2026-09-27 the layer quotes the pilot seller not guaranteed (79.3% Wilson-high > the 30% pool rule).
  // This variant sets guaranteed + a pool on the recorded answer to cover the ✓ quote path; every other answer is as recorded.
  const fx = loadFixture('pilot-seller-8453-0xdca0');
  const k = Object.keys(fx.responses).find((x) => x.startsWith('POST /v1/pools/quote'));
  const q = structuredClone(fx.responses[k]);
  Object.assign(q.json, { guaranteed: true, premium_label: '0.0%–3.7%', deposit_rung: 'minimum', pool_id: '0x95951a4bF6F2f99131a5653060d5E8a24F6feb9e', record: { n: 98, settled: 98, incorrect: 0, wilson: [0, 0.03771999012168061], width_pp: 3.77, calibrated: true, thin: false, insurable: true } });
  const r = await run(['up', '8453:0xdca0f0166bbc52a94073781d3971d8aa1938ef20'], { fx, over: { [k]: q } });
  snapshot('up-pilot-seller-covered-synthetic.txt', r.out);
  assert.match(r.out, /^✓ guaranteed · premium 0\.0%–3\.7% · deposit minimum · at 1 USDC/m);
  assert.match(r.out, /95% Wilson interval on the incorrect rate 0–0\.0377 · n 98 · 0 incorrect · calibrated/);
});

test('--json: one StepResult per line and no prose', async () => {
  const r = await run(['up', '8453:95902', '--json'], { fx: loadFixture('hireable-not-assured-8453-95902') });
  const lines = r.out.trim().split('\n');
  assert.equal(lines.length, 5);
  const rows = lines.map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => [x.n, x.step, x.mark]), [[1, 'readiness', 'ok'], [2, 'probe', 'ok'], [3, 'classes', 'ok'], [4, 'quote', 'warn'], [5, 'jev', 'ok']]);
  for (const x of rows) for (const k of ['step', 'n', 'of', 'title', 'mark', 'fact', 'calls', 'facts', 'next', 'seller', 'ms']) assert.ok(k in x, `${x.step} has ${k}`);
  assert.deepEqual(rows[3].record.wilson, [0, 0.6576197724933469]);
  snapshot('up-hireable-not-assured-8453-95902.json.txt', r.out);
});

test('re-runs: a ✓ under 10 minutes prints from the state file; ! is read again; --fresh and age re-read all', async () => {
  const fx = loadFixture('hireable-not-assured-8453-95902');
  const home = mkdtempSync(join(tmpdir(), 'taifoon-t-'));
  const clock = fakeClock();
  await run(['up', '8453:95902'], { fx, home, clock });
  clock.advance(60_000);
  const again = await run(['up'], { fx, home, clock });              // no ref: the last agent
  assert.equal(again.code, 0);
  assert.equal((again.out.match(/cached 1 min ago/g) ?? []).length, 4);
  assert.deepEqual(again.seen.map((s) => s.k.split(' ').slice(0, 2).join(' ')), ['GET /v1/agents/8453/95902/readiness', 'POST /v1/pools/quote']);
  snapshot('up-rerun-8453-95902.txt', again.out);
  const fresh = await run(['up', '8453:95902', '--fresh'], { fx, home, clock });
  assert.equal(fresh.seen.length, 8);
  clock.advance(11 * 60_000);
  const old = await run(['up', '8453:95902'], { fx, home, clock });
  assert.equal(old.seen.length, 8);
  assert.doesNotMatch(old.out, /cached/);
});

test('status and curl read the state file; curl --json', async () => {
  const fx = loadFixture('hireable-not-assured-8453-95902');
  const home = mkdtempSync(join(tmpdir(), 'taifoon-t-'));
  const clock = fakeClock();
  await run(['up', '8453:95902'], { fx, home, clock });
  clock.advance(125_000);
  const st = await run(['status', '8453:95902'], { fx, home, clock });
  assert.equal(st.seen.length, 0, 'status makes no call');
  snapshot('status-8453-95902.txt', st.out.replace(home, '<home>'));
  const cu = await run(['curl'], { fx, home, clock });
  assert.equal(cu.seen.length, 0, 'curl makes no call');
  snapshot('curl-8453-95902.txt', cu.out);
  const cj = JSON.parse((await run(['curl', '--json'], { fx, home, clock })).out);
  assert.equal(cj.step, 'jev');
  assert.deepEqual(cj.calls.map((c) => c.curl), ['curl -s https://coord.taifoon.dev/v1/judge/decisions?limit=1', 'curl -s https://coord.taifoon.dev/v1/judge/answers?limit=1']);
  const sj = JSON.parse((await run(['status', '8453:95902', '--json'], { fx, home, clock })).out);
  assert.equal(sj.steps.quote.result.mark, 'warn');
  const none = await run(['status', '8453:1'], { fx, home, clock });
  assert.equal(none.code, 1);
  assert.match(none.out, /8453:1 has not been walked on this machine: taifoon up 8453:1/);
});

test('an X-API-Key rides on every call and is never printed; curl names the env var instead', async () => {
  const fx = loadFixture('hireable-not-assured-8453-95902');
  const home = mkdtempSync(join(tmpdir(), 'taifoon-t-'));
  const secret = 'tk_live_do_not_print_1234567890';
  const r = await run(['up', '8453:95902', '--key', secret], { fx, home });
  assert.ok(r.seen.every((s) => s.headers['x-api-key'] === secret));
  assert.ok(!r.out.includes(secret));
  const cu = await run(['curl', '--key', secret], { fx, home });
  assert.ok(!cu.out.includes(secret));
  assert.match(cu.out, /-H "x-api-key: \$TAIFOON_API_KEY"/);
  assert.ok(!readFileSync(join(home, 'up', '8453-95902.json'), 'utf8').includes(secret), 'the state file has no key');
});

test('colour: FORCE_COLOR turns it on, NO_COLOR and --no-color keep it off', async () => {
  const fx = loadFixture('hireable-not-assured-8453-95902');
  assert.match((await run(['up', '8453:95902'], { fx, env: { FORCE_COLOR: '1' } })).out, /\u001b\[32m✓/);
  assert.doesNotMatch((await run(['up', '8453:95902', '--no-color'], { fx, env: { FORCE_COLOR: '1' } })).out, /\u001b\[/);
  assert.doesNotMatch((await run(['up', '8453:95902'], { fx, env: { NO_COLOR: '1' } })).out, /\u001b\[/);
});

test('usage errors exit 2', async () => {
  const fx = loadFixture('hireable-not-assured-8453-95902');
  const home = mkdtempSync(join(tmpdir(), 'taifoon-t-'));
  assert.equal((await run(['up'], { fx, home })).code, 2);                   // no agent, no last agent
  assert.equal((await run(['up', 'nonsense'], { fx, home })).code, 2);
  assert.equal((await run(['frobnicate'], { fx, home })).code, 2);
  assert.equal((await run(['up', '8453:1', 'extra'], { fx, home })).code, 2);
  const h = await run(['help'], { fx, home });
  assert.equal(h.code, 0);
  assert.match(h.out, /taifoon up <chain>:<agentId>/);
});
