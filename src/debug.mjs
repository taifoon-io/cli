// _ONE_PRODUCT_v1_: the connection debuggers — each folds a few /v1 reads into one verdict (ok | warn | fail | unknown) with the
// findings that led to it and the reads it made, so a person at the prompt and the agent get the same answer. Read-only: none of
// these sends, signs or restarts anything. Every read carries a timeout (getterOf); a debugger never waits on a box.
//   debugRpc       a chain: the warmbed rotation's endpoints for it + its header collector's freshness in the superroot
//   debugProtocol  a protocol leaf: how far its watcher lags, which orders are stuck and why, measured stage times
//   debugOrder     one order of a protocol: its stages, its latest, whether it is stuck and the reason
//   debugEnvelope  one pipe envelope: state, attempts, carrier, ack, the reason it was retried / dropped
//   debugProject   a project board: webhook set or not, open / stuck orders, its lane
//   debugResource  one hosted resource of yours: status, metrics, the error lines in its recent logs (role-scoped by the layer)

const verdict = (findings) => (findings.some((f) => f.level === 'fail') ? 'fail' : findings.some((f) => f.level === 'warn') ? 'warn' : findings.some((f) => f.level === 'ok') ? 'ok' : 'unknown');
const f = (level, text, extra = {}) => ({ level, text, ...extra });
const done = (findings, reads, more = {}) => ({ ok: true, verdict: verdict(findings), findings, reads, ...more });
const readOf = (path, r) => ({ path, status: r.status, ...(r.error ? { error: r.error } : {}) });

/** a chain's RPC rotation and header collection. args { chain } */
export async function debugRpc({ chain }, { get }) {
  let c = String(chain ?? '').trim();
  const findings = []; const reads = [];
  if (!/^\d+$/.test(c)) {
    // a name (base, arbitrum one, …) → its id, from the chains the superroot collects
    const all = await get('/v1/root/chains'); reads.push(readOf('/v1/root/chains', all));
    const norm = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const hit = (all.json?.chains ?? []).find((x) => norm(x.network_name) === norm(c)) ?? (all.json?.chains ?? []).find((x) => norm(x.network_name).startsWith(norm(c)));
    if (!hit) return { ok: false, error: `no chain named ${c}: give a chain id (e.g. 8453) or a name the superroot collects`, reads };
    c = String(hit.chain_id);
  }
  const rpc = await get(`/v1/rpc/${c}`); reads.push(readOf(`/v1/rpc/${c}`, rpc));
  if (!rpc.json || rpc.json.ok === false) findings.push(f('fail', `the warmbed has no rotation for chain ${c} (${rpc.status ?? rpc.error})`));
  else {
    const call = Array.isArray(rpc.json.call) ? rpc.json.call : []; const logs = Array.isArray(rpc.json.logs) ? rpc.json.logs : [];
    const up = call.filter((e) => e.status === 'healthy' || (e.health_score ?? 0) >= 0.5 && !e.in_backoff);
    findings.push(f(up.length ? 'ok' : 'fail', `${up.length} of ${call.length} call endpoints usable for ${rpc.json.name ?? c}; best ${rpc.json.best ?? 'none'}`));
    if (!logs.length) findings.push(f('warn', 'no endpoint serves eth_getLogs ranges: lanes on this chain fall back to small windows'));
    const backoff = call.filter((e) => e.in_backoff).length; if (backoff) findings.push(f('warn', `${backoff} endpoint(s) in 429 backoff`));
  }
  const roots = await get('/v1/root/chains'); reads.push(readOf('/v1/root/chains', roots));
  const ch = roots.json?.chains?.find?.((x) => String(x.chain_id) === c);
  if (!ch) findings.push(f('warn', `chain ${c} is not collected in the superroot`));
  else {
    const age = ch.last_header_age_secs;
    findings.push(f(ch.status === 'retired' ? 'warn' : age > 600 ? 'fail' : age > 120 ? 'warn' : 'ok', `header collector ${ch.status}: latest block ${ch.latest_block}, last header ${age}s ago`, { chain: ch.network_name }));
  }
  return done(findings, reads);
}

