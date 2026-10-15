// taifoon path — where a seller stands on the standard path, and the ONE next transition (phase board items 17, 18, 19, 21).
//   path                       every seller of the listings store, by kind and ours | outside: how many reached each stage, where they stop
//   path <ls_…>                one listing: every stage, the stage it stops at, who makes the next transition and the call
//   path <chain>:<agentId>     one ERC-8004 agent: the thirteen readiness steps, the next one, and its TEE rail when it claims one
// Reads only, no key: GET /v1/listings?view=path and GET /v1/agents/{chain}/{agentId}/readiness. The stages, the rules and the
// next step are the layer's own (the layer's listing path and readiness schema); nothing is restated here.
import { rule, pill, clip } from '../brand.mjs';

export const LISTING_RE = /^ls_[0-9a-f]{16}$/;
export const AGENT_RE = /^(\d{1,10}):(\d{1,78})$/;

/** What the argument names: every seller, one listing, or one agent. Pure. */
export function subjectOf(arg) {
  if (arg === undefined) return { kind: 'all' };
  if (LISTING_RE.test(arg)) return { kind: 'listing', id: arg };
  const m = AGENT_RE.exec(arg);
  if (m) return { kind: 'agent', chain: Number(m[1]), id: m[2] };
  return { kind: 'bad', error: `"${String(arg).slice(0, 60)}" is neither a listing id (ls_…) nor <chain>:<agentId>` };
}

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** The layer's next_step as one runnable line (its http call), or null when it names none. Pure. */
export function curlOf(step) {
  const h = step?.http; if (!h?.url) return null;
  return `curl -sS${h.method === 'POST' ? ' -X POST' : ''} ${sq(h.url)}${h.body !== undefined ? ` -H 'content-type: application/json' -d ${sq(JSON.stringify(h.body))}` : ''}`;
}

/** The lines of one path (stages in order, with ✓ or ·), shared by a listing's path and an agent's TEE rail. Pure. */
export function stageMarks(order, stages) { return order.map((s) => `${stages?.[s] ? '✓' : '·'} ${s}`).join('  '); }

/** The table of the whole store: one line per kind and ours | outside, the count at each stage. Pure. */
export function reachedRows(path) {
  const stages = path.stages ?? []; const rows = new Map();
  for (const r of path.reached ?? []) { const k = `${r.kind} ${r.whose}`; const row = rows.get(k) ?? { kind: r.kind, whose: r.whose, n: {} }; row.n[r.stage] = r.n; rows.set(k, row); }
  return [...rows.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.whose.localeCompare(b.whose)).map((r) => ({ ...r, cells: stages.map((s) => r.n[s] ?? 0) }));
}

