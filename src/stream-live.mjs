// _STREAM_LIVE_v2_ — `taifoon stream` (also `stream live`, `stream subscribe`): the live view of the coordination layer.
// The pipe (GET /v1/pipe/stream, server-sent events) is the default: keyless it shows the public kinds in short sessions; with a key,
// your own envelopes too. --all adds the coord stream's lanes (GET /v1/stream: job, action, flow, root, jev, pool, quota) into the same
// view; --headers adds the block headers as they are collected per chain (GET /v1/root/chains every 10 s). Rendering, filters,
// measures and the masters column are @taifoon/term/stream, the same view `taifoon-sdk coord stream` uses.
//
// What the viewer sees is the key's entitlement (_ELISION_RULE_v1_, term/stream): a key that bought the package (GET /v1/access/key:
// tier paid or plan) sees whole ids, the whole genome and, with --seal-key-file, sealed bodies opened; a public viewer or a free key
// sees ids elided with a buy hint. --short / --wide are display preferences on top.
//
// Reconnect is LaserStream's rule, the one the SDK's StreamApi.pipe() keeps: a FIXED 5 s wait, at most 240 attempts in a row, the count
// resets on progress, resume from the last seq + 1; only a refusal of the caller (401/403/404/410) is final; a 5xx or a drop retries.
import { createStreamView, filtersOf, passes, mastersOf, mastersTable, entitlementOf, elided, streamPalette } from '@taifoon/term/stream';
import { colorOn } from '@taifoon/term';
export { filtersOf, passes }; // the one filter (term/stream), the SDK's coord stream uses it too

export const RECONNECT_MS = 5000; export const RECONNECT_CAP = 240;
/** the statuses that end a stream for good; everything else (5xx, 429, a dropped connection) retries on the fixed rule */
export const FINAL = new Set([401, 403, 404, 410]);
export const RECONNECT_RULE = 'laserstream:fixed_ms=5000:cap=240:reset_on_progress:resume_last_seq_plus_1:refusal_final';
export const LANES = ['job', 'action', 'flow', 'root', 'jev', 'pool', 'quota'];
export const HEADERS_EVERY_MS = 10_000;
export const FLAGS = ['chain', 'venue', 'kind', 'protocol', 'actor', 'from-seq', 'from_seq', 'for', 'limit', 'lanes', 'kinds', 'venues', 'chains', 'order_keys', 'commitment', 'headers', 'seal-key-file'];

const list = (v) => (typeof v === 'string' && v ? v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : []);

/** Server-sent events → { event, id, data } (data parsed when it is JSON). */
async function* sse(body, signal) {
  const reader = body.getReader(); const td = new TextDecoder(); let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read(); if (done) return;
      buf += td.decode(value, { stream: true }).replace(/\r\n/g, '\n'); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const lines = block.split('\n');
        const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const id = lines.find((l) => l.startsWith('id:'))?.slice(3).trim();
        const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
        yield { event, ...(id ? { id } : {}), data: parsed };
      }
    }
  } finally { try { reader.releaseLock(); } catch { /* aborted */ } }
}

