#!/usr/bin/env node
// The published CLI is self-contained: `taifoon send` needs the genome + envelope builders that live in packages/resale (and the
// keccak they import from packages/addresses). This copies exactly that closed import set into vendor/, keeping the relative layout so
// their own relative imports resolve, and records each file's sha256 in vendor/VENDORED.json.
//   node scripts/vendor-resale.mjs           write vendor/ from the monorepo sources
//   node scripts/vendor-resale.mjs --check   fail when vendor/ differs from the sources (skipped outside the monorepo)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKGS = join(CLI, '..');
const VENDOR = join(CLI, 'vendor');
// the closed set `send` loads (ports/genome.mjs + runtime/pipe-client.mjs and everything they import), relative to packages/
export const FILES = [
  'resale/ports/genome.mjs',
  'resale/ports/transition.mjs',
  'resale/ports/coord-lang/genome-keys.mjs',
  'resale/runtime/pipe-client.mjs',
  'resale/runtime/pipe-sealed.mjs',
  'resale/runtime/match-units.mjs',              // _MATCH_UNITS_v1_: the fake pipe ranks one canonical unit at a time
  'resale/runtime/coord-lang/match-terms.json',  // its table (coord lang/gen/match-terms.json)
  'resale/runtime/coord-lang/pipe.mjs',
  'resale/runtime/coord-lang/agreement.mjs', // _ONE_FORMAT_v1_: pipe-client checks the agreement before it leaves
  'resale/runtime/coord-lang/agreement.json',  // its vectors (lang/vectors/agreement.json), so the published tests run them (stream's inline check)
  'addresses/keccak.mjs',
];
const sha = (b) => createHash('sha256').update(b).digest('hex');

const check = process.argv.includes('--check');
if (!existsSync(join(PKGS, 'resale'))) { console.log('vendor-resale: not in the monorepo; nothing to compare'); process.exit(0); }
const manifest = { schema: 'taifoon.cli.vendored.v1', source: 'packages/ (resale genome + envelope builders, addresses keccak)', files: {} };
let drift = 0;
for (const f of FILES) {
  const src = readFileSync(join(PKGS, f));
  manifest.files[f] = sha(src);
  const dst = join(VENDOR, f);
  if (check) {
    if (!existsSync(dst) || sha(readFileSync(dst)) !== manifest.files[f]) { console.error(`vendor-resale: ${f} differs from its source — run node scripts/vendor-resale.mjs`); drift++; }
  } else { mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, src); }
}
if (check) { if (drift) process.exit(1); console.log(`vendor-resale: ${FILES.length} files match their sources`); }
else { writeFileSync(join(VENDOR, 'VENDORED.json'), JSON.stringify(manifest, null, 2) + '\n'); console.log(`vendor-resale: wrote ${FILES.length} files to vendor/`); }
