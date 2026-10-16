/**
 * packages/resale/ports/transition.mjs — the codec port to the proof plane's transition leaf (_SUPERROOT_SYNC_v1_).
 *
 * The spinner (da-api `protocol_trees`) keeps, per protocol, one history tree (append-only transitions, depth 32, index = seq) and one
 * state tree (depth 64, index = the order key's first 8 bytes, leaf = the order's current state), and folds both into the superroot as one
 * chain-shaped leaf. A transition is one fixed 406-byte record of three kinds — 0 observed (a log on a chain), 1 attested (an EIP-712
 * signature of a named party over the move and a payload digest), 2 produced (computed from proven inputs) — twin of
 * `taifoon-merkle::transition` (Rust) and `TaifoonTransition.sol` / `TaifoonAttest.sol` (Solidity). This file is the third twin: the same
 * bytes, pinned by the same vectors (fixtures/spinner/*.json, copied from spinner `chain/taifoon-mainnet/contracts/test/fixtures`).
 *
 * The coordination layer's own protocol is `taifoon_coord`: one sale of the one sale run (_ONE_SALE_RUN_v1_) is one order (order key = the
 * sale key) whose states are `<hop>:<outcome>`; every event line of the one writer becomes one ATTESTED transition, signed by the vault.
 * Pure: nothing here reads a file, a clock, the network or a chain; `keccak256` is the repo's own (packages/addresses).
 */
import { keccak256 } from '../../addresses/keccak.mjs';

export const RULE = 'SUPERROOT_SYNC_v1';
export const COORD_PROTOCOL = 'taifoon_coord';
export const PIPE_PROTOCOL = 'taifoon_pipe'; // the coord pipe's own leaf (coordpipe; COORD-PIPE.md §3)
export const VERSION = 1;
export const KINDS = Object.freeze({ observed: 0, attested: 1, produced: 2 });
export const HISTORY_DEPTH = 32;
export const STATE_DEPTH = 64;
export const ZERO32 = `0x${'0'.repeat(64)}`;
export const ZERO20 = `0x${'0'.repeat(40)}`;

// ── bytes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const strip = (h) => String(h ?? '').replace(/^0x/i, '');
/** a 0x-hex string of exactly `n` bytes (left-padded with zeros when shorter; refused when longer or not hex) */
export function hexN(h, n, what = 'value') {
  const s = strip(h || '').toLowerCase();
  if (!/^[0-9a-f]*$/.test(s) || s.length > n * 2) throw new Error(`${what}: not ${n} bytes of hex: ${String(h).slice(0, 80)}`);
  return `0x${s.padStart(n * 2, '0')}`;
}
export const bytes32 = (h, what) => hexN(h, 32, what);
export const address = (h, what) => hexN(h, 20, what);
/** big-endian unsigned integer of `n` bytes as hex (no 0x) */
export function uintBE(v, n, what = 'number') {
  const b = BigInt(v ?? 0);
  if (b < 0n || b >= 1n << BigInt(8 * n)) throw new Error(`${what}: ${v} does not fit ${n} bytes`);
  return b.toString(16).padStart(n * 2, '0');
}
export const hexOf = (parts) => `0x${parts.map((p) => strip(p)).join('')}`;
export const utf8Hex = (s) => `0x${Buffer.from(String(s), 'utf8').toString('hex')}`;
export const bytesOfHex = (h) => Buffer.from(strip(h), 'hex');
/** keccak256 over 0x-hex bytes → 0x-hex */
export const keccakHex = (h) => keccak256(bytesOfHex(h));
/** `keccak256(bytes(name))`: how the producer commits a protocol id or a state name (`name_hash`) */
export const nameHash = (name) => keccak256(String(name));

