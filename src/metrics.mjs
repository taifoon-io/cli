// `taifoon metrics` — what went through the coordination layer, in the terminal (_COORD_METRICS_v1_). The same view as the
// site console's START panel (THROUGH US · TODAY), read from GET /v1/metrics and GET /v1/network:
//   today vs yesterday vs the 7-day average (customers · ours), top routes, top customers (hashed), fees earned and what
//   the gateway WOULD have charged, the funnel discovered → hireable → handshaken → hired → graded → settled → paid, and the
//   network as the hourly auto-connect run last saw it. --watch re-reads every N s; --json prints the two answers for agents.
// Lines follow the step renderer: → heading, ✓ / ! / · facts, ⎿ notes.

const HEAD = [
  ['api_calls', 'API CALLS'], ['unique_callers', 'UNIQUE CALLERS'], ['gateway_steps', 'GATEWAY λ STEPS'], ['handshakes', 'HANDSHAKES'],
  ['hires_settled', 'HIRES SETTLED'], ['grades', 'GRADES'], ['bridges', 'BRIDGES'], ['bridge_volume_usdc', 'BRIDGED USDC'],
  ['fees_earned_usdc', 'FEES EARNED USDC'], ['would_charge_usdc', 'WOULD HAVE CHARGED'],
];
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? (Number.isInteger(v) ? v.toLocaleString('en-US') : String(Number(v.toFixed(Math.abs(v) < 1 ? 4 : 1)))) : '—');
const pad = (s, w) => { const t = String(s); return t.length >= w ? t : t + ' '.repeat(w - t.length); };
const lpad = (s, w) => { const t = String(s); return t.length >= w ? t : ' '.repeat(w - t.length) + t; };
const pair = (h, k) => (h ? `${n(h.customers?.[k])} · ${n(h.ours?.[k])}` : '—');

