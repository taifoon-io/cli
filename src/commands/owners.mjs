// taifoon owners — who masters each component the layer serves (_MASTERS_v1_): per key holder, the chains, protocols and products
// whose master it is (from the ownership register, GET /v1/owners), with each seat's claim state and shares, and the seats still
// held by the operator that a holder can claim to join the cockpit. `owners masters` lists every component × master × claim state;
// `owners get <id>` is the record with its claims; `owners claim <id> --proof …` records a claim (a signature from an address the
// protocol's own contracts name, a DNS or GitHub proof); nothing changes hands until it is approved.
import { withGeneric } from './index.mjs';
import { mastersOf, mastersTable, streamPalette } from '@taifoon/term/stream';
import { colorOn } from '@taifoon/term';

const pad = (s, n) => { const t = String(s); return t.length >= n ? `${t.slice(0, Math.max(0, n - 1))}…` : t + ' '.repeat(n - t.length); };

/** GET /v1/owners (+ ?kind= ?q=) → records[], or null. */
async function records(ctx) {
  const q = new URLSearchParams(); for (const k of ['kind', 'q']) if (typeof ctx.f[k] === 'string') q.set(k, ctx.f[k]);
  const r = await ctx.call(`/v1/owners${q.size ? `?${q}` : ''}`, { key: false, quiet: true });
  return r.status === 200 && Array.isArray(r.json?.records) ? r.json.records : null;
}
/** the holders and what each masters; a seat held by the operator is claimable by its original owner. Pure. */
export function byHolder(recs) {
  const m = new Map();
  for (const r of recs) {
    const holder = r.seat?.claimed_by || r.owner?.holder || '?';
    const g = m.get(holder) ?? { holder, personas: new Set(), masters: [], claimable: [] };
    g.personas.add(r.owner?.persona ?? '?');
    g.masters.push(r);
    if (r.seat?.delegable && r.seat.state === 'held_by_operator') g.claimable.push(r);
    m.set(holder, g);
  }
  return [...m.values()].sort((a, b) => b.masters.length - a.masters.length);
}
const seatOf = (r) => (!r.seat ? (r.owner?.persona === 'operator' ? 'operator' : 'owned') : r.seat.state === 'held_by_operator' ? (r.seat.delegable ? 'claimable' : 'held by operator') : r.seat.state === 'claimed' ? `claimed by ${r.seat.claimed_by}` : r.seat.state);
const sharesOf = (r) => (r.shares ? `owner ${r.shares.owner_bps / 100}% · taifoon ${r.shares.taifoon_bps / 100}%${r.shares.partner ? ` · ${r.shares.partner} ${r.shares.partner_bps / 100}%` : ''}` : '');

const g = withGeneric('owners', {
  summary: 'who masters each chain, protocol and product (per key holder: what it masters, the seats it can claim), and claim the seat of what is yours',
  valued: ['proof', 'method', 'note', 'holder', 'kind', 'q'],
  subs: {
    masters: async (ctx) => {
      const recs = await records(ctx); if (!recs) { ctx.fail('the layer did not answer GET /v1/owners'); return 1; }
      const p = streamPalette(!!(ctx.tty && (ctx.f['no-color'] ? false : colorOn(ctx.out, ctx.env))));
      const masters = mastersOf(recs);
      const comps = recs.map((r) => ({ component: r.id, events: 0, master: masters.get(r.id) ? { ...masterRow(r) } : null }));
      if (ctx.json) { ctx.emit({ ok: true, components: comps.map((c) => ({ id: c.component, name: c.master?.name, holder: c.master?.holder, seat: seatOf(recs.find((r) => r.id === c.component)), shares: recs.find((r) => r.id === c.component)?.shares ?? null })) }); return 0; }
      ctx.out.write(`${mastersTable(comps, p).map((l) => l.replace(/events +/, 'kind      ').replace(/^(  \S+ +)0 +/, (m0, a) => `${a}${pad(recs.find((r) => r.id === a.trim())?.kind ?? '', 10)}`)).join('\n')}\n`);
      ctx.out.write(`${p.dim(`  ${comps.length} components · ${comps.filter((c) => c.master?.claimable).length} seats held by the operator and claimable · taifoon owners claim <id> --proof …`)}\n`);
      return 0;
    },
    claim: async (ctx, args) => {
      const id = args[0];
      if (!id || typeof ctx.f.proof !== 'string') { ctx.fail('usage: taifoon owners claim <owner id> --proof <signature | dns:… | github:…> [--method sig|dns|github] [--note "…"]'); return 2; }
      if (!ctx.key()) { ctx.fail('a claim is made with your key: taifoon login'); return 2; }
      const body = { proof: ctx.f.proof, ...(typeof ctx.f.method === 'string' ? { method: ctx.f.method } : {}), ...(typeof ctx.f.note === 'string' ? { note: ctx.f.note } : {}) };
      const r = await ctx.post(`/v1/owners/${encodeURIComponent(id)}/claim`, body);
      if (ctx.json) { ctx.emit({ ok: r.ok, status: r.status, answer: r.json }); return r.ok ? 0 : 1; }
      if (!r.ok) { ctx.fail(`claim ${id}: ${r.status ?? r.error}${r.json?.error ? ` — ${r.json.error}` : ''}`); return 1; }
      ctx.line(`  ${ctx.p.live('✓')} claim recorded for ${id}: ${r.json?.state ?? 'held for review'}`);
      return 0;
    },
  },
});

