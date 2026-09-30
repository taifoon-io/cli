// taifoon register — put an agent or a resource on the coordination layer, the /acp/onboard wizard's walk in the terminal.
//   register agent <chain>:<id> | --uri <agentURI> --chain <id>
//     1 identity   ERC-8004 record (ownerOf, tokenURI) — or the UNSIGNED register(agentURI) calldata for a new identity
//     2 card       the registration card, parsed and checked (name, endpoint, skills, presentable)
//     3 layer      POST /v1/agents/register { card_url, chainId, agentId }                         (skipped with --check)
//     4 enrich     the owner-signed enrich: the exact message to sign (EIP-191), POSTed back with --signature
//     5 probe      POST /v1/agents/probe { chainId, agentId } (with --check: the last probe on record)
//     6 verdict    hireable or not, and every step still open with who fixes it and how (readiness, the wizard's engine)
//   register resource <mcp|a2a|x402|rpc|gpu|mech> <endpoint|address>
//     the λ resource walk: register → probe → list → gateway URL and fee terms (docs/LAMBDA-GRID-DESIGN.md §5)
// The CLI never holds a private key: every signature is the owner's, made in their own wallet or hardware wallet.
import { clip, panel, pill } from '../brand.mjs';
import { savePlan } from '../config.mjs';
import { chainId, chainName } from '../registry.mjs';
import { parseAgent, runStep } from '../steps.mjs';

const W = 6;
const signHelp = (msg) => [
  'sign it as the ERC-8004 owner (EIP-191 personal_sign), in your own wallet:',
  `  cast wallet sign --ledger '${msg.replace(/'/g, "'\\''")}'      (or --trezor, or --interactive)`,
  '  or any wallet’s personal_sign with exactly this text; then run the same command with --signature 0x…',
];

