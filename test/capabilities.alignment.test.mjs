// _CAPABILITIES_v1_: the CLI and the MCP server are two doors over ONE table (src/capabilities.mjs). This test fails when they drift:
// a CLI usage line no row names, a row no CLI verb serves, an MCP tool that is not a read / plan / handoff row of the table, an act
// row that reached MCP, or the two doors making a different call for the same row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CAPABILITIES, KINDS, BOTH, CLI_ONLY, WIRED_BY_MAIN, rowOfUsage, requestOf } from '../src/capabilities.mjs';
import { commands } from '../src/commands/index.mjs';
import { RUNNERS, createServer, serveStdio, toolsOf, callTool } from '../src/mcp.mjs';
import { main } from '../src/main.mjs';
import { sink } from './fixture-layer.mjs';

const verbOf = (cli) => cli.split(/\s+/)[0];

test('the table: ids unique, kinds known, read/plan/handoff rows have an MCP tool, act/local rows have none', () => {
  assert.equal(new Set(CAPABILITIES.map((r) => r.id)).size, CAPABILITIES.length, 'ids are unique');
  assert.equal(new Set(CAPABILITIES.map((r) => r.cli)).size, CAPABILITIES.length, 'cli verbs are unique');
  const tools = CAPABILITIES.filter((r) => r.mcp).map((r) => r.mcp);
  assert.equal(new Set(tools).size, tools.length, 'MCP names are unique');
  for (const r of CAPABILITIES) {
    assert.ok(KINDS.includes(r.kind), `${r.id}: kind ${r.kind}`);
    if (BOTH.includes(r.kind)) {
      assert.match(r.mcp ?? '', /^[a-zA-Z0-9_-]{1,64}$/, `${r.id}: a ${r.kind} row is an MCP tool (a name an MCP client accepts)`);
      assert.ok(r.http || r.run, `${r.id}: a ${r.kind} row names its op (http) or its function (run)`);
      if (r.run) assert.equal(typeof RUNNERS[r.run], 'function', `${r.id}: runner ${r.run}`);
      assert.ok(r.summary, `${r.id}: a summary`);
    }
    if (CLI_ONLY.includes(r.kind)) assert.equal(r.mcp, null, `${r.id}: a ${r.kind} row never reaches MCP`);
    if (r.kind === 'act') { assert.ok(['kms-access', 'keychain'].includes(r.via), `${r.id}: an act row names its door`); assert.ok(r.summary, `${r.id}: a summary`); }
    if (r.kind === 'local') assert.ok(r.why, `${r.id}: a local row says why it is not one /v1 op`);
    if (r.kind === 'plan' && r.http) assert.ok(r.http.method === 'POST' || /quote/.test(r.http.path), `${r.id}: a plan is a POST or a quote`);
  }
});

test('CLI → table: every usage line of every command belongs to exactly the row of its own verb', async () => {
  const t = await commands();
  for (const [name, c] of t) {
    for (const [u] of c.usage) {
      const row = rowOfUsage(u);
      assert.ok(row, `taifoon ${u}: no row of the capability table names it`);
      assert.equal(verbOf(row.cli), name, `taifoon ${u}: belongs to row ${row.id} of another verb`);
    }
  }
});

test('table → CLI: every row is served by a command (a module, the generic runner, or main itself)', async () => {
  const t = await commands();
  for (const r of CAPABILITIES) {
    const v = verbOf(r.cli);
    if (WIRED_BY_MAIN.includes(v)) { assert.ok(!t.has(v) || v === 'status', `${v} is wired by main.mjs`); continue; }
    const c = t.get(v); assert.ok(c, `${r.id}: no command ${v}`);
    assert.ok(c.usage.some(([u]) => rowOfUsage(u)?.id === r.id), `${r.id}: no usage line of taifoon ${v} is this row (${r.cli})`);
  }
});

test('table → MCP: tools/list is exactly the read, plan and handoff rows, each marked with its kind', async () => {
  const s = createServer({ version: 'test' });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = res.result.tools.map((x) => x.name).sort();
  assert.deepEqual(names, CAPABILITIES.filter((r) => BOTH.includes(r.kind)).map((r) => r.mcp).sort());
  for (const tool of res.result.tools) {
    const row = CAPABILITIES.find((r) => r.mcp === tool.name);
    assert.ok(tool.description.startsWith(`[${row.kind}]`), tool.name);
    assert.equal(tool.inputSchema.type, 'object'); assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(toolsOf().map((x) => x.name).sort(), names);
});

test('an act row is not a tool: tools/call refuses every one, and sends nothing', async () => {
  let fetched = 0; const deps = { fetch: async () => { fetched += 1; return new Response('{}'); }, key: 'tfr_' + 'A'.repeat(32) };
  for (const r of CAPABILITIES.filter((x) => CLI_ONLY.includes(x.kind))) {
    for (const name of [r.id, r.id.replace(/\./g, '_'), r.cli.replace(/\s+/g, '_')]) {
      const out = await callTool(name, {}, deps);
      assert.equal(out.isError, true, `${name} must not be callable over MCP`);
    }
  }
  assert.equal(fetched, 0);
});

/** one fake layer: records every request (url, method, headers) and answers ok */
function layer() {
  const seen = [];
  const fetch = async (url, init = {}) => { seen.push({ url, method: init.method ?? 'GET', key: init.headers?.['x-api-key'] ?? null, body: init.body ? JSON.parse(init.body) : undefined }); return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 }); };
  return { fetch, seen };
}

