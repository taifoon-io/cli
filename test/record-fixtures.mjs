// Record the /v1 answers `taifoon up` reads for the snapshot agents: node test/record-fixtures.mjs
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
};

for (const [name, a] of Object.entries(AGENTS)) {
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
