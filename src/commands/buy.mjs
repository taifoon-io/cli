// taifoon buy: a balance or a monthly plan for your key, on any pay chain. This command never holds a private key and
// never sends anything on chain. It asks the layer for the quote (GET /v1/access/quote), prints the exact transfer to send
// from your own wallet and the exact message that wallet signs, keeps both in ~/.taifoon/plans, and, once you have the
// transaction and the signature, claims the credit (POST /v1/access/topup, /v1/access/plan or /v1/access/claim).
//   a balance   whole dollars, 100 GRID of service per dollar; it pays calls past the free allowance, grades, records and
//               gateway requests, and it does not end
//   a plan      builder-99, team-199 or protocol-299: 30 days, paid up front, nothing renews by itself
// The checks before anything is shown as payable: the call is a transfer(to, amount) of the quoted token, to the quoted
// payee, for the quoted units, and it sends no coin. A quote that fails one of them is refused, not printed.
import { kv, rule } from '../brand.mjs';
import { markPlan, readPlan, savePlan } from '../config.mjs';

const PLANS = ['builder-99', 'team-199', 'protocol-299'];
// _MARKET_ACCESS_v1_: an access id <kind>:<name> (coord lang/cue/access.cue), and the identity a seller seals epoch keys to
export const ACCESS_ID = /^(topic|venue|signals|board|dataset|match):[a-z0-9][a-z0-9._:-]{0,79}$/;
const RECIPIENT = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const SIG = /^0x[0-9a-fA-F]{130}$/;

/** The checks a quoted payment passes before it is shown: an ERC-20 transfer of the quoted units to the quoted payee. Pure. */
export function checkPay(pay) {
  if (!pay || typeof pay !== 'object') return 'the quote carries no payment';
  const c = pay.call ?? {};
  const d = String(c.data ?? '').toLowerCase();
  if (String(c.to ?? '').toLowerCase() !== String(pay.token ?? '').toLowerCase() || !/^0x[0-9a-f]{40}$/.test(String(pay.token ?? '').toLowerCase())) return 'the call is not to the quoted token';
  if (!/^0xa9059cbb[0-9a-f]{128}$/.test(d)) return 'the call is not a token transfer';
  if (`0x${d.slice(34, 74)}` !== String(pay.payee ?? '').toLowerCase()) return 'the transfer does not go to the quoted payee';
  if (!/^\d+$/.test(String(pay.amount_units ?? '')) || BigInt(`0x${d.slice(74)}`) !== BigInt(pay.amount_units)) return 'the transfer amount differs from the quote';
  if (c.value && BigInt(c.value) !== 0n) return 'the call sends coin';
  return null;
}

const refusal = (ctx, what, r) => { ctx.fail(`${what}: ${r.json?.error ?? r.error ?? `HTTP ${r.status}`}`); return r.status === 402 || r.status === 404 ? 1 : 2; };

async function quote(ctx, what) {
  const plan = PLANS.includes(what) ? what : null;
  const usdc = plan ? null : String(what ?? '');
  if (!plan && !/^\d{1,5}$/.test(usdc)) { ctx.fail(`buy what? a whole number of dollars (taifoon buy 5) or a plan (${PLANS.join(', ')})`); return 2; }
  const chain = ctx.f.chain === undefined ? '8453' : String(ctx.f.chain);
  const r = await ctx.get(`/v1/access/quote?${plan ? `plan=${plan}` : `usdc=${usdc}`}&chainId=${encodeURIComponent(chain)}`);
  if (!r.ok) return refusal(ctx, 'the quote', r);
  const q = r.json; const bad = checkPay(q.pay);
  if (bad) { ctx.fail(`the quote is refused here and nothing is saved: ${bad}`); return 1; }
  const saved = savePlan(ctx.env, { kind: 'buy', product: q.product, plan: q.plan?.id ?? null, chain_id: q.pay.chainId, network: q.pay.network, layer: ctx.base,
    call: { to: q.pay.call.to, data: q.pay.call.data, value: '0x0' }, token: q.pay.token, symbol: q.pay.symbol, amount: q.pay.amount, amount_units: q.pay.amount_units, payee: q.pay.payee,
    message: q.sign?.message ?? null, claim: q.claim ?? null });
  if (ctx.json) { ctx.emit({ ok: true, id: saved.id, quote: q }); return 0; }
  const { p } = ctx;
  ctx.line(rule(p, q.product === 'plan' ? `${q.plan.name} plan · 30 days` : `Buy GRID · ${q.credits.grid} GRID`));
  ctx.line(kv(p, [
    ['you pay', `${q.pay.amount} ${q.pay.symbol} on ${q.pay.network} (chain ${q.pay.chainId})`],
    ['to', q.pay.payee],
    ['you get', q.product === 'plan' ? `${q.plan.includes.usdc} dollars of metered use for 30 days, ${q.plan.rate.per_family_per_minute} calls a minute` : `${q.credits.usdc} dollars of balance on your key (${q.credits.grid} GRID)`],
    ['saved as', saved.id],
  ]));
  ctx.line('');
  ctx.line('  1. send this call from your own wallet (nothing is sent from here):');
  ctx.line(`       to    ${q.pay.call.to}`);
  ctx.line(`       data  ${q.pay.call.data}`);
  ctx.line('  2. sign this text with the same wallet (personal_sign), the transaction hash filled in:');
  if (q.sign?.message) for (const l of q.sign.message.split('\n')) ctx.line(`       ${l}`);
  else ctx.line('       no key on this run: taifoon login --free, then ask again so the message names your key');
  ctx.line(`  3. taifoon buy claim ${saved.id} --tx 0x… --signature 0x…`);
  if (q.for_a_person) { ctx.line(''); ctx.line(`  or pay in a browser wallet: ${q.for_a_person}`); }
  return 0;
}

