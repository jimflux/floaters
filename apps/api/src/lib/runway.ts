import { addMonthKey } from "./pipeline";

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + tm - fm;
}

// Monthly forecast: explicit income, bills, overrides and VAT are sparse
// adjustments to a repeating calendar-year baseline. Solve complete cycles
// directly, including intra-year dips, with no arbitrary forecast horizon.
export function zeroBalanceMonth(params: {
  currentMonth: string;
  closingBalance: number;
  baselineNet?: number;
  /** January through December; takes precedence over baselineNet. */
  baselineNetByCalendarMonth?: number[];
  extraNetByMonth: Map<string, number>;
}): string | null {
  let month = params.currentMonth;
  let balance = Math.round(params.closingBalance * 100);
  if (balance <= 0) return month;
  const baseline = (params.baselineNetByCalendarMonth ?? Array(12).fill(params.baselineNet ?? 0))
    .map(value => Math.round(value * 100));
  if (baseline.length !== 12 || baseline.some(value => !Number.isFinite(value))) {
    throw new RangeError("Runway baseline must contain twelve finite monthly amounts");
  }

  // Prefix totals start in the month AFTER the supplied closing balance.
  // For each of the twelve positions, solve the first cycle in which its
  // closing balance reaches zero, then choose the earliest crossing.
  const cycleFrom = (from: string) => {
    const monthIndex = Number(from.split("-")[1]) % 12;
    const prefix = [0];
    for (let i = 0; i < 12; i++) prefix.push(prefix[i] + baseline[(monthIndex + i) % 12]);
    return prefix;
  };
  const crossing = (prefix: number[]) => {
    const annualNet = prefix[12];
    let first = Infinity;
    for (let i = 1; i <= 12; i++) {
      const firstYearBalance = balance + prefix[i];
      const cycles = firstYearBalance <= 0 ? 0
        : annualNet < 0 ? Math.ceil(firstYearBalance / -annualNet) : Infinity;
      first = Math.min(first, cycles * 12 + i);
    }
    return first;
  };

  const events = [...params.extraNetByMonth]
    .filter(([m]) => monthsBetween(params.currentMonth, m) > 0)
    .sort(([a], [b]) => monthsBetween(b, a));
  for (const [next, extra] of events) {
    const gap = monthsBetween(month, next) - 1;
    const prefix = cycleFrom(month);
    const first = crossing(prefix);
    if (first <= gap) return addMonthKey(month, first);
    const months = gap + 1;
    balance += Math.floor(months / 12) * prefix[12] + prefix[months % 12]
      + Math.round(extra * 100);
    month = next;
    if (balance <= 0) return month;
  }
  const first = crossing(cycleFrom(month));
  return Number.isFinite(first) ? addMonthKey(month, first) : null;
}
