// packages/resale/ports/genome.mjs — the JS twin of the TypeScript genome module (_GENOMES_v1_): the canonical body, its keccak256 digest,
// the EIP-712 Genome digest under the coord domain ("Taifoon","1"). The resale runtime and the coord pipe's JS carriers compute the
// same digest the schemas package and @taifoon-io/sdk compute (test: byte-equal on schemas/fixtures/golden/*.genome.json). Pure.
import { keccak256, hexBytes } from '../../addresses/keccak.mjs';
import { genomeKeyOf } from './coord-lang/genome-keys.mjs';

export const GENOME_SCHEMA = 'taifoon.genome.v1';
export const GENOME_VERSION = 1;
export const SCHEMA_BASE = 'https://www.taifoon.io/schemas/coordination/v1/';
export const ENTITIES = Object.freeze(['agent', 'offer', 'hire', 'delivery', 'facts', 'answers', 'verdict', 'settlement', 'record', 'quote', 'trace', 'job', 'resource', 'attestation', 'outlet', 'placement', 'usage', 'payout', 'adapter', 'candle', 'forecast', 'order', 'fill', 'signal', 'receipt']); // _TRADING_GENOMES_v1_: = the TypeScript entity list (the vector suite in coord lang/vectors catches a drift)
export const DOMAIN_TYPEHASH = keccak256('EIP712Domain(string name,string version)');
export const GENOME_TYPEHASH = keccak256('Genome(bytes32 entityId,bytes32 digest,uint64 at)');
const cat = (...parts) => { const bs = parts.map((p) => (typeof p === 'string' ? hexBytes(p) : p)); const out = new Uint8Array(bs.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of bs) { out.set(b, o); o += b.length; } return out; };
export const DOMAIN_SEPARATOR = keccak256(cat(DOMAIN_TYPEHASH, keccak256('Taifoon'), keccak256('1')));

/** sort keys recursively; drop undefined; non-finite numbers → null (the canonical digest rule) */
export function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canonicalize(v[k])]));
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}
export const canonicalJson = (v) => JSON.stringify(canonicalize(v));
export const idOf = (entity) => `${SCHEMA_BASE}${entity}.json`;
export const entityIdOf = (entity) => keccak256(idOf(entity));
export const entityOf = (body) => { const t = body?.schema; return ENTITIES.find((e) => `taifoon.${e}.v1` === t) ?? null; };

/** the order key of a record: the rule is coord's (lang/cue/lambda.cue), generated with its one walker (_WIRE_GENOME_KEY_RULE_v1_) */
export function genomeKey(entity, body) { return genomeKeyOf(entity, body); }
/** the genome of a canonical record */
export function genome(entity, body, { at = 0 } = {}) {
  if (!ENTITIES.includes(entity)) throw new Error(`not an entity: ${entity}`);
  const tagged = entityOf(body); if (tagged && tagged !== entity) throw new Error(`the record is tagged taifoon.${tagged}.v1, not ${entity}`);
  const canonical = canonicalJson(body);
  return { schema: GENOME_SCHEMA, version: GENOME_VERSION, entity, id: idOf(entity), entity_id: entityIdOf(entity), key: genomeKey(entity, body), canonical, digest: keccak256(canonical), size: Buffer.byteLength(canonical, 'utf8'), at };
}
export const genomeOf = (body, o) => { const e = entityOf(body); if (!e) throw new Error('the record carries no taifoon.<entity>.v1 schema tag'); return genome(e, body, o); };
const u64 = (n) => { let x = BigInt(n); if (x < 0n || x > 0xffffffffffffffffn) throw new Error('at: not a uint64'); const out = new Uint8Array(32); for (let i = 31; i >= 24; i--) { out[i] = Number(x & 0xffn); x >>= 8n; } return out; };
export const genomeStructHash = (entityId, digest, at) => keccak256(cat(GENOME_TYPEHASH, entityId, digest, u64(at)));
export const genomeDigest712 = (entityId, digest, at) => keccak256(cat(new Uint8Array([0x19, 0x01]), DOMAIN_SEPARATOR, genomeStructHash(entityId, digest, at)));
export const signingDigestOf = (g) => genomeDigest712(g.entity_id, g.digest, g.at);
/** recompute; every drift named */
export function verifyGenome(g, body) {
  const why = [];
  if (g?.schema !== GENOME_SCHEMA) why.push(`schema ${g?.schema} is not ${GENOME_SCHEMA}`);
  if (!ENTITIES.includes(g?.entity)) why.push(`entity ${g?.entity} is not one of the model`);
  else { if (g.id !== idOf(g.entity)) why.push(`id ${g.id} is not ${idOf(g.entity)}`); if (g.entity_id !== entityIdOf(g.entity)) why.push('entity_id is not keccak256($id)'); }
  if (keccak256(String(g?.canonical ?? '')) !== g?.digest) why.push('digest is not keccak256(canonical)');
  if (Buffer.byteLength(String(g?.canonical ?? ''), 'utf8') !== g?.size) why.push('size is not the canonical’s bytes');
  if (body !== undefined) { if (canonicalJson(body) !== g.canonical) why.push('canonical is not canonicalJson(body)'); if (ENTITIES.includes(g.entity) && genomeKey(g.entity, body) !== g.key) why.push('key is not the body’s'); }
  try { JSON.parse(g.canonical); } catch { why.push('canonical is not JSON'); }
  return why.length ? { ok: false, why } : { ok: true };
}
