// taifoon cover — cover a job you bought elsewhere (_EXTERNAL_COVER_v1_). A pool pays what the market kept when nothing was
// delivered by the venue's deadline, or when an arbitrator's finding goes against the delivery; nothing otherwise.
//   quote   GET /v1/cover/quote: the layer's attestors read the job on its venue and sign a quote (or say why not)
//   buy     POST /v1/cover/buy: the exact transactions to send from your own wallet (an approval of exactly the premium,
//           then buyCover); this CLI never holds a key and never sends anything
//   policy  GET /v1/cover/policy/{id}: status, claim window, the signed ending and the transaction that settles it
//   ls      GET /v1/cover/policies?buyer=: your policies
// The quote is kept in ~/.taifoon/plans so `buy` can be run on it later.
import { kv, rule } from '../brand.mjs';
import { readPlan, savePlan } from '../config.mjs';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const B32 = /^0x[0-9a-fA-F]{64}$/;
const VENUES = ['erc8183', 'bitagent', 'memo-acp', 'x402', 'olas-mech'];

/** The checks a buy plan passes here before it is shown: one or two txs, to the asset (an approve of exactly the premium)
 *  then to the cover contract (buyCover, selector 0xec44ca96), no value, from the quote's buyer. Pure. */
export function checkBuyPlan(plan, quote) {
  const txs = plan?.txs;
  if (!Array.isArray(txs) || txs.length < 1 || txs.length > 2) return 'a buy is one or two transactions';
  for (const t of txs) {
    if (String(t.from).toLowerCase() !== String(quote.buyer).toLowerCase()) return 'a transaction is from another wallet than the quote’s buyer';
    if (t.value && BigInt(t.value) !== 0n) return 'a transaction sends coin';
  }
  const last = txs[txs.length - 1];
  if (!String(last.data).toLowerCase().startsWith('0xec44ca96')) return 'the last transaction is not buyCover';
  if (txs.length === 2) {
    const d = String(txs[0].data).toLowerCase();
    if (!/^0x095ea7b3[0-9a-f]{128}$/.test(d)) return 'the first transaction is not an approval';
    if (`0x${d.slice(34, 74)}` !== String(last.to).toLowerCase()) return 'the approval is not to the cover contract';
    if (BigInt(`0x${d.slice(74)}`) !== BigInt(quote.premium)) return 'the approval is not exactly the premium';
  }
  return null;
}

const refusal = (ctx, what, r) => { ctx.fail(`${what}: ${r.json?.error ?? (r.json?.why ?? []).join('; ') ?? r.error ?? `HTTP ${r.status}`}`); return r.status === 409 || r.status === 404 ? 1 : 2; };

async function quote(ctx) {
  const venue = String(ctx.f.venue ?? '');
  if (!VENUES.includes(venue)) { ctx.fail(`--venue is one of ${VENUES.join(', ')}`); return 2; }
  if (!ADDR.test(String(ctx.f.buyer ?? ''))) { ctx.fail('--buyer: your wallet (the job’s client)'); return 2; }
  const q = new URLSearchParams({ network: String(ctx.f.network ?? 'devnet'), venue, buyer: String(ctx.f.buyer) });
  for (const k of ['chain', 'job', 'cap', 'pay_to', 'amount', 'nonce', 'sla', 'mech', 'fee', 'data_hash']) if (ctx.f[k] !== undefined) q.set(k, String(ctx.f[k]));
  const r = await ctx.get(`/v1/cover/quote?${q}`, { key: false, timeoutMs: 60_000 });
  if (!r.ok) return refusal(ctx, 'not insurable now', r);
  const b = r.json;
  const saved = savePlan(ctx.env, { kind: 'cover', network: b.network, policy_id: b.policy_id, quote: b.quote, signatures: b.signatures, layer: ctx.base });
  if (ctx.json) { ctx.emit({ ok: true, id: saved.id, ...b }); return 0; }
  const { p } = ctx;
  ctx.line(rule(p, `Cover · ${b.job?.venue} job ${b.job?.job_id} · ${b.network}`));
  ctx.line(kv(p, [
    ['seller', b.quote.seller], ['price', b.quote.jobPrice], ['cover cap', b.quote.coverCap], ['premium', `${b.quote.premium} (${(b.price?.ratio * 100).toFixed(2)} %: ${b.price?.why})`],
    ['pool', b.quote.pool], ['valid until', new Date(Number(b.quote.validUntil) * 1000).toISOString()], ['policy', b.policy_id], ['saved as', saved.id],
  ]));
  ctx.line(`  ${b.rule}`);
  ctx.line(`  next: taifoon cover buy ${saved.id}`);
  return 0;
}

