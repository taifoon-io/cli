// taifoon mcp — the coordination layer as a local stdio MCP server, generated from the capability table (src/capabilities.mjs):
// one tool per read, plan and handoff row, and no other tool. Rows that sign, send, spend or mint a key (kind act) are CLI-only:
// no tool of this server can reach a key it was not given, and none can sign.
//   read     GET (or the registry) on the coordination layer; sent with no key unless the row needs one
//   plan     the layer's UNSIGNED plan or quote, returned as it answered (no local re-encoding)
//   handoff  checks an unsigned plan and returns the kms-access command a human runs with an MFA session
// The key, when a row needs one, comes from TAIFOON_API_KEY in this server's environment; it is never echoed.
// Wire protocol: JSON-RPC 2.0, one message per line on stdin/stdout (the MCP stdio transport). No dependency.
import { readFileSync } from 'node:fs';
import { CAPABILITIES, BOTH, byMcp, inputSchemaOf } from './capabilities.mjs';
export { getterOf };
import { factsChain, factsContracts, factsSuperroot, poolFactories } from './facts.mjs';
import { proveSale, proveTx } from './prove.mjs';
import { handoff } from './handoff.mjs';
import { DEBUGGERS } from './debug.mjs';
import { knowledgeGet, knowledgeList, knowledgeSearch, workflowCheck } from './knowledge.mjs';
import { getterOf, runRow as runRowPure } from './run.mjs';

export const RUNNERS = Object.freeze({ factsChain, factsContracts, factsSuperroot, poolFactories, proveTx, proveSale, handoff, ...DEBUGGERS, knowledgeSearch, knowledgeGet, knowledgeList, workflowCheck });
export const PROTOCOL = '2025-06-18';
export const INSTRUCTIONS = 'Taifoon coordination layer. Read tools are keyless; plan tools return UNSIGNED plans or quotes; act_handoff returns the kms-access command a human runs with an MFA session. Nothing here signs or sends. Proven today means consistent with the superroot the producer served; no superroot anchor is posted on chain yet (facts_superroot).';

/** the MCP tool list: one per row with an `mcp` name (read, plan, handoff only) */
export function toolsOf(rows = CAPABILITIES) {
  return rows.filter((r) => r.mcp && BOTH.includes(r.kind)).map((r) => ({ name: r.mcp, description: `[${r.kind}] ${r.summary ?? r.id} (${r.op})`, inputSchema: inputSchemaOf(r) }));
}

/** a sale-run summary from an https URL, or (files: true, the CLI only) a local file; the MCP server never reads a local path a client names */
export function summaryFetcher(fetchImpl = globalThis.fetch, { files = true } = {}) {
  return async (src) => {
    if (!files && !/^https:\/\//.test(src)) throw new Error('the summary is an https URL here');
    if (/^https?:\/\//.test(src)) { const r = await fetchImpl(src, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
    return JSON.parse(readFileSync(src, 'utf8'));
  };
}

/** run one row with these arguments: the same call the CLI makes (src/run.mjs, with the CLI's runners and summary fetcher bound) */
export async function runRow(row, args = {}, deps = {}) {
  return runRowPure(row, args, { runners: RUNNERS, fetchSummary: summaryFetcher(deps.fetch, { files: deps.files === true }), ...deps });
}

/** tools/call: only a tool of the table; an act row (or anything else) is not a tool */
export async function callTool(name, args, deps, rows = null) {
  const row = byMcp(name);
  if (!row || !BOTH.includes(row.kind) || (rows && !rows.includes(row))) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `no tool ${name}: signing, sending and key actions are CLI-only (taifoon help)` }) }] };
  try { const out = await runRow(row, args ?? {}, deps); return { isError: out.ok === false, content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }; }
  catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(e?.message ?? e) }) }] }; }
}

/** one JSON-RPC message → the response (null for a notification) */
export function createServer({ deps = {}, version = '0', rows = null } = {}) {
  // rows: the capability rows this caller may use (src/roles.mjs rowsFor); null = the whole table
  const tools = toolsOf(rows ?? CAPABILITIES);
  return {
    tools,
    async handle(msg) {
      const { id, method, params } = msg ?? {};
      const reply = (result) => (id === undefined || id === null ? null : { jsonrpc: '2.0', id, result });
      const error = (code, message) => (id === undefined || id === null ? null : { jsonrpc: '2.0', id, error: { code, message } });
      if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion ?? PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'taifoon', version }, instructions: INSTRUCTIONS });
      if (method === 'notifications/initialized' || method?.startsWith?.('notifications/')) return null;
      if (method === 'ping') return reply({});
      if (method === 'tools/list') return reply({ tools });
      if (method === 'tools/call') return reply(await callTool(params?.name, params?.arguments, deps, rows));
      return error(-32601, `method not found: ${method}`);
    },
  };
}

/** serve on stdio until stdin ends; messages are answered one at a time, in the order they came */
export async function serveStdio({ input = process.stdin, output = process.stdout, deps = {}, version = '0', rows = null } = {}) {
  const s = createServer({ deps, version, rows });
  let buf = ''; let chain = Promise.resolve();
  const next = (line) => { chain = chain.then(() => onLine(line)).catch(() => {}); };
  const onLine = async (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
    const res = await s.handle(msg); if (res) output.write(JSON.stringify(res) + '\n');
  };
  await new Promise((resolve) => {
    input.setEncoding?.('utf8');
    input.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); next(line); } });
    input.on('end', resolve);
  });
  if (buf.trim()) next(buf);
  await chain;
  return 0;
}
