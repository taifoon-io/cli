// The terminal face of the Taifoon coordination layer, modelled on open-mamba's `mamba` (crates/mamba-cli/src/brand.rs):
// a semantic palette mapped onto 24-bit ANSI, a mark and wordmark, and the chrome every screen is built from (rule, panel,
// table, status pill, status bar). Colour means something before it decorates: teal is the layer, green live, amber a
// devnet/claim/plan, red blocked or failed, violet a decision only the owner makes, faint is metadata.
// Colour is off off a TTY, under NO_COLOR, TERM=dumb or --no-color (FORCE_COLOR forces it), the rule @taifoon/term uses.
import { colorOn, stripAnsi } from '@taifoon/term';

const rgb = (r, g, b) => (s) => `\u001b[38;2;${r};${g};${b}m${s}\u001b[39m`;
const INK = {
  accent: rgb(79, 192, 203), // #4FC0CB the layer
  live: rgb(91, 201, 138), // #5BC98A live, ok
  part: rgb(224, 174, 90), // #E0AE5A devnet, a plan, a claim awaiting proof
  miss: rgb(240, 130, 118), // #F08276 blocked, failed
  you: rgb(183, 162, 240), // #B7A2F0 the owner's decision
  ink: rgb(228, 234, 236), // #E4EAEC primary text
  muted: rgb(154, 170, 178), // #9AAAB2 body
  faint: rgb(107, 122, 130), // #6B7A82 metadata
  line: rgb(42, 53, 59), // #2A353B borders
};
const id = (s) => String(s);

/** The palette for one stream: identity functions when colour is off. */
export function brand(stream, env = process.env, force) {
  const on = force === undefined ? colorOn(stream, env) : !!force;
  const p = { on };
  for (const [k, f] of Object.entries(INK)) p[k] = on ? (s) => f(String(s)) : id;
  p.bold = on ? (s) => `\u001b[1m${s}\u001b[22m` : id;
  return p;
}

/** Visible width: ANSI codes take no columns; wide chars are rare here and counted as one. */
export const vis = (s) => [...stripAnsi(String(s))].length;
/** Left-align to a visible width. */
export const pad = (s, w) => { const t = String(s); return t + ' '.repeat(Math.max(0, w - vis(t))); };
/** Middle-truncate plain text to a visible width, keeping both ends; coloured text is returned as is. */
export function elide(s, max) {
  const t = String(s);
  if (vis(t) <= max || t.includes('\u001b')) return t;
  const keep = Math.max(1, Math.floor((max - 1) / 2)); const c = [...t];
  return c.slice(0, keep).join('') + '…' + c.slice(c.length - keep).join('');
}
/** Cut plain text at the end to a visible width. */
export const clip = (s, max) => { const c = [...String(s)]; return c.length <= max ? String(s) : c.slice(0, Math.max(1, max - 1)).join('') + '…'; };

/** the screen width every panel and table fits: the terminal's columns, else COLUMNS, else 120 (a pipe); set once per run */
export let WIDTH = 100;
export function setWidth(out, env = process.env) { WIDTH = Math.max(72, Math.min(160, Number(out?.columns) || Number(env.COLUMNS) || 120)); return WIDTH; }

export const WORDMARK = [
  ' ▀█▀ ▄▀█ █ █▀▀ █▀█ █▀█ █▄ █',
  '  █  █▀█ █ █▀  █▄█ █▄█ █ ▀█',
];
export const MARK = [
  '  ▄▀▀▀▄▄ ',
  ' █ ▄▀▄ █ ',
  '  ▀▄▄▄▀▀ ',
];

/** The splash: mark and wordmark, the positioning line, and the session rows. */
export function banner(p, rows = []) {
  const out = [];
  for (let i = 0; i < 3; i++) out.push(`${p.accent(MARK[i])}  ${i < 2 ? p.bold(p.accent(WORDMARK[i])) : p.faint('coordination layer · one API for agents, pools and markets')}`);
  out.push('');
  for (const [k, v] of rows) out.push(`  ${p.faint(pad(k, 9))} ${v}`);
  return out.join('\n');
}

/** `── title ─────` */
export function rule(p, title, width = WIDTH) {
  const head = `── ${title} `;
  return p.faint(head + '─'.repeat(Math.max(3, width - vis(head))));
}

