// taifoon reach — the hireability gap by platform, and the one message per platform that would close most of it
// (phase board item 26). Most agents that publish an endpoint and fail one check sit on a handful of hosts, each run by one
// operator: one fix there clears every agent on it.
//   reach                       the hosts that carry the gap, the check most of their agents fail, who clears it, the running share
//   reach <host>                one host: its agents, the fix, a sample agent, and a draft message to its operator
// Reads the public worklist the readiness pass writes every 30 min (api.taifoon.dev/coordination/almost-hireable.json).
// It never sends the message: reaching an operator is a person's act. When the operator fixes it, the harvester's next pass
// (or `taifoon probe <url>` now) sees it, and the worklist and the board move with no other step.
import { rule } from '../brand.mjs';

export const WORKLIST_URL = 'https://api.taifoon.dev/coordination/almost-hireable.json';

/** The message to one platform's operator: what we see, the fix, what they get. Plain words, no promise we cannot keep. Pure. */
export function draftFor(h, sample) {
  const n = h.n.toLocaleString('en-US');
  const where = sample?.endpoint ? `\nOne example: agent ${sample.key}${sample.name ? ` ("${sample.name}")` : ''} publishes ${sample.endpoint}.` : '';
  return [
    `Subject: ${n} of your agents are listed on ERC-8004 but cannot be hired yet`,
    '',
    `Hello ${h.host} team,`,
    '',
    `Taifoon reads every agent registered on ERC-8004 and probes the endpoint each one publishes, so buyers and other agents can hire it. ${n} agents served from ${h.host} publish an endpoint, and most of them fail the same check: ${h.words ?? h.check}.${where}`,
    '',
    `The fix, once for all of them: ${h.fix}`,
    '',
    'After that, our next probe sees them within 30 minutes, they appear in the public list of hireable agents (GET https://coord.taifoon.dev/v1/agents/hireable), and buyers can hire them through the layer with the delivery graded by code. Nothing to sign and nothing to pay.',
    '',
    `Check one agent yourself at any time: npx @taifoon/cli probe ${sample?.endpoint ?? `https://${h.host}/…`}`,
  ].join('\n');
}

export default {
  name: 'reach',
  summary: 'the hireability gap by platform: the few hosts that carry most of it, the one fix each, and a draft message to its operator',
  usage: [
    ['reach [--json]', 'the hosts that carry the gap, the check most of their agents fail, who clears it, the running share'],
    ['reach <host> [--json]', 'one host: its agents, the fix, a sample agent and a draft message to its operator (never sent)'],
  ],
  valued: [],
  async run(ctx, rest) {
    const { p } = ctx;
    if (rest.length > 1) { ctx.fail('usage: taifoon reach [<host>]'); return 2; }
    const f = await (ctx.io.fetch ?? globalThis.fetch)(WORKLIST_URL, { headers: { 'user-agent': `taifoon-cli/${ctx.version}` }, signal: AbortSignal.timeout(30_000) }).catch((e) => ({ ok: false, status: 0, e }));
    const doc = f.ok ? await f.json().catch(() => null) : null;
    if (!doc?.top_hosts) { ctx.fail(`the worklist did not answer (${f.status ?? 'no answer'}): ${WORKLIST_URL}`); return 1; }
    const words = (c) => doc.checks?.[c]?.words ?? null;
    const hosts = doc.top_hosts.map((h) => ({ ...h, words: words(h.check) }));
    if (!rest.length) {
      if (ctx.json) { ctx.emit({ ok: true, n: doc.n, hosts: doc.hosts, coverage: doc.coverage ?? null, top_hosts: hosts, read_at: doc.read_at }); return 0; }
      ctx.line(rule(p, `reach · ${doc.n.toLocaleString('en-US')} agents publish an endpoint and fail one check · ${doc.hosts.toLocaleString('en-US')} hosts`));
      if (doc.coverage) ctx.line(`  ${p.accent(String(doc.coverage.hosts_for_half))} hosts carry half of them · ${p.accent(String(doc.coverage.hosts_for_80))} carry 80 % · the five largest ${Math.round(doc.coverage.top5_share * 1000) / 10} %`);
      ctx.line('');
      for (const h of hosts.slice(0, 12)) ctx.line(`  ${String(h.n).padStart(6)}  ${p.accent(h.host.padEnd(42))} ${String(Math.round((h.cum_share ?? 0) * 100)).padStart(3)} %  ${p.faint(`${h.check}${h.cause ? ` (${h.cause})` : ''} · the ${h.who}'s`)}`);
      ctx.line(`  ${p.faint('taifoon reach <host>: the fix and a draft message to its operator')}`);
      return 0;
    }
    const want = String(rest[0]).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const h = hosts.find((x) => x.host === want);
    if (!h) { ctx.fail(`${want} is not among the ${hosts.length} hosts that carry the most of the gap (taifoon reach lists them)`); return 1; }
    const sample = (doc.rows ?? []).find((r) => r.host === want) ?? null;
    const draft = draftFor(h, sample);
    if (ctx.json) { ctx.emit({ ok: true, host: h, sample, draft }); return 0; }
    ctx.line(rule(p, `reach · ${h.host} · ${h.n.toLocaleString('en-US')} agents`));
    ctx.line(`  fails      ${h.check}${h.cause ? ` (${h.cause})` : ''}: ${h.words ?? ''}`);
    ctx.line(`  fix        ${h.fix}  ${p.faint(`(the ${h.who}'s)`)}`);
    if (sample) ctx.line(`  e.g.       ${sample.key} ${sample.endpoint ?? ''}`);
    ctx.line(`  share      ${Math.round(h.share * 1000) / 10} % of the gap · ${Math.round(h.cum_share * 1000) / 10} % with the larger hosts`);
    ctx.line('');
    ctx.line(`  ${p.faint('draft to its operator (not sent; sending is yours):')}`);
    for (const l of draft.split('\n')) ctx.line(`  │ ${l}`);
    return 0;
  },
};
