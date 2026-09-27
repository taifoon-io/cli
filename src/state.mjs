// ~/.taifoon/up/<chain>-<agentId>.json: the last StepResult per step, with the time it was read, and last.json naming
// the agent and step the last command ran. A ✓ counts as done for FRESH_MS on a re-run; ! and ✗ are always re-read.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const FRESH_MS = 10 * 60_000;

export function stateDir(env = process.env) {
  return join(env.TAIFOON_HOME || join(homedir(), '.taifoon'), 'up');
}
const fileFor = (dir, agent) => join(dir, `${agent.chain}-${agent.id}.json`);

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function writeJson(p, v) {
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 1) + '\n', { mode: 0o600 });
  renameSync(tmp, p);
}

export function openState(dir, agent) {
  const path = fileFor(dir, agent);
  const s = readJson(path);
  const state = s && s.agent === `${agent.chain}:${agent.id}` && typeof s.steps === 'object' ? s : { agent: `${agent.chain}:${agent.id}`, steps: {} };
  return {
    path, state,
    get: (step) => state.steps[step] ?? null,
    put(step, result, at) {
      state.steps[step] = { at, result };
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeJson(path, state);
      writeJson(join(dir, 'last.json'), { agent: state.agent, step, at });
    },
  };
}

export const readLast = (dir) => readJson(join(dir, 'last.json'));
export const exists = (dir, agent) => readJson(fileFor(dir, agent)) !== null;
