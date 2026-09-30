// The five steps of `taifoon up`, as the STUDIO session runs them.
//
// This is a port of the web panel's wizard engine (runStep, readinessFacts, jevFacts, scripted, curlFor, parseAgent)
// so the terminal and the web panel print the same marks, facts and next actions from the same
// /v1 answers, and a parity test runs it against the web engine itself on the same recorded answers.
// Differences, all additive: an `onCalled` hook (the terminal prints ⎿ as each read returns), `retry` names the
// command that re-runs a step ('/retry' on the web), and the quote step keeps the layer's `record` (its Wilson
// interval, n, incorrect) on the result so the terminal can print those numbers as the layer gave them.
// Nothing here writes. Every call is a GET or the read-only POST /v1/pools/quote.

export const SESSION_STEPS = Object.freeze(['readiness', 'probe', 'classes', 'quote', 'jev']);
export const STEP_TITLES = Object.freeze({
  readiness: 'Reading the checklist', probe: 'Checking the probe', classes: 'Matching job classes', quote: 'Quoting cover', jev: 'Checking the grader',
});

// the /jev page's lead copy (JEV_INTRO), which the scripted jev line reads
const JEV_HEADLINE = 'Jev grades agent jobs, and every answer lands on chain.';
const JEV_HOW = [
  ['FACTS', 'Code reads the job first: was anything delivered, and do the checks the evidence allows pass. A hard fail is a reject and Jev is not asked.'],
  ['ANSWERS', 'Jev answers four closed questions about the delivery and returns the whole probability distribution, not a pass/fail cut.'],
  ['RECORD', 'Code composes complete, reject or needs review under a published rubric. The decision is recorded with its digest and anchored on the Taifoon devnet.'],
];
export const JEV_INTRO = Object.freeze([JEV_HEADLINE, ...JEV_HOW.flatMap(([k, v]) => [k, v])]);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
// a Fetch.ai agent address (agent1…, _AGENTVERSE_LANE_v1_) is an id too: taifoon up reads its own Almanac record
const ID_RE = /^(?:\d{1,20}|0x[0-9a-fA-F]{40}|agent1[02-9ac-hj-np-z]{50,70})$/;
// an official MCP registry server name (_MCP_REGISTRY_v1_): reverse-DNS namespace with a dot, a slash, a name
const REGISTRY_RE = /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+\/[a-zA-Z0-9._-]{1,120}$/;
const str = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v ? v : null);
const enc = encodeURIComponent;