async function all(ctx) {
  const { p } = ctx;
  const r = await ctx.get('/v1/listings?view=path&limit=1', { quiet: true, key: false });
  if (!r.ok || !r.json?.path) { ctx.fail(r.json?.path_note ?? r.json?.error ?? `GET /v1/listings?view=path answered ${r.status ?? r.error}`); return 1; }
  const path = r.json.path;
  if (ctx.json) { ctx.emit({ ok: true, path }); return 0; }
  ctx.line(rule(p, `the standard path · ${path.stages.length} stages · every seller of the listings store`));
  ctx.line(`  ${p.faint(path.stages.map((s, i) => `${i + 1} ${s}`).join(' → '))}`);
  ctx.line('');
  for (const row of reachedRows(path)) ctx.line(`  ${p.accent(`${row.kind} ${row.whose}`.padEnd(13))} ${row.cells.map((n) => String(n).padStart(4)).join(' ')}`);
  ctx.line('');
  ctx.line(`  ${p.faint('where they stop, and who makes the next transition')}`);
  for (const s of [...(path.stops ?? [])].sort((a, b) => b.n - a.n)) ctx.line(`  ${String(s.n).padStart(4)}  ${p.accent(`${s.kind} ${s.whose}`.padEnd(13))} ${s.stops_at === 'complete' ? pill(p, 'live') + ' every stage reached' : `stops at ${s.stops_at} · next is the ${s.by}'s`}`);
  ctx.line(`  ${p.faint('taifoon path <ls_…> · taifoon path <chain>:<agentId>')}`);
  return 0;
}

async function listing(ctx, id) {
  const { p } = ctx;
  const r = await ctx.get('/v1/listings?view=path&limit=500', { quiet: true, key: false });
  if (!r.ok) { ctx.fail(r.json?.error ?? `GET /v1/listings?view=path answered ${r.status ?? r.error}`); return 1; }
  const row = (r.json.rows ?? []).find((x) => x.id === id);
  if (!row) { ctx.fail(`no listing ${id} in the store (GET /v1/listings lists them)`); return 1; }
  if (!row.path) { ctx.fail(r.json.path_note ?? 'the layer answered the row without a path'); return 1; }
  const pt = row.path;
  if (ctx.json) { ctx.emit({ ok: true, listing: { id: row.id, kind: row.kind, endpoint: row.endpoint, whose: row.whose, state: row.state, classes: row.classes }, path: pt }); return 0; }
  ctx.line(rule(p, `${row.id} · ${row.kind} · ${row.whose} · ${row.state}`));
  ctx.line(`  ${p.faint(clip(row.endpoint, ctx.width - 4))}`);
  ctx.line(`  ${stageMarks(r.json.path?.stages ?? Object.keys(pt.stages), pt.stages)}`);
  ctx.line(`  ${p.accent(`${pt.reached} of ${pt.of}`)} ${pt.stops_at ? `· stops at ${pt.stops_at} · the next transition is the ${pt.by}'s` : '· every stage reached'}`);
  ctx.line(`  → ${pt.next_step.why}`);
  const c = curlOf(pt.next_step); if (c) ctx.line(`    ${p.faint(c)}`);
  return 0;
}

async function agent(ctx, chain, id) {
  const { p } = ctx;
  const r = await ctx.get(`/v1/agents/${chain}/${id}/readiness`, { quiet: true, key: false });
  const rd = r.json?.readiness ?? (r.json?.steps ? r.json : null);
  if (!r.ok || !rd) { ctx.fail(r.json?.error ?? `GET /v1/agents/${chain}/${id}/readiness answered ${r.status ?? r.error}`); return 1; }
  if (ctx.json) { ctx.emit({ ok: true, agent: `${chain}:${id}`, verdict: rd.verdict, steps: rd.steps.map((s) => ({ id: s.id, status: s.status })), next: rd.next, rails: rd.rails ?? null }); return 0; }
  ctx.line(rule(p, `${chain}:${id} · ${rd.verdict}`));
  ctx.line(`  ${rd.steps.map((s) => `${s.status === 'ok' ? '✓' : s.status === 'pending' ? '…' : '·'} ${s.id}`).join('  ')}`);
  if (rd.next) ctx.line(`  → ${rd.next.step} (the ${rd.next.who ?? 'layer'}'s): ${rd.next.why}`); else ctx.line('  → every step is ok');
  const t = rd.rails?.tee;
  if (t) {
    ctx.line('');
    ctx.line(`  ${p.accent('TEE rail')} ${p.faint(`claims ${t.claim.join(', ')}`)}`);
    ctx.line(`  ${stageMarks(Object.keys(t.stages), t.stages)}`);
    ctx.line(`  → ${t.stops_at ? `stops at ${t.stops_at} (the ${t.who}'s): ${t.why}${t.fix ? ` · ${t.fix}` : ''}` : t.why}`);
  }
  return 0;
}

export default {
  name: 'path',
  summary: 'where a seller stands on the standard path (discovered … settled; readiness; the TEE rail) and the one next transition',
  usage: [
    ['path [--json]', 'GET /v1/listings?view=path: sellers per stage by kind, ours apart from outside, and where they stop'],
    ['path <ls_…> [--json]', 'one listing: its stages, where it stops, who makes the next transition and the call'],
    ['path <chain>:<agentId> [--json]', 'one ERC-8004 agent: the readiness steps, the next one, and its TEE rail when it claims one'],
  ],
  valued: [],
  async run(ctx, rest) {
    if (rest.length > 1) { ctx.fail(`unexpected argument ${rest[1]} · taifoon help path`); return 2; }
    const s = subjectOf(rest[0]);
    if (s.kind === 'bad') { ctx.fail(`${s.error} · taifoon help path`); return 2; }
    return s.kind === 'all' ? all(ctx) : s.kind === 'listing' ? listing(ctx, s.id) : agent(ctx, s.chain, s.id);
  },
};
