// The coordination-layer CLI (login, register, collaborate, pools, markets, status, the shell) against recorded /v1 answers
// (test/fixtures/cli-layer.json, recorded by test/record-cli-fixtures.mjs) and fakes for the Keychain, kms-access and the keyed
// relayer ops. What it holds to: every command is a /v1 call; no key is ever printed or written to a file; Moonbeam's GLMR pools
// on Base are never offered a deposit, a redemption or a new pool; nothing is ever sent on mainnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../src/main.mjs';
import { MARKETS, STATUSES, matrixRow } from '../src/markets.mjs';
import { factories, REGISTRY } from '../src/registry.mjs';
import { completer, tokenize } from '../src/shell.mjs';
import { commands } from '../src/commands/index.mjs';
import { encApprove, encRedeem, NOT_OPEN } from '../src/commands/pools.mjs';
import { keyOf, sink } from './fixture-layer.mjs';
import { SELLER } from './record-cli-fixtures.mjs';

const FX = JSON.parse(readFileSync(new URL('./fixtures/cli-layer.json', import.meta.url), 'utf8'));
const KEY = 'tfr_' + 'A'.repeat(32);
const COLLAB_KEY = 'tfr_' + 'B'.repeat(32);

/** a layer over the recorded answers, plus fakes for the keyed ops; unrecorded requests answer 599 so a test sees them */
function layer(over = {}) {
  const seen = [];
  const f = async (url, init) => {
    const path = url.slice(FX.base.length);
    const body = init?.body !== undefined ? JSON.parse(init.body) : undefined;
    const k = keyOf(path, { method: init?.method, body });
    seen.push({ k, path, method: init?.method ?? 'GET', body, headers: init?.headers ?? {} });
    const o = typeof over === 'function' ? over(path, init?.method ?? 'GET', body, init?.headers ?? {}) : over[k];
    const hit = o ?? FX.responses[k];
    if (!hit) return new Response(JSON.stringify({ ok: false, error: `unrecorded: ${k}` }), { status: 599 });
    return new Response(JSON.stringify(hit.json), { status: hit.status });
  };
  return { f, seen };
}
/** a fake `security` / `kms-access` / `pbcopy`: an in-memory Keychain; every call recorded with its argv and stdin */
function fakeExec() {
  const kc = new Map(); const calls = [];
  const exec = (cmd, args, input) => {
    calls.push({ cmd, args, input });
    if (cmd === 'security' && args[0] === '-i') {
      const m = /-s (\S+) -a (\S+) .* -w (\S+)/.exec(input ?? '');
      if (!m) return { status: 1, stdout: '', stderr: 'bad' };
      kc.set(`${m[1]}|${m[2]}`, m[3]); return { status: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'security' && args[0] === 'find-generic-password') { const v = kc.get(`${args[2]}|${args[4]}`); return v ? { status: 0, stdout: v + '\n', stderr: '' } : { status: 44, stdout: '', stderr: '' }; }
    if (cmd === 'security' && args[0] === 'delete-generic-password') return { status: kc.delete(`${args[2]}|${args[4]}`) ? 0 : 44, stdout: '', stderr: '' };
    if (cmd === 'kms-access' && args[0] === 'send') return { status: 0, stdout: `sent 0x${'ab'.repeat(32)}\n`, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { exec, kc, calls };
}
async function run(argv, { over, home, exec, env = {}, stdin } = {}) {
  const out = sink(); const err = sink();
  const L = layer(over);
  const x = exec ?? fakeExec();
  const h = home ?? mkdtempSync(join(tmpdir(), 'taifoon-cli-'));
  const code = await main([...argv, '--layer', FX.base], { out, err, fetch: L.f, exec: x.exec, stdin, env: { TAIFOON_HOME: h, ...env } });
  return { code, out: out.text(), err: err.text(), seen: L.seen, exec: x, home: h };
}
const noKeyAnywhere = (r, key) => {
  assert.ok(!r.out.includes(key) && !r.err.includes(key), 'the key is never printed');
  const cfg = join(r.home, 'config.json');
  if (existsSync(cfg)) assert.ok(!readFileSync(cfg, 'utf8').includes(key), 'the key is never in the config file');
  for (const f of existsSync(join(r.home, 'plans')) ? readdirSync(join(r.home, 'plans')) : []) assert.ok(!readFileSync(join(r.home, 'plans', f), 'utf8').includes(key));
  for (const c of r.exec.calls) assert.ok(!c.args.join(' ').includes(key), `the key never reaches an argv (${c.cmd} ${c.args[0]})`);
};

// ── the catalogue ───────────────────────────────────────────────────────────────────────────────────────────────────
test('the marketplace list: unique ids, a known status, a discovery read or a reason, an unblock for every non-live row', () => {
  assert.equal(new Set(MARKETS.map((m) => m.id)).size, MARKETS.length);
  for (const m of MARKETS) {
    assert.ok(STATUSES.includes(m.status), m.id);
    assert.ok(m.name && m.where && m.lane && m.proof, m.id);
    if (m.discover) assert.match(m.discover.path, /^\/v1\//, m.id);
    if (m.status === 'blocked') { assert.ok(m.unblock && m.needs?.length, `${m.id} says what unblocks it`); assert.equal(m.hire.kind, 'blocked'); }
    if (m.status !== 'live') assert.ok(m.unblock, `${m.id}: ${m.status} needs an unblock line`);
    assert.match(matrixRow(m).command, /^taifoon markets (hire|connect) /);
  }
  // every ecosystem the loop studio proved, and every one listed as blocked, is here
  for (const id of ['virtuals', 'bitagent', 'olas', 'taifoon-mech', 'agentverse', 'mcp-registry', 'a2a-registry', 'x402', 'agentkit', 'hashproof', 'n8n', 'phala', 'cctp', 'nevermined', 'skyfire', 'elizaos', 'pearl']) assert.ok(MARKETS.some((m) => m.id === id), id);
});

test('docs/MARKETPLACES.md is generated from the list (the canonical copy in docs/)', async () => {
  const doc = new URL('../../../docs/MARKETPLACES.md', import.meta.url);
  const gen = new URL('../scripts/marketplaces-doc.mjs', import.meta.url);
  if (!existsSync(doc) || !existsSync(gen)) return; // the published tree carries neither
  const { render } = await import(gen.href);
  assert.equal(readFileSync(doc, 'utf8'), render(), 'scripts/marketplaces-doc.mjs regenerates it');
});

// ── the registry ────────────────────────────────────────────────────────────────────────────────────────────────────
test('the vendored registry is the public subset byte for byte, and carries no wallet and no governance', () => {
  const src = new URL('../../addresses/public/addresses.json', import.meta.url);
  if (existsSync(src)) assert.equal(readFileSync(new URL('../src/addresses.public.json', import.meta.url), 'utf8'), readFileSync(src, 'utf8'));
  assert.deepEqual(Object.keys(REGISTRY).sort(), ['chains', 'checked_at', 'systems', 'updated', 'version']);
  const lines = factories().map((f) => `${f.chain}:${f.line}`);
  for (const l of ['8453:moonbeam', '8453:layer', '5042:layer', '36927:layer', '36927:moonbeam', '36927:v4', '36927:v4-glmr']) assert.ok(lines.includes(l), l);
});

test('the two encoders the CLI builds itself: approve and redeem selectors are the keccak of their signatures', async () => {
  const kmod = new URL('../../addresses/keccak.mjs', import.meta.url);
  if (!existsSync(kmod)) return;
  const k = await import(kmod.href);
  const sel = (sig) => { const h = (k.keccak256 ?? k.keccak ?? k.default)(sig); return (typeof h === 'string' ? h.replace(/^0x/, '') : Buffer.from(h).toString('hex')).slice(0, 8); };
  assert.equal(encApprove(SELLER, 5n).slice(2, 10), sel('approve(address,uint256)'));
  assert.equal(encRedeem(5n, SELLER, SELLER).slice(2, 10), sel('redeem(uint256,address,address)'));
  assert.equal(encApprove(SELLER, 5n).length, 2 + 8 + 128);
});

// ── markets ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('markets ls: every marketplace, its status and seller count, read once per distinct /v1 path, reads only', async () => {
  const r = await run(['markets', 'ls']);
  assert.equal(r.code, 0, r.err);
  for (const m of MARKETS) assert.match(r.out, new RegExp(`^  ${m.id.replace('-', '\\-')}\\s+${m.status}`, 'm'));
  assert.match(r.out, /live 11 {2}· {2}devnet 3 {2}· {2}discover-only 1 {2}· {2}blocked 4/);
  assert.ok(r.seen.every((s) => s.method === 'GET'));
  assert.equal(r.seen.length, new Set(r.seen.map((s) => s.path)).size, 'one read per path');
  const j = JSON.parse((await run(['markets', 'ls', '--json'])).out);
  assert.equal(j.markets.length, MARKETS.length);
  assert.ok(j.calls.length > 5 && j.calls.every((c) => c.status === 200), 'the metered calls ride along');
});

test('markets search fans one query out to every searchable marketplace at once', async () => {
  const r = await run(['markets', 'search', 'proof', '--json']);
  const j = JSON.parse(r.out);
  assert.equal(j.results.length, MARKETS.filter((m) => m.search).length);
  assert.ok(j.results.find((g) => g.market === 'hashproof').rows.length >= 1);
  assert.ok(r.seen.every((s) => s.method === 'GET'));
});

test('markets connect: a blocked marketplace names what unblocks it and still runs its zero-cost discovery', async () => {
  const r = await run(['markets', 'connect', 'nevermined']);
  assert.equal(r.code, 0);
  assert.match(r.out, /to activate it/);
  assert.match(r.out, /Nevermined API key/);
  assert.deepEqual(r.seen.map((s) => s.path), ['/v1/nevermined/catalog?limit=1']);
  const h = await run(['markets', 'hire', 'skyfire', 'x', '--task', 't']);
  assert.equal(h.code, 3);
  assert.equal(h.seen.length, 0, 'a blocked hire calls nothing');
});

test('markets hire without --send prints the handshake and sends nothing; a mainnet settle needs a cap and a yes', async () => {
  const r = await run(['markets', 'hire', 'mcp-registry', 'io.github.zvmzaretsky/utility-belt', '--task', 'sha256 of hello']);
  assert.equal(r.code, 0);
  assert.equal(r.seen.length, 0);
  assert.match(r.out, /curl -s -X POST https:\/\/coord\.taifoon\.dev\/v1\/handshake .*"kind":"mcp-registry"/);
  assert.equal((await run(['markets', 'hire', 'mcp-registry', 'x', '--task', 't', '--chain', 'base'])).code, 2);
  const noYes = await run(['markets', 'hire', 'mcp-registry', 'x', '--task', 't', '--chain', 'base', '--cap-usdc', '1'], { stdin: Readable.from([]) });
  assert.equal(noYes.code, 3);
});

// ── pools ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('pools ls on Base: 28 Moonbeam pools, each "not open yet", and the refusal in the SDK\u2019s words', async () => {
  const r = await run(['pools', 'ls', '--json']);
  const j = JSON.parse(r.out);
  assert.equal(j.moonbeam, 28);
  assert.ok(j.pools.filter((x) => x.tenant === 'moonbeam').every((x) => x.open === 'not open yet'));
  assert.equal(j.not_open, NOT_OPEN);
});

