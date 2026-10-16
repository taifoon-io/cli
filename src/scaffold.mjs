// The one scaffolder (COALESCE D6, owner 2026-10-15): `taifoon new` writes either a product card's starter (from the layer's card
// templates, served as GET /v1/products `layer`) or the coord app (templates/coord-app).
// `coord new` (coord bin/coord-products.py) and `npx @taifoon/create-coord-app` both call this; nothing else writes a starter.
// Nothing is installed, fetched (beyond the layer when no checkout is near) or signed.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE = fileURLToPath(new URL('../templates/coord-app', import.meta.url));
const RENAME = { _gitignore: '.gitignore', '_env.example': '.env.example' }; // npm drops dotfiles from a published package

/** the coord app into `dir`; returns { ok, dir, name } or { ok: false, error } */
export function scaffold(dir) {
  if (!dir) return { ok: false, error: 'usage: taifoon new --app <directory>' };
  const target = resolve(dir);
  const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '') || 'coord-app';
  if (existsSync(target) && readdirSync(target).length) return { ok: false, error: `${dir} exists and is not empty: nothing was written` };
  cpSync(TEMPLATE, target, { recursive: true });
  for (const [from, to] of Object.entries(RENAME)) if (existsSync(join(target, from))) renameSync(join(target, from), join(target, to));
  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); pkg.name = name;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return { ok: true, dir: target, name };
}

/** the layer's cards: the checkout's packages/products/layer.json when this CLI runs from one, else GET /v1/products `layer` */
export async function loadLayer({ base = 'https://coord.taifoon.dev', fetchImpl = globalThis.fetch } = {}) {
  const local = new URL('../../products/layer.json', import.meta.url);
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'));
  const r = await fetchImpl(`${base}/v1/products`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  const j = await r.json();
  if (!j?.layer?.cards) throw new Error(`${base}/v1/products has no layer`);
  return j.layer;
}

const q = (s) => (/^[A-Za-z0-9@%+=:,./_-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'"'"'`)}'`);  // shlex.quote
const split = (cmd) => { const out = []; let cur = ''; let quote = null; let has = false;            // shlex.split (the curl lines)
  for (const ch of cmd) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch;
  }
  if (cur || has) out.push(cur); return out; };

/** a card's starter into `dir` (default ./<card>-starter): README.md, starter.sh, starter.mjs, package.json — keyless reads */
export function cardStarter(L, cardId, dir) {
  const shelf = L.cards.filter((x) => x.shelf);
  const c = L.cards.find((x) => x.id === cardId);
  if (!c) return { ok: false, error: `no card ${cardId}; cards: ${shelf.map((x) => x.id).join(', ')}` };
  if (!c.shelf) return { ok: false, error: `${cardId} is off the shelf: ${c.why_not}` };
  const d = resolve(dir || `${cardId}-starter`);
  if (existsSync(d) && readdirSync(d).length) return { ok: false, error: `${d} exists and is not empty` };
  mkdirSync(d, { recursive: true });
  const faces = Object.fromEntries(L.faces.map((f) => [f.id, f.name]));
  const readme = `# ${c.name}: the starter\n\n${c.what}\n\nPart of ${L.name}. Faces: ${c.faces.map((f) => faces[f]).join(' · ')}.\n\n## Run it (no key, no payment, nothing signed)\n\n\`\`\`bash\nbash starter.sh        # the card's starter, then the layer's quickstart reads\nnode starter.mjs       # the same reads from Node 18+ with fetch only\n\`\`\`\n\n## Install\n\n\`\`\`\n${c.installer}\n\`\`\`\n\n## SDK\n\n\`\`\`\n${c.sdk}\n\`\`\`\n\n## Ops\n\n${c.ops.map((o) => `- \`${o}\``).join('\n') || '- none'}\n\nSource: the product card \`${c.id}\`, served at GET https://coord.taifoon.dev/v1/products (\`layer\`).\n`;
  writeFileSync(join(d, 'README.md'), readme);
  const reads = L.quickstart.filter((x) => !x.run.includes('$TAIFOON_KEY') && !x.run.includes('/v1/register'));
  const sh = ['#!/usr/bin/env bash', `# ${c.name}: the starter (taifoon new ${c.id}). Keyless reads on the live host.`, 'set -euo pipefail', '',
    'echo ' + q(`== ${c.name}: ${c.starter.slice(0, 60)}…`), c.starter + ' | head -c 1200; echo', ''];
  for (const x of reads) sh.push('echo ' + q(`== quickstart ${x.n}: ${x.say}`), x.run + ' | head -c 600; echo', '');
  writeFileSync(join(d, 'starter.sh'), sh.join('\n') + '\n'); chmodSync(join(d, 'starter.sh'), 0o755);
  const urls = [];
  for (const cmd of [c.starter, ...reads.map((x) => x.run)]) {
    const toks = split(cmd); const u = toks.find((t) => t.startsWith('https://'));
    if (u && !toks.includes('-X') && !toks.includes('-d')) urls.push(u);
  }
  const js = [`// ${c.name}: the starter in Node 18+ (fetch only, no dependencies). Keyless reads on the live host.`,
    `const urls = ${JSON.stringify(urls, null, 2)};`, 'for (const u of urls) {', "  const r = await fetch(u, { headers: { accept: 'application/json' } });",
    '  const body = await r.text();', '  console.log(`== ${r.status} ${u}\\n${body.slice(0, 600)}\\n`);', '  if (!r.ok) process.exitCode = 1;', '}'];
  writeFileSync(join(d, 'starter.mjs'), js.join('\n') + '\n');
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: `${c.id}-starter`, private: true, type: 'module', scripts: { start: 'node starter.mjs' } }, null, 2) + '\n');
  return { ok: true, dir: d, card: c.id, files: ['README.md', 'starter.sh', 'starter.mjs', 'package.json'] };
}
