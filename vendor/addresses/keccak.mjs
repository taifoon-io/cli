/**
 * keccak.mjs — keccak256 (the Ethereum hash, original Keccak padding 0x01…0x80, not SHA3-256), zero dependencies.
 *
 * The observatory pins every event's topic0 in config.json; the whitepaper's decoder rule is that each topic hash is
 * re-derived from its signature in tests, so a typo cannot quietly mismatch live traffic. Node's crypto has sha3-256
 * but not keccak256, hence this file. BigInt lanes: slow per byte, fast enough for signatures and subject ids.
 *
 *   keccak256(bytes | string) → '0x' + 64 hex      (a string is hashed as UTF-8)
 *   topic0('Deposit(address,address,uint256,uint256)') → the event's topic0
 */
const M = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// rotation offsets, lane index x + 5y
const R = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rot = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & M);

function f(A) {
  const C = new Array(5); const B = new Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) { const d = C[(x + 4) % 5] ^ rot(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) A[x + y] ^= d; }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rot(A[x + 5 * y], R[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & M & B[(x + 2) % 5 + 5 * y]);
    A[0] ^= RC[round];
  }
}

export function keccak256(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const rate = 136;
  const padLen = rate - (bytes.length % rate);
  const msg = new Uint8Array(bytes.length + padLen);
  msg.set(bytes);
  msg[bytes.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const A = new Array(25).fill(0n);
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(msg[off + i * 8 + b]);
      A[i] ^= lane;
    }
    f(A);
  }
  let hex = '0x';
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) hex += Number((A[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return hex;
}

/** the topic0 of an event signature, e.g. 'Transfer(address,address,uint256)' */
export const topic0 = (signature) => keccak256(signature);

/** hex string (with or without 0x) → bytes */
export function hexBytes(hex) {
  const h = String(hex).replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
