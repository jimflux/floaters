import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CashflowResponse } from "@floaters/types";

const state = vi.hoisted(() => ({
  bankAccounts: [] as Record<string, unknown>[],
  chartAccounts: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
  bankTxns: [] as Record<string, unknown>[],
  hidden: [] as Record<string, unknown>[],
  overrides: [] as Record<string, unknown>[],
}));

// Identity helpers so GET returns the raw response object.
vi.mock("@/lib/api-helpers", () => ({
  requireConnection: async () => "conn",
  json: (data: unknown) => data,
  error: (message: string) => ({ error: message }),
  handleError: (err: unknown) => {
    throw err;
  },
}));

vi.mock("@/lib/supabase", () => {
  function makeBuilder(resolve: (f: Record<string, unknown>) => unknown[]) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => ((filters[c] = v), builder),
      neq: (c: string, v: unknown) => ((filters[`neq_${c}`] = v), builder),
      gte: () => builder,
      lte: () => builder,
      in: () => builder,
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
          switch (table) {
            case "xero_bank_transactions":
              return state.bankTxns;
            case "xero_invoices":
              return state.invoices;
            case "xero_accounts":
              return filters.type === "BANK" ? state.bankAccounts : state.chartAccounts;
            case "hidden_accounts":
              return state.hidden;
            case "projection_overrides":
              return state.overrides;
            default:
              return [];
          }
        }),
    },
  };
});

import { GET } from "./route";

// now = 15 June 2026 → with back=1, forward=2 the months are May/Jun/Jul, current = Jun (index 1).
const req = { url: "http://localhost/api/cashflow?back=1&forward=2" } as Parameters<typeof GET>[0];

async function run(): Promise<CashflowResponse> {
  return (await GET(req)) as unknown as CashflowResponse;
}

describe("cashflow route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    state.bankAccounts = [{ current_balance: 10000 }];
    state.chartAccounts = [
      { code: "400", name: "Advertising", type: "OVERHEADS", status: "ACTIVE" },
    ];
    state.invoices = [];
    state.bankTxns = [];
    state.hidden = [];
    state.overrides = [];
  });

  afterEach(() => vi.useRealTimers());

  it("builds May/Jun/Jul with Jun as the current month", async () => {
    const res = await run();
    expect(res.months).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(res.currentMonthIndex).toBe(1);
    expect(res.currentBalance).toBe(10000);
  });

  it("applies a manual override when there is no invoice for that future month", async () => {
    state.overrides = [{ account_code: "400", month: "2026-07", amount: 5000 }];
    const res = await run();
    const acct = res.cashOut.find((a) => a.accountCode === "400");
    expect(acct).toBeDefined();
    expect(acct!.monthly[2]).toBe(5000);
    expect(acct!.hasOverride[2]).toBe(true);
  });

  it("lets a real invoice win over a manual override for the same month", async () => {
    state.overrides = [{ account_code: "400", month: "2026-07", amount: 5000 }];
    state.invoices = [
      {
        type: "ACCPAY",
        total: 3000,
        amount_due: 3000,
        due_date: "2026-07-20",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "400", LineAmount: 3000 }],
      },
    ];
    const res = await run();
    const acct = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(acct.monthly[2]).toBe(3000); // invoice amount, not the 5000 override
    expect(acct.hasOverride[2]).toBe(false);
  });

  it("filters out hidden accounts", async () => {
    state.overrides = [{ account_code: "400", month: "2026-07", amount: 5000 }];
    state.hidden = [{ account_code: "400" }];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "400")).toBeUndefined();
    // still listed in the accounts info with hidden: true
    expect(res.accounts.find((a) => a.code === "400")?.hidden).toBe(true);
  });
});
