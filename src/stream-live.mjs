// _STREAM_LIVE_v1_ — `taifoon stream` (also `stream live`, `stream subscribe`): the live view of the coordination layer.
// The pipe (GET /v1/pipe/stream, server-sent events) is the default: keyless it shows the public kinds (observe, batch, advert, lost,
// dropped) in short sessions; with a key, your own envelopes too. --all adds the coord stream's lanes (GET /v1/stream: job, action,
// flow, root, jev, pool, quota) into the same view. Rendering is @taifoon/term/stream, the same view `taifoon-sdk coord stream` uses.
// Reconnect is LaserStream's rule, the one the SDK's StreamApi.pipe() keeps: a FIXED 5 s wait, at most 240 attempts in a row, the count
// resets on progress, resume from the last seq + 1, a refusal (400/401/403/404) is final.
import { createStreamView, chainName } from '@taifoon/term/stream';
import { colorOn } from '@taifoon/term';

export const RECONNECT_MS = 5000; export const RECONNECT_CAP = 240;
export const RECONNECT_RULE = 'laserstream:fixed_ms=5000:cap=240:reset_on_progress:resume_last_seq_plus_1:refusal_final';
export const LANES = ['job', 'action', 'flow', 'root', 'jev', 'pool', 'quota'];
export const FLAGS = ['chain', 'venue', 'kind', 'protocol', 'actor', 'from-seq', 'from_seq', 'for', 'limit', 'lanes', 'kinds', 'venues', 'chains', 'order_keys', 'commitment'];

const list = (v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : []);

/** The filters from the flags (each accepts a comma list). Pure. */
export function filtersOf(f) {
  return {
    kind: [...list(f.kind), ...list(f.kinds)],
    chain: [...list(f.chain), ...list(f.chains)].map((c) => chainName(c).toLowerCase()),
    venue: [...list(f.venue), ...list(f.venues)],
    protocol: list(f.protocol),
    actor: list(f.actor),
  };
}

/** Does one event pass the filters? Pure; an empty filter passes everything. */
export function passes(ev, F) {
  const d = ev?.data && typeof ev.data === 'object' ? ev.data : {};
  const env = d.envelope ?? {}; const ob = d.observed ?? {};
  const kind = String(env.kind || d.kind || ev.event || '').toLowerCase();
  if (F.kind.length && !F.kind.includes(kind) && !F.kind.includes(String(ev.event).toLowerCase())) return false;
  const chain = chainName(ob.chain_id || env.from?.chain || env.to?.chain || d.chain_id || d.chainId || '').toLowerCase();
  if (F.chain.length && !F.chain.includes(chain)) return false;
  const venues = [env.from?.venue, env.to?.venue, ob.source, d.venue].filter(Boolean).map((s) => String(s).toLowerCase());
  if (F.venue.length && !F.venue.some((v) => venues.includes(v))) return false;
  const protocol = String(ob.protocol || d.leaf?.protocol || env.from?.venue || '').toLowerCase();
  if (F.protocol.length && !F.protocol.some((p) => protocol.includes(p))) return false;
  if (F.actor.length) {
    const hay = [env.from?.agent, env.to?.agent, env.from?.address, env.to?.address, d.address, d.actor, d.client, d.provider, d.seller, d.buyer].filter(Boolean).join(' ').toLowerCase();
    if (!F.actor.some((a) => hay.includes(a))) return false;
  }
  return true;
}

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
      if ([400, 401, 403, 404].includes(r.status)) { on.state('closed'); return { code: 1, reason: `refused: ${why}` }; }
      attempts++;
      on.notice?.(`answered ${why}`);
    }
    if (attempts >= cap) { on.state('closed'); return { code: 1, reason: `gave up after ${cap} attempts in a row` }; }
    on.state('reconnecting');
    await sleep(wait, signal);
  }
}

/** The command. Exit code 0 on ctrl-c, --for or --limit; 1 when refused or the attempts run out. */
export async function streamLive(ctx, { wait, cap } = {}) {
  const f = ctx.f; const out = ctx.out; const env = ctx.env;
  const tty = !!out.isTTY && !ctx.json && !f.raw;
  const color = f['no-color'] ? false : colorOn(out, env);
  const view = f.raw ? null : createStreamView({ out, tty, color, wide: !!f.wide, json: !tty });
  const F = filtersOf(f);
  const limit = Number(f.limit) || Infinity; const forS = Number(f.for) || 0;
  const ac = new AbortController();
  const onSig = () => ac.abort(); process.once('SIGINT', onSig);
  const timer = forS ? setTimeout(() => ac.abort(), forS * 1000) : null; timer?.unref?.();
  const tick = view ? setInterval(() => view.tick(), 1000) : null; tick?.unref?.();
  let n = 0; const kinds = new Map();
  const key = ctx.key();
  const fetchImpl = ctx.io.fetch ?? globalThis.fetch;
  const fromSeq = f['from-seq'] ?? f.from_seq;
  const states = new Map();
  const on = (src) => ({
    event(ev) {
      if (ev.event === 'hello' && src === 'lanes' && !f.raw && tty) return true;
      if (!passes(ev, F)) return true;
      n++; const k = String(ev.data?.envelope?.kind || ev.data?.kind || ev.event); kinds.set(k, (kinds.get(k) ?? 0) + 1);
      if (f.raw) out.write(`  ${ev.event} ${typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data)}\n`);
      else view.event(ev);
      if (n >= limit) { ac.abort(); return false; }
      return true;
    },
    state(s, viewer) {
      states.set(src, s);
      const merged = [...states.values()].includes('live') ? 'live' : [...states.values()].includes('reconnecting') ? 'reconnecting' : s;
      view?.state(merged, viewer);
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
  view?.state('connecting', key ? 'key' : 'public');
  const results = await Promise.all(sources);
  clearInterval(tick); if (timer) clearTimeout(timer); process.removeListener('SIGINT', onSig);
  view?.close();
  const bad = results.find((r) => r.code);
  if (tty || f.raw) {
    const ks = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
    ctx.err.write(`${n} event(s)${ks ? `: ${ks}` : ''}${bad ? ` · ${bad.reason}` : ''}\n`);
  } else if (bad) ctx.err.write(`${bad.reason}\n`);
  return bad && n === 0 ? 1 : 0;
}
