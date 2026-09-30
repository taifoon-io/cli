// taifoon login | logout | whoami — who this CLI is to /v1.
//   login                       paste your relayer key (hidden) → checked with GET /v1/relayer/whoami → stored in the macOS Keychain
//   login --key-stdin           the key from stdin (a pipe), same checks
//   login --from-keychain <service>[:<account>]   adopt a key already in the Keychain (read, checked, re-stored under taifoon-cli)
//   login --from-ssm <project>/<name>             read it through kms-access SSM (MFA session), keep it there (--store ssm)
//   login --store ssm:<project>/<name>            keep the key in kms-access SSM instead of the Keychain
//   login --guest               no key: the visitor budget (per IP, small), for reads and the public-by-design writes
//   login --free 0x…            _FREE_KEY_v1_: get a free key (POST /v1/register, nothing signed, no payment) for that wallet label;
//                               checked and stored like any key. Where every visitor 429 points (get_key.cli)
//   login --owner 0x…           the wallet you own agents with (EIP-191). The CLI never holds its key: it prints the exact
//                               message to sign in your own wallet or hardware wallet (cast wallet sign --ledger), and you pass
//                               the signature back with --signature.
// Never in a plain file: config.json holds where the key is, its prefix and label; the key stays in the store.
import { clip, panel, pill } from '../brand.mjs';
import { KEYCHAIN_SERVICE, isKey, keychain, loadConfig, prefixOf, saveConfig, ssm, storeText } from '../config.mjs';

async function readStdin(input) {
  if (!input || input.isTTY) return null;
  let s = ''; for await (const c of input) s += c; return s.trim().split('\n')[0]?.trim() ?? null;
}