/** The dashboard as plain lines (no colour): pure over the two answers, so tests snapshot it. */
export function metricsLines(m, net, { base = 'https://coord.taifoon.dev' } = {}) {
  const L = [];
  if (!m?.ok) { L.push(['fail', `/v1/metrics did not answer${m?.error ? `: ${m.error}` : ''}`]); return L; }
  L.push(['head', `through us · ${m.day} UTC · customers · ours`]);
  L.push(['raw', `  ${pad('', 20)}${lpad('TODAY', 16)}${lpad('YESTERDAY', 16)}${lpad('7-DAY AVG', 16)}`]);
  for (const [k, label] of HEAD) L.push(['raw', `  ${pad(label, 20)}${lpad(pair(m.compare?.today, k), 16)}${lpad(pair(m.compare?.yesterday, k), 16)}${lpad(pair(m.compare?.avg7, k), 16)}`]);
  L.push(['note', `ours = ${m.rule?.ours ?? ''}`]);

  L.push(['head', 'top routes today']);
  const routes = (m.api?.by_route ?? []).slice(0, 6);
  if (!routes.length) L.push(['skip', 'no /v1 calls counted yet today']);
  for (const r of routes) L.push(['ok', `${pad(`${r.method} /v1/${r.route}`, 44)} ${lpad(n(r.calls), 6)} · ${r.key_class} · ${r.whose}`]);
  const ch = m.api?.by_channel ?? {};
  if (Object.keys(ch).length) L.push(['note', `channels: ${Object.entries(ch).map(([c, s]) => `${c} ${n(s.customers)} · ${n(s.ours)}`).join(' / ')}`]);

  L.push(['head', 'top customers today (hashed)']);
  const cust = [...(m.api?.top_callers ?? []).filter((c) => c.whose === 'customers').map((c) => ({ who: c.caller, calls: c.calls, steps: 0 })),
    ...(m.gateway?.top_callers ?? []).filter((c) => c.whose === 'customers').map((c) => ({ who: c.caller, calls: 0, steps: c.steps }))]
    .reduce((acc, c) => { const e = acc.find((x) => x.who === c.who); if (e) { e.calls += c.calls; e.steps += c.steps; } else acc.push({ ...c }); return acc; }, [])
    .sort((a, b) => b.calls + b.steps - (a.calls + a.steps)).slice(0, 5);
  if (!cust.length) L.push(['skip', 'no customer calls today']);
  for (const c of cust) L.push(['ok', `${pad(c.who, 30)} ${lpad(n(c.calls), 6)} calls · ${n(c.steps)} gateway steps`]);

  L.push(['head', 'fees (every path that carries one to us)']);
  for (const f of m.fees ?? []) {
    let v = '';
    if (f.earned_usdc) v = `earned ${n(f.earned_usdc.customers)} · ${n(f.earned_usdc.ours)} USDC`;
    if (Array.isArray(f.earned)) v = f.earned.map((e) => `${e.line}: ${n(e.earned_customers)} · ${n(e.earned_ours)} ${e.symbol}`).join('; ') || 'nothing yet';
    if (f.would_charge_usdc) v = `would have charged ${n(f.would_charge_usdc.customers)} · ${n(f.would_charge_usdc.ours)} USDC · charged ${n(f.charged_usdc?.customers)} · ${n(f.charged_usdc?.ours)}`;
    L.push([/^live|accruing/.test(f.status) ? 'ok' : 'warn', `${pad(f.path, 10)} ${f.rule} · ${v}`]);
    L.push(['note', f.status]);
  }

  L.push(['head', 'funnel (all time, through the layer)']);
  L.push(['raw', `  ${(m.funnel ?? []).map((s) => `${s.id} ${n(s.n)}${s.from_prev !== null && s.from_prev !== undefined ? ` (${Math.round(s.from_prev * 1000) / 10}%)` : ''}`).join(' → ')}`]);

  L.push(['head', 'network (the hourly auto-connect run)']);
  if (!net?.ok) L.push(['warn', `no snapshot yet${net?.error ? `: ${net.error}` : ''}`]);
  else {
    L.push([net.sellers.online === net.sellers.classes ? 'ok' : 'warn', `sellers online ${net.sellers.online}/${net.sellers.classes} classes · median ${n(net.sellers.median_latency_ms)} ms · p90 ${n(net.sellers.p90_latency_ms)} ms`]);
    L.push([net.chains_healthy.split('/')[0] === net.chains_healthy.split('/')[1] ? 'ok' : 'warn', `grid ${net.chains_healthy} chains healthy · ${(net.chains ?? []).map((c) => `${c.name ?? c.chain} ${c.ok ? `#${n(c.head)}` : '✗'}`).join(' · ')}`]);
    for (const r of net.routes ?? []) L.push([r.ok ? 'ok' : 'warn', `route ${r.from} → ${r.to} · 1 USDC → ${n(r.expected_received_usdc)} · fee ${n(r.fee_usdc)} (${r.fee_rule ?? '—'}) · ${r.via ?? '—'}`]);
    L.push(['note', `run ${net.run_id ?? '—'} · ${n(net.steps_recorded)} λ steps · ${net.age_s !== undefined ? `${Math.round(net.age_s / 60)} min ago` : ''} · gateway today ${n(net.gateway_today?.steps)} steps`]);
  }
  L.push(['note', `${base}/v1/metrics · ${base}/v1/network`]);
  return L;
}

export function render(t, lines) {
  for (const [kind, text] of lines) {
    if (kind === 'head') t.head(text);
    else if (kind === 'raw') t.line(text);
    else if (kind === 'note') t.note(text);
    else t.mark(kind, text);
  }
}

/** taifoon metrics [--day YYYY-MM-DD] [--watch [s]] [--json]. io.sleep and io.ticks let tests run the watch loop. */
export async function metrics({ t, out, get, base, json, day, watch, io = {} }) {
  const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const ticks = io.ticks ?? Infinity;
  for (let i = 0; i < ticks; i++) {
    const [m, nt] = await Promise.all([get(`/v1/metrics${day ? `?day=${day}` : ''}`), get('/v1/network')]);
    const mj = m?.json ?? { ok: false, error: m ? `HTTP ${m.status}` : 'no answer' };
    const nj = nt?.json ?? { ok: false, error: nt ? `HTTP ${nt.status}` : 'no answer' };
    if (json) out.write(JSON.stringify({ metrics: mj, network: nj }) + '\n');
    else {
      if (watch && out.isTTY) out.write('\u001b[2J\u001b[H');
      render(t, metricsLines(mj, nj, { base }));
    }
    if (!watch) return mj?.ok ? 0 : 1;
    await sleep(watch * 1000);
  }
  return 0;
}
