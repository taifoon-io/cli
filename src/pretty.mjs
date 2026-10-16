// _PRETTY_v1_: every answer the CLI prints on a terminal, in the stream view's language. The generic runner (and anything else that
// would dump JSON) hands its value here when stdout is a TTY: scalars aligned as key → value, lists of records as a table, nested
// records indented under a rule, hashes and addresses whole and in the layer's colour, states as pills, and a commerce agreement
// (taifoon.commerce.agreement.v1) as the stream draws it — the line and its ⚖ legs (@taifoon/term/stream). --json, or a pipe, keeps
// the JSON exactly as the layer answered. Pure given the palette.
import { AGREEMENT_SCHEMA, agreementLine, legsLine } from '@taifoon/term/stream';
import { clip, pad, pill, vis } from './brand.mjs';

const HEX = /^0x[0-9a-fA-F]{8,}$/;
const STATE = /^(live|ok|ready|open|listed|settled|done|paid|delivered|hired|pending|partial|missing|refused|failed|revoked|expired|blocked|closed|claimable|claimed|held_by_operator)$/i;
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const words = (k) => String(k).replace(/_/g, ' ');

function val(p, v, key = '') {
  if (v === null || v === undefined) return p.faint('—');
  if (typeof v === 'boolean') return v ? p.live('yes') : p.faint('no');
  if (typeof v === 'number') {
    // a unix time reads as a date; an id, a chain, a block or a sequence number reads as written (no thousands separators)
    if (/(_at|At|^at|time|Time|^ts)$/.test(key) && Number.isInteger(v) && v > 1e9 && v < 2e13) return p.muted(new Date(v < 2e10 ? v * 1000 : v).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'));
    if (/(^id$|_id$|Id$|chain|block|seq|index|nonce|epoch|leaf|^n$)/i.test(key)) return p.ink(String(v));
    return p.ink(v.toLocaleString('en-US', { maximumFractionDigits: 8 }));
  }
  const s = String(v);
  if (HEX.test(s)) return p.accent(s);
  if (/^https?:\/\//.test(s)) return p.accent(s);
  if (STATE.test(s) || /(^|_)(state|status)$/.test(key)) return pill(p, s);
  if (/(_at|^at|time|date)$/.test(key) && /^\d{4}-\d\d-\d\dT/.test(s)) return p.muted(s.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC'));
  return p.ink(s);
}

/** a list of flat records as a table (the columns every row shares, at most 7); null when the list is not table-shaped */
function asTable(p, rows, width) {
  if (!rows.length || !rows.every(isRec)) return null;
  const keys = Object.keys(rows[0]).filter((k) => rows.every((r) => scalar(r[k]) || r[k] === undefined)).slice(0, 7);
  if (keys.length < 2) return null;
  const cells = rows.map((r) => keys.map((k) => val(p, r[k], k)));
  const w = keys.map((k, i) => Math.min(48, Math.max(vis(words(k)), ...cells.map((c) => vis(c[i])))));
  const fit = (s, i) => (vis(s) > w[i] ? clip(String(s).replace(/\u001b\[[0-9;]*m/g, ''), w[i]) : s);
  const line = (vals) => `  ${vals.map((v, i) => pad(fit(v, i), w[i])).join('  ')}`.replace(/\s+$/, '');
  const out = [p.faint(line(keys.map((k) => words(k).toUpperCase()))), ...cells.map(line)];
  return out.map((l) => (vis(l) > width ? clip(l.replace(/\u001b\[[0-9;]*m/g, ''), width) : l)).join('\n');
}

/** the value as lines. opts: { width, depth, max (list rows shown) } */
export function pretty(p, v, { width = 120, depth = 0, max = 20, indent = '' } = {}) {
  const lines = [];
  if (isRec(v) && v.schema === AGREEMENT_SCHEMA) {
    lines.push(`${indent}${p.accent('⇄')} ${p.ink(agreementLine(v, { venue: true }))}`);
    const l = legsLine(v); if (l) lines.push(`${indent}  ${p.faint(`⚖ ${l}`)}`);
    return lines;
  }
  if (Array.isArray(v)) {
    if (!v.length) return [`${indent}${p.faint('none')}`];
    if (v.every(scalar)) return [`${indent}${v.slice(0, max * 3).map((x) => val(p, x)).join(p.faint(', '))}${v.length > max * 3 ? p.faint(` … ${v.length - max * 3} more`) : ''}`];
    const t = asTable(p, v.slice(0, max), width - indent.length);
    if (t) { lines.push(...t.split('\n').map((l) => indent + l)); }
    else v.slice(0, max).forEach((x, i) => { lines.push(`${indent}${p.faint(`${i + 1}.`)}`); lines.push(...pretty(p, x, { width, depth: depth + 1, max, indent: `${indent}   ` })); });
    if (v.length > max) lines.push(`${indent}${p.faint(`… ${v.length - max} more (--json has them all)`)}`);
    return lines;
  }
  if (!isRec(v)) return [`${indent}${val(p, v)}`];
  const entries = Object.entries(v).filter(([k, x]) => x !== undefined && k !== 'calls');
  const kw = Math.min(22, Math.max(4, ...entries.filter(([, x]) => scalar(x)).map(([k]) => words(k).length)));
  for (const [k, x] of entries) {
    if (scalar(x)) { lines.push(`${indent}${p.faint(pad(words(k), kw))}  ${val(p, x, k)}`); continue; }
    if (Array.isArray(x) && x.every(scalar)) { lines.push(`${indent}${p.faint(pad(words(k), kw))}  ${pretty(p, x, { width, max })[0].trimStart()}`); continue; }
    if (depth >= 4) { lines.push(`${indent}${p.faint(pad(words(k), kw))}  ${p.faint(clip(JSON.stringify(x), Math.max(20, width - kw - indent.length - 4)))}`); continue; }
    const n = Array.isArray(x) ? ` · ${x.length}` : '';
    lines.push(`${indent}${p.faint(`── ${words(k)}${n} `)}${p.line('─'.repeat(Math.max(3, Math.min(40, width - indent.length - vis(words(k)) - n.length - 4))))}`);
    lines.push(...pretty(p, x, { width, depth: depth + 1, max, indent: `${indent}  ` }));
  }
  return lines;
}
