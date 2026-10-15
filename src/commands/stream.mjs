// taifoon stream — the pipe: its stats and one envelope's status (generic reads), and `stream subscribe`: the live stream of envelopes
// your key may read (GET /v1/pipe/stream, server-sent events; filters as query: kinds, venues, chains, order_keys, from_seq).
import { withGeneric, followSse } from './index.mjs';

const FILTERS = ['kinds', 'venues', 'chains', 'order_keys', 'protocol', 'from_seq', 'commitment'];
export default withGeneric('stream', {
  summary: 'the pipe: stats, one envelope, and the live stream of what your key may read',
  valued: [...FILTERS, 'limit', 'for'],
  subs: {
    subscribe: async (ctx) => {
      const q = FILTERS.filter((k) => typeof ctx.f[k] === 'string').map((k) => `${k}=${encodeURIComponent(ctx.f[k])}`).join('&');
      return followSse(ctx, `/v1/pipe/stream${q ? `?${q}` : ''}`);
    },
  },
});
