// taifoon metrics — what went through the layer (GET /v1/metrics + /v1/network), src/metrics.mjs unchanged, as a command of the table
// so the shell completes it and `taifoon help` lists it. --json keeps metrics.mjs's own shape: one { metrics, network } per read.
import { layerFetcher } from '../api.mjs';
import { metrics } from '../metrics.mjs';

export default {
  name: 'metrics',
  summary: 'what went through the layer: today vs yesterday vs 7 days (customers · ours), routes, customers (hashed), fees, funnel, network',
  usage: [['metrics [--day YYYY-MM-DD] [--watch [seconds]] [--json]', 'GET /v1/metrics + /v1/network; --watch re-reads on its period (≥ 5 s, default 30)']],
  valued: ['day', 'watch'],
  async run(ctx, rest) {
    if (rest.length) { ctx.fail(`unexpected argument ${rest[0]} · taifoon help metrics`); return 2; }
    const day = ctx.f.day === undefined ? null : String(ctx.f.day);
    if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) { ctx.fail('--day is YYYY-MM-DD (UTC)'); return 2; }
    const w = ctx.f.watch === undefined ? 0 : Number(ctx.f.watch);
    const watch = ctx.f.watch === undefined ? 0 : Number.isFinite(w) && w >= 5 ? w : 30;
    const get = layerFetcher({ base: ctx.base, key: ctx.key(), fetchImpl: ctx.io.fetch ?? globalThis.fetch, version: ctx.version, timeoutMs: 60_000 });
    return metrics({ t: ctx.t, out: ctx.out, get, base: ctx.base, json: ctx.json, day, watch, io: ctx.io.metrics ?? {} });
  },
};