async function buy(ctx, rest) {
  const saved = readPlan(ctx.env, rest[0]);
  if (!saved || saved.kind !== 'cover') { ctx.fail('taifoon cover buy <saved quote id> (from taifoon cover quote)'); return 2; }
  const r = await ctx.post('/v1/cover/buy', { network: saved.network, quote: saved.quote, signatures: saved.signatures, from: saved.quote.buyer }, { timeoutMs: 30_000 });
  if (!r.ok) return refusal(ctx, 'the buy', r);
  const bad = checkBuyPlan(r.json, saved.quote);
  if (bad) { ctx.fail(`the plan is refused here: ${bad}`); return 1; }
  if (ctx.json) { ctx.emit(r.json); return 0; }
  ctx.line(rule(ctx.p, `Buy cover · policy ${r.json.policy_id}`));
  r.json.txs.forEach((t, i) => { ctx.line(`  ${i + 1}. ${t.what}`); ctx.line(`       to    ${t.to}`); ctx.line(`       data  ${t.data}`); ctx.line(`       chain ${t.chainId}`); });
  ctx.line('  send them in order from your own wallet (nothing is sent from here), then:');
  ctx.line(`  taifoon cover policy ${r.json.policy_id} --network ${saved.network}`);
  return 0;
}

async function policy(ctx, rest) {
  const id = rest[0];
  if (!B32.test(String(id ?? ''))) { ctx.fail('taifoon cover policy <policy id: 0x + 64 hex>'); return 2; }
  const r = await ctx.get(`/v1/cover/policy/${id}?network=${encodeURIComponent(String(ctx.f.network ?? 'devnet'))}`, { key: false, timeoutMs: 60_000 });
  if (!r.ok) return refusal(ctx, 'the policy', r);
  const b = r.json;
  if (ctx.json) { ctx.emit(b); return 0; }
  ctx.line(rule(ctx.p, `Policy ${id.slice(0, 10)}… · ${b.status}`));
  ctx.line(kv(ctx.p, [['says', b.says], ['cap', b.policy.coverCap], ['premium', b.policy.premium], ['claim window', `${new Date(b.claim_window.from * 1000).toISOString()} → ${new Date(b.claim_window.until * 1000).toISOString()}`],
    ['ending', b.claim?.ending ?? b.attestor?.pending ?? '—'], ['pays', b.claim ? String(!!b.claim.pays) : '—']]));
  if (b.claim?.txs?.length) { ctx.line(`  ${b.claim.note}:`); for (const t of b.claim.txs) { ctx.line(`       to    ${t.to}`); ctx.line(`       data  ${t.data}`); } }
  for (const l of b.ledger ?? []) ctx.line(`  ${l.kind.padEnd(8)} ${l.id}`);
  return 0;
}

async function ls(ctx) {
  if (!ADDR.test(String(ctx.f.buyer ?? ''))) { ctx.fail('--buyer: the wallet'); return 2; }
  const r = await ctx.get(`/v1/cover/policies?buyer=${ctx.f.buyer}&network=${encodeURIComponent(String(ctx.f.network ?? 'devnet'))}`, { key: false, timeoutMs: 60_000 });
  if (!r.ok) return refusal(ctx, 'the policies', r);
  if (ctx.json) { ctx.emit(r.json); return 0; }
  for (const x of r.json.policies) ctx.line(`  ${x.policyId}  ${String(x.status).padEnd(8)} cap ${x.coverCap} · premium ${x.premium} · ${x.says}`);
  if (!r.json.policies.length) ctx.line('  no policies');
  return 0;
}

export default {
  name: 'cover',
  summary: 'cover a job you bought elsewhere (Virtuals ACP, BitAgent, ERC-8183, x402, Olas): quote, buy (your wallet sends), policy status and claim',
  usage: [
    ['cover quote --venue erc8183|bitagent|memo-acp --job <id> --buyer 0x… [--chain id] [--cap units] [--network devnet]', 'a signed quote on a job you funded'],
    ['cover quote --venue x402 --pay_to 0x… --amount units --nonce 0x… --sla s --buyer 0x…', 'before an x402 payment (the quote names its nonce)'],
    ['cover quote --venue olas-mech --mech 0x… --fee units --data_hash 0x… --sla s --buyer 0x…', 'before an Olas request (the quote names its data hash)'],
    ['cover buy <saved id>', 'the exact transactions to send from your wallet'],
    ['cover policy <policy id> [--network devnet]', 'status, claim window, the signed ending, the settle transaction'],
    ['cover ls --buyer 0x… [--network devnet]', 'your policies'],
  ],
  subs: ['quote', 'buy', 'policy', 'ls'],
  valued: ['venue', 'job', 'buyer', 'chain', 'cap', 'network', 'pay_to', 'amount', 'nonce', 'sla', 'mech', 'fee', 'data_hash'],
  async run(ctx, rest) {
    const [sub, ...more] = rest;
    const f = { quote, buy, policy, ls }[sub];
    if (!f) { ctx.fail('taifoon cover quote | buy | policy | ls · taifoon help cover'); return 2; }
    return f(ctx, more);
  },
};
