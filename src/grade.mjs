// `taifoon grade`: a thin delegate to @taifoon/jev's pipeline(), with the same flags as `jev run`.
// Grading lives in @taifoon/jev; this file only parses the flags, hands them over, and prints each step with the
// shared renderer. Keys come from the environment only (TYPESAFE_KEY, TAIFOON_RELAYER_KEY) and are never printed.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

/** Where @taifoon/jev comes from, in order: TAIFOON_JEV_SDK (a path to its dist/index.js), then the installed package. */
export function jevCandidates(env = process.env) {
  return [
    env.TAIFOON_JEV_SDK ? pathToFileURL(env.TAIFOON_JEV_SDK).href : null,
    '@taifoon/jev',
  ].filter(Boolean);
}

export async function loadJev(env = process.env, candidates = jevCandidates(env)) {
  const tried = [];
  for (const spec of candidates) {
    try {
      const m = await import(spec);
      if (typeof m.pipeline === 'function' && Array.isArray(m.STEPS)) return m;
      tried.push(`${spec} (no pipeline export)`);
    } catch (e) { tried.push(`${spec} (${e.code ?? e.message})`); }
  }
  const err = new Error(`@taifoon/jev was not found: ${tried.join('; ')}. Install @taifoon/jev, or set TAIFOON_JEV_SDK to its dist/index.js.`);
  err.code = 'NO_JEV';
  throw err;
}

/** The `jev run` flags, parsed the same way (@taifoon/jev bin/run.mjs). */
export function parseGradeFlags(argv, isTTY) {
  const a = [...argv];
  const has = (n) => { const i = a.indexOf(n); if (i < 0) return false; a.splice(i, 1); return true; };
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const yes = has('--yes') || !isTTY; const json = has('--json'); const noLayer = has('--no-layer');
  const job = val('--job'); const evidence = val('--evidence'); const answers = val('--answers');
  const network = val('--record') ?? val('--network') ?? 'none'; const layer = noLayer ? false : val('--layer');
  const protocol = val('--protocol'); const price = val('--price-usdc');
  if (!['none', 'devnet', 'base', 'both'].includes(network)) a.unshift(`--record ${network} (none, devnet, base or both)`);
  return { yes, json, noLayer, job, evidence, answers, network, layer, protocol, price, rest: a };
}

const short = (v) => JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 90 ? x.slice(0, 87) + '…' : x), 1);

export async function grade(argv, { t, env = process.env, stdin = process.stdin, stdout = process.stdout, jev } = {}) {
  const f = parseGradeFlags(argv, !!stdin.isTTY);
  if (f.rest.length) { t.fail(`unknown argument ${f.rest[0]} · taifoon grade [--job <chain>:<id>] [--evidence pack.json] [--answers answers.json] [--record none|devnet|base|both] [--layer <url> | --no-layer] [--protocol p] [--price-usdc n] [--yes] [--json]`); return 2; }
  // Jev runs on the caller's own TypeSafe key (or answers they already have); there is no shared free path
  if (!f.answers && !env.TYPESAFE_KEY) { t.fail('taifoon grade needs your TypeSafe key: set TYPESAFE_KEY (get one at console.typesafe.ai), or pass --answers answers.json'); return 2; }
  const m = jev ?? await loadJev(env);
  const rl = f.yes ? null : createInterface({ input: stdin, output: stdout });
  t.info(`taifoon grade → @taifoon/jev pipeline() · ${f.noLayer ? 'independent (no layer)' : `layer ${f.layer ?? 'https://coord.taifoon.dev'}`} · grade on ${f.answers ? 'supplied answers' : 'your TypeSafe key'} · record → ${f.network === 'none' ? 'none (opt in with --record)' : f.network}${env.TAIFOON_RELAYER_KEY ? ' + the layer' : ''}`);
  let quit = false;
  const trace = await m.pipeline({
    layer: f.layer, job: f.job, network: f.network, protocol: f.protocol, priceUsdc: f.price ? Number(f.price) : undefined,
    evidence: f.evidence ? JSON.parse(readFileSync(f.evidence, 'utf8')) : undefined,
    answers: f.answers ? JSON.parse(readFileSync(f.answers, 'utf8')) : undefined,
    key: env.TYPESAFE_KEY || null, relayerKey: env.TAIFOON_RELAYER_KEY || null,
    before: async (s) => {
      if (quit) return false;
      const n = m.STEPS.indexOf(s) + 1;
      t.step(n, m.STEPS.length, `${s.title}${s.route ? `  ·  ${s.route}` : ''}`);
      if (!rl) return true;
      const r = (await rl.question(s.required ? '  enter = run · q = quit › ' : '  enter = run · s = skip · q = quit › ')).trim().toLowerCase();
      if (r === 'q') { quit = true; return false; }
      return s.required || r !== 's';
    },
    after: (r) => {
      if (r.skipped) t.skip(r.skipped);
      else if (!r.ok) t.fail(r.error ?? 'failed', { ms: r.ms });
      else { t.ok(r.id, { ms: r.ms }); if (r.out !== undefined) for (const l of short(r.out).split('\n')) t.note(`  ${l}`); }
    },
  });
  rl?.close();
  if (f.json) t.json(trace);
  else if (trace.receipt) t.info(`verdict ${trace.receipt.verdict} · receipt ${trace.receipt.receiptHash}${trace.recorded ? ` · answers digest ${trace.recorded.digests.answers}` : ''}`);
  return quit ? 0 : trace.steps.some((s) => !s.ok) ? 1 : 0;
}
