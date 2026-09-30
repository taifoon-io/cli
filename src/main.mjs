// taifoon — the coordination layer's command line, after open-mamba's `mamba`: an interactive shell (`taifoon`), the same
// commands as one-shot subcommands, and the same dispatch for piped input. Every command is backed by /v1, so the layer meters
// it; every command takes --json.
//   taifoon                                   the shell (completion, status bar); piped stdin runs line by line
//   taifoon login | logout | whoami           your relayer key in the Keychain / kms-access SSM, or guest; owner wallet
//   taifoon register agent|resource …         ERC-8004 agents and λ resources onto the layer
//   taifoon collaborate …                     teams: scoped keys per collaborator, who did what, revoke
//   taifoon pools …                           Moonbeam pools (read) and generic pools on every chain we maintain (plans)
//   taifoon markets …                         every marketplace: status, search across all, connect, hire
//   taifoon demand post "<need>" | status | ls say what you need; the auto-match loop hires, grades by code, settles (devnet)
//   taifoon status [agent]                    one screen: network, session, markets, pending plans (with an agent: the up marks)
//   taifoon up | curl | grade                 seller onboarding walk, its curls, one grade (unchanged)
// Global: --json, --layer <url>, --key <key> (or TAIFOON_API_KEY), --profile <name>, --no-color, --verbose, --yes.
import { readFileSync } from 'node:fs';
import { createTerm } from '@taifoon/term';
import { DEFAULT_LAYER, hostOf, layerFetcher } from './api.mjs';
import { grade } from './grade.mjs';
import { exists, readLast, stateDir } from './state.mjs';
import { parseAgent } from './steps.mjs';
import { curl, status, up } from './up.mjs';
import { commands } from './commands/index.mjs';
import { dashboard } from './commands/status.mjs';
import { makeContext, parseFlags } from './context.mjs';
import { brand, pad } from './brand.mjs';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const LEGACY = `  taifoon up <chain>:<agentId> | <chain>:<wallet> | <wallet>
                          readiness → probe → classes → quote → Jev pad, then the next action
  taifoon up              re-run the last agent; ✓ steps younger than 10 minutes are not read again
  taifoon status <agent>  every step and its mark from ~/.taifoon/up
  taifoon curl [agent]    the curl for the last step's calls
  taifoon grade [--job <chain>:<id>] [--evidence pack.json] [--answers answers.json] [--network none|devnet|base|both]
                [--layer <url> | --no-layer] [--protocol p] [--price-usdc n] [--yes] [--json]
                          one job through @taifoon/jev's pipeline() (the same flags as \`jev run\`)`;

const GLOBAL = `  --json        machine output: one JSON value per command (with the /v1 calls it made); one StepResult per line for up
  --layer <url> the coordination layer (default ${DEFAULT_LAYER}); env TAIFOON_LAYER
  --key <key>   your X-API-Key for this run (or env TAIFOON_API_KEY; taifoon login stores it instead); never printed
  --profile <p> a named login profile (env TAIFOON_PROFILE)
  --yes         answer yes to a confirmation (devnet sends only; mainnet is never sent)
  --fresh       read every up step again
  --no-color    plain output (NO_COLOR and a non-TTY stdout do the same)`;

const ORDER = ['login', 'logout', 'whoami', 'register', 'collaborate', 'demand', 'pools', 'markets', 'metrics'];
const usageLines = (c) => c.usage.map(([u, d]) => (u.length <= 56 ? `    taifoon ${pad(u, 56)} ${d}` : `    taifoon ${u}\n    ${' '.repeat(65)}${d}`));

export async function helpText(cmdName) {
  const t = await commands();
  if (cmdName && t.has(cmdName)) {
    const c = t.get(cmdName);
    return `taifoon ${c.name} — ${c.summary}\n\n${usageLines(c).join('\n')}\n\n${GLOBAL}\n`;
  }
  const names = [...ORDER.filter((x) => t.has(x)), ...[...t.keys()].filter((x) => !ORDER.includes(x)).sort()];
  const blocks = names.map((x) => { const c = t.get(x); return `  ${c.name} — ${c.summary}\n${usageLines(c).join('\n')}`; });
  return `taifoon ${VERSION} — the Taifoon coordination layer in the terminal (every command is a /v1 call; it never holds a private key)

  taifoon                 the interactive shell (tab completion, a status bar); piped stdin runs the same commands line by line
  taifoon help <command>  one command's usage

${blocks.join('\n\n')}

  status — one screen: network, session, marketplaces, plans waiting for a signature
    taifoon status

  the seller walk (unchanged)
${LEGACY}

${GLOBAL}
`;
}
/** kept for the tests and for anything that imported it */
export const HELP = `taifoon ${VERSION}\n${LEGACY}\n\n${GLOBAL}`;

