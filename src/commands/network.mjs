// taifoon network — the network, live (GET /v1/network): the sellers the hourly auto-connect run reached, the chains'
// RPC rotation, the cross-chain routes, the gateway's steps today, and, with --pools, every coverage pool the address
// registry lists on Base, Arc and the devnet, read live on chain by the layer (_POOLS_LIVE_v1_; the same read as
// /v1/pools/state?chain=all). Read-only.
import { kv, rule } from '../brand.mjs';
import { renderPools } from '../pools-live.mjs';

export default {
  name: 'network',
  summary: 'the network, live: sellers, chains, routes, gateway steps today; --pools: every registry pool read live',
  usage: [
    ['network', 'GET /v1/network: sellers online, chains healthy, routes, gateway steps today'],
    ['network --pools', 'the pools section: every registry pool, TVL, cover capacity, encumbered, premium, deposits, last covered job'],
  ],
  valued: [],
  async run(ctx, rest) {
    const { p } = ctx;
    if (rest.length) { ctx.fail(`unexpected argument ${rest[0]} · taifoon help network`); return 2; }
    const r = await ctx.get('/v1/network', { key: false, timeoutMs: 30_000 });
    const j = r.json ?? {};
    // a 404 (no auto-connect snapshot yet) still carries the pools section
    if (!r.ok && !(r.status === 404 && j.pools)) { ctx.fail(`network: ${j.error ?? r.error ?? r.status}`); return 1; }
    if (ctx.f.pools === true) {
      const v = j.pools;
      if (ctx.json) { ctx.emit({ ok: Boolean(v && !v.unread), pools: v ?? null }); return v && !v.unread ? 0 : 1; }
      if (!v || v.unread) { ctx.fail(`network pools: unread${v?.why ? ` (${v.why})` : ''} · the full read: taifoon pools ls --live`); return 1; }
      renderPools(ctx, v, `GET /v1/network → pools (${r.ms} ms, metered; the same read as /v1/pools/state?chain=all)`);
      return 0;
    }
    if (ctx.json) { ctx.emit({ ok: r.ok, ...j }); return r.ok ? 0 : 1; }
    ctx.line(rule(p, `network · ${r.ok ? `published ${j.age_s ?? '—'} s ago${j.stale ? ' (stale)' : ''}` : 'no auto-connect snapshot yet'}`));
    const s = j.pools?.score;
    ctx.line(kv(p, [
      r.ok ? ['sellers', p.ink(`${j.sellers?.online ?? '—'} online of ${j.sellers?.classes ?? '—'} classes · median ${j.sellers?.median_latency_ms ?? '—'} ms`)] : null,
      r.ok ? ['chains', p.ink(`${j.chains_healthy ?? '—'} healthy`)] : null,
      r.ok ? ['routes', p.ink(`${j.routes_ok ?? '—'} with a live quote`)] : null,
      ['gateway', p.ink(`${j.gateway_today?.steps ?? 0} steps today (${j.gateway_today?.day ?? '—'})`)],
      ['pools', s ? p.ink(`${s.listed_of_registry}/${s.registry_pools} registry pools · ${s.values_read}/${s.values_shown} values read · taifoon network --pools`) : p.miss(`unread${j.pools?.why ? ` (${j.pools.why})` : ''}`)],
    ]));
    ctx.line(`\n  ${p.faint(`GET /v1/network · ${r.ms} ms`)}`);
    return 0;
  },
};
