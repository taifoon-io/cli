// The only door: the coordination layer's public /v1 (default https://coord.taifoon.dev), with the caller's
// X-API-Key when one is given. Reads only: GET, and the read-only POST /v1/pools/quote.
export const DEFAULT_LAYER = 'https://coord.taifoon.dev';
export const TIMEOUT_MS = 15_000;

/** A fetcher for runStep: (path, init?) → { status, json } | null (null = no answer). The key is never logged. */
export function layerFetcher({ base = DEFAULT_LAYER, key = null, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, version = '0' } = {}) {
  const root = base.replace(/\/$/, '');
  return async (path, init) => {
    try {
      const r = await fetchImpl(root + path, {
        method: init?.method ?? 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: 'application/json', 'user-agent': `taifoon-cli/${version}`,
          ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(key ? { 'x-api-key': key } : {}),
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    } catch { return null; }
  };
}

export const hostOf = (base) => new URL(base).host;
