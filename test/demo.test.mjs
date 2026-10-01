// taifoon demo n8n: the phases come from the vendored flow (src/n8n-flow.json), the replay reads the last tested run again from
// the layer (no key, nothing written), and --live posts a new demand with the key, or with a free key minted for the run that
// is shown by prefix only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { buyerPhases, lastRunDemand } from '../src/commands/demo.mjs';
import { sink } from './fixture-layer.mjs';

const BASE = 'https://coord.test';
const FLOW = JSON.parse(readFileSync(new URL('../src/n8n-flow.json', import.meta.url), 'utf8'));
const ID = lastRunDemand();
const TX = '0x' + 'b'.repeat(64);
const demand = (state, extra = {}) => ({ id: ID, state, class: 'mcp.digest', chainId: 36927, seller: 'seller.example', handshake_id: 'hs_' + 'c'.repeat(24), job_id: '0x' + 'd'.repeat(64),
  grade: { verdict: 'pass', checks: { digest_exact: true } }, ending: state === 'settled' ? { tx: TX } : null, events: [{ at: '2026-10-01T07:20:37.000Z', state: 'matched', note: 'ranked' }], ...extra });

function layer(states = ['settled']) {
  let i = 0;
  return (path, method, body) => {
    if (path === '/v1/register') return [201, { api_key: 'tfr_free_' + 'K'.repeat(30), key_prefix: 'tfr_free_KKKKK', tenant: { id: 'acct_x' } }];
    if (path === '/v1/tenant/me') return [200, { ok: true, tenant: { id: 'acct_x', via: 'http' }, next_step: { title: 'Post your first demand' } }];
    if (path === '/v1/demands' && method === 'POST') return [body.dry_run ? 200 : 201, body.dry_run ? { ok: true, dry_run: true, class: 'mcp.digest', input: {} } : { ok: true, demand: demand('open') }];
    if (path.startsWith('/v1/demands/')) return [200, { ok: true, demand: demand(states[Math.min(i++, states.length - 1)]) }];
    if (path.startsWith('/v1/handshake/')) return [200, { ok: true, state: 'DELIVERED', candidate: { choice: { chosen: 'seller.example', ranked: [{ seller: 'seller.example', ready: 20 }] } } }];
    if (path.startsWith('/v1/explorer/jobs/')) return [200, { ok: true, job: { doer: { seller: 'seller.example' }, payee: { address: '0x' + 'e'.repeat(40) } } }];
    if (path === '/v1/attest/hire') return [200, { ok: true, verdict: 'REAL', checks: [{ claim: 'settlement transaction', outcome: 'CONFIRMED' }] }];
    return [404, { ok: false, error: `no fixture for ${method} ${path}` }];
  };
}

async function run(argv, answer, env = {}) {
  const out = sink(); const err = sink(); const seen = [];
  const fetch = async (url, init) => {
    const path = url.slice(BASE.length); const body = init?.body ? JSON.parse(init.body) : undefined;
    seen.push({ path, method: init?.method ?? 'GET', body, headers: init?.headers ?? {} });
    const [status, json] = answer(path, init?.method ?? 'GET', body);
    return new Response(JSON.stringify(json), { status });
  };
  const code = await main([...argv, '--layer', BASE, '--no-color'], { out, err, fetch, sleep: async () => {}, exec: () => ({ status: 44, stdout: '', stderr: '' }), env: { TAIFOON_HOME: mkdtempSync(join(tmpdir(), 'taifoon-demo-')), ...env } });
  return { code, out: out.text(), err: err.text(), seen };
}

test('the phases are the flow definition’s buyer phases, and the vendored flow carries a tested buyer run', () => {
  assert.deepEqual(buyerPhases().map((p) => p.id), FLOW.flow.roles.find((r) => r.id === 'buyer').phases.map((p) => p.id));
  assert.match(String(ID), /^dm_[0-9a-f]{24}$/);
});

test('demo n8n (replay): reads only, no key, every phase printed with its node operation and link; exit 0 on settled + REAL', async () => {
  const r = await run(['demo', 'n8n'], layer());
  assert.equal(r.code, 0, r.err);
  assert.ok(r.seen.every((s) => s.method === 'GET' || s.path === '/v1/attest/hire'), 'reads, and the attestation');
  assert.ok(r.seen.every((s) => !s.headers['x-api-key']), 'no key');
  for (const p of buyerPhases()) assert.ok(r.out.includes(p.title.toUpperCase()) && r.out.includes(p.op), `phase ${p.id}`);
  assert.ok(r.out.includes(`https://www.taifoon.io/scan/jobs/${ID}`) && r.out.includes(`/scan/36927/tx/${TX}`));
});

test('demo n8n --live with no key: mints a free key for the run, shows its prefix only, posts the demand on it, watches to the end', async () => {
  const r = await run(['demo', 'n8n', '--live'], layer(['open', 'matched', 'settled']));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.seen.filter((s) => s.method === 'POST').map((s) => s.path), ['/v1/register', '/v1/demands', '/v1/demands', '/v1/attest/hire']);
  const posts = r.seen.filter((s) => s.path === '/v1/demands' && s.method === 'POST');
  assert.equal(posts[0].body.dry_run, true);
  assert.ok(posts.every((s) => s.headers['x-api-key']?.startsWith('tfr_free_')));
  assert.ok(r.out.includes('tfr_free_KKKKK') && !r.out.includes('K'.repeat(30)), 'the prefix, never the key');
});

test('demo n8n --json: one value with every phase and the flow; a demand that did not settle exits 1', async () => {
  const r = await run(['demo', 'n8n', '--json'], layer(['failed']));
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out.trim().split('\n').pop());
  assert.equal(j.mode, 'replay');
  assert.deepEqual(j.flow.map((x) => x.role), FLOW.flow.roles.map((x) => x.id));
  assert.ok(j.phases.some((x) => x.phase === 'explorer'));
});

test('demo with anything but n8n is a usage error', async () => {
  assert.equal((await run(['demo'], layer())).code, 2);
  assert.equal((await run(['demo', 'x'], layer())).code, 2);
});
