// taifoon phases — the five phases of the agreement as live metrics (docs/PHASE-BOARD.md), a command of the table.
// One line per metric, the same line the layer's own pass logs. Reads only, no key: GET /v1/landscape/phases; in a
// checkout of the layer's own source it runs the fold itself over the public reads (src/phases.mjs says how the two meet).
import { layerFetcher } from '../api.mjs';
import { phases } from '../phases.mjs';

export default {
  name: 'phases',
  summary: 'the five phases of the agreement as live metrics: the Phase 0 gate, the record, x402 capture, the n8n onramp, the pools, enterprise, reach by venue',
  usage: [
    ['phases [--phase 0..5|money|reach|board] [--venue <id>] [--json]', 'GET /v1/landscape/phases: one line per metric (phase, metric, value, outside, by, src, note)'],
    ['phases --fixture <dir> · --served', 'in a checkout of the layer’s source: the fold over pinned reads (offline) · read the served board only, never compute'],
  ],
  valued: ['phase', 'venue', 'fixture'],
  async run(ctx, rest) {
    if (rest.length) { ctx.err.write(`✗ unexpected argument ${rest[0]} · taifoon help phases\n`); return 2; }
    const str = (v) => (typeof v === 'string' && v ? v : undefined);
    if (ctx.f.phase !== undefined && !/^[a-z0-9]{1,16}$/.test(String(ctx.f.phase))) { ctx.err.write('✗ --phase is a phase of the board: 0 to 5, money, reach or board\n'); return 2; }
    // a public read: the key is never sent
    const get = layerFetcher({ base: ctx.base, key: null, fetchImpl: ctx.io.fetch ?? globalThis.fetch, version: ctx.version, timeoutMs: 60_000 });
    return phases({ out: ctx.out, err: ctx.err, get, json: ctx.json, phase: str(ctx.f.phase), venue: str(ctx.f.venue), fixture: str(ctx.f.fixture), served: !!ctx.f.served, now: ctx.now, token: null });
  },
};
