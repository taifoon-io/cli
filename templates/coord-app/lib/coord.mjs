// The one wrapper this app uses to reach the coordination layer: reads (GET, no key unless asked) and plans (POST with your key,
// answered as UNSIGNED calls). It never signs and never sends a transaction.
import { existsSync, readFileSync } from 'node:fs';

export const ENV_FILE = '.env.local';
/** KEY=value lines of .env.local (the key `npm run fund` stored) */
export function localEnv(file = ENV_FILE) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
}
export const layer = () => String(process.env.TAIFOON_LAYER || localEnv().TAIFOON_LAYER || 'https://coord.taifoon.dev').replace(/\/$/, '');
export const apiKey = () => process.env.TAIFOON_API_KEY || localEnv().TAIFOON_API_KEY || null;
/** the first characters of a key, the only part ever shown */
export const prefixOf = (k) => (k ? `${String(k).slice(0, 10)}…` : null);

async function call(method, path, { body, withKey = false, timeoutMs = 60_000 } = {}) {
  const key = withKey ? apiKey() : null;
  try {
    const r = await fetch(layer() + path, { method, signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': 'create-coord-app/0.1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(key ? { 'x-api-key': key } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const json = await r.json().catch(() => null);
    return { ok: r.ok && json?.ok !== false, status: r.status, json };
  } catch (e) { return { ok: false, status: null, json: null, error: String(e?.message ?? e) }; }
}
/** a read: GET /v1/…, sent with no key unless withKey */
export const read = (path, o = {}) => call('GET', path, o);
/** a plan: POST /v1/… with your key; the answer is unsigned calls or a quote, never a transaction */
export const plan = (path, body, o = {}) => call('POST', path, { ...o, body, withKey: true });
