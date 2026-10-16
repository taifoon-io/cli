// taifoon keys — your key and your tenant's keys in one place (_KEYS_MENU_v1_). Every screen is an existing /v1 read or write:
//   keys                    on a terminal: a menu (standing · keys · create · scopes · roll · revoke · team · masters · seats);
//                           in a pipe: the standing and the keys, once
//   keys show               your key's standing: tier, plan, scopes, caps, balance, what it is entitled to (GET /v1/access/key)
//   keys ls                 every key of your tenant and the recent changes (GET /v1/tenant/keys)
//   keys create --label L [--scopes rpc,proofs,…] [--cap-day-grid n] [--cap-month-grid n]
//   keys update <prefix> [--label L] [--scopes …] [--cap-day-grid n] [--cap-month-grid n] [--per-minute n]
//   keys roll [<prefix>] [--grace-hours h]      a new key in its place (label, policy, balance and plan move to it)
//   keys revoke <prefix>                        the key stops at its next call
//   keys seats              your Jev seat (GET /v1/judge/keys) and the seats you master (GET /v1/owners)
// A key the layer returns (create, roll) goes straight into your macOS Keychain (service taifoon-cli, account key/<prefix>); it is
// never printed. Rolling the key this profile uses rewrites the profile's Keychain entry in place. Writes ask first (--yes in a pipe).
import { clip, kv, panel, pill, rule, table } from '../brand.mjs';
import { KEYCHAIN_SERVICE, isKey, keychain, loadConfig, prefixOf, saveConfig } from '../config.mjs';
import { entitlementOf } from '@taifoon/term/stream';

