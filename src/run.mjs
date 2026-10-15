// The one way a capability row is run (_ONE_PRODUCT_v1_): pure — fetch only, no file system, no process — so the CLI, its MCP server,
// the agent session in the terminal and the same agent in the online studio and cockpit (the website vendors this file with the agent
// core) make exactly the same call for a row. The runners of `run` rows are injected (deps.runners); mcp.mjs binds the CLI's set.
import { requestOf } from './capabilities.mjs';
import { DEFAULT_LAYER, TIMEOUT_MS } from './api.mjs';

/** one GET/POST on the layer → { ok, status, json, error? } */
export function getterOf({ base = DEFAULT_LAYER, key = null, fetchImpl = globalThis.fetch, version = '0', headers: extra = {} } = {}) {
  // extra: headers every call carries (the online studio forwards the signed-in person's session this way; the CLI sends none)
  const root = String(base).replace(/\/$/, '');
  const call = async (method, path, { body, withKey = false, timeoutMs = TIMEOUT_MS * 3 } = {}) => {
    try {
      const r = await fetchImpl(root + path, { method, signal: AbortSignal.timeout(timeoutMs),
        headers: { ...extra, accept: 'application/json', 'user-agent': `taifoon-mcp/${version}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(withKey && key ? { 'x-api-key': key } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const json = await r.json().catch(() => null);
      return { status: r.status, json, ok: r.ok && json?.ok !== false, retry_after: r.headers?.get?.('retry-after') ?? null };
    } catch (e) { return { status: null, json: null, ok: false, error: e?.name === 'TimeoutError' ? 'timed out' : String(e?.message ?? e) }; }
  };
  return { get: (path, o = {}) => call('GET', path, o), post: (path, body, o = {}) => call('POST', path, { ...o, body }), base: root };
}

/** run one row with these arguments: the same call the CLI makes. deps = { base, key, fetch, version, registry } */
export async function runRow(row, args = {}, deps = {}) {
  const RUNNERS = deps.runners ?? {};
  const g = getterOf({ base: deps.base, key: deps.key, fetchImpl: deps.fetch, version: deps.version, headers: deps.headers });
  const read_at = new Date().toISOString();
  if (row.run) {
    const fn = RUNNERS[row.run]; if (!fn) return { ok: false, error: `no runner ${row.run}` };
    const out = await fn(args, { get: (p, o) => g.get(p, o), fetchSummary: deps.fetchSummary, registry: deps.registry, role: deps.role, env: deps.env });
    return { ...out, kind: row.kind, source_op: row.op, read_at };
  }
  if (row.key && !deps.key) return { ok: false, kind: row.kind, error: `${row.mcp ?? row.cli} needs a relayer key: set TAIFOON_API_KEY in this server’s environment (a free one: taifoon login --free); nothing was sent` };
  const q = requestOf(row, args); if (!q.ok) return { ok: false, kind: row.kind, error: q.why };
  const withKey = row.key || ((row.kind === 'plan' || row.optKey) && Boolean(deps.key));
  const r = q.method === 'GET' ? await g.get(q.path, { withKey }) : await g.post(q.path, q.body, { withKey });
  return { ok: r.ok, kind: row.kind, status: r.status, ...(row.kind === 'plan' ? { unsigned: true, plan: r.json } : { body: r.json }),
    ...(r.status === 429 ? { retry_after: r.retry_after, get_key: 'taifoon login --free' } : {}), ...(r.error ? { error: r.error } : {}),
    source: { op: row.op, url: `${g.base}${q.path}`, read_at } };
}