test('both doors make the same call for a row: the generic CLI verb and its MCP tool (agents search, jobs trail, settle plan)', async () => {
  const KEY = 'tfr_' + 'K'.repeat(32);
  for (const [argv, tool, args] of [
    [['agents', 'search', '--q', 'weather', '--chain', '8453'], 'agents_search', { q: 'weather', chain: '8453' }],
    [['jobs', 'trail', 'hs_123'], 'jobs_trail', { id: 'hs_123' }],
    [['settle', 'plan', '--chain_id', '36927', '--job', '{"id":"7"}'], 'settle_plan', { chain_id: '36927', job: { id: '7' } }],
  ]) {
    const a = layer(); const out = sink(); const err = sink();
    const code = await main([...argv, '--layer', 'https://coord.test', '--json'], { out, err, fetch: a.fetch, env: { TAIFOON_HOME: mkdtempSync(join(tmpdir(), 'taifoon-caps-')), TAIFOON_API_KEY: KEY }, exec: () => ({ status: 44, stdout: '', stderr: '' }) });
    assert.equal(code, 0, `${argv.join(' ')}: ${err.text()}`);
    const b = layer();
    const res = await callTool(tool, args, { base: 'https://coord.test', key: KEY, fetch: b.fetch });
    assert.equal(res.isError, false, tool);
    assert.deepEqual(a.seen, b.seen, `${argv.join(' ')} and ${tool} differ`);
    const row = CAPABILITIES.find((r) => r.mcp === tool);
    assert.equal(Boolean(a.seen[0].key), Boolean(row.key || row.kind === 'plan'), `${tool}: the key is sent only where the row needs it`);
  }
});

test('a read that needs no key is sent with none, even when a key is at hand', async () => {
  const a = layer();
  await callTool('blocks_get', { chain: '8453', id: 'latest' }, { base: 'https://coord.test', key: 'tfr_' + 'K'.repeat(32), fetch: a.fetch });
  assert.deepEqual(a.seen, [{ url: 'https://coord.test/v1/chain/8453/block/latest', method: 'GET', key: null, body: undefined }]);
});

test('a row that needs a key refuses over MCP without one and sends nothing', async () => {
  const a = layer();
  const res = await callTool('settle_plan', { chain_id: '36927', job: {} }, { base: 'https://coord.test', key: null, fetch: a.fetch });
  assert.equal(res.isError, true); assert.match(res.content[0].text, /TAIFOON_API_KEY/); assert.equal(a.seen.length, 0);
});

test('prove_sale over MCP never reads a local file a client names', async () => {
  const res = await callTool('prove_sale', { sale_key: 'job:36927:42', summary: '/etc/hosts' }, { fetch: async () => { throw new Error('no network'); } });
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.state, 'not_found'); assert.match(out.why, /https URL/);
});

test('requestOf: path params in order, query in table order, missing params refused', () => {
  const row = CAPABILITIES.find((r) => r.id === 'blocks.proof');
  assert.deepEqual(requestOf(row, { chain: '1', block: '19000000' }), { ok: true, method: 'GET', path: '/v1/root/proof/1/19000000', body: undefined });
  assert.equal(requestOf(row, { chain: '1' }).ok, false);
});

test('stdio: initialize, tools/list and a handoff over the wire; notifications get no answer; nothing is spawned', async () => {
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'act_handoff', arguments: { plan: { to: '0x' + '1'.repeat(40), data: '0xabcd', value: '0', chainId: 36927 }, project: 'taifoon' } } },
    { jsonrpc: '2.0', id: 4, method: 'nope' },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const out = sink();
  await serveStdio({ input: Readable.from([lines]), output: out, deps: { fetch: async () => { throw new Error('no network in this test'); } }, version: 'test' });
  const res = out.text().trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(res.map((r) => r.id), [1, 2, 3, 4]);
  assert.equal(res[0].result.serverInfo.name, 'taifoon'); assert.ok(res[0].result.capabilities.tools);
  assert.ok(res[1].result.tools.some((x) => x.name === 'prove_tx'));
  const h = JSON.parse(res[2].result.content[0].text);
  assert.equal(h.executed, false); assert.match(h.command.join('\n'), /^kms-access whoami/); assert.match(h.command[1], /^kms-access send taifoon --chain 36927 /);
  assert.equal(res[3].error.code, -32601);
});
