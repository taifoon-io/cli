// taifoon catalog — every hireable agent the coordination layer resells, with the seller's price, our routing fee on top, the
// cover a pool gives the hire and one call to buy it (_CLI_CATALOG_v1_, GET /v1/catalog).
//   catalog [--status s] [--class c] [--protocol p] [--q words] [--chain n] [--limit n] [--offset n]   the list, paged
//   catalog <cat_…>                                                                                   one entry
//   catalog --buy <cat_…> --input '{…}' | --need "<words>" [--price-units n] [--label name] [--dry-run]
//                                                    POST /v1/demands { catalog_id, … }: the auto-match loop hires that seller first
// Every call is one /v1 call (metered). Buying signs and sends nothing here: the layer's devnet keys settle on the devnet only.
import { clip, kv, pill, rule, table } from '../brand.mjs';

export const CATALOG_ID = /^cat_[0-9a-f]{16}$/;
export const STATUSES = ['buy_now', 'priced', 'quote_on_request', 'covered', 'openable', 'ready'];

/** The query string of a list call. Pure: flags → `?…`, or an error string. */
export function listQuery(f) {
  const q = new URLSearchParams();
  if (f.status !== undefined) { if (!STATUSES.includes(String(f.status))) return { error: `--status is one of ${STATUSES.join(', ')}` }; q.set('status', String(f.status)); }
  for (const k of ['class', 'protocol', 'q', 'chain']) if (typeof f[k] === 'string' || typeof f[k] === 'number') q.set(k, String(f[k]));
  const limit = f.limit === undefined ? 20 : Number(f.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return { error: '--limit is 1..200' };
  q.set('limit', String(limit));
  if (f.offset !== undefined) { const o = Number(f.offset); if (!Number.isInteger(o) || o < 0) return { error: '--offset is a whole number' }; q.set('offset', String(o)); }
  return { qs: `?${q}` };
}

/** The POST /v1/demands body that buys a catalog entry. Pure. */
export function buyBody(id, f) {
  if (!CATALOG_ID.test(String(id ?? ''))) return { error: 'usage: taifoon catalog --buy <cat_ + 16 hex> --input \'{…}\' | --need "<words>"' };
  const body = { catalog_id: id };
  if (f.input !== undefined) {
    let input; try { input = JSON.parse(String(f.input)); } catch { return { error: '--input is a JSON object (the class input: taifoon catalog <id> shows it)' }; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: '--input is a JSON object' };
    body.input = input;
  }
  if (typeof f.need === 'string' && f.need.trim()) body.need = f.need.trim();
  if (!body.input && !body.need) return { error: 'send --input \'{…}\' (the class input) or --need "<words>"' };
  if (f['price-units'] !== undefined) body.price_units = String(f['price-units']);
  if (typeof f.label === 'string') body.buyer_label = f.label;
  if (f['dry-run'] === true) body.dry_run = true;
  return { body };
}

const usd = (v) => (v === null || v === undefined ? '—' : `${v}`);
/** One entry, as the lines a person reads. Pure. */
export function entryLines(p, e, width = 100) {
  const pr = e.price ?? {}; const a = e.assurance ?? {};
  return kv(p, [
    ['entry', `${p.ink(e.id)} ${pill(p, e.status)}`],
    ['seller', `${p.ink(e.name ?? e.seller ?? '—')} ${p.faint(clip(`${e.protocol ?? ''} ${e.url ?? e.seller ?? ''}`, width - 40))}`],
    e.chain_id ? ['agent', p.muted(`${e.chain_id}:${e.agent_id ?? '—'}${e.owner ? ` · owner ${e.owner}` : ''}`)] : null,
    ['classes', p.accent((e.classes ?? []).join(', ') || '—')],
    (e.skills ?? []).length ? ['skills', p.faint(clip(e.skills.join(', '), width - 20))] : null,
    ['price', pr.seller_usdc === null || pr.seller_usdc === undefined ? p.muted('quote on request')
      : p.ink(`seller ${usd(pr.seller_usdc)} + fee ${usd(pr.fee_usdc)} (${pr.fee_bps} bps) = ${usd(pr.our_usdc)} ${pr.token ?? ''}`)],
    pr.seller_source ? ['price from', p.faint(clip(pr.seller_source, width - 20))] : null,
    ['cover', a.covered ? `${pill(p, 'covered')} ${p.ink(a.pool ?? '')}` : a.pool_openable ? `${pill(p, 'openable')} ${p.faint('POST /v1/pools/open')}` : p.muted('none')],
    ['readiness', `${a.ready ? pill(p, 'ok ready') : p.muted('not yet')} ${p.faint(clip((a.missing ?? []).join('; '), width - 30))}`],
    e.grade ? ['grade', p.faint(clip(`${e.grade.by ?? ''}${e.grade.det ? ` · ${e.grade.det}` : ''}`, width - 20))] : null,
    e.buy ? ['buy', p.accent(clip(`${e.buy.method} ${e.buy.path} ${JSON.stringify(e.buy.body ?? {})}`, width - 20))] : null,
    e.next ? ['next', p.faint(clip(e.next, width - 20))] : null,
  ]);
}

async function list(ctx) {
  const { p } = ctx;
  const q = listQuery(ctx.f);
  if (q.error) { ctx.fail(q.error); return 2; }
  const r = await ctx.get(`/v1/catalog${q.qs}`, { key: false });
  if (!r.ok) { if (ctx.json) ctx.emit({ ok: false, status: r.status, ...(r.json ?? {}) }); else ctx.fail(`catalog: ${r.json?.error ?? r.error ?? r.status}`); return 1; }
  const j = r.json;
  if (ctx.json) { ctx.emit({ ok: true, ...j }); return 0; }
  const c = j.counts ?? {};
  ctx.line(rule(p, `catalog · ${j.matched ?? (j.rows ?? []).length} matched`));
  ctx.line(`  ${p.faint(`listed ${c.listed ?? '—'} · buy now ${c.buy_now ?? '—'} · priced ${c.priced ?? '—'} · covered ${c.covered ?? '—'} · openable ${c.openable ?? '—'} · ready ${c.assurance_ready ?? '—'} · fee ${j.fee?.bps ?? '—'} bps`)}`);
  ctx.line(table(p, [
    { key: 'id', title: 'entry', fmt: (v) => p.ink(v) },
    { key: 'status', title: 'status', fmt: (v) => pill(p, v) },
    { key: 'our', title: 'our price', fmt: (v) => p.ink(v) },
    { key: 'classes', title: 'class', fmt: (v) => p.accent(v) },
    { key: 'name', title: 'seller', flex: true, fmt: (v) => p.muted(v ?? '') },
  ], (j.rows ?? []).map((e) => ({ id: e.id, status: e.status, our: e.price?.our_usdc ?? 'quote', classes: (e.classes ?? [])[0] ?? '—', name: e.name ?? e.seller }))));
  ctx.line(`\n  ${p.faint(`GET /v1/catalog · ${r.ms} ms${j.next_offset != null ? ` · more: --offset ${j.next_offset}` : ''} · one entry: taifoon catalog <id> · buy: --buy <id> --input '{…}'`)}`);
  return 0;
}

async function one(ctx, id) {
  const { p } = ctx;
  const r = await ctx.get(`/v1/catalog/${id}`, { key: false });
  if (!r.ok) { if (ctx.json) ctx.emit({ ok: false, status: r.status, ...(r.json ?? {}) }); else ctx.fail(`catalog/${id}: ${r.json?.error ?? r.error ?? r.status}`); return 1; }
  const e = r.json.entry ?? r.json;
  if (ctx.json) { ctx.emit({ ok: true, entry: e }); return 0; }
  ctx.line(rule(p, `catalog ${e.id}`));
  ctx.line(entryLines(p, e, ctx.width));
  ctx.line(`\n  ${p.faint(`GET /v1/catalog/${e.id} · ${r.ms} ms`)}`);
  return 0;
}

async function buy(ctx, id) {
  const { p } = ctx;
  const b = buyBody(id, ctx.f);
  if (b.error) { ctx.fail(b.error); return 2; }
  const r = await ctx.post('/v1/demands', b.body, { timeoutMs: 30_000 });
  const j = r.json ?? {};
  if (ctx.json) { ctx.emit({ ok: r.ok, status: r.status, ...j }); return r.ok ? 0 : 1; }
  if (!r.ok) { ctx.fail(`demands: ${j.error ?? r.error ?? r.status}`); for (const x of j.problems ?? []) ctx.line(`  ${p.miss('✗')} ${p.muted(x)}`); return 1; }
  if (j.dry_run) { ctx.line(rule(p, 'catalog · buy · dry run (nothing kept)')); ctx.line(kv(p, [['class', p.accent(j.class)], ['input', p.ink(clip(JSON.stringify(j.input), ctx.width - 20))]])); return 0; }
  const d = j.demand ?? {};
  ctx.line(rule(p, 'catalog · bought (demand posted)'));
  ctx.line(kv(p, [['demand', `${p.ink(d.id)} ${pill(p, d.state ?? 'open')}`], ['entry', p.ink(d.catalog?.id ?? id)], ['seller', p.muted(d.catalog?.seller ?? '—')],
    ['price', p.muted(`${d.price_units ?? '—'} units ${d.token ?? 'dUSDC'} · chain ${d.chainId ?? '—'}`)]]));
  ctx.line(`\n  ${p.accent(`taifoon demand status ${d.id} --watch`)}`);
  return 0;
}

export default {
  name: 'catalog',
  summary: 'every hireable agent the layer resells: seller price + our fee, cover, and one call to buy',
  usage: [
    ['catalog [--status buy_now|priced|quote_on_request|covered|openable|ready] [--class c] [--protocol p] [--q words] [--limit n] [--offset n]', 'GET /v1/catalog, paged'],
    ['catalog <cat_…>', 'one entry: price, cover, readiness, the buy call'],
    ['catalog --buy <cat_…> --input \'{…}\' | --need "<words>" [--price-units n] [--label name] [--dry-run]', 'POST /v1/demands { catalog_id }: the loop hires that seller first, grades by code and settles (devnet 36927)'],
  ],
  valued: ['class', 'protocol', 'q', 'limit', 'offset', 'buy', 'input', 'need', 'price-units', 'label'],
  async run(ctx, [first, ...rest]) {
    if (ctx.f.buy !== undefined) return buy(ctx, String(ctx.f.buy));
    if (first && CATALOG_ID.test(first)) return one(ctx, first);
    if (first && first !== 'ls' && first !== 'list') { ctx.fail(`unknown: catalog ${first} · taifoon help catalog`); return 2; }
    return list(ctx);
  },
};