/** a protocol leaf: watcher lag, stuck orders with reasons, measured paths. args { protocol } */
export async function debugProtocol({ protocol }, { get }) {
  const p = String(protocol ?? '').trim().toLowerCase().replace(/-/g, '_'); if (!/^[a-z0-9_]+$/.test(p)) return { ok: false, error: 'protocol is a slug (e.g. layerzero_v2)' };
  const findings = []; const reads = [];
  const s = await get(`/v1/protocol/${p}/stuck?limit=5`); reads.push(readOf(`/v1/protocol/${p}/stuck`, s));
  if (!s.json || s.json.ok === false) {
    // name the leaves that exist, closest first, so the next call is right
    const list = await get('/v1/protocols'); reads.push(readOf('/v1/protocols', list));
    const norm = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const slugs = (Array.isArray(list.json) ? list.json : list.json?.protocols ?? []).map((x) => x.slug).filter(Boolean);
    const near = slugs.filter((x) => norm(x).includes(norm(p)) || norm(p).includes(norm(x))).slice(0, 5);
    return { ok: false, error: `no protocol leaf ${p}`, did_you_mean: near, protocols: near.length ? undefined : slugs.slice(0, 40), reads };
  }
  else {
    findings.push(f(s.json.lag > 300 ? 'warn' : 'ok', `${s.json.tracked ?? 0} orders tracked, the watcher ${s.json.lag ?? 0}s behind`));
    const n = Object.values(s.json.counts ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
    if (n) findings.push(f('warn', `${n} stuck: ${Object.entries(s.json.counts).filter(([, v]) => v).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')}`, { examples: (s.json.stuck ?? []).slice(0, 3).map((x) => ({ key: x.key, reason: x.reason, age_s: x.age_s, src: x.src_chain, dst: x.dst_chain })) }));
    else findings.push(f('ok', 'nothing stuck'));
  }
  const paths = await get(`/v1/protocol/${p}/paths`); reads.push(readOf(`/v1/protocol/${p}/paths`, paths));
  const rows = paths.json?.paths ?? [];
  if (rows.length) findings.push(f('ok', `${rows.length} measured chain pairs`));
  return done(findings, reads);
}

/** one order: stages, latest, stuck reason. args { protocol, key } */
export async function debugOrder({ protocol, key }, { get }) {
  const p = String(protocol ?? '').trim(); const k = String(key ?? '').trim();
  if (!p || !k) return { ok: false, error: 'needs protocol and key' };
  const path = `/v1/protocol/${encodeURIComponent(p)}/order/${encodeURIComponent(k)}`;
  const o = await get(path); const reads = [readOf(path, o)]; const findings = [];
  if (!o.json || o.json.ok === false) findings.push(f('fail', `no order ${k} on ${p} (${o.json?.error ?? o.status ?? o.error})`));
  else {
    const stages = o.json.stages ?? o.json.transitions ?? [];
    findings.push(f(o.json.failed ? 'fail' : o.json.final ? 'ok' : 'warn', `latest stage ${o.json.latest ?? 'unknown'}${o.json.final ? ' (final)' : ' (open)'}; ${stages.length} stage(s) seen`));
    if (o.json.stuck) findings.push(f('warn', `stuck: ${o.json.stuck.reason ?? o.json.stuck}`));
    const unproven = stages.filter((x) => x && x.proof && x.proof.state && x.proof.state !== 'proven');
    if (unproven.length) findings.push(f('warn', `${unproven.length} stage(s) not proven yet`));
  }
  return done(findings, reads, { order: o.json ?? null });
}

/** one pipe envelope. args { id } */
export async function debugEnvelope({ id }, { get }) {
  const e = String(id ?? '').trim(); if (!/^0x[0-9a-fA-F]{8,64}$/.test(e)) return { ok: false, error: 'id is an envelope id (0x…)' };
  const s = await get(`/v1/pipe/status/${e}`); const reads = [readOf(`/v1/pipe/status/${e}`, s)]; const findings = [];
  if (!s.json || s.json.ok === false) findings.push(f('fail', `no envelope ${e} (${s.json?.error ?? s.status ?? s.error})`));
  else {
    const j = s.json; const last = (j.history ?? []).at(-1);
    const state = last?.state ?? j.state ?? 'unknown';
    findings.push(f(['dropped', 'dead', 'lost'].includes(state) ? 'fail' : j.acked_at ? 'ok' : 'warn', `${j.envelope?.kind ?? '?'} via ${j.carrier ?? '?'}: ${state}, ${j.attempts ?? 0} attempt(s)${j.acked_at ? ', acked' : ', not acked yet'}`));
    const why = (j.history ?? []).map((h) => h.reason).filter(Boolean);
    if (why.length) findings.push(f('warn', `reasons on the way: ${[...new Set(why)].join('; ')}`));
    if (j.deadline && !j.acked_at && j.deadline * 1000 < Date.now()) findings.push(f('fail', 'past its deadline without an ack'));
  }
  return done(findings, reads);
}

/** a project board: webhook, open/stuck orders, lane. args { id } */
export async function debugProject({ id }, { get }) {
  const p = String(id ?? '').trim(); if (!p) return { ok: false, error: 'needs a project id' };
  const r = await get(`/v1/projects/${encodeURIComponent(p)}?limit=1`); const reads = [readOf(`/v1/projects/${p}`, r)]; const findings = [];
  if (!r.json || r.json.ok === false) findings.push(f('fail', `no project ${p} (${r.json?.error ?? r.status ?? r.error})`));
  else {
    const j = r.json; const c = j.counts ?? {};
    findings.push(f(j.state === 'live' ? 'ok' : 'warn', `${j.name ?? p}: ${j.state}; ${c.orders ?? 0} orders, ${c.open ?? 0} open, ${c.stuck ?? 0} stuck`));
    findings.push(f(j.webhook?.set ? 'ok' : 'warn', j.webhook?.set ? `webhook set${j.webhook.last_error ? `; last error ${j.webhook.last_error}` : ''}` : 'no webhook: deliveries only through the stream (GET /v1/pipe/stream)'));
    if (j.lane === null && j.state !== 'live') findings.push(f('warn', 'no producer lane yet (lane pending)'));
  }
  return done(findings, reads);
}

/** one hosted resource of the caller: status, metrics, recent error lines. args { id } (needs the key; the layer scopes it) */
export async function debugResource({ id }, { get }) {
  const x = String(id ?? '').trim(); if (!x) return { ok: false, error: 'needs a resource id (taifoon resource list)' };
  const findings = []; const reads = [];
  const list = await get('/v1/hosting/resources', { withKey: true }); reads.push(readOf('/v1/hosting/resources', list));
  if (list.status === 404 && !list.json?.resources) return done([f('unknown', 'the layer does not serve hosting resources yet (GET /v1/hosting/resources answered 404)')], reads);
  const res = (list.json?.resources ?? []).find((r) => r.id === x || r.name === x);
  if (!res) return done([f('fail', `no resource ${x} among yours (${(list.json?.resources ?? []).length} listed)`)], reads);
  findings.push(f(res.status === 'running' ? 'ok' : 'fail', `${res.kind} ${res.name ?? res.id}: ${res.status}`));
  const m = await get(`/v1/hosting/resources/${encodeURIComponent(res.id)}/metrics`, { withKey: true }); reads.push(readOf('…/metrics', m));
  if (m.json && m.json.ok !== false) {
    const mm = m.json.metrics ?? m.json;
    if (typeof mm.restarts === 'number' && mm.restarts > 2) findings.push(f('warn', `${mm.restarts} restarts`));
    if (typeof mm.cpu === 'number') findings.push(f(mm.cpu > 0.9 ? 'warn' : 'ok', `cpu ${(mm.cpu * 100).toFixed(0)}%`));
  }
  const l = await get(`/v1/hosting/resources/${encodeURIComponent(res.id)}/logs?tail=200`, { withKey: true }); reads.push(readOf('…/logs', l));
  const lines = Array.isArray(l.json?.lines) ? l.json.lines : typeof l.json?.logs === 'string' ? l.json.logs.split('\n') : [];
  const errs = lines.map((s) => (typeof s === 'string' ? s : s?.line ?? JSON.stringify(s))).filter((s) => /\b(error|panic|fail(ed|ure)?|refused|timeout|timed out|revert)/i.test(s));
  if (errs.length) findings.push(f('warn', `${errs.length} error line(s) in the last ${lines.length}`, { last: errs.slice(-5) }));
  else if (lines.length) findings.push(f('ok', `no error lines in the last ${lines.length}`));
  return done(findings, reads, { resource: res });
}

export const DEBUGGERS = Object.freeze({ debugRpc, debugProtocol, debugOrder, debugEnvelope, debugProject, debugResource });
