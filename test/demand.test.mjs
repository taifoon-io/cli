// taifoon demand (_CLI_DEMAND_v1_): post / status / ls, each one /v1/demands call, against a fake layer. What it holds to: the
// words go to the layer as they are (the layer maps them, the CLI never picks a class); --json prints one value with its calls;
// a 422 shows the candidates; --watch reads until the demand ends; the key is sent when there is one and never printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { postBody } from '../src/commands/demand.mjs';
import { sink } from './fixture-layer.mjs';

const BASE = 'https://coord.test';
const KEY = 'tfr_' + 'C'.repeat(32);
const ID = 'dm_' + 'a'.repeat(24);
const row = (state, extra = {}) => ({ id: ID, state, class: 'mcp.digest', input: { algorithm: 'keccak256', text: 'hello' }, chainId: 36927, price_units: '50000', need: 'the keccak256 hash of "hello"', seller: null, handshake_id: null, job_id: null, grade: null, ending: null, created_at: '2026-09-29T21:00:00.000Z', events: [{ at: '2026-09-29T21:00:00.000Z', state: 'open', by: 'buyer' }], ...extra });

async function run(argv, answer, env = {}) {
  const out = sink(); const err = sink(); const seen = [];
  const fetch = async (url, init) => {
    const path = url.slice(BASE.length); const body = init?.body ? JSON.parse(init.body) : undefined;
    seen.push({ path, method: init?.method ?? 'GET', body, headers: init?.headers ?? {} });
    const [status, json] = answer(path, init?.method ?? 'GET', body, seen.length);
    return new Response(JSON.stringify(json), { status });
  };
  const code = await main([...argv, '--layer', BASE], { out, err, fetch, sleep: async () => {}, exec: () => ({ status: 44, stdout: '', stderr: '' }), env: { TAIFOON_HOME: mkdtempSync(join(tmpdir(), 'taifoon-demand-')), ...env } });
  return { code, out: out.text(), err: err.text(), seen };
}

test('postBody: words as they are, or class + input; --dry-run, --label, --price-units; nothing is a usage error', () => {
  assert.deepEqual(postBody(['the', 'keccak256', 'hash', 'of', '"hi"'], { 'dry-run': true }).body, { need: 'the keccak256 hash of "hi"', dry_run: true });
  assert.deepEqual(postBody([], { class: 'mcp.digest', input: '{"algorithm":"sha256","text":"x"}', label: 'bot', 'price-units': 60000 }).body,
    { class: 'mcp.digest', input: { algorithm: 'sha256', text: 'x' }, buyer_label: 'bot', price_units: '60000' });
  assert.match(postBody([], {}).error, /usage/);
  assert.match(postBody([], { class: 'mcp.digest', input: '[1]' }).error, /JSON object/);
});

test('demand post "<need>" POSTs the words to /v1/demands with the key, prints the id and the next command, never the key', async () => {
  const r = await run(['demand', 'post', 'the keccak256 hash of "hello"', '--key', KEY], () => [201, { ok: true, demand: row('open'), read: `/v1/demands/${ID}` }]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.seen.map((s) => [s.method, s.path, s.body]), [['POST', '/v1/demands', { need: 'the keccak256 hash of "hello"' }]]);
  assert.equal(r.seen[0].headers['x-api-key'], KEY);
  assert.ok(r.out.includes(ID) && r.out.includes(`taifoon demand status ${ID} --watch`));
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY));
});

test('demand post --dry-run --json: one JSON value with the mapping and the calls; nothing kept', async () => {
  const r = await run(['demand', 'post', 'the mean of [1, 2, 3]', '--dry-run', '--json'], () => [200, { ok: true, dry_run: true, class: 'stats.describe', input: { data: [1, 2, 3] }, kept: false }]);
  const lines = r.out.trim().split('\n');
  assert.equal(lines.length, 1);
  const j = JSON.parse(lines[0]);
  assert.equal(j.class, 'stats.describe'); assert.equal(j.kept, false); assert.equal(j.calls.length, 1);
  assert.equal(r.seen[0].body.dry_run, true);
});

test('a 422 shows the candidates and how to resend; exit 1', async () => {
  const r = await run(['demand', 'post', 'word count and the mean of "1, 2, 3"'], () => [422, { ok: false, error: 'the words fit two classes', code: 'ambiguous', candidates: [{ class: 'chat.word_count', missing: [], example: 'how many words are in "a b"' }, { class: 'stats.describe', missing: [], example: 'the mean of [1, 2]' }] }]);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('chat.word_count') && r.out.includes('stats.describe') && r.out.includes('--class'));
  assert.ok(r.err.includes('ambiguous'));
});

test('demand status --watch reads until the demand ends and prints the job and the ending tx', async () => {
  const tx = '0x' + 'e'.repeat(64); const job = '0x' + 'f'.repeat(64);
  const steps = [row('open'), row('hired', { seller: 'api.taifoon.dev' }), row('settling', { job_id: job }), row('settled', { job_id: job, grade: { verdict: 'pass', judge_called: false }, ending: { transition: 'auto_complete_v4', tx } })];
  const r = await run(['demand', 'status', ID, '--watch', '5'], (path, m, b, n) => [200, { ok: true, demand: steps[Math.min(n - 1, 3)] }]);
  assert.equal(r.code, 0);
  assert.equal(r.seen.length, 4);
  assert.ok(r.seen.every((s) => s.path === `/v1/demands/${ID}` && s.method === 'GET'));
  assert.ok(r.out.includes('auto_complete_v4') && r.out.includes(tx) && r.out.includes(job));
});

test('demand status refuses a malformed id before any call; demand ls filters by state and checks it', async () => {
  const bad = await run(['demand', 'status', 'dm_nope'], () => [200, {}]);
  assert.equal(bad.code, 2); assert.equal(bad.seen.length, 0);
  const st = await run(['demand', 'ls', '--state', 'nope'], () => [200, {}]);
  assert.equal(st.code, 2);
  const r = await run(['demand', 'ls', '--state', 'settled', '--limit', '5', '--json'], () => [200, { ok: true, count: 1, demands: [row('settled')], classes: ['mcp.digest'] }]);
  assert.equal(r.seen[0].path, '/v1/demands?state=settled&limit=5');
  const j = JSON.parse(r.out.trim());
  assert.equal(j.count, 1); assert.deepEqual(j.classes, ['mcp.digest']);
});

test('the command is in the table: taifoon help demand', async () => {
  const r = await run(['help', 'demand'], () => [200, {}]);
  assert.ok(r.out.includes('demand post') && r.out.includes('demand status') && r.out.includes('demand ls'));
});