test('Moonbeam on Base: no pool, deposit or redemption is ever built, and /v1/assurance/call is never asked', async () => {
  const c = await run(['pools', 'create', 'base', 'GLMR', SELLER, '--line', 'moonbeam']);
  assert.equal(c.code, 3); assert.match(c.err, /not open yet/); assert.equal(c.seen.length, 0);
  const moonPool = '0x95951a4bF6F2f99131a5653060d5E8a24F6feb9e';
  const over = (path) => (path.startsWith('/v1/pools/state') ? { status: 200, json: { ok: true, pools: [{ address: moonPool.toLowerCase(), tenant: 'moonbeam', asset: '0xb3846fd356c2149ee8d30b0449088dc74e265459', asset_decimals: 18 }] } } : null);
  for (const argv of [['pools', 'deposit', moonPool, '10', '--chain', 'base', '--receiver', SELLER], ['pools', 'redeem', moonPool, '1', '--chain', 'base', '--owner', SELLER]]) {
    const r = await run(argv, { over });
    assert.equal(r.code, 3, argv.join(' ')); assert.match(r.err, /not open yet/);
    assert.ok(!r.seen.some((s) => s.path.startsWith('/v1/assurance/call')));
  }
});

test('pools create on the devnet: calldata from /v1, a V4 line retargeted to its own factory, a plan kept; mainnet plans warn', async () => {
  const home = mkdtempSync(join(tmpdir(), 'taifoon-cli-'));
  const a = JSON.parse((await run(['pools', 'create', 'devnet', 'dUSDC', SELLER, '--json'], { home })).out);
  assert.equal(a.plan.network, 'devnet');
  assert.equal(a.plan.calls[0].to, factories(36927).find((f) => f.line === 'layer').address);
  assert.match(a.plan.calls[0].data, /^0x3d5c8e31/);
  const v4 = JSON.parse((await run(['pools', 'create', 'devnet', 'dGLMR', SELLER, '--line', 'v4-glmr', '--json'], { home })).out);
  assert.equal(v4.plan.calls[0].to, factories(36927).find((f) => f.line === 'v4-glmr').address);
  assert.ok(v4.plan.calls[0].retargeted_from);
  const base = await run(['pools', 'create', 'base', 'USDC', SELLER], { home });
  assert.match(base.out, /MAINNET \(Base\): printed only/);
  const plans = JSON.parse((await run(['pools', 'plans', '--json'], { home })).out).plans;
  assert.equal(plans.length, 3);
  // mainnet is never sent; a devnet send needs a yes (no TTY here) and then goes through kms-access, never a key in the CLI
  const mainnet = plans.find((x) => x.network === 'mainnet');
  const devnet = plans.find((x) => x.network === 'devnet');
  const x = fakeExec();
  assert.equal((await run(['pools', 'sign', mainnet.id, '--via', 'kms:taifoon', '--yes'], { home, exec: x })).code, 3);
  assert.equal((await run(['pools', 'sign', devnet.id, '--via', 'kms:taifoon'], { home, exec: x, stdin: Readable.from([]) })).code, 3);
  assert.equal(x.calls.filter((c) => c.cmd === 'kms-access').length, 0, 'nothing sent without a yes, nothing ever on mainnet');
  const sent = await run(['pools', 'sign', devnet.id, '--via', 'kms:taifoon', '--yes'], { home, exec: x });
  assert.equal(sent.code, 0);
  const k = x.calls.find((c) => c.cmd === 'kms-access');
  assert.deepEqual(k.args.slice(0, 6), ['send', 'taifoon', '--chain', '36927', '--rpc', 'https://rpc.taifoon.dev']);
});

