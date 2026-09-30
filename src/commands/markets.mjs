// taifoon markets — every marketplace and ecosystem the layer interconnects, in one place (src/markets.mjs is the list).
//   markets ls                        status (live · devnet · discover-only · blocked, with why), seller counts, lane, one read each
//   markets search <query>            one query across every searchable marketplace at once
//   markets connect <marketplace>     what activates it (keys, MFA, decisions) and its zero-cost discovery
//   markets hire <marketplace> <ref>  the one pipeline: handshake → delivery → facts (grade on YOUR key) → settle plan (devnet)
import { panel, pill, rule, table, clip } from '../brand.mjs';
import { MARKETS, market, matrixRow, STATUSES } from '../markets.mjs';
import { n } from '../context.mjs';
import { savePlan } from '../config.mjs';
import { DEVNET, chainId, chainName, isMainnet } from '../registry.mjs';

const cols = (p) => [
  { key: 'id', title: 'market', fmt: (v) => p.accent(v) },
  { key: 'status', title: 'status', fmt: (v) => pill(p, v) },
  { key: 'sellers', title: 'sellers', align: 'right', fmt: (v) => (v === null || v === undefined ? p.faint('—') : n(v)) },
  { key: 'lane', title: 'lane', fmt: (v) => p.muted(String(v).split(' · ')[0]) },
  { key: 'note', title: 'what the read says', flex: true, fmt: (v) => p.faint(v ?? '') },
];

async function ls(ctx) {
  const { p } = ctx;
  const only = ctx.f.status ? String(ctx.f.status) : null;
  const list = MARKETS.filter((m) => !only || m.status === only);
  // one read per distinct discovery path, in parallel (the landscape is shared by two rows)
  const paths = [...new Set(list.map((m) => m.discover?.path).filter(Boolean))];
  const reads = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await ctx.get(path, { quiet: true, key: false })])));
  const rows = list.map((m) => {
    const r = m.discover ? reads[m.discover.path] : null;
    const c = r?.ok ? m.discover.count(r.json) : { sellers: null, note: r ? `read failed (${r.status ?? r.error})` : 'no public directory' };
    return { id: m.id, name: m.name, status: m.status, sellers: c.sellers, lane: m.lane, note: c.note, unblock: m.unblock, where: m.where, klass: m.klass, read: m.discover?.path ?? null, read_status: r?.status ?? null };
  });
  if (ctx.json) { ctx.emit({ ok: true, markets: rows }); return 0; }
  ctx.line(rule(p, `markets · ${rows.length} marketplaces and ecosystems`));
  ctx.line(table(p, cols(p), rows));
  const by = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  ctx.line('');
  ctx.line(`  ${STATUSES.map((s) => `${pill(p, s)} ${by[s]}`).join(p.faint('  ·  '))}   ${p.faint(`${ctx.calls.length} /v1 reads, metered · ${ctx.calls.reduce((a, c) => Math.max(a, c.ms), 0)} ms slowest`)}`);
  for (const r of rows.filter((x) => x.status !== 'live' && x.unblock)) ctx.line(`  ${pill(p, r.status === 'blocked' ? '✗' : '!')} ${p.accent(r.id.padEnd(13))} ${p.faint(clip(r.unblock, ctx.width - 22))}`);
  ctx.line(`  ${p.faint('taifoon markets connect <market> · search <query> · hire <market> <ref>')}`);
  return 0;
}

