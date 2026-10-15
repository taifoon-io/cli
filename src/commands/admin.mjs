// taifoon admin <coord verb …> — the operator verbs (the coord CLI: deploy, release, wiring, gen, render, contracts, …) from the same
// binary, for an admin only: this machine holds an operator token (TAIFOON_OPERATOR_TOKEN) and a coord checkout (COORD_HOME, default
// ~/projects/coord). It runs `bin/coord` of that checkout with your arguments; `coord` stays the operator's alias. A member never sees
// this verb in help and the agent never gets it as a tool.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { operatorToken } from '../roles.mjs';

export const coordBin = (env) => join(env.COORD_HOME || join(homedir(), 'projects', 'coord'), 'bin', 'coord');

export default {
  name: 'admin',
  admin: true,
  summary: 'the coord operator verbs (admin only): taifoon admin <verb> … runs bin/coord of your coord checkout',
  usage: [['admin <coord verb> [args…]', 'e.g. taifoon admin release stream-v2 · taifoon admin wiring check · taifoon admin gen --check']],
  valued: [],
  async run(ctx, rest) {
    if (!operatorToken(ctx.env)) { ctx.fail('admin only: this machine holds no operator token (TAIFOON_OPERATOR_TOKEN)'); return 3; }
    const bin = coordBin(ctx.env);
    if (!existsSync(bin)) { ctx.fail(`no coord checkout at ${bin} (set COORD_HOME)`); return 3; }
    if (!rest.length) { ctx.fail('usage: taifoon admin <coord verb> [args…]  (taifoon admin help lists them)'); return 2; }
    const r = spawnSync(bin, rest, { stdio: ctx.io.stdio ?? 'inherit', env: ctx.env, timeout: 30 * 60_000 });
    return r.status ?? 1;
  },
};
