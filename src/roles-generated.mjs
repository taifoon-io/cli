// The CLI's loader for the language's generated role decision (coord lang/cue/roles.cue → lang/gen/roles.mjs, written into
// src/generated/coord-lang/ by `coord gen`). Node only; roles.mjs stays pure for the online studio.
import { existsSync } from 'node:fs';
import { useDecision } from './roles.mjs';

let done = false;
export async function loadGeneratedDecision() {
  if (done) return; done = true;
  const u = new URL('./generated/coord-lang/roles.mjs', import.meta.url);
  if (!existsSync(u)) return;
  try { useDecision(await import(u.href)); } catch { /* the table stays */ }
}
