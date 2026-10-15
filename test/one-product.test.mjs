// _ONE_PRODUCT_v1_: roles filter every door; the agent core runs the table's rows and never acts on its own; the providers speak their
// wire formats; the debuggers fold reads into verdicts; the knowledge shipped with the release is searchable, path-jailed, and the
// language's golden set passes on it; help and MCP hide what a role may not use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { CAPABILITIES } from '../src/capabilities.mjs';
import { resolveRole, rowsFor, rowAllowed, actionOf, useDecision } from '../src/roles.mjs';
import * as generatedRoles from '../src/generated/coord-lang/roles.mjs';
import { runAgent, toolDefs, toolCaller, PROPOSE, systemPrompt, clip } from '../src/agent/core.mjs';
import { anthropic, taifoon, renderPrompt } from '../src/agent/providers.mjs';
import { runRow } from '../src/run.mjs';
import { RUNNERS, createServer } from '../src/mcp.mjs';
import { debugRpc, debugEnvelope, debugResource } from '../src/debug.mjs';
import { knowledgeList, knowledgeSearch, knowledgeGet, goldenSet, workflowCheck } from '../src/knowledge.mjs';
import { main } from '../src/main.mjs';

const KEY = 'tfr_' + 'A'.repeat(32);
const res = (status, json) => new Response(JSON.stringify(json), { status });
const sinkOut = () => { let s = ''; return { w: new Writable({ write(c, _e, cb) { s += c; cb(); } }), text: () => s }; };

test('roles: the layer decides; without its op a token is admin, a key a member, nothing public; an invalid key is public', async () => {
  const seen = [];
  const f404 = async (url, init) => { seen.push(init.headers); return res(404, { ok: false }); };
  assert.equal((await resolveRole({ base: 'https://x', key: KEY, fetch: f404, env: {} })).role, 'member');
  assert.equal((await resolveRole({ base: 'https://x', key: null, fetch: f404, env: {} })).role, 'public');
  assert.equal((await resolveRole({ base: 'https://x', key: null, fetch: f404, env: { TAIFOON_OPERATOR_TOKEN: 'o'.repeat(32) } })).role, 'admin');
  assert.equal(seen[2]['x-operator-token'], 'o'.repeat(32));
  assert.equal((await resolveRole({ base: 'https://x', key: KEY, fetch: async () => res(401, { ok: false }), env: {} })).role, 'public');
  const r = await resolveRole({ base: 'https://x', key: KEY, fetch: async () => res(200, { role: 'owner', scopes: ['proofs'], owner_of: ['protocol:layerzero_v2'] }), env: {} });
  assert.equal(r.role, 'owner'); assert.equal(r.source, 'layer'); assert.deepEqual(r.owner_of, ['protocol:layerzero_v2']);
});

test('roles: public gets keyless reads only; a member gets keyed reads and plans but not the admin verb; admin gets all', async () => {
  const pub = await rowsFor(CAPABILITIES, 'public');
  assert.ok(pub.every((r) => !r.key && actionOf(r) === 'read'));
  assert.ok(pub.some((r) => r.id === 'debug.rpc') && !pub.some((r) => r.id === 'usage') && !pub.some((r) => r.kind === 'plan'));
  const mem = await rowsFor(CAPABILITIES, 'member');
  assert.ok(mem.some((r) => r.id === 'usage') && mem.some((r) => r.id === 'resource.restart') && mem.some((r) => r.kind === 'plan'));
  assert.equal(await rowAllowed(CAPABILITIES.find((r) => r.id === 'admin'), 'member'), false);
  assert.equal(await rowAllowed(CAPABILITIES.find((r) => r.id === 'admin'), 'admin'), true);
});

test('MCP lists only what the role allows, and refuses a tool outside it', async () => {
  const rows = await rowsFor(CAPABILITIES, 'public');
  const s = createServer({ rows, version: 't' });
  const list = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = list.result.tools.map((t) => t.name);
  assert.ok(names.includes('debug_rpc') && !names.includes('access_usage') && !names.includes('settle_plan'));
  const call = await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'access_usage', arguments: {} } });
  assert.equal(call.result.isError, true);
});

