// `taifoon up`, `taifoon status`, `taifoon curl`: the STUDIO session's readiness walk, in the terminal.
// Lines match the web panel's STUDIO `up` on taifoon.io: → [n/5] step, ● call,
// ⎿ status · ms, ✓ / ! / ✗ fact · ms, the step text, → next actions. Nothing here signs or writes to the layer.
import { fmtAge } from '@taifoon/term';
import { SESSION_STEPS, curlFor, runStep, scripted } from './steps.mjs';
import { FRESH_MS, openState, readLast } from './state.mjs';

const keyHeader = (key) => (key ? ` -H "x-api-key: $TAIFOON_API_KEY"` : '');
const wilsonNum = (x) => (typeof x === 'number' && Number.isFinite(x) ? String(Number(x.toFixed(4))) : String(x));

/** The Jev pad call the web's Jev button makes (POST /v1/hire/pad, phase quote), printed for the user to run. */
export function padCurl(host, chain, seller, key) {
  return curlFor(host, 'POST', '/v1/hire/pad', { phase: 'quote', chainId: chain, seller }) + keyHeader(key);
}

/** Print what follows the calls: the mark, the layer's record (quote), the step text, the next actions. */
export function renderResult(t, r, o) {
  const extra = o.cachedAt !== undefined ? `cached ${fmtAge(o.now - o.cachedAt)}` : null;
  t.mark(r.mark, r.fact, { ms: r.ms, extra });
  if (r.step === 'quote' && r.record) {
    const w = Array.isArray(r.record.wilson) ? r.record.wilson : null;
    t.note(w
      ? `95% Wilson interval on the incorrect rate ${wilsonNum(w[0])}–${wilsonNum(w[1])} · n ${r.record.n} · ${r.record.incorrect} incorrect · ${r.record.calibrated ? 'calibrated' : 'not calibrated'} (from /v1/pools/quote)`
      : `no interval yet: ${r.record.settled ?? 0} settled (from /v1/pools/quote)`);
  }
  t.say(scripted(r.facts));
  for (const a of r.next ?? []) {
    if (a.kind === 'curl') { t.next(a.label); if (a.cmd) t.cmd(a.cmd); }
    else if (a.kind === 'read') t.next(`${a.label}: ${o.base}${a.href}`);
    else if (a.kind === 'owner-signs') {
      if (/\/enrich$/.test(a.href ?? '')) t.next(`${a.label} at ${o.base}${a.href} (GET it for the message, sign it, POST the signature back)`);
      else t.next(`${a.label} · the unsigned call is in ${o.base}${a.href}`);
    } else if (a.kind === 'jev') {
      t.next(`${a.label} (one of your 3 free Jev calls, or your key's)`);
      if (o.seller) t.cmd(padCurl(o.host, o.agent.chain, o.seller, o.key));
      else t.note('no seller address was read for this agent, so there is no pad to fill');
    }
  }
}

/**
 * The walk. o: { agent, ref, get, host, base, key, dir, now, json, fresh, t }
 * Returns 0 when no step failed, 1 when a step failed (the walk stops there, as on the web).
 */
