// taifoon pools — coverage pools on every chain we maintain.
//   Moonbeam protocol pools (GLMR, V3 on Base): list, state, quote, pilot-partner info. They are NOT open: like the Moonbeam SDK
//   (POOLS_OPEN_ON = [36927]; PoolsNotOpenError on Base), this CLI builds no Base deposit, redemption or new pool for them.
//   Generic pools: every factory in the address registry (the Taifoon layer on Base and Arc, the devnet lines, V4 devnet lines).
//   create / deposit / redeem build UNSIGNED plans. The devnet 36927 is fully usable; a mainnet plan is printed with a warning and
//   nothing is ever sent by this CLI on mainnet. `pools sign` sends a DEVNET plan only, through kms-access or your own wallet,
//   after an explicit yes.
import { clip, panel, pill, rule, table } from '../brand.mjs';
import { dropPlan, listPlans, markPlan, readPlan, savePlan } from '../config.mjs';
import { renderPools } from '../pools-live.mjs';
import { DEVNET, chainId, chainName, defaultFactory, explorerAddr, factories, isMainnet, pickFactory, registryPools, token, tokenName } from '../registry.mjs';

export const DEVNET_RPC = 'https://rpc.taifoon.dev';
const SEL = { approve: '095ea7b3', redeem: 'ba087652', deposit: '6e553f65' }; // approve(address,uint256) · redeem(uint256,address,address) · deposit(uint256,address)
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const addrWord = (a) => { if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not an address: ${a}`); return a.slice(2).toLowerCase().padStart(64, '0'); };
export const encApprove = (spender, amount) => `0x${SEL.approve}${addrWord(spender)}${word(amount)}`;
export const encRedeem = (shares, receiver, owner) => `0x${SEL.redeem}${word(shares)}${addrWord(receiver)}${addrWord(owner)}`;
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ''));

/** "1,234.5" at `dec` decimals → units (cut, never rounded). */
export function units(str, dec) {
  const c = String(str).replace(/,/g, '').trim();
  if (!/^\d*\.?\d*$/.test(c) || !c || c === '.') throw new Error(`not an amount: ${str}`);
  const [w = '', f = ''] = c.split('.');
  return BigInt(w || '0') * 10n ** BigInt(dec) + BigInt((f + '0'.repeat(dec)).slice(0, dec) || '0');
}
export function fmt(v, dec = 18, show = 4) {
  if (v === null || v === undefined) return '—';
  const b = BigInt(v); const base = 10n ** BigInt(dec);
  const whole = (b / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return show ? `${whole}.${(b % base).toString().padStart(dec, '0').slice(0, show)}` : whole;
}

/** Moonbeam's GLMR pools on Base are not open. The one refusal, in the SDK's words. */
export const NOT_OPEN = 'GLMR pools on Base are not open yet: deposits, redemptions and new Moonbeam pools are built on the devnet (36927) only, as in the Moonbeam SDK (PoolsNotOpenError). Pool state, quotes and pilot-partner information stay readable.';
const moonbeamOnBase = (chain, line) => chain === 8453 && line === 'moonbeam';

/** `pools ls --live` (_POOLS_LIVE_v1_): every registry pool on Base, Arc and the devnet, read live by the layer. */
async function lsLive(ctx) {
  const r = await ctx.get('/v1/pools/state?chain=all', { key: false, timeoutMs: 30_000 });
  if (!r.ok) { ctx.fail(`pools/state?chain=all: ${r.json?.error ?? r.status ?? r.error}`); return 1; }
  if (ctx.json) { ctx.emit({ ok: true, ...r.json }); return 0; }
  renderPools(ctx, r.json, `GET /v1/pools/state?chain=all (${r.ms} ms, metered)`);
  return 0;
}

async function ls(ctx) {
  const { p } = ctx;
  if (ctx.f.live === true) return lsLive(ctx);
  const chain = ctx.f.chain ? chainId(ctx.f.chain) : 8453;
  if (!chain) { ctx.fail(`unknown chain ${ctx.f.chain}`); return 2; }
  const tenant = ctx.f.tenant ? String(ctx.f.tenant) : null;
  const r = await ctx.get(`/v1/pools/state?chain=${chain}${tenant ? `&tenant=${tenant}` : ''}`, { key: false });
  if (!r.ok) { ctx.fail(`pools/state: ${r.json?.error ?? r.status ?? r.error}`); return 1; }
  const pools = (r.json.pools ?? []).map((x) => ({
    address: x.address, tenant: x.tenant, seller: x.seller, asset: x.asset_symbol ?? tokenName(chain, x.asset) ?? x.asset,
    total: fmt(x.live?.totalAssets ?? x.net_assets_in, x.asset_decimals ?? 18, 2), free: fmt(x.live?.freeAssets, x.asset_decimals ?? 18, 2),
    premiums: x.premiums?.n ?? 0, deposits: x.deposits?.n ?? 0,
    open: moonbeamOnBase(chain, x.tenant === 'moonbeam' ? 'moonbeam' : 'layer') ? 'not open yet' : chain === DEVNET ? 'devnet · open' : 'plans only',
  }));
  const mb = pools.filter((x) => x.tenant === 'moonbeam').length;
  if (ctx.json) { ctx.emit({ ok: true, chain, pools, moonbeam: mb, routes: r.json.routes ?? [], not_open: chain === 8453 && mb ? NOT_OPEN : null }); return 0; }
  ctx.line(rule(p, `pools on ${chainName(chain)} · ${pools.length} (${mb} Moonbeam, ${pools.length - mb} other)`));
  if (chain === 8453 && mb) ctx.line(`  ${p.part('!')} ${p.part(NOT_OPEN)}\n`);
  ctx.line(table(p, [
    { key: 'address', title: 'pool' , fmt: (v) => p.ink(v) },
    { key: 'tenant', title: 'line', fmt: (v) => p.muted(v) },
    { key: 'asset', title: 'asset', flex: true, fmt: (v) => p.muted(v) },
    { key: 'total', title: 'assets', align: 'right' },
    { key: 'deposits', title: 'dep', align: 'right' },
    { key: 'open', title: 'new deposits', fmt: (v) => pill(p, v) },
  ], pools));
  for (const rt of r.json.routes ?? []) ctx.line(`\n  ${p.faint('route')} ${p.muted(`${rt.tenant}: job token ${tokenName(chain, rt.job_token) ?? rt.job_token} → pool asset ${tokenName(chain, rt.pool_asset) ?? rt.pool_asset}`)} ${p.faint(`oracle ${rt.oracle ?? 'none'}`)}`);
  ctx.line(`\n  ${p.faint(`read /v1/pools/state (${r.ms} ms, metered) · quote: taifoon pools quote <seller> · devnet: taifoon pools ls --chain devnet`)}`);
  return 0;
}

async function quote(ctx, [seller]) {
  const { p } = ctx;
  if (!isAddr(seller)) { ctx.fail('usage: taifoon pools quote <seller 0x…> [--price-usdc 1] [--chain base|arc|devnet] [--tenant moonbeam] [--class id]'); return 2; }
  const chain = ctx.f.chain ? chainId(ctx.f.chain) : 8453;
  // a Moonbeam quote is priced in GLMR (18 decimals); the layer's own in USDC
  const moon = ctx.f.tenant === 'moonbeam';
  const price = ctx.f.price ? { price: String(ctx.f.price) } : moon ? { price: units(String(ctx.f['price-glmr'] ?? 1), 18).toString() } : { price_usdc: Number(ctx.f['price-usdc'] ?? 1) };
  const body = { seller, chainId: chain, ...price, ...(ctx.f.tenant ? { tenant: String(ctx.f.tenant) } : {}), ...(ctx.f.class ? { class: String(ctx.f.class) } : {}) };
  const r = await ctx.post('/v1/pools/quote', body, { key: false });
  if (ctx.json) { ctx.emit({ ok: r.ok, quote: r.json }); return r.ok ? 0 : 1; }
  if (!r.ok) { ctx.fail(`pools/quote: ${r.json?.error ?? r.status}`); return 1; }
  const q = r.json; const rec = q.record ?? {};
  ctx.line(panel(p, `quote · ${seller} · ${chainName(chain)}${body.tenant ? ` · ${body.tenant}` : ''}`, [
    `${p.faint('guaranteed ')} ${q.guaranteed ? p.live('yes') : p.part('no')}   ${p.faint('premium')} ${p.ink(q.premium_label ?? '—')}   ${p.faint('deposit')} ${p.ink(q.deposit_rung ?? '—')}`,
    `${p.faint('pool       ')} ${p.ink(q.pool_id ?? 'none (deposit-only)')}`,
    `${p.faint('record     ')} ${p.ink(`n ${rec.n ?? 0} · ${rec.incorrect ?? 0} incorrect · Wilson ${Array.isArray(rec.wilson) ? rec.wilson.map((x) => Number(x.toFixed(4))).join('–') : '—'} · ${rec.calibrated ? 'calibrated' : 'not calibrated'}`)}`,
    ...(Array.isArray(q.why) ? q.why.slice(0, 4).map((w) => `${p.faint('why        ')} ${p.muted(clip(w, ctx.width - 18))}`) : []),
  ]));
  ctx.line(`  ${p.faint(`POST /v1/pools/quote · ${r.ms} ms · numbers are the layer's, copied, never computed here`)}`);
  return 0;
}

async function pilot(ctx) {
  const { p } = ctx;
  const r = await ctx.get('/v1/pools/state?chain=8453&tenant=moonbeam', { key: false });
  const mb = (r.json?.pools ?? []).filter((x) => x.tenant === 'moonbeam');
  const named = registryPools('moonbeam-acp', 8453);
  const pilots = named.filter((c) => /pilot/i.test(c.notes ?? ''));
  const out = { ok: true, pools_on_base: mb.length, registry_pools: named.length, pilot_pools: pilots.map((c) => ({ name: c.name, address: c.address, seller: c.seller ?? null, notes: c.notes })), open: false, not_open: NOT_OPEN,
    devnet: factories(DEVNET).filter((f) => f.line === 'moonbeam').map((f) => ({ name: f.name, address: f.address })) };
  if (ctx.json) { ctx.emit(out); return 0; }
  ctx.line(panel(p, 'Moonbeam protocol pools · pilot partners', [
    `${p.faint('pools on Base   ')} ${p.ink(`${mb.length} live V3 pools (the registry names ${named.length})`)} ${pill(p, 'not open yet')}`,
    ...pilots.flatMap((c) => [`${p.faint('pilot pool      ')} ${p.ink(c.address)} ${p.faint(c.name)}`, c.seller ? `${p.faint('   its seller   ')} ${p.ink(c.seller)}` : null].filter(Boolean)),
    `${p.faint('SDK             ')} ${p.muted('shared with pilot partners; it refuses Base pool calls (PoolsNotOpenError)')}`,
    `${p.faint('try it now      ')} ${p.muted('the same calls on the devnet 36927:')}`,
    ...out.devnet.map((f) => `${p.faint('                ')} ${p.ink(`${f.name} ${f.address}`)}`),
    `${p.faint('                ')} ${p.accent('taifoon pools create devnet dGLMR <seller> --line moonbeam')}`,
  ]));
  return 0;
}

async function listFactories(ctx) {
  const { p } = ctx;
  const chain = ctx.f.chain ? chainId(ctx.f.chain) : null;
  const a = await ctx.get('/v1/assurance', { key: false, quiet: true });
  const live = new Map((a.json?.chains ?? []).map((c) => [c.chainId, c]));
  const rows = factories(chain).map((f) => ({ ...f, chainName: chainName(f.chain), layer: live.get(f.chain)?.live ? 'live' : f.chain === DEVNET ? 'devnet' : '—',
    create: moonbeamOnBase(f.chain, f.line) ? 'not open yet' : f.chain === DEVNET ? 'devnet · open' : 'plan only (mainnet)' }));
  if (ctx.json) { ctx.emit({ ok: true, factories: rows }); return 0; }
  ctx.line(rule(p, `pool factories in the address registry · ${rows.length}`));
  ctx.line(table(p, [
    { key: 'chainName', title: 'chain', fmt: (v) => p.muted(v) }, { key: 'line', title: 'line', fmt: (v) => p.accent(v) },
    { key: 'address', title: 'factory', fmt: (v) => p.ink(v) }, { key: 'create', title: 'create', fmt: (v) => pill(p, v) },
    { key: 'name', title: 'name', flex: true, fmt: (v) => p.faint(v) },
  ], rows));
  return 0;
}

const chunks = (str, n) => { const out = []; for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n)); return out; };
const words = (str, n) => String(str).split(' ').reduce((ls, w) => { const last = ls[ls.length - 1]; if (last !== undefined && (last + ' ' + w).length <= n) ls[ls.length - 1] = last + ' ' + w; else ls.push(w); return ls; }, []);
function planPanel(ctx, plan, warn) {
  const { p } = ctx;
  const w = ctx.width - 12;
  const body = [];
  if (warn) body.push(p.miss(`MAINNET (${chainName(plan.chainId)}): printed only. This CLI never sends on mainnet; sign it in your own wallet if you mean it.`), '');
  plan.calls.forEach((c, i) => {
    body.push(`${p.part(`${i + 1}. ${c.step ?? c.action}`)} ${p.faint('to')} ${p.ink(c.to)}${c.retargeted_from ? p.faint(` (the calldata /v1 built for ${c.retargeted_from}; createPool is the same on every factory line)`) : ''}`);
    chunks(String(c.data), w).forEach((d, j) => body.push(`   ${p.faint(j ? '    ' : 'data')} ${p.muted(d)}`));
    if (c.effect) words(c.effect, w).forEach((d) => body.push(`   ${p.faint(d)}`));
  });
  body.push('', p.faint(`plan ${plan.id} saved to ~/.taifoon/plans`), p.faint(plan.network === 'devnet' ? `send it on the devnet: taifoon pools sign ${plan.id} --via kms:taifoon   or   --via wallet` : 'not signable from the CLI (mainnet)'));
  return panel(p, `${plan.kind} · ${chainName(plan.chainId)} · unsigned`, body);
}

async function create(ctx, [chainRaw, assetRaw, seller]) {
  const chain = chainId(chainRaw);
  if (!chain || !assetRaw || !isAddr(seller)) { ctx.fail('usage: taifoon pools create <chain> <asset symbol|0x…> <seller 0x…> [--line layer|moonbeam|v4|v4-glmr | --factory 0x…] [--name] [--symbol]'); return 2; }
  const f = pickFactory(chain, ctx.f.factory ?? ctx.f.line);
  if (!f) { ctx.fail(`no pool factory ${ctx.f.factory ?? ctx.f.line ?? ''} on ${chainName(chain)} in the address registry (taifoon pools factories)`); return 2; }
  if (moonbeamOnBase(chain, f.line)) { ctx.fail(NOT_OPEN); if (ctx.json) ctx.emit({ ok: false, refused: 'not_open', why: NOT_OPEN }); return 3; }
  const asset = isAddr(assetRaw) ? assetRaw : token(chain, assetRaw);
  if (!asset) { ctx.fail(`no token ${assetRaw} on ${chainName(chain)} in the address registry; pass its address`); return 2; }
  // the calldata comes from /v1 (the one encoder the site uses); createPool has the same signature on every factory line,
  // so a registry factory other than the default takes the same bytes, sent to its own address
  const tenant = f.line === 'moonbeam' ? 'moonbeam' : undefined;
  const r = await ctx.post('/v1/assurance/call', { chainId: chain, action: { kind: 'create-pool', seller, asset, ...(ctx.f.name ? { name: String(ctx.f.name) } : {}), ...(ctx.f.symbol ? { symbol: String(ctx.f.symbol) } : {}) }, ...(tenant ? { tenant } : {}) }, { key: false });
  if (!r.ok) { ctx.fail(`assurance/call create-pool: ${r.json?.error ?? r.status}`); return 1; }
  const dflt = defaultFactory(chain, tenant);
  const calls = (r.json.calls ?? []).map((c) => ({ ...c, step: 'createPool', to: f.address, ...(dflt && dflt.address.toLowerCase() !== f.address.toLowerCase() ? { retargeted_from: c.to } : {}) }));
  const plan = savePlan(ctx.env, { kind: 'pools.create', chainId: chain, network: isMainnet(chain) ? 'mainnet' : 'devnet', line: f.line, factory: f.address, seller, asset, calls });
  if (ctx.json) { ctx.emit({ ok: true, plan }); return 0; }
  ctx.line(planPanel(ctx, plan, isMainnet(chain)));
  ctx.line(`  ${ctx.p.faint(`factory ${f.name} · ${explorerAddr(chain, f.address) ?? ''}`)}`);
  return 0;
}

async function poolRow(ctx, chain, pool) {
  const r = await ctx.get(`/v1/pools/state?chain=${chain}&ids=${pool}`, { key: false });
  return (r.json?.pools ?? []).find((x) => x.address.toLowerCase() === pool.toLowerCase()) ?? null;
}

async function deposit(ctx, [pool, amount]) {
  const chain = ctx.f.chain ? chainId(ctx.f.chain) : DEVNET;
  if (!isAddr(pool) || !amount || !chain) { ctx.fail('usage: taifoon pools deposit <pool 0x…> <amount> --receiver 0x… [--chain devnet|base|arc] (devnet by default)'); return 2; }
  const row = await poolRow(ctx, chain, pool);
  if (!row) { ctx.fail(`${pool} is not a pool the layer indexes on ${chainName(chain)} (taifoon pools ls --chain ${chain})`); return 2; }
  if (moonbeamOnBase(chain, row.tenant === 'moonbeam' ? 'moonbeam' : 'layer')) { ctx.fail(NOT_OPEN); if (ctx.json) ctx.emit({ ok: false, refused: 'not_open', why: NOT_OPEN }); return 3; }
  const receiver = ctx.f.receiver;
  if (!isAddr(receiver)) { ctx.fail('--receiver 0x…: the address that receives the pool shares (your own wallet)'); return 2; }
  const dec = row.asset_decimals ?? 18; let amt;
  try { amt = units(amount, dec); } catch (e) { ctx.fail(e.message); return 2; }
  const r = await ctx.post('/v1/assurance/call', { chainId: chain, action: { kind: 'back-seller', pool, assets: amt.toString(), receiver }, ...(row.tenant === 'moonbeam' ? { tenant: 'moonbeam' } : {}) }, { key: false });
  if (!r.ok) { ctx.fail(`assurance/call back-seller: ${r.json?.error ?? r.status}`); return 1; }
  const approve = { step: 'approve', to: row.asset, data: encApprove(pool, amt), value: '0', effect: `Allow the pool to take exactly ${fmt(amt, dec)} ${row.asset_symbol ?? ''}. Never a standing allowance.` };
  const calls = [approve, ...(r.json.calls ?? []).map((c) => ({ ...c, step: 'deposit' }))];
  const plan = savePlan(ctx.env, { kind: 'pools.deposit', chainId: chain, network: isMainnet(chain) ? 'mainnet' : 'devnet', pool, receiver, amount: amt.toString(), calls });
  if (ctx.json) { ctx.emit({ ok: true, plan }); return 0; }
  ctx.line(planPanel(ctx, plan, isMainnet(chain)));
  return 0;
}

async function redeem(ctx, [pool, shares]) {
  const chain = ctx.f.chain ? chainId(ctx.f.chain) : DEVNET;
  if (!isAddr(pool) || !shares || !chain) { ctx.fail('usage: taifoon pools redeem <pool 0x…> <shares> --owner 0x… [--chain devnet|base|arc]'); return 2; }
  const row = await poolRow(ctx, chain, pool);
  if (!row) { ctx.fail(`${pool} is not a pool the layer indexes on ${chainName(chain)}`); return 2; }
  if (moonbeamOnBase(chain, row.tenant === 'moonbeam' ? 'moonbeam' : 'layer')) { ctx.fail(NOT_OPEN); if (ctx.json) ctx.emit({ ok: false, refused: 'not_open', why: NOT_OPEN }); return 3; }
  const owner = ctx.f.owner;
  if (!isAddr(owner)) { ctx.fail('--owner 0x…: the address that holds the shares (it signs; the assets go back to it)'); return 2; }
  let sh; try { sh = units(shares, 18); } catch (e) { ctx.fail(e.message); return 2; }
  const calls = [{ step: 'redeem', to: pool, data: encRedeem(sh, owner, owner), value: '0', effect: `Redeem ${fmt(sh)} shares for ${row.asset_symbol ?? 'the asset'} at today's value, up to what no open job holds.` }];
  const plan = savePlan(ctx.env, { kind: 'pools.redeem', chainId: chain, network: isMainnet(chain) ? 'mainnet' : 'devnet', pool, owner, shares: sh.toString(), calls });
  if (ctx.json) { ctx.emit({ ok: true, plan }); return 0; }
  ctx.line(planPanel(ctx, plan, isMainnet(chain)));
  return 0;
}

