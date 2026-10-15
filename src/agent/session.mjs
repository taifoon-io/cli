// _ONE_PRODUCT_v1_: the agent session in the terminal — binds the pure core (core.mjs, providers.mjs) to this machine: who is calling
// (roles.mjs), the rows that role may use, the CLI's row runner, the grounding pack shipped with the release (knowledge.mjs), the model
// key (ANTHROPIC_API_KEY or the Keychain; or our metered lanes with your key), the confirmation of a proposed command (it runs through
// main(), never a shell), and a local log of every model call (~/.taifoon/agent/usage.jsonl; the /v1 calls themselves are metered by
// the layer to your key, and a call to our lanes by the GPU gate).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITIES } from '../capabilities.mjs';
import { runRow } from '../mcp.mjs';
import { resolveRole, rowsFor, operatorToken } from '../roles.mjs';
import { loadGeneratedDecision } from '../roles-generated.mjs';
import { homeDir, loadConfig, modelKeychain, defaultExec } from '../config.mjs';
import { runAgent, systemPrompt, toolCaller, toolDefs } from './core.mjs';
import { providerOf } from './providers.mjs';
import { claudeCli } from './providers-node.mjs';

const PKG = new URL('../..', import.meta.url).pathname;
const grounding = () => { const p = join(PKG, 'knowledge', 'coord-lang', 'llms-coord-language.txt'); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };

/** the model settings: flags, then env, then ~/.taifoon/config.json `model`; the Anthropic key from env or the Keychain */
export function modelSettings(ctx) {
  const cfg = loadConfig(ctx.env).model ?? {};
  const provider = (typeof ctx.f.provider === 'string' && ctx.f.provider) || ctx.env.TAIFOON_MODEL_PROVIDER || cfg.provider || null;
  const model = (typeof ctx.f.model === 'string' && ctx.f.model) || ctx.env.TAIFOON_MODEL || cfg.model || null;
  let anthropicKey = ctx.env.ANTHROPIC_API_KEY || null;
  if (!anthropicKey && provider !== 'taifoon') { try { anthropicKey = modelKeychain.get(ctx.exec ?? defaultExec); } catch { anthropicKey = null; } }
  return { provider: provider ?? (anthropicKey ? 'anthropic' : 'taifoon'), model, anthropicKey, gate: ctx.env.TAIFOON_GATE || cfg.gate || undefined, lane: cfg.lane };
}

/** a session: { who, rows, tools, ask(text) → result, reset() } */
export async function createSession(ctx, { readonly = Boolean(ctx.f.readonly), maxTurns = Number(ctx.f['max-turns']) || 12, onEvent = () => {}, confirmAndRun } = {}) {
  const key = ctx.key();
  const who = await resolveRole({ base: ctx.base, key, env: ctx.env, fetch: ctx.io.fetch ?? globalThis.fetch });
  await loadGeneratedDecision();
  const rows = await rowsFor(CAPABILITIES, who);
  const tools = toolDefs(rows, { readonly });
  const ms = modelSettings(ctx);
  const provider = ctx.io.provider ?? (ms.provider === 'claude-cli' ? claudeCli({ model: ms.model ?? undefined }) : providerOf({ ...ms, key, fetch: ctx.io.fetch ?? globalThis.fetch }));
  const admin = who.role === 'admin' && Boolean(operatorToken(ctx.env));
  const deps = { base: ctx.base, key, fetch: ctx.io.fetch ?? globalThis.fetch, version: ctx.version, role: admin ? 'admin' : who.role, env: admin ? ctx.env : {} };
  const call = toolCaller({ rows, runRow, deps, onPropose: async (input) => (confirmAndRun ? confirmAndRun(input) : { ok: true, proposed: input.command, note: 'shown to the person; not run' }) });
  const system = systemPrompt({ who, surface: 'terminal (taifoon CLI)', grounding: grounding() });
  let messages = [];
  const log = (row) => { try { const d = join(homeDir(ctx.env), 'agent'); mkdirSync(d, { recursive: true, mode: 0o700 }); appendFileSync(join(d, 'usage.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 }); } catch { /* a convenience */ } };
  return {
    who, rows, tools, provider: { name: provider.name, model: provider.model },
    reset() { messages = []; },
    async ask(text) {
      messages.push({ role: 'user', content: [{ type: 'text', text }] });
      const r = await runAgent({ provider, system, tools, call, messages, maxTurns, onEvent });
      messages = r.messages;
      log({ at: new Date().toISOString(), provider: provider.name, model: provider.model, role: who.role, key_prefix: key ? key.slice(0, 10) : null, turns: r.turns, usage: r.usage });
      return r;
    },
  };
}
