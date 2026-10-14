import { addMonthKey } from "./pipeline";

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + tm - fm;
}

// Monthly forecast: explicit income, bills, overrides and VAT are sparse
// events. Between them (and after the last), historical average costs carry
// on. Solve those gaps directly, so the date has no arbitrary chart horizon.
export function zeroBalanceMonth(params: {
  currentMonth: string;
  closingBalance: number;
  baselineNet: number;
  extraNetByMonth: Map<string, number>;
}): string | null {
  let month = params.currentMonth;
  let balance = Math.round(params.closingBalance * 100);
  const baseline = Math.round(params.baselineNet * 100);
  if (balance <= 0) return month;
  const crossing = () => baseline < 0 ? Math.ceil(balance / -baseline) : Infinity;
  const events = [...params.extraNetByMonth].filter(([m]) => m > month).sort(([a], [b]) => a.localeCompare(b));
  for (const [next, extra] of events) {
    const gap = monthsBetween(month, next) - 1;
    if (crossing() <= gap) return addMonthKey(month, crossing());
    balance += gap * baseline + baseline + Math.round(extra * 100);
    month = next;
    if (balance <= 0) return month;
  }
  return baseline < 0 ? addMonthKey(month, crossing()) : null;
}
