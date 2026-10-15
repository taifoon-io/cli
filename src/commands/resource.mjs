// taifoon resource — your hosted resources on Taifoon hosting (cells and agents), through the layer's role-scoped hosting ops: list,
// logs, metrics (generic reads), a live stream, and start / stop / restart / redeploy. Never a shell: every call is a /v1 op the layer
// checks against your role on that resource (a member acts only on its own) and meters to your key.
import { withGeneric, followSse } from './index.mjs';

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
  summary: 'your hosted resources: list, logs, metrics, a live stream, start / stop / restart / redeploy (role-scoped, metered, never a shell)',
  valued: ['limit', 'for'],
  subs: {
    stream: async (ctx, args) => { const id = args[0]; if (!id) { ctx.fail('usage: taifoon resource stream <id> [--limit n] [--for seconds]'); return 2; } return followSse(ctx, `/v1/hosting/resources/${encodeURIComponent(id)}/stream`); },
    start: control('start'), stop: control('stop'), restart: control('restart'), redeploy: control('redeploy'),
  },
});
