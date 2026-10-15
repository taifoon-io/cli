// taifoon partners — the partner-bond lane for an enterprise partner on the Taifoon devnet (phase board items 15 and 20;
// units/7-enterprise-namespace). Reads only, and a planner: it never sends a transaction and never holds or asks for a key.
//   partners                              GET /v1/partners: the contracts, the asset, the notice, the lane's states and payout order
//   partners <ns>                         GET /v1/partners/<ns>: owner, bond, capSum, free, the pending withdrawal, its members (live)
//   partners <ns> <member>                GET /v1/partners/<ns>/members/<member>: cap, reserved, headroom, active, payout (live)
//   partners plan <action> --flag …       POST /v1/partners/plan: the unsigned calls, and the cast lines that send them on the devnet
// The calls, guards and words are the layer's own (the layer's partners module); nothing is restated here.
import { rule, pill } from '../brand.mjs';

export const ACTIONS = ['enrol', 'top_up', 'mint', 'set_cap', 'retire', 'request_withdraw', 'cancel_withdraw', 'withdraw', 'open_job', 'accept', 'submit', 'complete'];
/** The value flags `partners plan` takes; each goes into the body with - as _ (cover-cap → cover_cap). */
export const PLAN_FLAGS = ['ns', 'amount', 'member', 'payout', 'cap', 'partner', 'seller', 'buyer', 'price', 'deposit', 'premium', 'deadline', 'pool', 'cover-cap', 'evaluator', 'evaluator-fee', 'review-window', 'dispute-window', 'challenge-window', 'salt', 'job-id', 'evidence', 'from', 'payment-ref'];
const RPC = 'https://rpc.taifoon.dev';
const NS_RE = /^(0x[0-9a-fA-F]{64}|[A-Za-z0-9_-]{1,64})$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** The plan body from the action and the flags: the action, the plan flags with - as _, and --chain as chain_id. Pure. */
export function planBody(action, f) {
  const body = { action: String(action ?? '').replace(/-/g, '_') };
  for (const k of PLAN_FLAGS) if (f[k] !== undefined && f[k] !== true) body[k.replace(/-/g, '_')] = String(f[k]);
  if (f.chain !== undefined && f.chain !== true) body.chain_id = String(f.chain);
  return body;
}
/** The env var a signer's key is read from in the printed cast line (the CLI never sees it). Pure. */
export function keyVar(signer) { const s = String(signer ?? '').toLowerCase(); return s.startsWith('partner') ? 'PARTNER_KEY' : s.startsWith('buyer') ? 'BUYER_KEY' : s.startsWith('seller') || s.includes('member') ? 'MEMBER_KEY' : 'SIGNER_KEY'; }
/** One planned call as the cast line that sends it on the devnet, the key read from the signer's env var. Pure. */
export function castLine(call, rpc = RPC) { return `cast send ${call.to} ${call.data} --rpc-url ${rpc} --private-key "$${keyVar(call.signer)}"`; }

