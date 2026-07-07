import { addMonthKey, expandProjection, type ProjectionRow, type AssignedInvoice } from "./pipeline";

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Committed output VAT for one issued invoice: the real Xero tax when known,
 * else a VATable-aware fallback. Never invents VAT on an un-backfilled
 * non-VATable invoice (IKEA), never misses it on a VATable one.
 */
export function invoiceOutputVat(
  totalTax: number | null | undefined,
  total: number,
  vatable: boolean
): number {
  if (totalTax !== null && totalTax !== undefined) return totalTax;
  return vatable ? total * VAT_FACTOR : 0;
}

/**
 * Projected VAT for one VATable projection, by expected month. Reuses
 * expandProjection's consumption-netted, lapse-aware occurrences, then caps the
 * total at the projection-level residual (amount minus ALL live assigned
 * invoices, including any that bucket outside the occurrence series) so an
 * out-of-series invoice still decays the projected VAT rather than
 * double-counting against the invoice's own real tax. Lapsed occurrences are
 * skipped, so VAT is never accrued into an already-closed quarter.
 */
export function projectionVatByMonth(
  row: ProjectionRow,
  assigned: AssignedInvoice[],
  currentMonth: string
): Map<string, number> {
  const { occurrences, amountTotal, consumedTotal } = expandProjection(row, assigned, currentMonth);
  const live = occurrences.filter((o) => !o.lapsed && o.remainder > 0);
  const liveSum = live.reduce((s, o) => s + o.remainder, 0);
  // The genuine residual after all consumption; caps out-of-series over-attribution.
  const projectionResidual = Math.max(0, round2(amountTotal - consumedTotal));
  const scale = liveSum > projectionResidual && liveSum > 0 ? projectionResidual / liveSum : 1;
  const byMonth = new Map<string, number>();
  for (const o of live) {
    const vat = o.remainder * scale * VAT_FACTOR;
    if (vat > 0) byMonth.set(o.month, round2((byMonth.get(o.month) ?? 0) + vat));
  }
  return byMonth;
}

export interface VatResult {
  // Payment-month -> VAT bill. Committed carries issued-invoice VAT only;
  // optimisticExtra is the projected-VAT delta the optimistic walk also drops.
  committedBillByMonth: Map<string, number>;
  optimisticExtraByMonth: Map<string, number>;
  // Running committed liability per months[] index (issued accrued minus paid),
  // present-and-future only (0 before the current month). Drives the adjusted
  // line and equals "VAT owed now" at the current month.
  committedLiability: number[];
  vatOwedNow: number;
  // Committed VAT bill per months[] index, for the display cost row.
  vatRow: number[];
}

/**
 * Assemble the VAT bills, running committed liability and owed-now figure.
 *
 * committedVatByIssueMonth: issued-invoice output VAT summed by issue month.
 * projectedVatByExpectedMonth: projected VAT (VATable only) summed by expected month.
 *
 * A quarter is "settled" (already paid, sitting in cash history) when its
 * payment month is before the current month OR it is marked paid; those are not
 * projected as visible outflows. "Upcoming" quarters (payment month at/after
 * current, not marked paid) are projected at their payment month. The committed
 * walk drops by the committed bill; the optimistic walk drops by committed +
 * projected. Liability nets accrual against paid quarters so the adjusted line
 * (committedClosing - liability) stays continuous across payment months.
 */
export function computeVat(params: {
  months: string[];
  currentMonthIndex: number;
  committedVatByIssueMonth: Map<string, number>;
  projectedVatByExpectedMonth: Map<string, number>;
  paidQuarters: Set<string>;
}): VatResult {
  const { months, currentMonthIndex, committedVatByIssueMonth, projectedVatByExpectedMonth, paidQuarters } = params;
  const currentMonth = months[currentMonthIndex];

  // Aggregate committed and projected VAT by quarter-end.
  const committedByQuarter = new Map<string, number>();
  for (const [m, vat] of committedVatByIssueMonth) {
    const q = quarterEndForMonth(m);
    committedByQuarter.set(q, round2((committedByQuarter.get(q) ?? 0) + vat));
  }
  const projectedByQuarter = new Map<string, number>();
  for (const [m, vat] of projectedVatByExpectedMonth) {
    const q = quarterEndForMonth(m);
    projectedByQuarter.set(q, round2((projectedByQuarter.get(q) ?? 0) + vat));
  }

  const committedBillByMonth = new Map<string, number>();
  const optimisticExtraByMonth = new Map<string, number>();
  const vatRow = new Array(months.length).fill(0);
  const monthIndex = new Map(months.map((m, i) => [m, i]));

  const allQuarters = new Set<string>([...committedByQuarter.keys(), ...projectedByQuarter.keys()]);
  // Per quarter, whether it is settled (paid / in history) and its payment month.
  const quarterInfo = new Map<string, { paymentMonth: string; settled: boolean }>();
  for (const q of allQuarters) {
    const paymentMonth = paymentMonthForQuarterEnd(q);
    const settled = paymentMonth < currentMonth || paidQuarters.has(q);
    quarterInfo.set(q, { paymentMonth, settled });
    if (settled) continue;
    // Upcoming: place visible outflows at the payment month if it's in view.
    const committed = committedByQuarter.get(q) ?? 0;
    const projected = projectedByQuarter.get(q) ?? 0;
    if (committed !== 0) {
      committedBillByMonth.set(paymentMonth, round2((committedBillByMonth.get(paymentMonth) ?? 0) + committed));
    }
    if (projected !== 0) {
      optimisticExtraByMonth.set(paymentMonth, round2((optimisticExtraByMonth.get(paymentMonth) ?? 0) + projected));
    }
    const idx = monthIndex.get(paymentMonth);
    if (idx !== undefined && committed !== 0) vatRow[idx] = round2(vatRow[idx] + committed);
  }

  // Running committed liability: accrued (issued VAT, issue month <= i) minus
  // paid (settled quarters count throughout; upcoming quarters from their
  // payment month onward). Present-and-future only.
  const committedLiability = new Array(months.length).fill(0);
  for (let i = 0; i < months.length; i++) {
    if (i < currentMonthIndex) continue;
    let accrued = 0;
    for (const [m, vat] of committedVatByIssueMonth) {
      if (m <= months[i]) accrued += vat;
    }
    let paid = 0;
    for (const q of allQuarters) {
      const info = quarterInfo.get(q)!;
      const committed = committedByQuarter.get(q) ?? 0;
      if (info.settled || info.paymentMonth <= months[i]) paid += committed;
    }
    committedLiability[i] = round2(accrued - paid);
  }

  return {
    committedBillByMonth,
    optimisticExtraByMonth,
    committedLiability,
    vatOwedNow: committedLiability[currentMonthIndex] ?? 0,
    vatRow,
  };
}