// ── register ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('register agent --check reads only: the six steps, the verdict with every open step, no register or probe POST', async () => {
  const r = await run(['register', 'agent', '8453:95902', '--check']);
  assert.equal(r.code, 0, r.err);
  for (let i = 1; i <= 6; i++) assert.match(r.out, new RegExp(`→ \\[${i}/6\\]`));
  assert.match(r.out, /✓ registered · owner 0x3574999dd4c96eb73bd6e11d4177010c83e14f5b/);
  assert.match(r.out, /8453:95902 · hireable/);
  const posts = r.seen.filter((s) => s.method === 'POST').map((s) => s.path);
  assert.deepEqual([...new Set(posts)], ['/v1/assurance/call'], 'only the read-only calldata builder');
});

// ── login, collaborate: keys never printed, never in a file, never in an argv ──────────────────────────────────────
test('login --key-stdin: checked with whoami, stored in the Keychain through stdin; the config holds only its prefix', async () => {
  const over = (path, m, b, h) => (path === '/v1/relayer/whoami' ? (h['x-api-key'] === KEY ? { status: 200, json: { ok: true, key_prefix: KEY.slice(0, 10), label: 'acme', per_minute: 30, kind: 'owner' } } : { status: 401, json: { error: 'no' } }) : null);
  const r = await run(['login', '--key-stdin'], { over, stdin: Readable.from([KEY + '\n']) });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.exec.kc.get('taifoon-cli|default'), KEY);
  assert.match(readFileSync(join(r.home, 'config.json'), 'utf8'), /"key_prefix": "tfr_AAAAAA"/);
  noKeyAnywhere(r, KEY);
  const bad = await run(['login', '--key-stdin'], { over, stdin: Readable.from(['tfr_' + 'C'.repeat(32) + '\n']) });
  assert.equal(bad.code, 1); assert.equal(bad.exec.kc.size, 0, 'a refused key is not stored');
  const g = await run(['login', '--guest']);
  assert.match(readFileSync(join(g.home, 'config.json'), 'utf8'), /"mode": "guest"/);
});

