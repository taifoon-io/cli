// The member-contract deploy (COALESCE D7, owner yes 2026-10-15): a member deploys THEIR OWN contract through the deploy pipeline's
// shape (plan → rehearse → send → verify), never with our keys. One implementation: the CLI's `taifoon deploy member-contract` and
// the deploy pipeline's member-contract module both run this file.
//   plan      CREATE2 through Arachnid's deterministic deployer (the same factory our modules use), salt = keccak("member/<member>/<label>"):
//             the address is known before anything is sent; the outlet of the chain must be one the member's key holds
//             (devnet 36927 · taifoon 3692781 · mainnet everything else; mainnet also needs --own-signer: the member's own funded wallet)
//   rehearse  a loopback anvil fork, the member impersonated: the contract deploys, has code, and owner() is the member when it has owner()
//   send      the unsigned transaction for the member's own wallet, or `cast send --account <their foundry keystore>`; nothing of ours signs
//   verify    the live chain: code at the address, owner() the member
// Needs Foundry (cast, anvil) on PATH. Nothing here holds a key.
import { spawn, spawnSync } from 'node:child_process';

// Arachnid's deterministic deployment proxy: a third-party account at one address on every EVM chain (the same factory
// the deploy pipeline's chain list `factories.create2` names); baselined in packages/addresses/literals.baseline.json as such
export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
export const OUTLET_OF_CHAIN = Object.freeze({ 36927: 'devnet', 3692781: 'taifoon' });
export const outletOf = (chainId) => OUTLET_OF_CHAIN[Number(chainId)] ?? 'mainnet';
const strip = (h) => String(h).replace(/^0x/, '');
function cast(...args) {
  const r = spawnSync('cast', args.map(String), { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(`cast ${args[0]}: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
  return r.stdout.trim();
}
const lc = (s) => String(s ?? '').toLowerCase();

/** the outlets a key holds, from the layer: GET /v1/access/role (the same answer the gate and the pipe decide by) */
export async function grantedOutlets({ base = 'https://coord.taifoon.dev', key, fetchImpl = globalThis.fetch } = {}) {
  if (!key) return [];
  const r = await fetchImpl(`${base}/v1/access/role`, { headers: { accept: 'application/json', 'x-api-key': key }, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j?.outlets) ? j.outlets : [];
}

/** the plan: CREATE2 address, calldata and the checks it must pass before a send. Pure but for cast's keccak/abi helpers. */
export function memberPlan({ chainId, member, bytecode, ctor = null, args = [], label = 'contract', outlets = [], ownSigner = false }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(member ?? '')) throw new Error('member: the address that will own and send the contract');
  if (!/^0x[0-9a-fA-F]+$/.test(bytecode ?? '')) throw new Error('bytecode: the contract creation code (0x…)');
  const outlet = outletOf(chainId);
  const refusals = [];
  if (!outlets.includes(outlet)) refusals.push(`outlet_not_granted: chain ${chainId} is the ${outlet} outlet; your key holds [${outlets.join(', ')}]`);
  if (outlet === 'mainnet' && !ownSigner) refusals.push('mainnet needs --own-signer: the member\'s own funded wallet sends it (never ours)');
  const encoded = ctor ? strip(cast('abi-encode', ctor, ...args)) : '';
  const initCode = `0x${strip(bytecode)}${encoded}`;
  const salt = cast('keccak', `member/${lc(member)}/${label}`);
  const initCodeHash = cast('keccak', initCode);
  const address = cast('to-check-sum-address', `0x${cast('keccak', `0xff${strip(CREATE2_DEPLOYER)}${strip(salt)}${strip(initCodeHash)}`).slice(-40)}`);
  return { schema: 'taifoon.deploy.member.v1', chain: Number(chainId), outlet, member: cast('to-check-sum-address', member), label, salt, init_code_hash: initCodeHash, address,
    tx: { from: cast('to-check-sum-address', member), to: CREATE2_DEPLOYER, data: `0x${strip(salt)}${strip(initCode)}`, value: '0', chainId: Number(chainId) },
    signer: 'the member\'s own wallet (never a Taifoon key)', refusals, ok: refusals.length === 0 };
}

const ownerOf = (rpc, address) => { try { return cast('call', address, 'owner()(address)', '--rpc-url', rpc); } catch { return null; } };

/** rehearse on a loopback anvil fork (the member impersonated): deploys, has code, owner() = member when it exists */
export async function memberRehearse(plan, { rpc, port = 18800 + Math.floor(Math.random() * 900) } = {}) {
  const fork = spawn('anvil', ['--fork-url', rpc, '--port', String(port), '--auto-impersonate', '--silent'], { stdio: 'ignore' });
  const local = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 60; i += 1) { try { cast('chain-id', '--rpc-url', local); break; } catch { await new Promise((ok) => setTimeout(ok, 500)); } }
    cast('rpc', '--rpc-url', local, 'anvil_setBalance', plan.tx.from, '0x56BC75E2D63100000');
    const pre = cast('code', plan.address, '--rpc-url', local);
    if (pre !== '0x') return { ok: false, why: `the address ${plan.address} already has code on chain ${plan.chain}: choose another --label` };
    const rc = JSON.parse(cast('send', '--rpc-url', local, '--unlocked', '--from', plan.tx.from, plan.tx.to, plan.tx.data, '--json'));
    const code = cast('code', plan.address, '--rpc-url', local);
    const owner = ownerOf(local, plan.address);
    const checks = [
      { name: 'the deploy succeeded on the fork', ok: rc.status === '0x1' || rc.status === 1 || rc.status === '1' },
      { name: `code at ${plan.address}`, ok: code !== '0x' },
      { name: 'owner() is the member (when the contract has owner())', ok: owner === null || lc(owner) === lc(plan.member), detail: owner ?? 'no owner()' },
    ];
    return { ok: checks.every((c) => c.ok), gas_used: Number(rc.gasUsed), checks };
  } finally { fork.kill('SIGTERM'); }
}

/** verify the live chain: code at the planned address and owner() the member */
export function memberVerify(plan, { rpc }) {
  const code = cast('code', plan.address, '--rpc-url', rpc);
  const owner = ownerOf(rpc, plan.address);
  const checks = [{ name: `code at ${plan.address}`, ok: code !== '0x' }, { name: 'owner() is the member', ok: owner === null || lc(owner) === lc(plan.member), detail: owner ?? 'no owner()' }];
  return { ok: checks.every((c) => c.ok), checks };
}