// ── the transition record ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** an empty record (the fields of the other kinds stay zero) */
export function emptyTransition() {
  return { kind: null, protocolId: ZERO32, orderKeyHash: ZERO32, seq: 0, fromState: ZERO32, toState: ZERO32, chainId: 0, blockNumber: 0, blockHash: ZERO32, txIndex: 0, logIndex: 0, logHash: ZERO32, attester: ZERO20, sigHash: ZERO32, payloadDigest: ZERO32, inputsRoot: ZERO32, outputDigest: ZERO32, manifestHash: ZERO32 };
}
export const kindCode = (k) => (typeof k === 'number' ? k : KINDS[String(k)]);
/** the 406 bytes of a transition in leaf order (twin of `Transition::packed`) */
export function packed(t) {
  const k = kindCode(t.kind);
  if (!(k >= 0 && k <= 2)) throw new Error(`transition: kind ${t.kind} is not observed | attested | produced`);
  return hexOf([
    uintBE(VERSION, 1), uintBE(k, 1), bytes32(t.protocolId, 'protocolId'), bytes32(t.orderKeyHash, 'orderKeyHash'), uintBE(t.seq, 8, 'seq'),
    bytes32(t.fromState, 'fromState'), bytes32(t.toState, 'toState'),
    uintBE(t.chainId, 8, 'chainId'), uintBE(t.blockNumber, 8, 'blockNumber'), bytes32(t.blockHash, 'blockHash'), uintBE(t.txIndex, 4, 'txIndex'), uintBE(t.logIndex, 4, 'logIndex'), bytes32(t.logHash, 'logHash'),
    address(t.attester, 'attester'), bytes32(t.sigHash, 'sigHash'), bytes32(t.payloadDigest, 'payloadDigest'),
    bytes32(t.inputsRoot, 'inputsRoot'), bytes32(t.outputDigest, 'outputDigest'), bytes32(t.manifestHash, 'manifestHash'),
  ]);
}
export const PACKED_BYTES = 406;
/** the leaf of a transition: keccak256 of its 406 packed bytes */
export function leaf(t) {
  const p = packed(t);
  if (strip(p).length !== PACKED_BYTES * 2) throw new Error(`transition: packed ${strip(p).length / 2} bytes, not ${PACKED_BYTES}`);
  return keccakHex(p);
}
/** `keccak256(abi.encode(emitter, topics, data))` — the log hash of an observed transition */
export function logHash(emitter, topics, data) {
  const d = strip(data); const padded = d + '0'.repeat((64 - (d.length % 64)) % 64);
  const head = [address(emitter).replace(/^0x/, '').padStart(64, '0'), uintBE(0x60, 32), uintBE(0x60 + 32 + topics.length * 32, 32)];
  const tTail = [uintBE(topics.length, 32), ...topics.map((x) => strip(bytes32(x)))];
  const dTail = [uintBE(d.length / 2, 32), padded];
  return keccakHex(hexOf([...head, ...tTail, ...dTail]));
}
/** where an order sits in the state tree: its key hash's first 8 bytes */
export const stateIndex = (orderKeyHash) => BigInt(`0x${strip(bytes32(orderKeyHash)).slice(0, 16)}`);
/** the state tree's leaf for an order: keccak256(orderKeyHash ‖ toState ‖ uint64 lastSeq) */
export const stateLeaf = (orderKeyHash, toState, lastSeq) => keccakHex(hexOf([bytes32(orderKeyHash), bytes32(toState), uintBE(lastSeq, 8)]));
/** `protocol_trees::leaf_id`: 2^63 | the protocol id's first 8 bytes — the chain-id slot the protocol leaf takes in the superroot */
export function leafId(protocolId) {
  const top = BigInt(`0x${strip(bytes32(protocolId)).slice(0, 16)}`);
  return (1n << 63n) | (top & ~(1n << 63n));
}
/** the protocol leaf in the verifier's chain-leaf layout: keccak(leafId ‖ historyCount ‖ stateRoot ‖ historyRoot ‖ stateCount) */
export const protocolLeaf = (protocolId, { historyCount, stateRoot, historyRoot, stateCount }) =>
  keccakHex(hexOf([uintBE(leafId(protocolId), 8), uintBE(historyCount, 8), bytes32(stateRoot), bytes32(historyRoot), uintBE(stateCount, 8)]));
