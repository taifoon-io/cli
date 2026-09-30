// taifoon collaborate — teams on the layer, through /v1/relayer/keys (_COLLAB_KEYS_v1_).
//   collaborate invite <project> <member>   mint the collaborator's OWN relayer key (scope, per-minute and per-day budget).
//                                            /v1 returns it once; this CLI puts it straight into the macOS Keychain
//                                            (service taifoon-collab, account <project>/<prefix>) and never prints it.
//   collaborate ls                           your projects and every collaborator key: scope, budgets, today's calls
//   collaborate activity <project>           who did what: calls per day (7 days) and the λ gateway steps of each key
//   collaborate revoke <key_prefix>          the key stops at the next call; its Keychain copy is deleted
//   collaborate handoff <project> <prefix>   copy a collaborator key to the clipboard (pbcopy) to hand over, still never printed
// Owner auth is your own relayer key (taifoon login). A collaborator key can neither invite nor revoke.
import { clip, panel, pill, rule, table } from '../brand.mjs';
import { COLLAB_SERVICE, isKey, keychain } from '../config.mjs';

function needKey(ctx) {
  if (ctx.key()) return true;
  const k = ctx.keyInfo();
  ctx.fail(k.error ? `no key: ${k.error}` : 'collaboration needs your own relayer key: taifoon login (a guest has no projects)');
  return false;
}

async function invite(ctx, [project, ...memberParts]) {
  const { p } = ctx;
  const member = memberParts.join(' ').trim();
  if (!project || !member) { ctx.fail('usage: taifoon collaborate invite <project> <member: 0x… address or a name> [--scope read|write] [--per-minute n] [--per-day n] [--label text]'); return 2; }
  if (!needKey(ctx)) return 2;
  const body = { project, member, ...(ctx.f.scope ? { scope: String(ctx.f.scope) } : {}), ...(ctx.f['per-minute'] ? { per_minute: Number(ctx.f['per-minute']) } : {}), ...(ctx.f['per-day'] ? { per_day: Number(ctx.f['per-day']) } : {}), ...(ctx.f.label ? { label: String(ctx.f.label) } : {}) };
  const r = await ctx.post('/v1/relayer/keys', body);
  if (!r.ok || !isKey(r.json?.key)) { ctx.fail(`invite refused (${r.status}): ${r.json?.error ?? r.error ?? 'no key returned'}`); if (ctx.json) ctx.emit({ ok: false, status: r.status, error: r.json?.error ?? null }); return 1; }
  const m = r.json.member;
  const account = `${r.json.project.project}/${m.key_prefix}`;
  let stored = false; let storeError = null;
  try { stored = keychain.set(ctx.exec, COLLAB_SERVICE, account, r.json.key); } catch (e) { storeError = e.message; }
  r.json.key = undefined; // the raw key goes no further than the Keychain write
  const res = { ok: stored, project: r.json.project, member: m, keychain: stored ? { service: COLLAB_SERVICE, account } : null, error: storeError };
  if (ctx.json) { ctx.emit(res); return stored ? 0 : 1; }
  if (!stored) { ctx.fail(`the key was minted (${m.key_prefix}) but the Keychain refused it: ${storeError}. Revoke it now: taifoon collaborate revoke ${m.key_prefix}`); return 1; }
  ctx.line(panel(p, `invited · ${r.json.project.project}`, [
    `${p.faint('member     ')} ${p.ink(m.member)} ${p.faint(m.member_kind)}`,
    `${p.faint('key        ')} ${p.accent(m.key_prefix)} ${p.faint(`ref ${m.ref} · never shown`)}`,
    `${p.faint('scope      ')} ${pill(p, m.scope === 'read' ? 'read only' : 'write')}   ${p.faint('budget')} ${p.ink(`${m.per_minute}/min · ${m.per_day}/day`)}`,
    `${p.faint('stored in  ')} ${p.ink(`macOS Keychain ${COLLAB_SERVICE} / ${account}`)}`,
    '',
    p.faint(`hand it over: taifoon collaborate handoff ${r.json.project.project} ${m.key_prefix} (clipboard) · revoke: taifoon collaborate revoke ${m.key_prefix}`),
  ]));
  return 0;
}

async function ls(ctx) {
  const { p } = ctx;
  if (!needKey(ctx)) return 2;
  const r = await ctx.get('/v1/relayer/keys');
  if (!r.ok) { ctx.fail(`relayer/keys: ${r.json?.error ?? r.status}`); return 1; }
  if (ctx.json) { ctx.emit(r.json); return 0; }
  if (r.json.member_of) { ctx.line(`  ${p.faint('this is a collaborator key of project')} ${p.accent(r.json.member_of.project)} ${p.faint(`(${r.json.member_of.scope}, ${r.json.member_of.per_day}/day)`)}`); return 0; }
  const projects = r.json.projects ?? [];
  ctx.line(rule(p, `projects of ${r.json.owner_prefix} · ${projects.length}`));
  if (!projects.length) ctx.line(`  ${p.faint('none yet: taifoon collaborate invite <project> <member>')}`);
  for (const pr of projects) {
    ctx.line(`\n  ${p.accent(pr.project)} ${p.faint(`created ${pr.created_at} · ${pr.members.length} key(s)`)}`);
    ctx.line(table(p, [
      { key: 'key_prefix', title: 'key', fmt: (v) => p.accent(v) }, { key: 'member', title: 'member', fmt: (v) => p.ink(clip(v, 42)) },
      { key: 'scope', title: 'scope' }, { key: 'per_day', title: 'per day', align: 'right' },
      { key: 'today', title: 'today w/r', align: 'right', fmt: (v) => `${v?.writes ?? 0}/${v?.reads ?? 0}` },
      { key: 'revoked_at', title: 'state', flex: true, fmt: (v) => pill(p, v ? `revoked ${v.slice(0, 16)}` : 'live') },
    ], pr.members));
  }
  return 0;
}

