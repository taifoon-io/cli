// The chains we maintain and the contracts on them, from the ONE address registry (packages/addresses). The CLI carries the
// registry's public subset byte for byte (src/addresses.public.json = packages/addresses/public/addresses.json; judge/gates.sh
// fails when they differ): chains and systems only, never wallets, governance or notes that are not public.
import { readFileSync } from 'node:fs';

export const REGISTRY = JSON.parse(readFileSync(new URL('./addresses.public.json', import.meta.url), 'utf8'));
export const DEVNET = 36927;
export const MAINNETS = new Set([1, 10, 56, 100, 137, 5042, 8453, 42161, 42220, 43114]);
export const isMainnet = (chain) => Number(chain) !== DEVNET;

const CHAIN_ALIASES = { base: 8453, arc: 5042, devnet: 36927, taifoon: 36927, celo: 42220, bnb: 56, bsc: 56 };
/** "base" · "8453" · "devnet" → 8453 / 36927; null when unknown to the registry. */
export function chainId(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  const n = CHAIN_ALIASES[s] ?? (/^\d+$/.test(s) ? Number(s) : null);
  return n !== null && REGISTRY.chains[String(n)] ? n : null;
}
export const chainName = (id) => REGISTRY.chains[String(id)]?.name ?? `chain ${id}`;
export const chains = () => Object.entries(REGISTRY.chains).map(([id, c]) => ({ id: Number(id), ...c }));

export function contracts(filter = {}) {
  const out = [];
  for (const [system, s] of Object.entries(REGISTRY.systems)) {
    if (filter.system && system !== filter.system) continue;
    for (const c of s.contracts) {
      if (filter.chain && c.chain !== filter.chain) continue;
      if (filter.kind && c.kind !== filter.kind) continue;
      out.push({ system, owner: s.owner, ...c });
    }
  }
  return out;
}

/** Every pool factory we maintain (proxies named PoolFactory…), current first. */
export function factories(chain) {
  return contracts({ kind: 'proxy', ...(chain ? { chain } : {}) })
    .filter((c) => /^PoolFactory/.test(c.name) && c.status !== 'superseded')
    .map((c) => ({
      system: c.system, chain: c.chain, name: c.name, address: c.address, status: c.status,
      line: c.system === 'moonbeam-acp' ? 'moonbeam' : /V4/.test(c.name) ? (/dGLMR/.test(c.name) ? 'v4-glmr' : 'v4') : 'layer',
      tenant: c.system === 'moonbeam-acp' ? 'moonbeam' : null,
    }));
}

/** The default factory of a line on a chain: the one /v1/assurance/call builds against (layer, or the moonbeam tenant). */
export function defaultFactory(chain, tenant) {
  return factories(chain).find((f) => (tenant === 'moonbeam' ? f.line === 'moonbeam' : f.line === 'layer')) ?? null;
}

/** Pick a factory by line (layer | moonbeam | v4 | v4-glmr), by name fragment, or by address. */
export function pickFactory(chain, sel) {
  const all = factories(chain);
  if (!sel) return all.find((f) => f.line === 'layer') ?? all[0] ?? null;
  const s = String(sel).toLowerCase();
  return all.find((f) => f.line === s) ?? all.find((f) => f.address.toLowerCase() === s) ?? all.find((f) => f.name.toLowerCase().includes(s)) ?? null;
}

/** Tokens by symbol on a chain: USDC, GLMR, dUSDC, dGLMR … */
export function token(chain, symbol) {
  const s = String(symbol ?? '').toLowerCase();
  const hit = contracts({ chain, kind: 'token' }).find((c) => c.name.toLowerCase() === s || c.name.toLowerCase().startsWith(`${s} `) || c.name.toLowerCase().startsWith(`${s} (`));
  return hit ? hit.address : null;
}
export const tokenName = (chain, addr) => contracts({ chain, kind: 'token' }).find((c) => c.address.toLowerCase() === String(addr).toLowerCase())?.name.split(' ')[0] ?? null;

/** The pools the registry names (the Moonbeam V3 pools on Base, the layer's pools, devnet pools). */
export const registryPools = (system, chain) => contracts({ kind: 'pool', ...(system ? { system } : {}), ...(chain ? { chain } : {}) });

export const explorerTx = (chain, tx) => {
  const e = REGISTRY.chains[String(chain)]?.explorers ?? {};
  const base = e.basescan ?? e.etherscan ?? e.blockscout ?? e.taifoon ?? Object.values(e)[0];
  return base ? `${base.replace(/\/$/, '')}/tx/${tx}` : null;
};
export const explorerAddr = (chain, a) => {
  const e = REGISTRY.chains[String(chain)]?.explorers ?? {};
  const base = e.basescan ?? e.etherscan ?? e.blockscout ?? e.taifoon ?? Object.values(e)[0];
  return base ? `${base.replace(/\/$/, '')}/address/${a}` : null;
};