test('the agent tools: one per allowed MCP row plus the proposal; readonly drops plans and the proposal', async () => {
  const rows = await rowsFor(CAPABILITIES, 'member');
  const all = toolDefs(rows); const ro = toolDefs(rows, { readonly: true });
  assert.ok(all.some((t) => t.name === PROPOSE.name) && !ro.some((t) => t.name === PROPOSE.name));
  assert.ok(all.some((t) => t.name === 'settle_plan') && !ro.some((t) => t.name === 'settle_plan'));
  for (const t of all) assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.ok(!all.some((t) => ['resource_restart', 'owners_claim'].includes(t.name)), 'acts are never tools');
});

test('the loop: a tool call through the table’s runner, its result back to the model, then the answer; a proposal is not run', async () => {
  const calls = []; let turn = 0;
  const provider = { name: 'fake', model: 'f', async complete({ messages, tools }) {
    turn++;
    if (turn === 1) return { content: [{ type: 'tool_use', id: 't1', name: 'debug_rpc', input: { chain: '8453' } }, { type: 'tool_use', id: 't2', name: 'propose_command', input: { command: 'taifoon resource restart solver-1', why: 'it is stuck' } }], usage: { input_tokens: 10, output_tokens: 5 } };
    const tr = messages.at(-1).content; assert.equal(tr.length, 2); assert.match(tr[0].content, /"verdict":"ok"/); assert.match(tr[1].content, /not run/);
    return { content: [{ type: 'text', text: 'Base is reachable.' }], usage: { input_tokens: 20, output_tokens: 6 } };
  } };
  const fetch = async (url) => { calls.push(url); return url.endsWith('/v1/rpc/8453') ? res(200, { ok: true, name: 'Base', best: 'https://mainnet.base.org', call: [{ status: 'healthy', health_score: 0.9 }], logs: [{}] }) : res(200, { chains: [{ chain_id: 8453, status: 'collecting', latest_block: 1, last_header_age_secs: 3, network_name: 'Base' }] }); };
  const rows = await rowsFor(CAPABILITIES, 'member');
  const call = toolCaller({ rows, runRow, deps: { base: 'https://x', fetch, runners: RUNNERS } });
  const events = [];
  const r = await runAgent({ provider, system: systemPrompt({ who: { role: 'member' } }), tools: toolDefs(rows), call, messages: [{ role: 'user', content: 'is base up' }], onEvent: (e) => events.push(e.type) });
  assert.equal(r.text, 'Base is reachable.'); assert.equal(r.turns, 2); assert.equal(r.usage.length, 2);
  assert.deepEqual(calls, ['https://x/v1/rpc/8453', 'https://x/v1/root/chains']);
  assert.ok(events.includes('tool') && events.includes('tool_result') && events.includes('text'));
});

test('the loop stops at maxTurns and reports a model failure as an answer, never a throw', async () => {
  const always = { name: 'f', model: 'f', complete: async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'docs_list', input: {} }] }) };
  const r = await runAgent({ provider: always, system: '', tools: [], call: async () => ({ ok: true }), messages: [], maxTurns: 3 });
  assert.equal(r.turns, 3); assert.match(r.text, /stopped after 3 turns/);
  const broken = { name: 'f', model: 'f', complete: async () => { throw new Error('boom'); } };
  const b = await runAgent({ provider: broken, system: '', tools: [], call: async () => ({}), messages: [] });
  assert.equal(b.error, true); assert.match(b.text, /boom/);
  assert.match(clip('x'.repeat(13_000)), /more characters/);
});