/** bare `taifoon owners [--holder h] [--kind k] [--q text]`: per key holder, what it masters and the seats it can claim */
async function bare(ctx) {
    const recs = await records(ctx); if (!recs) { ctx.fail('the layer did not answer GET /v1/owners'); return 1; }
    const groups = byHolder(recs).filter((g) => typeof ctx.f.holder !== 'string' || g.holder === ctx.f.holder);
    if (ctx.json) { ctx.emit({ ok: true, holders: groups.map((g) => ({ holder: g.holder, personas: [...g.personas], masters: g.masters.map((r) => ({ id: r.id, kind: r.kind, name: r.name, seat: seatOf(r), shares: r.shares ?? null })), claimable: g.claimable.map((r) => r.id) })) }); return 0; }
    const p = streamPalette(!!(ctx.tty && (ctx.f['no-color'] ? false : colorOn(ctx.out, ctx.env))));
    for (const g of groups) {
      const byKind = new Map(); for (const r of g.masters) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
      ctx.out.write(`${p.bold(`⚑ ${g.holder}`)} ${p.dim(`(${[...g.personas].join(', ')}) masters ${g.masters.length} components: ${[...byKind.entries()].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ')}`)}\n`);
      const shown = typeof ctx.f.kind === 'string' || typeof ctx.f.q === 'string' ? g.masters : g.masters.slice(0, 12);
      for (const r of shown) ctx.out.write(`  ${pad(r.id, 30)} ${pad(r.name ?? '', 22)} ${(r.seat?.delegable && r.seat.state === 'held_by_operator' ? p.yellow : p.dim)(pad(seatOf(r), 22))} ${p.dim(sharesOf(r))}\n`);
      if (shown.length < g.masters.length) ctx.out.write(`  ${p.dim(`… ${g.masters.length - shown.length} more: taifoon owners --holder ${g.holder} --kind chain|protocol|product`)}\n`);
      if (g.claimable.length) ctx.out.write(`  ${p.yellow(`${g.claimable.length} seat${g.claimable.length === 1 ? '' : 's'} held by the operator and claimable by their original owners`)} ${p.dim('— join the cockpit: taifoon owners claim <id> --proof <signature | dns:… | github:…>')}\n`);
    }
    return 0;
}
export default { ...g, async run(ctx, rest) { return rest.length === 0 ? bare(ctx) : g.run(ctx, rest); } };

/** one record → the masters-table shape (term/stream masterOf) */
function masterRow(r) {
  const state = r.seat?.state ?? (r.owner?.persona === 'operator' ? 'operator' : 'owned');
  return { id: r.id, name: r.name, holder: r.seat?.claimed_by || r.owner?.holder || '?', persona: r.owner?.persona ?? null, state, claimable: !!(r.seat?.delegable && r.seat.state === 'held_by_operator'), shares: r.shares ?? null, kind: r.kind };
}