async function search(ctx, pos) {
  const { p } = ctx;
  const x = pos.join(' ').trim();
  if (!x) { ctx.fail('usage: taifoon markets search <query>'); return 2; }
  const list = MARKETS.filter((m) => m.search && (!ctx.f.market || m.id === ctx.f.market));
  const res = await Promise.all(list.map(async (m) => {
    const path = m.search.path(x);
    const r = await ctx.get(path, { quiet: true, key: false });
    const rows = r.ok ? m.search.rows(r.json, x).filter((row) => row.ref || row.name) : [];
    return { market: m.id, status: m.status, read: path.split('?')[0], http: r.status, rows: rows.slice(0, Number(ctx.f.limit ?? 5)), total: rows.length, error: r.ok ? null : (r.json?.error ?? r.error ?? `HTTP ${r.status}`) };
  }));
  if (ctx.json) { ctx.emit({ ok: true, query: x, results: res }); return 0; }
  ctx.line(rule(p, `search "${x}" · ${list.length} marketplaces at once`));
  let hits = 0;
  for (const g of res) {
    if (!g.rows.length) continue;
    hits += g.total;
    ctx.line(`\n  ${p.accent(g.market)} ${pill(p, g.status)} ${p.faint(`${g.total} match${g.total === 1 ? '' : 'es'} · ${g.read}`)}`);
    ctx.line(table(p, [
      { key: 'name', title: 'name', fmt: (v) => p.ink(clip(v ?? '', 34)) },
      { key: 'ready', title: 'ready', fmt: (v) => pill(p, v) },
      { key: 'ref', title: 'ref', fmt: (v) => p.muted(v ?? '') },
      { key: 'detail', title: 'detail', flex: true, fmt: (v) => p.faint(v ?? '') },
    ], g.rows));
  }
  const none = res.filter((g) => !g.rows.length && !g.error).map((g) => g.market);
  const failed = res.filter((g) => g.error);
  ctx.line('');
  if (none.length) ctx.line(`  ${p.faint(`no match in: ${none.join(', ')}`)}`);
  for (const g of failed) ctx.line(`  ${p.miss('!')} ${g.market}: ${p.faint(clip(g.error, 90))}`);
  ctx.line(`  ${p.faint(`${hits} matches · ${ctx.calls.length} /v1 reads, metered · hire one: taifoon markets hire <market> <ref>`)}`);
  return 0;
}

async function connect(ctx, pos) {
  const { p } = ctx;
  const m = market(pos[0]);
  if (!m) { ctx.fail(`name a marketplace: ${MARKETS.map((x) => x.id).join(', ')}`); return 2; }
  const r = m.discover ? await ctx.get(m.discover.path, { quiet: true, key: false }) : null;
  const c = r?.ok ? m.discover.count(r.json) : null;
  const sample = r?.ok && m.search ? m.search.rows(r.json, '').slice(0, 3) : [];
  const needs = m.needs ?? (m.unblock ? [`decision: ${m.unblock}`] : []);
  const out = { ok: true, market: matrixRow(m), discovery: r ? { read: m.discover.path, status: r.status, ms: r.ms, sellers: c?.sellers ?? null, note: c?.note ?? null, sample } : null, needs, active: m.status !== 'blocked' };
  if (ctx.json) { ctx.emit(out); return 0; }
  const body = [
    `${p.faint('status  ')} ${pill(p, m.status)}   ${p.faint('where')} ${p.ink(m.where)}`,
    `${p.faint('lane    ')} ${p.ink(m.lane)}   ${p.faint('class')} ${p.ink(m.klass)}`,
    `${p.faint('proof   ')} ${p.muted(m.proof)}`,
    `${p.faint('discover')} ${m.discover ? `${p.ink(m.discover.path)} ${r?.ok ? p.live(`${r.status} · ${r.ms} ms`) : p.miss(`${r?.status ?? r?.error}`)}` : p.faint('no public directory')}`,
    c ? `${p.faint('sellers ')} ${p.ink(n(c.sellers))} ${p.faint(c.note ?? '')}` : null,
  ].filter(Boolean);
  ctx.line(panel(p, `${m.name}`, body));
  if (sample.length) { ctx.line(`\n  ${p.faint('first rows of the discovery read')}`); ctx.line(table(p, [{ key: 'name', title: 'name', fmt: (v) => p.ink(clip(v ?? '', 36)) }, { key: 'ready', title: 'ready', fmt: (v) => pill(p, v) }, { key: 'ref', title: 'ref', flex: true, fmt: (v) => p.muted(v ?? '') }], sample)); }
  ctx.line('');
  if (needs.length) {
    ctx.line(`  ${p.you('to activate it')}`);
    for (const x of needs) ctx.line(`  ${p.you('→')} ${x}`);
  } else ctx.line(`  ${p.live('✓')} active: nothing to unlock. ${p.faint(`hire: taifoon markets hire ${m.id} <ref> (devnet settle plan by default)`)}`);
  return 0;
}

