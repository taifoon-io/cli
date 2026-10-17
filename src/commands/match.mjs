// taifoon match <tag> — _MATCH_SEARCH_v1_ (coord lang/cue/match.cue): the offers that carry a capability tag (translate, gpu-inference,
// a model, a language pair, a lane class), cheapest to the buyer first, each a leaf of its venue's match twig: the hit names its leaf
// index, its twig and the head it was answered at, its master (the owner record of the ownership register) and the price legs of the
// Taifoon Commerce Protocol. Keyless. `taifoon match claim <venue> <index>` (keyed) fetches the inclusion proof and the bundle of the
// hit's delivery lane; `taifoon match offers` is the coverage: every venue of the catalogue, matching or missing:<why>.
import { kv, rule, table } from '../brand.mjs';

export const LISTINGS_URL = 'https://api.taifoon.dev/coordination/inference-listings.json';
/** the listings of one model (reference id or the provider's own id), cheapest output price first. Pure. */
export const inferenceRows = (j, want) => (j?.listings ?? []).filter((l) => l.reference_model === want || String(l.model).toLowerCase().includes(want)).sort((a, b) => a.price_usd_per_1m.out - b.price_usd_per_1m.out);
// _CLI_FINISH_v1_: a quote the answer does not carry prints as —, never NaN
const micro = (m) => (m === null || m === undefined || !Number.isFinite(Number(m)) ? '—' : `${(Number(m) / 1e6).toFixed(6)} USDC`);
/** one hit as rows of text: the price per the canonical unit the search ranked (MFIX, coord #285) and its source unit, then the legs
 *  as the hit's own fee module quoted them, or why it was not quoted. Reads the older shape too (no `normalized`). Pure. */
export function hitRows(h) {
  const c = h.candidate?.capability ?? {}; const legs = h.legs ?? null; const m = c.master ?? null; const n = h.normalized ?? null;
  const price = n
    ? `${micro(n.price_micro)} per ${n.unit}${n.source_unit && n.source_unit !== n.unit ? ` (listed ${micro(c.price_micro)} per ${n.units_per_quote && n.units_per_quote !== 1 ? `${Number(n.units_per_quote).toLocaleString('en-US')} ` : ''}${n.source_unit})` : ''}`
    : `${micro(c.price_micro)} per ${c.unit ?? 'unit'}`;
  const quoted = legs && !legs.error && Number.isFinite(Number(legs.price_to_buyer));
  const legsLine = !legs ? null
    : legs.error ? `not quoted: ${legs.error}${legs.fee_rule ? ` (fee rule ${legs.fee_rule})` : ''}`
      : quoted ? `${legs.fee_rule ? `${legs.fee_rule} · ` : ''}to the buyer ${micro(legs.price_to_buyer)}${legs.per ? ` per ${legs.per.quantity !== 1 ? `${legs.per.quantity} ` : ''}${legs.per.unit}` : ''} = seller ${micro(legs.seller_price)} + our fee ${micro(legs.our_fee)}${Number(legs.reseller_markup) ? ` + reseller ${micro(legs.reseller_markup)}` : ''}${Number(legs.venue_fee_in ?? 0) + Number(legs.venue_fee_out ?? 0) ? ` + venue ${micro(Number(legs.venue_fee_in ?? 0) + Number(legs.venue_fee_out ?? 0))}` : ''}`
        : 'not quoted for this unit yet';
  return [
    ['seller', `${c.actor ?? '?'} on ${h.venue} (${c.chain ?? '?'})`],
    ['price', price],
    ...(legsLine ? [['legs', legsLine]] : []),
    ['tags', (c.tags ?? []).join(' ')],
    ['master', m ? `${m.id} · ${m.holder} · ${m.state} · shares owner ${m.shares?.owner_bps ?? 0} / partner ${m.shares?.partner_bps ?? 0} / taifoon ${m.shares?.taifoon_bps ?? 0} bps` : 'none (missing:no_master)'],
    ['twig', `leaf ${h.candidate?.index} · ${String(h.candidate?.twig ?? '').slice(0, 18)}… · head ${h.head?.count} ${String(h.head?.hash ?? '').slice(0, 18)}…${h.head?.signed ? ' · SIGNED' : ''}${h.candidate?.proof ? ' · PROOF' : ''}`],
  ];
}
export function coverageRows(j) {
  return (j.venues ?? []).map((v) => [v.venue, `${v.state}${v.offers !== undefined ? ` · ${v.offers} offers · ${v.demands} demands` : ''}${v.tags?.length ? ` · ${v.tags.slice(0, 4).map((t) => `${t.tag} ${t.offers}`).join(', ')}` : ''}`]);
}

