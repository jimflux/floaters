import { describe, it, expect, beforeEach, vi } from "vitest";

// Mutable data the mocked Supabase serves, set per test.
const state = vi.hoisted(() => ({
  accounts: [] as Record<string, unknown>[],
  acrec: [] as Record<string, unknown>[],
  acpay: [] as Record<string, unknown>[],
  scenarioItems: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => {
  // A chainable, thenable query-builder stub. Records .eq("type", ...) so we can
  // tell ACCREC invoices from ACCPAY bills.
  function makeBuilder(resolve: (f: Record<string, unknown>) => unknown[]) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => ((filters[c] = v), builder),
      in: (c: string, v: unknown) => ((filters[`in_${c}`] = v), builder),
      or: () => builder,
      order: () => builder,
      then: (onF: (r: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve({ data: resolve(filters), error: null }).then(onF, onR),
    };
    return builder;
  }

  return {
    supabase: {
      from: (table: string) =>
        makeBuilder((filters) => {
          if (table === "xero_accounts") return state.accounts;
          if (table === "xero_invoices")
            return filters.type === "ACCREC" ? state.acrec : state.acpay;
          if (table === "scenario_items") return state.scenarioItems;
          return [];
        }),
    },
  };
});

import { computeForecast, getOccurrences } from "./engine";

describe("getOccurrences", () => {
  it("expands a monthly recurrence across the range", () => {
    expect(
      getOccurrences("monthly", "2026-01-15", null, "2026-01-01", "2026-04-30")
    ).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("returns a single date for 'once' when in range", () => {
    expect(
      getOccurrences("once", "2026-02-10", null, "2026-01-01", "2026-12-31")
    ).toEqual(["2026-02-10"]);
  });

  it("counts weekly occurrences", () => {
    expect(
      getOccurrences("weekly", "2026-01-01", null, "2026-01-01", "2026-01-31")
    ).toHaveLength(5);
  });

  it("caps at end_date", () => {
    expect(
      getOccurrences("monthly", "2026-01-01", "2026-02-28", "2026-01-01", "2026-12-31")
    ).toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("excludes occurrences before the range start", () => {
    const dates = getOccurrences(
      "monthly",
      "2025-11-15",
      null,
      "2026-01-01",
      "2026-02-28"
    );
    expect(dates).toEqual(["2026-01-15", "2026-02-15"]);
  });
});

describe("computeForecast", () => {
  beforeEach(() => {
    state.accounts = [{ current_balance: 1000 }];
    state.acrec = [];
    state.acpay = [];
    state.scenarioItems = [];
  });

  it("sums invoice inflows and bill outflows into the period balance", async () => {
    state.acrec = [
      { amount_due: 500, due_date: "2026-07-10", expected_payment_date: null },
    ];
    state.acpay = [
      { amount_due: 200, due_date: "2026-07-20", expected_payment_date: null },
    ];

    const periods = await computeForecast(
      "conn",
      "monthly",
      "2026-07-01",
      "2026-07-31"
    );

    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      opening: 1000,
      inflows: 500,
      outflows: 200,
      closing: 1300,
    });
  });

  it("uses expected_payment_date over due_date when present", async () => {
    state.acrec = [
      // due in August, but expected in July — should land in the July period.
      { amount_due: 900, due_date: "2026-08-05", expected_payment_date: "2026-07-15" },
    ];

    const [july, august] = await computeForecast(
      "conn",
      "monthly",
      "2026-07-01",
      "2026-08-31"
    );

    expect(july.inflows).toBe(900);
    expect(august.inflows).toBe(0);
    expect(august.opening).toBe(1900); // carries the July closing forward
  });

  it("starts from the summed BANK balances", async () => {
    state.accounts = [{ current_balance: 250 }, { current_balance: 750 }];
    const [period] = await computeForecast("conn", "monthly", "2026-07-01", "2026-07-31");
    expect(period.opening).toBe(1000);
  });
});
