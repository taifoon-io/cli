// Record the /v1 answers `taifoon up` reads for the snapshot agents: node test/record-fixtures.mjs [fixture name…]
// Each fixture is one real walk against the layer, stored as-is (no edits). Re-record, then UPDATE_SNAPSHOTS=1.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { keyOf, sink } from './fixture-layer.mjs';

const BASE = process.env.TAIFOON_LAYER || 'https://coord.taifoon.dev';
export const AGENTS = {
  'hireable-not-assured-8453-95902': { ref: '8453:95902', why: 'hireable over MCP, not assured: thin record (2 settled), no pool' },
  'no-endpoint-8453-95134': { ref: '8453:95134', why: 'no endpoint the broker may call (only a web address): probe not answered, no class' },
  'uncovered-chain-56-310070': { ref: '56:310070', why: 'a BNB agent with no endpoint: the quote refuses chain 56, so the walk stops at step 4' },
  'pilot-seller-8453-0xdca0': { ref: '8453:0xdca0f0166bbc52a94073781d3971d8aa1938ef20', why: 'the Moonbeam Base pilot seller (a wallet, no ERC-8004 identity); one settled pilot job' },
  'olas-mech-8453-0xe535': { ref: '8453:0xe535d7acdeed905dddcb5443f41980436833ca2b', why: 'an Olas Mech on Base that answered lately (lane o): probe and classes read the marketplace, class mech.compute' },
  'agentverse-chat-word-counter': { ref: 'agent1q0y3z6qzazcrdw896elntytp8h34wy94g3t5vdzdr7nxayw6klu7cgwj7qq', why: 'an Agentverse CHAT agent (lane u2): probe names the route through Taifoon\u2019s receiving uAgent, class chat.word_count' },
  'x402-onesource-block-number': { ref: 'https://api.onesource.io/api/chain/block-number', why: 'an x402 Bazaar resource (lane d): readiness is its listing, probe its prices on Base, class x402.chain_head, no cover (settled at the call)' },
  'mcp-registry-utility-belt': { ref: 'io.github.zvmzaretsky/utility-belt', why: 'a server in the official MCP registry (lane r): readiness is its own record, probe a live initialize + tools/list, class mcp.digest, no cover (no price, no EVM key)' },
  'agentkit-worker-devnet': { ref: 'agentkit:0xf1652bdb22e7988883c988b76e33f0ce9f9905a1', why: 'a Coinbase AgentKit worker registered with the layer (lane k): readiness is its card, probe a live initialize + tools/list, class agentkit.erc20_transfer, no Base cover (devnet)' },
  'a2a-registry-mach-lab-edge': { ref: 'a2a:879f2d3f-4e0e-47f4-8fec-77163a2a9577', why: 'an agent in the A2A Registry (lane g): readiness is its own registry record, probe a GET of its card, class a2a.json_normalize, no cover (no price, no EVM key)' },
  'celo-hashproof-42220-9669': { ref: '42220:9669', why: 'an ERC-8004 agent on Celo (lane e): readiness is its Celo record, probe its MCP endpoint, class credential.verify.celo (a class naming its endpoint), no cover (Celo is not a covered chain)' },
  'virtuals-seller-8453-0x4b33': { ref: '8453:0x4b33758d85678ea86cd875af8caf318462268ba8', why: 'a Virtuals memo-ACP seller with a transfer_token offering (lane v): class memoacp.transfer_token' },
};

const ONLY = process.argv.slice(2);
for (const [name, a] of Object.entries(AGENTS).filter(([n]) => !ONLY.length || ONLY.includes(n))) {
  const responses = {};
  const rec = async (url, init) => {
    const r = await fetch(url, init);
    const text = await r.text();
    const path = url.slice(BASE.length);
    const body = init?.body !== undefined ? JSON.parse(init.body) : undefined;
    responses[keyOf(path, { method: init?.method, body })] = { status: r.status, json: JSON.parse(text) };
    return new Response(text, { status: r.status });
  };
  const home = mkdtempSync(join(tmpdir(), 'taifoon-rec-'));
  await main(['up', a.ref, '--layer', BASE], { out: sink(), err: sink(), env: { TAIFOON_HOME: home }, fetch: rec });
  const fx = { recorded_at: new Date().toISOString(), base: BASE, agent: a.ref, why: a.why, responses };
  writeFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), JSON.stringify(fx, null, 1) + '\n');
  console.log(`${name}: ${Object.keys(responses).length} responses`);
}
