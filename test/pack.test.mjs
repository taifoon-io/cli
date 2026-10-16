// The published package must work on its own: pack the CLI, install the tarball into a clean prefix (no monorepo beside it), and run
// every command's --help, `send --dry` and `new --contracts`. Catches imports that reach outside the package (0.3.1 shipped a `send`
// that loaded ../../../resale and failed on every install).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000, ...opts });

test('the packed tarball installs and every command runs outside the monorepo', { timeout: 600_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'taifoon-pack-'));
  try {
    run('npm', ['pack', '--silent', '--pack-destination', root], { cwd: CLI });
    const tgz = readdirSync(root).find((f) => f.endsWith('.tgz'));
    assert.ok(tgz, 'npm pack wrote a tarball');
    const prefix = join(root, 'prefix');
    run('npm', ['i', '-g', '--prefix', prefix, '--silent', '--no-audit', '--no-fund', join(root, tgz)], { cwd: root });
    const bin = join(prefix, 'bin', 'taifoon');
    const env = { ...process.env, HOME: join(root, 'home'), TAIFOON_CONFIG_DIR: join(root, 'cfg'), NO_COLOR: '1' };
    const installed = join(prefix, 'lib', 'node_modules', '@taifoon', 'cli');
    // nothing in the installed package may import a path outside it
    assert.ok(existsSync(join(installed, 'vendor', 'resale', 'ports', 'genome.mjs')), 'vendor/ is in the tarball');
    const { commands } = await import(pathToFileURL(join(installed, 'src', 'commands', 'index.mjs')).href);
    const names = [...(await commands()).keys?.() ?? (await commands()).map((c) => c.name)];
    assert.ok(names.length > 10, `the command table lists ${names.length} commands`);
    const failed = [];
    for (const n of names) {
      try { run(bin, [n, '--help'], { cwd: root, env }); } catch (e) { failed.push(`${n}: ${(e.stderr || e.message).split('\n')[0]}`); }
    }
    assert.deepEqual(failed, [], `every command's --help runs from the tarball:\n${failed.join('\n')}`);
    // send builds an envelope offline from the vendored genome + envelope builders
    const job = join(root, 'job.json');
    writeFileSync(job, JSON.stringify({ schema: 'taifoon.job.v1', id: 'pack-test-1', chain: 8453 }));
    const sent = JSON.parse(run(bin, ['send', job, '--kind', 'hire', '--to', 'coord://offchain/coord', '--dry', '--json'], { cwd: root, env }));
    assert.equal(sent.dry, true);
    assert.match(sent.envelope.id ?? '', /^0x[0-9a-f]{64}$/, 'send --dry built an envelope with an id');
    // new --contracts writes the forge starter from the packaged template
    const dir = join(root, 'contracts-starter');
    run(bin, ['new', '--contracts', dir], { cwd: root, env });
    assert.ok(readdirSync(dir).length > 0, 'new --contracts wrote the starter');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
