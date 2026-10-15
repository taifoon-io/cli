// _ONE_PRODUCT_v1_: the terminal-only provider — `claude-cli`, your local Claude Code (`claude -p`), the way open-mamba's agent loop
// calls it (crates/mamba-agent-loop/src/backends/claude_cli.rs): one prompt per turn, JSON output, every built-in tool of Claude Code
// disallowed (the only tools are the layer's, through our JSON tool protocol), the API-key env vars removed so your login is used, a
// per-step timeout. Billed by your own Claude plan; logged locally like every model call. Node only (spawns a process).
import { spawn } from 'node:child_process';
import { textProvider } from './providers.mjs';

const DISALLOWED = 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit,TodoWrite';

export function claudeCli({ bin = 'claude', model = 'claude-opus-5-5', timeoutMs = 300_000, run } = {}) {
  const exec = run ?? ((args) => new Promise((resolve) => {
    const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
    const p = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; const t = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: 127, out, err: String(e.message) }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  }));
  return textProvider({ name: 'claude-cli', model, ask: async (prompt) => {
    const r = await exec(['-p', prompt, '--output-format', 'json', '--max-turns', '1', '--model', model, '--disallowedTools', DISALLOWED]);
    if (r.code !== 0) throw new Error(`claude -p exited ${r.code}: ${String(r.err || r.out).trim().slice(0, 200)}`);
    let env = null; try { env = JSON.parse(r.out.trim()); } catch { env = null; }
    return { text: env?.result ?? r.out, usage: { input_tokens: env?.usage?.input_tokens ?? null, output_tokens: env?.usage?.output_tokens ?? null, cost_usd: env?.total_cost_usd ?? null } };
  } });
}