test('login --free 0x…: a free key from POST /v1/register, checked with whoami, stored in the Keychain, never printed', async () => {
  const FREE = 'tfr_free_' + 'F'.repeat(32);
  const W = '0x' + '5a'.repeat(20);
  const over = (path, m, b, h) => {
    if (path === '/v1/register' && m === 'POST') { assert.equal(b.wallet_address, W); assert.equal(h['x-api-key'], undefined); return { status: 201, json: { api_key: FREE, tier: 'explorer', kind: 'free', key_prefix: FREE.slice(0, 14) } }; }
    if (path === '/v1/relayer/whoami') return h['x-api-key'] === FREE ? { status: 200, json: { ok: true, key_prefix: FREE.slice(0, 14), label: `customer:free:${W}`, per_minute: 60, kind: 'free' } } : { status: 401, json: { error: 'no' } };
    return null;
  };
  const r = await run(['login', '--free', W], { over });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.exec.kc.get('taifoon-cli|default'), FREE);
  assert.match(readFileSync(join(r.home, 'config.json'), 'utf8'), /"kind": "free"/);
  noKeyAnywhere(r, FREE);
  const bad = await run(['login', '--free', '0x12'], { over });
  assert.equal(bad.code, 2);
  const limited = await run(['login', '--free', W], { over: (path) => (path === '/v1/register' ? { status: 429, json: { ok: false, error: 'free keys: 3 a day per visitor', retry_after_seconds: 3600 } } : null) });
  assert.equal(limited.code, 1); assert.match(limited.err, /retry in 3600 s/); assert.equal(limited.exec.kc.size, 0);
  // _REGISTER_ONE_CALL_v1_: no wallet at all — the register body is empty
  const bare = await run(['login', '--free'], { over: (path, m, b, h) => {
    if (path === '/v1/register' && m === 'POST') { assert.deepEqual(b, {}); return { status: 201, json: { api_key: FREE, tier: 'explorer', kind: 'free', key_prefix: FREE.slice(0, 14) } }; }
    return over(path, m, b, h);
  } });
  assert.equal(bare.code, 0, bare.err);
  assert.equal(bare.exec.kc.get('taifoon-cli|default'), FREE);  // _NO_KEYCHAIN_v1_: no `security` (Linux, a container): the key this run minted is shown once, never written to a file
  const noKc = (cmd, args, input) => (cmd === 'security' ? { status: 127, stdout: '', stderr: '' } : fakeExec().exec(cmd, args, input));
  const bareOver = (path, m, b, h) => (path === '/v1/register' && m === 'POST' ? { status: 201, json: { api_key: FREE, kind: 'free', key_prefix: FREE.slice(0, 14) } } : over(path, m, b, h));
  const lin = await run(['login', '--free'], { over: bareOver, exec: { exec: noKc, kc: new Map(), calls: [] } });
  assert.equal(lin.code, 0, lin.err);
  assert.equal(lin.out.split(`export TAIFOON_API_KEY=${FREE}`).length, 2, 'shown exactly once, as an export line');
  const cfgText = readFileSync(join(lin.home, 'config.json'), 'utf8');
  assert.ok(!cfgText.includes(FREE), 'never in the config file'); assert.match(cfgText, /"store": "env"/);
  const linJson = await run(['login', '--free', '--json'], { over: bareOver, exec: { exec: noKc, kc: new Map(), calls: [] } });
  assert.equal(JSON.parse(linJson.out).api_key, FREE);
  // a key the user brought is never shown: without a Keychain it is refused as before (they still hold it)
  const own = await run(['login', '--key-stdin'], { over, exec: { exec: noKc, kc: new Map(), calls: [] }, stdin: Readable.from([`${FREE}\n`]) });
  assert.equal(own.code, 1); assert.ok(!own.out.includes(FREE) && !own.err.includes(FREE));
  // the status line names where the key is
  const st = await run(['whoami', '--json'], { over: bareOver, home: lin.home, exec: { exec: noKc, kc: new Map(), calls: [] }, env: { TAIFOON_API_KEY: FREE } });
  assert.equal(JSON.parse(st.out).valid, true);
});