test('providers: Anthropic gets the Messages API shape; our lane gets one prompt and its JSON reply becomes a tool call or an answer', async () => {
  let body; let hdr;
  const a = anthropic({ apiKey: 'sk-ant-' + 'k'.repeat(30), fetch: async (url, init) => { body = JSON.parse(init.body); hdr = init.headers; assert.equal(url, 'https://api.anthropic.com/v1/messages'); return res(200, { content: [{ type: 'text', text: 'hi' }], model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } }); } });
  const out = await a.complete({ system: 's', tools: [{ name: 'docs_list', description: 'd', input_schema: { type: 'object', properties: {} } }], messages: [{ role: 'user', content: 'q' }] });
  assert.equal(body.model, 'claude-opus-5-5'); assert.equal(hdr['anthropic-version'], '2023-06-01'); assert.equal(out.content[0].text, 'hi');
  const replies = ['Sure. {"tool": "debug_rpc", "input": {"chain": "1"}}', '{"answer": "done"}']; let sent;
  const t = taifoon({ key: KEY, fetch: async (url, init) => { sent = { url, body: JSON.parse(init.body), key: init.headers['x-api-key'] }; return res(200, { response: replies.shift() }); } });
  const tools = [{ name: 'debug_rpc', description: 'd', input_schema: { type: 'object', properties: { chain: {} }, required: ['chain'] } }];
  const t1 = await t.complete({ system: 'S', tools, messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }] });
  assert.equal(sent.url, 'https://api.taifoon.dev/gpu/nemotron/chat'); assert.equal(sent.key, KEY); assert.match(sent.body.prompt, /TOOLS:\n- debug_rpc/);
  assert.equal(t1.content[0].type, 'tool_use'); assert.deepEqual(t1.content[0].input, { chain: '1' });
  const t2 = await t.complete({ system: 'S', tools, messages: [] }); assert.equal(t2.content[0].text, 'done');
  assert.match(renderPrompt({ system: 's', tools: [], messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'x', input: { a: 1 } }] }] }), /ASSISTANT CALLED x/);
  assert.throws(() => taifoon({}), /metered to your key/);
});

test('debuggers: verdicts from reads; a stale header fails; a missing hosting op is unknown, not a guess', async () => {
  const get = (map) => async (p) => { const v = map[p.split('?')[0]]; return v ? { status: 200, ok: true, json: v } : { status: 404, ok: false, json: { ok: false, error: 'not found' } }; };
  const stale = await debugRpc({ chain: '10' }, { get: get({ '/v1/rpc/10': { ok: true, name: 'OP', call: [{ status: 'healthy' }], logs: [] }, '/v1/root/chains': { chains: [{ chain_id: 10, status: 'collecting', last_header_age_secs: 1200, latest_block: 5 }] } }) });
  assert.equal(stale.verdict, 'fail'); assert.ok(stale.findings.some((x) => /getLogs/.test(x.text)));
  const env = await debugEnvelope({ id: '0x' + 'ab'.repeat(32) }, { get: get({ ['/v1/pipe/status/0x' + 'ab'.repeat(32)]: { attempts: 3, carrier: 'http', envelope: { kind: 'settle' }, history: [{ state: 'retried', reason: 'http 500' }, { state: 'dropped' }], deadline: 1 } }) });
  assert.equal(env.verdict, 'fail'); assert.ok(env.findings.some((x) => /http 500/.test(x.text)));
  const none = await debugResource({ id: 'solver-1' }, { get: get({}) });
  assert.equal(none.verdict, 'unknown');
  assert.equal((await debugRpc({ chain: 'base' }, { get: get({}) })).ok, false);
});

test('knowledge: the release ships the language, the blocks and the skills; search finds; a topic is jailed to the index', async () => {
  const l = await knowledgeList();
  assert.ok(l.topics.some((t) => t.topic === 'language') && l.topics.some((t) => t.kind === 'skill'));
  assert.ok(!l.topics.some((t) => t.kind === 'operator-skill'), 'operator skills only for an admin');
  const s = await knowledgeSearch({ query: 'stream envelope outlet' });
  assert.ok(s.results.length > 0);
  assert.equal((await knowledgeGet({ topic: '../../../etc/passwd' })).ok, false);
  assert.match((await knowledgeGet({ topic: 'language' })).text, /Every envelope is a transition/);
});

