#!/usr/bin/env node
// _ONE_PRODUCT_v1_: the public skill catalog (skills/catalog/<name>/SKILL.md of this repository — the same files the site publishes)
// copied into the package as knowledge/skills/<name>.md with INDEX.json (sha256 of each, the source commit), so the CLI and its
// agent ship the skills of the release they belong to. `--check` writes nothing and exits 1 when a copy differs from its source.
// Never the operator skills (coord skills/): those carry box details and stay on the operator's machine (read at runtime by an admin).
// _AGENT_STARTER_PACK_v1_: the same files are also written as skills/<name>/SKILL.md (the Agent Skills layout that Claude Code
// plugins, Codex and other harnesses load from a repository), so one catalog serves the CLI's agent and every outside harness.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const pkg = new URL('..', import.meta.url).pathname;
const src = join(pkg, '..', '..', 'skills', 'catalog');
const dst = join(pkg, 'knowledge', 'skills');
const pack = join(pkg, 'skills');
const check = process.argv.includes('--check');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const names = readdirSync(src).filter((n) => existsSync(join(src, n, 'SKILL.md'))).sort();
let commit = null; try { commit = execFileSync('git', ['-C', src, 'log', '-1', '--format=%H', '--', '.'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const files = names.map((n) => { const body = readFileSync(join(src, n, 'SKILL.md')); return { name: n, file: `${n}.md`, from: `skills/catalog/${n}/SKILL.md`, sha256: sha(body), body }; });
if (check) {
  let bad = 0;
  const idx = existsSync(join(dst, 'INDEX.json')) ? JSON.parse(readFileSync(join(dst, 'INDEX.json'), 'utf8')) : { skills: [] };
  for (const f of files) {
    const p = join(dst, f.file);
    if (!existsSync(p) || sha(readFileSync(p)) !== f.sha256) { console.log(`differs: knowledge/skills/${f.file} vs ${f.from}`); bad = 1; }
  }
  if (idx.skills.length !== files.length) { console.log(`INDEX.json lists ${idx.skills.length}, the catalog has ${files.length}`); bad = 1; }
  for (const f of files) {
    const p = join(pack, f.name, 'SKILL.md');
    if (!existsSync(p) || sha(readFileSync(p)) !== f.sha256) { console.log(`differs: skills/${f.name}/SKILL.md vs ${f.from}`); bad = 1; }
  }
  const extra = existsSync(pack) ? readdirSync(pack).filter((n) => !names.includes(n)) : [];
  if (extra.length) { console.log(`skills/ has entries the catalog lacks: ${extra.join(', ')}`); bad = 1; }
  if (!bad) console.log(`knowledge/skills: ${files.length} skills match the catalog`);
  process.exit(bad);
}
rmSync(dst, { recursive: true, force: true }); mkdirSync(dst, { recursive: true });
for (const f of files) writeFileSync(join(dst, f.file), f.body);
rmSync(pack, { recursive: true, force: true });
for (const f of files) { mkdirSync(join(pack, f.name), { recursive: true }); writeFileSync(join(pack, f.name, 'SKILL.md'), f.body); }
writeFileSync(join(dst, 'INDEX.json'), JSON.stringify({ schema: 'taifoon.cli.knowledge.v1', source: 'the Taifoon skill catalog (skills/catalog)', commit,
  note: 'copied by scripts/knowledge-skills.mjs — do not edit; change the catalog and re-run', skills: files.map(({ body, ...x }) => x) }, null, 1) + '\n');
console.log(`knowledge/skills + skills/: wrote ${files.length} skills${commit ? ` @ ${commit.slice(0, 9)}` : ''}`);
