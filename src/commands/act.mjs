// taifoon act <plan.json> — the hand-off of an unsigned plan: checks { to, data, value, chainId } and prints the kms-access command
// a human runs with a live MFA session (src/handoff.mjs; the MCP tool act_handoff is the same function). Signs nothing, runs nothing.
import { readFileSync } from 'node:fs';
import { handoff } from '../handoff.mjs';

export default {
  name: 'act',
  summary: 'hand an unsigned plan to kms-access: prints the command a human runs with an MFA session; never signs',
  usage: [['act <plan.json | -> [--project <kms-access project>]', 'check the plan and print the kms-access send line (nothing is run)']],
  valued: ['project'],
  async run(ctx, rest) {
    const { p } = ctx;
    if (rest.length !== 1) { ctx.fail('usage: taifoon act <plan.json | ->'); return 2; }
    let raw;
    try { raw = rest[0] === '-' ? readFileSync(0, 'utf8') : readFileSync(rest[0], 'utf8'); } catch (e) { ctx.fail(`cannot read ${rest[0]}: ${e.message}`); return 2; }
    const out = await handoff({ plan: raw, project: ctx.f.project });
    if (ctx.json) { ctx.emit(out); return out.ok ? 0 : 2; }
    if (!out.ok) { ctx.fail(out.error); return 2; }
    ctx.line(`  ${p.faint(`chain ${out.chainId} · to ${out.to} · ${out.data_bytes} bytes of calldata · value ${out.value}`)}`);
    for (const l of out.command) ctx.line(`    ${p.faint('$')} ${l}`);
    ctx.line(`  ${p.faint(out.note)}`);
    return 0;
  },
};