/** fold a leaf up a sparse binary keccak tree (TaifoonMerkle.fold; bit l of the index picks the side at level l) */
export function fold(leafHash, index, siblings) {
  let cur = bytes32(leafHash); const i = BigInt(index);
  siblings.forEach((s, l) => { cur = (i >> BigInt(l)) & 1n ? keccakHex(hexOf([bytes32(s), cur])) : keccakHex(hexOf([cur, bytes32(s)])); });
  return cur;
}

// ── the EIP-712 attestation (TaifoonAttest; `transition::attest`) ───────────────────────────────────────────────────────────────────────
export const DOMAIN_TYPEHASH = keccak256('EIP712Domain(string name,string version)');
export const ATTESTATION_TYPEHASH = keccak256('Attestation(bytes32 protocolId,bytes32 orderKeyHash,bytes32 fromState,bytes32 toState,bytes32 payloadDigest,uint64 issuedAt)');
export const domainSeparator = () => keccakHex(hexOf([DOMAIN_TYPEHASH, keccak256('Taifoon'), keccak256('1')]));
/** the digest an attester signs (raw secp256k1 over it; no EIP-191 prefix) */
export function attestDigest({ protocolId, orderKeyHash, fromState, toState, payloadDigest, issuedAt }) {
  const s = keccakHex(hexOf([ATTESTATION_TYPEHASH, bytes32(protocolId), bytes32(orderKeyHash), bytes32(fromState), bytes32(toState), bytes32(payloadDigest), uintBE(issuedAt, 32)]));
  return keccakHex(hexOf(['1901', domainSeparator(), s]));
}

// ── the coordination layer's protocol: a sale event → an attested transition ────────────────────────────────────────────────────────────
/** the state name of a hop and an outcome, as the producer hashes it (`name_hash("settled:ok")`) */
export const coordState = (step, outcome) => `${step}:${outcome}`;
/** canonical JSON: sorted keys, no whitespace; the attested payload of an event is its own line, canonical, without the writer's clock */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
/** the attested payload of one sale event: the event line as written, minus the fields that are the writer's own clock and bookkeeping */
export function payloadOf(e) {
  const { seen_at, replay_units, proof_only, ...rest } = e; // eslint-disable-line no-unused-vars
  return utf8Hex(canonical(rest));
}
/**
 * The attest request of one sale event (what POST /admin/protocol/attest takes), before the signature: the protocol, the order key (the
 * sale key), the move (`from` = the sale's previous state, null for its first), the payload and the digest the attester must sign. Pure.
 */
export function attestRequestOf(e, { from = null, attester, issuedAt, protocol = COORD_PROTOCOL } = {}) {
  if (!e?.sale_key || !e.step || !e.outcome) throw new Error('an event names its sale key, step and outcome');
  if (!attester) throw new Error('the attester address is required');
  const to = coordState(e.step, e.outcome);
  const payload = payloadOf(e);
  const payloadDigest = keccakHex(payload);
  const t = { ...emptyTransition(), kind: 'attested', protocolId: nameHash(protocol), orderKeyHash: keccak256(e.sale_key), fromState: from ? nameHash(from) : ZERO32, toState: nameHash(to), attester: address(attester), payloadDigest };
  const digest = attestDigest({ ...t, issuedAt });
  return { request: { protocol, orderKey: e.sale_key, from, to, payload, issuedAt, attester: address(attester), signature: null }, transition: t, digest };
}
/** complete a request with its signature: the request to POST, and the transition's leaf (sigHash = keccak(signature)). Pure. */
export function signed(prepared, signature) {
  const sig = hexN(signature, 65, 'signature');
  const transition = { ...prepared.transition, sigHash: keccakHex(sig) };
  return { request: { ...prepared.request, signature: sig }, transition, leaf: leaf(transition), digest: prepared.digest };
}
/** the sale key's state tree index (for a GET of the order's state proof) */
export const coordOrderKeyHash = (saleKey) => keccak256(saleKey);