async function claim(ctx, id) {
  const saved = id ? readPlan(ctx.env, id) : null;
  if (id && (!saved || saved.kind !== 'buy')) { ctx.fail(`no saved purchase ${id} · taifoon buy <dollars | plan> saves one`); return 2; }
  const tx = String(ctx.f.tx ?? ''); const signature = ctx.f.signature === undefined ? null : String(ctx.f.signature);
  if (!TX.test(tx)) { ctx.fail('--tx is the 32-byte hash of your transfer (0x and 64 hex characters)'); return 2; }
  if (signature !== null && !SIG.test(signature)) { ctx.fail('--signature is the 65-byte signature of the quoted message (0x and 130 hex characters)'); return 2; }
  const chainId = saved?.chain_id ?? (ctx.f.chain === undefined ? 8453 : ctx.f.chain);
  const body = { tx, chainId, ...(signature ? { signature } : {}) };
  // a saved purchase names its own claim; with none, the layer reads what the wallet signed (POST /v1/access/claim)
  const path = saved?.product === 'plan' ? '/v1/access/plan' : saved?.product === 'balance' ? '/v1/access/topup' : '/v1/access/claim';
  const r = await ctx.post(path, saved?.product === 'plan' ? { ...body, plan: saved.plan } : body);
  if (ctx.json) { ctx.emit({ ok: r.ok, status: r.status, ...(r.json ?? {}) }); return r.ok ? 0 : 1; }
  if (r.status === 404) { ctx.fail(`${r.json?.error ?? 'the transfer is not readable yet'} · run the same command again in a few seconds`); return 1; }
  if (r.status === 403 && r.json?.sign) {
    ctx.fail(r.json.error);
    const options = r.json.sign.options ?? [{ buys: 'this purchase', message: r.json.sign.message }];
    for (const o of options) { ctx.line(`  to claim ${o.buys}, sign with ${r.json.sign.signer}:`); for (const l of String(o.message).split('\n')) ctx.line(`       ${l}`); }
    return 1;
  }
  if (!r.ok) return refusal(ctx, 'the claim', r);
  if (saved) markPlan(ctx.env, saved.id, { signed: true, tx });
  const j = r.json; const { p } = ctx;
  if (j.plan?.active) ctx.line(kv(p, [['plan', `${j.plan.name}, ${j.plan.days_left} days left`], ['allowance', `${j.plan.allowance.left_usdc} of ${j.plan.allowance.usdc} dollars left`], ['ends', j.plan.ends], ['renews', 'never by itself']]));
  else ctx.line(kv(p, [['balance', `${j.balance?.usdc ?? '?'} dollars (${j.balance?.grid ?? '?'} GRID)`], ['credited', j.already ? 'nothing new: this transaction was already credited' : `${j.credited?.usdc ?? '?'} dollars`]]));
  return 0;
}


/** _MARKET_ACCESS_v1_: buy access to a resource once (POST /v1/access/buy): a product id or the access id it sells. Paid from what the
 *  key holds; a retry never pays twice; what you hold live is not bought again. */
