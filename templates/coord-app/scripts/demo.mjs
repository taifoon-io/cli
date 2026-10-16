// npm run demo — step 2: one job, end to end, through the layer. You say what you need in words; the layer picks a seller, hires
// it, grades the reply by code and settles it on the devnet (36927: test tokens, no value). Then the settlement's proof is read.
//   npm run demo -- "<need>"     (default: the keccak256 hash of "hello world")
// Writes .coord/last.json { demand, sale_key, chain, tx, state, ref } for `npm run verify`.
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { apiKey, read, plan } from '../lib/coord.mjs';
import { verdictOf, EXIT } from '../lib/verdict.mjs';

const ENDED = new Set(['settled', 'unmatched', 'failed', 'cancelled']);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** the settlement transaction a demand names: the last transaction of its settling step, on its chain */
export function settlementOf(d) {
  const s = [...(d?.events ?? [])].reverse().find((e) => e.state === 'settling' && Array.isArray(e.data?.txs) && e.data.txs.length);
  const last = s?.data.txs.at(-1);
  return last?.tx ? { chain: String(s.data.venue?.chain ?? d.chainId), tx: last.tx, action: last.action ?? null } : null;
}

export async function demo(argv = process.argv.slice(2), { out = (s) => process.stdout.write(`${s}\n`), every = Number(process.env.DEMO_EVERY_MS ?? 15_000), timeoutMs = Number(process.env.DEMO_TIMEOUT_MS ?? 900_000) } = {}) {
  if (!apiKey()) { out('no key: npm run fund first'); return 2; }
  const need = argv.join(' ').trim() || 'the keccak256 hash of "hello world"';
  const r = await plan('/v1/demands', { need });
  if (!r.ok || !r.json?.demand?.id) { out(`POST /v1/demands: ${r.json?.error ?? r.status ?? r.error}`); return 1; }
  const id = r.json.demand.id; out(`posted ${id} · class ${r.json.demand.class ?? '—'}`);
  const until = Date.now() + timeoutMs; let d = r.json.demand; let last = null;
  while (!ENDED.has(d.state) && Date.now() < until) {
    await sleep(every);
    const g = await read(`/v1/demands/${id}`); if (g.ok) d = g.json.demand;
    if (d.state !== last) { last = d.state; out(`  ${d.state}`); }
  }
  if (d.state !== 'settled') { out(`${id} is ${d.state}${ENDED.has(d.state) ? '' : ' (still running: read it again with npx @taifoon/cli demand status ' + id + ')'}`); return 1; }
  const s = settlementOf(d);
  const saleKey = d.job_id ? `job:${d.chainId}:${d.job_id}` : null;
  if (!s) { out(`settled ${d.settle ?? 'directly between the parties'}: no transaction to prove`); mkdirSync('.coord', { recursive: true }); writeFileSync('.coord/last.json', JSON.stringify({ demand: id, sale_key: saleKey, chain: null, tx: null, state: 'no_tx' }, null, 2)); return 0; }
  out(`settled on chain ${s.chain}: ${s.action ?? 'settlement'} ${s.tx}`);
  let v = { state: 'awaiting_proof' };
  while (v.state === 'awaiting_proof' && Date.now() < until) { const p = await read(`/v1/proof/tx/${s.chain}/${s.tx}`, { timeoutMs: 60_000 }); v = verdictOf(p.json); if (v.state === 'awaiting_proof') await sleep(every); }
  out(`${v.state === 'awaiting_proof' ? 'held awaiting_proof' : v.state}  ${v.ref ?? v.why ?? ''}`);
  mkdirSync('.coord', { recursive: true });
  writeFileSync('.coord/last.json', JSON.stringify({ demand: id, sale_key: saleKey, chain: s.chain, tx: s.tx, state: v.state, ref: v.ref ?? null }, null, 2));
  if (saleKey) out(`the sale run: npx @taifoon/cli prove sale ${saleKey}`);
  out('next: npm run verify');
  return EXIT[v.state] ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await demo();
