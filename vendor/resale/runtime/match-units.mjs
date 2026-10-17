// _MATCH_UNITS_v1_ + _MATCH_FEE_MODULE_v1_ (coord lang/cue/match-terms.cue → lang/gen/match-terms.json, vendored by `coord gen`):
// the JS twin of coordpipe matcher::normalize and of the fee module per venue. One table, tested on its own vectors. Pure.
import TERMS from './coord-lang/match-terms.json' with { type: 'json' };

export { TERMS };
export const LANE_ORDER = ['compute', 'grade', 'content', 'alert', 'rpc']; // the classes' order: the first unit holding offers is ranked
/** the canonical unit of a lane class, or null */
export const canonicalUnitOf = (cls) => TERMS.units.canonical[cls] ?? null;
/** price per canonical unit = round(price × per_canonical[unit] ÷ units_per_quote), half up; null when the class does not name `unit` */
export function normalize(cls, unit, price_micro, units_per_quote = 1) {
  const canon = TERMS.units.canonical[cls]; const per = TERMS.units.per_canonical[cls]?.[unit];
  if (!canon || !per || !(units_per_quote >= 1)) return null;
  const n = (BigInt(Math.round(price_micro)) * BigInt(per) * 2n + BigInt(units_per_quote)) / (2n * BigInt(units_per_quote));
  return { unit: canon, price_micro: Number(n) };
}
/** a capability's price per its class's canonical unit (null: held, never ranked) */
export const normalizedOf = (c) => normalize(c.class, c.unit, Number(c.price_micro), Number(c.units_per_quote ?? 1));
/** the fee module of a venue as the register names it: { rule, scheme_venue, reseller_bps, reseller, source, reason } (unknown when not named) */
export function feeTermsOf(venue) {
  const f = TERMS.fees[venue];
  if (!f) return { rule: 'unknown', scheme_venue: 'coord', reseller_bps: 0, reseller: null, source: 'lang/cue/match-terms.cue match_fees', reason: `venue ${venue} has no fee module in the register` };
  return { rule: f.rule, scheme_venue: f.scheme_venue, reseller_bps: f.reseller_bps ?? 0, reseller: f.reseller ?? null, source: f.source, reason: f.reason ?? null };
}
/** quoteSale's options for a venue's offer, or { unquoted: reason } when the rule cannot be computed at search time */
export function quoteTermsOf(venue) {
  const t = feeTermsOf(venue);
  if (t.rule === 'unknown' || t.rule === 'job_quote') return { unquoted: t.reason ?? t.rule, terms: t };
  return { terms: t, opts: { venue_out: t.scheme_venue, our_fee: { rule: t.rule }, ...(t.reseller_bps > 0 ? { reseller: { tenant: t.reseller ?? 'taifoon', markup_bps: t.reseller_bps } } : {}) } };
}
/** the seller's price for `units` of the offer's own unit: ceil(price × units ÷ units_per_quote) */
export const sellerPriceOf = (c, units = 1) => { const upq = BigInt(Math.max(1, Math.round(Number(c.units_per_quote ?? 1)))); const t = BigInt(Math.max(0, Math.round(Number(c.price_micro)))) * BigInt(Math.max(1, Math.round(units))); return (t + upq - 1n) / upq; };