async function agent(ctx, [refRaw]) {
  const { p, t } = ctx;
  const check = !!ctx.f.check;
  const out = { ok: true, check, steps: [] };
  const rec = (step, mark, fact, extra = {}) => { out.steps.push({ step, mark, fact, ...extra }); t.mark(mark, fact, extra.ms !== undefined ? { ms: extra.ms } : undefined); };
  // a new identity: only the unsigned register(agentURI)
  if (!refRaw && ctx.f.uri) {
    const chain = chainId(ctx.f.chain ?? 'base');
    if (!chain) { ctx.fail(`unknown chain ${ctx.f.chain}`); return 2; }
    t.step(1, 1, `identity: register(agentURI) on ${chainName(chain)}`);
    const r = await ctx.post('/v1/assurance/call', { chainId: chain, action: { kind: 'register-8004', agentURI: String(ctx.f.uri) } }, { key: false });
    if (!r.ok) { rec('identity', 'fail', `assurance/call register-8004: ${r.json?.error ?? r.status}`); if (ctx.json) ctx.emit({ ...out, ok: false }); return 1; }
    const plan = savePlan(ctx.env, { kind: 'register.8004', chainId: chain, network: chain === 36927 ? 'devnet' : 'mainnet', calls: r.json.calls.map((c) => ({ ...c, step: 'register' })) });
    rec('identity', 'ok', `unsigned register(agentURI) to ${r.json.calls[0].to} · plan ${plan.id}`, { ms: r.ms });
    t.note(r.json.calls[0].effect); t.cmd(`cast send --rpc-url <${chainName(chain)} RPC> ${r.json.calls[0].to} ${r.json.calls[0].data} --ledger`);
    t.next(`then: taifoon register agent ${chain}:<the new id from the Registered event>`);
    if (ctx.json) ctx.emit({ ...out, plan });
    return 0;
  }
  const a = parseAgent(refRaw);
  if (!a || !/^\d+$/.test(a.id)) { ctx.fail('usage: taifoon register agent <chain>:<agentId> [--check] [--card <url>] [--enrich \'{json}\' --signature 0x…] · or --uri <agentURI> --chain <id> for a new identity'); return 2; }
  const ref = `${a.chain}:${a.id}`;
  ctx.line(p.faint(`taifoon register agent ${ref}${check ? ' · --check: reads only, nothing registered or probed' : ''}`));

  // 1 identity
  t.step(1, W, 'identity (ERC-8004)');
  const id = await ctx.get(`/v1/agents/identity?ids=${a.id}&chain=${a.chain}`, { key: false });
  const rec8004 = id.json?.agents?.[0] ?? null;
  if (!rec8004?.exists) {
    rec('identity', 'warn', `no ERC-8004 agent ${ref}: mint one first (taifoon register agent --uri <your card URL> --chain ${a.chain})`, { ms: id.ms });
  } else {
    rec('identity', 'ok', `registered · owner ${rec8004.owner} · agentURI ${clip(rec8004.tokenURI ?? '—', 60)}`, { ms: id.ms, owner: rec8004.owner, uri: rec8004.tokenURI });
    // the calldata a NEW identity with this card would take: shown so the step is complete, never needed for an existing agent
    const c = await ctx.post('/v1/assurance/call', { chainId: a.chain, action: { kind: 'register-8004', agentURI: rec8004.tokenURI } }, { key: false, quiet: true });
    if (c.ok) t.note(`already registered; for reference, a new identity with this card is register(agentURI) to ${c.json.calls[0].to}, ${c.json.calls[0].data.length / 2 - 1} bytes of calldata, unsigned`);
  }

  // 2 card
  t.step(2, W, 'card');
  const card = await ctx.get(`/v1/agents/card/${a.chain}/${a.id}`, { key: false });
  const cd = card.json?.card ?? null;
  const problems = [];
  if (!cd) problems.push(card.json?.error ?? 'no card could be read');
  else {
    if (!cd.name) problems.push('no name');
    if (!cd.endpoint) problems.push('no endpoint the broker may call');
    if (!(cd.skills ?? []).length) problems.push('no skills');
    if (card.json?.presentable === false) problems.push('not presentable (a real name and description are needed on a hiring page)');
  }
  rec('card', problems.length ? 'warn' : 'ok', cd ? `${cd.name ?? '—'} · ${cd.endpoint ?? 'no endpoint'} · ${(cd.skills ?? []).length} skills${problems.length ? ` · ${problems.join('; ')}` : ''}` : problems[0], { ms: card.ms, problems });

  // 3 register with the layer
  t.step(3, W, 'register the card with the layer');
  const cardUrl = ctx.f.card ?? rec8004?.tokenURI ?? null;
  const regBody = { card_url: cardUrl, chainId: a.chain, agentId: Number(a.id) };
  if (check || !cardUrl) {
    t.skip(check ? 'skipped (--check): POST /v1/agents/register writes a registration row' : 'no card URL: pass --card <url>');
    t.cmd(`curl -s -X POST https://${ctx.host}/v1/agents/register -H 'content-type: application/json' -d '${JSON.stringify(regBody)}'`);
    out.steps.push({ step: 'layer', mark: 'skip', fact: 'not registered (--check)' });
  } else {
    const r = await ctx.post('/v1/agents/register', regBody);
    rec('layer', r.ok ? 'ok' : 'warn', r.ok ? `registered: ${r.json?.registered?.kind ?? ''} ${r.json?.registered?.endpoint ?? ''} · bound by ${r.json?.registered?.bound_by ?? '—'}` : `refused ${r.status}: ${clip(JSON.stringify(r.json?.problems ?? r.json?.error ?? ''), 120)}`, { ms: r.ms });
  }

  // 4 owner-signed enrich
  t.step(4, W, 'owner-signed enrich (EIP-191)');
  const data = ctx.f.enrich ? String(ctx.f.enrich) : null;
  const e = await ctx.get(`/v1/agents/${a.chain}/${a.id}/enrich${data ? `?data=${encodeURIComponent(data)}` : ''}`, { key: false });
  if (!data) {
    rec('enrich', 'skip', `optional: send what the harvest could not find (${Object.keys(e.json?.fields ?? {}).join(', ') || 'card_url, endpoints, skills, classes'}) with --enrich '{json}'`, { ms: e.ms });
  } else if (!e.json?.message) {
    rec('enrich', 'warn', `the layer did not accept that data: ${clip(JSON.stringify(e.json?.problems ?? e.json?.error), 120)}`, { ms: e.ms });
  } else if (!ctx.f.signature) {
    rec('enrich', 'warn', `owner signature needed (nonce ${e.json.nonce}, expires ${new Date(e.json.expires * 1000).toISOString()})`, { ms: e.ms, message: e.json.message });
    for (const l of signHelp(e.json.message)) t.note(l);
    if (ctx.prof.owner && rec8004?.owner && ctx.prof.owner.toLowerCase() !== rec8004.owner.toLowerCase()) t.note(`your login owner is not this agent's owner: the layer will refuse any other signer (403)`);
  } else if (check) {
    t.skip('skipped (--check): the signed enrich writes'); out.steps.push({ step: 'enrich', mark: 'skip' });
  } else {
    const r = await ctx.post(`/v1/agents/${a.chain}/${a.id}/enrich`, { data: JSON.parse(data), nonce: e.json.nonce, expires: e.json.expires, signature: String(ctx.f.signature) }, { key: false });
    rec('enrich', r.ok ? 'ok' : 'fail', r.ok ? 'enriched by the owner' : `refused ${r.status}: ${r.json?.error ?? ''}`, { ms: r.ms });
  }

  // 5 probe
  t.step(5, W, 'probe');
  if (check) {
    const pr = await runStep('probe', a, { get: (path) => ctx.get(path, { key: false, quiet: true }).then((x) => ({ status: x.status, json: x.json })), host: ctx.host, now: ctx.now, retry: `retry: taifoon register agent ${ref}` });
    rec('probe', pr.mark, `last probe on record: ${pr.fact}`, { ms: pr.ms });
  } else {
    const r = await ctx.post('/v1/agents/probe', { chainId: a.chain, agentId: Number(a.id) });
    const b = r.json?.best ?? r.json?.probe ?? null;
    rec('probe', r.ok && ['ready', 'x402'].includes(b?.status) ? 'ok' : 'warn', r.ok ? `${b?.status ?? '—'}${b?.protocol ? ` over ${b.protocol}` : ''}${b?.latency_ms ? ` · ${b.latency_ms} ms` : ''}${r.json?.why?.fix ? ` · fix: ${r.json.why.fix}` : ''}${r.json?.rested ? ' · rested (checked a moment ago)' : ''}` : `probe refused ${r.status}: ${r.json?.error ?? ''}`, { ms: r.ms });
  }

  // 6 the hireable verdict, with every open step and its fix
  t.step(6, W, 'hireable verdict');
  const rd = await ctx.get(`/v1/agents/${a.chain}/${a.id}/readiness`, { key: false });
  const r = rd.json?.readiness ?? null;
  if (!r) { rec('verdict', 'fail', `readiness could not be read (${rd.status})`); if (ctx.json) ctx.emit({ ...out, ok: false }); return 1; }
  const open = (r.steps ?? []).filter((s) => s.status !== 'ok');
  rec('verdict', r.hireable ? 'ok' : 'warn', `${String(r.verdict).replace(/_/g, ' ')} · ${r.counts?.ok ?? 0} ok · ${open.length} open${r.assured ? ' · assured' : ''}`, { ms: rd.ms, verdict: r.verdict, hireable: r.hireable, open: open.map((s) => ({ id: s.id, status: s.status, who: s.who, why: s.why })) });
  if (!ctx.json) {
    const body = (r.steps ?? []).map((s) => `${pill(p, s.status === 'ok' ? 'ok' : s.status)} ${p.ink(`${s.n}. ${s.id}`)} ${p.faint(clip(s.status === 'ok' ? s.title : `${s.who ? `${s.who}: ` : ''}${s.why ?? s.title}`, ctx.width - 30))}`);
    ctx.line(panel(p, `${ref} · ${r.hireable ? 'hireable' : 'not hireable yet'}`, body));
    if (r.next) { t.next(`next: ${r.next.step} (${r.next.who ?? '—'}) — ${clip(r.next.why ?? '', 90)}`); if (r.next.how?.kind === 'api') t.cmd(`curl -s -X ${r.next.how.method} https://${ctx.host}${r.next.how.path}${r.next.how.body ? ` -H 'content-type: application/json' -d '${JSON.stringify(r.next.how.body)}'` : ''}`); }
  }
  if (ctx.json) ctx.emit(out);
  return 0;
}

