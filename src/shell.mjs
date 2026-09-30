// The interactive shell: `taifoon` with no command, as `mamba` opens its console. One dispatch for everything: a line typed at
// the prompt, a line piped in, and a one-shot subcommand all go through main(), so `markets ls` means the same thing in all three
// (an earlier mamba sent piped slash commands to the model as tasks; this shell has one parser for a reason).
//   - a leading / is optional:  /pools ls  ==  pools ls
//   - Tab completes commands, subcommands and marketplace ids
//   - the status bar above the prompt: the layer's health, the session (guest or key prefix), the owner, plans pending
//   - lines holding a key (tfr_…) are never written to the history file
import { createInterface } from 'node:readline';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { banner, brand, promptText, statusBar } from './brand.mjs';
import { commands } from './commands/index.mjs';
import { homeDir, listPlans, loadConfig, prefixOf, profileOf, defaultExec } from './config.mjs';
import { MARKETS } from './markets.mjs';
import { DEFAULT_LAYER } from './api.mjs';
import { parseFlags } from './context.mjs';

/** Split a line like a shell does for quotes: markets search "proof of reserves" → ['markets','search','proof of reserves']. */
export function tokenize(line) {
  const out = []; let cur = ''; let q = null; let any = false;
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (cur || any) { out.push(cur); cur = ''; any = false; } continue; }
    cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

const BUILTIN = ['help', 'exit', 'quit', 'clear', 'status', 'up', 'curl', 'grade'];

