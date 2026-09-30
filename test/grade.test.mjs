// `taifoon grade` delegates to @taifoon/jev's pipeline() with `jev run`'s flags; it never grades on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main } from '../src/main.mjs';
import { jevCandidates, loadJev, parseGradeFlags } from '../src/grade.mjs';
import { sink } from './fixture-layer.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-jev.mjs', import.meta.url));
const notTTY = { isTTY: false };

test('the flags are jev run\'s, parsed the same way', () => {
  const f = parseGradeFlags(['--job', '8453:81100', '--network', 'base', '--layer', 'https://l.example', '--protocol', 'bitagent', '--price-usdc', '2.5', '--json'], true);
  assert.deepEqual({ ...f, rest: f.rest }, { yes: false, json: true, noLayer: false, job: '8453:81100', evidence: undefined, answers: undefined, network: 'base', layer: 'https://l.example', protocol: 'bitagent', price: '2.5', rest: [] });
  assert.equal(parseGradeFlags([], false).yes, true, 'no TTY: --yes');
  assert.equal(parseGradeFlags(['--no-layer'], true).layer, false);
  assert.equal(parseGradeFlags([], true).network, 'none');                     // recording is opt-in
  assert.equal(parseGradeFlags(['--record', 'base'], true).network, 'base');
  assert.equal(parseGradeFlags(['--network', 'both'], true).network, 'both');   // --network stays an alias
});

test('grade hands the options to pipeline() and prints each step with the shared renderer', async () => {
  const jev = await import(FAKE);
  const dir = mkdtempSync(join(tmpdir(), 'taifoon-g-'));
  const ev = join(dir, 'pack.json'); writeFileSync(ev, JSON.stringify({ subject: 'x', state: 'task: y' }));
  const out = sink();
  const code = await main(['grade', '--job', '8453:81100', '--network', 'base', '--evidence', ev, '--price-usdc', '3', '--yes'], { out, err: sink(), env: { TYPESAFE_KEY: 'ts_secret', TAIFOON_RELAYER_KEY: 'rk_secret' }, stdin: notTTY, jev });
  assert.equal(code, 1, 'a failed step exits 1, as jev run does');
  const o = jev.calls.at(-1);
  assert.equal(o.job, '8453:81100'); assert.equal(o.network, 'base'); assert.equal(o.priceUsdc, 3); assert.equal(o.layer, undefined);
  assert.deepEqual(o.evidence, { subject: 'x', state: 'task: y' });
  assert.equal(o.key, 'ts_secret'); assert.equal(o.relayerKey, 'rk_secret'); assert.equal('trial' in o, false, 'no shared free path: the key is the caller\'s own');
  const text = out.text();
  assert.ok(!text.includes('ts_secret') && !text.includes('rk_secret'), 'keys are never printed');
  assert.equal(text, [
    'taifoon grade → @taifoon/jev pipeline() · layer https://coord.taifoon.dev · grade on your TypeSafe key · record → base + the layer',
    '→ [1/3] Pick the job  ·  GET /v1/judge/queue',
    '✓ pick · 12 ms',
    '    {',
    '     "jobId": "81100"',
    '    }',
    '→ [2/3] Grade it  ·  POST /v1/systemone',
    '✗ TypeSafe answered 429 · 40 ms',
    '→ [3/3] Verify the record',
    '· nothing was recorded',
    'verdict needs_review · receipt 0xfeed',
    '',
  ].join('\n'));
});

test('grade --json prints the trace only', async () => {
  const jev = await import(FAKE);
  const out = sink();
  await main(['grade', '--no-layer', '--json'], { out, err: sink(), env: { TYPESAFE_KEY: 'ts_secret' }, stdin: notTTY, jev });
  const lines = out.text().trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).receipt.verdict, 'needs_review');
  assert.equal(jev.calls.at(-1).layer, false);
});

test('without your own TypeSafe key (and no --answers) grade stops before Jev is called (exit 2)', async () => {
  const jev = await import(FAKE);
  const before = jev.calls.length;
  const out = sink(); const err = sink();
  const code = await main(['grade', '--no-layer', '--yes'], { out, err, env: {}, stdin: notTTY, jev });
  assert.equal(code, 2);
  assert.equal(jev.calls.length, before, 'pipeline() is never called');
  assert.match(out.text() + err.text(), /TYPESAFE_KEY.*console\.typesafe\.ai.*--answers/);
  assert.doesNotMatch(out.text() + err.text(), /trial|free call/i);
});

test('@taifoon/jev is found from TAIFOON_JEV_SDK first; a missing one is a clear error (exit 3)', async () => {
  assert.equal(jevCandidates({ TAIFOON_JEV_SDK: FAKE })[0].endsWith('fake-jev.mjs'), true);
  const m = await loadJev({ TAIFOON_JEV_SDK: FAKE });
  assert.equal(m.STEPS.length, 3);
  await assert.rejects(loadJev({}, ['file:///nonexistent/jev.js']), (e) => e.code === 'NO_JEV' && /TAIFOON_JEV_SDK/.test(e.message));
});

// the real pipeline, offline: your own evidence and answers, no layer, nothing recorded. Needs @taifoon/jev: set
// TAIFOON_JEV_SDK to its dist/index.js, or install the package.
const installedSdk = () => { try { return fileURLToPath(import.meta.resolve('@taifoon/jev')); } catch { return null; } };
const realSdk = process.env.TAIFOON_JEV_SDK || installedSdk();
const hasPipeline = realSdk && existsSync(realSdk) && typeof (await import(pathToFileURL(realSdk).href).catch(() => ({}))).pipeline === 'function';
test('the real @taifoon/jev pipeline grades a pack offline through taifoon grade', { skip: hasPipeline ? false : `no @taifoon/jev with pipeline() (install it or set TAIFOON_JEV_SDK)${realSdk ? `; tried ${realSdk}` : ''}` }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taifoon-g-'));
  const ans = (id, value, probabilities, confidence) => ({ id, value, confidence, probabilities });
  const answers = [ans('spec_met', 'yes', { yes: 0.93, no: 0.07 }, 0.86), ans('unsupported_claim', 'no', { yes: 0.04, no: 0.96 }, 0.92), ans('ending', 'complete', { complete: 0.9, reject: 0.03, expire: 0, needs_review: 0.07 }, 0.83), ans('cheat_shaped', 'no', { yes: 0.02, no: 0.98 }, 0.96)];
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({ subject: 'my-protocol:job-7', state: 'task: summarise X\ndelivered: a summary of X', checks: { schema_ok: true } }));
  writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers));
  const out = sink();
  const code = await main(['grade', '--no-layer', '--evidence', join(dir, 'pack.json'), '--answers', join(dir, 'answers.json'), '--network', 'none', '--yes', '--json'], { out, err: sink(), env: { TAIFOON_JEV_SDK: realSdk }, stdin: notTTY });
  const trace = JSON.parse(out.text());
  assert.equal(trace.receipt.verdict, 'complete');
  assert.equal(code, trace.steps.some((s) => !s.ok) ? 1 : 0);
});