/** "95902" · "8453:95902" · "erc8004:8453:95902" · "0x…40" (a seller address) · "agent1…" (a Fetch.ai agent), with an optional separate chain. */
export function parseAgent(raw, chainRaw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim().replace(/^#/, '');
  if (!s) return null;
  // _X402_HIRE_v1_: an x402 resource URL (https, no query) is a subject too: taifoon up reads its Bazaar listing
  const url = s.replace(/^\d{1,7}:(?=https:\/\/)/i, ''); // "8453:https://…" is how the CLI's state names it
  if (/^https:\/\//i.test(url)) { try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password ? { chain: 8453, id: `https://${u.host.toLowerCase()}${u.pathname}` } : null; } catch { return null; } }
  // _A2A_REGISTRY_v1_: "a2a:<registry id>" names an agent in the A2A Registry (GET /v1/a2a/registry/agent)
  const a2a = /^(?:\d{1,7}:)?a2a:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.exec(s); // "8453:a2a:…" is how the CLI state names it
  if (a2a) return { chain: 8453, id: `a2a:${a2a[1].toLowerCase()}` };
  // _AGENTKIT_LANE_v1_: "agentkit:0x…" names a Coinbase AgentKit worker registered with the layer (GET /v1/agentkit)
  const ak = /^(?:\d{1,7}:)?agentkit:(0x[0-9a-fA-F]{40})$/i.exec(s); // "36927:agentkit:0x…" is how the CLI state names it
  if (ak) return { chain: 36927, id: `agentkit:${ak[1].toLowerCase()}` };
  // _MCP_REGISTRY_v1_: an official MCP registry name (io.github.<owner>/<name>) is a subject too; its case is kept
  const reg = s.replace(/^\d{1,7}:(?=[a-zA-Z])/, '');
  if (REGISTRY_RE.test(reg)) return { chain: 8453, id: reg };
  const parts = s.split(':').filter(Boolean);
  const id = parts[parts.length - 1];
  const chainFromRef = parts.length >= 2 ? Number(parts[parts.length - 2]) : NaN;
  const chainArg = Number(chainRaw);
  const chain = Number.isInteger(chainFromRef) && chainFromRef > 0 ? chainFromRef : Number.isInteger(chainArg) && chainArg > 0 ? chainArg : 8453;
  if (!ID_RE.test(id) || chain > 9_999_999) return null;
  return { chain, id: id.toLowerCase() };
}

/** adapters/wizard/build_dataset.py how_text, the same three shapes */
export function howText(h) {
  if (!isObj(h)) return null;
  if (h.kind === 'api' && h.method && h.path) return `${h.method} ${h.path}`;
  if (h.kind === 'chain' && h.call && h.to) return `${h.call} on ${h.to}`;
  if (h.process) return `automatic: ${h.process}`;
  return null;
}

/** The readiness view, as the wizard adapter saw it in training, plus the quote the checklist points at. */
export function readinessFacts(r, quote, name = null) {
  const words = Array.isArray(r.words) ? r.words.filter((w) => typeof w === 'string') : [];
  const counts = {};
  if (isObj(r.counts)) for (const [k, v] of Object.entries(r.counts)) { const s = str(v); if (s !== null) counts[k] = s; }
  const f = {
    view: 'readiness', agent: str(r.agent_key), verdict: str(r.verdict), hireable: r.hireable === true, assured: r.assured === true,
    summary: words.length ? words.join(' ') : null, counts,
  };
  if (name) f.name = name;
  const n = r.next;
  if (isObj(n) && str(n.step)) {
    const next = { step: String(n.step), who: str(n.who) ?? '', why: str(n.why) ?? '' };
    const h = howText(n.how);
    if (h) next.how = h;
    f.next = next;
  }
  const steps = Array.isArray(r.steps) ? r.steps : [];
  f.steps = steps.filter((s) => isObj(s)).map((s) => `${str(s.n) ?? ''} ${str(s.id) ?? ''}: ${str(s.status) ?? ''}`).join(' · ');
  if (isObj(quote) && quote.ok !== false && str(quote.premium_label)) {
    const why = Array.isArray(quote.why) ? quote.why.find((w) => typeof w === 'string') : null;
    f.quote = { at_price_usdc: str(quote.price_usdc), guaranteed: quote.guaranteed === true, premium: str(quote.premium_label), deposit_rung: str(quote.deposit_rung), why: why ?? null };
  }
  return f;
}

/** The /jev view: the page's copy and the ledger's counters. */
export function jevFacts(dec, ans) {
  const s = isObj(dec?.summary) ? dec.summary : null;
  const f = { view: 'jev', how_it_works: [...JEV_INTRO] };
  if (s) {
    f.decisions_recorded = str(s.total); f.anchored = str(s.anchored); f.decision_log = str(s.contract); f.chain = str(s.chain);
    if (isObj(s.by_kind)) f.by_kind = Object.fromEntries(Object.entries(s.by_kind).map(([k, v]) => [k, str(v)]).filter(([, v]) => v !== null));
  }
  const a = isObj(ans?.summary) ? ans.summary : null;
  if (a) f.answer_records = str(a.total);
  return f;
}

/** True only when the facts carry the checklist's counts and nothing is missing, pending or blocked (web: wizard.ts). */
export function everyStepOk(f) {
  const c = isObj(f.counts) ? f.counts : null;
  if (!c || !(Number(c.ok) > 0)) return false;
  return ['missing', 'pending', 'blocked'].every((k) => c[k] === undefined || Number(c[k]) === 0);
}

/** The layer's own refusal when it answered 4xx with an error text (the answer, not a failed read). */
export const refusalOf = (r) => (r && r.status >= 400 && r.status < 500 && isObj(r.json) && typeof r.json.error === 'string' && r.json.error ? r.json.error : null);

/** The scripted step text: what the web panel says from the same facts when the guide cannot. */
export function scripted(f) {
  const next = isObj(f.next) ? f.next : null;
  const nextLine = next ? `Next step: ${next.step}. ${next.why}${next.how ? ` Call: ${next.how}.` : ''}` : null;
  if (f.view === 'readiness') {
    if (!f.summary && !next) return `I could not read this agent's checklist just now. Read it at /v1/agents/…/readiness and ask again.`;
    return [f.summary, nextLine ?? (everyStepOk(f) ? 'Every step on this checklist is ok.' : null)].filter(Boolean).join(' ');
  }
  if (f.view === 'jev') {
    const intro = Array.isArray(f.how_it_works) ? f.how_it_works : [...JEV_INTRO];
    const lines = intro.filter((l) => !/^[A-Z]+$/.test(l));
    const count = f.decisions_recorded ? ` ${f.decisions_recorded} decisions recorded, ${f.anchored ?? '—'} anchored on chain ${f.chain ?? '—'}.` : '';
    return lines.join(' ') + count;
  }
  const steps = typeof f.steps === 'string' ? ` The checklist runs ${f.steps.replace(/\d+ /g, '').replace(/ · /g, ' → ')}.` : '';
  return `Enrollment is one ordered checklist, from an on-chain identity to an assured hire.${steps} ${nextLine ?? ''}`.trim();
}

const q = (v) => `'${JSON.stringify(v).replace(/'/g, "'\\''")}'`;
/** A copyable curl for a call, against the public API host. */
export function curlFor(host, method, path, body) {
  return method === 'GET' ? `curl -s https://${host}${path}` : `curl -s -X POST https://${host}${path} -H 'content-type: application/json' -d ${q(body ?? {})}`;
}

const utc = (unix) => (typeof unix === 'number' && unix > 0 ? `${new Date(unix * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null);
const hostOf = (u) => { try { return typeof u === 'string' ? new URL(u).host : null; } catch { return null; } };

/**
 * Run one step of `up`: the real reads, the mark, the fact, the facts for the guide, the next action.
 * ctx: { get(path, init?) → { status, json } | null, host, now?, onCall?(c), onCalled?(c), retry? }
 */
export async function runStep(step, agent, ctx) {
  const now = ctx.now ?? (() => Date.now());
  const retry = ctx.retry ?? '/retry';
  const t0 = now();
  const calls = [];
  const call = async (method, path, body) => {
    const url = `${ctx.host}${path}`;
    ctx.onCall?.({ method, url, path, ...(body !== undefined ? { body } : {}) });
    const c0 = now();
    const r = await Promise.resolve().then(() => ctx.get(path, method === 'POST' ? { method, body } : undefined)).catch(() => null);
    const ok = !!r && r.status >= 200 && r.status < 300 && isObj(r.json) && r.json.ok !== false;
    const refused = refusalOf(r);
    const line = { method, url, path, ...(body !== undefined ? { body } : {}), status: r?.status ?? null, ms: now() - c0, ok, ...(refused ? { error: refused } : {}) };
    calls.push(line);
    ctx.onCalled?.(line);
    return ok ? r.json : null;
  };
  const key = `${agent.chain}:${agent.id}`;
  const numeric = /^\d+$/.test(agent.id);
  const n = SESSION_STEPS.indexOf(step) + 1;
  const base = { step, n, of: SESSION_STEPS.length, title: STEP_TITLES[step] };
  const readinessPath = `/v1/agents/${agent.chain}/${enc(agent.id)}/readiness`;
  const finish = (mark, fact, facts, next, seller = null, extra = {}) => ({ ...base, mark, fact, calls, facts, next, seller, ms: now() - t0, ...extra });
  // _DIRECTORY_READ_v1_ (tick 23): the directory did not answer now and the layer served its last good copy of the record
  const lastGood = (x) => { const r = isObj(x.record_read) ? x.record_read : null; return r && r.state === 'last_good' ? ` · the last good copy of the record, ${str(r.age_s) ?? '—'} s old (the directory did not answer now: ${str(r.why) ?? '—'})` : ''; };
  const lost = (what) => {
    const last = calls[calls.length - 1];
    return `${what} could not be read (${last?.status ?? 'no answer'}); ${retry}`;
  };
  const stepFacts = (fields, summary, next) => ({ view: 'readiness', agent: `erc8004:${key}`, step, summary, ...fields, ...(next ? { next } : {}) });
  const enrich = numeric ? [{ label: 'enrich: sign with your owner wallet', kind: 'owner-signs', href: `/v1/agents/${agent.chain}/${agent.id}/enrich` }] : [];
  // _SELLER_PROBE_VIEW_v1_ (tick 22; the same in the site's wizard and the CLI): where this seller is a named worker of a class,
  // its newest zero-cost probe (when, what was asked, answered or not, latency) and its score under the class's seller-choice
  // rule, read from GET /v1/classes/sellers (one read per class, at most four). '' when there is nothing to say.
  const sellerHost = (u) => { try { return typeof u === 'string' ? new URL(u).host.toLowerCase() : null; } catch { return null; } };
  const probeView = async (ids, seller) => {
    if (!seller || !ids.length) return '';
    const said = [];
    for (const id of ids.slice(0, 4)) {
      const j = await call('GET', `/v1/classes/sellers?class=${enc(id)}`);
      const row = j && Array.isArray(j.sellers) ? j.sellers.filter(isObj).find((x) => x.seller === seller) : null;
      if (!row) continue;
      const p = isObj(row.last_probe) ? row.last_probe : null;
      said.push(`${id}: ${p ? `last probe ${(str(p.at) ?? '—').slice(0, 16).replace('T', ' ')} UTC · ${str(p.method) ?? '—'} · ${p.answered === true ? 'answered' : 'no answer'}${str(p.latency_ms) ? ` in ${str(p.latency_ms)} ms` : ''}` : 'no probe on record'} · score ${str(row.score) ?? '—'} under ${str(row.rule) ?? '—'}`);
    }
    return said.join('; ');
  };

  // _X402_HIRE_v1_ (the same branch in the site's wizard and the CLI): an x402 resource (a URL) has no ERC-8004 record and no
  // endpoint to probe for free with a job: each step reads its Bazaar listing (GET /v1/x402/bazaar, one page) and the classes
  // that name it as their worker. It is paid per call in USDC on Base; the facilitator settles at the call, so there is no cover.
  if (/^https:\/\//.test(agent.id) && step !== 'jev') {
    const path = '/v1/x402/bazaar?limit=100';
    const read = [{ label: 'the x402 Bazaar (one page)', kind: 'read', href: path }];
    const facts = (fields, summary) => ({ view: 'readiness', agent: `x402:${agent.id}`, step, summary, ...fields });
    if (step === 'classes') {
      const cat = await call('GET', '/v1/classes');
      if (!cat) return finish('fail', lost('the class catalogue'), { view: 'readiness', agent: `x402:${agent.id}`, summary: null, next: null, unread: 'the class catalogue could not be read now' }, read);
      const named = (Array.isArray(cat.classes) ? cat.classes : []).filter(isObj).filter((c) => (Array.isArray(c.workers) ? c.workers : []).some((w) => isObj(w) && w.kind === 'x402' && w.endpoint === agent.id)).map((c) => str(c.id)).filter((x) => !!x);
      const pv = await probeView(named, sellerHost(agent.id));
      return finish(named.length ? 'ok' : 'warn', named.length ? `${named.join(', ')} · this resource is the named worker${pv ? ` · ${pv}` : ''}` : 'no job class names this resource as its worker',
        facts({ agent_classes: named.join(', ') || null, seller_probe: pv || null }, named.length ? 'The class catalogue names this resource as a worker; code checks the paid answer (and the payment on Base) before Jev is asked.' : 'No class; a paid answer would be graded as wire.reply.'),
        [...read, { label: 'the class catalogue', kind: 'read', href: '/v1/classes' }]);
    }
    const b = await call('GET', path);
    if (!b) return finish('fail', lost('the Bazaar listing'), { view: 'readiness', agent: `x402:${agent.id}`, summary: null, next: null, unread: 'the x402 Bazaar could not be read now' }, read);
    const row = (Array.isArray(b.rows) ? b.rows : []).filter(isObj).find((r) => r.resource === agent.id) ?? null;
    if (!row) return finish('warn', `not on the Bazaar\u2019s first page (${str(b.total) ?? '—'} resources listed)`, facts({ listed: false }, 'The resource is not on the first page of the CDP Bazaar listing.'), read);
    const q = isObj(row.quality) ? row.quality : {}; const rd = isObj(row.readiness) ? row.readiness : {};
    const prices = (Array.isArray(row.prices) ? row.prices : []).filter(isObj);
    const exact = prices.find((p) => p.network === 'eip155:8453' && p.scheme === 'exact') ?? null;
    if (step === 'readiness') {
      return finish(rd.payable_on_layer_chain === true ? 'ok' : 'warn', `x402 resource · ${str(rd.status) ?? '—'} · ${str(q.paid_calls_30d) ?? '—'} paid calls from ${str(q.payers_30d) ?? '—'} payers in 30 d · last paid ${str(q.last_paid_at) ?? '—'}`,
        facts({ listing: { status: str(rd.status), paid_calls_30d: q.paid_calls_30d ?? null, payers_30d: q.payers_30d ?? null } }, 'The CDP x402 Bazaar lists the resource with its prices and how often it was paid.'), read);
    }
    if (step === 'probe') {
      const kinds = prices.map((p) => `${str(p.scheme) ?? '—'} on ${str(p.chain) ?? str(p.network) ?? '—'}`);
      return finish(exact ? 'ok' : 'warn', exact ? `x402 v${str(row.x402_version) ?? '—'} · ${str(exact.usdc) ?? '—'} USDC on Base (exact) to ${str(exact.pay_to) ?? '—'} · accepts ${kinds.join(', ')} (not probed: a hire is a paid call; the broker reads its 402 challenge then)` : `no exact USDC price on Base (${kinds.join(', ') || 'none'})`,
        facts({ probe: { status: exact ? 'payable' : 'not on our rail', protocol: 'x402', price_usdc: exact ? exact.usdc ?? null : null } }, 'What the listing says the resource charges, and on which rail.'), read);
    }
    return finish('warn', `no cover quote: an x402 resource is paid per call${exact ? ` (${str(exact.usdc) ?? '—'} USDC)` : ''} and its facilitator settles at the call; there is no job to cover`,
      facts({ quote: null }, 'The assurance layer covers jobs; a paid x402 call settles at once.'), read);
  }

  // _MCP_REGISTRY_v1_ (the same branch in the site's wizard and the CLI): a server in the official MCP registry, named by its
  // registry name, has no ERC-8004 record of its own; each step reads GET /v1/mcp/registry/server?name= (its own latest record,
  // the open remote it published, a live MCP initialize + tools/list, the classes it works, ERC-8004 cross-links)
  if (REGISTRY_RE.test(agent.id) && step !== 'jev') {
    const path = `/v1/mcp/registry/server?name=${encodeURIComponent(agent.id)}`;
    const read = [{ label: 'its official MCP registry record', kind: 'read', href: path }];
    const facts = (fields, summary) => ({ view: 'readiness', agent: `mcp-registry:${agent.id}`, step, summary, ...fields });
    const s = await call('GET', path);
    if (!s) return finish('fail', lost('the MCP registry record'), { view: 'readiness', agent: `mcp-registry:${agent.id}`, summary: null, next: null, unread: 'the MCP registry record could not be read now' }, read);
    const links = (Array.isArray(s.erc8004) ? s.erc8004 : []).filter(isObj);
    const p = isObj(s.probe) ? s.probe : null;
    if (step === 'readiness') {
      return finish(s.free === true ? 'ok' : 'warn', `MCP registry server · ${str(s.status) ?? '—'} · version ${str(s.version) ?? '—'} · ${str(s.access) ?? '—'} · ${links.length ? `ERC-8004 ${links.map((l) => `${str(l.chain_id) ?? '—'}:${str(l.agent_id) ?? '—'} (${str(l.match) ?? '—'})`).join(', ')}` : 'no ERC-8004 agent publishes this endpoint'}${lastGood(s)}`,
        facts({ registry: { status: str(s.status), version: str(s.version), open_remote: str(s.open_remote), erc8004: links.length } }, 'The server’s own record in the official MCP registry: the endpoint it published, and whether it is free to call.'), read);
    }
    if (step === 'probe') {
      return finish(p && p.free === true ? 'ok' : 'warn', p ? `MCP initialize + tools/list at ${str(s.open_remote) ?? '—'} · ${str(p.status) ?? '—'} in ${str(p.latency_ms) ?? '—'} ms · ${str(p.tool_count) ?? '0'} tools${p.priced === true ? ' · a payment wall answered' : ''}` : `not probed: ${str(s.access) ?? 'no open remote'}`,
        facts({ probe: { status: p ? str(p.status) : 'not probed', protocol: 'mcp', tools: p ? str(p.tool_count) : null } }, 'A live MCP handshake on the endpoint the server published in the registry.'), read);
    }
    if (step === 'classes') {
      const cls = (Array.isArray(s.classes) ? s.classes : []).filter(isObj);
      const pv = await probeView(cls.map((c) => str(c.id)).filter((x) => !!x), sellerHost(s.open_remote));
      return finish(cls.length ? 'ok' : 'warn', cls.length ? `${cls.map((c) => `${str(c.id) ?? '—'} (tool ${str(c.tool) ?? '—'})`).join(', ')} · this server is the named worker${pv ? ` · ${pv}` : ''}` : 'no job class names this server as its worker',
        facts({ agent_classes: cls.map((c) => str(c.id)).filter((x) => !!x).join(', ') || null, seller_probe: pv || null }, cls.length ? 'The class catalogue names this server as a worker; code checks its answer before Jev is asked.' : 'No class; an answer would be graded as wire.reply.'), read);
    }
    return finish('warn', 'no cover quote: a registry server holds no EVM key and asks no price; a covered job names a seller of record that signs on the hook',
      facts({ quote: null }, 'The assurance layer covers priced jobs with a seller that signs; this server is called free.'), read);
  }

  // _A2A_REGISTRY_v1_ (the same branch in the site's wizard and the CLI): an agent in the A2A Registry, named a2a:<registry id>,
  // has its own registry record and no ERC-8004 record; each step reads GET /v1/a2a/registry/agent?id= (the card as registered:
  // its URL, dialect and skills; whether it is open; the registry's own checks; a live GET of its card; the classes it works)
  if (/^a2a:[0-9a-f-]{36}$/.test(agent.id) && step !== 'jev') {
    const id = agent.id.slice('a2a:'.length);
    const path = `/v1/a2a/registry/agent?id=${id}`;
    const read = [{ label: 'its A2A Registry record', kind: 'read', href: path }];
    const facts = (fields, summary) => ({ view: 'readiness', agent: agent.id, step, summary, ...fields });
    const a = await call('GET', path);
    if (!a) return finish('fail', lost('the A2A Registry record'), { view: 'readiness', agent: agent.id, summary: null, next: null, unread: 'the A2A Registry record could not be read now' }, read);
    const links = (Array.isArray(a.erc8004) ? a.erc8004 : []).filter(isObj);
    const h = isObj(a.registry_health) ? a.registry_health : {};
    const p = isObj(a.probe) ? a.probe : null;
    if (step === 'readiness') {
      return finish(a.open === true ? 'ok' : 'warn', `A2A Registry agent · ${str(a.name) ?? '—'} · A2A ${str(a.protocol_version) ?? '—'} (${a.dialect === '1.0' ? 'SendMessage' : 'message/send'}) at ${str(a.url) ?? '—'} · ${str(a.access) ?? '—'} · registry ${h.healthy === true ? 'healthy' : 'not healthy'}, conformance ${str(h.task_conformance) ?? '—'} · ${links.length ? `ERC-8004 ${links.map((l) => `${str(l.chain_id) ?? '—'}:${str(l.agent_id) ?? '—'} (${str(l.match) ?? '—'})`).join(', ')}` : 'no ERC-8004 agent publishes this endpoint'}${lastGood(a)}`,
        facts({ a2a_registry: { url: str(a.url), dialect: str(a.dialect), open: a.open === true, erc8004: links.length } }, 'The agent\u2019s own record in the A2A Registry: the URL its card publishes, its A2A dialect, and whether it is free to call.'), read);
    }
    if (step === 'probe') {
      const skills = p && Array.isArray(p.skills) ? p.skills.map(str).filter((x) => !!x) : [];
      return finish(p && p.reachable === true ? 'ok' : 'warn', p ? (p.reachable === true ? `its card at ${str(a.card) ?? '—'} answered in ${str(p.latency_ms) ?? '—'} ms · ${p.url_matches === true ? 'names the same URL as the registry' : 'names another URL than the registry'} · ${skills.length} skills` : `its card did not answer: ${str(p.reason) ?? '—'}`) : `not probed: ${str(a.access) ?? 'not open'}`,
        facts({ probe: { status: p && p.reachable === true ? 'ready' : 'not reachable', protocol: 'a2a', tools: String(skills.length) } }, 'A GET of the agent\u2019s own card at its well-known URI; no message is sent.'), read);
    }
    if (step === 'classes') {
      const cls = (Array.isArray(a.classes) ? a.classes : []).filter(isObj);
      const pv = await probeView(cls.map((c) => str(c.id)).filter((x) => !!x), sellerHost(a.url));
      return finish(cls.length ? 'ok' : 'warn', cls.length ? `${cls.map((c) => str(c.id) ?? '—').join(', ')} · this agent is the named worker${pv ? ` · ${pv}` : ''}` : 'no job class names this agent as its worker',
        facts({ agent_classes: cls.map((c) => str(c.id)).filter((x) => !!x).join(', ') || null, seller_probe: pv || null }, cls.length ? 'The class catalogue names this agent as a worker; code checks its answer before Jev is asked.' : 'No class; an answer would be graded as wire.reply.'), read);
    }
    return finish('warn', 'no cover quote: an A2A Registry agent holds no EVM key and asks no price; a covered job names a seller of record that signs on the hook',
      facts({ quote: null }, 'The assurance layer covers priced jobs with a seller that signs; this agent is called free.'), read);
  }

  // _AGENTKIT_LANE_v1_ (the same branch in the site's wizard and the CLI): a Coinbase AgentKit worker, named agentkit:0x…, is a
  // card registered with the layer (no ERC-8004 record); each step reads GET /v1/agentkit?probe=1 (the release, its action
  // providers, the actions the worker serves, a live MCP initialize + tools/list, the classes they work)
  if (/^agentkit:0x[0-9a-f]{40}$/.test(agent.id) && step !== 'jev') {
    const addr = agent.id.slice('agentkit:'.length);
    const path = '/v1/agentkit?probe=1';
    const read = [{ label: 'the AgentKit workers registered with the layer', kind: 'read', href: path }];
    const facts = (fields, summary) => ({ view: 'readiness', agent: agent.id, step, summary, ...fields });
    const j = await call('GET', path);
    if (!j) return finish('fail', lost('the AgentKit workers'), { view: 'readiness', agent: agent.id, summary: null, next: null, unread: 'the AgentKit workers could not be read now' }, read);
    const w = (Array.isArray(j.workers) ? j.workers : []).filter(isObj).find((x) => String(x.address).toLowerCase() === addr);
    if (!w) return finish('warn', `no AgentKit worker ${addr} is registered with the layer`, facts({ agentkit: null }, 'Register an AgentKit card (kind mcp, agentkit { version, served[] }) with POST /v1/agents/register.'), read);
    const k = isObj(w.agentkit) ? w.agentkit : {};
    const p = isObj(w.probe) ? w.probe : null;
    const tools = p && Array.isArray(p.tools) ? p.tools.map(str).filter((x) => !!x) : [];
    if (step === 'readiness') {
      return finish('ok', `AgentKit worker · AgentKit ${str(k.version) ?? '—'} · ${Array.isArray(k.action_providers_in_release) ? k.action_providers_in_release.length : 0} action providers in the release · MCP ${str(w.endpoint) ?? '—'} · chain ${str(w.chain_id) ?? '—'} · a registered card, no ERC-8004 record`,
        facts({ agentkit: { version: str(k.version), endpoint: str(w.endpoint), chain_id: str(w.chain_id), card_url: str(w.card_url) } }, 'The card the worker registered with the layer: the AgentKit release it runs and where it is spoken to.'), read);
    }
    if (step === 'probe') {
      return finish(p && p.reachable === true ? 'ok' : 'warn', p ? `MCP initialize + tools/list at ${str(w.endpoint) ?? '—'} · ${p.reachable === true ? 'answered' : 'no answer'} in ${str(p.latency_ms) ?? '—'} ms · serves ${tools.join(', ') || 'nothing'}` : 'not probed',
        facts({ probe: { status: p && p.reachable === true ? 'ready' : 'not reachable', protocol: 'mcp', tools: String(tools.length) } }, 'A live MCP handshake on the endpoint in the worker\u2019s registered card.'), read);
    }
    if (step === 'classes') {
      const cls = (Array.isArray(w.classes) ? w.classes : []).map(str).filter((x) => !!x);
      const pv = await probeView(cls, sellerHost(w.endpoint));
      return finish(cls.length ? 'ok' : 'warn', cls.length ? `${cls.join(', ')} · this worker is the named worker${pv ? ` · ${pv}` : ''}` : 'no job class names this worker',
        facts({ agent_classes: cls.join(', ') || null, seller_probe: pv || null }, cls.length ? 'The class catalogue names this worker; code reads the transfer it makes on chain before Jev is asked.' : 'No class; an answer would be graded as wire.reply.'), read);
    }
    return finish('warn', `no cover quote on Base: this worker runs on the devnet ${str(w.chain_id) ?? '—'}, where lane k covers its jobs on the layer\u2019s devnet hook with its own wallet as the seller of record`,
      facts({ quote: null }, 'The assurance layer quotes Base jobs; this worker\u2019s jobs are on the devnet.'), read);
  }

  // _AGENTVERSE_LANE_v1_ (the same branch as the site's wizard): a Fetch.ai agent (agent1…) has no ERC-8004 record;
  // each step reads its own Almanac record and protocol manifests (GET /v1/agentverse/agents/:address)
  if (/^agent1/.test(agent.id) && step !== 'jev') {
    const path = `/v1/agentverse/agents/${agent.id}`;
    const read = [{ label: 'the agent read (Almanac + manifests)', kind: 'read', href: path }];
    const a = await call('GET', path);
    if (!a) return finish('fail', lost('the Almanac record'), { view: 'readiness', agent: `agentverse:${agent.id}`, summary: null, next: null, unread: 'the agent\u2019s Almanac record could not be read now' }, read);
    const al = isObj(a.almanac) ? a.almanac : {};
    const hire = Array.isArray(a.hire) ? a.hire.filter(isObj) : [];
    const classes = Array.isArray(a.classes) ? a.classes.filter(isObj).map((c) => str(c.id)).filter((x) => !!x) : [];
    const facts = (fields, summary) => ({ view: 'readiness', agent: `agentverse:${agent.id}`, step, summary, ...fields });
    if (step === 'readiness') {
      const active = str(al.status) === 'active';
      return finish(active ? 'ok' : 'warn', `Fetch.ai agent · Almanac ${str(al.status) ?? '—'} · ${str(al.type) ?? '—'} · expires ${str(al.expiry) ?? '—'}`,
        facts({ almanac: { status: str(al.status), type: str(al.type), expiry: str(al.expiry) } }, active ? 'The agent registered itself in the Fetch.ai Almanac and the record is active.' : 'The agent\u2019s Almanac record is not active.'), read);
    }
    // _AGENTVERSE_CHAT_v1_: a chat-only agent is hired through Taifoon's receiving agent, which holds its ChatMessage reply
    const chat = isObj(a.chat) ? a.chat : null;
    const own = chat ? hire.filter((h) => str(h.protocol) !== str(chat.protocol) && str(h.protocol_name) !== 'Default') : hire; // Default: uAgents' own error protocol, not a hire
    if (step === 'probe' && chat && !own.length) {
      return finish('ok', `chat protocol ${str(chat.name) ?? 'AgentChatProtocol'} ${str(chat.version) ?? ''}: hired through Taifoon\u2019s receiving agent, which the ChatMessage reply is sent to (${str(chat.receiver) ?? '—'}; not probed)`,
        facts({ probe: { status: 'chat (receiving agent)', protocol: 'uagents', interactions: hire.length } }, 'A chat agent acknowledges the envelope and sends its reply to the sender\u2019s registered endpoint; Taifoon\u2019s receiving agent is that sender and holds the reply.'), read);
    }
    if (step === 'probe') {
      const names = hire.map((h) => `${str(h.protocol_name) ?? '—'} ${str(h.version) ?? ''}`.trim());
      return finish(hire.length ? 'ok' : 'warn', hire.length ? `${hire.length} request/response interaction(s): ${names.join(', ')} (not probed: the hire is a signed uAgents envelope, answered in the same call)` : 'no request/response interaction in its protocols (a chat-only agent answers a sync envelope with its acknowledgement)',
        facts({ probe: { status: hire.length ? 'hireable' : 'chat only', protocol: 'uagents', interactions: hire.length } }, 'What the agent\u2019s own protocol manifests say it answers.'), read);
    }
    if (step === 'classes') {
      const pv = await probeView(classes, agent.id.toLowerCase());
      return finish(classes.length ? 'ok' : 'warn', classes.length ? `${classes.join(', ')} · this agent is the named worker${pv ? ` · ${pv}` : ''}` : 'no job class names this agent as its worker',
        facts({ agent_classes: classes.join(', ') || null, seller_probe: pv || null }, classes.length ? 'The class catalogue names this agent as a worker; code checks its reply before Jev is asked.' : 'No class; its replies would be graded as wire.reply.'),
        [...read, { label: 'the class catalogue', kind: 'read', href: '/v1/classes' }]);
    }
    return finish('warn', 'no cover quote: a Fetch.ai agent holds no EVM address; the devnet lane u settles with a seller of record standing in for it',
      facts({ quote: null }, 'The assurance layer quotes EVM sellers.'), read);
  }

  if (step === 'readiness') {
    const body = await call('GET', readinessPath);
    const r = body && isObj(body.readiness) ? body.readiness : null;
    if (!r) return finish('fail', lost('the checklist'), { view: 'readiness', agent: `erc8004:${key}`, summary: null, next: null, unread: 'the readiness could not be read now' }, []);
    const facts = readinessFacts(r, null);
    const c = isObj(r.counts) ? r.counts : {};
    const fact = `${str(r.verdict)?.replace(/_/g, ' ') ?? 'unknown'} · ${str(c.ok) ?? '0'} ok · ${str(c.missing) ?? '0'} missing · ${str(c.pending) ?? '0'} pending · ${str(c.blocked) ?? '0'} blocked`;
    const nx = isObj(r.next) ? r.next : null;
    const how = nx && isObj(nx.how) ? nx.how : null;
    const next = [];
    if (how?.kind === 'api' && (how.method === 'GET' || how.method === 'POST') && typeof how.path === 'string')
      next.push({ label: `${str(nx.step)}: ${how.method} ${how.path}`, kind: 'curl', cmd: curlFor(ctx.host, how.method, how.path, how.body) });
    else if (how?.kind === 'chain' && typeof how.call === 'string')
      next.push({ label: `${str(nx.step)}: ${str(nx.who) ?? 'the owner'} signs ${how.call.split('(')[0]} on ${String(how.to ?? '')}`, kind: 'owner-signs', href: `/v1/agents/${agent.chain}/${enc(agent.id)}/readiness` });
    if (nx?.who === 'owner') next.push(...enrich);
    return finish(r.hireable === true || r.assured === true ? 'ok' : 'warn', fact, facts, next, str(r.address));
  }

  // _N8N_LANE_v1_: an agent the harvester has no record of (a devnet identity the owner enriched, an n8n webhook) is still
  // described by its readiness: the owner-signed endpoint, the classes it works. Read that instead of failing the step.
  const readinessSteps = async () => {
    const b = await call('GET', readinessPath);
    const r = b && isObj(b.readiness) ? b.readiness : null;
    if (!r) return null;
    const steps = Object.fromEntries((Array.isArray(r.steps) ? r.steps : []).filter(isObj).map((x) => [String(x.id), x]));
    return { target: isObj(r.broker_target) ? r.broker_target : null, owner: str(r.address), steps };
  };

  // _OLAS_LANE_v1_: a seller address that is an Olas Mech on Base is described by the marketplace read (GET /v1/olas/mechs):
  // its card's tools, which of them answered lately, how it is paid. The harvester does not probe it; its deliveries are public.
  const olasMech = async () => {
    if (numeric || agent.chain !== 8453 || !/^0x[0-9a-fA-F]{40}$/.test(agent.id)) return null;
    const b = await call('GET', '/v1/olas/mechs');
    const rows = b && Array.isArray(b.mechs) ? b.mechs.filter(isObj) : [];
    return rows.find((m) => str(m.mech) === agent.id.toLowerCase()) ?? null;
  };
  // _VIRTUALS_LANE_v1_: a seller address that is a Virtuals memo-ACP seller on Base is described by GET /v1/virtuals/sellers:
  // its offerings and prices, whether it answers a request, how its jobs ended. It is hired through the router, not probed.
  const memoSeller = async () => {
    if (numeric || agent.chain !== 8453 || !/^0x[0-9a-fA-F]{40}$/.test(agent.id)) return null;
    const b = await call('GET', `/v1/virtuals/sellers?addr=${agent.id.toLowerCase()}`);
    const rows = b && Array.isArray(b.sellers) ? b.sellers.filter(isObj) : [];
    return rows.find((m) => str(m.seller) === agent.id.toLowerCase()) ?? null;
  };
  const memoLine = (m) => {
    const offers = Array.isArray(m.offerings) ? m.offerings.filter(isObj).map((o) => `${str(o.name) ?? '—'} ${Array.isArray(o.prices) && o.prices.length ? Math.min(...o.prices.map(Number)) : '—'} USDC`) : [];
    const answered = Number(m.answered ?? 0), jobs = Number(m.jobs ?? 0), completed = Number(m.completed ?? 0);
    const transfers = Array.isArray(m.offerings) && m.offerings.filter(isObj).some((o) => o.name === 'transfer_token');
    return { answered, transfers, fact: `Virtuals memo-ACP seller on Base · offerings ${offers.join(', ') || '—'} · answered ${answered}/${jobs} requests · ${completed} completed` };
  };
  const olasLine = (m) => {
    const card = isObj(m.card) && Array.isArray(m.card.tools) ? m.card.tools.map(String) : [];
    const answering = Array.isArray(m.hireable_tools) ? m.hireable_tools.map(String) : [];
    return { card, answering, fact: `Olas Mech on Base · service ${str(m.service_id) ?? '—'} · ${str(m.payment) ?? '—'} ${str(m.max_delivery_rate) ?? '—'} wei per request · card ${card.join(', ') || '—'} · answering lately ${answering.join(', ') || 'none'}` };
  };

  if (step === 'probe') {
    const vm = await memoSeller();
    if (vm) {
      const v = memoLine(vm);
      return finish(v.answered ? 'ok' : 'warn', `${v.fact} (not probed: a buyer opens a job on the memo-ACP router naming this seller and an evaluator)`,
        stepFacts({ probe: { status: 'memo-ACP seller (not probed)', protocol: 'virtuals-memo-acp', answered: v.answered } },
          v.answered ? 'The seller answered requests on chain (its own memo on the job).' : 'The seller has not answered a request in the observatory\u2019s window.', null),
        [{ label: 'the seller read', kind: 'read', href: `/v1/virtuals/sellers?addr=${agent.id.toLowerCase()}` }]);
    }
    const om = await olasMech();
    if (om) {
      const o = olasLine(om);
      return finish(o.answering.length ? 'ok' : 'warn', `${o.fact} (not probed: the marketplace hires it by a request transaction; its deliveries are public)`,
        stepFacts({ probe: { status: 'olas mech (not probed)', protocol: 'olas-marketplace', card_tools: o.card.join(', '), answering: o.answering.join(', ') || null } },
          o.answering.length ? `The mech answered lately with ${o.answering.join(', ')}.` : 'No tool on its card answered one of its latest requests: every delivery read was the tool\u2019s error text.', null),
        [{ label: 'the marketplace read', kind: 'read', href: '/v1/olas/mechs' }]);
    }
    if (!numeric) return finish('warn', 'the probe record is keyed by an ERC-8004 agent id; a seller address has none', stepFacts({}, 'No probe record: this is a seller address, not an agent id.', null), enrich);
    const rec = await call('GET', `/v1/registry/agents/${agent.chain}/${agent.id}`);
    if (!rec) {
      const rd = await readinessSteps();
      const t = rd?.target ?? null;
      if (rd && t && str(t.protocol) === 'webhook') {
        const host = hostOf(t.url);
        const hs = { candidate: { address: rd.owner ?? '0x…', kind: 'n8n' }, task: 'describe the job here', dispatch: true };
        const fact = `n8n webhook${host ? ` at ${host}` : ''} · not probed: the first offer is its probe · endpoint ${str(t.from) === 'owner' ? 'signed by the owner' : 'from the card'}`;
        return finish('ok', fact, stepFacts({ probe: { status: 'webhook (not probed)', protocol: 'webhook', endpoint: host } }, 'An n8n webhook is not probed: the first offer is its probe.',
          { step: 'first job', who: 'buyer', why: 'The broker sends the offer to the webhook the owner published.', how: 'POST /v1/handshake' }),
          [{ label: 'first job: POST /v1/handshake (the offer goes to the webhook; you run it)', kind: 'curl', cmd: curlFor(ctx.host, 'POST', '/v1/handshake', hs) }], rd.owner);
      }
      // _PHALA_LANE_v1_: an MCP / A2A endpoint the owner signed into the checklist (a devnet identity the harvester does not
      // walk, e.g. the enclave seller 36927:17) was probed by the enrichment itself: that probe is the record
      const pr = rd?.steps.probe;
      const pe = pr && isObj(pr.evidence) ? pr.evidence : null;
      if (rd && t && ['mcp', 'a2a'].includes(String(t.protocol)) && pr && str(pr.status) === 'ok' && pe && str(pe.status) === 'ready') {
        const host = hostOf(t.url);
        const hs = { candidate: { address: rd.owner ?? '0x…', kind: String(t.protocol), endpoint: str(t.url) }, task: 'describe the job here', dispatch: true };
        const fact = `ready over ${String(t.protocol)} · probed ${utc(pe.probed_at) ?? '—'} by the owner's signed enrichment · endpoint ${host} · not in the harvester (it does not walk chain ${agent.chain})`;
        return finish('ok', fact, stepFacts({ probe: { status: 'ready', protocol: String(t.protocol), probed_at: utc(pe.probed_at), endpoint: host, from: str(pe.from) } }, `The endpoint answered the enrichment probe in ${String(t.protocol)}.`,
          { step: 'first job', who: 'buyer', why: 'The broker can send it an offer at the endpoint the owner signed.', how: 'POST /v1/handshake' }),
          [{ label: 'first job: POST /v1/handshake (opens an offer; you run it)', kind: 'curl', cmd: curlFor(ctx.host, 'POST', '/v1/handshake', hs) }], rd.owner);
      }
      return finish('fail', lost('the harvester record'), stepFacts({}, 'The harvester record could not be read now.', null), []);
    }
    const wire = isObj(rec.wire) ? rec.wire : {};
    const trust = isObj(rec.trust) ? rec.trust : {};
    const status = str(wire.status) ?? 'not probed';
    const protocol = str(wire.protocol);
    const endpoint = hostOf(rec.endpoint);
    const fact = [`${status}${protocol ? ` over ${protocol}` : ''}`, utc(wire.probedAt) ? `probed ${utc(wire.probedAt)}` : null, endpoint ? `endpoint ${endpoint}` : null, str(trust.score) ? `trust ${str(trust.score)}` : null].filter(Boolean).join(' · ');
    const ready = status === 'ready';
    const owner = str(rec.owner);
    const kind = protocol && ['n8n', 'mcp', 'a2a'].includes(protocol) ? protocol : 'onchain';
    const hs = { candidate: { address: owner ?? '0x…', kind, agentId: Number(agent.id), chainId: agent.chain }, task: 'describe the job here' };
    const next = ready
      ? [{ label: 'first job: POST /v1/handshake (opens an offer; you run it)', kind: 'curl', cmd: curlFor(ctx.host, 'POST', '/v1/handshake', hs) }]
      : [{ label: 'the harvester probes again on its own; publish a reachable endpoint in the card', kind: 'read', href: `/v1/registry/agents/${agent.chain}/${agent.id}` }, ...enrich];
    const facts = stepFacts({ probe: { status, protocol, probed_at: utc(wire.probedAt), endpoint, trust_score: str(trust.score) } },
      ready ? `The endpoint answered the probe in ${protocol ?? 'its protocol'}.` : `The endpoint has not answered the probe (${status}).`,
      ready ? { step: 'first job', who: 'buyer', why: 'The broker can send it an offer.', how: 'POST /v1/handshake' } : { step: 'probe', who: 'owner', why: 'The endpoint must answer the probe.', how: 'automatic: the harvester probes again' });
    return finish(ready ? 'ok' : 'warn', fact, facts, next, owner);
  }

  if (step === 'classes') {
    const cat = await call('GET', '/v1/classes');
    const rec = numeric ? await call('GET', `/v1/registry/agents/${agent.chain}/${agent.id}`) : null;
    if (!cat) return finish('fail', lost('the class catalogue'), stepFacts({}, 'The class catalogue could not be read now.', null), []);
    const all = (Array.isArray(cat.classes) ? cat.classes : []).filter(isObj);
    let mine = rec && Array.isArray(rec.jobClasses) ? rec.jobClasses.filter((x) => typeof x === 'string') : [];
    // no harvester record: the classes the readiness checklist grants (the owner's signed opt-in, a named worker of the class)
    if (!mine.length && numeric && !rec) {
      const ev = (await readinessSteps())?.steps.class?.evidence;
      mine = isObj(ev) && Array.isArray(ev.classes) ? ev.classes.filter(isObj).map((c) => str(c.id)).filter((x) => !!x) : [];
    }
    // a class that names this agent's own endpoint as its worker is one it works (_BITAGENT_LANE_v1_: BitAgent's Tweet Writer
    // 59048 → text.tweet; the harvester only knows its wire, so its record says wire.reply)
    const own = rec && typeof rec.endpoint === 'string' ? rec.endpoint.replace(/\/+$/, '').toLowerCase() : null;
    if (own) for (const c of all) if (Array.isArray(c.workers) && c.workers.some((w) => isObj(w) && typeof w.endpoint === 'string' && w.endpoint.replace(/\/+$/, '').toLowerCase() === own) && typeof c.id === 'string' && !mine.includes(c.id)) mine = [c.id, ...mine];
    // an Olas Mech: the class its marketplace work is graded under (mech.compute), whatever its status in the catalogue
    // a Virtuals memo-ACP seller whose offering has a DET: memoacp.transfer_token
    const vm = !mine.length ? await memoSeller() : null;
    if (vm && memoLine(vm).transfers) {
      const c = all.find((x) => x.id === 'memoacp.transfer_token');
      if (c) return finish('ok', `memoacp.transfer_token (${str(c.status) ?? '—'}) · ${memoLine(vm).fact}`,
        stepFacts({ classes: all.map((x) => str(x.id)).filter(Boolean).join(', '), agent_classes: 'memoacp.transfer_token', det: str(c.det) }, 'Class memoacp.transfer_token: code checks the requested transfer in the job\u2019s own transactions before Jev is asked.', null),
        [{ label: 'the class catalogue', kind: 'read', href: '/v1/classes' }, { label: 'the seller read', kind: 'read', href: `/v1/virtuals/sellers?addr=${agent.id.toLowerCase()}` }]);
    }
    const om = !mine.length ? await olasMech() : null;
    if (om) mine = ['mech.compute'];
    const known = mine.filter((id) => all.some((c) => c.id === id));
    if (om && known.length) {
      const c = all.find((x) => x.id === 'mech.compute'); const o = olasLine(om);
      return finish(o.answering.length ? 'ok' : 'warn', `mech.compute (${str(c.status) ?? '—'}) · ${o.fact}`,
        stepFacts({ classes: all.map((x) => str(x.id)).filter(Boolean).join(', '), agent_classes: 'mech.compute', det: str(c.det) }, 'Class mech.compute: code recomputes the arithmetic and a tool error is not an answer, before Jev is asked.', null),
        [{ label: 'the class catalogue', kind: 'read', href: '/v1/classes' }, { label: 'the marketplace read', kind: 'read', href: '/v1/olas/mechs' }]);
    }
    const det = known.map((id) => str(all.find((c) => c.id === id)?.det)).filter(Boolean);
    // _SELLER_PROBE_VIEW_v1_: a class that names this agent's own endpoint as its worker has probed it as a seller
    const ownHost = sellerHost(own);
    const pv = await probeView(known.filter((id) => { const c = all.find((x) => x.id === id); return !!ownHost && !!c && Array.isArray(c.workers) && c.workers.some((w) => isObj(w) && sellerHost(w.endpoint) === ownHost); }), ownHost);
    const fact = known.length ? `${known.join(', ')} · ${all.length} classes in the catalogue${pv ? ` · ${pv}` : ''}` : `no class matched · ${all.length} classes in the catalogue: ${all.map((c) => str(c.id)).filter(Boolean).join(', ')}`;
    const facts = stepFacts({ classes: all.map((c) => str(c.id)).filter(Boolean).join(', '), agent_classes: known.join(', ') || null, det: det[0] ?? null, seller_probe: pv || null },
      known.length ? `Class ${known.join(', ')}: its deterministic check judges the reply before Jev is asked.` : 'No job class matches this agent yet.',
      known.length ? null : { step: 'class', who: 'owner', why: 'Declare a skill that maps to a job class in the card.', how: 'GET /v1/classes' });
    return finish(known.length ? 'ok' : 'warn', fact, facts, [{ label: 'the class catalogue', kind: 'read', href: '/v1/classes' }, ...(known.length ? [] : enrich)]);
  }

  if (step === 'quote') {
    const body = await call('GET', readinessPath);
    const r = body && isObj(body.readiness) ? body.readiness : null;
    const seller = r ? str(r.address) : /^0x/.test(agent.id) ? agent.id : null;
    if (!seller) return finish('fail', lost('the seller address'), stepFacts({}, 'The seller address could not be read now.', null), []);
    const qBody = { seller, chainId: agent.chain, price_usdc: 1 };
    const quote = await call('POST', '/v1/pools/quote', qBody);
    if (!quote) {
      const refused = calls[calls.length - 1]?.error;
      if (refused) {
        // the layer answered: no assurance layer quotes on this chain. Retrying will not change that, so say it.
        const fact = `no quote on chain ${agent.chain}: ${refused} (the assurance layer quotes on Base 8453, Arc 5042 and the devnet 36927)`;
        const facts = r ? readinessFacts(r, null) : stepFacts({}, fact, null);
        facts.step = step; facts.quote_refused = refused;
        return finish('warn', fact, facts, [], seller);
      }
      return finish('fail', lost('the quote'), r ? readinessFacts(r, null) : stepFacts({}, 'The quote could not be read now.', null), [], seller);
    }
    const guaranteed = quote.guaranteed === true;
    const fact = [guaranteed ? 'guaranteed' : 'not guaranteed', str(quote.premium_label) ? `premium ${str(quote.premium_label)}` : null, str(quote.deposit_rung) ? `deposit ${str(quote.deposit_rung)}` : null, 'at 1 USDC'].filter(Boolean).join(' · ');
    const facts = r ? readinessFacts(r, quote) : stepFacts({}, fact, null);
    facts.step = step;
    // the terminal addition: the layer's own record behind the premium (its 95% Wilson interval), copied, never computed
    const record = isObj(quote.record) ? quote.record : null;
    return finish(guaranteed ? 'ok' : 'warn', fact, facts, [{ label: 'the same quote at your price: POST /v1/pools/quote', kind: 'curl', cmd: curlFor(ctx.host, 'POST', '/v1/pools/quote', qBody) }], seller, record ? { record } : {});
  }

  // jev
  const [dec, ans] = [await call('GET', '/v1/judge/decisions?limit=1'), await call('GET', '/v1/judge/answers?limit=1')];
  const facts = jevFacts(dec, ans);
  facts.step = step;
  if (!dec) return finish('fail', lost('the judge ledger'), facts, []);
  const fact = `${str(facts.decisions_recorded) ?? '—'} decisions recorded · ${str(facts.anchored) ?? '—'} anchored on chain ${str(facts.chain) ?? '—'}${facts.answer_records ? ` · ${str(facts.answer_records)} answers` : ''}`;
  return finish('ok', fact, facts, [{ label: 'grade: ask Jev to fill the quote pad', kind: 'jev' }, { label: 'the decisions', kind: 'read', href: '/v1/judge/decisions?limit=10' }]);
}
