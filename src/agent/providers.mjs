// _ONE_PRODUCT_v1_: the agent's model, behind one interface: complete({ system, tools, messages }) → { content, stop_reason, usage }.
// Pure (fetch only). Two providers:
//   anthropic  your own Anthropic API key (BYO): the Messages API with native tool use; default model claude-opus-5-5
//   taifoon    our metered lanes through the GPU gate (POST <gate>/<lane>/chat with your key, metered to it): the model answers one JSON
//              object per turn — {"tool": name, "input": {...}} or {"answer": "..."} — which is turned into the same content blocks
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_GATE = 'https://api.taifoon.dev/gpu';

export function anthropic({ apiKey, model = DEFAULT_MODEL, fetch: f = globalThis.fetch, maxTokens = 4096, timeoutMs = 120_000, base = 'https://api.anthropic.com' } = {}) {
  if (!apiKey) throw new Error('no Anthropic key: set ANTHROPIC_API_KEY or run taifoon model key');
  return {
    name: 'anthropic', model,
    async complete({ system, tools, messages }) {
      const r = await f(`${base}/v1/messages`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, tools, messages }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${j?.error?.message ?? 'no answer'}`);
      return { content: j.content ?? [], stop_reason: j.stop_reason, usage: { provider: 'anthropic', model: j.model ?? model, input_tokens: j.usage?.input_tokens ?? null, output_tokens: j.usage?.output_tokens ?? null } };
    },
  };
}

export const firstJson = (s) => {
  const t = String(s ?? ''); const i = t.indexOf('{'); if (i < 0) return null;
  let depth = 0; let q = false; let esc = false;
  for (let k = i; k < t.length; k++) {
    const c = t[k];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { try { return JSON.parse(t.slice(i, k + 1)); } catch { return null; } } }
  }
  return null;
};

/** render the transcript for a text-only model: the tools, then the turns, then the instruction */
export function renderPrompt({ system, tools, messages }) {
  const tl = tools.map((t) => `- ${t.name}: ${t.description} | args ${JSON.stringify(Object.keys(t.input_schema?.properties ?? {}))}${t.input_schema?.required?.length ? ` (required ${t.input_schema.required.join(', ')})` : ''}`).join('\n');
  const turns = messages.map((m) => {
    if (typeof m.content === 'string') return `${m.role.toUpperCase()}: ${m.content}`;
    return m.content.map((b) => b.type === 'text' ? `${m.role.toUpperCase()}: ${b.text}` : b.type === 'tool_use' ? `ASSISTANT CALLED ${b.name} ${JSON.stringify(b.input)}` : b.type === 'tool_result' ? `TOOL RESULT: ${typeof b.content === 'string' ? b.content : JSON.stringify(b.content)}` : '').join('\n');
  }).join('\n');
  return `${system}\n\nTOOLS:\n${tl}\n\nCONVERSATION:\n${turns}\n\nReply with exactly ONE JSON object and nothing else: {"tool": "<tool name>", "input": {…}} to call a tool, or {"answer": "<your answer to the person>"} when you are done.`;
}

/**
 * A model that only answers text, made into a provider: ask(prompt) → { text, usage? }. The prompt is renderPrompt's; the reply's first
 * JSON object is a tool call ({"tool", "input"}) when it names a tool, else the answer. Our lane, a local Claude Code and the online
 * studio's wizard lane are all this one adapter around their own ask().
 */
export function textProvider({ name, model, ask }) {
  let n = 0;
  return {
    name, model,
    async complete({ system, tools, messages }) {
      const { text, usage = {} } = await ask(renderPrompt({ system, tools, messages }));
      const o = firstJson(text);
      const u = { provider: name, model, chars_out: String(text ?? '').length, ...usage };
      if (o && typeof o.tool === 'string' && tools.some((t) => t.name === o.tool)) return { content: [{ type: 'tool_use', id: `tu_${Date.now()}_${n++}`, name: o.tool, input: o.input ?? {} }], stop_reason: 'tool_use', usage: u };
      return { content: [{ type: 'text', text: o && typeof o.answer === 'string' ? o.answer : String(text ?? '').trim() }], stop_reason: 'end_turn', usage: u };
    },
  };
}

export function taifoon({ key, lane = 'nemotron', gate = DEFAULT_GATE, fetch: f = globalThis.fetch, maxTokens = 1024, timeoutMs = 120_000 } = {}) {
  if (!key) throw new Error('our lanes are metered to your key: taifoon login (or pass --provider anthropic with your own key)');
  return textProvider({ name: 'taifoon', model: lane, ask: async (prompt) => {
    const r = await f(`${gate.replace(/\/$/, '')}/${lane}/chat`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'user-agent': 'taifoon-studio' },
      body: JSON.stringify({ prompt, max_tokens: maxTokens }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`the ${lane} lane answered ${r.status}${j?.error ? `: ${j.error}` : ''}`);
    return { text: j?.response ?? j?.text ?? '', usage: { metered_to_key: true } };
  } });
}

/** the configured provider: opts { provider, model, anthropicKey, key, gate, fetch } (the CLI resolves keys; nothing here reads a store) */
export function providerOf({ provider, model, anthropicKey, key, gate, lane, fetch: f } = {}) {
  const p = provider ?? (anthropicKey ? 'anthropic' : 'taifoon');
  if (p === 'anthropic') return anthropic({ apiKey: anthropicKey, model: model ?? DEFAULT_MODEL, fetch: f });
  if (p === 'taifoon') return taifoon({ key, lane: lane ?? model ?? 'nemotron', gate, fetch: f });
  throw new Error(`unknown provider ${p}: anthropic or taifoon`);
}