/** Completion candidates for a partial line. Pure over the command table. */
export function completer(table, line) {
  const words = tokenize(line.replace(/^\//, ''));
  const trailing = /\s$/.test(line);
  const lead = line.startsWith('/') ? '/' : '';
  if (words.length === 0 || (words.length === 1 && !trailing)) {
    const all = [...BUILTIN, ...table.keys()].sort();
    const hits = all.filter((c) => c.startsWith(words[0] ?? ''));
    return [(hits.length ? hits : all).map((h) => lead + h + ' '), line];
  }
  const c = table.get(words[0]);
  const rest = trailing ? words.slice(1) : words.slice(1, -1);
  const partial = trailing ? '' : words[words.length - 1];
  let opts = [];
  if (c && rest.length === 0) opts = c.subs ?? [];
  else if (c?.complete) opts = c.complete(rest) ?? [];
  if (!opts.length && words[0] === 'markets') opts = MARKETS.map((m) => m.id);
  const hits = opts.filter((o) => o.startsWith(partial));
  const head = line.slice(0, line.length - partial.length);
  return [hits.map((h) => head + h + ' '), line];
}

async function netCheck(io, base) {
  const f = io.fetch ?? globalThis.fetch; const t0 = Date.now();
  try { const r = await f(`${base}/v1/root/latest`, { signal: AbortSignal.timeout(8000) }); return { ok: r.ok, status: r.status, ms: Date.now() - t0 }; }
  catch { return { ok: false, status: null, ms: Date.now() - t0 }; }
}

export async function shell(argv, io = {}) {
  const { main, VERSION } = await import('./main.mjs');
  const out = io.out ?? process.stdout; const env = io.env ?? process.env; const input = io.stdin ?? process.stdin;
  const noColor = argv.includes('--no-color');
  const p = brand(out, env, noColor ? false : undefined);
  const table = await commands();
  const exec = io.exec ?? defaultExec;
  // the global flags given to `taifoon` ride on every line (a value flag keeps its value)
  const { f: gf } = parseFlags(argv);
  const pass = Object.entries(gf).filter(([k]) => ['layer', 'key', 'profile', 'no-color', 'verbose'].includes(k)).flatMap(([k, v]) => (v === true ? [`--${k}`] : [`--${k}`, String(v)]));
  const session = () => {
    const cfg = io.cfg ?? loadConfig(env); const profile = env.TAIFOON_PROFILE ?? cfg.profile ?? 'default'; const prof = profileOf(cfg, profile);
    const base = String(gf.layer ?? env.TAIFOON_LAYER ?? prof.layer ?? DEFAULT_LAYER).replace(/\/$/, '');
    const mode = env.TAIFOON_API_KEY ? 'env' : prof.mode === 'key' ? 'key' : 'guest';
    const prefix = mode === 'env' ? prefixOf(env.TAIFOON_API_KEY) : prof.key_prefix ?? null;
    return { profile, prof, base, host: (() => { try { return new URL(base).host; } catch { return base; } })(), mode, prefix, label: prof.label ?? null, owner: prof.owner ?? null };
  };
  let s = session();
  let net = await netCheck(io, s.base); let netAt = Date.now();
  const bar = () => statusBar(p, { ...s, net, plans: listPlans(env).filter((x) => !x.signed).length });
  if (!argv.includes('--no-banner')) {
    out.write(banner(p, [
      ['layer', `${p.ink(s.base)} ${net.ok ? p.live(`${net.ms} ms`) : p.miss(`${net.status ?? 'no answer'}`)}`],
      ['session', s.mode === 'guest' ? p.part('guest · visitor budget (taifoon login for your key)') : p.accent(`key ${s.prefix}${s.label ? ` · ${s.label}` : ''}`)],
      ['owner', s.owner ? p.you(s.owner) : p.faint('none')],
      ['version', p.faint(VERSION)],
    ]) + '\n\n');
    out.write(`  ${p.faint('help for commands · tab completes · exit to leave')}\n\n`);
  }
  const histFile = join(homeDir(env), 'history');
  const remember = (line) => { if (/tfr_/.test(line)) return; try { mkdirSync(homeDir(env), { recursive: true, mode: 0o700 }); appendFileSync(histFile, line + '\n', { mode: 0o600 }); } catch { /* history is a convenience */ } };

  /** one line → one main() run. false ends the session. */
  const handle = async (raw) => {
    const line = raw.trim().replace(/^\//, '');
    if (!line || line.startsWith('#')) return true;
    const words = tokenize(line);
    if (['exit', 'quit', 'q'].includes(words[0])) return false;
    if (words[0] === 'clear') { out.write('\u001bc'); return true; }
    const code = await main([...words, ...pass], { ...io, noShell: true, exec });
    if (code !== 0 && code !== undefined) out.write(`  ${p.faint(`exit ${code}`)}\n`);
    if (['login', 'logout'].includes(words[0])) s = session();
    out.write('\n');
    return true;
  };

  if (!input.isTTY) {
    // piped: the same dispatch, one line at a time; each line is echoed faint so a transcript reads like a session
    const text = await new Promise((resolve) => { let b = ''; input.setEncoding?.('utf8'); input.on('data', (d) => { b += d; }); input.on('end', () => resolve(b)); });
    for (const l of text.split('\n')) {
      if (!l.trim()) continue;
      out.write(`${p.faint('❯')} ${p.faint(l.trim())}\n`);
      if (!(await handle(l))) break;
    }
    return 0;
  }

  let hist = [];
  try { hist = readFileSync(histFile, 'utf8').split('\n').filter(Boolean).slice(-500).reverse(); } catch { /* none */ }
  const rl = createInterface({ input, output: out, completer: (line) => completer(table, line), history: hist, historySize: 500, terminal: true });
  const ask = () => new Promise((resolve) => {
    const redraw = async () => {
      if (Date.now() - netAt > 60_000) { net = await netCheck(io, s.base); netAt = Date.now(); }
      out.write(bar() + '\n');
      rl.question(promptText(p, s.profile), resolve);
    };
    redraw();
  });
  rl.on('SIGINT', () => { out.write(`\n  ${p.faint('ctrl-c: type exit to leave')}\n`); rl.write('', { ctrl: true, name: 'u' }); });
  let closed = false; rl.on('close', () => { closed = true; });
  while (!closed) {
    const l = await ask().catch(() => null);
    if (l === null || closed) break;
    if (l.trim()) remember(l.trim());
    rl.pause();
    const go = await handle(l);
    rl.resume();
    if (!go) break;
  }
  rl.close();
  out.write(`  ${p.faint('coord.taifoon.dev')}\n`);
  return 0;
}

