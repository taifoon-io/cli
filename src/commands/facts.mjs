// taifoon facts chain | contracts | superroot — our chain and contract addresses from the address registry this CLI carries, and the
// superroot as coord serves it, as JSON (src/facts.mjs; the same functions answer the MCP tools facts_chain, facts_contracts and
// facts_superroot). --registry <file> reads a full registry instead of the public subset (its governance rows are marked public: false).
import { readFileSync } from 'node:fs';
import { factsChain, factsContracts, factsSuperroot } from '../facts.mjs';
import { REGISTRY } from '../registry.mjs';

const SUB = { chain: factsChain, contracts: factsContracts, superroot: factsSuperroot };

export default {
  name: 'facts',
  summary: 'chain and contract addresses from the address registry, and the superroot now, as JSON',
  usage: [
    ['facts chain [<id | name | alias>]', 'one chain: its registry entry, our contracts on it, its leaf in the superroot (no chain: every chain)'],
    ['facts contracts [<chain>] [--system s] [--kind k] [--status live]', 'contract addresses, and the same-address set across chains'],
    ['facts superroot', 'the superroot: root, chains included, leaf count, the feed’s age, the verifier, what “proven” means today'],
  ],
  valued: ['system', 'kind', 'status', 'registry'],
  async run(ctx, rest) {
    const [sub, arg, ...extra] = rest;
    const fn = SUB[sub];
    if (!fn || extra.length) { ctx.fail('usage: taifoon facts chain [<chain>] | contracts [<chain>] | superroot'); return 2; }
    let registry = REGISTRY;
    if (typeof ctx.f.registry === 'string') { try { registry = JSON.parse(readFileSync(ctx.f.registry, 'utf8')); } catch (e) { ctx.fail(`--registry: ${e.message}`); return 2; } }
    const out = await fn({ chain: arg, system: ctx.f.system, kind: ctx.f.kind, status: ctx.f.status }, { get: (p, o) => ctx.get(p, { ...o, key: false, quiet: true }), registry });
    // _CLI_FINISH_v1_: a terminal reads the facts in the pretty view; --json and a pipe keep the JSON
    if (ctx.tty) {
      if (!out.ok) { ctx.fail(out.error ?? out.why ?? 'no answer', { body: out }); return 1; }
      const { pretty } = await import('../pretty.mjs'); ctx.out.write(pretty(ctx.p, out, { width: ctx.width }).join('\n') + '\n');
    } else ctx.out.write(JSON.stringify(ctx.json ? { ...out, calls: ctx.calls } : out, null, ctx.json ? 0 : 2) + '\n');
    return out.ok ? 0 : 1;
  },
};
