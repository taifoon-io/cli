// handoff — the only place an unsigned plan meets a key: it checks the plan and returns the kms-access command a human runs with a
// live MFA session. It never signs, never sends, never spawns a process. `taifoon act <plan.json>` and the MCP tool act_handoff.
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const DATA = /^0x([0-9a-fA-F]{2})*$/;
export const WARMBED = 'https://warmbed.taifoon.dev/warmbed';

/** plan = { to, data, value?, chainId } as a plan op answers it (a { calls: [...] } plan: its first call) */
export async function handoff(args = {}) {
  let p = args.plan;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { return { ok: false, executed: false, error: 'the plan is not JSON' }; } }
  if (p && Array.isArray(p.calls)) p = { chainId: p.chainId ?? p.chain_id, ...p.calls[0] };
  if (!p || typeof p !== 'object') return { ok: false, executed: false, error: 'give the unsigned plan { to, data, value, chainId }' };
  const chainId = p.chainId ?? p.chain_id;
  const missing = ['to', 'data'].filter((k) => !p[k]).concat(chainId === undefined ? ['chainId'] : []);
  if (missing.length) return { ok: false, executed: false, error: `the plan is missing ${missing.join(', ')}` };
  if (!ADDR.test(p.to)) return { ok: false, executed: false, error: `to is not an address: ${p.to}` };
  if (!DATA.test(p.data)) return { ok: false, executed: false, error: 'data is not hex' };
  if (!/^\d+$/.test(String(chainId))) return { ok: false, executed: false, error: `chainId is not a number: ${chainId}` };
  const project = /^[a-z0-9-]+$/.test(String(args.project ?? '')) ? String(args.project) : '<project>';
  let wei; try { wei = BigInt(p.value ?? 0); } catch { return { ok: false, executed: false, error: `value is not a whole number of wei: ${p.value}` }; }
  if (wei < 0n) return { ok: false, executed: false, error: 'value is negative' };
  const value = wei > 0n ? ` --value-wei ${wei.toString()}` : '';
  const rpc = `"$(curl -s '${WARMBED}/chain/${chainId}/rotation?need=call&n=1' | jq -r '.[0].url')"`;
  return { ok: true, executed: false, chainId: Number(chainId), to: p.to, value: p.value ?? '0', data_bytes: (p.data.length - 2) / 2,
    command: [`kms-access whoami        # an MFA session first; nothing below runs without one`, `kms-access send ${project} --chain ${chainId} --rpc ${rpc} --to ${p.to} --data ${p.data}${value}`],
    note: 'a human with a live MFA session runs this, inside the project’s send cap; this tool signs nothing and runs nothing' };
}
