// _STREAM_LIVE_v1_ — `taifoon stream`: the pipe by default (keyless works), NDJSON off a terminal, the aligned coloured view on one,
// filters, --all merging the coord lanes, and LaserStream's reconnect (resume from the last seq + 1, a refusal is final).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { main } from '../src/main.mjs';
import { follow, passes, filtersOf } from '../src/stream-live.mjs';

const SAMPLE = readFileSync(new URL('./fixtures/pipe-sample.sse', import.meta.url), 'utf8');
const blocks = SAMPLE.split('\n\n').filter(Boolean);
const seqOf = (b) => Number(b.match(/^id: (\d+)$/m)?.[1]);
const body = (text) => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
const OWNERS = [{ id: 'chain:8453', kind: 'chain', name: 'Base', owner: { persona: 'operator', holder: 'taifoon' }, seat: { state: 'held_by_operator', delegable: true }, shares: { owner_bps: 0, partner: null, partner_bps: 0, taifoon_bps: 10000 } }, { id: 'protocol:across_v3', kind: 'protocol', name: 'Across', owner: { persona: 'operator', holder: 'taifoon' }, seat: { state: 'held_by_operator', delegable: true }, shares: { owner_bps: 0, partner: null, partner_bps: 0, taifoon_bps: 10000 } }];
const sink = (tty, columns = 140) => { const o = { buf: '', isTTY: tty, columns, write(s) { o.buf += s; return true; } }; return o; };
const strip = (s) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

/** a layer that serves the captured pipe session in two connections (the first ends half-way, as a keyless session does) */
function layer({ lanes = '', whole = false } = {}) {
  const calls = []; let pipeN = 0;
  const fetch = async (url, init) => {
    calls.push({ url: String(url), key: init?.headers?.['x-api-key'] ?? null });
    const u = new URL(url);
    if (u.pathname === '/v1/pipe/stream') {
      const from = Number(u.searchParams.get('from_seq') ?? 0);
      const rest = blocks.filter((b) => seqOf(b) >= from);
      const part = pipeN++ === 0 && !whole ? rest.slice(0, 20) : rest;
      return new Response(body(part.map((b) => `${b}\n\n`).join('')), { headers: { 'content-type': 'text/event-stream', 'x-taifoon-viewer': init?.headers?.['x-api-key'] ? 'key' : 'public; session 120s' } });
    }
    if (u.pathname === '/v1/stream') return new Response(body(lanes), { headers: { 'content-type': 'text/event-stream' } });
    if (u.pathname === '/v1/owners') return new Response(JSON.stringify({ ok: true, records: OWNERS }), { headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/v1/access/key') return new Response(JSON.stringify(init?.headers?.['x-api-key'] === 'tfr_paid_key' ? { ok: true, keys: [{ key: { prefix: 'tfr_paid_' }, tier: 'paid' }] } : { ok: false }), { status: init?.headers?.['x-api-key'] === 'tfr_paid_key' ? 200 : 401, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/v1/root/chains') return new Response(JSON.stringify({ chains: [{ chain_id: 8453, network_name: 'Base', latest_block: 52690300 + pipeN, mini_mmr_root: '0xabc', last_header_age_secs: 2, rate_per_sec: 0.5, status: 'collecting' }] }), { headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 404 });
  };
  return { fetch, calls };
}
const run = async (argv, { tty = false, l = layer() } = {}) => {
  const out = sink(tty); const err = sink(false);
  const env = { TAIFOON_LAYER: 'https://coord.test', HOME: '/nonexistent', TAIFOON_CONFIG_DIR: '/nonexistent/x' };
  const code = await main(argv, { out, err, env, fetch: l.fetch, cfg: { profiles: {} }, exec: () => ({ status: 1, stdout: '' }), noShell: true });
  return { code, out: out.buf, err: err.buf, calls: l.calls };
};

test('off a terminal: NDJSON, the pipe by default, keyless, every event once', async () => {
  const r = await run(['stream', '--limit', String(blocks.length)]);
  assert.equal(r.code, 0);
  const lines = r.out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, blocks.length);
  assert.deepEqual(lines.map((l) => l.data.seq), blocks.map(seqOf));
  assert.ok(r.calls.filter((c) => c.url.includes('/v1/pipe/stream')).every((c) => c.key === null));
  assert.ok(r.calls.some((c) => c.url === 'https://coord.test/v1/owners' && c.key === null)); // the masters, keyless
  assert.ok(!r.calls.some((c) => c.url.includes('/v1/access/key'))); // keyless: no standing read
});

