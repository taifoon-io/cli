// prove — fetch and check the proof of a transaction or of a sale, through the coordination layer. Both doors call these:
// `taifoon prove tx|sale` and the MCP tools prove_tx, prove_sale. Nothing here signs or writes.
//
//   state     proven          the op proved it: the block folds into its chain's tree and the chain into the superroot, the receipt
//                             says success, and the receipt's block hash equals the proof's. `ref` = v5:<chain>:<tx>@<superroot>#<batch>
//             awaiting_proof  not proven yet (the producer has not reached it, or the chain is not read): ask again later; a sale
//                             step in this state is held awaiting_proof by the sale run
//             failed          the transaction reverted on its chain
//             unproven        the op refused, or its answer does not hold together (named in `why`)
// verdictOf is the same rule the sale run applies before it records a settlement as proven (a parity test holds them equal).
import { REGISTRY } from './registry.mjs';
import { TRUST, verifierOf } from './facts.mjs';

export const STATES = Object.freeze(['proven', 'awaiting_proof', 'failed', 'unproven']);
export const EXIT = Object.freeze({ proven: 0, failed: 1, unproven: 1, awaiting_proof: 3, not_found: 4 });
export const SUMMARY_URL = 'https://api.taifoon.dev/coordination/sale-run.json';
const TX = /^0x[0-9a-fA-F]{64}$/;
const GATED = ['settled', 'paid'];
const hex = (h) => (h ? `0x${String(h).replace(/^0x/, '').toLowerCase()}` : null);

/** the verdict of one answer of GET /v1/proof/tx/:chain/:tx. Pure. */
export function verdictOf(a) {
  if (!a || typeof a !== 'object') return { state: 'unproven', why: 'no answer from the proof op' };
  if (a.ok !== true) return { state: 'unproven', why: String(a.error ?? a.code ?? 'the proof op refused').slice(0, 200) };
  const chain = String(a.chain_id ?? ''); const tx = String(a.tx ?? '').toLowerCase();
  if (a.checks?.receipt_found === true && a.checks?.tx_succeeded === false) return { state: 'failed', why: `the transaction reverted on chain ${chain}` };
  if (a.proven !== true || a.checks?.proof_served === false) return { state: 'awaiting_proof', why: a.proven === undefined && a.proof_state === 'proven' ? 'the answer says proof_state proven but carries no proven: true, which the op promises with every proof: ask again' : `the producer has not proven it yet: ${a.proof_state ?? 'unproven'}` };
  if (a.checks && a.checks.block_hash_matches === false) return { state: 'unproven', why: `the block hash of the receipt and of the proof differ on chain ${chain}` };
  const superroot = hex(a.super_root_hash);
  if (!TX.test(tx) || !/^\d+$/.test(chain) || !/^0x[0-9a-f]{64}$/.test(String(superroot))) return { state: 'unproven', why: 'the answer names no chain, transaction or superroot' };
  return { state: 'proven', ref: `v5:${chain}:${tx}@${superroot}#${a.batch_id ?? ''}`, proof: { kind: 'v5', chain, tx, block: a.block_number ?? null, superroot, batch: a.batch_id ?? null } };
}

/** prove tx <chain> <tx> */
export async function proveTx(args = {}, { get, registry = REGISTRY } = {}) {
  const chain = String(args.chain ?? ''); const tx = String(args.tx ?? '');
  if (!/^\d+$/.test(chain)) return { ok: false, state: 'unproven', error: `the chain is a numeric id (8453), not ${chain || 'nothing'}` };
  if (!TX.test(tx)) return { ok: false, state: 'unproven', error: 'the transaction is 0x and 64 hex characters' };
  const op = `GET /v1/proof/tx/${chain}/${tx.toLowerCase()}`;
  const r = await get(`/v1/proof/tx/${chain}/${tx.toLowerCase()}`, { timeoutMs: 60_000 });
  const v = verdictOf(r?.json ?? (r?.error ? { ok: false, error: r.error } : null));
  return { ok: v.state === 'proven', state: v.state, chain: Number(chain), tx: tx.toLowerCase(), ref: v.ref ?? null, proof: v.proof ?? null, why: v.why ?? null,
    checks: r?.json?.checks ?? null, block: r?.json?.block_number ?? null, is_finalized: r?.json?.is_finalized ?? null, op, status: r?.status ?? null, verifier: verifierOf(registry), trust: TRUST };
}

