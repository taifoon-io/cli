// Record the /v1 answers the new commands read, for test/cli.test.mjs: node test/record-cli-fixtures.mjs
// One real run of each command against the layer (reads, and the read-only POSTs /v1/assurance/call and /v1/pools/quote),
// stored as-is in test/fixtures/cli-layer.json. Keyed operations (relayer/*) are not recorded: the tests answer them.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.mjs';
import { keyOf, sink } from './fixture-layer.mjs';

const BASE = process.env.TAIFOON_LAYER || 'https://coord.taifoon.dev';
export const SELLER = '0xe6209aD65a66d5eF11E00A7B33Cd21ce7084715c'; // devnet lane-a seller (a public test key)
export const RUNS = [
  ['markets', 'ls'], ['markets', 'search', 'proof'], ['markets', 'connect', 'nevermined'], ['markets', 'connect', 'virtuals'],
  ['pools', 'ls'], ['pools', 'ls', '--chain', 'devnet'], ['pools', 'pilot'], ['pools', 'factories'],
  ['pools', 'create', 'devnet', 'dUSDC', SELLER], ['pools', 'create', 'devnet', 'dGLMR', SELLER, '--line', 'v4-glmr'], ['pools', 'create', 'base', 'USDC', SELLER],
  ['pools', 'quote', '0x3574999dd4c96eb73bd6e11d4177010c83e14f5b'],
  ['register', 'agent', '8453:95902', '--check'], ['status'],
];

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const responses = {};
  const rec = async (url, init) => {
    const r = await fetch(url, init);
    const text = await r.text();
    const path = url.slice(BASE.length);
    const body = init?.body !== undefined ? JSON.parse(init.body) : undefined;
    let json; try { json = JSON.parse(text); } catch { json = null; }
    responses[keyOf(path, { method: init?.method, body })] = { status: r.status, json };
    return new Response(text, { status: r.status });
  };
  const home = mkdtempSync(join(tmpdir(), 'taifoon-rec-'));
  for (const argv of RUNS) {
    await main([...argv, '--layer', BASE], { out: sink(), err: sink(), env: { TAIFOON_HOME: home }, fetch: rec, exec: () => ({ status: 1, stdout: '', stderr: '' }) });
    console.log(argv.join(' '));
  }
  const fx = { recorded_at: new Date().toISOString(), base: BASE, runs: RUNS.map((r) => r.join(' ')), responses };
  writeFileSync(new URL('./fixtures/cli-layer.json', import.meta.url), JSON.stringify(fx) + '\n');
  console.log(`${Object.keys(responses).length} responses`);
}
