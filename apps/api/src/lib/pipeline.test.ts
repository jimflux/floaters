import { describe, it, expect } from "vitest";
import {
  addMonthKey,
  occurrenceAmount,
  expandProjection,
  recurrenceCount,
  type ProjectionRow,
} from "./pipeline";

function projection(over: Partial<ProjectionRow>): ProjectionRow {
  return {
    id: "p1",
    client_label: "IKEA",
    contact_id: "c1",
    amount: 10000,
    expected_month: "2026-08",
    recurrence_count: 1,
    escalation_pct: 0,
    escalation_every: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("addMonthKey", () => {
  it("adds months, rolling the year over", () => {
    expect(addMonthKey("2026-08", 0)).toBe("2026-08");
    expect(addMonthKey("2026-08", 5)).toBe("2027-01");
    expect(addMonthKey("2026-11", 3)).toBe("2027-02");
    expect(addMonthKey("2026-01", 12)).toBe("2027-01");
  });
});

describe("occurrenceAmount (compounding escalation per block)", () => {
  it("is flat with no escalation", () => {
    expect(occurrenceAmount(10000, 0, 0, null)).toBe(10000);
    expect(occurrenceAmount(10000, 30, 5, 0)).toBe(10000);
    expect(occurrenceAmount(10000, 30, 0, 12)).toBe(10000);
  });

  it("steps up every N occurrences, compounding", () => {
    expect(occurrenceAmount(10000, 0, 5, 12)).toBe(10000);
    expect(occurrenceAmount(10000, 11, 5, 12)).toBe(10000);
    expect(occurrenceAmount(10000, 12, 5, 12)).toBe(10500);
    expect(occurrenceAmount(10000, 23, 5, 12)).toBe(10500);
    expect(occurrenceAmount(10000, 24, 5, 12)).toBe(11025);
  });
});

describe("recurrenceCount", () => {
  it("defaults a null/legacy row to 1 and floors below 1", () => {
    expect(recurrenceCount(projection({ recurrence_count: null }))).toBe(1);
    expect(recurrenceCount(projection({ recurrence_count: 0 }))).toBe(1);
    expect(recurrenceCount(projection({ recurrence_count: 6 }))).toBe(6);
  });
});

describe("expandProjection", () => {
  it("single occurrence preserves legacy consume-all behaviour regardless of invoice month", () => {
    const res = expandProjection(
      projection({ amount: 45000, expected_month: "2026-08", recurrence_count: 1 }),
      [{ status: "AUTHORISED", total: 20000, bucketMonth: "2026-03" }],
      "2026-07"
    );
    expect(res.occurrences).toHaveLength(1);
    expect(res.occurrences[0]).toMatchObject({ month: "2026-08", amount: 45000, consumed: 20000, remainder: 25000, lapsed: false });
    expect(res.remainderTotal).toBe(25000);
    expect(res.consumedTotal).toBe(20000);
    expect(res.amountTotal).toBe(45000);
  });

  it("expands a flat recurring series across the range", () => {
    const res = expandProjection(
      projection({ amount: 10000, expected_month: "2026-08", recurrence_count: 3 }),
      [],
      "2026-07"
    );
    expect(res.occurrences.map((o) => o.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(res.occurrences.every((o) => o.amount === 10000 && o.remainder === 10000)).toBe(true);
    expect(res.remainderTotal).toBe(30000);
    expect(res.amountTotal).toBe(30000);
    expect(res.lapsed).toBe(false);
  });

  it("applies compounding escalation across blocks", () => {
    const res = expandProjection(
      projection({ amount: 10000, expected_month: "2026-01", recurrence_count: 24, escalation_pct: 5, escalation_every: 12 }),
      [],
      "2025-12"
    );
    expect(res.occurrences[0].amount).toBe(10000);
    expect(res.occurrences[11].amount).toBe(10000);
    expect(res.occurrences[12].amount).toBe(10500);
    expect(res.occurrences[23].amount).toBe(10500);
    expect(res.amountTotal).toBe(12 * 10000 + 12 * 10500);
  });

  it("attributes consumption to the occurrence matching the invoice month (recurring)", () => {
    const res = expandProjection(
      projection({ amount: 10000, expected_month: "2026-08", recurrence_count: 3 }),
      [{ status: "AUTHORISED", total: 10000, bucketMonth: "2026-09" }],
      "2026-07"
    );
    const byMonth = Object.fromEntries(res.occurrences.map((o) => [o.month, o]));
    expect(byMonth["2026-08"].remainder).toBe(10000);
    expect(byMonth["2026-09"].remainder).toBe(0);
    expect(byMonth["2026-09"].consumed).toBe(10000);
    expect(byMonth["2026-10"].remainder).toBe(10000);
    expect(res.remainderTotal).toBe(20000);
  });

  it("excludes VOIDED/DELETED invoices from consumption but a live over-assign stays visible", () => {
    const res = expandProjection(
      projection({ amount: 10000, expected_month: "2026-08", recurrence_count: 1 }),
      [
        { status: "AUTHORISED", total: 12000, bucketMonth: "2026-08" },
        { status: "VOIDED", total: 9000, bucketMonth: "2026-08" },
      ],
      "2026-07"
    );
    expect(res.consumedTotal).toBe(12000); // voided excluded
    expect(res.occurrences[0].remainder).toBe(0); // floored
    expect(res.consumedTotal).toBeGreaterThan(res.amountTotal); // over-assigned
  });

  it("marks past occurrences with remainder as lapsed, current and future as not", () => {
    const res = expandProjection(
      projection({ amount: 5000, expected_month: "2026-05", recurrence_count: 3 }),
      [],
      "2026-07"
    );
    const byMonth = Object.fromEntries(res.occurrences.map((o) => [o.month, o]));
    expect(byMonth["2026-05"].lapsed).toBe(true);
    expect(byMonth["2026-06"].lapsed).toBe(true);
    expect(byMonth["2026-07"].lapsed).toBe(false);
    expect(res.lapsed).toBe(true);
  });

  it("an out-of-series assigned invoice counts toward consumedTotal but reduces no occurrence", () => {
    const res = expandProjection(
      projection({ amount: 10000, expected_month: "2026-08", recurrence_count: 2 }),
      [{ status: "AUTHORISED", total: 4000, bucketMonth: "2026-12" }],
      "2026-07"
    );
    expect(res.occurrences.every((o) => o.remainder === 10000)).toBe(true);
    expect(res.consumedTotal).toBe(4000);
    expect(res.remainderTotal).toBe(20000);
  });
});
