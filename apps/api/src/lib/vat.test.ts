import { describe, it, expect } from "vitest";
import {
  VAT_FACTOR,
  quarterEndForMonth,
  paymentMonthForQuarterEnd,
  paymentMonthForMonth,
  seedVatableFromTax,
  resolveVatable,
  invoiceOutputVat,
  projectionVatByMonth,
  computeVat,
} from "./vat";
import type { ProjectionRow, AssignedInvoice } from "./pipeline";

function projection(amount: number, expectedMonth: string, recurrence = 1): ProjectionRow {
  return {
    amount,
    expected_month: expectedMonth,
    recurrence_count: recurrence,
    escalation_pct: 0,
    escalation_every: null,
  } as unknown as ProjectionRow;
}

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

describe("invoiceOutputVat", () => {
  it("uses the real Xero tax when known (AE1), preserving a genuine zero", () => {
    expect(invoiceOutputVat(200, 1200, true)).toBe(200);
    expect(invoiceOutputVat(0, 1200, true)).toBe(0); // IKEA, zero-rated
    expect(invoiceOutputVat(200, 1200, false)).toBe(200); // real tax is authoritative
  });
  it("falls back to a VATable-aware estimate when tax is NULL (AE7)", () => {
    expect(invoiceOutputVat(null, 1200, true)).toBeCloseTo(200, 6); // 1200 * 1/6
    expect(invoiceOutputVat(null, 1200, false)).toBe(0); // never invents VAT
  });
});

describe("projectionVatByMonth", () => {
  it("accrues 1/6 of a single VATable projection remainder (AE2)", () => {
    const m = projectionVatByMonth(projection(6000, "2026-07"), [], "2026-06");
    expect(m.get("2026-07")).toBeCloseTo(1000, 6);
  });
  it("accrues only on the residual after in-series consumption", () => {
    const assigned: AssignedInvoice[] = [{ status: "AUTHORISED", total: 3000 }];
    const m = projectionVatByMonth(projection(6000, "2026-07"), assigned, "2026-06");
    expect(m.get("2026-07")).toBeCloseTo(500, 6); // (6000-3000) * 1/6
  });
  it("caps at the projection-level residual when an invoice buckets outside the series", () => {
    // 3 occurrences x 6000 = 18000; a 6000 invoice bucketed to 2026-09 (outside
    // Jun/Jul/Aug) raises consumedTotal but decrements no occurrence remainder.
    // Projected VAT must be (18000-6000)*1/6 = 2000, not 3 x 1000 = 3000.
    const assigned: AssignedInvoice[] = [{ status: "AUTHORISED", total: 6000, bucketMonth: "2026-09" }];
    const m = projectionVatByMonth(projection(6000, "2026-06", 3), assigned, "2026-06");
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(2000, 1); // ~2000; per-occurrence rounding drifts a penny
    expect(total).toBeLessThan(3000); // the point: capped, not 3 x 1000
  });
  it("skips lapsed occurrences so VAT is never accrued into a closed quarter", () => {
    const m = projectionVatByMonth(projection(6000, "2026-01", 3), [], "2026-06"); // Jan-Mar all past
    expect(m.size).toBe(0);
  });
});

describe("computeVat", () => {
  const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

  it("places a committed bill at the payment month and shows it in the VAT row (AE3)", () => {
    const r = computeVat({
      months,
      currentMonthIndex: 0, // current = 2026-06
      committedVatByIssueMonth: new Map([["2026-07", 30000]]), // Jun-Aug quarter, pays 2026-10
      projectedVatByExpectedMonth: new Map(),
      paidQuarters: new Set(),
    });
    expect(r.committedBillByMonth.get("2026-10")).toBe(30000);
    expect(r.vatRow[months.indexOf("2026-10")]).toBe(30000);
  });

  it("owes the open quarter's VAT now and drops to zero at the payment month (AE5 continuity)", () => {
    const r = computeVat({
      months,
      currentMonthIndex: 0,
      committedVatByIssueMonth: new Map([["2026-06", 18000]]),
      projectedVatByExpectedMonth: new Map(),
      paidQuarters: new Set(),
    });
    expect(r.vatOwedNow).toBe(18000);
    expect(r.committedLiability[months.indexOf("2026-09")]).toBe(18000);
    expect(r.committedLiability[months.indexOf("2026-10")]).toBe(0); // paid → nets out
  });

  it("keeps projected VAT off the committed walk (AE9)", () => {
    const r = computeVat({
      months,
      currentMonthIndex: 0,
      committedVatByIssueMonth: new Map(),
      projectedVatByExpectedMonth: new Map([["2026-07", 1000]]),
      paidQuarters: new Set(),
    });
    expect(r.committedBillByMonth.size).toBe(0);
    expect(r.vatOwedNow).toBe(0);
    expect(r.optimisticExtraByMonth.get("2026-10")).toBe(1000);
    // The projected row carries the projected bill even though the committed row is £0.
    expect(r.vatRow[months.indexOf("2026-10")]).toBe(0);
    expect(r.vatRowProjected[months.indexOf("2026-10")]).toBe(1000);
  });

  it("shows issued + projected VAT in the projected row for a mixed quarter", () => {
    const r = computeVat({
      months,
      currentMonthIndex: 0,
      committedVatByIssueMonth: new Map([["2026-07", 30000]]), // Jun-Aug quarter, pays 2026-10
      projectedVatByExpectedMonth: new Map([["2026-08", 1000]]), // same quarter
      paidQuarters: new Set(),
    });
    const oct = months.indexOf("2026-10");
    expect(r.vatRow[oct]).toBe(30000); // committed view: issued only
    expect(r.vatRowProjected[oct]).toBe(31000); // projected view: issued + projected
  });

  it("treats a past-due quarter as already paid (no outflow, nets out of liability)", () => {
    const r = computeVat({
      months,
      currentMonthIndex: 3, // current = 2026-09
      committedVatByIssueMonth: new Map([["2026-04", 5000]]), // Mar-May quarter, paid 2026-07 (past)
      projectedVatByExpectedMonth: new Map(),
      paidQuarters: new Set(),
    });
    expect(r.committedBillByMonth.size).toBe(0);
    expect(r.vatOwedNow).toBe(0);
  });

  it("suppresses a quarter's bill once it is marked paid", () => {
    const r = computeVat({
      months,
      currentMonthIndex: 0,
      committedVatByIssueMonth: new Map([["2026-06", 18000]]),
      projectedVatByExpectedMonth: new Map(),
      paidQuarters: new Set(["2026-08"]), // open quarter marked paid
    });
    expect(r.committedBillByMonth.size).toBe(0);
    expect(r.vatOwedNow).toBe(0);
  });
});
