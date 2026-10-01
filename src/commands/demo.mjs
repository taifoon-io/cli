// taifoon demo n8n — the n8n buyer flow, phase by phase, each with the node operation and example workflow that does it in
// n8n (n8n-nodes-taifoon) and its link. The phases come from the flow definition vendored as ../n8n-flow.json (generated from
// the node's examples/flow.json; never edited here).
//   demo n8n            replays the last tested run of the buyer example against the live layer: every read is made again
//                       now (the demand, its handshake, the explorer row) and the settle transaction is re-checked on chain
//                       (POST /v1/attest/hire). No key, nothing written.
//   demo n8n --live     the same flow on a new demand: your key (taifoon login), or a free key minted for this run when you
//                       have none (shown by prefix only, never stored); settles on the devnet 36927 in about 5 minutes.
import { readFileSync } from 'node:fs';
import { clip, kv, pill, rule } from '../brand.mjs';

const FLOW = JSON.parse(readFileSync(new URL('../n8n-flow.json', import.meta.url), 'utf8'));
const BUYER_EXAMPLE = '2-buyer-need-to-verified.json';
const ENDED = new Set(['settled', 'unmatched', 'failed', 'cancelled', 'expired']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scan = (id) => FLOW.flow.explorer.replace('{id}', id);
const txLink = (chain, tx) => `https://www.taifoon.io/scan/${chain}/tx/${tx}`;

/** The buyer phases as the flow defines them. Pure. */
export const buyerPhases = () => FLOW.flow.roles.find((r) => r.id === 'buyer').phases;
/** The demand of the last tested run of the buyer example, or null. Pure. */
export const lastRunDemand = () => FLOW.examples[BUYER_EXAMPLE]?.run?.output?.demand ?? null;

function phaseHead(ctx, ph, i, n) {
  const { p } = ctx;
  ctx.line('');
  ctx.line(`  ${p.accent(`${i}/${n}`)} ${p.ink(ph.title.toUpperCase())}  ${p.faint(clip(ph.does, ctx.width - 20))}`);
  ctx.line(`      ${p.faint(`n8n: ${ph.op} · ${ph.example.replace(/\.json$/, '')} → ${ph.nodes.join(', ')} · ${ph.http}`)}`);
}

async function mintFree(ctx, wallet) {
  const r = await ctx.post('/v1/register', { wallet_address: wallet }, { key: false, timeoutMs: 30_000 });
  if (r.status !== 201 || !r.json?.api_key) return { error: r.json?.error ?? r.error ?? `register answered ${r.status}` };
  return { key: r.json.api_key, prefix: r.json.key_prefix, tenant: r.json.tenant?.id ?? null };
}

export default {
  name: 'demo',
  summary: 'the n8n flow, phase by phase, with each phase’s node operation, example workflow and link (demo n8n)',
  usage: [
    ['demo n8n', 'replay the last tested run of the n8n buyer example: every phase read again from the live layer, the settlement re-checked on chain; no key, nothing written'],
    ['demo n8n --live [--need "<words>"] [--wallet 0x…]', 'run the flow on a new demand with your key, or a free key minted for this run (prefix shown only); devnet 36927, about 5 minutes'],
  ],
  subs: ['n8n'],
  valued: ['need', 'wallet', 'timeout'],
  async run(ctx, [what, ...rest]) {
    const { p } = ctx;
    if (what !== 'n8n') { ctx.fail('usage: taifoon demo n8n [--live] · taifoon help demo'); return 2; }
    if (rest.length) { ctx.fail(`unexpected argument ${rest[0]} · taifoon help demo`); return 2; }
    const phases = buyerPhases();
    const n = phases.length;
    const live = ctx.f.live === true;
    const out = { mode: live ? 'live' : 'replay', phases: [] };
    const note = (id, v) => out.phases.push({ phase: id, ...v });
    const at = (id) => phases.findIndex((x) => x.id === id) + 1;
    const ph = (id) => phases.find((x) => x.id === id);

    ctx.line(rule(p, `n8n flow · ${live ? 'live: a new demand' : 'replay of the last tested run'} · ${FLOW.flow.network.label}`));
    ctx.line(`  ${p.faint(`node ${FLOW.flow.package} · examples: github.com/taifoon-io/n8n-nodes-taifoon/tree/main/examples · page: https://www.taifoon.io/docs/n8n`)}`);

    // ── key ──
    let key = null;
    phaseHead(ctx, ph('key'), at('key'), n);
    if (!live) { ctx.line(`      ${p.muted('replay: no key is needed to read the run; --live uses yours or mints a free one')}`); note('key', { skipped: 'replay' }); }
    else {
      key = ctx.key();
      if (key) { ctx.line(`      ${p.ink(`your key ${ctx.keyInfo().prefix}…`)} ${p.faint(`(${ctx.keyInfo().source})`)}`); note('key', { source: ctx.keyInfo().source }); }
      else {
        const m = await mintFree(ctx, String(ctx.f.wallet ?? '0x' + '0'.repeat(40)));
        if (m.error) { ctx.fail(`register: ${m.error} · or log in: taifoon login --free`); return 1; }
        key = m.key;
        ctx.line(`      ${p.ink(`a free key ${m.prefix}… for this run`)} ${p.faint(`tenant ${m.tenant} · not stored: keep one with taifoon login --free`)}`);
        note('key', { minted: m.prefix, tenant: m.tenant });
      }
    }
    const withKey = (o = {}) => (key ? { ...o, headers: { 'x-api-key': key }, key: false } : { ...o, key: false });

    // ── tenant ──
    phaseHead(ctx, ph('tenant'), at('tenant'), n);
    if (!key) { ctx.line(`      ${p.muted('replay: skipped (it reads the tenant of your key)')}`); note('tenant', { skipped: 'no key' }); }
    else {
      const r = await ctx.get('/v1/tenant/me', withKey());
      const t = r.json?.tenant ?? {};
      ctx.line(kv(p, [['tenant', p.ink(`${t.id ?? '—'} · via ${t.via ?? '—'}`)], ['next', p.muted(r.json?.next_step?.title ?? '—')]], 12).replace(/^/gm, '    '));
      note('tenant', { status: r.status, tenant: t.id ?? null });
    }

    // ── demand ──
    let id = null;
    phaseHead(ctx, ph('demand'), at('demand'), n);
    if (!live) {
      id = lastRunDemand();
      if (!id) { ctx.fail('the vendored flow carries no tested buyer run'); return 1; }
      const run = FLOW.examples[BUYER_EXAMPLE].run;
      ctx.line(`      ${p.muted(`the last tested run: ${run.verdict} · ${run.where === 'hosted' ? 'n8n.taifoon.dev' : 'n8n'} ${run.n8n} · node ${run.node} · ${String(run.ran_at).slice(0, 16).replace('T', ' ')} UTC`)}`);
    } else {
      const need = String(ctx.f.need ?? 'the sha256 digest of the text "hello from the taifoon n8n demo"');
      const dry = await ctx.post('/v1/demands', { need, dry_run: true, buyer_label: 'n8n-demo' }, withKey({ timeoutMs: 30_000 }));
      if (!dry.ok) { ctx.fail(`demands (dry run): ${dry.json?.error ?? dry.error ?? dry.status}`); return 1; }
      ctx.line(`      ${p.faint('preview (kept nothing):')} ${p.accent(dry.json.class)} ${p.faint(clip(JSON.stringify(dry.json.input), 60))}${dry.json.cover_preview?.premium ? p.faint(` · premium ${dry.json.cover_preview.premium} units`) : ''}`);
      const r = await ctx.post('/v1/demands', { need, buyer_label: 'n8n-demo' }, withKey({ timeoutMs: 30_000 }));
      if (!r.ok) { ctx.fail(`demands: ${r.json?.error ?? r.error ?? r.status}`); return 1; }
      id = r.json.demand.id;
    }
    ctx.line(`      ${p.ink(id)}  ${p.accent(scan(id))}`);
    note('demand', { demand: id, link: scan(id) });

    // ── match → job: the demand until it ends ──
    let d = null;
    const until = ctx.now() + Number(ctx.f.timeout ?? 600) * 1000;
    let last = null;
    for (;;) {
      const r = await ctx.get(`/v1/demands/${id}`, { key: false, quiet: true });
      if (!r.ok) { ctx.fail(`demands/${id}: ${r.json?.error ?? r.error ?? r.status}`); return 1; }
      d = r.json.demand;
      if (live && d.state !== last) { last = d.state; ctx.line(`      ${p.faint(new Date(ctx.now()).toISOString().slice(11, 19))} ${pill(p, d.state)}`); }
      if (!live || ENDED.has(d.state) || ctx.now() >= until) break;
      await (ctx.io.sleep ?? sleep)(20_000);
    }
    phaseHead(ctx, ph('match'), at('match'), n);
    const matched = (d.events ?? []).find((e) => e.state === 'matched');
    ctx.line(kv(p, [['class', p.accent(d.class)], ['seller', p.ink(d.seller ?? '—')], ['matched', p.muted(matched ? `${String(matched.at).slice(11, 19)} · ${clip(matched.note ?? '', ctx.width - 40)}` : '—')]], 12).replace(/^/gm, '    '));
    note('match', { class: d.class, seller: d.seller ?? null });

    phaseHead(ctx, ph('handshake'), at('handshake'), n);
    if (d.handshake_id) {
      const h = await ctx.get(`/v1/handshake/${d.handshake_id}`, { key: false });
      const ch = h.json?.candidate?.choice ?? {};
      ctx.line(kv(p, [['handshake', p.ink(`${d.handshake_id} · ${h.json?.state ?? h.status}`)], ['chosen', p.ink(ch.chosen ?? '—')], ['ranked', p.muted((ch.ranked ?? []).slice(0, 3).map((x) => `${x.seller} ${x.ready ?? ''}`).join(' · ') || '—')]], 12).replace(/^/gm, '    '));
      note('handshake', { id: d.handshake_id, state: h.json?.state ?? null });
    } else { ctx.line(`      ${p.muted('no handshake: the demand was not hired')}`); note('handshake', { id: null }); }

    phaseHead(ctx, ph('job'), at('job'), n);
    const e = d.ending ?? {};
    ctx.line(kv(p, [
      ['state', pill(p, d.state)],
      ['grade', d.grade ? `${pill(p, d.grade.verdict === 'pass' ? 'ok pass' : String(d.grade.verdict))} ${p.faint(Object.entries(d.grade.checks ?? {}).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(' '))}` : p.muted('—')],
      ['job', p.ink(d.job_id ?? '—')],
      ['settled', e.tx ? `${p.ink(e.tx)}\n${' '.repeat(18)}${p.accent(txLink(d.chainId, e.tx))}` : p.muted(d.why ?? '—')],
    ], 12).replace(/^/gm, '    '));
    note('job', { state: d.state, job_id: d.job_id ?? null, settle_tx: e.tx ?? null, link: e.tx ? txLink(d.chainId, e.tx) : null });

    // ── explorer first (it names the payee the attestation checks), then attest ──
    const x = await ctx.get(`/v1/explorer/jobs/${id}`, { key: false, timeoutMs: 30_000 });
    const job = x.json?.job ?? {};
    phaseHead(ctx, ph('attest'), at('attest'), n);
    let verdict = null;
    if (e.tx) {
      const a = await ctx.post('/v1/attest/hire', { txHash: e.tx, chainId: d.chainId, agentAddress: job.payee?.address || undefined }, { key: false, timeoutMs: 30_000 });
      verdict = a.json?.verdict ?? null;
      ctx.line(`      ${pill(p, verdict === 'REAL' ? 'ok REAL' : String(verdict ?? a.status))} ${p.faint((a.json?.checks ?? []).map((c) => `${c.claim}: ${c.outcome}`).join(' · '))}`);
    } else ctx.line(`      ${p.muted('nothing to attest: no settle transaction')}`);
    note('attest', { verdict });

    phaseHead(ctx, ph('explorer'), at('explorer'), n);
    ctx.line(kv(p, [['doer', p.ink(job.doer?.seller ?? '—')], ['payee', p.ink(job.payee?.address ?? '—')], ['explorer', p.accent(scan(id))]], 12).replace(/^/gm, '    '));
    note('explorer', { doer: job.doer?.seller ?? null, payee: job.payee?.address ?? null, link: scan(id) });

    ctx.line('');
    ctx.line(`  ${p.faint('the seller side and the public reads (discovery, assurance, proof): taifoon demo n8n --json lists the flow · https://www.taifoon.io/docs/n8n')}`);
    const ok = d.state === 'settled' && verdict === 'REAL';
    if (ctx.json) ctx.emit({ ok, ...out, flow: FLOW.flow.roles.map((r) => ({ role: r.id, phases: r.phases.map((x) => ({ id: x.id, op: x.op, example: x.example, nodes: x.nodes })) })) });
    return ok ? 0 : 1;
  },
};