export default {
  name: 'match',
  summary: 'the offers under a capability tag (translate, gpu-inference, …), cheapest first, each with its twig head and legs; claim one; the coverage',
  usage: [
    ['match <tag> [--venue v] [--chain c] [--unit u] [--price-cap micro] [--limit n] [--json]', 'GET /v1/match/search: ranked within one canonical unit (--unit for the others it lists)'],
    ['match offers [--venue v] [--json]', 'GET /v1/match/offers: every venue, matching or missing:<why>'],
    ['match demands <tag> [--json]', 'GET /v1/match/demands with your key'],
    ['match claim <venue> <index> [--units n] [--send] [--json]', 'POST /v1/match/claim with your key: the proof and the bundle'],
    ['match gpu-inference --model <id> [--json]', 'the inference listings of a model across providers: provider price + our reseller cut, cheapest first'],
  ],
  valued: ['venue', 'chain', 'price-cap', 'limit', 'units', 'model', 'unit'],
  async run(ctx, rest) {
    const sub = rest[0];
    const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    if (!sub) { ctx.fail('usage: taifoon match <tag> · taifoon match offers · taifoon match demands <tag> · taifoon match claim <venue> <index>'); return 2; }
    if (sub === 'offers') {
      const r = await ctx.get(`/v1/match/offers${ctx.f.venue ? `?venue=${encodeURIComponent(ctx.f.venue)}` : ''}`);
      if (!r.ok) { ctx.fail(`match offers: ${r.json?.error ?? r.error ?? `HTTP ${r.status}`}`); return 1; }
      if (ctx.json) { ctx.emit(r.json); return 0; }
      ctx.line(rule(ctx.p, `the match index: ${r.json.totals?.matching ?? 0} venues matching, ${r.json.totals?.missing ?? 0} missing`)); ctx.line(kv(ctx.p, coverageRows(r.json))); return 0;
    }
    if (sub === 'demands') {
      if (!ctx.key()) { ctx.fail('the demands are read with your key: taifoon login'); return 2; }
      const r = await ctx.get(`/v1/match/demands?${q({ tag: rest[1], venue: ctx.f.venue, limit: ctx.f.limit })}`);
      if (!r.ok) { ctx.fail(`match demands: ${r.json?.error ?? r.error ?? `HTTP ${r.status}`}`); return 1; }
      if (ctx.json) { ctx.emit(r.json); return 0; }
      ctx.line(rule(ctx.p, `${r.json.n ?? 0} demands${rest[1] ? ` under ${rest[1]}` : ''}`)); for (const d of r.json.demands ?? []) ctx.line(kv(ctx.p, hitRows(d))); return 0;
    }
    if (sub === 'claim') {
      const venue = rest[1]; const index = Number(rest[2]);
      if (!venue || !Number.isInteger(index) || index < 0) { ctx.fail('usage: taifoon match claim <venue> <leaf index> [--units n] [--send]'); return 2; }
      if (!ctx.key()) { ctx.fail('a claim is made with your key: taifoon login'); return 2; }
      const r = await ctx.post('/v1/match/claim', { venue, index, ...(ctx.f.units ? { units: Number(ctx.f.units) } : {}), ...(ctx.f.send ? { send: true } : {}) });
      if (ctx.json) { ctx.emit({ ok: r.ok, status: r.status, answer: r.json }); return r.ok ? 0 : 1; }
      if (!r.ok) { ctx.fail(`match claim: ${r.json?.error ?? r.error ?? `HTTP ${r.status}`}`); return 1; }
      const j = r.json; ctx.line(rule(ctx.p, `claimed leaf ${index} of ${venue}: proof ${j.verified ? 'VERIFIED' : 'not verified'} against head ${j.hit?.head?.count}`));
      ctx.line(kv(ctx.p, [...hitRows(j.hit), ['lane', `${j.lane?.class}: ${(j.lane?.kinds ?? []).join(' → ')} by ${j.lane?.carrier}, ack ${j.lane?.ack}`], ['agreement', `${j.agreement?.payment} ${j.agreement?.asset} = ${(j.agreement?.legs ?? []).map((l) => `${l.leg} ${l.units}`).join(' + ')}`], ['bundle', `${(j.bundle?.envelopes ?? []).length} envelopes${j.sent ? ` · sent: ${(j.sent.ids ?? []).join(' ')}` : ' · not sent (--send)'}`], ['charged', `match ${micro(j.charged?.match_micro ?? 0)} · settle ${micro(j.charged?.settle_micro ?? 0)}`]]));
      return 0;
    }
    // _INFERENCE_LISTINGS_v1_: a model across every inference provider (coord lang/cue/inference.cue): the match index under the model's
    // tag first; while it is not served, the listings the feeder publishes (api.taifoon.dev/coordination/inference-listings.json)
    if (/^(gpu-)?inference$/.test(sub) && ctx.f.model) return modelView(ctx, String(ctx.f.model).toLowerCase(), q);
    const r = await ctx.get(`/v1/match/search?${q({ tag: sub.toLowerCase(), venue: ctx.f.venue, chain: ctx.f.chain, unit: ctx.f.unit, price_cap: ctx.f['price-cap'], limit: ctx.f.limit })}`);
    if (!r.ok) { ctx.fail(`match ${sub}: ${r.json?.error ?? r.error ?? `HTTP ${r.status}`}`); return 1; }
    if (ctx.json) { ctx.emit(r.json); return 0; }
    ctx.line(rule(ctx.p, `${r.json.n ?? 0} offers under ${sub}${r.json.unit ? ` per ${r.json.unit}` : ''}${r.json.served ? ` · served from the ${r.json.served.from}${r.json.served.age_s != null ? `, ${r.json.served.age_s}s old` : ''}` : ''}`));
    if (!r.json.n) ctx.line('  none indexed yet under that tag · taifoon match offers shows what is, per venue');
    for (const h of r.json.hits ?? []) ctx.line(kv(ctx.p, hitRows(h)));
    if ((r.json.other_units ?? []).length) ctx.line(`  ${ctx.p.faint(`ranked per ${r.json.unit ?? 'one unit'}; also under ${sub}: ${r.json.other_units.map((o) => `${o.offers} per ${o.unit}`).join(', ')} · taifoon match ${sub} --unit <unit>`)}`);
    return 0;
  },
};