async function laneView(ctx) {
  const { p } = ctx;
  const r = await ctx.get('/v1/partners', { quiet: true, key: false });
  if (!r.ok || !r.json?.lane) { ctx.fail(r.json?.error ?? `GET /v1/partners answered ${r.status ?? r.error}`); return 1; }
  const j = r.json; const lane = j.lane;
  if (ctx.json) { ctx.emit(j); return 0; }
  ctx.line(rule(p, `the partner-bond lane · ${j.chain} ${j.chain_id}`));
  ctx.line(`  ${p.faint(lane.rule ?? '')}`);
  ctx.line('');
  ctx.line(`  PartnerBond  ${j.contracts.partner_bond.address}`);
  ctx.line(`  hook         ${j.contracts.hook.address}`);
  ctx.line(`  asset        ${j.contracts.asset.symbol} ${j.contracts.asset.address} (${j.contracts.asset.decimals} decimals) · notice ${j.notice}`);
  ctx.line(`  namespace    ${p.faint(j.namespace)}`);
  ctx.line('');
  ctx.line(`  ${p.accent('states')}  ${(lane.states ?? []).map((s) => s.id).join(' · ')}`);
  for (const t of lane.transitions ?? []) ctx.line(`  ${t.id.padEnd(17)} ${p.faint(`${t.from} → ${t.to}`.padEnd(30))} ${t.actor.padEnd(8)} ${p.faint(t.guard)}`);
  const po = lane.payout_order;
  if (po) {
    ctx.line('');
    ctx.line(`  ${p.accent('on a finding')} ${p.faint(po.on ?? '')}`);
    for (const o of po.order ?? []) ctx.line(`  ${o.n}. ${o.from} ${p.faint(`(up to ${o.bound})`)}`);
  }
  ctx.line('');
  ctx.line(`  ${p.faint('taifoon partners <ns> · taifoon partners <ns> <member> · taifoon partners plan <action> --ns … (actions: ' + ACTIONS.join(', ') + ')')}`);
  return 0;
}

async function partnerView(ctx, ns) {
  const { p } = ctx;
  const r = await ctx.get(`/v1/partners/${encodeURIComponent(ns)}`, { quiet: true, key: false });
  if (!r.ok) { ctx.fail(r.json?.error ?? `GET /v1/partners/${ns} answered ${r.status ?? r.error}`); return 1; }
  const j = r.json;
  if (ctx.json) { ctx.emit(j); return 0; }
  ctx.line(rule(p, `${j.namespace.label ?? j.namespace.ns} · ${j.state}`));
  ctx.line(`  ${p.faint(`ns ${j.namespace.ns} · ${j.namespace.how}`)}`);
  if (!j.enrolled) { ctx.line(`  ${pill(p, 'unenrolled')} nobody holds it · ${j.next ?? ''}`); return 0; }
  ctx.line(`  owner   ${j.owner}`);
  ctx.line(`  bond    ${j.bond} dUSDC · caps ${j.cap_sum} · free ${j.free}${j.invariant?.cap_sum_le_bond ? '' : p.faint('  (capSum > bond!)')}`);
  if (j.pending_withdrawal) ctx.line(`  pending ${j.pending_withdrawal.amount} dUSDC · ${j.pending_withdrawal.ready ? 'ready now' : `in ${j.pending_withdrawal.wait_s} s`}`);
  ctx.line(`  members ${j.members === null ? p.faint(j.members_basis) : j.members.length ? '' : 'none'}`);
  for (const m of j.members ?? []) ctx.line(`    ${m.member} ${p.faint(`minted ${m.minted_tx.slice(0, 12)}… block ${m.block}`)}`);
  ctx.line(`  ${p.faint(`block ${j.block} · ${j.cost?.http_requests ?? '?'} request`)}`);
  return 0;
}

async function memberView(ctx, ns, member) {
  const { p } = ctx;
  const r = await ctx.get(`/v1/partners/${encodeURIComponent(ns)}/members/${member}`, { quiet: true, key: false });
  if (!r.ok) { ctx.fail(r.json?.error ?? `GET /v1/partners/${ns}/members/${member} answered ${r.status ?? r.error}`); return 1; }
  const j = r.json;
  if (ctx.json) { ctx.emit(j); return 0; }
  ctx.line(rule(p, `${j.namespace.label ?? j.namespace.ns} · ${j.member} · ${j.state}`));
  if (!j.exists) { ctx.line(`  not a member · ${j.next ?? ''}`); return 0; }
  ctx.line(`  cap ${j.cap} dUSDC · reserved ${j.reserved} · headroom ${j.headroom} · ${j.active ? 'active' : 'retired'} · payout ${j.payout}`);
  ctx.line(`  ${p.faint(`partner ${j.partner_owner} · block ${j.block}`)}`);
  return 0;
}

