// facts — chain and contract addresses from the address registry this CLI carries (src/addresses.public.json: chains and
// systems, the public subset), and the superroot as coord serves it. Both doors call these functions: `taifoon facts …` and the
// MCP tools facts_chain, facts_contracts, facts_superroot, pools_factories. Nothing here signs or writes.
//   get(path) → { ok, status, json }   one GET on the coordination layer (/v1/…)
//   registry                           the registry document; `--registry <file>` hands in a full one (its governance rows are
//                                      then listed too, marked public: false; the public subset has none)
import { REGISTRY } from './registry.mjs';

const ALIASES = { base: 8453, arc: 5042, devnet: 36927, taifoon: 36927, celo: 42220, bnb: 56, bsc: 56, eth: 1, ethereum: 1, mainnet: 1, gnosis: 100, xdai: 100, arbitrum: 42161, 'arbitrum-one': 42161, robinhood: 4663, monad: 143, optimism: 10, op: 10, polygon: 137 };
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lc = (a) => String(a ?? '').toLowerCase();

/** "8453" · "base" · "Arbitrum One" · "arbitrum-one" → 8453; null when neither the registry nor the root's chain list knows it */
export function resolveChain(q, { registry = REGISTRY, rootChains = [] } = {}) {
  const s = slug(q); if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (ALIASES[s] !== undefined) return ALIASES[s];
  for (const [id, c] of Object.entries(registry.chains ?? {})) if (slug(c.name) === s) return Number(id);
  for (const c of rootChains) if (slug(c.network_name) === s) return Number(c.chain_id);
  return null;
}

/** every contract row of the registry (systems), plus the governance rows of a full registry (public: false) */
export function contractRows(registry = REGISTRY) {
  const out = [];
  for (const [system, s] of Object.entries(registry.systems ?? {})) {
    for (const c of s.contracts ?? []) out.push({ system, owner: s.owner, chain: c.chain, name: c.name, address: c.address, kind: c.kind, status: c.status, since: c.since ?? null, deploy: c.deploy ?? null, ...(c.implementation ? { implementation: c.implementation } : {}) });
  }
  for (const g of registry.governance?.entries ?? []) out.push({ system: g.system, owner: 'ours', chain: g.chain, name: g.name, address: g.address, kind: g.kind, status: g.status, since: g.since ?? null, deploy: g.deploy ?? null, public: false });
  return out;
}

/** the same-address set: one address on more than one chain, or a system the registry declares lands at one address on every EVM chain */
export function sameAddress(rows, registry = REGISTRY) {
  const everywhere = new Set(Object.entries(registry.systems ?? {}).filter(([, s]) => /same address on every (evm )?chain/i.test(s.description ?? '')).map(([k]) => k));
  const by = new Map();
  for (const r of rows) { if (!/^0x[0-9a-fA-F]{40}$/.test(r.address)) continue; const k = lc(r.address); if (!by.has(k)) by.set(k, { address: r.address, name: r.name.replace(/ \((owner )?on [^)]+\)$/, ''), system: r.system, kind: r.kind, chains: [], ...(r.public === false ? { public: false } : {}) }); const g = by.get(k); if (!g.chains.includes(r.chain)) g.chains.push(r.chain); }
  return [...by.values()].filter((g) => g.chains.length > 1 || everywhere.has(g.system)).map((g) => ({ ...g, chains: g.chains.sort((a, b) => a - b), declared: everywhere.has(g.system) ? 'one address on every EVM chain (CREATE2)' : null }))
    .sort((a, b) => b.chains.length - a.chains.length || a.name.localeCompare(b.name));
}

const unread = (r) => (r?.ok ? null : `unread (${r?.json?.error ?? r?.status ?? r?.error ?? 'no answer'})`);

