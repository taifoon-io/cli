// taifoon prove tx <chain> <tx> | sale <sale_key> — fetch the proof through coord and check it (src/prove.mjs; the same functions
// answer the MCP tools prove_tx and prove_sale). Prints proven, held awaiting_proof, failed or unproven with the reference;
// exit 0 only when proven (1 failed or unproven, 3 awaiting_proof, 4 no such sale in the published run).
import { proveSale, proveTx, EXIT, SUMMARY_URL } from '../prove.mjs';
import { summaryFetcher } from '../mcp.mjs';

const WORD = { proven: 'proven', awaiting_proof: 'held awaiting_proof', failed: 'failed', unproven: 'unproven', not_found: 'not found', no_tx: 'no tx' };
const paint = (p, s) => (s === 'proven' ? p.live : s === 'awaiting_proof' ? p.you : s === 'no_tx' ? p.faint : p.miss)(WORD[s] ?? s);

export default {
  name: 'prove',
  summary: 'the proof of a transaction or of a sale, read through coord and checked: proven, held awaiting_proof, failed',
  usage: [
    ['prove tx <chain> <tx>', 'GET /v1/proof/tx/:chain/:tx: proven with its v5 reference, awaiting_proof, failed (reverted) or unproven'],
    ['prove sale <sale_key> [--summary <url | file>]', 'every settled and paid step the sale run records for that key, each proof asked of coord again'],
  ],
  valued: ['summary'],
  async run(ctx, rest) {
    const { p } = ctx;
    const [sub, a, b, ...extra] = rest;
    // _CLI_FINISH_v1_: the proof reads go with the profile's key when it has one (its own budget, not the 30-a-minute keyless rate)
    const get = (path, o) => ctx.get(path, { ...o, ...(ctx.key() ? {} : { key: false }), quiet: true });
    let out;
    if (sub === 'tx' && a && b && !extra.length) out = await proveTx({ chain: a, tx: b }, { get });
    else if (sub === 'sale' && a && !b) out = await proveSale({ sale_key: a, summary: typeof ctx.f.summary === 'string' ? ctx.f.summary : SUMMARY_URL }, { get, fetchSummary: summaryFetcher(ctx.io.fetch ?? globalThis.fetch) });
    else { ctx.fail('usage: taifoon prove tx <chain> <tx> | prove sale <sale_key>'); return 2; }
    if (out.error) { ctx.fail(out.error); if (ctx.json) ctx.emit(out); return 2; }
    if (ctx.json) { ctx.emit(out); return EXIT[out.state] ?? 1; }
    if (sub === 'tx') {
      ctx.line(`  ${paint(p, out.state)}  ${out.ref ? p.ink(out.ref) : p.faint(out.why ?? '')}`);
      if (out.ref) ctx.line(`  ${p.faint(`block ${out.block ?? '—'} · finalized ${out.is_finalized ?? '—'} · checks ${Object.entries(out.checks ?? {}).filter(([, v]) => v === true).map(([k]) => k).join(', ') || '—'}`)}`);
    } else {
      ctx.line(`  ${paint(p, out.state)}  ${p.ink(out.sale_key)}${out.why ? `  ${p.faint(out.why)}` : ''}`);
      for (const s of out.steps) ctx.line(`    ${p.faint(s.step.padEnd(8))} ${paint(p, s.state)}  ${s.ref ? p.ink(s.ref) : p.faint(s.why ?? '')}${s.recorded.held_by && s.state !== 'no_tx' ? p.faint(`  (recorded: held ${s.recorded.held_by})`) : ''}`);
      if (out.key_tx) ctx.line(`    ${p.faint('key tx  ')} ${paint(p, out.key_tx.state)}  ${out.key_tx.ref ? p.ink(out.key_tx.ref) : p.faint(out.key_tx.why ?? '')}  ${p.faint(`(${out.key_tx.what}; the published run names no settled or paid step for this key)`)}`);
      ctx.line(`  ${p.faint(`sale run ${out.summary.generated_at ?? out.summary.unread ?? '—'}`)}`);
    }
    ctx.line(`  ${p.faint(`verifier ${out.verifier ? `${out.verifier.name} ${out.verifier.address} (chain ${out.verifier.chain})` : '—'}`)}`);
    ctx.line(`  ${p.faint(out.trust)}`);
    // _CLI_FINISH_v1_: a state that is not proven says what to run next
    const again = sub === 'tx' ? `taifoon prove tx ${a} ${b}` : `taifoon prove sale ${a}`;
    const next = out.state === 'awaiting_proof' ? `read it again once the block is final: ${again}`
      : out.state === 'unproven' ? (/key|rate|x402/i.test(String(out.why ?? '')) && !ctx.key() ? 'taifoon login --free (its own budget), then ' + again : `taifoon debug rpc ${sub === 'tx' ? a : '<chain>'} (is the chain read?) · ${again}`)
        : out.state === 'not_found' ? 'taifoon prove sale <sale_key> with a key the published sale run names' : null;
    if (next) ctx.line(`  ${p.you('next:')} ${next}`);
    return EXIT[out.state] ?? 1;
  },
};
