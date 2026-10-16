// taifoon balance: what your key holds (GET /v1/access/key): its balance, its monthly plan with what is left and the days
// left, and the rate it is held to. A plan in its last week says how to renew it.
import { kv, rule } from '../brand.mjs';

/** The rows of a key's standing, as text. Pure. */
export function balanceRows(j) {
  const rows = [];
  const b = j.balance ?? {};
  rows.push(['balance', b.unread ? 'not read; try again' : `${b.usdc} dollars (${b.grid} GRID)`]);
  // _LITTLE_DEBT_v1_: what metered work owes past the balance (the next top-up pays it first), its limit, and a pause with its reason
  const d = b.debt;
  if (d && d.state && d.state !== 'none') rows.push(['owed', `${d.owed_grid} GRID of a ${d.limit_grid} GRID limit · ${d.paused ? (d.reason === 'past_due' ? 'PAUSED: past due' : 'PAUSED: at the limit') + ' · taifoon buy 5 --chain base' : `due ${String(d.due_at ?? '').slice(0, 10)}`}`]);
  else if (d && Number(d.limit_grid) > 0) rows.push(['debt limit', `${d.limit_grid} GRID of metered work may run past the balance (GitHub-style; the next top-up pays it)`]);
  const pl = j.plan;
  if (pl?.active) {
    rows.push(['plan', `${pl.name}, ${pl.days_left} day${pl.days_left === 1 ? '' : 's'} left (ends ${String(pl.ends).slice(0, 10)})`]);
    rows.push(['allowance', `${pl.allowance.left_usdc} of ${pl.allowance.usdc} dollars left, spent before the balance`]);
    rows.push(['renews', pl.renewed_until ? `paid until ${String(pl.renewed_until).slice(0, 10)}` : 'never by itself']);
    if (pl.renew?.offered) rows.push(['renew', `taifoon buy ${pl.plan}`]);
  } else if (pl?.ended) rows.push(['plan', `${pl.ended.plan} ended ${String(pl.ended.on).slice(0, 10)} · taifoon buy ${pl.ended.plan}`]);
  else rows.push(['plan', 'none · taifoon buy plans']);
  if (j.limits?.per_family_per_minute) rows.push(['rate', `${j.limits.per_family_per_minute} calls a minute per family`]);
  if (j.key?.prefix) rows.push(['key', `${j.key.prefix}… (${j.tier})`]);
  return rows;
}

export default {
  name: 'balance',
  summary: 'what your key holds: its balance, its plan and the days left, the rate it is held to',
  usage: [['balance [--json]', 'GET /v1/access/key with your key']],
  async run(ctx, rest) {
    if (rest.length) { ctx.fail(`unexpected argument ${rest[0]} · taifoon help balance`); return 2; }
    if (!ctx.key()) { ctx.fail('no key on this run · taifoon login --free gets one, with no payment'); return 2; }
    const r = await ctx.get('/v1/access/key');
    if (!r.ok) { ctx.fail(`the key's standing: ${r.json?.error ?? r.error ?? `HTTP ${r.status}`}`); return 1; }
    if (ctx.json) { ctx.emit({ ok: true, ...r.json }); return 0; }
    ctx.line(rule(ctx.p, 'what this key holds'));
    ctx.line(kv(ctx.p, balanceRows(r.json)));
    if (Number(r.json.balance?.usdc ?? 0) === 0 && !r.json.plan?.active) ctx.line('  top up: taifoon buy 5 --chain base');
    return 0;
  },
};
