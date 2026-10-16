// npm run deploy — step 3: put your agent on the layer. Builds the UNSIGNED register(agentURI) of an ERC-8004 identity
// (POST /v1/assurance/call) and saves it to .coord/plan-register.json. Nothing is signed or sent here: sign it in your own
// wallet, or hand it to kms-access with `npx @taifoon/cli act .coord/plan-register.json`.
//   npm run deploy -- <agentURI> [--chain 36927]     (or AGENT_URI in .env.local; the devnet 36927 by default)
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { localEnv, plan } from '../lib/coord.mjs';

export async function deploy(argv = process.argv.slice(2), { out = (s) => process.stdout.write(`${s}\n`) } = {}) {
  const i = argv.indexOf('--chain'); const chain = Number(i >= 0 ? argv[i + 1] : 36927);
  const uri = argv.find((a, j) => !a.startsWith('--') && (i < 0 || j !== i + 1)) ?? process.env.AGENT_URI ?? localEnv().AGENT_URI;
  if (!uri || !/^(https|ipfs|data):/.test(uri)) { out('usage: npm run deploy -- <agentURI (https://…/agent.json)> [--chain 36927]'); return 2; }
  if (!Number.isInteger(chain) || chain <= 0) { out('--chain is a chain id'); return 2; }
  const r = await plan('/v1/assurance/call', { chainId: chain, action: { kind: 'register-8004', agentURI: uri } });
  const calls = r.json?.calls;
  if (!r.ok || !Array.isArray(calls) || !calls.length) { out(`POST /v1/assurance/call: ${r.json?.error ?? r.status ?? r.error}`); return 1; }
  const planDoc = { chainId: chain, calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value ?? '0', effect: c.effect ?? null })) };
  mkdirSync('.coord', { recursive: true }); writeFileSync('.coord/plan-register.json', JSON.stringify(planDoc, null, 2));
  for (const c of planDoc.calls) out(`unsigned on chain ${chain}: to ${c.to} · ${(c.data.length - 2) / 2} bytes${c.effect ? ` · ${c.effect}` : ''}`);
  out('saved .coord/plan-register.json — sign it in your own wallet, or: npx @taifoon/cli act .coord/plan-register.json --project <your kms-access project>');
  out('then: npx @taifoon/cli register agent <chain>:<the id from the Registered event> --check');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await deploy();