async function planView(ctx, action) {
  const { p } = ctx;
  if (!ACTIONS.includes(String(action ?? '').replace(/-/g, '_'))) { ctx.fail(`partners plan <action>: one of ${ACTIONS.join(', ')}`); return 2; }
  const body = planBody(action, ctx.f);
  const r = await ctx.post('/v1/partners/plan', body, { quiet: true, key: false });
  if (!r.ok || !Array.isArray(r.json?.calls)) {
    const j = r.json ?? {};
    ctx.fail(`${j.code ? `${j.code}: ` : ''}${j.error ?? `POST /v1/partners/plan answered ${r.status ?? r.error}`}`);
    if (ctx.json) ctx.emit({ ok: false, status: r.status, ...j });
    return 1;
  }
  const j = r.json;
  const cast = j.calls.map((c) => castLine(c, j.rpc ?? RPC));
  if (ctx.json) { ctx.emit({ ...j, cast }); return 0; }
  ctx.line(rule(p, `plan ${j.action} · ${j.chain} ${j.chainId} · nothing sent`));
  if (j.namespace) ctx.line(`  ${p.faint(`ns ${j.namespace.ns} · ${j.namespace.how}`)}`);
  if (j.job?.job_id) ctx.line(`  job ${j.job.job_id} ${p.faint(`salt ${j.job.salt}`)}`);
  j.calls.forEach((c, i) => {
    ctx.line('');
    ctx.line(`  ${p.accent(`${i + 1}. ${c.step}`)} ${p.faint(`· ${c.signer}${c.from ? ` ${c.from}` : ''}`)}`);
    ctx.line(`     ${c.function} → ${c.to}`);
    ctx.line(`     ${p.faint(c.effect)}`);
    ctx.line(`     ${cast[i]}`);
  });
  ctx.line('');
  ctx.line(`  ${p.accent('guards')} ${p.faint('(checked by the contract when the call lands)')}`);
  for (const g of j.guards?.on_chain ?? []) ctx.line(`   · ${p.faint(g)}`);
  if (j.next) ctx.line(`  → ${j.next}`);
  ctx.line(`  ${p.faint('each signer sends its own call with its own key; this CLI never sends and never holds a key')}`);
  return 0;
}

export default {
  name: 'partners',
  summary: 'the partner-bond lane on the devnet: the lane, a namespace or member read live, and the unsigned calls of an action (never sent)',
  usage: [
    ['partners [--json]', 'GET /v1/partners: the contracts, the asset, the notice, the lane\'s states, transitions and payout order'],
    ['partners <ns> [--json]', 'one namespace (a label, hashed keccak256(utf8), or 0x… 32 bytes), live: owner, bond, caps, free, pending, members'],
    ['partners <ns> <member> [--json]', 'one member, live: cap, reserved, headroom, active, payout'],
    ['partners plan <action> --ns … [--json]', `the unsigned calls and the cast lines to send them (actions: ${ACTIONS.join(', ')}); amounts in dUSDC`],
  ],
  valued: PLAN_FLAGS,
  async run(ctx, rest) {
    if (rest[0] === 'plan') { if (rest.length > 2) { ctx.fail(`unexpected argument ${rest[2]} · taifoon help partners`); return 2; } return planView(ctx, rest[1]); }
    if (rest.length > 2) { ctx.fail(`unexpected argument ${rest[2]} · taifoon help partners`); return 2; }
    if (rest[0] === undefined) return laneView(ctx);
    if (!NS_RE.test(rest[0])) { ctx.fail(`"${String(rest[0]).slice(0, 70)}" is not a namespace: a label (letters, digits, - and _) or 0x… 32 bytes · taifoon help partners`); return 2; }
    if (rest[1] !== undefined && !ADDR_RE.test(rest[1])) { ctx.fail(`"${String(rest[1]).slice(0, 50)}" is not a 0x… member address`); return 2; }
    return rest[1] === undefined ? partnerView(ctx, rest[0]) : memberView(ctx, rest[0], rest[1]);
  },
};