test('a session that ends resumes from the last seq + 1 (LaserStream rule)', async () => {
  const seen = []; const ac = new AbortController(); const l = layer();
  const res = await follow({ fetchImpl: l.fetch, base: 'https://coord.test', path: (last) => `/v1/pipe/stream${last !== null ? `?from_seq=${last + 1}` : ''}`, key: null, signal: ac.signal, wait: 1, cap: 2,
    on: { event: (ev) => { seen.push(ev.data.seq); return seen.length < blocks.length; }, state() {} } });
  assert.equal(res.reason, 'limit');
  assert.equal(l.calls[1].url, `https://coord.test/v1/pipe/stream?from_seq=${seqOf(blocks[19]) + 1}`);
  assert.deepEqual(seen, blocks.map(seqOf)); // no gap, no repeat
});

test('a 502 retries on the fixed rule and the stream resumes; 401/403/404/410 are final', async () => {
  let n = 0; const l = layer();
  const flaky = async (url, init) => (n++ === 0 ? new Response('{"code":"pipe_unavailable"}', { status: 502 }) : l.fetch(url, init));
  const seen = []; const res = await follow({ fetchImpl: flaky, base: 'https://coord.test', path: () => '/v1/pipe/stream', key: null, signal: new AbortController().signal, wait: 1, cap: 5,
    on: { event: (ev) => { seen.push(ev.data.seq); return seen.length < 5; }, state() {} } });
  assert.equal(res.reason, 'limit'); assert.equal(seen.length, 5); assert.equal(n, 2);
  for (const st of [401, 403, 404, 410]) {
    const r = await follow({ fetchImpl: async () => new Response('{"error":"no"}', { status: st }), base: '', path: () => '/', key: null, signal: new AbortController().signal, wait: 1, cap: 3, on: { event() {}, state() {} } });
    assert.match(r.reason, new RegExp(`^refused: ${st}`));
  }
});

test('a refusal is final; a run of empty sessions gives up at the cap', async () => {
  const refused = await follow({ fetchImpl: async () => new Response('{"error":"bad key"}', { status: 401 }), base: '', path: () => '/v1/pipe/stream', key: 'x', signal: new AbortController().signal, wait: 1, cap: 3, on: { event() {}, state() {} } });
  assert.match(refused.reason, /^refused: 401 bad key/);
  let n = 0;
  const empty = await follow({ fetchImpl: async () => { n++; return new Response(body(''), { headers: { 'content-type': 'text/event-stream' } }); }, base: '', path: () => '/', key: null, signal: new AbortController().signal, wait: 1, cap: 3, on: { event() {}, state() {} } });
  assert.match(empty.reason, /gave up after 3/); assert.equal(n, 3);
});

