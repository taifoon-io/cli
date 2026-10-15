// taifoon probe — talk to an outside agent the way the layer does, and see what it answers (phase board items 21, 26).
//   probe <url>                one endpoint: MCP initialize → tools/list, A2A message/send (one-word READY), the legacy
//                              tasks/send, or an x402 402 — the harvester's own handshake probe, run now by the layer
//   probe <chain>:<agentId>    an ERC-8004 agent: the layer re-checks the endpoints it published and updates its row
// One POST /v1/agents/probe. Nothing is paid, no tool is called, no Jev. The layer holds the visitor budget (4 a minute,
// 40 a day) and rests an endpoint a minute after each probe. What to do next is printed as a command: hire it on a tool it
// listed (taifoon markets hire), or list it (taifoon register).
import { rule, pill } from '../brand.mjs';
import { AGENT_RE } from './path.mjs';

/** The probe body for an argument: a URL or <chain>:<agentId>; null when it is neither. Pure. */
export function probeBody(arg) {
  const s = String(arg ?? '').trim();
  if (/^https:\/\/[^\s]+$/i.test(s)) return { url: s };
  const m = AGENT_RE.exec(s);
  return m ? { chainId: Number(m[1]), agentId: m[2] } : null;
}

/** The next commands for what the probe found. Pure. */
export function nextOf(body, pr) {
  if (!pr) return [];
  const out = [];
  if (pr.status === 'ready' && pr.protocol === 'mcp' && Array.isArray(pr.tools) && pr.tools.length && body.url)
    out.push(`taifoon markets hire mcp-registry <its registry name> --tool ${pr.tools[0]} --args '{…}' --task "…" --send   (or list it: taifoon register agent --uri <card> --chain <id>)`);
  else if (pr.status === 'ready' && body.agentId) out.push(`taifoon path ${body.chainId}:${body.agentId}   (where it stands, and the next step)`);
  else if (pr.status === 'x402') out.push('it is priced per call with x402: pay it from your own wallet, or post a demand and let the layer hire it');
  if (pr.status !== 'ready' && pr.status !== 'x402') out.push('the owner’s fix is in the reason above; taifoon reach shows which platforms carry the most agents with the same miss');
  return out;
}

export default {
  name: 'probe',
  summary: 'talk to an outside agent now: MCP initialize + tools/list, A2A message/send, x402 — the harvester’s probe, run by the layer',
  usage: [
    ['probe <https url> [--json]', 'one endpoint: does it answer, in which protocol, with which tools (nothing paid, no tool called)'],
    ['probe <chain>:<agentId> [--json]', 'an ERC-8004 agent: re-check the endpoints it published; its row is updated'],
  ],
  valued: [],
  async run(ctx, rest) {
    const { p } = ctx;
    if (rest.length !== 1) { ctx.fail('usage: taifoon probe <https url> | <chain>:<agentId>'); return 2; }
    const body = probeBody(rest[0]);
    if (!body) { ctx.fail(`"${String(rest[0]).slice(0, 60)}" is neither an https URL nor <chain>:<agentId>`); return 2; }
    const r = await ctx.post('/v1/agents/probe', body);
    const pr = r.json?.probe ?? null;
    if (!r.ok || !pr) {
      ctx.fail(`${r.json?.error ?? `POST /v1/agents/probe answered ${r.status ?? r.error}`}${r.json?.next_step?.why ? ` · ${r.json.next_step.why}` : ''}`);
      if (ctx.json) ctx.emit({ ok: false, status: r.status, error: r.json?.error ?? null, next_step: r.json?.next_step ?? null });
      return r.status === 429 ? 3 : 1;
    }
    const next = nextOf(body, pr);
    if (ctx.json) { ctx.emit({ ok: true, probe: pr, kept: r.json.kept ?? false, rested: r.json.rested ?? false, next }); return 0; }
    ctx.line(rule(p, `probe · ${body.url ?? `${body.chainId}:${body.agentId}`}`));
    const st = pr.status === 'ready' || pr.status === 'x402' ? 'live' : 'blocked';
    ctx.line(`  ${pill(p, st)} ${p.accent(pr.status)}${pr.protocol ? ` over ${pr.protocol}` : ''}${pr.latency_ms ? p.faint(` · ${pr.latency_ms} ms`) : ''}${pr.server ? ` · ${pr.server}` : ''}${pr.a2a_version ? ` · A2A ${pr.a2a_version}` : ''}`);
    if (Array.isArray(pr.tools) && pr.tools.length) ctx.line(`  tools  ${pr.tools.join(', ')}`);
    if (pr.cause || pr.reason) ctx.line(`  ${p.faint(`${pr.cause ? `${pr.cause}: ` : ''}${pr.reason ?? ''}`)}`);
    if (r.json.kept) ctx.line(`  ${p.faint('the agent’s row was updated with this answer')}`);
    for (const n of next) ctx.line(`  → ${n}`);
    return 0;
  },
};