const sleep = (ms, signal) => new Promise((res) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

/**
 * Follow one SSE source with the reconnect rule. `pathOf(lastSeq)` builds the path (the pipe resumes from_seq; the coord stream has
 * no seq). Calls on.event / on.state; returns { code, reason } when it ends (abort, refusal, or the attempts run out).
 */
export async function follow({ fetchImpl, base, path: pathOf, key, signal, on, wait = RECONNECT_MS, cap = RECONNECT_CAP }) {
  let lastSeq = null; let attempts = 0; const atSeq = new Set();
  for (;;) {
    if (signal.aborted) return { code: 0, reason: 'stopped' };
    let r;
    try { r = await fetchImpl(base + pathOf(lastSeq), { headers: { accept: 'text/event-stream', ...(key ? { 'x-api-key': key } : {}) }, signal }); }
    catch (e) { if (signal.aborted) return { code: 0, reason: 'stopped' }; r = { ok: false, status: 0, error: e?.message ?? String(e) }; }
    if (r.ok && r.body) {
      on.state('live', r.headers?.get?.('x-taifoon-viewer') ?? (key ? 'key' : 'public'));
      let progressed = false;
      try {
        for await (const ev of sse(r.body, signal)) {
          const seq = typeof ev.data?.seq === 'number' ? ev.data.seq : ev.id && /^\d+$/.test(ev.id) ? Number(ev.id) : null;
          // a batch marker carries the seq of the last envelope it folds: one event per (seq, event) pair, never a repeat
          if (seq !== null) {
            if (lastSeq !== null && (seq < lastSeq || (seq === lastSeq && atSeq.has(ev.event)))) continue;
            if (seq !== lastSeq) atSeq.clear();
            lastSeq = seq; atSeq.add(ev.event);
          }
          progressed = true; attempts = 0;
          if (on.event(ev) === false) return { code: 0, reason: 'limit' };
        }
      } catch (e) { if (signal.aborted || e?.name === 'AbortError') return { code: 0, reason: 'stopped' }; }
      if (signal.aborted) return { code: 0, reason: 'stopped' };
      if (!progressed) attempts++;
    } else {
      const j = r.json ? await r.json().catch(() => null) : null;
      const why = `${r.status || 'network'}${j?.error ? ` ${j.error}` : r.error ? ` ${r.error}` : ''}`;
      if (FINAL.has(r.status)) { on.state('closed'); return { code: 1, reason: `refused: ${why}` }; }  // a 5xx, a 429, a drop: retry
      attempts++;
      on.notice?.(`answered ${why}`);
    }
    if (attempts >= cap) { on.state('closed'); return { code: 1, reason: `gave up after ${cap} attempts in a row` }; }
    on.state('reconnecting');
    await sleep(wait, signal);
  }
}

/** GET /v1/owners (keyless) → the masters map, or null when the layer does not answer (the view then shows no master column). */
export async function loadMasters(ctx) {
  try {
    const r = await (ctx.io.fetch ?? globalThis.fetch)(`${ctx.base}/v1/owners`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const j = await r.json(); return r.ok && Array.isArray(j?.records) ? mastersOf(j.records) : null;
  } catch { return null; }
}

/** GET /v1/access/key with the key → the entitlement (_ELISION_RULE_v1_); keyless → the public one. */
export async function loadEntitlement(ctx, key) {
  if (!key) return entitlementOf(null);
  try {
    const r = await (ctx.io.fetch ?? globalThis.fetch)(`${ctx.base}/v1/access/key`, { headers: { accept: 'application/json', 'x-api-key': key }, signal: AbortSignal.timeout(8000) });
    const j = await r.json(); return entitlementOf(r.ok ? j : { keys: [{ tier: 'free' }] });
  } catch { return entitlementOf({ keys: [{ tier: 'free' }] }); }
}

/** the sealed-body opener for an entitled viewer with --seal-key-file (the vendored HPKE opener; the key is read once, never printed) */
async function openerOf(ctx, file) {
  if (!file) return null;
  const { readFileSync } = await import('node:fs');
  const sk = readFileSync(file, 'utf8').trim();
  const { openEnvelope, isSealed } = await import('../vendor/resale/runtime/pipe-sealed.mjs');
  const cache = new Map();
  return (ev) => {
    const e = ev?.data?.envelope; if (!e || typeof e.payload !== 'string' || !isSealed(e.payload)) return null;
    if (cache.has(e.id)) return cache.get(e.id);
    cache.set(e.id, 'opening…');
    openEnvelope(e, sk).then((pt) => { const text = new TextDecoder().decode(pt); cache.set(e.id, text); }).catch((err) => cache.set(e.id, `cannot open: ${err?.message ?? err}`));
    return null;
  };
}

/** The command. Exit code 0 on ctrl-c, --for or --limit; 1 when refused or the attempts run out. */
export async function streamLive(ctx, { wait, cap, headersEveryMs = HEADERS_EVERY_MS } = {}) {
  const f = ctx.f; const out = ctx.out; const env = ctx.env;
  const tty = !!out.isTTY && !ctx.json && !f.raw;
  const color = f['no-color'] ? false : colorOn(out, env);
  const key = ctx.key();
  const fetchImpl = ctx.io.fetch ?? globalThis.fetch;
  const [masters, entitlement] = await Promise.all([f['no-masters'] ? null : loadMasters(ctx), loadEntitlement(ctx, key)]);
  const opened = entitlement.entitled && typeof f['seal-key-file'] === 'string' ? await openerOf(ctx, f['seal-key-file']) : null;
  const view = f.raw ? null : createStreamView({ out, tty, color, short: !!f.short, wide: !!f.wide, genome: !f['no-genome'], masters, stats: !!f.stats, json: !tty, entitlement, opened });
  const F = filtersOf(f);
  const limit = Number(f.limit) || Infinity; const forS = Number(f.for) || 0;
  const ac = new AbortController();
  const onSig = () => ac.abort(); process.once('SIGINT', onSig);
  const onResize = () => view?.resize(out.columns); if (tty && typeof out.on === 'function') out.on('resize', onResize);
  const timer = forS ? setTimeout(() => ac.abort(), forS * 1000) : null; timer?.unref?.();
  const tick = view ? setInterval(() => view.tick(), 1000) : null; tick?.unref?.();
  let n = 0; const kinds = new Map();
  const fromSeq = f['from-seq'] ?? f.from_seq;
  const states = new Map();
  const on = (src) => ({
    event(ev) {
      if (ev.event === 'hello' && src === 'lanes' && !f.raw && tty) return true;
      if (!passes(ev, F)) return true;
      n++; const k = String(ev.data?.envelope?.kind || ev.data?.lane || ev.data?.kind || ev.event); kinds.set(k, (kinds.get(k) ?? 0) + 1);
      if (f.raw) out.write(`  ${ev.event} ${typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data)}\n`);
      else view.event(ev);
      if (n >= limit) { ac.abort(); return false; }
      return true;
    },
    state(s, viewer) {
      states.set(src, s);
      const merged = [...states.values()].includes('live') ? 'live' : [...states.values()].includes('reconnecting') ? 'reconnecting' : s;
      view?.state(merged, viewer !== undefined ? `${viewer}${entitlement.entitled ? ' · entitled' : ''}` : undefined);
    },
    notice(msg) { if (!tty) ctx.err.write(`${src}: ${msg}; retrying in ${(wait ?? RECONNECT_MS) / 1000} s\n`); },
  });
  const pipePath = (last) => {
    const q = new URLSearchParams();
    const from = last !== null ? last + 1 : fromSeq !== undefined && fromSeq !== true ? Number(fromSeq) : null;
    if (from !== null && Number.isFinite(from)) q.set('from_seq', String(from));
    if (typeof f.commitment === 'string') q.set('commitment', f.commitment);
    return `/v1/pipe/stream${q.size ? `?${q}` : ''}`;
  };
  const lanes = typeof f.lanes === 'string' ? list(f.lanes) : f.all ? LANES : [];
  const sources = [follow({ fetchImpl, base: ctx.base, path: pipePath, key, signal: ac.signal, on: on('pipe'), wait, cap })];
  if (lanes.length) sources.push(follow({ fetchImpl, base: ctx.base, path: () => `/v1/stream?lanes=${lanes.join(',')}`, key, signal: ac.signal, on: on('lanes'), wait, cap }));
  // --headers: the block headers as collected per chain (GET /v1/root/chains): a row whenever a chain's head moved; --headers=all
  // includes every collected chain, the default only the chains the stream named or --chain asked for
  if (f.headers && view) sources.push((async () => {
    const seenHeads = new Map(); const all = f.headers === 'all';
    while (!ac.signal.aborted) {
      try {
        const r = await fetchImpl(`${ctx.base}/v1/root/chains`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        for (const c of j?.chains ?? []) {
          const name = String(c.network_name ?? '').toLowerCase();
          const wanted = all || F.chain.some((x) => x === name || x === String(c.chain_id)) || view.components().some((x) => x.component === `chain:${c.chain_id}`);
          if (!wanted) continue;
          if (seenHeads.get(c.chain_id) === c.latest_block) continue;
          seenHeads.set(c.chain_id, c.latest_block);
          view.header({ chain_id: c.chain_id, network_name: c.network_name, latest_block: c.latest_block, mini_mmr_root: c.mini_mmr_root, last_header_age_secs: c.last_header_age_secs, rate_per_sec: c.rate_per_sec, status: c.status, blocks_in_tree: c.blocks_in_tree });
        }
      } catch { /* the next pass tries again */ }
      await sleep(headersEveryMs, ac.signal);
    }
    return { code: 0, reason: 'stopped' };
  })());
  view?.state('connecting', key ? 'key' : 'public');
  const results = await Promise.all(sources);
  clearInterval(tick); if (timer) clearTimeout(timer); process.removeListener('SIGINT', onSig); if (tty && typeof out.off === 'function') out.off('resize', onResize);
  view?.close();
  const bad = results.find((r) => r.code);
  if (view && f.masters) {
    const p = streamPalette(!!(tty && color));
    out.write(`\n${mastersTable(view.components(), p).join('\n')}\n`);
    out.write(`${p.dim(`  ○ seat held by the operator, claimable (taifoon owners claim <id> --proof …) · ● claimed · ◆ ours · — no record`)}\n`);
  }
  if (tty || f.raw) {
    const ks = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
    const snap = view?.measures.snapshot();
    ctx.err.write(`${n} event(s)${ks ? `: ${ks}` : ''}${snap ? ` · ${snap.rate60.toFixed(2)}/s over the last minute · GRID ${(snap.grid60 / 1000).toFixed(3)}/s · signed ${Math.round(snap.signed_share * 100)}% · lost ${Math.round(snap.lost_share * 100)}%` : ''}${entitlement.entitled ? '' : ` · viewing as ${entitlement.via}: ids elided — ${entitlement.product.name} (${entitlement.product.buy}) opens them`}${bad ? ` · ${bad.reason}` : ''}\n`);
  } else if (bad) ctx.err.write(`${bad.reason}\n`);
  return bad && n === 0 ? 1 : 0;
}
