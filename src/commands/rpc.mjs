// taifoon rpc — our RPC per chain (_CLI_FINISH_v1_, 2026-10-17). One card per chain from coord's rpc-cards register (lang/cue/rpc-resale.cue
// → lang/gen/rpc-cards.json, vendored here by `coord gen`, row rpc-cards-cli), beside the live rotation the gateway reads (GET /v1/rpc).
//   rpc                  every chain: healthy now, plain and proved price per 1M, WebSocket, the cheapest market price we know
//   rpc <chain>          one chain: its card, its endpoints and the rotation's best endpoints with their health
//   rpc key              how to read with your key: the gateway URL, the header, one curl (the key itself is never printed)
//   rpc test <chain>     eth_blockNumber through the gateway with your key: the block, the latency, the λ step header
// No new API: /v1/rpc, /v1/rpc/{chain} and /gw/rpc/{chain} are the gateway's own routes.
import { readFileSync } from 'node:fs';
import { rule, kv, table } from '../brand.mjs';

const CARDS = JSON.parse(readFileSync(new URL('../generated/coord-lang/rpc-cards.json', import.meta.url), 'utf8'));
/** eip155:8453 → 8453; a non-EVM chain keeps its name (solana:mainnet → solana). Pure. */
const idOf = (caip) => (String(caip).startsWith('eip155:') ? Number(String(caip).split(':').pop()) : String(caip).split(':')[0]);
const ALIAS = { base: 8453, arbitrum: 42161, arb: 42161, arc: 5042, ethereum: 1, eth: 1, mainnet: 1, bsc: 56, bnb: 56, avalanche: 43114, avax: 43114, polygon: 137, optimism: 10, op: 10, robinhood: 4663, celo: 42220, devnet: 36927, taifoon: 3692781, monad: 143, gnosis: 100, unichain: 130 };
/** a chain argument → its id (a number, a CAIP-2 id or a name). Pure. */
export function chainArg(s) {
  if (s === undefined || s === null || s === '') return null;
  const t = String(s).toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  if (/^eip155:\d+$/.test(t)) return idOf(t);
  if (t === 'solana' || t.startsWith('solana:')) return 'solana';
  return ALIAS[t] ?? CARDS.cards.map((c) => [c.name.toLowerCase(), idOf(c.chain)]).find(([n]) => n === t || n.startsWith(t))?.[1] ?? null;
}
/** the card of a chain id, or null. Pure. */
export const cardOf = (id) => CARDS.cards.find((c) => idOf(c.chain) === id) ?? null;
const usdc = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(2)}`);

export default {
  name: 'rpc',
  summary: 'our RPC per chain: the gateway, WebSocket, proved reads and the price per 1M, with the rotation’s health now; your key in one curl',
  usage: [
    ['rpc [--json]', 'every chain: healthy now, plain and proved price per 1M (USDC), WebSocket, the cheapest market price we know'],
    ['rpc <chain> [--json]', 'one chain (id, name or eip155:id): its card, endpoints and the best endpoints of the rotation now'],
    ['rpc key', 'how to read with your key: the gateway URL, the header and one curl (the key is never printed)'],
    ['rpc test <chain>', 'eth_blockNumber through the gateway with your key: block, latency and the λ step header'],
  ],
  valued: [],
  async run(ctx, rest) {
    const { p } = ctx;
    const [sub, arg] = rest;
    if (sub === 'key') return keyHelp(ctx);
    if (sub === 'test') return test(ctx, arg);
    if (sub && sub !== 'ls') return one(ctx, sub);
    const live = await ctx.get('/v1/rpc', { key: false });
    const health = new Map((live.json?.chains ?? []).map((c) => [c.chain, c]));
    const rows = CARDS.cards.map((c) => ({ id: idOf(c.chain), card: c, live: health.get(idOf(c.chain)) ?? null }));
    if (ctx.json) { ctx.emit({ ok: true, cards_at: CARDS.cards[0]?.verified?.at ?? null, gateway_chains: live.json?.gateway?.chains?.length ?? null, chains: rows.map((r) => ({ chain: r.id, name: r.card.name, healthy: r.live?.healthy ?? null, price_usdc_per_1m: r.card.price_usdc_per_1m, ws: r.card.endpoints?.ws ?? null, ws_why: r.card.verified?.ws_why ?? null, proved: r.card.verified?.proved ?? null, market_low: r.card.market_low ?? null, gateway: r.card.endpoints?.gateway })) }); return 0; }
    ctx.line(rule(p, `rpc · ${rows.length} chains with a card · ${live.json?.gateway?.chains?.length ?? '—'} behind the gateway`));
    ctx.line(table(p, [
      { key: 'id', title: 'chain', fmt: (v) => p.accent(String(v)) },
      { key: 'name', title: 'name', flex: true },
      { key: 'now', title: 'now' },
      { key: 'plain', title: 'plain/1M', align: 'right' },
      { key: 'proved', title: 'proved/1M', align: 'right' },
      { key: 'ws', title: 'ws' },
      { key: 'low', title: 'market low', flex: true, fmt: (v) => p.faint(v) },
    ], rows.map((r) => ({
      id: r.id, name: r.card.name,
      now: r.live ? (r.live.healthy ? p.live('healthy') : p.part('degraded')) : p.faint('not probed'),
      plain: usdc(r.card.price_usdc_per_1m?.plain), proved: usdc(r.card.price_usdc_per_1m?.proved),
      ws: r.card.endpoints?.ws ? p.live('yes') : p.faint('no'),
      low: r.card.market_low ? `${r.card.market_low.provider} ${usdc(r.card.market_low.usdc_per_1m)}` : '—',
    })), ctx.width));
    const noWs = rows.filter((r) => !r.card.endpoints?.ws).map((r) => r.card.verified?.ws_why).find(Boolean);
    if (noWs) ctx.line(`  ${p.faint(`WS: ${noWs}`)}`);
    ctx.line(`  ${p.faint('prices in USDC · taifoon rpc <chain>: one card · taifoon rpc key: read with your key · taifoon rpc test <chain>')}`);
    return 0;
  },
};

async function one(ctx, s) {
  const { p } = ctx;
  const id = chainArg(s);
  const c = id === null ? null : cardOf(id);
  if (!c) { ctx.fail(`no RPC card for ${s}: taifoon rpc lists the chains (${CARDS.cards.map((x) => idOf(x.chain)).join(', ')})`); return 1; }
  const evm = typeof id === 'number';
  const r = evm ? await ctx.get(`/v1/rpc/${id}`, { key: false }) : { ok: false, status: null, json: null };
  const best = (r.json?.call ?? []).slice(0, 3);
  if (ctx.json) { ctx.emit({ ok: true, card: c, rotation: r.json ?? null }); return 0; }
  ctx.line(rule(p, `rpc · ${c.name} · ${id}`));
  ctx.line(kv(p, [
    ['gateway', c.endpoints?.gateway ?? '—'],
    ['websocket', c.endpoints?.ws ?? `none: ${c.verified?.ws_why ?? 'not verified'}`],
    ['proved reads', c.endpoints?.proved ? `${c.endpoints.proved} · ${c.verified?.proved ?? ''}` : '—'],
    ['price / 1M', `plain ${usdc(c.price_usdc_per_1m?.plain)} USDC · proved ${usdc(c.price_usdc_per_1m?.proved)} USDC`],
    ['market low', c.market_low ? `${c.market_low.provider} ${usdc(c.market_low.usdc_per_1m)} USDC (${c.market_low.source})` : '—'],
    ['send relay', c.send_relay ?? '—'],
    ['upstream', c.upstream ?? '—'],
    ['doors', (c.doors ?? []).join(' · ') || '—'],
    ['now', !evm ? 'no rotation: the gateway serves EVM chains only' : r.ok ? `${r.json.healthy ? 'healthy' : 'degraded'} · best ${r.json.best ?? '—'}` : `the warmbed rotation holds no health read for this chain (${r.status ?? 'no answer'}); the gateway still serves it: taifoon rpc test ${id}`],
  ], 13));
  for (const e of best) ctx.line(`    ${p.faint((e.status ?? '').padEnd(10))}${String(e.avg_latency_ms ?? '—').padStart(5)} ms  ${p.faint(`${Math.round((e.success_rate ?? 0) * 1000) / 10} % ok`)}  ${e.url}`);
  if (evm) ctx.line(`  ${p.faint(`taifoon rpc test ${id}: one read through the gateway with your key`)}`);
  return 0;
}

function keyHelp(ctx) {
  const { p } = ctx;
  const k = ctx.keyInfo();
  const gw = `${ctx.base}/gw/rpc/<chainId>`;
  if (ctx.json) { ctx.emit({ ok: true, keyed: Boolean(k.prefix), key_prefix: k.prefix ?? null, gateway: gw, header: 'x-api-key' }); return 0; }
  ctx.line(rule(p, 'rpc · read with your key'));
  ctx.line(kv(p, [
    ['your key', k.prefix ? `${k.prefix}… (${k.source})` : 'none yet: taifoon login --free'],
    ['gateway', gw],
    ['header', 'x-api-key: <your key>'],
  ], 10));
  ctx.line(`  ${p.faint('one read (the CLI never prints your key; paste it from the Keychain):')}`);
  ctx.line(`    curl -s ${ctx.base}/gw/rpc/8453 -H "x-api-key: $TAIFOON_KEY" -H 'content-type: application/json' \\`);
  ctx.line(`      --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'`);
  ctx.line(`  ${p.faint('viem / ethers: http(gateway, { fetchOptions: { headers: { "x-api-key": key } } }) · writes are refused; sends go through taifoon send')}`);
  return 0;
}

