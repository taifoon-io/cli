// taifoon model — the agent's model (_ONE_PRODUCT_v1_). The provider is yours to pick: `anthropic` (your own key; the model calls are
// billed to you by Anthropic, and logged locally) or `taifoon` (our metered lanes through the GPU gate, billed to your key in GRID).
// The Anthropic key lives in the Keychain (taifoon model key), never in the config file. `model local …` runs mamba, the local agent
// runtime (open-mamba), when it is installed — its daemon verbs stay mamba's own.
import { spawnSync } from 'node:child_process';
import { loadConfig, saveConfig, modelKeychain, defaultExec } from '../config.mjs';
import { modelSettings } from '../agent/session.mjs';
import { DEFAULT_MODEL } from '../agent/providers.mjs';

export default {
  name: 'model',
  summary: 'the agent’s model: show it, pick the provider (your Anthropic key or our metered lanes), store your key, run mamba locally',
  usage: [
    ['model [set anthropic|taifoon|claude-cli] [--model id]', `show or set the provider (default model ${DEFAULT_MODEL}; taifoon lanes: nemotron; claude-cli: your local Claude Code)`],
    ['model key', 'store your Anthropic API key in the Keychain (asked hidden, never printed)'],
    ['model local up|status|logs|down', 'mamba, the local agent runtime (open-mamba), when it is installed'],
  ],
  valued: ['model'],
  async run(ctx, rest) {
    const [sub, arg] = rest;
    if (sub === 'local') {
      const r = spawnSync('mamba', rest.slice(1).length ? rest.slice(1) : ['status'], { stdio: ctx.io.stdio ?? 'inherit', timeout: 10 * 60_000 });
      if (r.error) { ctx.fail('mamba is not installed (open-mamba: cargo install --path crates/mamba-cli)'); return 3; }
      return r.status ?? 1;
    }
    if (sub === 'key') {
      const k = await ctx.secret('Anthropic API key (sk-ant-…):');
      if (!k) { ctx.fail('no key read (a terminal is needed)'); return 2; }
      try { modelKeychain.set(ctx.exec ?? defaultExec, k.trim()); } catch (e) { ctx.fail(e.message); return 1; }
      ctx.line(`  ${ctx.p.live('✓')} stored in the Keychain (taifoon-model/anthropic)`); return 0;
    }
    if (sub === 'set') {
      if (!['anthropic', 'taifoon', 'claude-cli'].includes(arg)) { ctx.fail('usage: taifoon model set anthropic|taifoon|claude-cli [--model id]'); return 2; }
      const c = loadConfig(ctx.env); c.model = { ...(c.model ?? {}), provider: arg, ...(typeof ctx.f.model === 'string' ? { model: ctx.f.model } : {}) }; saveConfig(c, ctx.env);
      ctx.line(`  ${ctx.p.live('✓')} provider ${arg}${c.model.model ? ` · model ${c.model.model}` : ''}`); return 0;
    }
    const m = modelSettings(ctx);
    const v = { provider: m.provider, model: m.model ?? (m.provider === 'anthropic' ? DEFAULT_MODEL : 'nemotron'), anthropic_key: m.anthropicKey ? 'set' : 'none', metered: m.provider === 'taifoon' ? 'your key, in GRID (the GPU gate)' : m.provider === 'claude-cli' ? 'your own Claude plan (logged locally in ~/.taifoon/agent/usage.jsonl)' : 'by Anthropic, to your own key (logged locally in ~/.taifoon/agent/usage.jsonl)' };
    if (ctx.json) { ctx.emit(v); return 0; }
    for (const [k, x] of Object.entries(v)) ctx.line(`  ${ctx.p.faint(k.padEnd(14))} ${x}`);
    return 0;
  },
};