async function access(ctx, what) {
  if (!what) { ctx.fail('buy access <product | access id> [--recipient 0x… | <base58>] · taifoon buy products lists them'); return 2; }
  const recipient = ctx.f.recipient === undefined ? null : String(ctx.f.recipient);
  if (recipient && !RECIPIENT.test(recipient)) { ctx.fail('--recipient is the identity of your POST /v1/pipe/keys statement: an EVM address or a base58 Ed25519 key'); return 2; }
  const body = { ...(ACCESS_ID.test(what) ? { resource: what } : { product: what }), ...(recipient ? { recipient } : {}) };
  const r = await ctx.post('/v1/access/buy', body);
  if (ctx.json) { ctx.emit({ ok: r.ok, status: r.status, ...(r.json ?? {}) }); return r.ok ? 0 : 1; }
  if (!r.ok) return refusal(ctx, 'the purchase', r);
  const j = r.json; const g = j.grant; const { p } = ctx;
  ctx.line(rule(p, j.already ? `Already held · ${g.resource}` : `Bought · ${g.resource}`));
  ctx.line(kv(p, [
    ['grant', g.grant_ref],
    ['product', g.product],
    ['paid', j.already ? 'nothing new' : `${g.paid.grid} GRID from your ${g.paid.from}`],
    ['until', g.until ?? (g.quota_left != null ? `${g.quota_left} reads` : '—')],
    ['entitled', (j.entitlements ?? []).join(', ') || '—'],
    ['recipient', j.recipient_key],
  ]));
  if (!j.already && j.agreement) ctx.line(p.dim ? p.dim(`  agreement ${j.agreement.feature} · ${j.agreement.hop} · ${j.agreement.legs.map((l) => `${l.leg} ${l.units} → ${l.to}`).join(' · ')}`) : `  agreement ${j.agreement.feature} · ${j.agreement.hop}`);
  return 0;
}

async function accessRead(ctx, path, key) {
  const q = ctx.f.resource === undefined ? '' : `?resource=${encodeURIComponent(String(ctx.f.resource))}`;
  const r = await ctx.get(`${path}${q}`, key ? undefined : { key: false });
  if (!r.ok) return refusal(ctx, path, r);
  if (ctx.json) { ctx.emit({ ok: true, ...r.json }); return 0; }
  const j = r.json;
  if (j.products) for (const x of j.products) ctx.line(`  ${x.product.padEnd(24)} ${x.resource.padEnd(26)} ${x.price_grid} GRID (${x.price_usdc} USDC) · ${x.term.period_days ? `${x.term.period_days} days` : `${x.term.quota} reads`} · ${x.seller}`);
  if (j.roster) for (const x of j.roster) ctx.line(`  ${String(x.prefix ?? '…').padEnd(16)} ${x.x25519 ?? `no key: ${x.missing}`}`);
  if (j.grants) { for (const g of j.grants) ctx.line(`  ${g.resource.padEnd(26)} ${g.state.padEnd(8)} ${g.until ?? ''} ${g.grant_ref}`); ctx.line(`  entitled: ${(j.entitlements ?? []).join(', ') || 'nothing'}`); }
  return 0;
}

export default {
  name: 'buy',
  summary: 'a balance (Buy GRID) or a monthly plan for your key, on Base, Arbitrum One, Arc, Monad or Robinhood Chain; nothing is sent from here',
  usage: [
    ['buy <dollars> [--chain <id | name>]', 'the quote for a balance: the transfer to send from your wallet and the message it signs'],
    ['buy <builder-99 | team-199 | protocol-299> [--chain <id | name>]', 'the quote for a monthly plan: 30 days, paid up front, nothing renews by itself'],
    ['buy claim [<saved id>] --tx 0x… --signature 0x… [--chain <id>]', 'credit the payment to your key; the same claim again adds nothing'],
    ['buy plans', 'the three plans, what each includes and where they are paid'],
    ['buy products [--resource <access id>]', 'what is for sale as resource access: access id, seller, price, term'],
    ['buy access <product | access id> [--recipient <identity>]', 'buy access once (also: taifoon buy <access id>); your stream then carries what you bought'],
    ['buy grants [--resource <access id>]', 'your grants and entitlements; a seller’s roster with --resource'],
  ],
  valued: ['chain', 'tx', 'signature', 'recipient', 'resource'],
  async run(ctx, rest) {
    const [what, id] = rest;
    if (!what) { ctx.fail(`taifoon buy <dollars | ${PLANS.join(' | ')}> [--chain base | arbitrum | arc | monad | robinhood] · taifoon help buy`); return 2; }
    if (what === 'claim') return claim(ctx, id);
    if (what === 'access') return access(ctx, id);
    if (ACCESS_ID.test(what)) return access(ctx, what);
    if (what === 'products') return accessRead(ctx, '/v1/access/products', false);
    if (what === 'grants') return accessRead(ctx, '/v1/access/grants', true);
    if (what === 'plans') {
      const r = await ctx.get('/v1/access/plan', { key: false });
      if (!r.ok) return refusal(ctx, 'the plans', r);
      if (ctx.json) { ctx.emit({ ok: true, ...r.json }); return 0; }
      for (const x of r.json.plans) ctx.line(`  ${x.id.padEnd(14)} ${x.price.usdc} dollars for ${x.days} days · ${x.includes.usdc} dollars of metered use · ${x.rate.per_family_per_minute} calls a minute`);
      ctx.line(`  paid on ${r.json.paid_on.map((c) => `${c.name} (${c.pays_in})`).join(', ')}; nothing renews by itself`);
      return 0;
    }
    return quote(ctx, what);
  },
};