test('on a terminal: aligned, coloured rows and the live footer; the transcript snapshot', async () => {
  const r = await run(['stream', '--limit', '12'], { tty: true });
  assert.equal(r.code, 0);
  assert.match(r.out, /\u001b\[3\dm/);
  const rows = strip(r.out).split('\n').map((l) => l.split('\r').pop()).filter((l) => /^\d\d:\d\d:\d\d  /.test(l));
  assert.equal(rows.length, 12);
  assert.ok(rows.every((l) => /^\d\d:\d\d:\d\d  (observe|advert|lost|batch) +\S/.test(l)));
  assert.ok(!/unrecognised|\{"/.test(rows.join('\n')));
  assert.match(strip(r.out), /● live +· +[0-9.]+\/s · [▁▂▃▄▅▆▇█·]+ · +12 events · seq [0-9,]+ · GRID [0-9.]+\/s · signed \d+% · lost \d+% · public; session 120s/);
  assert.match(strip(r.out), /⌁ order .* · genome 0x[0-9a-f]{4}…[0-9a-f]{4} .*buy access: the Taifoon package/); // public: elided + the hint
  assert.match(strip(r.out), /⚑ taifoon ○/); // the master column from the register
  assert.match(r.err, /^12 event\(s\): observe \d+/);
  const snap = new URL('./snapshots/stream-live-tty.txt', import.meta.url);
  const text = rows.map((l) => l.slice(10)).join('\n') + '\n'; // without the clock (local time zone)
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(snap)) writeFileSync(snap, text);
  assert.equal(text, readFileSync(snap, 'utf8'));
});

test('a paid key sees whole ids and no buy hint; --short cuts them again as a display preference', async () => {
  const r = await run(['stream', '--limit', '3', '--key', 'tfr_paid_key'], { tty: true });
  const txt = strip(r.out);
  assert.match(txt, /tx 0x[0-9a-f]{64} · block/); assert.doesNotMatch(txt, /buy access/); assert.match(txt, /genome 0x[0-9a-f]{64}/); assert.match(txt, /key · entitled/);
  const s = await run(['stream', '--limit', '3', '--key', 'tfr_paid_key', '--short'], { tty: true });
  assert.match(strip(s.out), /tx 0x[0-9a-f]{4}…[0-9a-f]{4} · block/); assert.doesNotMatch(strip(s.out), /buy access/);
});

test('--stats draws the measures panel; --masters prints the components × master × seat table; --headers adds header rows', async () => {
  const r = await run(['stream', '--limit', '20', '--stats', '--masters', '--headers', 'all'], { tty: true });
  const txt = strip(r.out);
  assert.match(txt, /measures +[0-9.]+\/s over 10 s/); assert.match(txt, /chain +10 s +1 min +GRID\/s +p50 +p95/);
  assert.match(txt, /component +events +master +seat +shares/); assert.match(txt, /protocol:across_v3 .*taifoon .*held by operator · claimable/);
  const h = await run(['stream', '--for', '1', '--headers', 'all']);
  assert.ok(h.out.trim().split('\n').map((l) => JSON.parse(l)).some((l) => l.event === 'header' && l.data.chain_id === 8453 && l.data.latest_block > 0));
});

test('--no-color and NO_COLOR keep the view plain', async () => {
  const r = await run(['stream', '--limit', '3', '--no-color'], { tty: true });
  assert.doesNotMatch(r.out, /\u001b\[3\dm/);
});

test('filters: --chain, --protocol, --kind, --actor', async () => {
  const r = await run(['stream', '--chain', 'base', '--protocol', 'across_v3', '--for', '1'], { l: layer({ whole: true }) });
  const lines = r.out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => l.data.observed.protocol === 'across_v3' && l.data.observed.chain_id === 8453));
  const lost = await run(['stream', '--kind', 'lost', '--for', '1'], { l: layer({ whole: true }) });
  assert.ok(lost.out.trim());
  assert.ok(lost.out.trim().split('\n').every((l) => JSON.parse(l).data.kind === 'lost'));
  const F = filtersOf({ actor: 'twigster-example' });
  assert.ok(blocks.some((b) => { const d = JSON.parse(b.split('\n').find((x) => x.startsWith('data: ')).slice(6)); return passes({ event: 'envelope', data: d }, F); }));
});

test('--all merges the coord lanes into the same view', async () => {
  const lanes = 'event: hello\ndata: {"lanes":["job","action"]}\n\nevent: job\nid: #job:8453:81875:66\ndata: {"id":"81875","chainId":8453,"state":null,"ending":"Settled"}\n\n';
  const r = await run(['stream', '--all', '--for', '1'], { l: layer({ lanes }) });
  const lines = r.out.trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.event === 'job' && l.data.id === '81875'));
  assert.ok(lines.some((l) => l.data?.observed));
  assert.ok(r.calls.some((c) => c.url === 'https://coord.test/v1/stream?lanes=job,action,flow,root,jev,pool,quota'));
});

test('--raw is the old one-line output', async () => {
  const r = await run(['stream', '--raw', '--limit', '2']);
  assert.match(r.out, /^  envelope \{"filters"/);
});

// _AGREEMENT_CHECK_v1_: the inline check runs the vendored generated checker (one rule) on every hit
test('agreementChecker: ok, refused with the reason, missing on a commerce kind or lane, silent on infrastructure; elided views check the same', async () => {
  const { agreementChecker } = await import('../src/stream-live.mjs');
  const m = await import('../vendor/resale/runtime/coord-lang/agreement.mjs');
  const { readFileSync } = await import('node:fs');
  const V = JSON.parse(readFileSync(new URL('../vendor/resale/runtime/coord-lang/agreement.json', import.meta.url), 'utf8'));
  const check = agreementChecker(m);
  for (const c of V.cases) {
    const got = check({ event: 'job', data: { lane: 'job', agreement: c.agreement } });
    assert.equal(got.state, c.ok ? 'ok' : 'invalid', c.name);
    if (c.ok) assert.equal(check({ event: 'job', data: { lane: 'job', agreement: c.view } }).state, 'ok', `${c.name} (elided view)`);
  }
  assert.equal(check({ event: 'job', data: { lane: 'job', venue: 'erc8183' } }).state, 'missing');
  assert.match(check({ event: 'envelope', data: { envelope: { kind: 'hire' } } }).reason, /a hire envelope \(fire\) carries envelope\.agreement/);
  assert.equal(check({ event: 'envelope', data: { envelope: { kind: 'ack' } } }), null);
  assert.equal(check({ event: 'root', data: { lane: 'root' } }), null);
  assert.equal(check({ event: 'jev', data: { lane: 'jev' } }).state, 'missing');
});
