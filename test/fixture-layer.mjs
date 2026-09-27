// A recorded layer: the /v1 answers one `taifoon up` walk read, keyed by "METHOD path [body]".
import { readFileSync } from 'node:fs';

export const keyOf = (path, init) => `${init?.method ?? 'GET'} ${path}${init?.body !== undefined ? ' ' + JSON.stringify(init.body) : ''}`;

export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

/** A fetch() over a fixture's responses; unrecorded requests answer 599 so a test sees them. */
export function fixtureFetch(fx, over = {}) {
  const seen = [];
  const root = fx.base.replace(/\/$/, '');
  const f = async (url, init) => {
    const path = url.startsWith(root) ? url.slice(root.length) : url;
    const body = init?.body !== undefined ? JSON.parse(init.body) : undefined;
    const k = keyOf(path, { method: init?.method, body });
    seen.push({ k, headers: init?.headers ?? {} });
    const hit = over[k] ?? fx.responses[k];
    if (!hit) return new Response(JSON.stringify({ ok: false, error: `unrecorded: ${k}` }), { status: 599 });
    return new Response(JSON.stringify(hit.json), { status: hit.status });
  };
  return { f, seen };
}

/** A clock that moves 7 ms per read, so every ms in a snapshot is stable. */
export function fakeClock(start = 1_790_500_000_000, step = 7) {
  let t = start;
  const now = () => (t += step);
  now.advance = (ms) => { t += ms; };
  return now;
}

/** A captured stream (not a TTY, so no colour and no spinner). */
export function sink() {
  const buf = [];
  return { isTTY: false, write: (s) => { buf.push(s); return true; }, text: () => buf.join('') };
}
