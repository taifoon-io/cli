// The command table. Every module in this directory that exports command objects ({ name, summary, usage, run }) is picked up,
// so a new command is one new file here and nothing else changes (the shell's completion and `taifoon help` read this table).
// status.mjs is wired by main.mjs (bare → dashboard, with an agent → the up walk's marks).
import { readdirSync } from 'node:fs';

const SKIP = new Set(['index.mjs', 'status.mjs']);
let table = null;

/** name → command, loaded once. */
export async function commands() {
  if (table) return table;
  const t = new Map();
  const dir = new URL('./', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs') && !SKIP.has(x)).sort()) {
    const mod = await import(new URL(f, dir).href);
    for (const v of new Set(Object.values(mod))) {
      if (v && typeof v === 'object' && typeof v.name === 'string' && typeof v.run === 'function' && !t.has(v.name)) t.set(v.name, v);
    }
  }
  table = t;
  return t;
}
