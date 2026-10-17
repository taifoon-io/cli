#!/usr/bin/env node
// _CLI_CONTRACT_v1_ (2026-10-17, owner: "the CLI still isn't done"): every usage line `taifoon help` prints is run against the live layer,
// on a pseudo-terminal, or skipped with a stated reason. A usage line this file does not name fails the run, so a new command cannot ship
// untested. Checks per run: no "unknown command"; no raw JSON on a terminal (a line starting with `{` or `[` followed by a quoted key);
// an error names what to run; exit code 0, or 1 with a refusal line (✗) for calls the layer refuses by design (keyless, not entitled).
// Per command: `taifoon <command> --help` prints that command's usage, not the global help.
//
//   TAIFOON_HOME=… TAIFOON_PROFILE=… node test/contract.live.mjs [--bin "taifoon-sdk"] [--only <command>] [--verbose]
// Needs a logged-in free key on the profile (taifoon login --free). Nothing here signs, sends value or writes outside that free tenant.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const BIN = opt('--bin') ? opt('--bin').split(' ') : ['node', join(HERE, '..', 'bin', 'taifoon.mjs')];
const ONLY = opt('--only');
const VERBOSE = args.includes('--verbose');

const DM = 'dm_47116c13146d64bd3be3a395';
const PLAN = (r) => ({ skip: `writes or signs (${r})` });
// usage line (as `taifoon help` prints it, without "taifoon ") → the argv runs, or { skip }
export const PLAN_OF = {
  'balance [--json]': [['balance']],
  'buy <dollars> [--chain <id | name>]': [['buy', '5', '--chain', 'base']],
  'buy <builder-99 | team-199 | protocol-299> [--chain <id | name>]': [['buy', 'builder-99', '--chain', 'base']],
  'buy claim [<saved id>] --tx 0x… --signature 0x… [--chain <id>]': PLAN('credits a payment'),
  'buy plans': [['buy', 'plans']],
  'buy products [--resource <access id>]': [['buy', 'products']],
  'buy access <product | access id> [--recipient <identity>]': [['buy', 'access', 'topic:market.signal']],
  'buy grants [--resource <access id>]': [['buy', 'grants']],
  'catalog [--status buy_now|priced|quote_on_request|covered|openable|ready] [--class c] [--protocol p] [--q words] [--limit n] [--offset n]': [['catalog', '--limit', '3']],
  'catalog <cat_…>': { from: ['catalog', '--limit', '1', '--json'], pick: (j) => j.items?.[0]?.id ?? j.rows?.[0]?.id, run: (id) => ['catalog', id] },
  'catalog --buy <cat_…> --input \'{…}\' | --need "<words>" [--price-units n] [--label name] [--dry-run]': [['catalog', '--need', 'the keccak256 hash of hello', '--dry-run']],
  'collaborate invite <project> <member> [--scope read|write] [--per-minute n] [--per-day n]': PLAN('mints a key'),
  'collaborate ls': [['collaborate', 'ls']],
  'collaborate activity <project>': [['collaborate', 'activity', 'contract']],
  'collaborate revoke <key_prefix> [--project p]': PLAN('revokes a key'),
  'collaborate handoff <project> <key_prefix>': PLAN('writes the clipboard'),
  'cover quote --venue erc8183|bitagent|memo-acp --job <id> --buyer 0x… [--chain id] [--cap units] [--network devnet]': [['cover', 'quote', '--venue', 'erc8183', '--job', '81877', '--buyer', '0x0000000000000000000000000000000000000001', '--network', 'devnet']],
  'cover quote --venue x402 --pay_to 0x… --amount units --nonce 0x… --sla s --buyer 0x…': [['cover', 'quote', '--venue', 'x402', '--pay_to', '0x0000000000000000000000000000000000000002', '--amount', '1000', '--nonce', '0x01', '--sla', '60', '--buyer', '0x0000000000000000000000000000000000000001']],
  'cover quote --venue olas-mech --mech 0x… --fee units --data_hash 0x… --sla s --buyer 0x…': [['cover', 'quote', '--venue', 'olas-mech', '--mech', '0x0000000000000000000000000000000000000003', '--fee', '1000', '--data_hash', '0x01', '--sla', '60', '--buyer', '0x0000000000000000000000000000000000000001']],
  'cover buy <saved id>': PLAN('buys cover'),
  'cover policy <policy id> [--network devnet]': [['cover', 'policy', 'pol_none', '--network', 'devnet']],
  'cover ls --buyer 0x… [--network devnet]': [['cover', 'ls', '--buyer', '0x0000000000000000000000000000000000000001', '--network', 'devnet']],
  'demand post "<need>" [--dry-run] [--label name] [--price-units n]': [['demand', 'post', 'the keccak256 hash of "hello world"', '--dry-run']],
  'demand post --class <id> --input \'{…}\'': PLAN('posts a demand'),
  'demand status <dm_…> [--watch [seconds]] [--timeout s]': [['demand', 'status', DM]],
  'demand ls [--state open|settled|…] [--limit n]': [['demand', 'ls', '--limit', '3']],
  'demo n8n': [['demo', 'n8n']],
  'demo n8n --live [--need "<words>"] [--wallet 0x…]': PLAN('runs a live flow'),
  'deploy member-contract <plan|rehearse|send|verify> --chain <id> --member <0x…> --artifact <file.json> [--ctor "constructor(address)" --args a,b] [--label name] [--rpc url] [--account keystore] [--own-signer]': PLAN('deploys a contract'),
  'facts chain [<id | name | alias>]': [['facts', 'chain', 'base']],
  'facts contracts [<chain>] [--system s] [--kind k] [--status live]': [['facts', 'contracts', '8453']],
  'facts superroot': [['facts', 'superroot']],
  'keys': { skip: 'the interactive menu: driven separately (keys-menu transcript)' },
  'keys show': [['keys', 'show']],
  'keys ls': [['keys', 'ls']],
  'keys create --label <text> [--scopes a,b] [--cap-day-grid n] [--cap-month-grid n]': PLAN('mints a key: covered by the keys transcript'),
  'keys update <prefix> [--label L] [--scopes a,b] [--cap-day-grid n] [--cap-month-grid n] [--per-minute n]': PLAN('changes a key: covered by the keys transcript'),
  'keys roll [<prefix>] [--grace-hours h]': PLAN('rolls a key'),
  'keys revoke <prefix>': PLAN('revokes a key: covered by the keys transcript'),
  'keys seats': [['keys', 'seats']],
  'login': { skip: 'reads a hidden key from the terminal' },
  'login --key-stdin | --from-keychain <svc[:acct]> | --from-ssm <project/name>': { skip: 'stores a key' },
  'login --guest': { skip: 'drops the profile key' },
  'login --free': { skip: 'mints a key: the contract run starts with it' },
  'login --owner 0x…': { skip: 'writes the profile' },
  'logout': { skip: 'deletes the profile key' },
  'whoami': [['whoami']],
  'markets ls [--status live|devnet|discover-only|blocked]': [['markets', 'ls']],
  'markets search <query> [--market id] [--limit n]': [['markets', 'search', 'translate', '--limit', '3']],
  'markets connect <market>': [['markets', 'connect', 'virtuals']],
  'markets hire <market> <ref> --task "…" [--send] [--grade] [--buyer 0x…] [--chain devnet|base --cap-usdc n]': PLAN('hires (plan without --send is printed; skipped to keep the run read-only)'),
  'match <tag> [--venue v] [--chain c] [--unit u] [--price-cap micro] [--limit n] [--json]': [['match', 'translate', '--limit', '3'], ['match', 'rpc', '--unit', '1m_requests', '--limit', '2']],
  'rpc [--json]': [['rpc']],
  'rpc <chain> [--json]': [['rpc', 'base'], ['rpc', 'solana']],
  'rpc key': [['rpc', 'key']],
  'rpc test <chain>': [['rpc', 'test', 'arbitrum'], ['rpc', 'test', 'devnet']],
  'match offers [--venue v] [--json]': [['match', 'offers', '--venue', 'x402-base']],
  'match demands <tag> [--json]': [['match', 'demands', 'translate']],
  'match claim <venue> <index> [--units n] [--send] [--json]': [['match', 'claim', 'x402-base', '0']],
  'match gpu-inference --model <id> [--json]': [['match', 'gpu-inference', '--model', 'llama-3.3-70b']],
  'mcp [--tools]': [['mcp', '--tools']],
  'act <plan.json | -> [--project <kms-access project>]': PLAN('hands a plan to kms-access'),
  'metrics [--day YYYY-MM-DD] [--watch [seconds]] [--json]': [['metrics']],
  'model [set anthropic|taifoon|claude-cli] [--model id]': [['model']],
  'model key': { skip: 'reads a hidden key' },
  'model local up|status|logs|down': [['model', 'local', 'status']],
  'network': [['network']],
  'network --pools': [['network', '--pools']],
  'new <card> [dir]': PLAN('writes files'),
  'new --app <dir>': PLAN('writes files'),
  'new --contracts <dir>': PLAN('writes files'),
  'new --list': [['new', '--list']],
  'owners [--kind | --q]': [['owners', '--kind', 'market']],
  'owners masters': [['owners', 'masters']],
  'owners get <id>': [['owners', 'get', 'chain:8453']],
  'owners claim': PLAN('claims a seat'),
  'partners [--json]': [['partners']],
  'partners <ns> [--json]': { skip: 'needs a registered namespace on the devnet bond' },
  'partners <ns> <member> [--json]': { skip: 'needs a registered namespace on the devnet bond' },
  'partners plan <action> --ns … [--json]': PLAN('an unsigned bond plan'),
  'path [--json]': [['path']],
  'path <ls_…> [--json]': { skip: 'needs a listing id' },
  'path <chain>:<agentId> [--json]': [['path', '8453:1']],
  'phases [--phase 0..5|money|reach|board] [--venue <id>] [--json]': [['phases', '--phase', 'money']],
  'phases --fixture <dir> · --served': { skip: 'reads a local fixture directory' },
  'pools ls [--chain base|arc|devnet] [--tenant moonbeam|layer]': [['pools', 'ls']],
  'pools ls --live': [['pools', 'ls', '--live']],
  'pools quote <seller> [--price-usdc n | --tenant moonbeam --price-glmr n] [--chain]': [['pools', 'quote', '0x0000000000000000000000000000000000000001', '--price-usdc', '1']],
  'pools pilot': [['pools', 'pilot']],
  'pools factories [--chain]': [['pools', 'factories']],
  'pools networks': [['pools', 'networks']],
  'pools open --chain <c> --seller <0x|agent id> [--asset] [--line] [--from] [--override]': [['pools', 'open', '--chain', 'devnet', '--seller', '0x0000000000000000000000000000000000000001']],
  'pools status --chain <c> --tx 0x… | --seller 0x…': [['pools', 'status', '--chain', 'devnet', '--seller', '0x0000000000000000000000000000000000000001']],
  'pools create <chain> <asset> <seller> [--line layer|moonbeam|v4|v4-glmr]': PLAN('writes a plan file'),
  'pools deposit <pool> <amount> --receiver 0x… [--chain]': PLAN('writes a plan file'),
  'pools redeem <pool> <shares> --owner 0x… [--chain]': PLAN('writes a plan file'),
  'pools plans [rm <id>]': [['pools', 'plans']],
  'pools sign <plan> --via kms:<project> | wallet': PLAN('signs'),
  'probe <https url> [--json]': [['probe', 'https://www.taifoon.io/.well-known/agent-card.json']],
  'probe <chain>:<agentId> [--json]': [['probe', '8453:1']],
  'prove tx <chain> <tx>': [['prove', 'tx', '8453', '0x81464f5e6a8b6322e4bec8f609a08e8ec1f1ef11d39e5f5d51e3fa676c5f042a']],
  'prove sale <sale_key> [--summary <url | file>]': [['prove', 'sale', 'sale:8453:0x68c6457832e617575352f0b11e0afbda1bda05c1b239880d242bb2293e8a2dd1']],
  'reach [--json]': [['reach']],
  'reach <host> [--json]': [['reach', 'vercel.app']],
  'register agent <chain>:<id> [--check] [--card url] [--enrich \'{…}\' --signature 0x…]': [['register', 'agent', '8453:1', '--check']],
  'register agent --uri <agentURI> --chain <id>': [['register', 'agent', '--uri', 'https://www.taifoon.io/.well-known/agent-card.json', '--chain', '36927']],
  'register resource <mcp|a2a|x402|rpc|gpu|mech> <endpoint> [--check]': [['register', 'resource', 'mcp', 'https://coord.taifoon.dev/mcp', '--check']],
  'resource add': { skip: 'the interactive onboarding walk' },
  'resource list': [['resource', 'list']],
  'resource logs <id> [--since | --tail]': { skip: 'needs a hosted resource on the tenant' },
  'resource metrics <id>': { skip: 'needs a hosted resource on the tenant' },
  'resource stream': { skip: 'a long-lived stream' },
  'resource start': PLAN('starts a hosted resource'),
  'resource stop': PLAN('stops a hosted resource'),
  'resource restart': PLAN('restarts a hosted resource'),
  'resource redeploy': PLAN('redeploys a hosted resource'),
  'send <record.json|\'{…}\'|-> --kind <kind> --to coord://<chain>/<venue>[/<agent>] [--entity e] [--order-key k] [--reply-to id] [--dry]': [['send', '{"schema":"taifoon.signal.v1","hello":"contract"}', '--kind', 'observe', '--to', 'coord://36927/contract', '--dry']],
  'stream stats': [['stream', 'stats']],
  'stream status <id>': [['stream', 'status', '0x62bdc3759b5c9e107ca80e2c45e4148e2ff516345b8e127bc2fd2e26dced5f18']],
  'stream live': [['stream', 'live', '--for', '8']],
  'stream subscribe': [['stream', 'subscribe', '--for', '5']],
  'ask "<question>" [--provider anthropic|taifoon|claude-cli] [--model id] [--readonly] [--max-turns n]': { skip: 'spends model tokens' },
  'studio [--provider anthropic|taifoon|claude-cli] [--model id] [--readonly]': { skip: 'the interactive agent session' },
  'venues [--json]': [['venues']],
  'venues <id> [--json]': [['venues', 'x402-base']],
  'venues --targets [--json]': [['venues', '--targets']],
  'blocks get <chain> <id>': [['blocks', 'get', '8453', 'latest']],
  'blocks proof <chain> <block>': [['blocks', 'proof', '8453', '52704232']],
  'agents search [--q | --chain | --skill | --class | --protocol | --verdict | --limit | --offset]': [['agents', 'search', '--q', 'translate', '--limit', '3']],
  'agents readiness <chain> <id>': [['agents', 'readiness', '8453', '1']],
  'jobs get [--ids]': [['jobs', 'get', '--ids', '81877']],
  'jobs trail <id>': [['jobs', 'trail', '81877']],
  'settle plan [--chain_id | --job | --action]': [['settle', 'plan', '--chain_id', '36927', '--job', '1', '--action', 'complete']],
  'assurance plan [--network | --action | --from | --job]': [['assurance', 'plan', '--network', 'devnet', '--action', 'quote']],
  'judge compose [--subject]': { skip: 'spends a grade (402 path)' },
  'role [--resource]': [['role']],
  'usage [--window | --scope]': [['usage']],
  'protocols': [['protocols']],
  'protocol order <protocol> <key>': [['protocol', 'order', 'across_v3', '1']],
  'protocol stuck <protocol> [--src | --dst | --since | --limit]': [['protocol', 'stuck', 'across', '--limit', '3']],
  'protocol paths <protocol> [--src | --dst]': [['protocol', 'paths', 'across']],
  'protocol quote <protocol> [--src | --dst]': [['protocol', 'quote', 'across', '--src', '8453', '--dst', '42161']],
  'projects': [['projects']],
  'projects get <id> [--limit]': [['projects', 'get', 'layerzero-messages', '--limit', '3']],
  'debug rpc <chain>': [['debug', 'rpc', '8453']],
  'debug protocol <protocol>': [['debug', 'protocol', 'across_v3']],
  'debug order <protocol> <key>': [['debug', 'order', 'across_v3', '1']],
  'debug envelope <id>': [['debug', 'envelope', '0x62bdc3759b5c9e107ca80e2c45e4148e2ff516345b8e127bc2fd2e26dced5f18']],
  'debug project <id>': [['debug', 'project', 'layerzero-messages']],
  'debug resource <id>': { skip: 'needs a hosted resource on the tenant' },
  'docs': [['docs']],
  'docs search <query> [--limit]': [['docs', 'search', 'pipe', '--limit', '3']],
  'docs get <topic>': { from: ['docs', '--json'], pick: (j) => (j.body?.topics ?? j.topics ?? j.body ?? [])[0]?.topic, run: (id) => ['docs', 'get', id] },
  'workflow check <steps> [--grant | --outlet | --ends_at]': [['workflow', 'check', 'offer_in,classify,listed']],
  // taifoon-sdk's own coord verbs (run with --bin "node …/taifoon-sdk.mjs")
  'coord economies [--from v] [--to v] [--status S] [--live]': [['coord', 'economies']],
  'coord workflow <edge-id | venue_in venue_out>': [['coord', 'workflow', 'x402-base', 'mcp']],
  'coord vacuum': [['coord', 'vacuum']],
  'coord keygen --out PATH': PLAN('writes a secret key file'),
  'coord decode <0xid | file.json | -> [--seal-key-file PATH] [--json]': [['coord', 'decode', '0x62bdc3759b5c9e107ca80e2c45e4148e2ff516345b8e127bc2fd2e26dced5f18']],
  'coord stream --transitions [--lanes …] [--notices] [--max N] [--json]': [['coord', 'stream', '--transitions', '--max', '3']],
  'coord demo': { skip: 'the long live walk (minutes): run by hand' },
};

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '').replace(/\x04|\^D\x08\x08/g, '');
/** run on a pseudo-terminal (macOS script(1)); stdin is /dev/null so a menu cannot wait */
function pty(argv, { timeout = 45_000 } = {}) {
  const r = spawnSync('script', ['-q', '/dev/null', ...BIN, ...argv], { encoding: 'utf8', timeout, env: { ...process.env, COLUMNS: '120', FORCE_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? (r.signal ? 124 : 1), out: strip(`${r.stdout ?? ''}${r.stderr ?? ''}`), timedOut: Boolean(r.error) };
}
function pipe(argv) {
  const r = spawnSync(BIN[0], [...BIN.slice(1), ...argv], { encoding: 'utf8', timeout: 45_000, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}`, err: `${r.stderr ?? ''}` };
}

const RAW_JSON = /^\s*[{[]\s*$|^\s*\{\s*"|^\s*"[a-z_]+":\s/m;
function judge(argv, r) {
  const why = [];
  if (r.timedOut) why.push('timed out');
  if (/unknown command/.test(r.out)) why.push('unknown command');
  if (RAW_JSON.test(r.out)) why.push('raw JSON on a terminal');
  if (/server[’']s environment|TAIFOON_API_KEY in this/.test(r.out)) why.push('MCP wording on a terminal');
  if (r.code !== 0) {
    const refusal = /✗|!|refused|needs|not_|no key|next:/i.test(r.out);
    if (!refusal) why.push(`exit ${r.code} without a refusal line`);
    // the same rule the CLI applies (context.mjs withNext): a command, a URL or a flag names what to run
    if (/✗/.test(r.out) && !/(^|[\s(·:])taifoon [a-z]|https?:\/\/|--[a-z]/.test(r.out.split('\n').find((l) => l.includes('✗')) ?? '')) why.push('an error that names nothing to run');
  }
  return why;
}

// the usage lines as `taifoon help` prints them
const help = pipe(['help']).out;
const lines = [...help.matchAll(/^    taifoon(?:-sdk)? (.+?)(?:\s{2,}\S.*)?$/gm)].map((m) => m[1].trim()).filter((u) => !/^(up|curl|status)\b/.test(u) || PLAN_OF[u]);
const commandsSeen = new Set(lines.map((u) => u.split(/\s+/)[0]));
let pass = 0, fail = 0, skip = 0; const fails = [];
const unnamed = lines.filter((u) => !(u in PLAN_OF) && !LEGACY_OK(u));
function LEGACY_OK(u) { return /^(seller walk|status)/.test(u) || !/^[a-z]/.test(u); }
for (const u of unnamed) { fail++; fails.push(`${u}: not in the contract (name a run or a skip reason)`); }

for (const u of lines) {
  if (ONLY && !u.startsWith(ONLY)) continue;
  const plan = PLAN_OF[u]; if (!plan) continue;
  if (plan.skip) { skip++; if (VERBOSE) console.log(`  skip  ${u}  (${plan.skip})`); continue; }
  let runs = Array.isArray(plan) ? plan : null;
  if (!runs && plan.from) { const j = (() => { try { return JSON.parse(pipe(plan.from).out); } catch { return null; } })(); const id = j && plan.pick(j); runs = id ? [plan.run(id)] : []; if (!id) { skip++; continue; } }
  for (const argv of runs) {
    const r = pty(argv);
    const why = judge(argv, r);
    if (why.length) { fail++; fails.push(`taifoon ${argv.join(' ')}: ${why.join('; ')}\n      ${r.out.split('\n').filter(Boolean).slice(0, 3).join('\n      ')}`); }
    else { pass++; if (VERBOSE) console.log(`  ok    taifoon ${argv.join(' ')}`); }
  }
}
// per-command --help
for (const c of commandsSeen) {
  if (ONLY && c !== ONLY.split(' ')[0]) continue;
  const r = pipe([c, '--help']);
  if (!new RegExp(`^taifoon(-sdk)? ${c} — `).test(r.out)) { fail++; fails.push(`taifoon ${c} --help: prints the global help, not the command's usage`); } else pass++;
}
console.log(`contract: ${pass} pass · ${fail} fail · ${skip} skipped (each with its reason) · ${lines.length} usage lines`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fail ? 1 : 0);
