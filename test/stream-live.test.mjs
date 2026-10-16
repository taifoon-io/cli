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
      return new Response(body(part.map((b) => `${b}\n\n`).join('')), { headers: { 'content-type': 'text/event-stream', 'x-taifoon-viewer': 'public; session 120s' } });
    }
    if (u.pathname === '/v1/stream') return new Response(body(lanes), { headers: { 'content-type': 'text/event-stream' } });
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
  assert.ok(r.calls.every((c) => c.url.startsWith('https://coord.test/v1/pipe/stream') && c.key === null));
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
  assert.match(strip(r.out), /● live · [0-9.]+\/s · 12 events · seq [0-9,]+ · public; session 120s/);
  assert.match(r.err, /^12 event\(s\): observe \d+/);
  const snap = new URL('./snapshots/stream-live-tty.txt', import.meta.url);
  const text = rows.map((l) => l.slice(10)).join('\n') + '\n'; // without the clock (local time zone)
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(snap)) writeFileSync(snap, text);
  assert.equal(text, readFileSync(snap, 'utf8'));
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
