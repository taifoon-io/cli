// taifoon venues — every venue the harvesters read (x402 on five networks, ERC-8183 / Virtuals ACP, memo-ACP, BitAgent, Olas),
// what its buyers paid in 7 days, and which of our products answers what they pay for.
//   venues                      one line per venue: 7-day USD, payments, buyers, failure rate, what we offer there
//   venues <id>                 one venue: its classes, paid-via, failure, its targets (class → our offer or the gap)
//   venues --targets            every target across venues where one of our products fits, largest first
// Reads GET /v1/venues and GET /v1/venues?view=targets (the venue pass on box 116, every 15 min). Read-only.
import { rule } from '../brand.mjs';

const usd = (n) => (n === null || n === undefined ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));

/** targets of one venue (or all), split into the ones we answer and the gaps, largest first. Pure. */
export function targetsOf(doc, venue = null) {
  const rows = (doc?.targets ?? []).filter((t) => !venue || t.venue === venue).sort((a, b) => (b.usd_7d ?? 0) - (a.usd_7d ?? 0));
  return { offered: rows.filter((t) => (t.offers ?? []).length), gaps: rows.filter((t) => !(t.offers ?? []).length) };
}

/** one offer as a line: product, price, the networks it is paid on. Pure. */
export const offerLine = (o) => `${o.product} ${o.price?.amount ?? '?'} ${o.price?.currency ?? ''} a ${o.price?.per ?? 'call'} · ${(o.price?.networks ?? []).length} networks`;

export default {
  name: 'venues',
  summary: 'every venue the harvesters read: 7-day volume, buyers, failure rate, and which of our products answers what its buyers pay for',
  usage: [
    ['venues [--json]', 'one line per venue: 7-day USD, payments, buyers, failure rate, the offers we hold there'],
    ['venues <id> [--json]', 'one venue: classes, paid-via, failure, and each target (class → our offer, or the gap)'],
    ['venues --targets [--json]', 'every target where one of our products fits, largest first'],
  ],
  valued: [],
  async run(ctx, rest) {
    const { p } = ctx;
    if (rest.length > 1) { ctx.fail('usage: taifoon venues [<id>] [--targets]'); return 2; }
    const [v, t] = await Promise.all([ctx.get('/v1/venues', { key: false, timeoutMs: 60_000 }), ctx.get('/v1/venues?view=targets', { key: false, timeoutMs: 60_000 })]);
    if (!v.ok || !v.json?.venues) { ctx.fail(`GET /v1/venues did not answer (${v.status ?? 'no answer'})`); return 1; }
    const venues = v.json.venues; const tdoc = t.ok ? t.json : null;
    if (ctx.f.targets) {
      const { offered } = targetsOf(tdoc);
      if (ctx.json) { ctx.emit({ ok: true, read_at: tdoc?.read_at ?? null, targets: offered }); return 0; }
      ctx.line(rule(p, `venues · ${offered.length} targets one of our products answers`));
      for (const x of offered) ctx.line(`  ${usd(x.usd_7d).padStart(8)}  ${p.accent(x.venue.padEnd(15))} ${x.class.padEnd(16)} ${p.faint(`${num(x.buyers_7d)} buyers · ${(x.offers ?? []).map((o) => o.product).join(', ')}`)}`);
      return 0;
    }
    if (!rest.length) {
      if (ctx.json) { ctx.emit({ ok: true, read_at: v.json.read_at ?? null, venues: venues.map((x) => ({ id: x.id, label: x.label, demand: x.demand, failure: x.failure ?? null, offered: targetsOf(tdoc, x.id).offered.length })) }); return 0; }
      ctx.line(rule(p, `venues · ${venues.length} read by the harvesters · ${v.json.read_at ?? ''}`));
      ctx.line(`  ${p.faint('id'.padEnd(16))}${p.faint('USD 7d'.padStart(10))}${p.faint('payments'.padStart(11))}${p.faint('buyers'.padStart(9))}${p.faint('  failed'.padStart(9))}  ${p.faint('our offers')}`);
      for (const x of venues) {
        const d = x.demand ?? {}; const f = x.failure?.rate; const n = targetsOf(tdoc, x.id).offered.length;
        ctx.line(`  ${p.accent(x.id.padEnd(16))}${usd(d.usd_7d).padStart(10)}${num(d.payments_7d).padStart(11)}${num(d.buyers_7d).padStart(9)}${(f === undefined || f === null ? '—' : `${Math.round(f * 1000) / 10} %`).padStart(9)}  ${n ? p.live(`${n} classes`) : p.faint('none')}`);
      }
      ctx.line(`  ${p.faint('taifoon venues <id>: its classes and what we offer there · taifoon venues --targets: every fit')}`);
      return 0;
    }
    const id = String(rest[0]);
    const x = venues.find((y) => y.id === id);
    if (!x) { ctx.fail(`no venue ${id}: ${venues.map((y) => y.id).join(', ')}`); return 1; }
    const { offered, gaps } = targetsOf(tdoc, id);
    if (ctx.json) { ctx.emit({ ok: true, venue: x, targets: { offered, gaps } }); return 0; }
    const d = x.demand ?? {};
    ctx.line(rule(p, `venues · ${x.label ?? x.id}`));
    ctx.line(`  7 days     ${usd(d.usd_7d)} · ${num(d.payments_7d)} payments · ${num(d.buyers_7d)} buyers`);
    if (x.failure) ctx.line(`  failure    ${x.failure.rate === null || x.failure.rate === undefined ? '—' : `${Math.round(x.failure.rate * 1000) / 10} %`}${x.failure.refunded === false ? ' · not refunded' : x.failure.refunded ? ' · refunded' : ''}`);
    if ((x.paid_via ?? []).length) ctx.line(`  paid via   ${x.paid_via.map((r) => `${r.facilitator} ${usd(r.usd_7d)}`).join(' · ')}`);
    ctx.line('');
    ctx.line(`  ${p.ink('what its buyers pay for, and our offer')}`);
    for (const o of offered) ctx.line(`  ${usd(o.usd_7d).padStart(8)}  ${o.class.padEnd(16)} ${p.live('→')} ${o.offers.map(offerLine).join(' | ')}`);
    for (const g of gaps.slice(0, 8)) ctx.line(`  ${usd(g.usd_7d).padStart(8)}  ${g.class.padEnd(16)} ${p.faint(`gap: ${g.gap ?? 'no product of ours answers it'}`)}`);
    if (!offered.length && !gaps.length) ctx.line(`  ${p.faint('no classified demand on this venue')}`);
    return 0;
  },
};