/** the transaction a sale key names itself: sale:<chain>:<tx> (the buyer's payment) · bridge:<chain>:<tx>:<log> (the burn) */
export function txOfKey(key) {
  const m = /^(sale|bridge):(\d+):(0x[0-9a-fA-F]{64})(?::|$)/.exec(String(key ?? ''));
  return m ? { chain: m[2], tx: m[3].toLowerCase(), step: m[1] === 'sale' ? 'the payment the key is derived from' : 'the burn the key is derived from' } : null;
}

/** the gated steps of one sale in a sale-run summary: its proofs index, else the last evidence of each cell (an older summary) */
export function stepsOfSale(summary, key) {
  if (Array.isArray(summary?.proofs)) return { from: 'proofs', steps: summary.proofs.filter((p) => p.sale_key === key) };
  const steps = (summary?.cells ?? []).filter((c) => GATED.includes(c.stage) && c.last?.sale_key === key)
    .map((c) => ({ sale_key: key, step: c.stage, outcome: c.last.outcome, held_by: c.last.held_by ?? null, chain: /^(?:sale|job|usage|fill|bridge):(\d+):/.exec(key)?.[1] ?? null, tx: c.last.tx ?? null, proof: c.last.proof ?? null }));
  return { from: 'cells', steps };
}

/** prove sale <sale_key>: every settled and paid step of the sale that names a transaction, each asked of coord again */
export async function proveSale(args = {}, { get, fetchSummary, registry = REGISTRY } = {}) {
  const key = String(args.sale_key ?? '').trim();
  if (!/^[a-z]+:[^:\s]+:\S+$/.test(key)) return { ok: false, state: 'unproven', error: 'a sale key looks like sale:<chain>:<tx>, job:<chain>:<id>, bridge:<chain>:<tx>:<log> or usage:…' };
  const src = args.summary ?? SUMMARY_URL;
  let summary = null; let summaryWhy = null;
  try { summary = await fetchSummary(src); if (summary?.schema !== 'taifoon.sale-run.summary.v1') { summaryWhy = `${src} is not a sale-run summary`; summary = null; } } catch (e) { summaryWhy = `the sale-run summary is unread (${String(e?.message ?? e).slice(0, 120)})`; }
  const found = summary ? stepsOfSale(summary, key) : { from: null, steps: [] };
  const steps = [];
  for (const s of found.steps) {
    const row = { step: s.step, recorded: { outcome: s.outcome, held_by: s.held_by ?? null, proof: s.proof ?? null }, chain: s.chain, tx: s.tx };
    if (s.tx && s.chain && /^\d+$/.test(String(s.chain)) && TX.test(s.tx)) { const p = await proveTx({ chain: s.chain, tx: s.tx }, { get, registry }); Object.assign(row, { state: p.state, ref: p.ref, why: p.why }); }
    else if (s.held_by === 'awaiting_proof') Object.assign(row, { state: 'awaiting_proof', ref: s.proof ?? null, why: 'held by the sale run for its proof' });
    else if (s.tx) Object.assign(row, { state: 'unproven', ref: s.proof ?? null, why: `chain ${s.chain ?? "(unnamed)"} has no v5 proof op` });
    // a step with no transaction (held for another reason, e.g. no payout address yet) has nothing to prove: shown, never counted
    else Object.assign(row, { state: 'no_tx', ref: null, why: `no transaction to prove${s.held_by ? ` (held: ${s.held_by})` : ''}` });
    steps.push(row);
  }
  // no gated step in the summary: the key's own transaction, when the key names one
  let own = null;
  if (!steps.length) { const k = txOfKey(key); if (k) { const p = await proveTx({ chain: k.chain, tx: k.tx }, { get, registry }); own = { what: k.step, chain: Number(k.chain), tx: k.tx, state: p.state, ref: p.ref, why: p.why }; } }
  const states = own ? [own.state] : steps.map((s) => s.state).filter((x) => x !== 'no_tx');
  const state = !states.length ? (steps.length ? 'unproven' : 'not_found') : states.includes('failed') ? 'failed' : states.includes('awaiting_proof') || steps.some((s) => s.recorded.held_by === 'awaiting_proof' && s.state !== 'proven') ? 'awaiting_proof' : states.every((x) => x === 'proven') ? 'proven' : 'unproven';
  return { ok: state === 'proven', state, sale_key: key, summary: summary ? { src, generated_at: summary.generated_at ?? null, from: found.from } : { src, unread: summaryWhy }, steps, ...(own ? { key_tx: own } : {}),
    ...(state === 'unproven' && !states.length ? { why: 'no settled or paid step of this sale names a transaction yet' } : {}),
    ...(state === 'not_found' ? { why: summary ? 'the published sale run names no settled or paid step for this key, and the key names no transaction' : summaryWhy } : {}),
    verifier: verifierOf(registry), trust: TRUST };
}
