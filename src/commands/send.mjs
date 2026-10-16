// taifoon send — type → envelope → the stream (_TYPES_AND_TRANSFORMS_v1_, coord docs/TYPES-AND-TRANSFORMS.md): a canonical record of
// any entity of the lambda catalogue (tagged taifoon.<entity>.v1, or --entity named) becomes the sendable envelope of --kind (the genome
// gives the order key and the payload: packages/resale/ports/genome.mjs; the body: packages/resale/runtime/pipe-client.mjs envelope(),
// the one builder the pipe's id rule is written against) and goes to POST /v1/pipe/send on your key. The pipe signs it for your actor
// (the signing turbine), folds it under a batch root and streams it.
//   taifoon send <record.json | '{...}' | -> --kind settle --to coord://eip155:36927/coord [--entity job] [--order-key k] [--reply-to id] [--dry]
//   --to is a coord address  coord://<chain>/<venue>[/<agent>][#<endpoint>]  or the parts --to-chain --to-venue --to-agent --to-endpoint
import { readFileSync } from 'node:fs';

// the genome + envelope builders ship inside the package (vendor/, kept equal to packages/resale by scripts/vendor-resale.mjs --check);
// literal specifiers so npm installs and `deno compile` (the release binaries) both resolve them
const loadGenome = () => import('../../vendor/resale/ports/genome.mjs');
const loadPipeClient = () => import('../../vendor/resale/runtime/pipe-client.mjs');

/** coord://<chain>/<venue>[/<agent>][#endpoint] → a `to` party; a bare https URL → an endpoint */
export function partyOf(addr) {
  if (!addr) return null;
  if (/^https?:\/\//.test(addr)) return { venue: null, chain: null, agent: null, endpoint: addr };
  const m = addr.match(/^coord:\/\/([^/#]+)\/([^/#]*)(?:\/([^#]*))?(?:#(.*))?$/);
  if (!m) throw new Error(`not a coord address: ${addr} (coord://<chain>/<venue>[/<agent>][#endpoint])`);
  const chain = m[1] === 'offchain' ? 'offchain' : m[1];
  return { chain, venue: m[2] || null, agent: m[3] || null, endpoint: m[4] || null };
}

export default {
  name: 'send',
  summary: 'send a record into the stream as an envelope of a kind (type → envelope, the lambda catalogue); --dry builds without sending',
  usage: [["send <record.json|'{…}'|-> --kind <kind> --to coord://<chain>/<venue>[/<agent>] [--entity e] [--order-key k] [--reply-to id] [--dry]", 'a write on your key (POST /v1/pipe/send): type → envelope → the stream; --dry builds and prints the envelope, sends nothing']],
  valued: ['kind', 'to', 'to-chain', 'to-venue', 'to-agent', 'to-endpoint', 'entity', 'order-key', 'reply-to', 'edge', 'ttl', 'payload-uri'],
  async run(ctx, rest) {
    const src = rest[0];
    if (!src || !ctx.f.kind) { ctx.fail(`usage: taifoon ${this.usage[0][0]}`); return 2; }
    let text = src === '-' ? readFileSync(0, 'utf8') : /^[[{]/.test(src.trim()) ? src : readFileSync(src, 'utf8');
    let body; try { body = JSON.parse(text); } catch (e) { ctx.fail(`not JSON: ${e.message}`); return 2; }
    const G = await loadGenome(); const PC = await loadPipeClient();
    const entity = ctx.f.entity ?? G.entityOf(body);
    if (!entity) { ctx.fail('the record carries no taifoon.<entity>.v1 schema tag: name --entity'); return 2; }
    if (!G.ENTITIES.includes(entity)) { ctx.fail(`not an entity of the catalogue: ${entity} (${G.ENTITIES.join(' · ')})`); return 2; }
    let g; try { g = G.genome(entity, body); } catch (e) { ctx.fail(e.message); return 2; }
    const to = partyOf(ctx.f.to) ?? { chain: ctx.f['to-chain'] ?? null, venue: ctx.f['to-venue'] ?? null, agent: ctx.f['to-agent'] ?? null, endpoint: ctx.f['to-endpoint'] ?? null };
    if (!to.chain && !to.venue && !to.endpoint) { ctx.fail('name a destination: --to coord://<chain>/<venue> or --to-endpoint https://…'); return 2; }
    let env;
    try { env = PC.envelope({ kind: ctx.f.kind, from: { venue: 'coord', chain: 'offchain', agent: null, key: null }, to, order_key: ctx.f['order-key'] ?? g.key, payload: body, edge: ctx.f.edge ?? null, reply_to: ctx.f['reply-to'] ?? null, ttl_s: ctx.f.ttl, payload_uri: ctx.f['payload-uri'] ?? null }); }
    catch (e) { ctx.fail(e.message); return 2; }
    if (ctx.f.dry) { ctx.out.write(JSON.stringify({ dry: true, entity, genome: { key: g.key, digest: g.digest, size: g.size }, envelope: env }, null, ctx.json ? 0 : 2) + '\n'); return 0; }
    const key = ctx.key();
    if (!key) { ctx.fail('a send needs your key (taifoon login, --key, TAIFOON_KEY)'); return 1; }
    const r = await (ctx.io.fetch ?? globalThis.fetch)(`${ctx.base}/v1/pipe/send`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': key }, body: JSON.stringify(env) });
    const answer = await r.json().catch(() => ({}));
    ctx.out.write(JSON.stringify({ ok: r.ok, status: r.status, entity, genome: { key: g.key, digest: g.digest }, envelope_id: env.id, answer }, null, ctx.json ? 0 : 2) + '\n');
    return r.ok ? 0 : 1;
  },
};
