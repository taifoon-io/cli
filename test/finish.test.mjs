// _CLI_FINISH_v1_ (2026-10-17, owner: "the CLI still isn't done"): what the live contract (test/contract.live.mjs) caught, pinned offline.
// Per-command --help; every failure line names what to run; the match hit's normalized price and legs (coord #285) and the model view;
// taifoon rpc's chain argument and card; a created key's Keychain account is its whole layer prefix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/main.mjs';
import { nextStep, withNext } from '../src/context.mjs';
import { hitRows, providerOfHit, inferenceRows } from '../src/commands/match.mjs';
import { chainArg, cardOf } from '../src/commands/rpc.mjs';

const sink = () => { let s = ''; return { write: (x) => { s += x; return true; }, get text() { return s; }, isTTY: false }; };
const run = async (argv, io = {}) => { const out = sink(); const err = sink(); const code = await main(argv, { out, err, env: { NO_COLOR: '1', TAIFOON_HOME: '/nonexistent', ...(io.env ?? {}) }, noShell: true, fetch: io.fetch ?? (async () => new Response('{}', { status: 599 })), exec: () => ({ status: 1, stdout: '', stderr: '' }), ...io }); return { code, out: out.text, err: err.text }; };

test('`taifoon <command> --help` prints that command\'s usage, not the global help', async () => {
  for (const c of ['stream', 'rpc', 'keys', 'match', 'pools', 'usage']) {
    const r = await run([c, '--help']);
    assert.equal(r.code, 0, c);
    assert.ok(r.out.startsWith(`taifoon ${c} — `), `${c}: ${r.out.slice(0, 60)}`);
    assert.ok(!r.out.includes('START HERE'), `${c} printed the global help`);
  }
  assert.ok((await run(['help', 'rpc'])).out.startsWith('taifoon rpc — '));
});

test('a failure line always names what to run: the layer\'s next_step, else by status, else the command\'s usage', () => {
  assert.equal(nextStep({ status: 400, body: { next_step: { cli: 'npx @taifoon/cli login --free' } }, keyed: false }), 'taifoon login --free');
  // a keyed caller is never told to get a free key: the status decides instead
  assert.equal(nextStep({ status: 400, body: { next_step: { cli: 'npx @taifoon/cli login --free' } }, keyed: true, cmd: 'jobs' }), 'taifoon jobs --help');
  assert.equal(nextStep({ status: 401 }), 'taifoon login --free');
  assert.equal(nextStep({ status: 402, keyed: true }), 'taifoon balance · taifoon buy <dollars>');
  assert.match(nextStep({ status: 403, keyed: true }), /^taifoon role/);
  assert.equal(nextStep({ status: 404, cmd: 'debug' }), 'taifoon debug --help');
  // the generic runner's answer nests the body: its next_step is read there too
  assert.equal(nextStep({ status: 400, body: { ok: false, status: 400, body: { next_step: { cli: 'taifoon register agent <chain>:<id>' } } }, keyed: true }), 'taifoon register agent <chain>:<id>');
  // a line that already names a command, a URL or a flag is left alone
  assert.equal(withNext('no project x: taifoon collaborate ls', {}), 'no project x: taifoon collaborate ls');
  assert.equal(withNext('name --entity', {}), 'name --entity');
  assert.equal(withNext('no protocol leaf across', { cmd: 'debug', status: 404 }), 'no protocol leaf across · next: taifoon debug --help');
});

