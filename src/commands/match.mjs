// taifoon match <tag> — _MATCH_SEARCH_v1_ (coord lang/cue/match.cue): the offers that carry a capability tag (translate, gpu-inference,
// a model, a language pair, a lane class), cheapest to the buyer first, each a leaf of its venue's match twig: the hit names its leaf
// index, its twig and the head it was answered at, its master (the owner record of the ownership register) and the price legs of the
// Taifoon Commerce Protocol. Keyless. `taifoon match claim <venue> <index>` (keyed) fetches the inclusion proof and the bundle of the
// hit's delivery lane; `taifoon match offers` is the coverage: every venue of the catalogue, matching or missing:<why>.
import { kv, rule } from '../brand.mjs';

export const LISTINGS_URL = 'https://api.taifoon.dev/coordination/inference-listings.json';
/** the listings of one model (reference id or the provider's own id), cheapest output price first. Pure. */
export const inferenceRows = (j, want) => (j?.listings ?? []).filter((l) => l.reference_model === want || String(l.model).toLowerCase().includes(want)).sort((a, b) => a.price_usd_per_1m.out - b.price_usd_per_1m.out);
const micro = (m) => `${(Number(m) / 1e6).toFixed(6)} USDC`;
/** one hit as rows of text. Pure. */
export function hitRows(h) {
  const c = h.candidate?.capability ?? {}; const legs = h.legs ?? null; const m = c.master ?? null;
  return [
    ['seller', `${c.actor ?? '?'} on ${h.venue} (${c.chain ?? '?'})`],
    ['price', `${micro(c.price_micro)} per ${c.unit ?? 'unit'}${legs ? ` · to the buyer ${micro(legs.price_to_buyer)} (our fee ${micro(legs.our_fee)}, venue ${micro(legs.venue_fee_in + legs.venue_fee_out)})` : ''}`],
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
    ['match <tag> [--venue v] [--chain c] [--price-cap micro] [--limit n] [--json]', 'GET /v1/match/search'],
    ['match offers [--venue v] [--json]', 'GET /v1/match/offers: every venue, matching or missing:<why>'],
    ['match demands <tag> [--json]', 'GET /v1/match/demands with your key'],
    ['match claim <venue> <index> [--units n] [--send] [--json]', 'POST /v1/match/claim with your key: the proof and the bundle'],
    ['match gpu-inference --model <id> [--json]', 'the inference listings of a model across providers: provider price + our reseller cut, cheapest first'],
  ],
  valued: ['venue', 'chain', 'price-cap', 'limit', 'units', 'model'],
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
    if (/^(gpu-)?inference$/.test(sub) && ctx.f.model) {
      const want = String(ctx.f.model).toLowerCase();
      const r = await ctx.get(`/v1/match/search?${q({ tag: want, limit: ctx.f.limit })}`);
      if (r.ok && r.json?.n) { if (ctx.json) { ctx.emit(r.json); return 0; } ctx.line(rule(ctx.p, `${r.json.n} offers for ${want}`)); for (const h of r.json.hits ?? []) ctx.line(kv(ctx.p, hitRows(h))); return 0; }
      let j = null; try { const x = await fetch(LISTINGS_URL, { signal: AbortSignal.timeout(15_000) }); j = x.ok ? await x.json() : null; } catch { j = null; }
      if (!j) { ctx.fail(`match ${sub}: the match index answered ${r.status} and the listings could not be read (${LISTINGS_URL})`); return 1; }
      const rows = inferenceRows(j, want);
      if (ctx.json) { ctx.emit({ model: want, served: 'listings', at: j.at, listings: rows }); return 0; }
      ctx.line(rule(ctx.p, `${rows.length} listings for ${want} · provider price + our ${j.listing_rule?.cut_bps / 100} % reseller cut · read ${j.at}`));
      if (!rows.length) ctx.line(`  none · models listed: ${[...new Set((j.listings ?? []).map((l) => l.reference_model))].join(', ')}`);
      for (const l of rows) ctx.line(kv(ctx.p, [['offer', `${l.model} · ${l.provider.name}`], ['price', `${l.price_usd_per_1m.in} / ${l.price_usd_per_1m.out} USD per 1M in/out (provider ${l.provider_usd_per_1m.in} / ${l.provider_usd_per_1m.out})`], ['hire', l.live ? 'answers now' : `listed; answers after ${l.owner_step}`]]));
      return 0;
    }
    const r = await ctx.get(`/v1/match/search?${q({ tag: sub.toLowerCase(), venue: ctx.f.venue, chain: ctx.f.chain, price_cap: ctx.f['price-cap'], limit: ctx.f.limit })}`);
    if (!r.ok) { ctx.fail(`match ${sub}: ${r.json?.error ?? r.error ?? `HTTP ${r.status}`}`); return 1; }
    if (ctx.json) { ctx.emit(r.json); return 0; }
    ctx.line(rule(ctx.p, `${r.json.n ?? 0} offers under ${sub}${r.json.served ? ` · served from the ${r.json.served.from}${r.json.served.age_s != null ? `, ${r.json.served.age_s}s old` : ''}` : ''}`));
    if (!r.json.n) ctx.line('  none indexed yet under that tag · taifoon match offers shows what is, per venue');
    for (const h of r.json.hits ?? []) ctx.line(kv(ctx.p, hitRows(h)));
    return 0;
  },
};