const RES_KINDS = ['mcp', 'a2a', 'x402', 'rpc', 'gpu', 'mech'];
async function resource(ctx, [kind, target]) {
  const { p, t } = ctx;
  if (!RES_KINDS.includes(kind) || !target) { ctx.fail(`usage: taifoon register resource <${RES_KINDS.join('|')}> <endpoint URL | mech address> [--check]`); return 2; }
  const out = { ok: true, kind, target, steps: [] };
  const rec = (step, mark, fact, extra = {}) => { out.steps.push({ step, mark, fact, ...extra }); t.mark(mark, fact, extra.ms !== undefined ? { ms: extra.ms } : undefined); };
  ctx.line(p.faint(`taifoon register resource ${kind} ${target} · λ: register → probe → list → gateway`));
  if (kind === 'rpc' || kind === 'gpu') {
    t.step(1, 2, `${kind}: the Grid's live rate and providers`);
    const g = await ctx.get(`/v1/grid/hire?kind=${kind}`, { key: false });
    const mine = (g.json?.providers ?? []).find((x) => String(x.endpoint ?? '').replace(/\/$/, '') === target.replace(/\/$/, ''));
    const qt = g.json?.quote ?? {};
    rec('listed', mine ? 'ok' : 'warn', `${mine ? `a Grid provider now · ${mine.trust ?? ''} · health ${mine.health ?? '—'} · ${mine.avgLatencyMs ?? '—'} ms` : 'not a Grid provider yet'} · rate ${qt.perUnitHourGrid ?? '—'} GRID per unit-hour (×${Number(qt.multiplier ?? 0).toFixed(2)}, ${qt.totalUsdc ?? '—'} USDC) · ${(g.json?.providers ?? []).length} usable ${kind} provider(s) · settlement ${qt.settlement ?? '—'}`, { ms: g.ms });
    t.step(2, 2, 'register');
    t.skip(kind === 'rpc'
      ? 'an RPC joins warmbed (probed: eth_chainId each cycle, capability every 10 min) — the self-serve signed registration (POST /v1/resources/register, EIP-712) is design P2; today the operator adds it'
      : 'a GPU joins as a lane behind the metered gpu-gate (a canary call proves it) — the operator adds the lane; self-serve registration is design P2');
    t.note('earning: soulbound GRID for every hour a probe passes (the oracle’s own probes, never the provider’s claim); money payouts need their own yes (§3.5)');
    if (ctx.json) ctx.emit(out);
    return 0;
  }
  if (kind === 'mech') {
    t.step(1, 1, 'the Olas marketplace record');
    const m = await ctx.get('/v1/olas/mechs', { key: false });
    const row = (m.json?.mechs ?? []).find((x) => x.mech?.toLowerCase() === target.toLowerCase());
    rec('listed', row ? 'ok' : 'warn', row ? `on the Olas marketplace · ${row.card?.name ?? '—'} · tools that answer: ${(row.hireable_tools ?? []).join(', ') || 'none lately'}` : 'not a mech on the Olas marketplace on Base (register it there first; our own TaifoonMech: taifoon markets connect taifoon-mech)', { ms: m.ms });
    if (ctx.json) ctx.emit(out);
    return 0;
  }
  let url; try { url = new URL(target); if (url.protocol !== 'https:') throw new Error(); } catch { ctx.fail('the endpoint must be an https URL'); return 2; }
  // register: who publishes it (an ERC-8004 record or a registered card)
  t.step(1, 4, 'register (who publishes this endpoint)');
  const lk = await ctx.get(`/v1/registry/lookup?url=${encodeURIComponent(url.href)}`, { key: false });
  const pubs = lk.json?.agents ?? [];
  rec('register', pubs.length ? 'ok' : 'warn', pubs.length ? `${pubs.length} agent(s) publish it: ${pubs.slice(0, 3).map((x) => `${x.chain_id}:${x.agent_id} (${x.match})`).join(', ')}` : 'no ERC-8004 record publishes it yet: put it in your card (taifoon register agent) or register the card URL', { ms: lk.ms });
  // probe
  t.step(2, 4, 'probe (handshake-level; no tools/call, no payment)');
  if (ctx.f.check) { t.skip('skipped (--check)'); out.steps.push({ step: 'probe', mark: 'skip' }); }
  else {
    const pr = await ctx.post('/v1/agents/probe', { url: url.href, kind });
    const b = pr.json?.probe ?? pr.json?.best ?? null;
    rec('probe', pr.ok && ['ready', 'x402'].includes(b?.status) ? 'ok' : 'warn', pr.ok ? `${b?.status ?? '—'}${b?.protocol ? ` over ${b.protocol}` : ''}${b?.tools?.length ? ` · ${b.tools.length} tools` : ''}${b?.latency_ms ? ` · ${b.latency_ms} ms` : ''}${pr.json?.why?.fix ? ` · fix: ${pr.json.why.fix}` : ''}` : `probe refused ${pr.status}: ${pr.json?.error ?? ''}`, { ms: pr.ms });
  }
  // list + gateway
  t.step(3, 4, 'listed on the gateway');
  const gw = await ctx.get('/v1/gw/resources', { key: false });
  const g = (gw.json?.resources ?? []).find((x) => x.endpoint === url.href || x.endpoint?.replace(/\/$/, '') === url.href.replace(/\/$/, ''));
  rec('list', g ? 'ok' : 'warn', g ? `listed as ${g.id}` : `not in the gateway table yet (${(gw.json?.resources ?? []).length} listed): a resource is listed once a class names it and its probe answers`, { ms: gw.ms });
  t.step(4, 4, 'gateway URL and fee terms');
  const gateways = gw.json?.gateways ?? {};
  const status = gateways[kind]?.status ?? (kind === 'mcp' ? 'live' : 'design');
  if (g) rec('gateway', 'ok', `${g.url} · price ${g.price?.amount ?? 0} ${g.price?.unit ?? ''} (${g.price?.rule ?? 'free resource'})`, { url: g.url });
  else rec('gateway', status === 'live' ? 'warn' : 'skip', `the ${kind} gateway is ${status}${status === 'live' ? `: once listed, clients call coord.taifoon.dev/gw/${kind}/<slug> instead of ${url.host}` : ' (LAMBDA-GRID-DESIGN §4)'}`);
  t.note('fee terms: free resources settle free today (settle_free); the gateway fee (per call on free, bps on paid) and the 70/20/10 payout are design, each awaiting your yes');
  if (ctx.json) ctx.emit(out);
  return 0;
}

export default {
  name: 'register',
  summary: 'register an ERC-8004 agent (calldata → card → layer → enrich → probe → verdict) or a resource (λ: register → probe → list → gateway)',
  usage: [
    ['register agent <chain>:<id> [--check] [--card url] [--enrich \'{…}\' --signature 0x…]', 'the onboarding walk; --check reads only'],
    ['register agent --uri <agentURI> --chain <id>', 'UNSIGNED register(agentURI) for a new ERC-8004 identity'],
    ['register resource <mcp|a2a|x402|rpc|gpu|mech> <endpoint> [--check]', 'the λ resource walk and its gateway terms'],
  ],
  subs: ['agent', 'resource'],
  complete: (w) => (w[0] === 'resource' && w.length === 1 ? RES_KINDS : []),
  valued: ['uri', 'chain', 'card', 'enrich', 'signature'],
  async run(ctx, [sub, ...rest]) {
    if (sub === 'agent') return agent(ctx, rest);
    if (sub === 'resource') return resource(ctx, rest);
    ctx.fail('taifoon register agent <chain>:<id> | register resource <kind> <endpoint>'); return 2;
  },
};
