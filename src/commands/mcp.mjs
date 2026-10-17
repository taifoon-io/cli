// taifoon mcp — the coordination layer as a local stdio MCP server, one tool per read, plan and handoff row of the capability table
// (src/capabilities.mjs) that the caller's role allows (src/roles.mjs: the layer's GET /v1/access/role, else what the caller holds).
// Claude Code: claude mcp add taifoon -- npx -y @taifoon/cli mcp
// Zed: "context_servers": { "taifoon": { "command": "npx", "args": ["-y", "@taifoon/cli", "mcp"] } }
import { serveStdio, toolsOf } from '../mcp.mjs';
import { CAPABILITIES } from '../capabilities.mjs';
import { operatorToken, resolveRole, rowsFor } from '../roles.mjs';
import { loadGeneratedDecision } from '../roles-generated.mjs';

export default {
  name: 'mcp',
  summary: 'the coordination layer as a local MCP server on stdio: the read and plan tools your role allows, the kms-access hand-off; nothing signs',
  usage: [['mcp [--tools]', 'serve MCP on stdin/stdout (TAIFOON_API_KEY in the environment for the tools that need a key); --tools lists them']],
  valued: [],
  async run(ctx) {
    const key = ctx.env.TAIFOON_API_KEY || null;
    const who = await resolveRole({ base: ctx.base, key, env: ctx.env, fetch: ctx.io.fetch ?? globalThis.fetch });
    await loadGeneratedDecision();
    const rows = await rowsFor(CAPABILITIES, who);
    if (ctx.f.tools === true && ctx.tty) {
      // _CLI_FINISH_v1_: the tool list as aligned rows on a terminal
      const tools = toolsOf(rows); const w = Math.min(34, Math.max(...tools.map((t) => t.name.length)));
      ctx.out.write(`${ctx.p.accent('──')} ${ctx.p.ink(`mcp · ${tools.length} tools for role ${who.role}`)} ${ctx.p.faint(`(${who.source})`)}\n`);
      for (const t of tools) ctx.out.write(`  ${ctx.p.ink(t.name.padEnd(w))}  ${ctx.p.faint(String(t.description ?? '').replace(/\s+/g, ' ').slice(0, Math.max(20, ctx.width - w - 6)))}\n`);
      ctx.out.write(`  ${ctx.p.faint('run the server: taifoon mcp · as JSON: taifoon mcp --tools --json')}\n`);
      return 0;
    }
    if (ctx.f.tools === true || ctx.json) { ctx.out.write(JSON.stringify({ role: who.role, role_source: who.source, tools: toolsOf(rows).map((t) => ({ name: t.name, description: t.description })) }, null, ctx.json ? 0 : 2) + '\n'); return 0; }
    return serveStdio({ input: ctx.io.stdin ?? process.stdin, output: ctx.out, version: ctx.version, rows,
      deps: { base: ctx.base, key, fetch: ctx.io.fetch ?? globalThis.fetch, version: ctx.version, role: who.role, env: operatorToken(ctx.env) ? ctx.env : {} } });
  },
};
