// One context per command run: the streams, the palette, the layer client (every read and write goes to /v1, so every call
// is metered by the layer and listed here with its status and time), the key and where it came from, and the flags every
// command shares. Commands receive it and never reach for process.* themselves, so tests pass fakes for all of it.
import { createTerm } from '@taifoon/term';
import { DEFAULT_LAYER, TIMEOUT_MS } from './api.mjs';
import { brand, setWidth } from './brand.mjs';
import { defaultExec, loadConfig, prefixOf, profileOf, resolveKey } from './config.mjs';

/** Split argv into positionals and --flags (values for the named value flags; booleans otherwise). */
export function parseFlags(argv, valued = []) {
  const pos = []; const f = {};
  const V = new Set(['layer', 'key', 'profile', ...valued]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = (eq > 0 ? a.slice(2, eq) : a.slice(2));
      if (eq > 0) f[name] = a.slice(eq + 1);
      else if (V.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) f[name] = argv[++i];
      else f[name] = true;
    } else pos.push(a);
  }
  return { pos, f };
}

export function makeContext(io, f, version) {
  const out = io.out ?? process.stdout; const err = io.err ?? process.stderr; const env = io.env ?? process.env;
  const exec = io.exec ?? defaultExec;
  const json = !!f.json;
  const color = f['no-color'] ? false : undefined;
  const p = brand(out, env, color === false ? false : undefined);
  const width = setWidth(out, env);
  const t = createTerm({ out, env, color, quiet: json });
  const et = createTerm({ out: err, env, color });
  const cfg = io.cfg ?? loadConfig(env);
  const profile = f.profile ?? env.TAIFOON_PROFILE ?? cfg.profile ?? 'default';
  const prof = profileOf(cfg, profile);
  const base = String(f.layer ?? env.TAIFOON_LAYER ?? prof.layer ?? DEFAULT_LAYER).replace(/\/$/, '');
  let host; try { host = new URL(base).host; } catch { host = null; }
  const fetchImpl = io.fetch ?? globalThis.fetch;
  const now = io.now ?? (() => Date.now());
  const calls = [];
  let keyInfo = null;
  const ctx = {
    io, out, err, env, exec, json, p, t, et, width, cfg, profile, prof, base, host, now, version, f, calls,
    tty: !!out.isTTY && !json,
    /** the key for this run (resolved once, lazily: a guest command never touches a store) */
    key() { if (!keyInfo) keyInfo = resolveKey({ flag: typeof f.key === 'string' ? f.key : null, env, prof, exec }); return keyInfo.key; },
    keyInfo() { ctx.key(); return { source: keyInfo.source, prefix: prefixOf(keyInfo.key), error: keyInfo.error ?? null }; },
    /** one call to the layer. opts: { method, body, key: false (never send the key), headers, quiet } → { status, json, ms } */
    async call(path, opts = {}) {
      const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
      const k = opts.key === false ? null : ctx.key();
      const t0 = now();
      const spin = !opts.quiet && ctx.tty ? t.spinner(`${method} ${host}${path}`) : null;
      let status = null; let body = null; let error = null;
      try {
        const r = await fetchImpl(base + path, {
          method, signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS * 3),
          headers: { accept: 'application/json', 'user-agent': `taifoon-cli/${version}`, ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(k ? { 'x-api-key': k } : {}), ...(opts.headers ?? {}) },
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        });
        status = r.status; body = await r.json().catch(() => null);
      } catch (e) { error = e?.name === 'TimeoutError' ? 'timed out' : (e?.message ?? 'no answer'); }
      spin?.stop();
      const ms = now() - t0;
      calls.push({ method, path, status, ms, ...(error ? { error } : {}) });
      if (!opts.quiet && !json && f.verbose) t.called(status, ms, error);
      return { status, json: body, ms, ok: status !== null && status >= 200 && status < 300 && body?.ok !== false, error };
    },
    get: (path, o) => ctx.call(path, { ...o, method: 'GET' }),
    post: (path, body, o) => ctx.call(path, { ...o, method: 'POST', body }),
    /** --json: one JSON value, with the calls this run made (the metering the layer also records) */
    emit(v) { out.write(JSON.stringify({ ...v, calls }) + '\n'); },
    line: (s = '') => { if (!json) out.write(s + '\n'); },
    fail: (s) => { et.fail(s); },
    /** ask y/N on a TTY; refuse (false) when there is no TTY or --yes was not given in a pipe */
    async confirm(q) {
      if (f.yes === true) return true;
      const input = io.stdin ?? process.stdin;
      if (!input.isTTY) return false;
      out.write(`  ${p.you(q)} ${p.faint('[y/N]')} `);
      const ans = await readLine(input);
      return /^y(es)?$/i.test(ans.trim());
    },
    /** read one hidden line from a TTY (a pasted key); null without a TTY */
    async secret(q) {
      const input = io.stdin ?? process.stdin;
      if (!input.isTTY || typeof input.setRawMode !== 'function') return null;
      out.write(`  ${p.you(q)} `);
      return readHidden(input, out);
    },
  };
  return ctx;
}

function readLine(input) {
  return new Promise((resolve) => {
    let buf = '';
    const on = (d) => { buf += d.toString('utf8'); const i = buf.indexOf('\n'); if (i >= 0) { input.off('data', on); input.pause?.(); resolve(buf.slice(0, i)); } };
    input.resume?.(); input.on('data', on);
  });
}
function readHidden(input, out) {
  return new Promise((resolve) => {
    let buf = '';
    input.setRawMode(true); input.resume();
    const on = (d) => {
      for (const ch of d.toString('utf8')) {
        if (ch === '\r' || ch === '\n') { input.setRawMode(false); input.off('data', on); input.pause(); out.write('\n'); return resolve(buf); }
        if (ch === '\u0003') { input.setRawMode(false); input.off('data', on); input.pause(); out.write('\n'); return resolve(null); }
        if (ch === '\u007f') buf = buf.slice(0, -1); else buf += ch;
      }
    };
    input.on('data', on);
  });
}

/** 12,345 */
export const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : v === null || v === undefined ? '—' : String(v));
