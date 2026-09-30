// _POOLS_LIVE_v1_ (launch round 11) — the live pools view in the terminal: `taifoon pools ls --live` reads
// GET /v1/pools/state?chain=all, `taifoon network --pools` reads the `pools` section of GET /v1/network (the same read on
// the layer). One renderer for both. Every number is the layer's, copied: a value the layer could not read prints
// "unread", never 0. Read-only: nothing here builds a call.
import { pill, rule, table } from './brand.mjs';
import { fmt } from './commands/pools.mjs';

const CHAIN = { 8453: 'Base', 5042: 'Arc', 36927: 'devnet' };

/** Normalise one pool row from either shape (/v1/pools/state?chain=all full row, or /v1/network's compact row). Pure. */
export function poolRow(x) {
  const full = typeof x.asset === 'object' && x.asset !== null;
  const dec = full ? x.asset.decimals : x.decimals;
  const un = new Set(x.unread ?? []);
  const amount = (k, v) => (un.has(k) || v === null || v === undefined ? 'unread' : dec === null || dec === undefined ? String(v) : fmt(v, dec, 2));
  const rate = full ? x.premium_rate?.rate : x.premium_rate;
  const last = x.last_covered_job ?? null;
  const open = full ? x.deposits?.open : x.open_for_deposits;
  const onChain = full ? x.deposits?.on_chain : x.deposits_on_chain;
  return {
    chain: CHAIN[x.chain_id] ?? String(x.chain_id), address: x.address, line: x.tenant ?? x.system ?? '—',
    asset: un.has('asset') ? 'unread' : (full ? x.asset.symbol : x.asset) ?? 'unread',
    tvl: amount('tvl', x.tvl), capacity: amount('cover_capacity', x.cover_capacity), encumbered: amount('encumbered', x.encumbered),
    premium: un.has('premium_rate') ? 'unread' : rate === null || rate === undefined ? (last ? 'no rate' : 'no job yet') : `${(rate * 100).toFixed(2)} %`,
    deposits: onChain === 'unread' ? (open === false ? 'closed (policy) · chain unread' : 'unread') : open === true ? 'open' : open === false ? (onChain === 'open' ? 'closed (policy)' : 'closed') : 'unread',
    last_job: un.has('last_covered_job') ? 'unread' : last ? last.job_id : '—', last_tx: last?.tx ?? null,
    unread: [...un],
  };
}

/** The table and its footer lines. `v` is { score, chains, pools } from either route. */
export function renderPools(ctx, v, source) {
  const { p } = ctx;
  const rows = (v.pools ?? []).map(poolRow);
  const s = v.score ?? {};
  ctx.line(rule(p, `pools, live · ${s.listed_of_registry ?? '—'}/${s.registry_pools ?? '—'} registry pools listed · ${s.values_read ?? '—'}/${s.values_shown ?? '—'} values read`));
  for (const c of v.chains ?? []) {
    const fac = (c.factories ?? []).map((f) => `${f.address} ${f.pool_count === null || f.pool_count === undefined ? 'poolCount unread' : `${f.pool_count} pool${f.pool_count === 1 ? '' : 's'}`}`).join(' · ');
    ctx.line(`  ${p.ink(String(c.chain ?? CHAIN[c.chain_id] ?? c.chain_id).padEnd(15))} ${p.faint(`registry ${c.registry_pools} · listed ${c.listed}${c.not_in_registry?.length ? ` · ${c.not_in_registry.length} not in the registry` : ''}`)}`);
    if (fac) ctx.line(`  ${' '.repeat(15)} ${p.faint(`factories: ${fac}`)}`);
  }
  ctx.line('');
  ctx.line(table(p, [
    { key: 'chain', title: 'chain', fmt: (x) => p.muted(x) },
    { key: 'address', title: 'pool', fmt: (x) => p.ink(x) },
    { key: 'line', title: 'line', fmt: (x) => p.muted(x) },
    { key: 'asset', title: 'asset', fmt: (x) => (x === 'unread' ? p.miss(x) : p.muted(x)) },
    { key: 'tvl', title: 'TVL', align: 'right', fmt: (x) => (x === 'unread' ? p.miss(x) : x) },
    { key: 'capacity', title: 'cover cap.', align: 'right', fmt: (x) => (x === 'unread' ? p.miss(x) : x) },
    { key: 'encumbered', title: 'encumb.', align: 'right', fmt: (x) => (x === 'unread' ? p.miss(x) : x) },
    { key: 'premium', title: 'premium', align: 'right', fmt: (x) => (x === 'unread' ? p.miss(x) : x) },
    { key: 'deposits', title: 'deposits', flex: true, fmt: (x) => pill(p, x) },
  ], rows));
  const jobs = rows.filter((r) => r.last_job !== '—');
  if (jobs.length) {
    ctx.line(`\n  ${p.faint('last covered job per pool')}`);
    for (const r of jobs) ctx.line(`  ${p.ink(r.address)} ${p.faint('job')} ${r.last_job === 'unread' ? p.miss('unread') : p.ink(r.last_job)}${r.last_tx ? ` ${p.faint('tx')} ${p.muted(r.last_tx)}` : ''}`);
  }
  ctx.line(`\n  ${p.faint(`amounts in the pool asset · premium = premium ÷ cover on the last covered job · "closed (policy)": the contract accepts deposits, the Moonbeam SDK and this CLI build none · unread = the read failed, never 0`)}`);
  ctx.line(`  ${p.faint(`${source} · new-job terms: taifoon pools quote <seller>`)}`);
  return rows;
}
