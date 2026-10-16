/**
 * packages/resale/runtime/pipe-sealed.mjs — sealed pipe envelopes (_PIPE_SEALED_v1_, coord docs/PIPE-SEALED.md), a PREMIUM option:
 * the payload is end-to-end encrypted to the RECEIVER with HPKE (RFC 9180, base mode, DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 +
 * ChaCha20-Poly1305) from @hpke/core + @hpke/chacha20poly1305 (MIT, pinned in package.json, loaded only here and only when used).
 * The pipe never sees the plaintext and holds no key: it routes on the header, which is the AEAD's AAD, and commits to the
 * ciphertext (payload_digest = keccak256(ct)). The Rust twin is coord coordpipe/src/sealed.rs; the two are tested on the same envelopes.
 *
 *   sealEnvelope(fields, receiverPublicKey, plaintext, { sizeClass, plainCommitment }) → an envelope (id over the sealed body)
 *   openEnvelope(envelope, receiverSecretKey) → the plaintext bytes (the receiver's side)
 *   headerOf / headerDigest — what the AAD is; commitmentOf(genomeDigest, salt) — the selective-disclosure commitment
 */
import { canonical, keccakHex, utf8Hex } from '../ports/transition.mjs';
import { envelope as plainEnvelope } from './pipe-client.mjs';

export const SUITE = 'hpke-x25519-chacha20poly1305';
export const INFO = 'taifoon.pipe.sealed.v1';
export const SIZE_CLASSES = Object.freeze([1024, 4096, 16384]);
export const TAG = 16;

const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;
const bytes = (h) => (h instanceof Uint8Array ? h : Uint8Array.from(Buffer.from(String(h).replace(/^0x/i, ''), 'hex')));
const ab = (u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
const party = (p = {}) => ({ venue: p.venue ?? null, chain: p.chain ?? null, agent: p.agent ?? null, key: p.key ?? null, endpoint: p.endpoint ?? null });

/** the header a sealed payload is bound to (the AEAD's AAD), normalised exactly as coord coordpipe/src/sealed.rs header_of. Pure. */
export const headerOf = (e) => ({ schema: e.schema, kind: e.kind, from: party(e.from), to: party(e.to), order_key: e.order_key ?? null, edge: e.edge ?? null,
  ttl_s: Number(e.ttl_s), max_attempts: Number(e.max_attempts), created_at: e.created_at, reply_to: e.reply_to ?? null });
/** keccak256 of the canonical header. Pure. */
export const headerDigest = (e) => keccakHex(utf8Hex(canonical(headerOf(e))));
/** the commitment a sender may reveal to a grader: keccak256(genome digest ‖ 32-byte salt). Pure. */
export const commitmentOf = (genomeDigest, salt) => keccakHex(hex(Buffer.concat([Buffer.from(bytes(genomeDigest)), Buffer.from(bytes(salt))])));

/** pad to a size class: u32 BE length ‖ bytes ‖ zeros. Pure. */
export function pad(pt, cls) {
  if (!SIZE_CLASSES.includes(cls)) throw new Error(`size class ${cls} is not one of ${SIZE_CLASSES.join(' · ')}`);
  if (pt.length + 4 > cls) throw new Error(`the plaintext (${pt.length} bytes) does not fit size class ${cls}`);
  const out = new Uint8Array(cls); new DataView(out.buffer).setUint32(0, pt.length); out.set(pt, 4); return out;
}
export const unpad = (v) => { const n = new DataView(v.buffer, v.byteOffset, v.byteLength).getUint32(0); return v.slice(4, 4 + n); };

let SUITE_P = null;
async function suite() {
  SUITE_P ??= (async () => {
    const { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } = await import('@hpke/core');
    const { Chacha20Poly1305 } = await import('@hpke/chacha20poly1305');
    return new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
  })();
  return SUITE_P;
}

/** a fresh X25519 key pair — the RECEIVER makes it on its side and publishes the public key; returns raw bytes */
export async function keypair() {
  const s = await suite(); const kp = await s.kem.generateKeyPair();
  return { secretKey: new Uint8Array(await s.kem.serializePrivateKey(kp.privateKey)), publicKey: new Uint8Array(await s.kem.serializePublicKey(kp.publicKey)) };
}

/** Build and seal an envelope (the plain builder's fields; `payload` is ignored, `plaintext` is sealed instead). */
export async function sealEnvelope(fields, receiverPublicKey, plaintext, { sizeClass = null, plainCommitment = null } = {}) {
  const base = plainEnvelope({ ...fields, payload: null, payload_digest: null });
  const aad = bytes(headerDigest(base));
  const pt = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : Uint8Array.from(plaintext);
  const body = sizeClass ? pad(pt, sizeClass) : pt;
  const s = await suite();
  const pk = await s.kem.deserializePublicKey(ab(bytes(receiverPublicKey)));
  const { ct, enc } = await s.seal({ recipientPublicKey: pk, info: ab(new TextEncoder().encode(INFO)) }, ab(body), ab(aad));
  const sealed = { sealed: SUITE, enc: hex(new Uint8Array(enc)), ct: hex(new Uint8Array(ct)), aad: hex(aad), size_class: sizeClass, plain_commitment: plainCommitment };
  const { id: _id, ...rest } = base; // eslint-disable-line no-unused-vars
  const out = { ...rest, payload: canonical(sealed), payload_digest: keccakHex(hex(new Uint8Array(ct))) };
  return { id: keccakHex(utf8Hex(canonical(out))), ...out };
}

/** Open a sealed envelope with the receiver's X25519 secret key. Throws when the header was changed (the AAD) or the key is wrong. */
export async function openEnvelope(e, receiverSecretKey) {
  const p = JSON.parse(e.payload);
  if (p.sealed !== SUITE) throw new Error(`not a sealed payload of ${SUITE}`);
  const s = await suite();
  const sk = await s.kem.deserializePrivateKey(ab(bytes(receiverSecretKey)));
  const pt = new Uint8Array(await s.open({ recipientKey: sk, enc: ab(bytes(p.enc)), info: ab(new TextEncoder().encode(INFO)) }, ab(bytes(p.ct)), ab(bytes(headerDigest(e)))));
  return p.size_class ? unpad(pt) : pt;
}

/** Whether an envelope's payload is a sealed one (the shape coordpipe checks). Pure. */
export const isSealed = (e) => { try { return typeof e?.payload === 'string' && JSON.parse(e.payload)?.sealed === SUITE; } catch { return false; } };

/** the suite object, for the RFC 9180 vector test */
export const _suite = suite;
