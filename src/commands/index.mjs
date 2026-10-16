// The command table. Every module in this directory that exports command objects ({ name, summary, usage, run }) is picked up,
// so a new command is one new file here and nothing else changes (the shell's completion and `taifoon help` read this table).
// status.mjs is wired by main.mjs (bare → dashboard, with an agent → the up walk's marks).
// _CAPABILITIES_v1_: a verb of the capability table (../capabilities.mjs) that no module here serves is served by the generic runner
// below, from the row's op: the same call the MCP server makes for that row (../mcp.mjs runRow), printed as JSON.
import { readdirSync } from 'node:fs';
import { CAPABILITIES, genericVerbs, paramsOf } from '../capabilities.mjs';

const SKIP = new Set(['index.mjs', 'status.mjs']);
let table = null;

const argNames = (row) => (row.http ? paramsOf(row.http.path) : (row.args ?? []).map((a) => a.replace(/\?$/, '')));
const flagNames = (row) => (row.http ? [...(row.http.query ?? []), ...(row.http.body ?? [])] : (row.query ?? []));

/** one generated command for a top-level verb of the capability table */
export function genericCommand(verb) {
  const rows = CAPABILITIES.filter((r) => r.cli.split(/\s+/)[0] === verb);
  const usageOf = (r) => [`${r.cli}${argNames(r).map((a) => ` <${a}>`).join('')}${flagNames(r).length ? ` [--${flagNames(r).join(' | --')}]` : ''}`, `${r.summary ?? r.id} (${r.op})`];
  return {
    name: verb, generic: true,
    summary: rows.length === 1 ? rows[0].summary : `${rows.map((r) => r.cli.split(/\s+/).slice(1).join(' ') || verb).join(' · ')} (the coordination layer, as JSON)`,
    usage: rows.map(usageOf),
    valued: [...new Set(rows.flatMap(flagNames))],
    async run(ctx, rest) {
      const sub = rest[0];
      const row = rows.find((r) => r.cli === `${verb} ${sub}`) ?? rows.find((r) => r.cli === verb);
      if (!row) { ctx.fail(`usage: ${rows.map((r) => `taifoon ${usageOf(r)[0]}`).join(' · ')}`); return 2; }
      if (row.kind === 'act' || row.kind === 'local') { ctx.fail(`${row.cli} has no generic runner`); return 2; }
      const pos = row.cli === verb ? rest : rest.slice(1);
      const names = argNames(row);
      const args = Object.fromEntries(names.map((n, i) => [n, pos[i]]));
      for (const k of flagNames(row)) if (ctx.f[k] !== undefined && ctx.f[k] !== true) { const v = String(ctx.f[k]); args[k] = /^[[{]/.test(v) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v; }
      const { runRow } = await import('../mcp.mjs');
      const { operatorToken } = await import('../roles.mjs');
      const key = row.key || row.kind === 'plan' || row.optKey ? ctx.key() : null;
      // the knowledge runners read the operator skills only for an admin (an operator token on this machine)
      const admin = Boolean(operatorToken(ctx.env));
      const out = await runRow(row, args, { base: ctx.base, key, fetch: ctx.io.fetch ?? globalThis.fetch, version: ctx.version, role: admin ? 'admin' : undefined, env: admin ? ctx.env : {} });
      // _PRETTY_v1_: a terminal reads the answer in the stream view's language; --json and a pipe keep the JSON as answered
      if (ctx.tty && !ctx.f.raw) { const { pretty } = await import('../pretty.mjs'); ctx.out.write(pretty(ctx.p, out, { width: ctx.width }).join('\n') + '\n'); }
      else ctx.out.write(JSON.stringify(out, null, ctx.json ? 0 : 2) + '\n');
      return out.ok === false ? 1 : 0;
    },
  };
}

/**
 * A verb whose read rows the generic runner serves and whose act / local rows are hand-written: `subs` maps a subcommand to its
 * run(ctx, args). The usage lines are the generic runner's (one per row of the verb), so the alignment test sees every row.
 */
export function withGeneric(verb, { summary, subs = {}, valued = [] } = {}) {
  const g = genericCommand(verb);
  return { ...g, generic: false, summary: summary ?? g.summary, valued: [...new Set([...(g.valued ?? []), ...valued])],
    async run(ctx, rest) { const h = subs[rest[0]]; return h ? h(ctx, rest.slice(1)) : g.run(ctx, rest); } };
}

/** read a server-sent event stream: prints one line per event until --limit events or --for seconds (default: until ctrl-c) */
export async function followSse(ctx, path, { headers = {} } = {}) {
  const limit = Number(ctx.f.limit) || Infinity; const forS = Number(ctx.f.for) || 0;
  const ac = new AbortController(); if (forS) setTimeout(() => ac.abort(), forS * 1000).unref?.();
  const key = ctx.key();
  let r;
  try { r = await (ctx.io.fetch ?? globalThis.fetch)(ctx.base + path, { headers: { accept: 'text/event-stream', ...(key ? { 'x-api-key': key } : {}), ...headers }, signal: ac.signal }); }
  catch (e) { ctx.fail(`${path}: ${e?.message ?? e}`); return 1; }
  if (!r.ok || !r.body) { const j = await r.json().catch(() => null); ctx.fail(`${path} answered ${r.status}${j?.error ? `: ${j.error}` : ''}`); return 1; }
  const reader = r.body.getReader(); const td = new TextDecoder(); let buf = ''; let n = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += td.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = block.match(/^event: (.*)$/m)?.[1] ?? 'message'; const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
        if (!data) continue;
        ctx.out.write(ctx.json ? `${JSON.stringify({ event: ev, data: (() => { try { return JSON.parse(data); } catch { return data; } })() })}\n` : `  ${ctx.p.faint(ev)} ${data}\n`);
        if (++n >= limit) { ac.abort(); return 0; }
      }
    }
  } catch (e) { if (e?.name !== 'AbortError') { ctx.fail(String(e?.message ?? e)); return 1; } }
  return 0;
}

/**
 * name → command, loaded once. _ONE_COMMAND_SET_v1_: `extra` are the commands a host program adds to THIS table (taifoon-sdk adds
 * the verbs that need the SDK's own code): same dispatch, same help, same render, never a second CLI. An extra never replaces a
 * command of the table.
 */
export async function commands(extra = []) {
  if (table && !extra.length) return table;
  if (table) { const t = new Map(table); for (const c of extra) if (c && !t.has(c.name)) t.set(c.name, { ...c, extra: true }); return t; }
  const t = new Map();
  const dir = new URL('./', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs') && !SKIP.has(x)).sort()) {
    const mod = await import(new URL(f, dir).href);
    for (const v of new Set(Object.values(mod))) {
      if (v && typeof v === 'object' && typeof v.name === 'string' && typeof v.run === 'function' && !t.has(v.name)) t.set(v.name, v);
    }
  }
  for (const verb of genericVerbs(new Set(t.keys()))) t.set(verb, genericCommand(verb));
  table = t;
  return extra.length ? commands(extra) : t;
}