async function test(ctx, s) {
  const { p } = ctx;
  const id = chainArg(s);
  if (id === null) { ctx.fail('usage: taifoon rpc test <chain> (an id or a name: taifoon rpc lists them)'); return 2; }
  if (id === 'solana') { ctx.fail('the gateway serves EVM chains only; Solana is proved reads: taifoon rpc solana'); return 2; }
  const t0 = ctx.now();
  const r = await ctx.call(`/gw/rpc/${id}`, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] } });
  const ms = ctx.now() - t0;
  const block = typeof r.json?.result === 'string' ? parseInt(r.json.result, 16) : null;
  if (ctx.json) { ctx.emit({ ok: block !== null, chain: id, block, ms, status: r.status, error: r.json?.error ?? r.error ?? null }); return block !== null ? 0 : 1; }
  if (block === null) { ctx.fail(`eth_blockNumber on ${id}: ${r.json?.error?.message ?? r.json?.error ?? r.error ?? `answered ${r.status}`}`, { status: r.status, body: r.json }); return 1; }
  ctx.line(`  ${p.live('✓')} ${p.ink(`chain ${id}`)} block ${block.toLocaleString('en-US')} ${p.faint(`· ${ms} ms through ${ctx.base}/gw/rpc/${id} · ${ctx.keyInfo().prefix ? `key ${ctx.keyInfo().prefix}…` : 'guest budget'}`)}`);
  return 0;
}
