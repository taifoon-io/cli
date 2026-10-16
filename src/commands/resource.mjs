// taifoon resource — your hosted resources on Taifoon hosting (cells and agents), through the layer's role-scoped hosting ops: list,
// logs, metrics (generic reads), a live stream, and start / stop / restart / redeploy. Never a shell: every call is a /v1 op the layer
// checks against your role on that resource (a member acts only on its own) and meters to your key.
import { withGeneric, followSse } from './index.mjs';
import { RES_KINDS, resource as walk } from './register.mjs';

// _ONBOARDING_FLOW_v1_ (coord docs/ONBOARDING-FLOW.md): `taifoon resource add <type> <target>` is the one onboarding entry for a
// resource a member contributes — the same λ walk as `register resource` (register → probe → list → gateway), named by connector
// type. Types the walk does not take point at the path that does (one implementation each, never a second walk).
export const ADD_TYPES = Object.freeze({
  'rpc-list': 'rpc', rpc: 'rpc', compute: 'gpu', gpu: 'gpu', 'agent:mcp': 'mcp', mcp: 'mcp', 'agent:a2a': 'a2a', a2a: 'a2a',
  'pay:x402': 'x402', x402: 'x402', 'agent:mech': 'mech', mech: 'mech',
});
export const ADD_ELSEWHERE = Object.freeze({
  collect: 'a protocol\'s events as a stream: POST /v1/projects with a stream spec (coord docs/STREAM-SERVICES.md)',
  stream: 'a stream service: POST /v1/projects with a stream spec (coord docs/STREAM-SERVICES.md)',
  workflow: 'a workflow: the studio (taifoon studio) or POST /v1/projects; check it with taifoon workflow check',
  contracts: 'contracts: coord deploy <module> --chain <id> (plan · rehearse · send) — docs/DEPLOY-MAP.md',
  vault: 'a vault: an owner step (custody needs the owner\'s yes) — coord docs/PERSONAS-AND-ENERGY.md',
  agent: 'an agent: taifoon register agent <chain>:<id> (the ERC-8004 walk), or name its endpoint: agent:mcp | agent:a2a | agent:mech',
});
const add = async (ctx, [type, target]) => {
  const kind = ADD_TYPES[type];
  if (kind && RES_KINDS.includes(kind)) return walk(ctx, [kind, target]);
  if (ADD_ELSEWHERE[type]) { ctx.line(`  ${type}: ${ADD_ELSEWHERE[type]}`); return 2; }
  ctx.fail(`usage: taifoon resource add <${Object.keys(ADD_TYPES).join('|')}> <endpoint URL | mech address> [--check] — or one of ${Object.keys(ADD_ELSEWHERE).join(', ')} for where those go`);
  return 2;
};

const control = (action) => async (ctx, args) => {
  const id = args[0]; if (!id) { ctx.fail(`usage: taifoon resource ${action} <id> [--yes]`); return 2; }
  if (!ctx.key()) { ctx.fail('this needs your key: taifoon login'); return 2; }
  if (!(await ctx.confirm(`${action} ${id}?`))) { ctx.line(`  ${ctx.p.faint('not sent (answer y, or pass --yes)')}`); return 1; }
  const r = await ctx.post(`/v1/hosting/resources/${encodeURIComponent(id)}/${action}`, {});
  if (ctx.json) { ctx.emit({ ok: r.ok, status: r.status, answer: r.json }); return r.ok ? 0 : 1; }
  if (!r.ok) { ctx.fail(`${action} ${id}: ${r.status ?? r.error}${r.json?.code ? ` ${r.json.code}` : ''}${r.json?.reason ? ` — ${r.json.reason}` : r.json?.error ? ` — ${r.json.error}` : ''}`); return 1; }
  ctx.line(`  ${ctx.p.live('✓')} ${action} ${id}${r.json?.status ? ` → ${r.json.status}` : ''}`);
  return 0;
};

export default withGeneric('resource', {
  summary: 'your resources: add one (the onboarding walk, by connector type); your hosted ones: list, logs, metrics, a live stream, start / stop / restart / redeploy (role-scoped, metered, never a shell)',
  valued: ['limit', 'for'],
  subs: {
    stream: async (ctx, args) => { const id = args[0]; if (!id) { ctx.fail('usage: taifoon resource stream <id> [--limit n] [--for seconds]'); return 2; } return followSse(ctx, `/v1/hosting/resources/${encodeURIComponent(id)}/stream`); },
    start: control('start'), stop: control('stop'), restart: control('restart'), redeploy: control('redeploy'),
    add,
  },
});
