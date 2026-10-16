/**
 * packages/resale/runtime/pipe-client.mjs — the coord pipe's API as one tiny client (_COORD_PIPE_v1_, taifoon-io/coord docs/COORD-PIPE.md §2–§3).
 * The pipe (coordpipe, Rust, box 116 loopback :8620; reachable as the coord ops `pipe/*`) is the one ack-and-delivery queue under the
 * layer: an envelope goes OUT through a carrier, lands in the receiver's INBOX, and is ACKED by the receiver's signed receipt or the chain
 * event a lane saw; every state change is a leaf of protocol `taifoon_pipe`, folded per pass into one batch root.
 *
 *   the sender's side    send(envelope) · status(id) · inbox(who, { since, limit }) · ack(ackEnvelope) · lost() · dead() · batches(since) · stats()
 *   a carrier's side     claim(carrier, { limit, dry }) → the envelopes queued for that carrier (dry: listed, not claimed) ·
 *                        result(id, { outcome: delivered | deferred | refused, reason, evidence })
 *   envelope(fields)     the envelope with its id = keccak256(canonical JSON of everything but `id`)    (pure)
 *   carrierOf(envelope)  which carrier takes it: http (an endpoint) · venue (a venue) · evm (an EVM chain, kind settle | release) ·
 *                        solana (a Solana chain)                                                          (pure)
 *   fakePipe()           the FAKE: the same state machine in memory (queued → sent → delivered → acked · lost · dropped); records calls
 * Nothing here signs; the pipe never holds a key.
 */
import { canonical, keccakHex, utf8Hex } from '../ports/transition.mjs';
import { PIPE_KINDS, ROUTES, route, TRANSITIONS, untransitioned } from './coord-lang/pipe.mjs';

export const PIPE_URL = (process.env.PIPE_URL || 'http://127.0.0.1:8620').replace(/\/$/, '');
export const SCHEMA = 'taifoon.pipe.envelope.v1';
// _TYPES_AND_TRANSFORMS_v1_: the kinds come from the coord language (coord lang/gen/pipe.mjs, vendored by `coord gen`), never a hand list
// (the hand list here lacked `record`; the vector suite coord lang/vectors/envelopes.json caught it)
export const KINDS = PIPE_KINDS;
export const STATES = Object.freeze(['queued', 'sent', 'delivered', 'acked', 'lost', 'retried', 'dropped', 'cancelled']);
// _ONE_VAULT_v1_: the carriers and the routes come from the coord language (lang/gen/pipe.mjs ROUTES / route(), vendored by `coord gen`)
export const CARRIERS = Object.freeze([...new Set(ROUTES.map((r) => r.carrier))]);
export const MAX_PAYLOAD_BYTES = 64 * 1024;

const isSolana = (chain) => /^solana:/.test(String(chain ?? ''));
const isEvm = (chain) => /^eip155:\d+$/.test(String(chain ?? ''));
export const chainIdOf = (chain) => { const m = /^eip155:(\d+)$/.exec(String(chain ?? '')); return m ? Number(m[1]) : null; };

