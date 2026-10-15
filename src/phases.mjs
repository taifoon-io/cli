// taifoon phases — the five phases of the agreement as live metrics (docs/PHASE-BOARD.md), in the terminal.
//
//   taifoon phases                    the board, computed from the layer's public reads (in a checkout of the layer's source)
//                                     or read from GET /v1/landscape/phases (installed from npm, or --served)
//   taifoon phases --fixture <dir>    the board over pinned reads (offline)
//   taifoon phases --served           always read the layer's served board, never compute
//   taifoon phases --phase <0..5|reach> --venue <id> --json
//
// Reads only; no key is needed. One line per metric, the SAME line the box's timer logs and obs.taifoon.dev shows:
//   phase=4 metric=pools_funded value=3 outside=mixed by=tenant:moonbeam src="/v1/pools/state"
// The fold itself is harvesters/conformance/phases.ts (one implementation); this module finds it when the CLI runs from
// the checkout, and otherwise prints the latest point the layer served. test/phases-parity.test.mjs pins the line here
// to the fold's own logLine byte for byte.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PHASES_SCHEMA = 'taifoon.phases.v1';
export const PHASES_PATH = '/v1/landscape/phases';
const FOLD = new URL('../../../harvesters/conformance/phases.ts', import.meta.url);

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
const outsideWord = (o) => (o === true ? '1' : o === false ? '0' : o === 'na' ? 'na' : 'mixed');
/** the one line; identical to phases.ts logLine (pinned by test/phases-parity.test.mjs) */
export function logLine(m) {
  const by = m.by ? ' by=' + Object.entries(m.by).map(([k, v]) => `${k}:${v}`).join(',') : '';
  return `phase=${m.phase} metric=${m.metric} value=${m.value ?? 'null'} outside=${outsideWord(m.outside)}${by} src="${q(m.source)}"${m.note ? ` note="${q(m.note)}"` : ''}`;
}

const canStrip = (() => { const [maj, min] = process.versions.node.split('.').map(Number); return maj > 22 || (maj === 22 && min >= 6); })();
export const foldAvailable = () => existsSync(FOLD) && canStrip;

/** compute the board here: the fold over live reads (or a fixture dir) */
export async function computePoint({ fixture = null, now = () => Date.now(), token = null } = {}) {
  const fold = await import(pathToFileURL(FOLD.pathname).href);
  const read_at = Math.floor(now() / 1000);
  const reads = fixture ? fold.readsFromFixture(fixture) : await fold.readsLive({ token });
  return { point: fold.pointOf(fold.phasesOf(reads, fold.oursFromAddresses(), read_at), read_at), source: fixture ? `fixture ${fixture}` : 'computed from the layer\'s public reads' };
}

/** read the board the layer serves (GET /v1/landscape/phases: the latest point, or the history) */
export async function servedPoint(get) {
  const r = await get(PHASES_PATH);
  if (!r) return { error: 'the layer did not answer' };
  if (r.status === 404) return { error: `the layer does not serve ${PHASES_PATH} yet (phase board item 5); run from a checkout of the layer’s source to compute it` };
  if (r.status !== 200 || !r.json) return { error: `${PHASES_PATH} answered ${r.status}` };
  const j = r.json;
  const point = j.v === PHASES_SCHEMA && Array.isArray(j.metrics) ? j : j.latest?.v === PHASES_SCHEMA ? j.latest : Array.isArray(j.points) ? j.points.filter((p) => p?.v === PHASES_SCHEMA).sort((a, b) => b.read_at - a.read_at)[0] : null;
  if (!point) return { error: `${PHASES_PATH} answered no ${PHASES_SCHEMA} point` };
  return { point, source: PHASES_PATH };
}

const filterMetrics = (ms, { phase, venue }) => ms.filter((m) => (!phase || String(m.phase) === phase) && (!venue || m.by?.venue === venue));

/** the command. o: { out, err, get, json, phase, venue, fixture, served, now, token }. Returns the exit code. */
export async function phases(o) {
  const compute = !o.served && (o.fixture || foldAvailable());
  let got;
  try { got = compute ? await computePoint({ fixture: o.fixture, now: o.now, token: o.token }) : await servedPoint(o.get); }
  catch (e) { got = { error: e.message }; }
  if (got.error) { o.err.write(`✗ ${got.error}\n`); return 1; }
  const ms = filterMetrics(got.point.metrics, o);
  if (o.json) { o.out.write(JSON.stringify({ ...got.point, metrics: ms }) + '\n'); return 0; }
  if (!ms.length) { o.err.write(`✗ no metric matches${o.phase ? ` phase ${o.phase}` : ''}${o.venue ? ` venue ${o.venue}` : ''}\n`); return 1; }
  for (const m of ms) o.out.write(logLine(m) + '\n');
  const nulls = ms.filter((m) => m.value === null).length;
  o.err.write(`${ms.length} metrics, ${nulls} null · read_at ${new Date(got.point.read_at * 1000).toISOString()} · ${got.source}\n`);
  return 0;
}