/** A rounded panel; every row closes at the same column, coloured or not. */
export function panel(p, title, body, width = WIDTH) {
  const inner = width - 2;
  const head = `╭─ ${title} `;
  const out = [p.line(head + '─'.repeat(Math.max(1, width - vis(head) - 1)) + '╮')];
  for (const raw of body) {
    const b = vis(raw) > inner - 1 ? clip(stripAnsi(raw), inner - 1) : raw;
    out.push(`${p.line('│')} ${b}${' '.repeat(Math.max(0, inner - vis(b) - 1))}${p.line('│')}`);
  }
  out.push(p.line('╰' + '─'.repeat(width - 2) + '╯'));
  return out.join('\n');
}

/** Status words, coloured by meaning. */
export function pill(p, status) {
  const s = String(status ?? '');
  const c = /^(live|ok|ready|hireable|open|listed|found|settled|done)/i.test(s) ? p.live
    : /^(devnet|plan|pending|warn|discover|design|thin|not open)/i.test(s) ? p.part
      : /^(blocked|fail|refused|closed|unreadable|revoked|no )/i.test(s) ? p.miss
        : /^(yes|decide|owner)/i.test(s) ? p.you : p.muted;
  return c(s);
}

/**
 * A table fitted to `width`: columns keep their natural width until the row is too wide, then the widest flexible column
 * (flex: true) is clipped. cols: [{ key, title, align?, flex?, fmt?(v,row) }]
 */
export function table(p, cols, rows, width = WIDTH) {
  const cell = (c, r) => { const v = c.fmt ? c.fmt(r[c.key], r) : r[c.key]; return v === null || v === undefined || v === '' ? p.faint('—') : String(v); };
  const cells = rows.map((r) => cols.map((c) => cell(c, r)));
  const w = cols.map((c, i) => Math.max(vis(c.title), ...cells.map((row) => vis(row[i]))));
  const total = () => w.reduce((a, b) => a + b, 0) + 2 * (cols.length - 1) + 2;
  while (total() > width) {
    const flex = cols.map((c, i) => (c.flex ? i : -1)).filter((i) => i >= 0);
    if (!flex.length) break;
    const i = flex.reduce((a, b) => (w[b] > w[a] ? b : a));
    if (w[i] <= 12) break;
    w[i] -= 1;
  }
  const fit = (s, i) => (vis(s) > w[i] ? clip(stripAnsi(s), w[i]) : s);
  const line = (vals) => '  ' + vals.map((v, i) => (cols[i].align === 'right' ? ' '.repeat(Math.max(0, w[i] - vis(fit(v, i)))) + fit(v, i) : pad(fit(v, i), w[i]))).join('  ').replace(/\s+$/, '');
  return [p.faint(line(cols.map((c) => c.title.toUpperCase()))), ...cells.map(line)].join('\n');
}

/** Key → value rows, aligned. */
export function kv(p, rows, keyWidth = 14) {
  return rows.filter(Boolean).map(([k, v]) => `  ${p.faint(pad(k, keyWidth))} ${v ?? p.faint('—')}`).join('\n');
}

/** The status bar the shell draws above its prompt: network, session, key. */
export function statusBar(p, s) {
  const net = s.net === null || s.net === undefined ? p.faint('network ?') : s.net.ok ? p.live(`● ${s.host} ${s.net.ms} ms`) : p.miss(`● ${s.host} ${s.net.status ?? 'no answer'}`);
  const who = s.mode === 'key' ? p.accent(`key ${s.prefix ?? '?'}${s.label ? ` · ${clip(s.label, 24)}` : ''}`) : s.mode === 'env' ? p.accent(`key from env ${s.prefix ?? ''}`) : p.part('guest · visitor budget');
  const owner = s.owner ? p.you(`owner ${s.owner}`) : null;
  const plans = s.plans ? p.part(`${s.plans} plan${s.plans === 1 ? '' : 's'} pending`) : null;
  return '  ' + [net, who, owner, plans, p.faint(`profile ${s.profile}`)].filter(Boolean).join(p.faint('  │  '));
}

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const promptText = (p, profile) => `${p.accent('taifoon')}${profile && profile !== 'default' ? p.faint(`:${profile}`) : ''} ${p.accent('❯')} `;