/** Send a DEVNET plan: through kms-access (the project's KMS key, inside its devnet cap) or print it for your own wallet. */
async function sign(ctx, [id]) {
  const { p } = ctx;
  const plan = id ? readPlan(ctx.env, id) : null;
  if (!plan) { ctx.fail(`no plan ${id ?? ''}: taifoon pools plans`); return 2; }
  if (plan.network !== 'devnet' || plan.chainId !== DEVNET) { ctx.fail(`plan ${plan.id} is on ${chainName(plan.chainId)}: the CLI never sends on mainnet. Sign it in your own wallet if you mean it.`); return 3; }
  const via = String(ctx.f.via ?? '');
  if (via === 'wallet' || !via) {
    const lines = plan.calls.map((c) => `cast send --rpc-url ${DEVNET_RPC} ${c.to} ${c.data} --ledger   # ${c.step ?? c.action} (or --trezor, or any wallet)`);
    if (ctx.json) { ctx.emit({ ok: true, plan: plan.id, sign_with_your_wallet: lines }); return 0; }
    ctx.line(`  ${p.faint('in order, from your own wallet (the CLI holds no key):')}`);
    for (const l of lines) ctx.line(`    ${p.faint('$')} ${l}`);
    return 0;
  }
  const m = /^kms:([a-z0-9-]+)$/.exec(via);
  if (!m) { ctx.fail('--via kms:<project> | wallet'); return 2; }
  if (!(await ctx.confirm(`send ${plan.calls.length} devnet call(s) of ${plan.id} with kms-access ${m[1]}?`))) { ctx.fail('not confirmed: nothing sent'); return 3; }
  const txs = [];
  for (const c of plan.calls) {
    const args = ['send', m[1], '--chain', String(DEVNET), '--rpc', DEVNET_RPC, '--to', c.to, '--data', c.data, '--yes'];
    const r = ctx.exec('kms-access', args);
    const tx = /0x[0-9a-fA-F]{64}/.exec(r.stdout)?.[0] ?? null;
    txs.push({ step: c.step ?? c.action, status: r.status, tx });
    if (r.status !== 0 || !tx) { ctx.fail(`kms-access send stopped at ${c.step ?? c.action} (exit ${r.status}${r.status === 3 ? ': needs an MFA session' : ''})`); markPlan(ctx.env, plan.id, { txs }); return 1; }
    ctx.t.ok(`${c.step ?? c.action} · ${tx}`);
  }
  markPlan(ctx.env, plan.id, { signed: true, txs, signed_via: via });
  if (ctx.json) ctx.emit({ ok: true, plan: plan.id, txs });
  return 0;
}

