// taifoon stream — the live view of the coordination layer (_STREAM_LIVE_v1_, src/stream-live.mjs): the pipe by default, --all adds
// the coord stream's lanes; filters --chain --venue --kind --protocol --actor (comma lists); --json (or a pipe) is NDJSON, --raw the
// old one-line output, --short cut hashes (whole by default for an entitled key), --headers block headers, --stats the measures panel,
// --masters the owner column + table, --seal-key-file to open sealed bodies, --for <s> / --limit <n> to stop. `stream live` and `stream subscribe` are the same verb.
// `stream stats` and `stream status <id>` stay the generic reads.
import { withGeneric } from './index.mjs';
import { streamLive, FLAGS } from '../stream-live.mjs';

const g = withGeneric('stream', {
  summary: 'the live view: the pipe (and --all: every lane), aligned and coloured on a terminal, NDJSON in a pipe; stats; one envelope',
  valued: FLAGS,
  subs: { live: (ctx) => streamLive(ctx), subscribe: (ctx) => streamLive(ctx) },
});
export default { ...g, async run(ctx, rest) { return rest.length === 0 ? streamLive(ctx) : g.run(ctx, rest); } };