const SCOPES = ['rpc', 'proofs', 'events', 'coordination-read', 'coordination-write', 'grades'];
const list = (v) => (typeof v === 'string' && v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const num = (v) => (v === undefined || v === true ? undefined : Number(v));
const grid = (v) => (typeof v === 'number' ? `${v.toLocaleString('en-US')} GRID` : '—');
const usdc = (v) => (typeof v === 'number' ? `${v.toLocaleString('en-US', { maximumFractionDigits: 6 })} USDC` : '—');

function needKey(ctx) {
  if (ctx.key()) return true;
  const k = ctx.keyInfo();
  ctx.fail(k.error ? `no key: ${k.error}` : 'this needs your key: taifoon login (or taifoon login --free for a free one)');
  return false;
}

/** the standing screen (GET /v1/access/key) with the entitlement the stream view derives from it. Pure given the answer. */
export function standingLines(p, s) {
  const ent = entitlementOf({ keys: [{ tier: s.tier, key: s.key ?? {} }], grants: s.grants ?? [] });
  const perm = s.permissions ?? {}; const b = s.budgets ?? {}; const bal = s.balance ?? {};
  return [
    kv(p, [
      ['key', `${p.accent(s.key?.prefix ?? '?')} ${p.faint([s.key?.env, s.key?.label ? clip(s.key.label, 40) : null].filter(Boolean).join(' · '))}${s.key?.revoked ? ` ${pill(p, 'revoked')}` : ''}`],
      ['tier', `${pill(p, s.tier ?? '?')}${s.plan?.active ? ` ${p.ink(s.plan.name)} ${p.faint(`· ${s.plan.days_left} days left`)}` : ''}`],
      ['scopes', perm.all_scopes ? p.ink('all') : (perm.scopes ?? []).map((x) => p.ink(x)).join(p.faint(', ')) || p.faint('—')],
      ['caps', `${p.ink(grid(b.cap_day_grid))} ${p.faint('a day')} · ${p.ink(grid(b.cap_month_grid))} ${p.faint('a month')} · ${p.faint('used today')} ${p.ink(grid(b.metered_today_grid))}`],
      ['balance', `${p.ink(grid(bal.grid))} · ${p.ink(usdc(bal.usdc))}`],
      ['entitled', ent.entitled ? `${pill(p, 'yes')} ${p.faint(`${ent.via}: whole ids, the genome and sealed bodies with your HPKE key`)}` : `${pill(p, 'no')} ${p.faint(`${ent.via}: ids show as … · buy: ${ent.product.buy}`)}`],
      ['grants', ent.access.length ? ent.access.map((a) => p.accent(a)).join(p.faint(', ')) : p.faint('none (taifoon buy <access-id> opens one resource)')],
      perm.origins?.length ? ['origins', perm.origins.join(', ')] : null,
      perm.ips?.length ? ['ips', perm.ips.join(', ')] : null,
    ]),
  ];
}

async function show(ctx) {
  if (!needKey(ctx)) return 2;
  const r = await ctx.get('/v1/access/key');
  if (!r.ok) { ctx.fail(`access/key answered ${r.status}${r.json?.error ? `: ${r.json.error}` : ''}`); return 1; }
  if (ctx.json) { ctx.emit(r.json); return 0; }
  ctx.line(rule(ctx.p, 'your key'));
  ctx.line(standingLines(ctx.p, r.json).join('\n'));
  return 0;
}

async function ls(ctx) {
  if (!needKey(ctx)) return 2;
  const r = await ctx.get('/v1/tenant/keys');
  if (!r.ok) { ctx.fail(`tenant/keys answered ${r.status}${r.json?.error ? `: ${r.json.error}` : ''}`); return 1; }
  if (ctx.json) { ctx.emit(r.json); return 0; }
  const { p } = ctx; const mine = ctx.keyInfo().prefix;
  const keys = r.json.keys ?? [];
  ctx.line(rule(p, `your tenant's keys · ${keys.filter((k) => !k.revoked).length} active`));
  ctx.line(table(p, [
    { key: 'prefix', title: 'key', fmt: (v) => (v === mine ? p.accent(`${v} ◂ this one`) : p.accent(v)) },
    { key: 'label', title: 'label', flex: true, fmt: (v) => p.ink(clip(v ?? '', 40)) },
    { key: 'env', title: 'env' },
    { key: 'state', title: 'state', fmt: (_, k) => pill(p, k.revoked ? 'revoked' : k.expired ? 'expired' : 'live') },
    { key: 'created_at', title: 'created', fmt: (v) => p.faint(String(v ?? '').slice(0, 10)) },
  ], keys));
  const ch = (r.json.recent_changes ?? []).slice(0, 8);
  if (ch.length) { ctx.line(`\n${rule(p, 'recent changes')}`); for (const c of ch) ctx.line(`  ${p.faint(String(c.at ?? '').slice(0, 16).replace('T', ' '))}  ${pill(p, c.what)} ${p.accent(c.prefix ?? '')} ${p.faint(`by ${c.by ?? '?'} via ${c.via ?? '?'}${c.detail ? ` · ${clip(typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail), 60)}` : ''}`)}`); }
  return 0;
}

/** store a key the layer returned once; never printed. Rolling the profile's own key rewrites its entry. → where, or throws */
function storeKey(ctx, apiKey, { replacesProfile = false } = {}) {
  if (!isKey(apiKey)) throw new Error('the layer returned no key');
  if (replacesProfile && ctx.prof?.store === 'keychain') {
    keychain.set(ctx.exec, ctx.prof.keychain?.service ?? KEYCHAIN_SERVICE, ctx.prof.keychain?.account ?? 'default', apiKey);
    const cfg = loadConfig(ctx.env); const pr = cfg.profiles[ctx.profile]; if (pr) { pr.key_prefix = prefixOf(apiKey); saveConfig(cfg, ctx.env); }
    return `macOS Keychain ${ctx.prof.keychain?.service ?? KEYCHAIN_SERVICE}/${ctx.prof.keychain?.account ?? 'default'} (this profile now uses it)`;
  }
  const account = `key/${prefixOf(apiKey)}`;
  keychain.set(ctx.exec, KEYCHAIN_SERVICE, account, apiKey);
  return `macOS Keychain ${KEYCHAIN_SERVICE}/${account}`;
}

async function write(ctx, body, what) {
  if (!needKey(ctx)) return { code: 2 };
  if (!(await ctx.confirm(`${what}?`))) { ctx.line(`  ${ctx.p.faint('not sent (answer y, or pass --yes)')}`); return { code: 1 }; }
  const r = await ctx.post('/v1/tenant/keys', body);
  if (!r.ok) { ctx.fail(`${body.action} refused (${r.status}): ${r.json?.error ?? r.error ?? '?'}${r.json?.hint ? ` · ${r.json.hint}` : ''}`); if (ctx.json) ctx.emit({ ok: false, status: r.status, error: r.json?.error ?? null }); return { code: 1 }; }
  return { code: 0, json: r.json };
}

function policyBody(ctx) {
  const scopes = list(ctx.f.scopes);
  if (scopes) { const bad = scopes.filter((x) => !SCOPES.includes(x)); if (bad.length) throw new Error(`unknown scope ${bad.join(', ')} · scopes: ${SCOPES.join(', ')}`); }
  return Object.fromEntries(Object.entries({ label: typeof ctx.f.label === 'string' ? ctx.f.label : undefined, scopes, cap_day_grid: num(ctx.f['cap-day-grid']), cap_month_grid: num(ctx.f['cap-month-grid']), per_minute: num(ctx.f['per-minute']) }).filter(([, v]) => v !== undefined));
}

async function create(ctx) {
  let pol; try { pol = policyBody(ctx); } catch (e) { ctx.fail(e.message); return 2; }
  if (!pol.label) { ctx.fail(`usage: taifoon keys create --label <text> [--scopes ${SCOPES.join(',')}] [--cap-day-grid n] [--cap-month-grid n]`); return 2; }
  const w = await write(ctx, { action: 'create', ...pol }, `create a key "${pol.label}"${pol.scopes ? ` with ${pol.scopes.join(', ')}` : ''}`);
  if (w.code) return w.code;
  let where; try { where = storeKey(ctx, w.json.api_key); } catch (e) { ctx.fail(`the key was created (${w.json.key?.prefix ?? '?'}) but not stored: ${e.message}. Revoke it: taifoon keys revoke ${w.json.key?.prefix ?? '<prefix>'}`); return 1; }
  w.json.api_key = undefined;
  if (ctx.json) { ctx.emit({ ok: true, key: w.json.key, policy: w.json.policy, stored: where }); return 0; }
  ctx.line(panel(ctx.p, 'key created', [`${ctx.p.faint('key     ')} ${ctx.p.accent(w.json.key?.prefix ?? '?')} ${ctx.p.faint('never shown')}`, `${ctx.p.faint('stored  ')} ${ctx.p.ink(where)}`, ctx.p.faint('use it: taifoon login --keychain key/<prefix> · change it: taifoon keys update <prefix> --scopes …')]));
  return 0;
}

async function update(ctx, [prefix]) {
  if (!prefix) { ctx.fail('usage: taifoon keys update <prefix> [--label L] [--scopes a,b] [--cap-day-grid n] [--cap-month-grid n] [--per-minute n]'); return 2; }
  let pol; try { pol = policyBody(ctx); } catch (e) { ctx.fail(e.message); return 2; }
  if (!Object.keys(pol).length) { ctx.fail('nothing to change: --label, --scopes, --cap-day-grid, --cap-month-grid or --per-minute'); return 2; }
  const w = await write(ctx, { action: 'update', prefix, ...pol }, `change ${prefix}: ${Object.entries(pol).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(',') : v}`).join(' · ')}`);
  if (w.code) return w.code;
  if (ctx.json) { ctx.emit({ ok: true, key: w.json.key, policy: w.json.policy }); return 0; }
  ctx.line(`  ${pill(ctx.p, 'ok')} ${ctx.p.accent(prefix)} ${ctx.p.faint('changed · taifoon keys show reads the standing')}`);
  return 0;
}

async function roll(ctx, [prefix]) {
  const mine = ctx.keyInfo().prefix; const target = prefix ?? mine;
  const grace = num(ctx.f['grace-hours']);
  const w = await write(ctx, { action: 'roll', env: ctx.f.env === 'sandbox' ? 'sandbox' : 'live', ...(prefix ? { prefix } : {}), ...(grace !== undefined ? { grace_hours: grace } : {}) }, `roll ${target ?? 'this key'}${grace ? ` (the old key keeps working ${grace} h)` : ' (the old key stops now)'}`);
  if (w.code) return w.code;
  let where; try { where = storeKey(ctx, w.json.api_key, { replacesProfile: !prefix || prefix === mine }); } catch (e) { ctx.fail(`rolled, but the new key was not stored: ${e.message}`); return 1; }
  w.json.api_key = undefined;
  if (ctx.json) { ctx.emit({ ok: true, key: w.json.key ?? null, stored: where }); return 0; }
  ctx.line(panel(ctx.p, 'key rolled', [`${ctx.p.faint('new key ')} ${ctx.p.accent(w.json.key?.prefix ?? '?')} ${ctx.p.faint('never shown')}`, `${ctx.p.faint('stored  ')} ${ctx.p.ink(where)}`]));
  return 0;
}

async function revoke(ctx, [prefix]) {
  if (!prefix) { ctx.fail('usage: taifoon keys revoke <prefix>'); return 2; }
  const w = await write(ctx, { action: 'revoke', prefix }, `revoke ${prefix} (it stops at its next call)`);
  if (w.code) return w.code;
  if (ctx.json) { ctx.emit({ ok: true, keys: w.json.keys ?? null }); return 0; }
  ctx.line(`  ${pill(ctx.p, 'revoked')} ${ctx.p.accent(prefix)}`);
  return 0;
}

async function seats(ctx) {
  if (!needKey(ctx)) return 2;
  const [jev, own] = await Promise.all([ctx.get('/v1/judge/keys', { quiet: true }), ctx.call('/v1/owners', { key: false, quiet: true })]);
  const who = (await ctx.get('/v1/relayer/whoami', { quiet: true })).json ?? {};
  const holderIds = [who.tenant, who.owner, who.wallet, ctx.prof?.owner].filter(Boolean).map((x) => String(x).toLowerCase());
  const mineM = (own.json?.records ?? []).filter((r) => holderIds.includes(String(r.seat?.claimed_by ?? r.owner?.holder ?? '').toLowerCase()));
  if (ctx.json) { ctx.emit({ ok: true, jev_seat: jev.json ?? null, masters: mineM }); return 0; }
  const { p } = ctx;
  ctx.line(rule(p, 'your Jev seat'));
  const s = jev.json?.seat ?? jev.json?.session ?? null;
  ctx.line(s ? kv(p, [['state', pill(p, s.state ?? 'live')], ['evaluator', p.ink(s.evaluator ?? s.certified_by ?? '—')], ['expires', p.faint(s.expires_at ?? '—')]]) : `  ${p.faint('no seat yet · ask for one: POST /v1/judge/keys {"action":"create"}')}`);
  ctx.line(`\n${rule(p, `what you master · ${mineM.length}`)}`);
  if (!mineM.length) ctx.line(`  ${p.faint('nothing yet · taifoon owners lists the seats you can claim (taifoon owners claim <id> --proof …)')}`);
  else ctx.line(table(p, [{ key: 'id', title: 'component', fmt: (v) => p.accent(v) }, { key: 'kind', title: 'kind' }, { key: 'state', title: 'seat', fmt: (_, r) => pill(p, r.seat?.state ?? 'owned') }], mineM));
  return 0;
}

const MENU = [
  ['1', 'standing', 'your key: tier, plan, scopes, caps, balance, entitlement, grants', show],
  ['2', 'keys', 'every key of your tenant and the recent changes', ls],
  ['3', 'create', 'a new key with a label and scopes (stored in your Keychain, never printed)', null],
  ['4', 'scopes', 'change what a key may call and spend', null],
  ['5', 'roll', 'rotate a key, with grace hours for the old one', null],
  ['6', 'revoke', 'stop a key', null],
  ['7', 'team', 'collaborator keys of your projects (taifoon collaborate)', null],
  ['8', 'seats', 'your Jev seat and what you master', seats],
];

/** the interactive menu: one screen per choice over the same functions the subcommands run; q leaves. */
async function menu(ctx) {
  const { p } = ctx;
  for (;;) {
    ctx.line(`\n${rule(p, `keys · ${ctx.keyInfo().prefix ?? 'no key'} · profile ${ctx.profile}`)}`);
    for (const [k, name, what] of MENU) ctx.line(`  ${p.accent(k)}  ${p.ink(name.padEnd(9))} ${p.faint(what)}`);
    ctx.line(`  ${p.accent('q')}  ${p.ink('quit')}`);
    const c = await ctx.ask('choose ›');
    if (c === null || /^q/i.test(c) || c === '') return 0;
    const row = MENU.find(([k, name]) => c === k || c.toLowerCase() === name);
    if (!row) { ctx.line(`  ${p.faint(`no choice ${c}`)}`); continue; }
    const [, name] = row; ctx.line('');
    if (row[3]) { await row[3](ctx, []); continue; }
    if (name === 'team') { const { default: collab } = await import('./collaborate.mjs'); await collab.run(ctx, ['ls']); continue; }
    const prefix = name === 'create' ? null : (await ctx.ask(`which key (prefix${name === 'roll' ? ', empty for this one' : ''}) ›`)) || null;
    if (name === 'create') { ctx.f.label = await ctx.ask('label ›'); ctx.f.scopes = (await ctx.ask(`scopes (${SCOPES.join(',')}; empty for the default) ›`)) || undefined; await create(ctx); }
    if (name === 'scopes' && prefix) { ctx.f.scopes = (await ctx.ask(`scopes for ${prefix} (${SCOPES.join(',')}) ›`)) || undefined; ctx.f['cap-day-grid'] = (await ctx.ask('cap a day in GRID (empty keeps it) ›')) || undefined; await update(ctx, [prefix]); }
    if (name === 'roll') { ctx.f['grace-hours'] = (await ctx.ask('grace hours for the old key (0..168, empty = 0) ›')) || undefined; await roll(ctx, prefix ? [prefix] : []); }
    if (name === 'revoke' && prefix) await revoke(ctx, [prefix]);
  }
}

export default {
  name: 'keys',
  summary: 'your key and your tenant\'s keys: standing, entitlements, grants, create, scopes, roll, revoke, team and seats (a menu on a terminal)',
  valued: ['label', 'scopes', 'cap-day-grid', 'cap-month-grid', 'per-minute', 'grace-hours', 'env'],
  usage: [
    ['keys', 'on a terminal: the menu; in a pipe: the standing and the keys'],
    ['keys show', 'your key\'s standing: tier, plan, scopes, caps, balance, entitlement, grants (GET /v1/access/key)'],
    ['keys ls', 'every key of your tenant and the recent changes (GET /v1/tenant/keys)'],
    ['keys create --label <text> [--scopes a,b] [--cap-day-grid n] [--cap-month-grid n]', 'a new key, straight into your Keychain, never printed'],
    ['keys update <prefix> [--label L] [--scopes a,b] [--cap-day-grid n] [--cap-month-grid n] [--per-minute n]', 'change what a key may call and spend'],
    ['keys roll [<prefix>] [--grace-hours h]', 'a new key in its place; the old one stops now or after the grace hours'],
    ['keys revoke <prefix>', 'stop a key at its next call'],
    ['keys seats', 'your Jev seat and the components you master'],
  ],
  async run(ctx, [sub, ...rest]) {
    if (!sub) {
      const input = ctx.io.stdin ?? process.stdin;
      if (ctx.tty && input.isTTY && !ctx.json) { if (!needKey(ctx)) return 2; await show(ctx); return menu(ctx); }
      const a = await show(ctx); if (a) return a; ctx.line(''); return ls(ctx);
    }
    const h = { show, ls, create, update, roll, revoke, seats }[sub];
    if (!h) { ctx.fail(`no keys ${sub} · taifoon help keys`); return 2; }
    return h(ctx, rest);
  },
};