function take(argv) {
  const a = [...argv];
  const has = (n) => { const i = a.indexOf(n); if (i < 0) return false; a.splice(i, 1); return true; };
  const val = (n) => { const i = a.indexOf(n); if (i < 0) return undefined; const v = a[i + 1]; a.splice(i, 2); return v; };
  return { a, has, val };
}

/** The walk commands exactly as they were: up, status <agent>, curl. */
async function legacy(argv, io) {
  const out = io.out ?? process.stdout;
  const env = io.env ?? process.env;
  const now = io.now ?? (() => Date.now());
  const { a, has, val } = take(argv);
  const json = has('--json'); const fresh = has('--fresh'); const noColor = has('--no-color');
  const base = (val('--layer') ?? env.TAIFOON_LAYER ?? DEFAULT_LAYER).replace(/\/$/, '');
  const key = val('--key') ?? env.TAIFOON_API_KEY ?? null;
  const t = createTerm({ out, env, color: noColor ? false : undefined, quiet: json });
  const errT = createTerm({ out: io.err ?? process.stderr, env, color: noColor ? false : undefined });
  const [c, ref, ...extra] = a;
  if (extra.length) { errT.fail(`unexpected argument ${extra[0]} · taifoon help`); return 2; }
  let host;
  try { host = hostOf(base); } catch { errT.fail(`--layer must be a URL: ${base}`); return 2; }
  const dir = stateDir(env);
  let r = ref;
  if (!r) {
    const last = readLast(dir);
    if (!last?.agent) { errT.fail(`name an agent: taifoon ${c} 8453:95902 (or a seller address)`); return 2; }
    r = last.agent;
  }
  const agent = parseAgent(r);
  if (!agent) { errT.fail(`not an agent: ${r} · use <chain>:<ERC-8004 agent id> (8453:95902), a seller address, a Fetch.ai agent address (agent1…) or an x402 resource URL (https://…)`); return 2; }
  const refText = `${agent.chain}:${agent.id}`;
  const o = { t, agent, ref: refText, base, host, key, dir, now, json, fresh };
  if (c === 'status') return status(o);
  if (c === 'curl') return curl(o);
  const get = layerFetcher({ base, key, fetchImpl: io.fetch ?? globalThis.fetch, version: VERSION });
  if (!ref && !exists(dir, agent)) { errT.fail(`name an agent: taifoon up 8453:95902`); return 2; }
  return up({ ...o, get });
}

/** Run the CLI. io: { out, err, env, fetch, now, stdin, exec, cfg } (all optional; tests pass fakes). Returns the exit code. */
export async function main(argv, io = {}) {
  const out = io.out ?? process.stdout;
  const env = io.env ?? process.env;
  const cmd = argv[0];
  if (cmd === 'grade') {
    const g = take(argv.slice(1));
    const color = g.has('--no-color') ? false : undefined;
    const t = createTerm({ out, env, color, quiet: g.a.includes('--json') });
    try { return await grade(g.a, { t, env, stdin: io.stdin ?? process.stdin, stdout: out, jev: io.jev }); }
    catch (e) { createTerm({ out: io.err ?? process.stderr, env, color }).fail(e.message); return e.code === 'NO_JEV' ? 3 : 1; }
  }
  if (argv.includes('--version') || argv.includes('-v')) { out.write(`${VERSION}\n`); return 0; }
  const first = parseFlags(argv).pos[0];
  if (!first) {
    if (argv.includes('--help') || argv.includes('-h')) { out.write(await helpText()); return 0; }
    if (io.noShell) { out.write(await helpText()); return 2; }
    const { shell } = await import('./shell.mjs');
    return shell(argv, io);
  }
  if (first === 'help' || argv.includes('--help') || argv.includes('-h')) { out.write(await helpText(argv.find((x, i) => i > 0 && !x.startsWith('--')))); return 0; }
  if (first === 'up' || first === 'curl') return legacy(argv, io);
  const table = await commands();
  const c = table.get(first);
  const { pos, f } = parseFlags(argv, [...(c?.valued ?? []), 'status', 'tenant', 'chain']);
  if (first === 'status') {
    if (pos.length > 1) return legacy(argv, io);
    return dashboard(makeContext(io, f, VERSION));
  }
  if (!c) { createTerm({ out: io.err ?? process.stderr, env }).fail(`unknown command ${first} · taifoon help`); return 2; }
  const ctx = makeContext(io, f, VERSION);
  try { return await c.run(ctx, pos.slice(1)); }
  catch (e) { ctx.fail(e?.message ?? String(e)); return 1; }
}

export { brand };