/** the envelope, its id derived from its content (one content, one id: a resend is the same envelope). Pure. Throws on a bad one. */
export function envelope(f = {}) {
  if (!KINDS.includes(f.kind)) throw new Error(`envelope: kind ${String(f.kind)} is not one of ${KINDS.join(' · ')}`);
  if (!f.from || !f.to) throw new Error('envelope: from and to are named');
  if (f.transition != null) checkTransition(f.kind, f.transition);
  const payload = f.payload == null ? null : (typeof f.payload === 'string' ? f.payload : canonical(f.payload));
  if (payload && Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error(`envelope: the payload is above ${MAX_PAYLOAD_BYTES} bytes; carry it by payload_uri`);
  const body = { schema: SCHEMA, kind: f.kind,
    from: { venue: f.from.venue ?? null, chain: f.from.chain ?? null, agent: f.from.agent ?? null, key: f.from.key ?? null },
    to: { venue: f.to.venue ?? null, chain: f.to.chain ?? null, agent: f.to.agent ?? null, endpoint: f.to.endpoint ?? null },
    order_key: f.order_key ?? null, edge: f.edge ?? null, payload_digest: payload ? keccakHex(utf8Hex(payload)) : (f.payload_digest ?? null), payload, payload_uri: f.payload_uri ?? null,
    ttl_s: Number(f.ttl_s ?? 900), max_attempts: Number(f.max_attempts ?? 5), created_at: f.created_at ?? new Date().toISOString(), reply_to: f.reply_to ?? null,
    sig: f.sig ?? { scheme: 'none', by: null, sig: null } };
  // _WIRE_SENDERS_v1_: the v2 transition the send performs; present only when named, as in the pipe's canonical form (same id)
  if (f.transition != null) body.transition = f.transition;
  return { id: keccakHex(utf8Hex(canonical(body))), ...body };
}
/** _WIRE_SENDERS_v1_: a named transition must be a WRITE of the coord language carrying this kind (the pipe's check_send, client side). */
export function checkTransition(kind, id) {
  const t = TRANSITIONS.find((x) => x.id === id);
  if (!t) throw new Error(`envelope: transition ${id} is not one the coord language defines`);
  if (t.direction !== 'write') throw new Error(`envelope: transition ${id} is a read (it arrives as an observation; it is never sent)`);
  if (t.kind !== kind) throw new Error(`envelope: transition ${id} carries kind ${t.kind}, not ${kind}`);
  return t;
}
/** the resale machine's transform on a venue lane, e.g. resaleTransition('job.in', 'erc8183-base'); null when the lane has no such row. Pure. */
export function resaleTransition(step, lane) {
  const id = `coordination.seller-coord-buyer.v1/${step}@${lane}`;
  const t = TRANSITIONS.find((x) => x.id === id && x.direction === 'write');
  return t ? t.id : null;
}
/** why an unnamed send is allowed (the language's declared non-transitions), or null when it must name one. Pure. */
export const unnamedReason = (e) => untransitioned(e.kind, carrierOf(e));
/** which carrier takes an envelope. Pure. */
export function carrierOf(e) {
  // _ONE_VAULT_v1_: the generated twin of coordpipe lang.rs route() — a hand copy here routed in another order (carrier-mismatch)
  return route(e.to ?? {}, e.kind);
}
/** the address of a party (COORD-STREAM-V2.md §5): coord://<chain>/<venue>/<agent>[#topic] — the twin of coordpipe envelope.rs address_of. Pure. */
export function addressOf(p = {}) {
  const chain = p.chain || 'offchain'; const venue = p.venue || (p.endpoint ? 'service:http' : 'coord'); const agent = p.agent || '-';
  const topic = typeof p.key === 'string' && p.key.startsWith('#') ? p.key : '';
  return `coord://${chain}/${venue}/${agent}${topic}`;
}
/** a bundle (taifoon.pipe.bundle.v1): ordered envelopes written all-or-nothing, delivered in order; `priority` as the sender obtained it (razor's quote). Pure. */
export function bundleOf(envelopes, { atomic = true, priority = null } = {}) {
  if (!Array.isArray(envelopes) || !envelopes.length || envelopes.length > 256) throw new Error('bundle: 1..=256 envelopes');
  return { schema: 'taifoon.pipe.bundle.v1', envelopes, atomic, priority };
}
/** the ack envelope a receiver sends back (its signature over Ack(envelopeId, payloadDigest, at) goes in `sig`). Pure. */
export const ackOf = (e, { by, sig = null, scheme = 'none', at = new Date().toISOString() } = {}) =>
  envelope({ kind: 'ack', from: e.to, to: e.from, order_key: e.order_key, edge: e.edge, reply_to: e.id, payload: { schema: 'taifoon.pipe.ack.v1', envelope: e.id, payload_digest: e.payload_digest, at, by }, sig: { scheme, by, sig }, created_at: at });

export function pipeClient({ base = PIPE_URL, fetchImpl = globalThis.fetch, token = process.env.PIPE_TOKEN ?? null, ms = 30_000 } = {}) {
  base = (base || PIPE_URL).replace(/\/$/, ''); // a null base (an absent --pipe flag) is the default, never 'null/pipe/send'
  const headers = (body) => ({ accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-pipe-token': token } : {}) });
  async function call(method, path, body = null, t = ms) {
    try { const r = await fetchImpl(`${base}${path}`, { method, headers: headers(body), ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(t) }); return { status: r.status, ok: r.ok, json: await r.json().catch(() => null) }; }
    catch (e) { return { status: 0, ok: false, json: null, error: String(e?.message ?? e) }; }
  }
  const q = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
  return {
    kind: 'pipe', base,
    health: () => call('GET', '/health', null, 5_000),
    send: (e) => call('POST', '/pipe/send', e),
    status: (id) => call('GET', `/pipe/status/${encodeURIComponent(id)}`),
    inbox: (who, { since, limit = 50, wait = false } = {}) => call('GET', `/pipe/inbox/${encodeURIComponent(who)}${q({ since, limit, wait: wait ? 1 : undefined })}`, null, wait ? 30_000 : ms),
    ack: (a) => call('POST', '/pipe/ack', a),
    lost: () => call('GET', '/pipe/lost'), dead: () => call('GET', '/pipe/dead'),
    batches: (since) => call('GET', `/pipe/batches${q({ since })}`), stats: () => call('GET', '/pipe/stats'),
    /** the service answers claim with ROWS ({ id, envelope, attempts, lease_until, deadline }); the carriers take envelopes: unwrapped here, the lease kept under `claim` */
    claim: async (carrier, { limit = 20, dry = false, wait_ms = 0 } = {}) => { const r = await call('POST', '/pipe/claim', { carrier, limit, dry, ...(wait_ms ? { wait_ms } : {}) }); if (r.json?.envelopes) r.json.envelopes = r.json.envelopes.map((row) => (row && row.envelope && typeof row.envelope === 'object' ? { ...row.envelope, id: row.envelope.id ?? row.id, claim: { attempts: row.attempts ?? null, lease_until: row.lease_until ?? null, deadline: row.deadline ?? null, dry: row.dry ?? false } } : row)); return r; },
    bundle: (b) => call('POST', '/pipe/bundle', b.schema ? b : bundleOf(b)),
    bundleOf: (id) => call('GET', `/pipe/bundle/${encodeURIComponent(id)}`),
    address: (address, { limit = 100 } = {}) => call('GET', `/pipe/address/${encodeURIComponent(address)}${q({ limit })}`),
    head: () => call('GET', '/pipe/head'),
    result: (id, { outcome, reason = null, evidence = null }) => call('POST', '/pipe/result', { id, outcome, reason, evidence }),
    // _SETTLEMENT_QUEUES_v1_ (coord docs/SETTLEMENT-QUEUES.md): the four queues, the public settle set, the outside settler's report
    queues: ({ chain, detail } = {}) => call('GET', `/pipe/queues${q({ chain, detail })}`),
    claimable: ({ chain, venue, limit } = {}) => call('GET', `/pipe/claimable${q({ chain, venue, limit })}`),
    settled: ({ id, chain, tx, by = null }) => call('POST', '/pipe/settled', { id, chain, tx, by }),
    settledOpen: ({ limit = 50 } = {}) => call('GET', `/pipe/settled/open${q({ limit })}`),
    settledVerdict: ({ id, tx, ok, why = '', evidence = null }) => call('POST', '/pipe/settled/verdict', { id, tx, ok, why, evidence }),
  };
}

/** the FAKE pipe: the state machine in memory. `now` is injectable (ms). */
export function fakePipe({ now = () => Date.now() } = {}) {
  const rows = new Map(); const calls = []; const acks = []; const batches = [];
  const ok = (json) => ({ status: 200, ok: true, json });
  const bad = (status, error) => ({ status, ok: false, json: { ok: false, error } });
  const tick = (r) => { if (['queued', 'sent', 'delivered'].includes(r.state) && now() - Date.parse(r.envelope.created_at) > r.envelope.ttl_s * 1000) { r.state = 'lost'; r.lost_at = now(); r.history.push({ state: 'lost', at: now(), why: `no ${r.state === 'delivered' ? 'ack' : 'delivery'} within ttl` }); } };
  const drop = (r) => { const h = r.envelope.kind === 'settle' || r.envelope.kind === 'release' ? 'refund' : 'dead-letter'; r.state = 'dropped'; r.handler = h; r.history.push({ state: 'dropped', at: now(), handler: h }); };
  return {
    kind: 'fake-pipe', calls, rows, acks, batches,
    async health() { return ok({ ok: true, service: 'fake-pipe' }); },
    async send(e) { calls.push(['send', e.id]); if (e.schema !== SCHEMA || !KINDS.includes(e.kind)) return bad(400, 'not an envelope'); const carrier = carrierOf(e); if (!carrier) return bad(422, 'no carrier takes this envelope'); if (rows.has(e.id)) return ok({ id: e.id, state: rows.get(e.id).state, duplicate: true }); rows.set(e.id, { envelope: e, carrier, state: 'queued', attempts: 0, history: [{ state: 'queued', at: now() }], claimed_by: null, evidence: [] }); return ok({ id: e.id, state: 'queued', carrier, batch: null }); },
    async status(id) { const r = rows.get(id); if (!r) return bad(404, 'no such envelope'); tick(r); return ok({ id, state: r.state, carrier: r.carrier, attempts: r.attempts, history: r.history, evidence: r.evidence, handler: r.handler ?? null, batch: null }); },
    async inbox(who, { limit = 50 } = {}) { const out = [...rows.values()].filter((r) => (r.envelope.to.agent === who || r.envelope.to.venue === who) && ['sent', 'delivered'].includes(r.state)).slice(0, limit).map((r) => r.envelope); return ok({ who, envelopes: out }); },
    async ack(a) { calls.push(['ack', a.reply_to]); const r = rows.get(a.reply_to); if (!r) return bad(404, 'no such envelope'); tick(r); if (!['sent', 'delivered'].includes(r.state)) return bad(409, `the envelope is ${r.state}`); r.state = 'acked'; r.history.push({ state: 'acked', at: now(), by: a.sig?.by ?? a.payload?.by ?? null }); acks.push(a); return ok({ id: a.reply_to, state: 'acked' }); },
    async lost() { for (const r of rows.values()) tick(r); return ok({ envelopes: [...rows.values()].filter((r) => r.state === 'lost').map((r) => ({ id: r.envelope.id, kind: r.envelope.kind, carrier: r.carrier, attempts: r.attempts })) }); },
    async dead() { return ok({ envelopes: [...rows.values()].filter((r) => r.state === 'dropped').map((r) => ({ id: r.envelope.id, handler: r.handler })) }); },
    async batches() { return ok({ batches }); },
    async stats() { const by = {}; for (const r of rows.values()) { tick(r); by[r.state] = (by[r.state] ?? 0) + 1; } return ok({ envelopes: rows.size, by_state: by }); },
    async claim(carrier, { limit = 20, dry = false } = {}) { calls.push(['claim', carrier, dry]); const out = []; for (const r of rows.values()) { tick(r); if (r.carrier === carrier && (r.state === 'queued' || r.state === 'retried') && out.length < limit) { if (!dry) { r.state = 'sent'; r.claimed_by = carrier; r.attempts += 1; r.history.push({ state: 'sent', at: now(), carrier }); } out.push(r.envelope); } } return ok({ carrier, envelopes: out, dry }); },
    async result(id, { outcome, reason = null, evidence = null }) { calls.push(['result', id, outcome, reason]); const r = rows.get(id); if (!r) return bad(404, 'no such envelope'); if (evidence) r.evidence.push({ outcome, reason, evidence, at: now() }); if (outcome === 'delivered') { r.state = 'delivered'; r.history.push({ state: 'delivered', at: now(), reason }); } else if (outcome === 'deferred') { r.state = r.attempts >= r.envelope.max_attempts ? 'lost' : 'retried'; r.history.push({ state: r.state, at: now(), reason }); if (r.state === 'lost') drop(r); } else if (outcome === 'refused') { r.state = 'lost'; r.history.push({ state: 'lost', at: now(), reason }); drop(r); } else return bad(400, 'outcome is delivered | deferred | refused'); return ok({ id, state: r.state, handler: r.handler ?? null }); },
    /** the pass: fold every new leaf into one batch (the fake counts leaves; the real pipe builds the root) */
    pass() { const leaves = [...rows.values()].reduce((n, r) => n + r.history.length, 0); batches.push({ batch: batches.length + 1, leaves, at: now() }); return batches.at(-1); },
  };
}
