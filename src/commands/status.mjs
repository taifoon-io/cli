// taifoon status — one screen: the network (the layer, the root, every chain's RPC rotation), the session (profile, key,
// owner), the marketplaces by status, and the plans still waiting for a signature. `taifoon status <agent>` is the `up` walk's
// marks (kept, see up.mjs).
import { clip, panel, pill, rule, table } from '../brand.mjs';
import { listPlans, storeText } from '../config.mjs';
import { MARKETS, STATUSES } from '../markets.mjs';
import { chainName } from '../registry.mjs';

export async function dashboard(ctx) {
  const { p } = ctx;
  const k = ctx.keyInfo();
  const [root, net, who] = await Promise.all([
    ctx.get('/v1/root/latest', { key: false, quiet: true }),
    ctx.get('/v1/network', { key: false, quiet: true }),
    k.prefix ? ctx.get('/v1/relayer/whoami', { quiet: true }) : Promise.resolve(null),
  ]);
  const plans = listPlans(ctx.env).filter((x) => !x.signed);
  const chains = net.ok ? (net.json.chains ?? []) : [];
  const markets = Object.fromEntries(STATUSES.map((s) => [s, MARKETS.filter((m) => m.status === s).map((m) => m.id)]));
  const res = {
    ok: true,
    network: { layer: ctx.base, root: root.ok ? { epoch: root.json.epoch, anchor_age_s: root.json.cadence?.anchor_age_seconds ?? null, ms: root.ms } : { status: root.status }, chains: chains.map((c) => ({ chain: c.chain, name: c.name, ok: c.ok, head: c.head, latency_ms: c.latency_ms, usable: c.usable, why: c.why })), healthy: net.json?.chains_healthy ?? null },
    session: { profile: ctx.profile, mode: k.prefix ? 'key' : 'guest', key_prefix: k.prefix, source: k.source, valid: who ? who.ok : null, label: who?.json?.label ?? null, kind: who?.json?.kind ?? null, owner: ctx.prof.owner ?? null, store: storeText(ctx.prof), profiles: Object.keys(ctx.cfg.profiles ?? {}) },
    markets,
    plans: plans.map((x) => ({ id: x.id, kind: x.kind, chain: x.chainId, network: x.network, calls: x.calls?.length ?? 0, saved_at: x.saved_at })),
  };
  if (ctx.json) { ctx.emit(res); return 0; }
  const layerLine = root.ok ? `${p.live('●')} ${p.ink(ctx.host)} ${p.faint(`root epoch ${root.json.epoch} · anchored ${root.json.cadence?.anchor_age_seconds ?? '—'} s ago · ${root.ms} ms`)}` : `${p.miss('●')} ${p.ink(ctx.host)} ${p.miss(`root ${root.status ?? root.error}`)}`;
  ctx.line(panel(p, 'network', [layerLine, ...chains.map((c) => `${c.ok ? p.live('●') : p.miss('●')} ${p.ink(clip(`${c.name} ${c.chain}`, 26).padEnd(26))} ${c.ok ? p.faint(`head ${c.head} · ${c.usable}/${c.endpoints} RPCs · ${c.latency_ms} ms`) : p.miss(clip(c.why ?? 'down', 44))}`), net.ok ? p.faint(`${net.json.chains_healthy ?? '—'} chains healthy (GET /v1/network)`) : p.faint(`/v1/network: ${net.status ?? net.error}`)]));
  ctx.line(panel(p, 'session', [
    `${p.faint('profile ')} ${p.ink(ctx.profile)} ${p.faint(`(${res.session.profiles.length || 1} profile${res.session.profiles.length === 1 ? '' : 's'})`)}`,
    `${p.faint('key     ')} ${k.prefix ? `${p.accent(k.prefix)} ${who?.ok ? p.live('valid') : p.miss(`refused ${who?.status}`)} ${p.faint(clip(who?.json?.label ?? '', 34))}` : p.part('guest · visitor budget')}`,
    `${p.faint('store   ')} ${p.ink(k.source === 'env' ? 'TAIFOON_API_KEY (this run)' : res.session.store)}`,
    `${p.faint('owner   ')} ${res.session.owner ? p.you(res.session.owner) : p.faint('none (taifoon login --owner 0x…)')}`,
  ]));
  ctx.line(panel(p, 'marketplaces', STATUSES.map((s) => `${pill(p, s.padEnd(13))} ${p.ink(String(markets[s].length).padStart(2))} ${p.faint(clip(markets[s].join(', '), 56))}`)));
  if (plans.length) {
    ctx.line(rule(p, `plans waiting for a signature · ${plans.length}`));
    ctx.line(table(p, [{ key: 'id', title: 'plan', fmt: (v) => p.accent(v) }, { key: 'kind', title: 'kind' }, { key: 'chainId', title: 'chain', fmt: (v) => chainName(v) }, { key: 'network', title: 'where', fmt: (v) => pill(p, v === 'devnet' ? 'devnet' : 'mainnet · print only') }, { key: 'saved_at', title: 'saved', flex: true, fmt: (v) => p.faint(v) }], plans));
  } else ctx.line(`  ${p.faint('no plans waiting (taifoon pools create | deposit | redeem, register agent --uri, markets hire build them)')}`);
  ctx.line(`  ${p.faint(`${ctx.calls.length} /v1 reads · ${Math.max(...ctx.calls.map((c) => c.ms), 0)} ms slowest`)}`);
  return 0;
}
