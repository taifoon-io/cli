// taifoon — the terminal twin of the STUDIO session on taifoon.io.
//   taifoon up <chain>:<agentId> | <wallet>   seller onboarding: readiness → probe → classes → quote → Jev pad → next
//   taifoon up                                re-run the last agent: ✓ steps under 10 minutes old print from the state file
//   taifoon status [agent]                    every step and its mark, from ~/.taifoon/up
//   taifoon curl [agent]                      the curl for the last step's calls
//   taifoon grade [jev run flags]             one job through @taifoon/jev's pipeline()
// Global: --json (machine output only), --layer <url> (default https://coord.taifoon.dev), --key <X-API-Key> or
// TAIFOON_API_KEY, --fresh (ignore the state file), --no-color.
import { readFileSync } from 'node:fs';
import { createTerm } from '@taifoon/term';
import { DEFAULT_LAYER, hostOf, layerFetcher } from './api.mjs';
import { grade } from './grade.mjs';
import { exists, readLast, stateDir } from './state.mjs';
import { parseAgent } from './steps.mjs';
import { curl, status, up } from './up.mjs';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const HELP = `taifoon ${VERSION} — seller onboarding on the Taifoon coordination layer (reads only; it never signs)

  taifoon up <chain>:<agentId> | <chain>:<wallet> | <wallet>
                          readiness → probe → classes → quote → Jev pad, then the next action
  taifoon up              re-run the last agent; ✓ steps younger than 10 minutes are not read again
  taifoon status [agent]  every step and its mark from ~/.taifoon/up
  taifoon curl [agent]    the curl for the last step's calls
  taifoon grade [--job <chain>:<id>] [--evidence pack.json] [--answers answers.json] [--network none|devnet|base|both]
                [--layer <url> | --no-layer] [--protocol p] [--price-usdc n] [--yes] [--json]
                          one job through @taifoon/jev's pipeline() (the same flags as \`jev run\`)

  --json        machine output: one StepResult per line for up, one JSON value otherwise
  --layer <url> the coordination layer (default ${DEFAULT_LAYER}); env TAIFOON_LAYER
  --key <key>   your X-API-Key (or env TAIFOON_API_KEY); sent as a header, never printed
  --fresh       read every step again
  --no-color    plain output (NO_COLOR and a non-TTY stdout do the same)`;

function take(argv) {
  const a = [...argv];
  const has = (n) => { const i = a.indexOf(n); if (i < 0) return false; a.splice(i, 1); return true; };
  const val = (n) => { const i = a.indexOf(n); if (i < 0) return undefined; const v = a[i + 1]; a.splice(i, 2); return v; };
  return { a, has, val };
}

/** Run the CLI. io: { out, err, env, fetch, now, stdin } (all optional; tests pass fakes). Returns the exit code. */
export async function main(argv, io = {}) {
  const out = io.out ?? process.stdout;
  const env = io.env ?? process.env;
  const now = io.now ?? (() => Date.now());
  const cmd = argv[0];
  if (cmd === 'grade') {
    const g = take(argv.slice(1));
    const color = g.has('--no-color') ? false : undefined;
    const t = createTerm({ out, env, color, quiet: g.a.includes('--json') });
    try { return await grade(g.a, { t, env, stdin: io.stdin ?? process.stdin, stdout: out, jev: io.jev }); }
    catch (e) { createTerm({ out: io.err ?? process.stderr, env, color }).fail(e.message); return e.code === 'NO_JEV' ? 3 : 1; }
  }
  const { a, has, val } = take(argv);
  const json = has('--json'); const fresh = has('--fresh'); const noColor = has('--no-color');
  const base = (val('--layer') ?? env.TAIFOON_LAYER ?? DEFAULT_LAYER).replace(/\/$/, '');
  const key = val('--key') ?? env.TAIFOON_API_KEY ?? null;
  const t = createTerm({ out, env, color: noColor ? false : undefined, quiet: json });
  const errT = createTerm({ out: io.err ?? process.stderr, env, color: noColor ? false : undefined });
  if (has('--version') || has('-v')) { out.write(`${VERSION}\n`); return 0; }
  const [c, ref, ...extra] = a;
  if (!c || c === 'help' || c === '--help' || c === '-h' || has('--help') || has('-h')) { out.write(HELP + '\n'); return c ? 0 : 2; }
  if (!['up', 'status', 'curl'].includes(c)) { errT.fail(`unknown command ${c} · taifoon help`); return 2; }
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
  if (!agent) { errT.fail(`not an agent: ${r} · use <chain>:<ERC-8004 agent id> (8453:95902) or a seller address`); return 2; }
  const refText = `${agent.chain}:${agent.id}`;
  const o = { t, agent, ref: refText, base, host, key, dir, now, json, fresh };
  if (c === 'status') return status(o);
  if (c === 'curl') return curl(o);
  const get = layerFetcher({ base, key, fetchImpl: io.fetch ?? globalThis.fetch, version: VERSION });
  if (!ref && !exists(dir, agent)) { errT.fail(`name an agent: taifoon up 8453:95902`); return 2; }
  return up({ ...o, get });
}
