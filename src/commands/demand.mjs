// taifoon demand — the buyer's side of automatic matching (_CLI_DEMAND_v1_, launch round 5). Say what you need; the layer's
// auto-match loop picks the seller, hires it, grades the reply by code (no Jev) and settles it on the devnet 36927.
//   demand post "<need>" [--dry-run]        POST /v1/demands { need }: the words map to a job class by the layer's own rules
//                                           (no model); unresolved words answer with the candidates, resend with --class
//   demand post --class <id> --input '{…}'  a class and its input instead of words
//   demand status <dm_…> [--watch [s]]      GET /v1/demands/:id: every step the loop wrote; --watch re-reads until it ends
//   demand ls [--state s] [--limit n]       GET /v1/demands: newest first
// Every call is one /v1 call (metered). Your key rides along when you are logged in; without one you post as a visitor
// (3 a minute, 20 a day). Nothing here signs or sends a transaction: the loop's devnet keys do, on the devnet only.
import { clip, kv, pill, rule, table } from '../brand.mjs';

export const DEMAND_ID = /^dm_[0-9a-f]{24}$/;
export const STATES = ['open', 'claimed', 'matched', 'hired', 'graded', 'settling', 'settled', 'unmatched', 'failed', 'cancelled'];
export const ENDED = new Set(['settled', 'unmatched', 'failed', 'cancelled']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The request body `demand post` sends. Pure: flags + words → body, or an error string. */
export function postBody(words, f) {
  const need = words.join(' ').trim();
  const body = {};
  if (f.class !== undefined) {
    if (typeof f.class !== 'string' || !f.class) return { error: '--class needs a class id (taifoon demand ls lists the classes)' };
    body.class = f.class;
  }
  if (f.input !== undefined) {
    let input;
    try { input = JSON.parse(String(f.input)); } catch { return { error: '--input is a JSON object, e.g. --input \'{"algorithm":"sha256","text":"hello"}\'' }; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: '--input is a JSON object' };
    body.input = input;
  }
  if (need) body.need = need;
  if (!body.need && !body.class) return { error: 'usage: taifoon demand post "<what you need, in words>" [--dry-run] · or --class <id> --input \'{…}\'' };
  if (f['price-units'] !== undefined) body.price_units = String(f['price-units']);
  if (typeof f.label === 'string') body.buyer_label = f.label;
  if (f['dry-run'] === true) body.dry_run = true;
  return { body };
}

/** One demand row, as the lines a person reads. Pure. */
export function demandLines(p, d) {
  const e = d.ending ?? {};
  return kv(p, [
    ['demand', `${p.ink(d.id)} ${pill(p, d.state)}`],
    ['class', `${p.accent(d.class)} ${p.faint(clip(JSON.stringify(d.input ?? {}), 70))}`],
    d.need ? ['need', p.muted(clip(d.need, 90))] : null,
    ['price', p.muted(`${d.price_units} units dUSDC · chain ${d.chainId}`)],
    ['seller', d.seller ? p.ink(d.seller) : null],
    ['handshake', d.handshake_id ? p.ink(d.handshake_id) : null],
    ['grade', d.grade ? `${pill(p, d.grade.verdict === 'pass' ? 'ok pass' : String(d.grade.verdict))} ${p.faint(`judge_called ${d.grade.judge_called === true}`)}` : null],
    ['job', d.job_id ? p.ink(d.job_id) : null],
    ['ending', d.ending ? `${p.ink(e.transition ?? '—')} ${e.tx ? p.ink(e.tx) : ''}` : null],
  ]);
}

/** The cover preview a dry run carries (_COVER_PREVIEW_v1_): which pool would cover the job and at what premium, as the
 *  layer quoted it (POST /v1/pools/quote). Copied, never computed here. Pure. */
export function coverLines(p, c, priceUnits, width = 100) {
  const out = ['', `  ${p.faint('cover preview · quote only (POST /v1/pools/quote)')}`];
  if (c.unread) { out.push(`  ${p.miss('unread')} ${p.muted(clip(c.why ?? '', width - 12))}`); return out; }
  const ratio = typeof c.premium_ratio === 'number' ? ` (${(c.premium_ratio * 100).toFixed(1)} % of the price)` : '';
  out.push(kv(p, [
    ['pool', c.pool ? `${p.ink(c.pool)} ${pill(p, 'covered')}` : `${p.muted('none')} ${pill(p, 'deposit-only')}`],
    ['premium', c.premium === null || c.premium === undefined ? p.muted('—') : p.ink(`${c.premium} units${ratio}${c.premium_label ? ` · ${c.premium_label}` : ''}`)],
    ['deposit', c.deposit ? p.ink(`${c.deposit} units (${c.deposit_rung ?? '—'}) for a price of ${priceUnits ?? '—'}`) : p.muted('—')],
    ['seller', p.muted(`${c.seller_of_record} (the loop's seller of record)`)],
    ...(c.why ?? []).slice(0, 3).map((w) => ['why', p.faint(clip(w, width - 20))]),
    ['settles', p.faint(clip(c.settles_with ?? '', width - 20))],
  ]));
  return out;
}

async function post(ctx, words) {
  const { p } = ctx;
  const b = postBody(words, ctx.f);
  if (b.error) { ctx.fail(b.error); return 2; }
  const r = await ctx.post('/v1/demands', b.body, { timeoutMs: 30_000 });
  const j = r.json ?? {};
  if (ctx.json) { ctx.emit({ ok: r.ok, status: r.status, ...j }); return r.ok ? 0 : 1; }
  if (!r.ok) {
    ctx.fail(`demands: ${j.error ?? r.error ?? r.status}${j.code ? ` (${j.code})` : ''}`);
    for (const c of j.candidates ?? []) ctx.line(`  ${p.accent(String(c.class).padEnd(24))} ${p.faint(clip(c.missing?.length ? `needs ${c.missing.join(', ')}` : c.needs ?? c.title ?? '', ctx.width - 30))}${c.example ? `\n  ${' '.repeat(24)} ${p.muted(`e.g. ${clip(c.example, ctx.width - 32)}`)}` : ''}`);
    for (const x of j.problems ?? []) ctx.line(`  ${p.miss('✗')} ${p.muted(x)}`);
    if (j.candidates?.length) ctx.line(`\n  ${p.faint('resend with --class <id> (and --input \'{…}\' when a field is missing)')}`);
    return 1;
  }
  if (j.dry_run) {
    ctx.line(rule(p, 'demand · dry run (nothing kept)'));
    ctx.line(kv(p, [['class', p.accent(j.class)], ['input', p.ink(clip(JSON.stringify(j.input), ctx.width - 20))], j.resolved ? ['how', p.faint(clip(j.resolved.how ?? '', ctx.width - 20))] : null]));
    if (j.cover_preview) for (const l of coverLines(p, j.cover_preview, j.price_units, ctx.width)) ctx.line(l);
    ctx.line(`\n  ${p.faint(`POST /v1/demands · ${r.ms} ms · post it: the same line without --dry-run`)}`);
    return 0;
  }
  ctx.line(rule(p, 'demand · posted'));
  ctx.line(demandLines(p, j.demand));
  ctx.line(`\n  ${p.faint(`POST /v1/demands · ${r.ms} ms · the auto-match loop takes open demands every few minutes`)}`);
  ctx.line(`  ${p.accent(`taifoon demand status ${j.demand.id} --watch`)}`);
  return 0;
}

async function status(ctx, [id]) {
  const { p } = ctx;
  if (!DEMAND_ID.test(String(id ?? ''))) { ctx.fail('usage: taifoon demand status <dm_ + 24 hex> [--watch [seconds]]'); return 2; }
  const w = ctx.f.watch === undefined ? 0 : Number(ctx.f.watch);
  const every = ctx.f.watch === undefined ? 0 : Number.isFinite(w) && w >= 5 ? w : 30;
  const until = ctx.now() + Number(ctx.f.timeout ?? 1800) * 1000;
  let last = null;
  for (;;) {
    const r = await ctx.get(`/v1/demands/${id}`, { key: false, quiet: every > 0 });
    if (!r.ok) { if (ctx.json) ctx.emit({ ok: false, status: r.status, ...(r.json ?? {}) }); else ctx.fail(`demands/${id}: ${r.json?.error ?? r.error ?? r.status}`); return 1; }
    const d = r.json.demand;
    if (!every) {
      if (ctx.json) { ctx.emit({ ok: true, demand: d, ended: ENDED.has(d.state) }); return 0; }
      ctx.line(rule(p, `demand ${d.id}`));
      ctx.line(demandLines(p, d));
      ctx.line('');
      ctx.line(table(p, [{ key: 'at', title: 'at', fmt: (v) => p.faint(String(v).slice(11, 19)) }, { key: 'state', title: 'step', fmt: (v) => pill(p, v) }, { key: 'by', title: 'by', fmt: (v) => p.muted(v) }, { key: 'note', title: 'note', flex: true, fmt: (v) => p.faint(v ?? '') }], d.events ?? []));
      ctx.line(`\n  ${p.faint(`GET /v1/demands/${d.id} · ${r.ms} ms`)}`);
      return 0;
    }
    if (d.state !== last) {
      last = d.state;
      if (!ctx.json) ctx.line(`  ${p.faint(new Date(ctx.now()).toISOString().slice(11, 19))} ${pill(p, d.state)} ${p.faint(clip(d.events?.at(-1)?.note ?? '', ctx.width - 30))}`);
    }
    if (ENDED.has(d.state) || ctx.now() >= until) {
      if (ctx.json) { ctx.emit({ ok: true, demand: d, ended: ENDED.has(d.state), watched: true }); return ENDED.has(d.state) ? 0 : 1; }
      ctx.line('');
      ctx.line(demandLines(p, d));
      if (!ENDED.has(d.state)) { ctx.fail(`still ${d.state} after --timeout; read it again later`); return 1; }
      return d.state === 'settled' ? 0 : 1;
    }
    await (ctx.io.sleep ?? sleep)(every * 1000);
  }
}

async function ls(ctx) {
  const { p } = ctx;
  const state = ctx.f.state === undefined ? null : String(ctx.f.state);
  if (state && !STATES.includes(state)) { ctx.fail(`--state is one of ${STATES.join(', ')}`); return 2; }
  const limit = Math.min(200, Math.max(1, Number(ctx.f.limit ?? 20) || 20));
  const r = await ctx.get(`/v1/demands?${state ? `state=${state}&` : ''}limit=${limit}`, { key: false });
  if (!r.ok) { if (ctx.json) ctx.emit({ ok: false, status: r.status, ...(r.json ?? {}) }); else ctx.fail(`demands: ${r.json?.error ?? r.error ?? r.status}`); return 1; }
  const rows = r.json.demands ?? [];
  if (ctx.json) { ctx.emit({ ok: true, state, count: rows.length, demands: rows, classes: r.json.classes ?? [] }); return 0; }
  ctx.line(rule(p, `demands${state ? ` · ${state}` : ''} · ${rows.length}, newest first`));
  ctx.line(table(p, [
    { key: 'id', title: 'demand', fmt: (v) => p.ink(v) },
    { key: 'state', title: 'state', fmt: (v) => pill(p, v) },
    { key: 'class', title: 'class', fmt: (v) => p.accent(v) },
    { key: 'created_at', title: 'posted', fmt: (v) => p.faint(String(v).slice(0, 16).replace('T', ' ')) },
    { key: 'seller', title: 'seller', flex: true, fmt: (v) => p.muted(v ?? '') },
  ], rows));
  ctx.line(`\n  ${p.faint(`classes: ${(r.json.classes ?? []).join(', ')}`)}`);
  ctx.line(`  ${p.faint(`GET /v1/demands · ${r.ms} ms · taifoon demand post "<need>" · status <id>`)}`);
  return 0;
}

export default {
  name: 'demand',
  summary: 'say what you need: the layer matches a seller, hires it, grades by code and settles it (devnet 36927)',
  usage: [
    ['demand post "<need>" [--dry-run] [--label name] [--price-units n]', 'POST /v1/demands: the words map to a class by the layer’s rules; --dry-run keeps nothing and shows which pool would cover it and at what premium (quote only)'],
    ['demand post --class <id> --input \'{…}\'', 'a class and its input instead of words'],
    ['demand status <dm_…> [--watch [seconds]] [--timeout s]', 'every step the auto-match loop wrote; --watch re-reads until it ends'],
    ['demand ls [--state open|settled|…] [--limit n]', 'demands, newest first, and the classes a demand may name'],
  ],
  subs: ['post', 'status', 'ls'],
  valued: ['class', 'input', 'label', 'price-units', 'watch', 'timeout', 'state', 'limit'],
  async run(ctx, [sub = 'ls', ...rest]) {
    if (sub === 'post') return post(ctx, rest);
    if (sub === 'status') return status(ctx, rest);
    if (sub === 'ls' || sub === 'list') return ls(ctx);
    ctx.fail(`unknown: demand ${sub} · taifoon help demand`); return 2;
  },
};