async function login(ctx) {
  const { p, f } = ctx;
  const cfg = loadConfig(ctx.env);
  const name = ctx.profile;
  const prev = cfg.profiles[name] ?? {};
  const layer = f.layer ? String(f.layer) : prev.layer;
  if (f.owner !== undefined && f.owner !== true && !/^0x[0-9a-fA-F]{40}$/.test(String(f.owner))) { ctx.fail('--owner takes the 0x… address of the wallet that owns your agents'); return 2; }
  const owner = f.owner ? String(f.owner).toLowerCase() : prev.owner;
  if (f.guest) {
    cfg.profiles[name] = { mode: 'guest', ...(layer ? { layer } : {}), ...(owner ? { owner } : {}) };
    cfg.profile = cfg.profile ?? name; saveConfig(cfg, ctx.env);
    if (ctx.json) { ctx.emit({ ok: true, profile: name, mode: 'guest' }); return 0; }
    ctx.line(`  ${p.part('guest')} ${p.faint('· no key: the visitor budget per IP (handshakes 5/min 40/day, probes 4/min 40/day, registrations 5/min 30/day; gateway 60/min 2,000/day). Reads are open.')}`);
    return 0;
  }
  if (f.owner && !f['key-stdin'] && !f['from-keychain'] && !f['from-ssm'] && !f.key && prev.mode) {
    cfg.profiles[name] = { ...prev, owner }; saveConfig(cfg, ctx.env);
    if (ctx.json) { ctx.emit({ ok: true, profile: name, owner }); return 0; }
    ctx.line(`  ${p.you('owner')} ${p.ink(owner)} ${p.faint('· signatures are yours: the CLI prints the message, your wallet signs it')}`);
    return 0;
  }
  // 1 get the key without printing it
  let key = null; let source = null;
  try {
    if (f.free !== undefined) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(f.free))) { ctx.fail('--free takes the 0x… wallet address the free key is for (a label; nothing is signed)'); return 2; }
      const r = await ctx.call('/v1/register', { method: 'POST', body: { wallet_address: String(f.free) }, key: false });
      if (!r.ok || typeof r.json?.api_key !== 'string') { ctx.fail(`no free key (${r.status ?? r.error}): ${r.json?.error ?? r.error ?? 'no answer'}${r.json?.retry_after_seconds ? `; retry in ${r.json.retry_after_seconds} s` : ''}. Nothing stored.`); return 1; }
      key = r.json.api_key; source = 'free';
    }
    else if (typeof f.key === 'string') { key = f.key; source = 'flag'; }
    else if (f['key-stdin']) { key = await readStdin(ctx.io.stdin ?? process.stdin); source = 'stdin'; }
    else if (f['from-keychain']) { const [svc, acct] = String(f['from-keychain']).split(':'); key = keychain.get(ctx.exec, svc, acct ?? ctx.env.USER ?? 'default') ?? keychain.get(ctx.exec, svc, svc); source = `keychain ${svc}`; }
    else if (f['from-ssm']) { const [pr, nm] = String(f['from-ssm']).split('/'); key = ssm.get(ctx.exec, pr, nm); source = `ssm ${pr}/${nm}`; }
    else { key = await ctx.secret('relayer key (tfr_…, hidden):'); source = 'prompt'; }
  } catch (e) { ctx.fail(e.message); return e.code === 'MFA' ? 3 : 1; }
  if (!isKey(key)) { ctx.fail(key === null ? 'no key read (pipe it with --key-stdin, or --guest)' : 'that is not a relayer key (tfr_…); nothing stored'); return 2; }
  // 2 check it with the layer (no side effects, no quota)
  const w = await ctx.call('/v1/relayer/whoami', { method: 'GET', headers: { 'x-api-key': key }, key: false });
  if (!w.ok) { ctx.fail(`the layer refused that key (${w.status}): ${w.json?.error ?? w.error}. Nothing stored.`); return 1; }
  // 3 store it
  let store;
  const ssmTarget = f.store && String(f.store).startsWith('ssm:') ? String(f.store).slice(4) : f['from-ssm'] ? String(f['from-ssm']) : null;
  try {
    if (ssmTarget) { const [pr, nm] = ssmTarget.split('/'); if (source !== `ssm ${pr}/${nm}`) ssm.set(ctx.exec, pr, nm, key); store = { store: 'ssm', ssm: { project: pr, name: nm } }; }
    else { keychain.set(ctx.exec, KEYCHAIN_SERVICE, name, key); store = { store: 'keychain', keychain: { service: KEYCHAIN_SERVICE, account: name } }; }
  } catch (e) { ctx.fail(`${e.message}. Nothing stored.`); return e.code === 'MFA' ? 3 : 1; }
  cfg.profiles[name] = { mode: 'key', ...store, key_prefix: w.json.key_prefix ?? prefixOf(key), label: w.json.label, kind: w.json.kind ?? null, per_minute: w.json.per_minute, ...(layer ? { layer } : {}), ...(owner ? { owner } : {}), since: new Date().toISOString() };
  cfg.profile = cfg.profile ?? name;
  saveConfig(cfg, ctx.env);
  key = null;
  const prof = cfg.profiles[name];
  if (ctx.json) { ctx.emit({ ok: true, profile: name, mode: 'key', key_prefix: prof.key_prefix, label: prof.label, kind: prof.kind, store: storeText(prof) }); return 0; }
  ctx.line(panel(p, `logged in · profile ${name}`, [
    `${p.faint('key      ')} ${p.accent(prof.key_prefix)} ${p.faint(`· ${clip(prof.label ?? '', 40)}`)}`,
    `${p.faint('kind     ')} ${pill(p, prof.kind ?? 'owner')}   ${p.faint('rate')} ${p.ink(`${prof.per_minute}/min`)}`,
    `${p.faint('stored in')} ${p.ink(storeText(prof))} ${p.faint('(never a file)')}`,
    owner ? `${p.faint('owner    ')} ${p.you(owner)}` : `${p.faint('owner    ')} ${p.faint('none: taifoon login --owner 0x… for owner-signed steps')}`,
  ]));
  return 0;
}

