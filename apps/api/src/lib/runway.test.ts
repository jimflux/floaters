import { describe, expect, it } from "vitest";
import { zeroBalanceMonth } from "./runway";

describe("zero balance month beyond the chart horizon", () => {
  const base = { currentMonth: "2026-10", closingBalance: 9000, baselineNet: -1000 };
  it("finds the month that reaches exactly zero", () => {
    expect(zeroBalanceMonth({ ...base, extraNetByMonth: new Map() })).toBe("2027-07");
  });
  it("includes income after the chart ends before extrapolating spending", () => {
    expect(zeroBalanceMonth({ ...base, extraNetByMonth: new Map([["2027-03", 12000]]) })).toBe("2028-07");
  });
  it("does not let income after depletion erase the earlier crossing", () => {
    expect(zeroBalanceMonth({ ...base, extraNetByMonth: new Map([["2027-08", 12000]]) })).toBe("2027-07");
  });
  it("includes a one-off bill even with no ongoing spending", () => {
    expect(zeroBalanceMonth({ ...base, baselineNet: 0, extraNetByMonth: new Map([["2028-03", -10000]]) })).toBe("2028-03");
  });
  it("does not invent depletion without spending", () => {
    expect(zeroBalanceMonth({ ...base, baselineNet: 0, extraNetByMonth: new Map() })).toBeNull();
  });

  it("retains the annual payment month beyond the chart horizon", () => {
    expect(zeroBalanceMonth({
      currentMonth: "2026-10", closingBalance: 12000,
      baselineNetByCalendarMonth: [0, 0, -5000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      extraNetByMonth: new Map(),
    })).toBe("2029-03");
  });

  it("finds a seasonal dip even when the full year adds money", () => {
    expect(zeroBalanceMonth({
      currentMonth: "2026-12", closingBalance: 4000,
      baselineNetByCalendarMonth: [-5000, 6000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      extraNetByMonth: new Map([["2027-03", 10000]]),
    })).toBe("2027-01");
  });

  it("solves distant events without an arbitrary forecast horizon", () => {
    expect(zeroBalanceMonth({
      currentMonth: "2026-10", closingBalance: 12000,
      baselineNetByCalendarMonth: [100, -100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      extraNetByMonth: new Map([["1000000-03", -12000]]),
    })).toBe("1000000-03");
  });

  it("returns the current month when its closing balance is already depleted", () => {
    expect(zeroBalanceMonth({
      currentMonth: "2026-10", closingBalance: 0,
      baselineNetByCalendarMonth: Array(12).fill(100),
      extraNetByMonth: new Map(),
    })).toBe("2026-10");
  });

  it("matches an independent month-by-month ledger for seasonal income and costs", () => {
    const patterns = [
      [-600, 200, 50, 0, 0, 0, 100, 0, 0, 0, 0, 0],
      [-600, 700, 50, 0, 0, 0, 100, 0, 0, 0, 0, 0],
      [100, -100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      Array(12).fill(-12.345),
    ];
    for (const pattern of patterns) {
      for (const initial of [50, 600, 1400.005]) {
        for (const start of ["2026-01", "2026-07", "2026-12"]) {
          const extras = new Map([["2027-01", 400], ["2028-06", -2500.005]]);
          let balance = Math.round(initial * 100);
          let expected: string | null = null;
          const [year, month] = start.split("-").map(Number);
          // All negative-net cases here deplete within this independently
          // simulated window; nonnegative cycles cannot dip later once the
          // last event and one full safe cycle have passed.
          for (let offset = 1; offset <= 240; offset++) {
            const date = new Date(Date.UTC(year, month - 1 + offset, 1));
            const key = date.toISOString().slice(0, 7);
            balance += Math.round(pattern[date.getUTCMonth()] * 100)
              + Math.round((extras.get(key) ?? 0) * 100);
            if (balance <= 0) {
              expected = key;
              break;
            }
          }
          expect(zeroBalanceMonth({
            currentMonth: start, closingBalance: initial,
            baselineNetByCalendarMonth: pattern, extraNetByMonth: extras,
          })).toBe(expected);
        }
      }
    }
  });
});