test('the language’s golden set passes on the shipped knowledge, and a wrong workflow is refused with its reason', async () => {
  for (const g of await goldenSet()) assert.equal(g.got, g.want, `${g.id}: ${g.why?.join('; ')}`);
  const w = await workflowCheck({ steps: 'coord-send:coordination.transitions.v1/fund_offer@hook,coord-send:coordination.transitions.v1/complete@hook', grant: 'devnet', outlet: 'devnet' });
  assert.equal(w.valid, false); assert.match(w.why[0], /does not lead to/);
  const gen = JSON.parse(readFileSync(new URL('../knowledge/coord-lang/GENERATED.json', import.meta.url), 'utf8'));
  assert.equal(gen.source, 'taifoon-io/coord'); assert.ok(gen.rows.some((r) => r.id === 'cli-knowledge'));
});

test('help: the admin verb is shown only on a machine that holds an operator token; help <topic> reads the knowledge', async () => {
  const home = mkdtempSync(join(tmpdir(), 'taifoon-op-'));
  const a = sinkOut(); await main(['help'], { out: a.w, env: { TAIFOON_HOME: home } });
  assert.doesNotMatch(a.text(), /^\s+admin — /m);
  const b = sinkOut(); await main(['help'], { out: b.w, env: { TAIFOON_HOME: home, TAIFOON_OPERATOR_TOKEN: 'o'.repeat(32) } });
  assert.match(b.text(), /admin — the coord operator verbs/);
  const c = sinkOut(); const code = await main(['help', 'outlets', 'for', 'writes'], { out: c.w, env: { TAIFOON_HOME: home } });
  assert.equal(code, 0); assert.match(c.text(), /taifoon docs get <topic>/);
  const d = sinkOut(); const e = sinkOut();
  assert.equal(await main(['admin', 'release'], { out: d.w, err: e.w, env: { TAIFOON_HOME: home } }), 3);
});

test('taifoon ask --json: the role, the provider, every tool call and the answer; the model call is logged locally', async () => {
  const home = mkdtempSync(join(tmpdir(), 'taifoon-ask-'));
  let n = 0;
  const provider = { name: 'fake', model: 'f', complete: async () => (++n === 1 ? { content: [{ type: 'tool_use', id: 'a', name: 'docs_search', input: { query: 'workflow outlet' } }], usage: { input_tokens: 3 } } : { content: [{ type: 'text', text: 'See the language.' }], usage: { input_tokens: 4 } }) };
  const o = sinkOut();
  const code = await main(['ask', 'how', 'do', 'outlets', 'work', '--json'], { out: o.w, env: { TAIFOON_HOME: home }, provider, fetch: async () => res(404, {}) });
  assert.equal(code, 0);
  const j = JSON.parse(o.text().trim().split('\n').at(-1));
  assert.equal(j.role, 'public'); assert.equal(j.answer, 'See the language.'); assert.equal(j.turns, 2);
  assert.ok(existsSync(join(home, 'agent', 'usage.jsonl')));
});

test('roles with the language’s generated decision: a member owns its keys and resources, a delegate only what it was granted, the admin verb is the admin’s', async () => {
  useDecision(generatedRoles);
  try {
    const has = async (role, id, extra) => (await rowsFor(CAPABILITIES, extra ? { role, source: 'layer', ...extra } : role)).some((r) => r.id === id);
    assert.equal(await has('public', 'usage'), false);
    assert.equal(await has('public', 'debug.rpc'), true);
    assert.equal(await has('member', 'usage'), true);
    assert.equal(await has('member', 'resource.restart'), true);
    assert.equal(await has('viewer', 'resource.restart'), false);
    assert.equal(await has('viewer', 'resource.metrics'), true);
    assert.equal(await has('delegate', 'resource.restart', { delegated_actions: ['read'] }), false);
    assert.equal(await has('delegate', 'resource.restart', { delegated_actions: ['read', 'manage'] }), true);
    assert.equal(await has('member', 'admin'), false);
    assert.equal(await has('admin', 'admin'), true);
    assert.equal(await has('public', 'role'), true);
  } finally { useDecision(null); }
});