test('collaborate invite → Keychain; ls; activity; revoke deletes the Keychain copy; the collaborator key is never shown', async () => {
  const x = fakeExec();
  x.kc.set('taifoon-cli|default', KEY);
  const member = { key_prefix: COLLAB_KEY.slice(0, 10), ref: 'key:' + 'c'.repeat(24), member: 'ana', member_kind: 'name', label: 'ana', scope: 'read', per_minute: 5, per_day: 5, created_at: '2026-09-29T00:00:00Z', revoked_at: null };
  const over = (path, m, b, h) => {
    assert.equal(h['x-api-key'], KEY, 'the owner key rides on every collaborate call');
    if (path === '/v1/relayer/keys' && m === 'POST') return { status: 201, json: { ok: true, kind: 'collaborator', key: COLLAB_KEY, member, project: { project: 'cli-proof', owner: 'key:x', owner_prefix: KEY.slice(0, 10), members: 1 } } };
    if (path === '/v1/relayer/keys') return { status: 200, json: { ok: true, owner: 'key:x', owner_prefix: KEY.slice(0, 10), projects: [{ project: 'cli-proof', owner: 'key:x', created_at: 'now', members: [{ ...member, today: { day: 'd', writes: 0, reads: 1 } }] }] } };
    if (path.startsWith('/v1/relayer/activity')) return { status: 200, json: { ok: true, project: 'cli-proof', owner: 'key:x', members: [{ ...member, days: [], totals: { writes: 0, reads: 1 }, gateway_steps: [] }], owner_gateway_steps: [], sources: ['relayer_rate kday:*'] } };
    if (path === '/v1/relayer/keys/revoke') return { status: 200, json: { ok: true, revoked: true, already: false, project: 'cli-proof', member: { ...member, revoked_at: 'now' } } };
    return null;
  };
  const cfgHome = mkdtempSync(join(tmpdir(), 'taifoon-cli-'));
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(cfgHome, { recursive: true });
  writeFileSync(join(cfgHome, 'config.json'), JSON.stringify({ profile: 'default', profiles: { default: { mode: 'key', store: 'keychain', keychain: { service: 'taifoon-cli', account: 'default' }, key_prefix: KEY.slice(0, 10) } } }));
  const inv = await run(['collaborate', 'invite', 'cli-proof', 'ana', '--scope', 'read', '--per-day', '5'], { over, exec: x, home: cfgHome });
  assert.equal(inv.code, 0, inv.err);
  assert.equal(x.kc.get(`taifoon-collab|cli-proof/${COLLAB_KEY.slice(0, 10)}`), COLLAB_KEY);
  noKeyAnywhere(inv, COLLAB_KEY); noKeyAnywhere(inv, KEY);
  const invJson = await run(['collaborate', 'invite', 'cli-proof', 'ana', '--json'], { over, exec: x, home: cfgHome });
  assert.ok(!invJson.out.includes(COLLAB_KEY), '--json never carries the key either');
  assert.match((await run(['collaborate', 'ls'], { over, exec: x, home: cfgHome })).out, /tfr_BBBBBB\s+ana\s+read/);
  assert.match((await run(['collaborate', 'activity', 'cli-proof'], { over, exec: x, home: cfgHome })).out, /who did what · cli-proof/);
  const rv = await run(['collaborate', 'revoke', COLLAB_KEY.slice(0, 10)], { over, exec: x, home: cfgHome });
  assert.equal(rv.code, 0);
  assert.equal(x.kc.has(`taifoon-collab|cli-proof/${COLLAB_KEY.slice(0, 10)}`), false);
  const guest = await run(['collaborate', 'ls']);
  assert.equal(guest.code, 2, 'a guest has no projects');
});

