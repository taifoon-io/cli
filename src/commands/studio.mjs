// taifoon studio | taifoon ask "<question>" — the agent session (_ONE_PRODUCT_v1_): an LLM whose tools are the capability table
// filtered by your role (src/roles.mjs), plus propose_command. `studio` opens the shell with the agent on (a line that is not a command
// goes to the agent); `ask` is one question, printed with every tool call (--json: the whole transcript). The same core runs in the
// online studio and cockpit. --provider anthropic|taifoon, --model <id>, --readonly (reads only, no proposals), --max-turns n.
import { createSession } from '../agent/session.mjs';
import { rowOfUsage } from '../capabilities.mjs';
import { rowAllowed } from '../roles.mjs';

const NEVER = new Set(['studio', 'ask', 'admin', 'mcp', 'login', 'logout']);

/** print the session's events as they happen */
export function printer(ctx) {
  const { p } = ctx;
  return (e) => {
    if (ctx.json) return;
    if (e.type === 'tool') ctx.out.write(`  ${p.faint('●')} ${p.ink(e.name)} ${p.faint(JSON.stringify(e.input).slice(0, 160))}\n`);
    else if (e.type === 'tool_result') ctx.out.write(`  ${p.faint('⎿')} ${e.ok ? p.live('ok') : p.miss('failed')}${e.result?.verdict ? ` ${e.result.verdict}` : ''}${e.result?.status ? ` ${p.faint(String(e.result.status))}` : ''}\n`);
    else if (e.type === 'error') ctx.out.write(`  ${p.miss('✗')} ${e.error}\n`);
    else if (e.type === 'stop') ctx.out.write(`  ${p.faint(e.reason)}\n`);
  };
}

/** a proposed command: shown; on a TTY, run after y — through main(), never a shell; only verbs the caller's role may use */
export function confirmer(ctx) {
  return async ({ command, why }) => {
    const { tokenize } = await import('../shell.mjs');
    const words = tokenize(String(command ?? '').trim());
    if (words[0] !== 'taifoon' || words.length < 2) return { ok: false, error: 'a proposal is a taifoon command' };
    const argv = words.slice(1);
    if (NEVER.has(argv[0])) return { ok: false, error: `${argv[0]} is not proposed from inside the session` };
    const row = rowOfUsage(argv.filter((w) => !w.startsWith('--')).join(' '));
    if (row && ctx.session?.who && !(await rowAllowed(row, ctx.session.who.role))) return { ok: false, error: `your role (${ctx.session.who.role}) may not ${row.cli}` };
    ctx.out.write(`\n  ${ctx.p.you('proposed')} ${command}\n  ${ctx.p.faint(why ?? '')}\n`);
    const input = ctx.io.stdin ?? process.stdin;
    if (ctx.json || !input.isTTY) return { ok: true, ran: false, proposed: command, note: 'shown, not run (no terminal to confirm in)' };
    if (!(await ctx.confirm('run it?'))) return { ok: true, ran: false, proposed: command, note: 'the person declined' };
    const { main } = await import('../main.mjs');
    const code = await main(argv, { ...ctx.io, noShell: true });
    return { ok: code === 0, ran: true, exit: code };
  };
}

export const ask = {
  name: 'ask',
  summary: 'one question to the agent: it reads, measures and debugs through the layer’s own operations, and proposes any change for you to confirm',
  usage: [['ask "<question>" [--provider anthropic|taifoon|claude-cli] [--model id] [--readonly] [--max-turns n]', 'e.g. taifoon ask "why is my solver not filling"']],
  valued: ['provider', 'model', 'max-turns'],
  async run(ctx, rest) {
    const q = rest.join(' ').trim(); if (!q) { ctx.fail('usage: taifoon ask "<question>"'); return 2; }
    let s;
    try { s = await createSession(ctx, { onEvent: printer(ctx), confirmAndRun: confirmer(ctx) }); } catch (e) { ctx.fail(e.message); return 3; }
    ctx.session = s;
    if (!ctx.json) ctx.out.write(`  ${ctx.p.faint(`${s.provider.name} ${s.provider.model} · role ${s.who.role} · ${s.tools.length} tools`)}\n`);
    const r = await s.ask(q);
    if (ctx.json) { ctx.emit({ ok: !r.error, role: s.who.role, provider: s.provider, answer: r.text, turns: r.turns, usage: r.usage, transcript: r.messages }); return r.error ? 1 : 0; }
    ctx.out.write(`\n${r.text}\n`);
    return r.error ? 1 : 0;
  },
};

export const studio = {
  name: 'studio',
  summary: 'the agent session: the taifoon shell where a line that is not a command goes to the agent (the online studio runs the same)',
  usage: [['studio [--provider anthropic|taifoon|claude-cli] [--model id] [--readonly]', 'open the session; commands still work as commands; /reset forgets the conversation']],
  valued: ['provider', 'model', 'max-turns'],
  async run(ctx) {
    const { shell } = await import('../shell.mjs');
    const argv = ['--agent', ...(typeof ctx.f.provider === 'string' ? ['--provider', ctx.f.provider] : []), ...(typeof ctx.f.model === 'string' ? ['--model', ctx.f.model] : []), ...(ctx.f.readonly ? ['--readonly'] : [])];
    return shell(argv, ctx.io);
  },
};