/**
 * The one pipeline, as the loop lanes run it: handshake (dispatch to the seller in its own protocol) → the held delivery →
 * the facts in code (judge/compose prepare: 0 Jev calls) → Jev only on YOUR TypeSafe key (--grade, TYPESAFE_KEY) → the settle
 * plan, unsigned, on the devnet unless --chain base with --yes and --cap-usdc. Without --send it prints the handshake body and
 * stops: the handshake contacts a third party, so it goes only when you say so.
 */
async function hire(ctx, pos) {
  const { p, t } = ctx;
  const m = market(pos[0]); const ref = pos[1];
  if (!m) { ctx.fail(`name a marketplace: ${MARKETS.map((x) => x.id).join(', ')}`); return 2; }
  if (m.hire?.kind === 'blocked') { ctx.fail(`${m.id} is blocked: ${m.unblock}. taifoon markets connect ${m.id}`); return 3; }
  if (m.hire?.kind === 'onchain') {
    const r = await ctx.get(m.discover.path, { quiet: true, key: false });
    const how = r.json?.how_to_hire ?? m.hire.how;
    if (ctx.json) { ctx.emit({ ok: true, market: m.id, kind: 'onchain', how_to_hire: how, note: 'an on-chain hire: the buyer signs every call; this CLI prints the plan and never sends on Base' }); return 0; }
    ctx.line(panel(p, `${m.name} · on-chain hire`, [p.muted('The buyer signs every call; the CLI prints the plan and never sends on Base.'), '', ...JSON.stringify(how, null, 1).split('\n').slice(0, 30).map((l) => p.ink(clip(l, 74)))]));
    return 0;
  }
  if (m.hire?.kind === 'mech') {
    const product = ref ?? 'grade';
    const body = { chainId: DEVNET, task: { product, subject: { text: String(ctx.f.task ?? 'hello from taifoon markets hire') } } };
    const r = await ctx.post('/v1/mech/plan', body, { key: false });
    if (ctx.json) { ctx.emit({ ok: r.ok, market: m.id, plan: r.json }); return r.ok ? 0 : 1; }
    if (!r.ok) { ctx.fail(`mech/plan: ${r.json?.error ?? r.status}`); return 1; }
    const plan = savePlan(ctx.env, { kind: 'mech.request', chainId: DEVNET, network: 'devnet', calls: r.json.calls ?? [], note: `TaifoonMech ${product}` });
    ctx.line(panel(p, `TaifoonMech · ${product} · devnet`, [`${p.faint('price')} ${p.ink(JSON.stringify(r.json.price ?? null))}`, ...(r.json.calls ?? []).map((c, i) => `${p.part(`${i + 1}. ${c.step ?? 'call'}`)} ${p.ink(c.to)} ${p.faint(`${String(c.data).slice(0, 18)}…`)}`), '', p.faint(`plan ${plan.id} saved · sign on the devnet: taifoon pools sign ${plan.id} --via kms:taifoon`)]));
    return 0;
  }
  if (m.hire?.kind === 'gateway') {
    const r = await ctx.get('/v1/gw/resources', { quiet: true, key: false });
    const g = (r.json?.resources ?? []).find((x) => x.id === ref || x.slug === ref);
    if (!g) { ctx.fail(`no gateway resource ${ref ?? ''}: taifoon markets search <tool> --market gateway`); return 2; }
    if (ctx.json) { ctx.emit({ ok: true, market: m.id, resource: g }); return 0; }
    ctx.line(panel(p, `gateway · ${g.id}`, [`${p.faint('point your MCP client at')} ${p.accent(g.url)}`, `${p.faint('instead of')} ${p.ink(g.endpoint)}`, `${p.faint('price')} ${p.ink(`${g.price?.amount ?? 0} ${g.price?.unit ?? ''}`)} ${p.faint(g.price?.rule ?? '')}`, p.faint('every call is forwarded unchanged, recorded as a λ step and counted (GET /v1/gw/steps?resource=…)')]));
    return 0;
  }
  if (!ref) { ctx.fail(`name the seller: taifoon markets hire ${m.id} <ref> (find one: taifoon markets search <query> --market ${m.id})`); return 2; }
  const chain = ctx.f.chain ? chainId(ctx.f.chain) : DEVNET;
  if (!chain) { ctx.fail(`unknown chain ${ctx.f.chain}`); return 2; }
  if (isMainnet(chain)) {
    const cap = Number(ctx.f['cap-usdc']);
    if (!(cap > 0)) { ctx.fail(`a settle plan on ${chainName(chain)} needs --cap-usdc <max price> and your explicit yes; the devnet (default) needs neither`); return 2; }
    if (!(await ctx.confirm(`plan a ${chainName(chain)} settlement capped at ${cap} USDC? (printed only; the CLI never sends on mainnet)`))) { ctx.fail('not confirmed: nothing planned on mainnet'); return 3; }
  }
  const task = String(ctx.f.task ?? '').trim();
  if (!task) { ctx.fail('describe the job: --task "<what the seller should do>" (and --class, --tool, --args \'{…}\' when the class needs them)'); return 2; }
  let args; try { args = ctx.f.args ? JSON.parse(String(ctx.f.args)) : undefined; } catch { ctx.fail('--args must be JSON'); return 2; }
  const hs = { candidate: m.hire.candidate(ref), task, dispatch: true, ...(ctx.f.class ? { class: String(ctx.f.class) } : {}), ...(ctx.f.tool ? { tool: String(ctx.f.tool) } : {}), ...(args ? { args } : {}) };
  const steps = [];
  t.step(1, 4, 'handshake (dispatch to the seller)');
  if (!ctx.f.send) {
    t.skip('not sent: a handshake contacts the seller. Add --send to open it (free; your key’s budget, or the visitor budget)');
    t.cmd(`curl -s -X POST https://${ctx.host}/v1/handshake -H 'content-type: application/json' -d '${JSON.stringify(hs)}'`);
    if (ctx.json) ctx.emit({ ok: true, market: m.id, sent: false, handshake: hs });
    return 0;
  }
  const h = await ctx.post('/v1/handshake', hs);
  const hid = h.json?.handshake_id ?? h.json?.handshake?.id ?? null;
  steps.push({ step: 'handshake', status: h.status, id: hid, state: h.json?.state ?? null, target: h.json?.target ?? null });
  if (!h.ok || !hid) { t.fail(`handshake refused: ${h.json?.error ?? h.status}`); if (ctx.json) ctx.emit({ ok: false, steps }); return 1; }
  t.ok(`handshake ${hid} · ${h.json.state ?? 'opened'} · ${h.json.target?.mode ?? ''}${h.json.target?.protocol ? ` over ${h.json.target.protocol}` : ''}${h.json.target?.url ? ` · ${h.json.target.url}` : ''}`, { ms: h.ms });
  t.step(2, 4, 'the delivery, held and digested');
  const d = await ctx.get(`/v1/handshake/${hid}`);
  const delivery = h.json.delivery ?? null;
  const digest = delivery?.reply_digest ?? null;
  steps.push({ step: 'delivery', status: d.status, state: d.json?.state ?? d.json?.handshake?.state ?? delivery?.state ?? null, digest, reply_head: delivery?.reply_head ?? null, latency_ms: delivery?.latency_ms ?? null });
  (digest ? t.ok : t.warn)(digest ? `reply held · ${delivery.reply_chars ?? '?'} chars · keccak ${digest}${delivery.latency_ms ? ` · seller answered in ${delivery.latency_ms} ms` : ''}` : `no reply held (${delivery?.status ?? h.json.state}${delivery?.reason ? `: ${delivery.reason}` : ''}); re-read GET /v1/handshake/${hid}`, { ms: d.ms });
  if (delivery?.reply_head) t.note(`reply: ${clip(String(delivery.reply_head).replace(/\s+/g, ' '), ctx.width - 12)}`);
  t.step(3, 4, 'facts in code, then the grade on your own key');
  const f = await ctx.post('/v1/judge/compose', { handshake_id: hid, mode: 'prepare' });
  const fx = f.json?.facts ?? null;
  steps.push({ step: 'facts', status: f.status, hard_fail: f.json?.hard_fail ?? null, judge_called: f.json?.judge_called ?? null, checks: fx?.checks ?? null, det: fx?.det ?? null });
  (f.ok && !f.json?.hard_fail ? t.ok : t.warn)(f.ok ? `facts in code: delivered ${fx?.delivered ?? '—'} · checks ${Object.entries(fx?.checks ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}${f.json?.hard_fail ? ' · HARD FAIL (a reject; Jev is not asked)' : ''} · judge called: ${f.json?.judge_called ? 'yes' : 'no'}` : `compose prepare: ${f.json?.error ?? f.status}`, { ms: f.ms });
  if (fx?.det?.why) t.note(`the class check (${fx.det.class}): ${clip(fx.det.why, ctx.width - 30)}`);
  const tsKey = ctx.env.TYPESAFE_KEY;
  if (ctx.f.grade && tsKey) {
    const g = await ctx.post('/v1/judge/compose', { handshake_id: hid, mode: 'answers', key: tsKey });
    steps.push({ step: 'grade', status: g.status, verdict: g.json?.verdict ?? null });
    (g.ok ? t.ok : t.warn)(g.ok ? `graded on your TypeSafe key: ${g.json?.verdict ?? '—'}` : `grade: ${g.json?.error ?? g.status}`, { ms: g.ms });
  } else t.skip(ctx.f.grade ? 'no TYPESAFE_KEY in the environment: no Jev call was made (bring your own key from console.typesafe.ai)' : 'grade skipped: add --grade with TYPESAFE_KEY set (Jev runs on your key only)');
  t.step(4, 4, `settle plan (${chainName(chain)}, unsigned)`);
  const seller = ctx.f.seller ?? null;
  const buyer = ctx.f.buyer ?? null;
  if (!seller || !/^0x[0-9a-fA-F]{40}$/.test(seller) || !buyer || !/^0x[0-9a-fA-F]{40}$/.test(buyer) || !digest) {
    t.skip(`settle plan needs --buyer 0x… (you) and --seller 0x… (its payout address) with a held reply; then POST /v1/settle { kind: agent, chainId: ${chain}, evidence: the reply digest, ref: ${hid} }`);
  } else {
    const units = String(Math.round(Number(ctx.f['price-usdc'] ?? 0.01) * 1e6));
    const s = await ctx.post('/v1/settle', { kind: 'agent', chainId: chain, buyer, seller, price: units, evidence: digest, ref: hid });
    steps.push({ step: 'settle', status: s.status });
    if (s.ok) { const plan = savePlan(ctx.env, { kind: 'hire.settle', chainId: chain, network: isMainnet(chain) ? 'mainnet' : 'devnet', calls: s.json?.calls ?? s.json?.plan?.calls ?? [], ref: hid }); t.ok(`plan ${plan.id} · ${plan.calls.length} calls, unsigned${isMainnet(chain) ? ' · MAINNET: printed only' : ''}`, { ms: s.ms }); }
    else t.warn(`settle: ${s.json?.error ?? s.status}`);
  }
  if (ctx.json) ctx.emit({ ok: true, market: m.id, handshake: hid, steps });
  return 0;
}

