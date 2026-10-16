// npm run verify — step 4: check a proof. Reads GET /v1/proof/tx/:chain/:tx and the superroot it is proven under; exit 0 only when
// proven (1 failed or unproven, 3 still awaiting its proof).
//   npm run verify                  the settlement `npm run demo` wrote to .coord/last.json
//   npm run verify -- <chain> <tx>  any transaction on a chain the superroot carries
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { read } from '../lib/coord.mjs';
import { verdictOf, EXIT } from '../lib/verdict.mjs';

export async function verify(argv = process.argv.slice(2), { out = (s) => process.stdout.write(`${s}\n`) } = {}) {
  let [chain, tx] = argv;
  if (!chain && existsSync('.coord/last.json')) ({ chain, tx } = JSON.parse(readFileSync('.coord/last.json', 'utf8')));
  if (!/^\d+$/.test(String(chain ?? '')) || !/^0x[0-9a-fA-F]{64}$/.test(String(tx ?? ''))) { out('usage: npm run verify -- <chain id> <0x… transaction>   (or run npm run demo first)'); return 2; }
  const [p, root] = await Promise.all([read(`/v1/proof/tx/${chain}/${tx}`, { timeoutMs: 60_000 }), read('/v1/root')]);
  const v = verdictOf(p.json);
  out(`${v.state === 'awaiting_proof' ? 'held awaiting_proof' : v.state}  ${v.ref ?? v.why ?? ''}`);
  if (root.ok) out(`  superroot now 0x${String(root.json.root).replace(/^0x/, '')} over ${root.json.chains_included?.length ?? '—'} chains`);
  out('  proven today = consistent with the superroot the layer’s producer served; no superroot anchor is posted on chain yet');
  return EXIT[v.state] ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await verify();
