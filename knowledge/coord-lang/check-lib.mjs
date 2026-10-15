// _COORD_LANGUAGE_v1_ (PROPOSED): the studio workflow check as a pure function — a workflow is a list of block ids of
// lang/gen/studio-blocks.json; it passes when every step exists, consecutive steps connect (one's to-state is the next's
// from-state), every write's outlet is allowed by its transition and held by the grant, and it ends where asked. No I/O:
// the golden runner (check.mjs) and the consumers (the taifoon CLI's `workflow check` and its agent, via `coord gen`) pass the blocks.
export const stateOf = (b) => { const [, rest] = b.title.split(': '); const [from, to] = rest.split(' (')[0].split(' → '); return { from, to }; };
export function check(steps, { grant = [], outlet = null, ends_at = null } = {}, blocks = []) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const why = [];
  steps.forEach((s, i) => {
    const b = byId.get(s); if (!b) { why.push(`step ${i + 1}: no block ${s}`); return; }
    if (i > 0 && byId.get(steps[i - 1])) { const p = stateOf(byId.get(steps[i - 1])); if (p.to !== stateOf(b).from) why.push(`step ${i + 1}: ${p.to} does not lead to ${stateOf(b).from}`); }
    if (b.block === 'coord-send') { const o = outlet ?? b.outlets[0]; if (b.outlets.length && !b.outlets.includes(o)) why.push(`step ${i + 1}: outlet ${o} not on ${b.transition}`); if (b.outlets.length && !grant.includes(o)) why.push(`step ${i + 1}: outlet ${o} not granted`); }
  });
  const last = byId.get(steps.at(-1)); if (ends_at && last && stateOf(last).to !== ends_at) why.push(`ends at ${stateOf(last).to}, not ${ends_at}`);
  return why;
}
