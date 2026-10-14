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
});
