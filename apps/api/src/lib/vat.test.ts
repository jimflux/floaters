import { describe, it, expect } from "vitest";
import {
  VAT_FACTOR,
  quarterEndForMonth,
  paymentMonthForQuarterEnd,
  paymentMonthForMonth,
  seedVatableFromTax,
  resolveVatable,
} from "./vat";

describe("VAT_FACTOR", () => {
  it("is 1/6 at the 20% rate, derived not hardcoded", () => {
    expect(VAT_FACTOR).toBeCloseTo(1 / 6, 10);
    expect(Math.round(6000 * VAT_FACTOR)).toBe(1000);
  });
});

describe("quarterEndForMonth", () => {
  it("maps each month to Flux's May/Aug/Nov/Feb quarter-ends", () => {
    expect(quarterEndForMonth("2026-03")).toBe("2026-05");
    expect(quarterEndForMonth("2026-05")).toBe("2026-05");
    expect(quarterEndForMonth("2026-06")).toBe("2026-08");
    expect(quarterEndForMonth("2026-08")).toBe("2026-08");
    expect(quarterEndForMonth("2026-09")).toBe("2026-11");
    expect(quarterEndForMonth("2026-11")).toBe("2026-11");
    expect(quarterEndForMonth("2026-01")).toBe("2026-02");
    expect(quarterEndForMonth("2026-02")).toBe("2026-02");
  });

  it("rolls December into the next February quarter", () => {
    expect(quarterEndForMonth("2026-12")).toBe("2027-02");
  });
});

describe("payment month", () => {
  it("is the second month after the quarter-end (1 month + 7 days)", () => {
    expect(paymentMonthForQuarterEnd("2026-05")).toBe("2026-07");
    expect(paymentMonthForQuarterEnd("2026-08")).toBe("2026-10");
    expect(paymentMonthForQuarterEnd("2026-11")).toBe("2027-01");
    expect(paymentMonthForQuarterEnd("2026-02")).toBe("2026-04");
  });

  it("resolves via the containing quarter for an arbitrary month", () => {
    expect(paymentMonthForMonth("2026-07")).toBe("2026-10"); // Jun-Aug quarter
    expect(paymentMonthForMonth("2026-12")).toBe("2027-04"); // Dec-Feb quarter
  });
});

describe("seedVatableFromTax", () => {
  it("is true when any known-tax invoice carries VAT", () => {
    expect(seedVatableFromTax([200, 0])).toBe(true);
    expect(seedVatableFromTax([null, 200])).toBe(true);
  });
  it("is false when all known-tax invoices are zero-rated", () => {
    expect(seedVatableFromTax([0, 0])).toBe(false);
  });
  it("is null (unknown) when there is nothing to judge from", () => {
    expect(seedVatableFromTax([])).toBeNull();
    expect(seedVatableFromTax([null, undefined])).toBeNull();
  });
});

describe("resolveVatable", () => {
  it("lets an explicit override win over the seed", () => {
    expect(resolveVatable(true, false)).toBe(true);
    expect(resolveVatable(false, true)).toBe(false);
  });
  it("uses the seed when there is no override", () => {
    expect(resolveVatable(undefined, true)).toBe(true);
    expect(resolveVatable(undefined, false)).toBe(false);
  });
  it("defaults VATable when unknown (no override, no seed)", () => {
    expect(resolveVatable(undefined, null)).toBe(true);
  });
});
