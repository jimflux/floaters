import { addMonthKey } from "./pipeline";

// VAT modelling constants and the quarter calendar. Flux is on the standard
// accrual scheme; rate and quarter stagger are fixed facts of a single
// registration, so they live here as constants rather than editable config.

export const VAT_RATE = 20;
// Factor to pull the VAT out of a VAT-inclusive amount: 20/(100+20) = 1/6.
// Derived from the rate so it stays correct if the rate constant ever changes
// (never a hardcoded 1/6).
export const VAT_FACTOR = VAT_RATE / (100 + VAT_RATE);

// Flux's VAT quarters end 31 May, 31 Aug, 30 Nov and 28/29 Feb (HMRC stagger 3).
export const QUARTER_END_MONTHS = [2, 5, 8, 11] as const;

/**
 * The quarter-end month (yyyy-MM) that a given month falls into. Quarters run
 * Mar-May, Jun-Aug, Sep-Nov, Dec-Feb; December rolls into the next Feb quarter.
 */
export function quarterEndForMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  if (m <= 2) return `${y}-02`;
  if (m <= 5) return `${y}-05`;
  if (m <= 8) return `${y}-08`;
  if (m <= 11) return `${y}-11`;
  return `${y + 1}-02`;
}

/**
 * The month a quarter's VAT bill is paid: one calendar month and seven days
 * after the quarter-end, i.e. the 7th of the second month after the quarter-end
 * month (quarter ending 2026-08 pays ~7 Oct → 2026-10).
 */
export function paymentMonthForQuarterEnd(quarterEnd: string): string {
  return addMonthKey(quarterEnd, 2);
}

/** The payment month for the quarter that contains the given month. */
export function paymentMonthForMonth(yyyymm: string): string {
  return paymentMonthForQuarterEnd(quarterEndForMonth(yyyymm));
}

/**
 * Seed a client's VATable default from the tax on its real invoices:
 *   - true  if any invoice with a known tax carries VAT (> 0)
 *   - false if there are known-tax invoices and all are zero-rated (e.g. IKEA)
 *   - null  if there is nothing to judge from (no invoices, or all tax NULL) →
 *           the caller treats null as unknown and defaults VATable.
 * Only non-null tax values count, so an un-backfilled (NULL) invoice never
 * seeds a real VATable client as non-VATable.
 */
export function seedVatableFromTax(taxValues: Array<number | null | undefined>): boolean | null {
  const known = taxValues.filter((t): t is number => t !== null && t !== undefined);
  if (known.length === 0) return null;
  return known.some((t) => t > 0);
}

/**
 * Resolve a client's VATable status: an explicit override wins; else the seed;
 * else default VATable (pessimistic, matching the UNASSIGNED default) so an
 * unknown client never silently drops VAT and overstates cash.
 */
export function resolveVatable(explicit: boolean | undefined, seed: boolean | null): boolean {
  if (explicit !== undefined) return explicit;
  if (seed !== null) return seed;
  return true;
}

export interface VatState {
  enabled: boolean;
  paidQuarters: string[]; // quarter-end keys (yyyy-MM) whose bill is marked paid
}