async function activity(ctx, [project]) {
  const { p } = ctx;
  if (!project) { ctx.fail('usage: taifoon collaborate activity <project>'); return 2; }
  if (!needKey(ctx)) return 2;
  const r = await ctx.get(`/v1/relayer/activity?project=${encodeURIComponent(project)}`);
  if (!r.ok) { ctx.fail(`relayer/activity: ${r.json?.error ?? r.status}`); return 1; }
  if (ctx.json) { ctx.emit(r.json); return 0; }
  ctx.line(rule(p, `who did what · ${r.json.project}`));
  ctx.line(table(p, [
    { key: 'key_prefix', title: 'key', fmt: (v) => p.accent(v) }, { key: 'member', title: 'member', fmt: (v) => p.ink(clip(v, 40)) },
    { key: 'totals', title: '7d writes', align: 'right', fmt: (v) => String(v?.writes ?? 0) }, { key: 'totals', title: '7d reads', align: 'right', fmt: (v) => String(v?.reads ?? 0) },
    { key: 'gateway_steps', title: 'gw steps', align: 'right', fmt: (v) => String((v ?? []).length) },
    { key: 'revoked_at', title: 'state', flex: true, fmt: (v) => pill(p, v ? 'revoked' : 'live') },
  ], r.json.members));
  for (const m of r.json.members) for (const s of m.gateway_steps.slice(0, 3)) ctx.line(`  ${p.faint(m.key_prefix)} ${p.muted(s.at)} ${p.ink(s.resource)} ${pill(p, s.state)} ${p.faint([...s.methods, ...s.tools].join(' '))}`);
  ctx.line(`\n  ${p.faint(`sources: ${r.json.sources.join(' · ')}`)}`);
  return 0;
}

async function revoke(ctx, [prefix]) {
  const { p } = ctx;
  if (!/^tfr_[A-Za-z0-9_-]{6}$/.test(prefix ?? '')) { ctx.fail('usage: taifoon collaborate revoke <key_prefix tfr_xxxxxx> [--project p]'); return 2; }
  if (!needKey(ctx)) return 2;
  const r = await ctx.post('/v1/relayer/keys/revoke', { key_prefix: prefix, ...(ctx.f.project ? { project: String(ctx.f.project) } : {}) });
  if (!r.ok) { ctx.fail(`revoke refused (${r.status}): ${r.json?.error ?? r.error}`); if (ctx.json) ctx.emit({ ok: false, status: r.status }); return 1; }
  const deleted = keychain.del(ctx.exec, COLLAB_SERVICE, `${r.json.project}/${prefix}`);
  if (ctx.json) { ctx.emit({ ...r.json, keychain_deleted: deleted }); return 0; }
  ctx.line(`  ${p.live('✓')} ${p.accent(prefix)} revoked${r.json.already ? p.faint(' (already)') : ''} ${p.faint(`· project ${r.json.project} · keychain copy ${deleted ? 'deleted' : 'not found'}`)}`);
  return 0;
}

function handoff(ctx, [project, prefix]) {
  const { p } = ctx;
  if (!project || !prefix) { ctx.fail('usage: taifoon collaborate handoff <project> <key_prefix>'); return 2; }
  const k = keychain.get(ctx.exec, COLLAB_SERVICE, `${project}/${prefix}`);
  if (!k) { ctx.fail(`no Keychain entry ${COLLAB_SERVICE}/${project}/${prefix}`); return 1; }
  const r = ctx.exec('pbcopy', [], k);
  if (r.status !== 0) { ctx.fail('pbcopy is not available: read it yourself with security find-generic-password -s taifoon-collab -a <project>/<prefix> -w'); return 1; }
  ctx.line(`  ${p.live('✓')} ${p.accent(prefix)} ${p.faint('is on the clipboard (not printed). Paste it once into the collaborator’s channel, then clear the clipboard.')}`);
  return 0;
}

export default {
  name: 'collaborate',
  summary: 'teams: invite collaborators with their own scoped keys and budgets, see who did what, revoke',
  usage: [
    ['collaborate invite <project> <member> [--scope read|write] [--per-minute n] [--per-day n]', 'mint a scoped key (Keychain, never printed)'],
    ['collaborate ls', 'your projects and their keys, with today’s use'],
    ['collaborate activity <project>', 'who did what: calls per day + gateway steps'],
    ['collaborate revoke <key_prefix> [--project p]', 'stop a key at the next call'],
    ['collaborate handoff <project> <key_prefix>', 'put a collaborator key on the clipboard to hand over'],
  ],
  subs: ['invite', 'ls', 'activity', 'revoke', 'handoff'],
  valued: ['scope', 'per-minute', 'per-day', 'label', 'project'],
  async run(ctx, [sub = 'ls', ...rest]) {
    const h = { invite, ls, list: ls, activity, revoke, handoff }[sub];
    if (!h) { ctx.fail(`unknown: collaborate ${sub} · taifoon help collaborate`); return 2; }
    return h(ctx, rest);
  },
};