/** facts chain [<chain>]: one chain (registry entry, our contracts on it, its leaf in the superroot), or every chain */
export async function factsChain(args = {}, { get, registry = REGISTRY } = {}) {
  const live = get ? await get('/v1/root/chains') : null;
  const rootChains = live?.ok ? (live.json?.chains ?? []) : [];
  const leaf = (id) => { const c = rootChains.find((x) => Number(x.chain_id) === Number(id)); return c ? { status: c.status, latest_block: c.latest_block, blocks_in_tree: c.blocks_in_tree, last_header_age_secs: c.last_header_age_secs, mini_mmr_root: c.mini_mmr_root } : null; };
  const rows = contractRows(registry);
  const one = (id) => ({ id, name: registry.chains?.[String(id)]?.name ?? rootChains.find((x) => Number(x.chain_id) === Number(id))?.network_name ?? null, registry: registry.chains?.[String(id)] ?? null,
    contracts: rows.filter((r) => r.chain === id).map(({ chain, ...r }) => r), superroot: live?.ok ? leaf(id) : unread(live) });
  if (args.chain === undefined || args.chain === null || args.chain === '') {
    const ids = [...new Set([...Object.keys(registry.chains ?? {}).map(Number), ...rootChains.map((c) => Number(c.chain_id))])].sort((a, b) => a - b);
    return { ok: true, source: { registry: `address registry ${registry.updated ?? ''}`.trim(), live: live?.ok ? 'GET /v1/root/chains' : unread(live) },
      chains: ids.map((id) => { const o = one(id); return { id, name: o.name, in_registry: Boolean(o.registry), contracts: o.contracts.length, superroot: o.superroot && typeof o.superroot === 'object' ? o.superroot.status : o.superroot }; }) };
  }
  const id = resolveChain(args.chain, { registry, rootChains });
  if (id === null) return { ok: false, error: `unknown chain ${args.chain}: give an id (8453), a name (Base) or an alias (base, arc, gnosis, devnet)` };
  const o = one(id);
  if (!o.registry && !(o.superroot && typeof o.superroot === 'object')) return { ok: false, error: `chain ${id} is in neither the address registry nor the superroot${live?.ok ? '' : ` (the live list is ${unread(live)})`}` };
  return { ok: true, source: { registry: `address registry ${registry.updated ?? ''}`.trim(), live: live?.ok ? 'GET /v1/root/chains' : unread(live) }, chain: o };
}

/** facts contracts [<chain>] [--system s] [--kind k] [--status live]: the registry's contract rows, and the same-address set */
export async function factsContracts(args = {}, { registry = REGISTRY } = {}) {
  let chain = null;
  if (args.chain !== undefined && args.chain !== null && args.chain !== '') { chain = resolveChain(args.chain, { registry }); if (chain === null) return { ok: false, error: `unknown chain ${args.chain}` }; }
  const all = contractRows(registry);
  const rows = all.filter((r) => (chain === null || r.chain === chain) && (!args.system || r.system === args.system) && (!args.kind || r.kind === args.kind) && (!args.status || r.status === args.status));
  const same = sameAddress(all, registry).filter((g) => (chain === null || g.chains.includes(chain)) && (!args.system || g.system === args.system));
  return { ok: true, source: `address registry ${registry.updated ?? ''}`.trim(), public: !registry.governance, filter: { chain, system: args.system ?? null, kind: args.kind ?? null, status: args.status ?? null }, count: rows.length, contracts: rows, same_address: same };
}

/** pool factories of the registry (the read `taifoon pools factories` prints) */
export async function poolFactories(args = {}, { registry = REGISTRY } = {}) {
  const r = await factsContracts({ ...args }, { registry });
  if (!r.ok) return r;
  const factories = r.contracts.filter((c) => /factory/i.test(c.name) && c.status !== 'superseded');
  return { ok: true, source: r.source, count: factories.length, factories };
}

/** the live verifier of v5 proofs on Base, from the registry (never a literal) */
export function verifierOf(registry = REGISTRY) {
  const v = (registry.systems?.['v5-verifier']?.contracts ?? []).find((c) => c.kind === 'verifier' && c.status === 'live');
  return v ? { chain: v.chain, name: v.name, address: v.address } : null;
}

export const TRUST = 'proven today means consistent with the superroot the producer served: the block folds into its chain’s mini-MMR and the chain into the superroot. No superroot anchor is posted on any chain yet, so the on-chain verifier checks the same blob against the superroot it is given (it has no anchor of its own).';

/** facts superroot: the root, its chains, the anchor feed's age, and what a proof against it is checked by */
export async function factsSuperroot(args = {}, { get, registry = REGISTRY } = {}) {
  const [root, latest] = await Promise.all([get('/v1/root'), get('/v1/root/latest')]);
  if (!root?.ok && !latest?.ok) return { ok: false, error: `the superroot is ${unread(root)}` };
  const r = root?.ok ? root.json : null; const l = latest?.ok ? latest.json : null;
  const hex = (h) => (h ? `0x${String(h).replace(/^0x/, '')}` : null);
  return { ok: true, source: 'GET /v1/root + GET /v1/root/latest',
    root: r ? hex(r.root) : unread(root), sealed_at: r?.timestamp ? new Date(r.timestamp * 1000).toISOString() : null, leaf_count: r?.leaf_count ?? null, peak_count: r?.peak_count ?? null,
    chains_included: Array.isArray(r?.chains_included) ? r.chains_included.length : null,
    // the feed is the layer's own published root (GET /v1/root/latest), not an on-chain anchor
    feed: l ? { epoch: l.epoch, root: hex(l.root), published_at: l.anchoredAt ? new Date(l.anchoredAt * 1000).toISOString() : null, age_seconds: l.cadence?.anchor_age_seconds ?? null, recompute_seconds: l.cadence?.recompute_seconds ?? null } : unread(latest),
    onchain_anchor: null,
    verifier: verifierOf(registry), proof_op: 'GET /v1/proof/tx/:chain/:tx', trust: TRUST };
}
