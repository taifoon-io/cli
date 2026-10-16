// The verdict of one answer of GET /v1/proof/tx/:chain/:tx — the same rule the coordination layer's sale run applies before it
// records a settlement as proven, and the same as `taifoon prove tx`.
//   proven          the block folds into its chain's tree and the chain into the superroot; the receipt says success
//   awaiting_proof  not proven yet: ask again later
//   failed          the transaction reverted
//   unproven        the op refused, or the answer does not hold together
// "Proven" today means consistent with the superroot the layer's producer served; no superroot anchor is posted on chain yet.
const TX = /^0x[0-9a-fA-F]{64}$/;
const hex = (h) => (h ? `0x${String(h).replace(/^0x/, '').toLowerCase()}` : null);

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
export const EXIT = { proven: 0, failed: 1, unproven: 1, awaiting_proof: 3 };
