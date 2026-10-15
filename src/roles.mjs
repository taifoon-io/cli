// _ONE_PRODUCT_v1_: who is calling, and what that caller may do — the one filter every door of the CLI uses (the verbs `taifoon help`
// shows, the tools the agent gets, the tools `taifoon mcp` lists). The role comes from the layer (GET /v1/access/role: admin, owner,
// delegate, member, viewer, public); the decision is the language's own function when it is generated into
// src/generated/coord-lang/roles.mjs (coord lang/cue/roles.cue → lang/gen/roles.mjs, written here by `coord gen`), and until then the
// small table below, which only ever answers NO where the generated one would (it never grants more). When the layer answered the
// caller's own `actions`, those decide. Pure (no file system): the online studio runs this same file; the CLI loads the generated
// decision with roles-generated.mjs and hands it in with useDecision().

export const ROLES = Object.freeze(['public', 'viewer', 'member', 'delegate', 'owner', 'admin']);
export const rank = (role) => Math.max(0, ROLES.indexOf(role));

/** the action a capability row performs, in the role table's words */
export function actionOf(row) {
  if (row.role === 'admin') return 'admin';
  if (row.kind === 'read' || row.kind === 'handoff') return row.stream ? 'stream' : row.measure ? 'measure' : 'read';
  if (row.kind === 'plan') return 'create';
  if (row.kind === 'act') return row.manage ? 'manage' : 'write';
  return 'read';
}

// the fallback: what each role may do on its OWN resources (the layer re-checks every call on the resource itself)
const FALLBACK = Object.freeze({
  public: ['read'],
  viewer: ['read', 'stream', 'measure'],
  member: ['read', 'stream', 'measure', 'create', 'write', 'manage'],
  delegate: ['read', 'stream', 'measure', 'create', 'write', 'manage'],
  owner: ['read', 'stream', 'measure', 'create', 'write', 'manage', 'grant', 'upgrade', 'payout'],
  admin: ['read', 'stream', 'measure', 'create', 'write', 'manage', 'grant', 'upgrade', 'payout', 'admin'],
});

let generated = null;
/** install the language's generated decision (coord lang/gen/roles.mjs: decide(caller, action, resource) → { allow, reason }) */
export function useDecision(m) { generated = m && (typeof m.decide === 'function' || typeof m.allowed === 'function') ? m : null; }

// what a row acts on, in the role table's resource kinds: [id pattern, kind, the caller's own?]. A row acts either on the caller's own
// resource (its keys, its hosted resources, its envelopes) or on a public one (protocols, projects, chains). Unlisted reads are public.
const ON = [
  [/^(resource\.|debug\.resource$)/, 'hosting-resource', true],
  [/^(usage|balance|whoami|buy\.|login|logout|collaborate\.)/, 'key', true],
  [/^(stream\.subscribe|stream\.status)$/, 'envelope', true],
  [/^owners\.claim$/, 'protocol', true],
  [/^(projects\.|debug\.project$)/, 'project', false],
  [/^(demand\.|catalog\.buy|markets\.hire|demo\.n8n\.live|register\.)/, 'job-record', false],
];
const resourceOf = (row) => { for (const [re, kind, own] of ON) if (re.test(row.id)) return { kind, own }; return { kind: 'protocol', own: false }; };

function generatedAllows(row, role, delegated) {
  const action = actionOf(row);
  if (typeof generated.decide === 'function') {
    const { kind, own } = resourceOf(row);
    const caller = role === 'admin' ? { admin: true } : role === 'public' ? {} : { tenant: 't:self', ref: 'key:self', ...(role === 'viewer' ? { read_only: true } : {}), ...(role === 'delegate' ? { actions: delegated ?? [] } : {}) };
    return Boolean(generated.decide(caller, action, { kind, id: 'x', owner: own ? 't:self' : 't:other' }).allow);
  }
  return Boolean(generated.allowed(role, action, null));
}

/**
 * may this caller perform this row's action? A keyed row needs a key (public never holds one). The language's generated decision
 * decides on the row's resource kind (resourceOf); without it, the layer's own `actions` for the caller, else the table above.
 */
export async function rowAllowed(row, role, actions = null) {
  if (row.id === 'role') return true;                       // anyone may ask who it is
  if (row.role === 'admin') return role === 'admin';
  if (row.key && rank(role) < rank('viewer')) return false;
  if (generated) { try { return generatedAllows(row, role, actions); } catch { /* fall through to the table */ } }
  const action = actionOf(row);
  if (Array.isArray(actions) && actions.length) return actions.includes(action);
  return (FALLBACK[role] ?? FALLBACK.public).includes(action);
}

/** filter rows for a caller: rowsFor(rows, role) or rowsFor(rows, who) with who = resolveRole's answer */
export async function rowsFor(rows, roleOrWho) {
  const who = typeof roleOrWho === 'string' ? { role: roleOrWho } : (roleOrWho ?? { role: 'public' });
  // a delegate's own grant comes from the layer (delegated_actions); the per-resource `actions` are re-checked by the layer itself
  const actions = who.source === 'layer' ? (who.delegated_actions ?? who.actions ?? null) : null;
  const out = [];
  for (const r of rows) if (await rowAllowed(r, who.role, actions)) out.push(r);
  return out;
}

/** the operator token, when this machine holds one (TAIFOON_OPERATOR_TOKEN); never printed */
export const operatorToken = (env = process.env) => (typeof env.TAIFOON_OPERATOR_TOKEN === 'string' && env.TAIFOON_OPERATOR_TOKEN.length >= 16 ? env.TAIFOON_OPERATOR_TOKEN : null);

/**
 * The caller's role: asked of the layer (GET /v1/access/role, with the key and, when held, the operator token); when the layer
 * has no such op yet (404) the role is read from what the caller holds — an operator token → admin, a key → member, nothing → public.
 * deps = { base, key, env, fetch, timeoutMs }. Never throws.
 */
export async function resolveRole({ base, key = null, env = process.env, fetch: f = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const op = operatorToken(env);
  const fallback = (why) => ({ role: op ? 'admin' : key ? 'member' : 'public', scopes: [], outlets: [], binds: {}, owner_of: [], actions: FALLBACK[op ? 'admin' : key ? 'member' : 'public'], source: 'local', why });
  try {
    const r = await f(`${String(base).replace(/\/$/, '')}/v1/access/role`, {
      headers: { accept: 'application/json', ...(key ? { 'x-api-key': key } : {}), ...(op ? { 'x-operator-token': op } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 401) return { ...fallback('the layer refused the key (401)'), role: op ? 'admin' : 'public', invalid_key: true };
    if (!r.ok) return fallback(`GET /v1/access/role answered ${r.status}`);
    const j = await r.json().catch(() => null);
    if (!j || !ROLES.includes(j.role)) return fallback('GET /v1/access/role answered no role');
    return { scopes: [], outlets: [], binds: {}, owner_of: [], actions: [], ...j, source: 'layer' };
  } catch (e) { return fallback(`GET /v1/access/role: ${e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? e}`); }
}
