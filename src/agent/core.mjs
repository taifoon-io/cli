// _ONE_PRODUCT_v1_: the agent session's core — pure (fetch only; no file system, no process), so the terminal (`taifoon`, `taifoon
// studio`, `taifoon ask`) and the online studio and cockpit (the website vendors src/agent/*.mjs, src/run.mjs, src/capabilities.mjs and
// src/debug.mjs byte-identical) run ONE implementation:
//   tools      one per capability row the caller's role allows (read, plan, handoff — the MCP rows), plus propose_command: the
//              agent never signs, sends or restarts; it proposes the `taifoon …` command and the person confirms it
//   loop       model → tool calls → results → model, until an answer (or maxTurns); every turn and tool call is an event
//   providers  your Anthropic key (Messages API, native tools) or our metered lanes (the GPU gate, a JSON tool protocol)
import { BOTH, inputSchemaOf } from '../capabilities.mjs';

export const PROPOSE = Object.freeze({
  name: 'propose_command',
  description: 'Propose ONE taifoon CLI command that changes something (start/stop/restart/redeploy a resource, claim a seat, post a demand, invite a collaborator, sign a plan). It is NOT run by you: the person sees it and confirms. Use it only when the person asked for that change.',
  input_schema: { type: 'object', properties: { command: { type: 'string', description: 'the full command, starting with "taifoon "' }, why: { type: 'string', description: 'one sentence: what it changes and why' } }, required: ['command', 'why'], additionalProperties: false },
});

/** the tools for these rows (already filtered by role); readonly drops plans and the proposal */
export function toolDefs(rows, { readonly = false } = {}) {
  const t = rows.filter((r) => r.mcp && BOTH.includes(r.kind) && (!readonly || r.kind !== 'plan'))
    .map((r) => ({ name: r.mcp, description: `[${r.kind}] ${r.summary ?? r.id} (${r.op})`, input_schema: inputSchemaOf(r) }));
  return readonly ? t : [...t, PROPOSE];
}

/** keep a tool result small enough for the model: JSON, cut at n characters with a note */
export function clip(v, n = 12_000) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)} … [${s.length - n} more characters; ask for a narrower read]` : s;
}

/** the system prompt: who is calling, what they may do, the rules, and the language's grounding pack */
export function systemPrompt({ who = {}, surface = 'terminal', grounding = '' } = {}) {
  const role = who.role ?? 'public';
  return [
    'You are the Taifoon studio agent: you operate the Taifoon coordination layer for the person in front of you, through tools that are the layer’s own /v1 operations.',
    `Surface: ${surface}. Caller role: ${role}${who.scopes?.length ? `; scopes ${who.scopes.join(', ')}` : ''}${who.outlets?.length ? `; write outlets ${who.outlets.join(', ')}` : ''}${who.owner_of?.length ? `; owns ${who.owner_of.slice(0, 12).join(', ')}` : ''}.`,
    'Rules:',
    '- Facts come only from tool results. Never invent an address, a transaction hash, a number or a status; quote them as the tools returned them, full length.',
    '- To change anything (start/stop/restart/redeploy, claims, demands, keys, signatures) call propose_command; the person confirms it. Nothing you do signs or sends; signatures go only through kms-access with the owner’s MFA.',
    '- To debug a connection, use the debug_* tools first (debug_rpc, debug_protocol, debug_order, debug_envelope, debug_project, debug_resource), then the specific reads.',
    '- For how-to questions, search the shipped knowledge (docs_search, docs_get) before answering. To check a workflow, call workflow_check.',
    '- Energy and money: access_usage gives the key’s GRID energy IN (reads, streams) and WRITE (sends), costs and earnings.',
    '- Be short: lead with the answer, then the evidence (which tool said so). Say plainly when a tool failed or a read is missing.',
    grounding ? `\nThe coord language (generated grounding pack):\n${grounding}` : '',
  ].join('\n');
}

/**
 * The loop. provider.complete({ system, tools, messages }) → { content: [blocks], stop_reason, usage }; call(name, input) → result.
 * messages use the Anthropic shape (role user/assistant, content blocks). Returns { messages, text, turns, usage[] }.
 */
export async function runAgent({ provider, system, tools, call, messages, maxTurns = 12, onEvent = () => {} }) {
  const msgs = [...messages]; const usage = []; let turns = 0;
  for (;;) {
    if (turns >= maxTurns) {
      // out of turns: one last call without tools, so the person gets an answer from what was read, not a silence
      onEvent({ type: 'stop', reason: `${maxTurns} turns used: answering from what was read` });
      try {
        const last = await provider.complete({ system, tools: [], messages: [...msgs, { role: 'user', content: [{ type: 'text', text: 'Answer now from the tool results above, in a few sentences; say what you could not check.' }] }] });
        if (last.usage) usage.push({ turn: turns + 1, ...last.usage });
        const text = last.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (text) { msgs.push({ role: 'assistant', content: [{ type: 'text', text }] }); return { messages: msgs, text, turns: turns + 1, usage, capped: true }; }
      } catch { /* fall through */ }
      return { messages: msgs, text: `(stopped after ${maxTurns} turns)`, turns, usage };
    }
    turns++;
    onEvent({ type: 'thinking', turn: turns });
    let res;
    try { res = await provider.complete({ system, tools, messages: msgs }); }
    catch (e) { onEvent({ type: 'error', error: String(e?.message ?? e) }); return { messages: msgs, text: `the model did not answer: ${e?.message ?? e}`, turns, usage, error: true }; }
    if (res.usage) usage.push({ turn: turns, ...res.usage });
    msgs.push({ role: 'assistant', content: res.content });
    for (const b of res.content) if (b.type === 'text' && b.text.trim()) onEvent({ type: 'text', text: b.text });
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) return { messages: msgs, text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), turns, usage };
    const results = [];
    for (const u of uses) {
      onEvent({ type: 'tool', name: u.name, input: u.input });
      let out; let isError = false;
      try { out = await call(u.name, u.input ?? {}); isError = out?.ok === false; } catch (e) { out = { ok: false, error: String(e?.message ?? e) }; isError = true; }
      onEvent({ type: 'tool_result', name: u.name, ok: !isError, result: out });
      results.push({ type: 'tool_result', tool_use_id: u.id, content: clip(out), ...(isError ? { is_error: true } : {}) });
    }
    msgs.push({ role: 'user', content: results });
  }
}

/** a tool caller over capability rows: runRow(row, args, deps) is src/run.mjs (or the CLI's bound runRow); onPropose handles the proposal */
export function toolCaller({ rows, runRow, deps, onPropose }) {
  const byName = new Map(rows.filter((r) => r.mcp).map((r) => [r.mcp, r]));
  return async (name, input) => {
    if (name === PROPOSE.name) return onPropose ? onPropose(input) : { ok: true, proposed: input.command, note: 'shown to the person; not run' };
    const row = byName.get(name);
    if (!row) return { ok: false, error: `no tool ${name} for this role` };
    return runRow(row, input, deps);
  };
}
