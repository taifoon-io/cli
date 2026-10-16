// taifoon new — the one scaffolder (COALESCE D6): `taifoon new <card> [dir]` writes a product card's starter (keyless reads on the
// live host); `taifoon new --app <dir>` writes the coord app (fund · demo · deploy · verify). `coord new` and
// `npx @taifoon/create-coord-app` run this same code (src/scaffold.mjs).
import { cardStarter, contractsStarter, loadLayer, scaffold } from '../scaffold.mjs';

export default {
  name: 'new',
  summary: 'scaffold a product card\'s starter (taifoon new <card> [dir]) or the coord app (taifoon new --app <dir>)',
  usage: [['new <card> [dir]', 'a product card\'s starter: keyless reads on the live host'], ['new --app <dir>', 'the coord app: fund · demo · deploy · verify'], ['new --contracts <dir>', 'a forge project on taifoon-contracts: the agent-job example, wired to the chain'], ['new --list', 'the cards on the shelf']],
  valued: ['app', 'contracts'],
  async run(ctx, args) {
    if (ctx.f.app !== undefined) {
      const dir = typeof ctx.f.app === 'string' ? ctx.f.app : args[0];
      const r = scaffold(dir);
      if (ctx.json) { ctx.emit(r); return r.ok ? 0 : 2; }
      if (!r.ok) { ctx.fail(r.error); return 2; }
      ctx.line(`  ${ctx.p.live('✓')} created ${r.name} in ${r.dir}\n\n  cd ${dir}\n  npm run fund · npm run demo · npm run deploy · npm run verify   (read AGENTS.md first)`);
      return 0;
    }
    if (ctx.f.contracts !== undefined) {
      const dir = typeof ctx.f.contracts === 'string' ? ctx.f.contracts : args[0];
      const r = contractsStarter(dir);
      if (ctx.json) { ctx.emit(r); return r.ok ? 0 : 2; }
      if (!r.ok) { ctx.fail(r.error); return 2; }
      ctx.line(`  ${ctx.p.live('✓')} wrote ${r.dir}: ${r.files.join(' ')}\n\n  cd ${dir}\n  forge install taifoon-io/taifoon-contracts foundry-rs/forge-std@v1.15.0 --no-git && forge build   (then README.md)`);
      return 0;
    }
    let L;
    try { L = await loadLayer({ base: ctx.base, fetchImpl: ctx.io?.fetch }); } catch (e) { ctx.fail(String(e?.message ?? e)); return 1; }
    if (ctx.f.list !== undefined || !args[0]) {
      const shelf = L.cards.filter((c) => c.shelf);
      if (ctx.json) { ctx.emit({ cards: shelf.map((c) => ({ id: c.id, name: c.name })) }); return 0; }
      ctx.line('  taifoon new <card> [dir] — the cards on the shelf:');
      for (const c of shelf) ctx.line(`    ${c.id.padEnd(14)} ${c.name}`);
      ctx.line('  taifoon new --app <dir> — the coord app (fund · demo · deploy · verify)');
      ctx.line('  taifoon new --contracts <dir> — a forge project on taifoon-contracts (the agent-job example)');
      return args[0] ? 0 : (ctx.f.list !== undefined ? 0 : 2);
    }
    const r = cardStarter(L, args[0], args[1]);
    if (ctx.json) { ctx.emit(r); return r.ok ? 0 : 2; }
    if (!r.ok) { ctx.fail(r.error); return 2; }
    ctx.line(`  ${ctx.p.live('✓')} wrote ${r.dir}: ${r.files.join(' ')}\n    cd ${r.dir} && bash starter.sh`);
    return 0;
  },
};
