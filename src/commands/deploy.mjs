// taifoon deploy member-contract — your own contract through the deploy pipeline's stages (COALESCE D7): plan, rehearse on a fork,
// then YOUR wallet sends it (the unsigned transaction, or `--account <your foundry keystore>`), then verify. Never a Taifoon key.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { grantedOutlets, memberPlan, memberRehearse, memberVerify } from '../deploy-member.mjs';

// the chain's RPC: --rpc, else the rotation when this CLI runs from a checkout that has the RPC rotation module; no URL is pinned here
async function rpcOf(chainId) {
  try { const m = await import(new URL('../../../rpc/rotation.mjs', import.meta.url).href); return (await m.rpcUrls(Number(chainId), 'call'))[0] ?? null; } catch { return null; }
}
export default {
  name: 'deploy',
  summary: 'deploy your own contract (plan · rehearse on a fork · your wallet sends · verify); never a Taifoon key',
  usage: [['deploy member-contract <plan|rehearse|send|verify> --chain <id> --member <0x…> --artifact <file.json> [--ctor "constructor(address)" --args a,b] [--label name] [--rpc url] [--account keystore] [--own-signer]', 'your own contract, with your key\'s outlet grants']],
  valued: ['chain', 'member', 'artifact', 'ctor', 'args', 'label', 'rpc', 'account', 'outlets'],
  async run(ctx, [module, stage = 'plan']) {
    if (module !== 'member-contract') { ctx.fail('usage: taifoon deploy member-contract <plan|rehearse|send|verify> --chain <id> --member <0x…> --artifact <file.json>'); return 2; }
    const art = JSON.parse(readFileSync(String(ctx.f.artifact ?? ''), 'utf8'));
    const bytecode = typeof art.bytecode === 'string' ? art.bytecode : art.bytecode?.object;
    const chainId = Number(ctx.f.chain);
    const outlets = typeof ctx.f.outlets === 'string' ? ctx.f.outlets.split(',') : await grantedOutlets({ base: ctx.base, key: ctx.key(), fetchImpl: ctx.io?.fetch });
    let plan;
    try { plan = memberPlan({ chainId, member: ctx.f.member, bytecode: bytecode?.startsWith('0x') ? bytecode : `0x${bytecode}`, ctor: ctx.f.ctor ?? null,
      args: typeof ctx.f.args === 'string' ? ctx.f.args.split(',') : [], label: ctx.f.label ?? 'contract', outlets, ownSigner: ctx.f['own-signer'] !== undefined }); }
    catch (e) { ctx.fail(String(e?.message ?? e)); return 2; }
    const rpc = ctx.f.rpc ?? await rpcOf(chainId);
    if (stage === 'plan') { ctx.emit ? ctx.emit(plan) : ctx.line(JSON.stringify(plan, null, 1)); return plan.ok ? 0 : 3; }
    if (!plan.ok) { ctx.fail(`refused: ${plan.refusals.join('; ')}`); return 3; }
    if (!rpc) { ctx.fail(`--rpc <url> for chain ${chainId}`); return 2; }
    if (stage === 'rehearse') { const r = await memberRehearse(plan, { rpc }); ctx.emit ? ctx.emit({ plan, rehearsal: r }) : ctx.line(JSON.stringify({ plan, rehearsal: r }, null, 1)); return r.ok ? 0 : 1; }
    if (stage === 'send') {
      const r = await memberRehearse(plan, { rpc });
      if (!r.ok) { ctx.fail(`the rehearsal failed, nothing is sent: ${JSON.stringify(r.checks ?? r.why)}`); return 1; }
      if (typeof ctx.f.account !== 'string') { ctx.line('the rehearsal is green; send this transaction from your own wallet (nothing of ours signs):'); ctx.line(JSON.stringify(plan.tx, null, 1)); return 0; }
      const s = spawnSync('cast', ['send', '--rpc-url', rpc, '--account', ctx.f.account, plan.tx.to, plan.tx.data, '--json'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
      if (s.status !== 0) { ctx.fail('cast send failed'); return 1; }
      ctx.line(s.stdout.trim()); return 0;
    }
    if (stage === 'verify') { const r = memberVerify(plan, { rpc }); ctx.emit ? ctx.emit({ plan, verify: r }) : ctx.line(JSON.stringify({ plan, verify: r }, null, 1)); return r.ok ? 0 : 1; }
    ctx.fail(`stage ${stage}: plan, rehearse, send or verify`); return 2;
  },
};