function logout(ctx) {
  const cfg = loadConfig(ctx.env); const name = ctx.profile; const prof = cfg.profiles[name];
  let deleted = false;
  if (prof?.store === 'keychain') deleted = keychain.del(ctx.exec, prof.keychain.service, prof.keychain.account);
  cfg.profiles[name] = { mode: 'guest', ...(prof?.layer ? { layer: prof.layer } : {}) };
  saveConfig(cfg, ctx.env);
  if (ctx.json) { ctx.emit({ ok: true, profile: name, keychain_deleted: deleted, ssm_kept: prof?.store === 'ssm' }); return 0; }
  ctx.line(`  ${ctx.p.faint(`profile ${name} is a guest now${deleted ? '; the Keychain entry was deleted' : ''}${prof?.store === 'ssm' ? '; the SSM secret was left in place (kms-access owns it)' : ''}`)}`);
  return 0;
}

async function whoami(ctx) {
  const { p } = ctx;
  const k = ctx.keyInfo();
  const w = k.prefix ? await ctx.get('/v1/relayer/whoami') : null;
  const res = { ok: true, profile: ctx.profile, mode: k.prefix ? 'key' : 'guest', source: k.source, key_prefix: k.prefix, label: w?.json?.label ?? null, kind: w?.json?.kind ?? null, collab: w?.json?.collab ?? null, per_minute: w?.json?.per_minute ?? null, valid: w ? w.ok : null, owner: ctx.prof.owner ?? null, layer: ctx.base, store: storeText(ctx.prof), error: k.error };
  if (ctx.json) { ctx.emit(res); return 0; }
  ctx.line(panel(p, `whoami · profile ${ctx.profile}`, [
    `${p.faint('layer    ')} ${p.ink(ctx.base)}`,
    `${p.faint('session  ')} ${res.mode === 'key' ? `${p.accent(res.key_prefix)} ${res.valid ? p.live('valid') : p.miss(`refused ${w?.status}`)} ${p.faint(clip(res.label ?? '', 30))}` : p.part('guest · visitor budget')}`,
    res.collab ? `${p.faint('member of')} ${p.accent(res.collab.project)} ${p.faint(`${res.collab.scope} · ${res.collab.per_day}/day`)}` : null,
    `${p.faint('key from ')} ${p.ink(res.source === 'guest' ? 'nowhere (guest)' : res.source)} ${p.faint(`· profile store: ${res.store}`)}`,
    `${p.faint('owner    ')} ${res.owner ? p.you(res.owner) : p.faint('none')}`,
    k.error ? p.miss(k.error) : null,
  ].filter(Boolean)));
  return 0;
}

export const loginCmd = {
  name: 'login',
  summary: 'store your /v1 relayer key in the Keychain or kms-access SSM (never a file), or be a guest; set your owner wallet',
  usage: [
    ['login', 'paste your relayer key (hidden), checked with /v1/relayer/whoami, stored in the macOS Keychain'],
    ['login --key-stdin | --from-keychain <svc[:acct]> | --from-ssm <project/name>', 'other ways in; --store ssm:<project/name> keeps it in SSM'],
    ['login --guest', 'no key: the visitor budget'],
    ['login --free 0x…', 'get a free key (POST /v1/register: no payment, nothing signed) and store it: its own budget on demands and the gateways'],
    ['login --owner 0x…', 'the wallet you sign owner steps with (the CLI prints the message; it never holds the key)'],
  ],
  valued: ['from-keychain', 'from-ssm', 'store', 'owner', 'free'],
  run: (ctx) => login(ctx),
};
export const logoutCmd = { name: 'logout', summary: 'forget this profile’s key (Keychain entry deleted)', usage: [['logout', 'back to guest']], run: (ctx) => logout(ctx) };
export const whoamiCmd = { name: 'whoami', summary: 'the session: layer, key prefix, validity, owner', usage: [['whoami', 'GET /v1/relayer/whoami with your key']], run: (ctx) => whoami(ctx) };
export default loginCmd;
