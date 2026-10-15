// taifoon owners — who owns each protocol, chain, product and connector (reads), and `owners claim`: the original owner of a protocol
// or chain claims its delegable seat with a proof (a signature from an address the protocol's own contracts name, a DNS or GitHub
// proof). The claim is recorded and held for review; nothing changes hands until it is approved.
import { withGeneric } from './index.mjs';

export default withGeneric('owners', {
  summary: 'who owns what (protocols, chains, products, connectors), and claim the seat of what is yours',
  valued: ['proof', 'method', 'note'],
  subs: {
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