export async function up(o) {
  const { t, agent, now } = o;
  const st = openState(o.dir, agent);
  const t0 = now();
  const tally = { ok: 0, warn: 0, fail: 0 };
  let seller = null;
  t.info(`taifoon up · agent ${o.ref} · ${SESSION_STEPS.length} steps`);
  for (const [k, step] of SESSION_STEPS.entries()) {
    const prev = st.get(step);
    if (!o.fresh && prev && prev.result?.mark === 'ok' && now() - prev.at < FRESH_MS) {
      const r = prev.result;
      seller = r.seller ?? seller;
      tally.ok++;
      if (o.json) t.json({ ...r, cached_at: prev.at });
      t.step(k + 1, SESSION_STEPS.length, step);
      renderResult(t, r, { ...o, seller, cachedAt: prev.at, now: now() });
      continue;
    }
    t.step(k + 1, SESSION_STEPS.length, step);
    let spin = null;
    const r = await runStep(step, agent, {
      get: o.get, host: o.host, now, retry: `retry: taifoon up ${o.ref}`,
      onCall: (c) => { t.call(c.method, c.url, c.body); spin = t.spinner('reading …'); },
      onCalled: (c) => { spin?.stop(); spin = null; t.called(c.status, c.ms); },
    });
    seller = r.seller ?? seller;
    st.put(step, r, now());
    tally[r.mark === 'ok' ? 'ok' : r.mark === 'warn' ? 'warn' : 'fail']++;
    if (o.json) t.json(r);
    renderResult(t, r, { ...o, seller, now: now() });
    if (r.mark === 'fail') {
      t.line(t.palette.red(`stopped at step ${k + 1}. retry: taifoon up ${o.ref}`));
      return 1;
    }
  }
  t.info(`done · ${tally.ok} ✓ · ${tally.warn} ! · ${tally.fail} ✗ · ${now() - t0} ms · taifoon curl prints the last step's calls`);
  return 0;
}

/** Every step and its mark from the state file. */
export function status(o) {
  const { t, agent } = o;
  const st = openState(o.dir, agent);
  const any = SESSION_STEPS.some((s) => st.get(s));
  if (o.json) { t.json({ agent: st.state.agent, file: st.path, steps: Object.fromEntries(SESSION_STEPS.map((s) => [s, st.get(s)])) }); return any ? 0 : 1; }
  if (!any) { t.skip(`${o.ref} has not been walked on this machine: taifoon up ${o.ref}`); return 1; }
  t.info(`taifoon status · agent ${o.ref} · ${st.path}`);
  for (const [k, step] of SESSION_STEPS.entries()) {
    const s = st.get(step);
    const label = `[${k + 1}/${SESSION_STEPS.length}] ${step}`;
    if (!s) { t.skip(`${label} · not run`); continue; }
    const age = o.now() - s.at;
    const stale = s.result.mark === 'ok' && age >= FRESH_MS ? ' · re-read on the next up' : '';
    t.mark(s.result.mark, `${label} · ${s.result.fact}`, { extra: `${fmtAge(age)}${stale}` });
  }
  return 0;
}

/** The curl for the last step's calls (and its next actions' commands). */
export function curl(o) {
  const { t, agent } = o;
  const st = openState(o.dir, agent);
  const last = readLast(o.dir);
  const byTime = SESSION_STEPS.map((s) => [s, st.get(s)]).filter(([, v]) => v).sort((a, b) => b[1].at - a[1].at);
  const step = last?.agent === st.state.agent && st.get(last.step) ? last.step : byTime[0]?.[0];
  if (!step) {
    if (o.json) t.json({ agent: st.state.agent, step: null, calls: [], next: [] });
    else t.skip(`no step has run for ${o.ref}: taifoon up ${o.ref}`);
    return 1;
  }
  const { result: r, at } = st.get(step);
  const calls = r.calls.map((c) => ({ method: c.method, path: c.path, status: c.status, curl: curlFor(o.host, c.method, c.path, c.body) + keyHeader(o.key) }));
  const next = (r.next ?? []).filter((a) => a.kind === 'curl' && a.cmd).map((a) => a.cmd);
  if (r.step === 'jev' && r.seller === null) {
    const seller = st.get('readiness')?.result?.seller ?? st.get('quote')?.result?.seller ?? null;
    if (seller) next.push(padCurl(o.host, agent.chain, seller, o.key));
  }
  if (o.json) { t.json({ agent: st.state.agent, step, n: r.n, at, calls, next }); return 0; }
  t.line(`# [${r.n}/${r.of}] ${step} · read ${fmtAge(o.now() - at)}`);
  for (const c of calls) t.line(c.curl);
  if (next.length) { t.line('# next'); for (const c of next) t.line(c); }
  return 0;
}
