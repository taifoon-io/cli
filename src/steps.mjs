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
const ID_RE = /^(?:\d{1,20}|0x[0-9a-fA-F]{40})$/;
const str = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v ? v : null);
const enc = encodeURIComponent;

/** "95902" · "8453:95902" · "erc8004:8453:95902" · "0x…40" (a seller address), with an optional separate chain. */
export function parseAgent(raw, chainRaw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim().replace(/^#/, '');
  if (!s) return null;
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
  const lost = (what) => {
    const last = calls[calls.length - 1];
    return `${what} could not be read (${last?.status ?? 'no answer'}); ${retry}`;
  };
  const stepFacts = (fields, summary, next) => ({ view: 'readiness', agent: `erc8004:${key}`, step, summary, ...fields, ...(next ? { next } : {}) });
  const enrich = numeric ? [{ label: 'enrich: sign with your owner wallet', kind: 'owner-signs', href: `/v1/agents/${agent.chain}/${agent.id}/enrich` }] : [];

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

  if (step === 'probe') {
    if (!numeric) return finish('warn', 'the probe record is keyed by an ERC-8004 agent id; a seller address has none', stepFacts({}, 'No probe record: this is a seller address, not an agent id.', null), enrich);
    const rec = await call('GET', `/v1/registry/agents/${agent.chain}/${agent.id}`);
    if (!rec) return finish('fail', lost('the harvester record'), stepFacts({}, 'The harvester record could not be read now.', null), []);
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
    const mine = rec && Array.isArray(rec.jobClasses) ? rec.jobClasses.filter((x) => typeof x === 'string') : [];
    const known = mine.filter((id) => all.some((c) => c.id === id));
    const det = known.map((id) => str(all.find((c) => c.id === id)?.det)).filter(Boolean);
    const fact = known.length ? `${known.join(', ')} · ${all.length} classes in the catalogue` : `no class matched · ${all.length} classes in the catalogue: ${all.map((c) => str(c.id)).filter(Boolean).join(', ')}`;
    const facts = stepFacts({ classes: all.map((c) => str(c.id)).filter(Boolean).join(', '), agent_classes: known.join(', ') || null, det: det[0] ?? null },
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
