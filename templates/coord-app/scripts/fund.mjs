// npm run fund — step 1: a key for the coordination layer and what it holds.
//   no key yet: POST /v1/register mints a free one (no payment, nothing signed, no wallet); it is written to .env.local (mode 600,
//   ignored by git) and only its first characters are shown. Then GET /v1/access/key: its tier, balance and limits.
//   npm run fund -- --buy <dollars>: the quote to put a balance on the key (the transfer you send from your own wallet; nothing is sent here)
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ENV_FILE, apiKey, layer, prefixOf, read, plan } from '../lib/coord.mjs';

export async function fund(argv = process.argv.slice(2), { out = (s) => process.stdout.write(`${s}\n`) } = {}) {
  let key = apiKey();
  if (!key) {
    const r = await plan('/v1/register', {});
    if (!r.ok || typeof r.json?.api_key !== 'string') { out(`no free key (${r.status ?? r.error}): ${r.json?.error ?? r.error ?? 'no answer'}${r.json?.retry_after_seconds ? `; retry in ${r.json.retry_after_seconds} s` : ''}`); return 1; }
    key = r.json.api_key;
    const prev = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => l && !/^TAIFOON_API_KEY=/.test(l)) : [];
    writeFileSync(ENV_FILE, [...prev, `TAIFOON_API_KEY=${key}`].join('\n') + '\n', { mode: 0o600 }); chmodSync(ENV_FILE, 0o600);
    out(`a free key ${prefixOf(key)} is stored in ${ENV_FILE} (never commit it)`);
    process.env.TAIFOON_API_KEY = key;
  } else out(`your key ${prefixOf(key)} (${process.env.TAIFOON_API_KEY ? 'TAIFOON_API_KEY' : ENV_FILE})`);
  const k = await read('/v1/access/key', { withKey: true });
  if (!k.ok) { out(`GET /v1/access/key: ${k.json?.error ?? k.status ?? k.error}`); return 1; }
  const a = k.json;
  out(`  tier ${a.tier ?? '—'} · balance ${a.balance?.grid ?? '—'} GRID / ${a.balance?.usdc ?? '—'} USDC · gateway ${a.limits?.gateway?.used_today ?? '—'} of ${a.limits?.gateway?.free_per_day ?? '—'} free calls today`);
  const i = argv.indexOf('--buy');
  if (i >= 0) {
    const usdc = String(argv[i + 1] ?? '');
    if (!/^\d{1,5}$/.test(usdc)) { out('--buy takes a whole number of dollars'); return 2; }
    const q = await read(`/v1/access/quote?usdc=${usdc}&chainId=8453`, { withKey: true });
    if (!q.ok) { out(`GET /v1/access/quote: ${q.json?.error ?? q.status}`); return 1; }
    out(`  send from your own wallet on chain ${q.json.pay?.chainId}: to ${q.json.pay?.call?.to} data ${q.json.pay?.call?.data}`);
    out('  then credit it: npx @taifoon/cli buy claim --tx 0x… --signature 0x…   (nothing was sent here)');
  }
  out(`  layer ${layer()} · next: npm run demo`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await fund();