/** the provider id of an index hit (taifoon-resale:<provider>), or null. Pure. */
export const providerOfHit = (h) => { const a = String(h?.candidate?.capability?.actor ?? ''); return a.startsWith('taifoon-resale:') ? a.slice('taifoon-resale:'.length) : h?.venue ?? null; };
/**
 * _CLI_FINISH_v1_: one model across every inference provider, as one table. The listings feed (api.taifoon.dev, the 116 feeder) is the
 * truth for provider, price per 1M in/out and delivery (now, or after the owner funds the provider); the match index adds each listing's
 * leaf and head when it is indexed. Render only: prices and legs are what the feed and the matcher answer.
 */
async function modelView(ctx, want, q) {
  const { p } = ctx;
  const [r, j] = await Promise.all([
    ctx.get(`/v1/match/search?${q({ tag: want, limit: 50 })}`, { key: false }),
    (async () => { try { const x = await (ctx.io.fetch ?? fetch)(LISTINGS_URL, { signal: AbortSignal.timeout(15_000) }); return x.ok ? await x.json() : null; } catch { return null; } })(),
  ]);
  const hits = r.ok ? (r.json?.hits ?? []) : [];
  if (!j && !hits.length) { ctx.fail(`no listings for ${want}: the match index answered ${r.status ?? 'nothing'} and the listings feed could not be read (${LISTINGS_URL})`); return 1; }
  const rows = j ? inferenceRows(j, want) : [];
  const leafOf = (l) => hits.find((h) => providerOfHit(h) === l.provider?.id) ?? null;
  if (ctx.json) { ctx.emit({ model: want, at: j?.at ?? null, listing_rule: j?.listing_rule ?? null, listings: rows.map((l) => ({ ...l, index: leafOf(l) ? { venue: leafOf(l).venue, leaf: leafOf(l).candidate?.index, head: leafOf(l).head } : null })), hits_without_listing: hits.filter((h) => !rows.some((l) => l.provider?.id === providerOfHit(h))) }); return 0; }
  const cut = j?.listing_rule?.cut_bps !== undefined ? `${j.listing_rule.cut_bps / 100} %` : 'our';
  ctx.line(rule(p, `${want} · ${rows.length} listings · provider price + ${cut} reseller cut${j?.at ? ` · read ${String(j.at).slice(0, 16).replace('T', ' ')}` : ''}`));
  if (!rows.length) {
    ctx.line(`  none for ${want} · models listed: ${[...new Set((j?.listings ?? []).map((l) => l.reference_model))].join(', ') || '—'}`);
    return 0;
  }
  const f = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(4) : '—');
  ctx.line(table(p, [
    { key: 'provider', title: 'provider', flex: true },
    { key: 'model', title: 'model', flex: true, fmt: (v) => p.faint(v) },
    { key: 'in', title: 'in/1M', align: 'right' },
    { key: 'out', title: 'out/1M', align: 'right' },
    { key: 'src', title: 'provider out', align: 'right', fmt: (v) => p.faint(v) },
    { key: 'delivers', title: 'delivers' },
    { key: 'leaf', title: 'index', fmt: (v) => p.faint(v) },
  ], rows.map((l) => {
    const h = leafOf(l);
    return {
      provider: l.provider?.name ?? l.provider?.id ?? '?', model: l.model,
      in: f(l.price_usd_per_1m?.in), out: f(l.price_usd_per_1m?.out), src: f(l.provider_usd_per_1m?.out),
      delivers: l.live ? p.live('now') : p.part(`after funding`),
      leaf: h ? `${h.venue} leaf ${h.candidate?.index}` : 'not indexed',
    };
  }), ctx.width));
  const steps = [...new Set(rows.filter((l) => !l.live && l.owner_step).map((l) => `${l.provider?.id}: ${l.owner_step}`))];
  if (steps.length) { ctx.line(`  ${p.ink('waits on the owner')}`); for (const st of steps) ctx.line(`    ${p.faint(st)}`); }
  ctx.line(`  ${p.faint('prices in USD per 1M tokens · taifoon match gpu-inference --model <id> --json for the legs · taifoon match claim <venue> <leaf> to hire')}`);
  return 0;
}