test('usage without a key says what to run, not the MCP server\'s environment', async () => {
  const r = await run(['usage'], { env: { NO_COLOR: '1', TAIFOON_HOME: '/nonexistent' } });
  assert.doesNotMatch(r.out + r.err, /server[’']s environment/);
});

const HIT = (over = {}) => ({ venue: 'ionet', candidate: { index: 1, twig: '0x96', capability: { actor: 'taifoon-resale:ionet', chain: 'offchain', price_micro: 329400, unit: '1m_tokens_out', tags: ['llama-3.3-70b'] } }, head: { count: 2, hash: '0x34' }, ...over });
const row = (rows, k) => rows.find(([x]) => x === k)?.[1];

test('a hit: the normalized price per the canonical unit, the source unit beside it, and the legs as its own fee module quoted them', () => {
  const rows = hitRows(HIT({
    normalized: { unit: '1m_tokens_out', price_micro: 329400, source_unit: '1m_tokens_out', units_per_quote: 1 },
    legs: { fee_rule: 'metered', per: { quantity: 1, unit: '1m_tokens_out' }, seller_price: 329400, our_fee: 0, venue_fee_in: 0, venue_fee_out: 0, reseller_markup: 9882, price_to_buyer: 339282 },
  }));
  assert.equal(row(rows, 'price'), '0.329400 USDC per 1m_tokens_out');
  assert.equal(row(rows, 'legs'), 'metered · to the buyer 0.339282 USDC per 1m_tokens_out = seller 0.329400 USDC + our fee 0.000000 USDC + reseller 0.009882 USDC');
  const rpc = hitRows(HIT({ candidate: { index: 0, capability: { actor: 'rpc-gateway', price_micro: 500000, unit: '1000000 reads' } }, normalized: { unit: '1m_requests', price_micro: 500000, source_unit: 'read', units_per_quote: 1000000 } }));
  assert.equal(row(rpc, 'price'), '0.500000 USDC per 1m_requests (listed 0.500000 USDC per 1,000,000 read)');
});

test('a hit the scheme cannot quote says so with the reason; nothing renders NaN', () => {
  const rows = hitRows(HIT({ legs: { error: 'no fee facts for venue ionet', fee_rule: 'unknown' } }));
  assert.equal(row(rows, 'legs'), 'not quoted: no fee facts for venue ionet (fee rule unknown)');
  const old = hitRows(HIT({ legs: { price_to_buyer: undefined } }));
  assert.ok(!JSON.stringify(old).includes('NaN'));
  assert.equal(providerOfHit(HIT()), 'ionet');
});

test('the model view joins the listings feed (provider, price, delivery) to the index leaves', async () => {
  const listings = { at: '2026-10-17T07:37:00Z', listing_rule: { cut_bps: 300 }, listings: [
    { reference_model: 'llama-3.3-70b', model: 'meta-llama/Llama-3.3-70B', provider: { id: 'ionet', name: 'io.net' }, price_usd_per_1m: { in: 0.3294, out: 0.3294 }, provider_usd_per_1m: { in: 0.3198, out: 0.3198 }, live: false, owner_step: 'ionet-account: fund 20 USD' },
    { reference_model: 'llama-3.3-70b', model: 'llama-3.3-70b-versatile', provider: { id: 'groq', name: 'Groq' }, price_usd_per_1m: { in: 0.6, out: 0.81 }, provider_usd_per_1m: { in: 0.59, out: 0.79 }, live: true, owner_step: null },
  ] };
  assert.deepEqual(inferenceRows(listings, 'llama-3.3-70b').map((l) => l.provider.id), ['ionet', 'groq']);
  const fetch = async (url) => (String(url).includes('inference-listings') ? new Response(JSON.stringify(listings)) : new Response(JSON.stringify({ ok: true, n: 1, hits: [HIT()] })));
  const r = await run(['match', 'gpu-inference', '--model', 'llama-3.3-70b'], { fetch });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /io\.net .*0\.3294 .*after funding .*ionet leaf 1/);
  assert.match(r.out, /Groq .*now .*not indexed/);
  assert.match(r.out, /ionet-account: fund 20 USD/);
  const j = await run(['match', 'gpu-inference', '--model', 'llama-3.3-70b', '--json'], { fetch });
  assert.equal(JSON.parse(j.out).listings[0].index.leaf, 1);
});

test('taifoon rpc: a chain by id, CAIP-2 id or name; Solana keeps its name; every card has a gateway or says why not', () => {
  assert.equal(chainArg('8453'), 8453);
  assert.equal(chainArg('eip155:42161'), 42161);
  assert.equal(chainArg('robinhood'), 4663);
  assert.equal(chainArg('solana'), 'solana');
  assert.equal(chainArg('nope'), null);
  for (const id of [8453, 42161, 5042, 36927]) {
    const c = cardOf(id);
    assert.ok(c, `card ${id}`);
    assert.ok(c.endpoints.gateway || c.verified.gateway_why, `${id}: gateway or why`);
    assert.ok(c.endpoints.ws || c.verified.ws_why, `${id}: ws or why`);
    assert.ok(c.price_usdc_per_1m.plain > 0 && c.price_usdc_per_1m.proved > c.price_usdc_per_1m.plain);
  }
});

test('a created key is stored under its whole layer prefix (two free keys never share one Keychain entry)', async () => {
  const kc = new Map(); const exec = (cmd, args, stdin) => {
    if (cmd === 'security' && args[0] === '-i') { const m = stdin.match(/-s (\S+) -a (\S+) .* -w (\S+)/); kc.set(`${m[1]}/${m[2]}`, m[3]); return { status: 0, stdout: '', stderr: '' }; }
    if (cmd === 'security' && args[0] === 'find-generic-password') { const v = kc.get(`${args[2]}/${args[4]}`); return v ? { status: 0, stdout: v, stderr: '' } : { status: 44, stdout: '', stderr: '' }; }
    if (cmd === 'security' && args[0] === 'delete-generic-password') { return { status: kc.delete(`${args[2]}/${args[4]}`) ? 0 : 44, stdout: '', stderr: '' }; }
    return { status: 1, stdout: '', stderr: '' };
  };
  const KEY = 'tfr_free_' + 'A'.repeat(32);
  const made = ['tfr_free_aaaaa', 'tfr_free_bbbbb']; let n = 0;
  const fetch = async (url, init) => {
    const b = init?.body ? JSON.parse(init.body) : {};
    if (b.action === 'create') { const pre = made[n++]; return new Response(JSON.stringify({ ok: true, api_key: `${pre}${'C'.repeat(30)}${n}`, key: { prefix: pre } })); }
    if (b.action === 'revoke') return new Response(JSON.stringify({ ok: true }));
    return new Response(JSON.stringify({ ok: true }));
  };
  const env = { NO_COLOR: '1', TAIFOON_HOME: '/nonexistent', TAIFOON_API_KEY: KEY };
  for (const label of ['one', 'two']) assert.equal((await run(['keys', 'create', '--label', label, '--yes'], { fetch, exec, env })).code, 0);
  assert.ok(kc.has('taifoon-cli/key/tfr_free_aaaaa') && kc.has('taifoon-cli/key/tfr_free_bbbbb'), [...kc.keys()].join(','));
  const r = await run(['keys', 'revoke', 'tfr_free_aaaaa', '--yes'], { fetch, exec, env });
  assert.equal(r.code, 0);
  assert.ok(!kc.has('taifoon-cli/key/tfr_free_aaaaa'), 'the revoked key\'s entry is deleted');
  assert.ok(kc.has('taifoon-cli/key/tfr_free_bbbbb'));
  assert.ok(!r.out.includes('C'.repeat(30)), 'no key is printed');
});

test('the model view says when the match index did not answer, instead of calling every listing "not indexed"', async () => {
  const listings = { at: '2026-10-17T08:00:00Z', listing_rule: { cut_bps: 300 }, listings: [{ reference_model: 'llama-3.3-70b', model: 'm', provider: { id: 'ionet', name: 'io.net' }, price_usd_per_1m: { in: 0.33, out: 0.33 }, provider_usd_per_1m: { in: 0.32, out: 0.32 }, live: false, owner_step: 'fund' }] };
  const fetch = async (url) => (String(url).includes('inference-listings') ? new Response(JSON.stringify(listings)) : new Response(JSON.stringify({ ok: false, code: 'pipe_unavailable', retry_after_seconds: 30 }), { status: 503 }));
  const r = await run(['match', 'gpu-inference', '--model', 'llama-3.3-70b'], { fetch });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /index down/);
  assert.match(r.out, /the match index did not answer \(pipe_unavailable, retry in 30 s\)/);
  assert.doesNotMatch(r.out, /not indexed/);
});

test('a generic read on a terminal prints the layer\'s answer, not the runner\'s wrapper', async () => {
  const out = { write(x) { this.t = (this.t ?? '') + x; return true; }, isTTY: true, columns: 120 };
  const err = sink();
  const fetch = async () => new Response(JSON.stringify({ schema: 'taifoon.access.role.v1', role: 'owner', tenant: 'acct_1' }));
  const code = await main(['role'], { out, err, env: { NO_COLOR: '1', TAIFOON_HOME: '/nonexistent', TAIFOON_API_KEY: 'tfr_free_' + 'A'.repeat(32) }, noShell: true, fetch, exec: () => ({ status: 1, stdout: '', stderr: '' }) });
  assert.equal(code, 0, err.text);
  assert.match(out.t, /role\s+owner/);
  assert.doesNotMatch(out.t, /^kind\s+read/m);
  assert.match(out.t, /--json for the whole answer/);
});
