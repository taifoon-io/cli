// Where `taifoon` keeps what it knows between runs. Two places, never mixed:
//   ~/.taifoon/config.json  (0600) profiles: the layer URL, the mode (guest | key), WHERE the key lives, its prefix and label,
//                           an owner address. Never a key.
//   the key itself          the macOS Keychain (service taifoon-cli, account = profile) or kms-access SSM (<project> <name>),
//                           read when a command needs it and held in memory for that process only. TAIFOON_API_KEY in the
//                           environment wins for one run. A key is never written to a file, an argv or a log by this CLI:
//                           the Keychain write goes through `security -i` on stdin, the SSM write through kms-access's stdin.
// Collaborator keys the owner mints (taifoon collaborate invite) go to the Keychain under service taifoon-collab.
// ~/.taifoon/plans/<id>.json holds unsigned plans (calls a wallet would sign), for `taifoon status` and `pools sign`.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const KEYCHAIN_SERVICE = 'taifoon-cli';
export const COLLAB_SERVICE = 'taifoon-collab';
const KEY_RE = /^tfr_[A-Za-z0-9_-]{20,80}$/;
export const isKey = (k) => typeof k === 'string' && KEY_RE.test(k);
export const prefixOf = (k) => (isKey(k) ? k.slice(0, 10) : null);

export const homeDir = (env = process.env) => env.TAIFOON_HOME || join(homedir(), '.taifoon');
const cfgPath = (env) => join(homeDir(env), 'config.json');

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function writeJson(p, v) {
  mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 1) + '\n', { mode: 0o600 });
  renameSync(tmp, p);
  try { chmodSync(p, 0o600); } catch { /* best effort */ }
}

export function loadConfig(env = process.env) {
  const c = readJson(cfgPath(env));
  return c && typeof c === 'object' && c.profiles ? c : { profile: 'default', profiles: {} };
}
export function saveConfig(c, env = process.env) {
  // a guard, not a hope: nothing that looks like a key reaches the config file
  if (/tfr_[A-Za-z0-9_-]{20,}/.test(JSON.stringify(c))) throw new Error('refusing to write a key into the config file');
  writeJson(cfgPath(env), c);
}
export function profileOf(c, name) { return c.profiles[name ?? c.profile ?? 'default'] ?? { mode: 'guest' }; }

/** The default runner for the two secret stores: spawnSync with stdin, never a shell, never the value in argv. */
export function defaultExec(cmd, args, input) {
  const r = spawnSync(cmd, args, { input: input ?? undefined, encoding: 'utf8', timeout: 30_000 });
  return { status: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ── the macOS Keychain ──────────────────────────────────────────────────────────────────────────────────────────
export const keychain = {
  get(exec, service, account) {
    const r = exec('security', ['find-generic-password', '-s', service, '-a', account, '-w']);
    const v = r.status === 0 ? r.stdout.trim() : null;
    return isKey(v) ? v : null;
  },
  /** `security -i` reads its commands from stdin, so the key never appears in a process list */
  set(exec, service, account, key) {
    if (!isKey(key)) throw new Error('not a relayer key (tfr_…)');
    if (!/^[\w.:/@-]+$/.test(service + account)) throw new Error('bad keychain name');
    const r = exec('security', ['-i'], `add-generic-password -U -s ${service} -a ${account} -l "${service} ${account}" -w ${key}\n`);
    if (r.status !== 0) throw new Error(`the Keychain refused the write (${r.stderr.trim().split('\n')[0] || `exit ${r.status}`})`);
    return true;
  },
  del(exec, service, account) { return exec('security', ['delete-generic-password', '-s', service, '-a', account]).status === 0; },
};

// ── kms-access SSM ─────────────────────────────────────────────────────────────────────────────────────────────────
export const ssm = {
  get(exec, project, name) {
    const r = exec('kms-access', ['secret', 'get', project, name]);
    if (r.status === 3) throw Object.assign(new Error('kms-access needs an MFA session first (run ~/mfa.sh)'), { code: 'MFA' });
    const v = r.status === 0 ? r.stdout.trim() : null;
    return isKey(v) ? v : null;
  },
  set(exec, project, name, key) {
    if (!isKey(key)) throw new Error('not a relayer key (tfr_…)');
    const r = exec('kms-access', ['secret', 'put', project, name, '--overwrite', '--description', 'taifoon CLI relayer key'], key + '\n');
    if (r.status === 3) throw Object.assign(new Error('kms-access needs an MFA session first (run ~/mfa.sh)'), { code: 'MFA' });
    if (r.status !== 0) throw new Error(`kms-access refused the write (exit ${r.status})`);
    return true;
  },
};

/** Where a profile's key lives, in words (for status and whoami). */
export function storeText(prof) {
  if (prof.store === 'ssm') return `kms-access SSM ${prof.ssm?.project}/${prof.ssm?.name}`;
  if (prof.store === 'keychain') return `macOS Keychain ${prof.keychain?.service ?? KEYCHAIN_SERVICE}/${prof.keychain?.account}`;
  return 'none (guest)';
}

/** Resolve the key for a run: --key, then TAIFOON_API_KEY, then the profile's store. Returns { key, source } (key may be null). */
export function resolveKey({ flag, env, prof, exec }) {
  if (flag) return { key: flag, source: 'flag' };
  if (env.TAIFOON_API_KEY) return { key: env.TAIFOON_API_KEY, source: 'env' };
  if (!prof || prof.mode !== 'key') return { key: null, source: 'guest' };
  try {
    if (prof.store === 'keychain') return { key: keychain.get(exec, prof.keychain?.service ?? KEYCHAIN_SERVICE, prof.keychain?.account ?? 'default'), source: 'keychain' };
    if (prof.store === 'ssm') return { key: ssm.get(exec, prof.ssm.project, prof.ssm.name), source: 'ssm' };
  } catch (e) { return { key: null, source: prof.store, error: e.message }; }
  return { key: null, source: 'guest' };
}

// ── plans: unsigned calls, kept until signed or dropped ──────────────────────────────────────────────────────────────
const plansDir = (env) => join(homeDir(env), 'plans');
export function savePlan(env, plan) {
  const id = plan.id ?? `pl_${randomBytes(5).toString('hex')}`;
  const v = { ...plan, id, saved_at: new Date().toISOString(), signed: false };
  writeJson(join(plansDir(env), `${id}.json`), v);
  return v;
}
export function listPlans(env) {
  const d = plansDir(env);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => readJson(join(d, f))).filter(Boolean).sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
}
export const readPlan = (env, id) => readJson(join(plansDir(env), `${String(id).replace(/[^\w-]/g, '')}.json`));
export function markPlan(env, id, patch) { const p = readPlan(env, id); if (!p) return null; const v = { ...p, ...patch }; writeJson(join(plansDir(env), `${p.id}.json`), v); return v; }
export function dropPlan(env, id) { const f = join(plansDir(env), `${String(id).replace(/[^\w-]/g, '')}.json`); if (!existsSync(f)) return false; rmSync(f); return true; }