// ── status and the shell ────────────────────────────────────────────────────────────────────────────────────────────
test('status: network, session, marketplaces and the plans waiting, on one screen', async () => {
  const r = await run(['status']);
  assert.equal(r.code, 0, r.err);
  for (const s of ['network', 'session', 'marketplaces']) assert.match(r.out, new RegExp(`╭─ ${s} `));
  assert.match(r.out, /guest · visitor budget/);
});

test('the shell: quotes tokenised, / optional, completion over the command table, piped lines through one dispatch', async () => {
  assert.deepEqual(tokenize('markets search "proof of reserves" --limit 3'), ['markets', 'search', 'proof of reserves', '--limit', '3']);
  const t = await commands();
  assert.deepEqual(completer(t, 'mark')[0], ['markets ']);
  assert.deepEqual(completer(t, '/po')[0], ['/pools ']);
  assert.ok(completer(t, 'markets connect ne')[0].includes('markets connect nevermined '));
  assert.ok(completer(t, 'pools ')[0].includes('pools create '));
  const r = await run(['--no-banner'], { stdin: Readable.from(['markets ls --status blocked\n/pools factories --chain devnet\nfrobnicate\nexit\nstatus\n']) });
  assert.equal(r.code, 0);
  assert.match(r.out, /❯ markets ls --status blocked/);
  assert.match(r.out, /nevermined\s+blocked/);
  assert.match(r.out, /PoolFactory V4 \(proxy, devnet/);
  assert.match(r.err, /unknown command frobnicate/);
  assert.doesNotMatch(r.out, /╭─ network/, 'exit ends the piped session before status');
});

test('every command takes --json and prints exactly one JSON value with the /v1 calls it made', async () => {
  for (const argv of [['markets', 'connect', 'virtuals'], ['pools', 'pilot'], ['pools', 'factories'], ['pools', 'quote', '0x3574999dd4c96eb73bd6e11d4177010c83e14f5b'], ['register', 'agent', '8453:95902', '--check'], ['status'], ['whoami']]) {
    const r = await run([...argv, '--json']);
    const lines = r.out.trim().split('\n');
    assert.equal(lines.length, 1, argv.join(' '));
    const j = JSON.parse(lines[0]);
    assert.ok(Array.isArray(j.calls), argv.join(' '));
  }
});