export default {
  name: 'markets',
  summary: 'every marketplace and ecosystem: status, search across all, connect, hire',
  usage: [
    ['markets ls [--status live|devnet|discover-only|blocked]', 'status, seller counts and lane of every marketplace'],
    ['markets search <query> [--market id] [--limit n]', 'one query across every searchable marketplace'],
    ['markets connect <market>', 'what activates it (keys, MFA, decisions) + its zero-cost discovery'],
    ['markets hire <market> <ref> --task "…" [--send] [--grade] [--buyer 0x…] [--chain devnet|base --cap-usdc n]', 'handshake → delivery → facts → your grade → settle plan'],
  ],
  subs: ['ls', 'search', 'connect', 'hire'],
  complete: (words) => (words.length >= 1 && ['connect', 'hire'].includes(words[0]) ? MARKETS.map((m) => m.id) : []),
  valued: ['status', 'market', 'limit', 'task', 'class', 'tool', 'args', 'chain', 'cap-usdc', 'price-usdc', 'buyer', 'seller'],
  async run(ctx, [sub = 'ls', ...rest]) {
    if (sub === 'ls' || sub === 'list') return ls(ctx);
    if (sub === 'search') return search(ctx, rest);
    if (sub === 'connect') return connect(ctx, rest);
    if (sub === 'hire') return hire(ctx, rest);
    ctx.fail(`unknown: markets ${sub} · taifoon help markets`); return 2;
  },
};
export { ls as marketsLs };