function plans(ctx, [sub, id]) {
  const { p } = ctx;
  if (sub === 'rm') { const ok = dropPlan(ctx.env, id); if (!ok) { ctx.fail(`no plan ${id}`); return 2; } ctx.line(`  ${p.faint(`dropped ${id}`)}`); return 0; }
  const all = listPlans(ctx.env);
  if (ctx.json) { ctx.emit({ ok: true, plans: all }); return 0; }
  if (!all.length) { ctx.line(`  ${p.faint('no plans: taifoon pools create | deposit | redeem build one')}`); return 0; }
  ctx.line(table(p, [
    { key: 'id', title: 'plan', fmt: (v) => p.accent(v) }, { key: 'kind', title: 'kind' }, { key: 'chainId', title: 'chain', fmt: (v) => chainName(v) },
    { key: 'signed', title: 'state', fmt: (v, r) => pill(p, v ? 'signed' : r.network === 'devnet' ? 'pending · devnet' : 'pending · mainnet (print only)') },
    { key: 'saved_at', title: 'saved', flex: true, fmt: (v) => p.faint(v) },
  ], all));
  return 0;
}

export default {
  name: 'pools',
  summary: 'Moonbeam protocol pools (read, quote, pilot) and generic pools on every chain we maintain (unsigned plans)',
  usage: [
    ['pools ls [--chain base|arc|devnet] [--tenant moonbeam|layer]', 'every pool and its state (/v1/pools/state)'],
    ['pools ls --live', 'every registry pool on Base, Arc and the devnet, read live: TVL, cover capacity, encumbered, premium, deposits, last covered job'],
    ['pools quote <seller> [--price-usdc n | --tenant moonbeam --price-glmr n] [--chain]', 'the terms one job would settle on'],
    ['pools pilot', 'Moonbeam pools: not open yet on Base; pilot partners; the devnet'],
    ['pools factories [--chain]', 'every pool factory in the address registry'],
    ['pools create <chain> <asset> <seller> [--line layer|moonbeam|v4|v4-glmr]', 'UNSIGNED createPool plan'],
    ['pools deposit <pool> <amount> --receiver 0x… [--chain]', 'UNSIGNED approve + deposit plan (devnet default)'],
    ['pools redeem <pool> <shares> --owner 0x… [--chain]', 'UNSIGNED redeem plan (devnet default)'],
    ['pools plans [rm <id>]', 'the plans kept in ~/.taifoon/plans'],
    ['pools sign <plan> --via kms:<project> | wallet', 'send a DEVNET plan after your yes (mainnet: never)'],
  ],
  subs: ['ls', 'quote', 'pilot', 'factories', 'create', 'deposit', 'redeem', 'plans', 'sign'],
  complete: (w) => (w[0] === 'create' && w.length === 1 ? ['base', 'arc', 'devnet'] : w[0] === 'ls' ? ['--chain', '--tenant', '--live'] : []),
  valued: ['chain', 'tenant', 'price-usdc', 'price-glmr', 'price', 'class', 'line', 'factory', 'name', 'symbol', 'receiver', 'owner', 'via'],
  async run(ctx, [sub = 'ls', ...rest]) {
    const h = { ls, list: ls, quote, pilot, factories: listFactories, create, deposit, redeem, sign, plans }[sub];
    if (!h) { ctx.fail(`unknown: pools ${sub} · taifoon help pools`); return 2; }
    return h(ctx, rest);
  },
};
