import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CashflowResponse } from "@floaters/types";

const state = vi.hoisted(() => ({
  bankAccounts: [] as Record<string, unknown>[],
  chartAccounts: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
  bankTxns: [] as Record<string, unknown>[],
  payments: [] as Record<string, unknown>[],
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
      in: (c: string, v: unknown) => ((filters[`in_${c}`] = v), builder),
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
            case "xero_invoices": {
              let rows = state.invoices;
              const inStatus = filters.in_status as string[] | undefined;
              if (inStatus) rows = rows.filter((r) => inStatus.includes(r.status as string));
              const inIds = filters.in_xero_id as string[] | undefined;
              if (inIds) rows = rows.filter((r) => inIds.includes(r.xero_id as string));
              return rows;
            }
            case "xero_payments":
              return state.payments;
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

// Shared fixture reset for every describe block in this file.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  state.bankAccounts = [{ current_balance: 10000 }];
    state.chartAccounts = [
      { code: "400", name: "Advertising", type: "OVERHEADS", status: "ACTIVE" },
      { code: "500", name: "Rent", type: "OVERHEADS", status: "ACTIVE" },
      { code: "200", name: "Sales", type: "REVENUE", status: "ACTIVE" },
      { code: "090", name: "Business Account", type: "BANK", status: "ACTIVE" },
    ];
  state.invoices = [];
  state.bankTxns = [];
  state.payments = [];
  state.hidden = [];
  state.overrides = [];
});

afterEach(() => vi.useRealTimers());

describe("cashflow route", () => {
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

describe("cash-basis history", () => {
  it("rolls an overdue unpaid invoice forward into the current month as projected", async () => {
    state.invoices = [
      {
        xero_id: "inv-old",
        type: "ACCREC",
        total: 4000,
        amount_due: 4000,
        due_date: "2026-03-10",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "200", LineAmount: 4000 }],
      },
    ];
    const res = await run();
    const sales = res.cashIn.find((a) => a.accountCode === "200")!;
    expect(sales.monthly[0]).toBe(0); // May: no phantom income
    expect(sales.monthly[1]).toBe(4000); // June: rolled forward
    expect(sales.isProjected[1]).toBe(true);
  });

  it("excludes DRAFT invoices entirely", async () => {
    state.invoices = [
      {
        xero_id: "inv-draft",
        type: "ACCPAY",
        total: 900,
        amount_due: 900,
        due_date: "2026-07-10",
        status: "DRAFT",
        line_items: [{ AccountCode: "400", LineAmount: 900 }],
      },
    ];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "400")).toBeUndefined();
  });

  it("projects only the remaining amount of a partially-paid invoice, pro rata", async () => {
    state.invoices = [
      {
        xero_id: "inv-part",
        type: "ACCPAY",
        total: 1200,
        amount_due: 600,
        due_date: "2026-07-20",
        status: "AUTHORISED",
        line_items: [
          { AccountCode: "400", LineAmount: 600 },
          { AccountCode: "500", LineAmount: 400 },
        ],
      },
    ];
    const res = await run();
    const advertising = res.cashOut.find((a) => a.accountCode === "400")!;
    const rent = res.cashOut.find((a) => a.accountCode === "500")!;
    expect(advertising.monthly[2]).toBe(360); // 600 remaining x 600/1000
    expect(rent.monthly[2]).toBe(240); // 600 remaining x 400/1000
  });

  it("uses expected_payment_date over due_date for projection month", async () => {
    state.invoices = [
      {
        xero_id: "inv-exp",
        type: "ACCREC",
        total: 1000,
        amount_due: 1000,
        due_date: "2026-06-20",
        expected_payment_date: "2026-07-05",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "200", LineAmount: 1000 }],
      },
    ];
    const res = await run();
    const sales = res.cashIn.find((a) => a.accountCode === "200")!;
    expect(sales.monthly[1]).toBe(0);
    expect(sales.monthly[2]).toBe(1000);
  });

  it("lands payments in their payment month, attributed via the invoice's line items", async () => {
    state.invoices = [
      {
        xero_id: "inv-paid",
        type: "ACCREC",
        total: 1000,
        amount_due: 0,
        due_date: "2026-04-10",
        status: "PAID",
        line_items: [
          { AccountCode: "200", LineAmount: 800 },
          { AccountCode: "201", LineAmount: 200 },
        ],
      },
    ];
    state.chartAccounts.push({ code: "201", name: "Consulting", type: "REVENUE", status: "ACTIVE" });
    state.payments = [
      {
        payment_type: "ACCRECPAYMENT",
        amount: 500,
        date: "2026-05-12",
        status: "AUTHORISED",
        invoice_xero_id: "inv-paid",
      },
    ];
    const res = await run();
    const sales = res.cashIn.find((a) => a.accountCode === "200")!;
    const consulting = res.cashIn.find((a) => a.accountCode === "201")!;
    expect(sales.monthly[0]).toBe(400); // 500 x 800/1000
    expect(consulting.monthly[0]).toBe(100); // 500 x 200/1000
    expect(sales.isProjected[0]).toBe(false);
  });

  it("excludes DELETED payments from every bucket", async () => {
    state.payments = [
      {
        payment_type: "ACCRECPAYMENT",
        amount: 500,
        date: "2026-05-12",
        status: "DELETED",
        invoice_xero_id: "inv-x",
      },
    ];
    const res = await run();
    expect(res.cashIn).toHaveLength(0);
    expect(res.netCashMovement[0]).toBe(0);
  });

  it("treats a SPEND transaction on a revenue account as reduced income", async () => {
    state.bankTxns = [
      {
        type: "SPEND",
        total: 250,
        date: "2026-05-20",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "200", LineAmount: 250 }],
      },
    ];
    const res = await run();
    const sales = res.cashIn.find((a) => a.accountCode === "200")!;
    expect(sales.monthly[0]).toBe(-250);
  });

  it("scales line items to the tax-inclusive document total", async () => {
    state.bankTxns = [
      {
        type: "SPEND",
        total: 1200,
        date: "2026-05-20",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "400", LineAmount: 1000 }],
      },
    ];
    const res = await run();
    const advertising = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(advertising.monthly[0]).toBe(1200);
  });

  it("falls back to UNCATEGORISED when line amounts sum to zero", async () => {
    state.bankTxns = [
      {
        type: "SPEND",
        total: 300,
        date: "2026-05-20",
        status: "AUTHORISED",
        line_items: [
          { AccountCode: "400", LineAmount: 150 },
          { AccountCode: "400", LineAmount: -150 },
        ],
      },
    ];
    const res = await run();
    const uncat = res.cashOut.find((a) => a.accountCode === "UNCATEGORISED")!;
    expect(uncat.monthly[0]).toBe(300);
  });

  it("excludes transfers and DELETED bank transactions from every bucket", async () => {
    state.bankTxns = [
      { type: "RECEIVE-TRANSFER", total: 900, date: "2026-05-05", status: "AUTHORISED", line_items: [] },
      { type: "SPEND-TRANSFER", total: 900, date: "2026-05-05", status: "AUTHORISED", line_items: [] },
      {
        type: "SPEND",
        total: 100,
        date: "2026-05-06",
        status: "DELETED",
        line_items: [{ AccountCode: "400", LineAmount: 100 }],
      },
    ];
    const res = await run();
    expect(res.cashIn).toHaveLength(0);
    expect(res.cashOut).toHaveLength(0);
    expect(res.netCashMovement[0]).toBe(0);
  });

  it("drops BANK-account lines and routes unknown codes to UNCATEGORISED", async () => {
    state.bankTxns = [
      {
        type: "SPEND",
        total: 500,
        date: "2026-05-20",
        status: "AUTHORISED",
        line_items: [
          { AccountCode: "090", LineAmount: 300 }, // own bank account: transfer leg
          { AccountCode: "999", LineAmount: 200 }, // unknown code
        ],
      },
    ];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "090")).toBeUndefined();
    const uncat = res.cashOut.find((a) => a.accountCode === "UNCATEGORISED")!;
    expect(uncat.monthly[0]).toBe(200);
  });
});

describe("current-month blend", () => {
  it("treats a current-month override as the expected month total", async () => {
    state.bankTxns = [
      {
        type: "SPEND",
        total: 3000,
        date: "2026-06-10",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "400", LineAmount: 3000 }],
      },
    ];
    state.overrides = [{ account_code: "400", month: "2026-06", amount: 5000 }];
    const res = await run();
    const advertising = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(advertising.monthly[1]).toBe(5000); // 3000 cash + 2000 remainder
    expect(advertising.hasOverride[1]).toBe(true);
    expect(advertising.isProjected[1]).toBe(true);
  });

  it("shows actual cash when it already exceeds the current-month override", async () => {
    state.bankTxns = [
      {
        type: "SPEND",
        total: 3000,
        date: "2026-06-10",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "400", LineAmount: 3000 }],
      },
    ];
    state.overrides = [{ account_code: "400", month: "2026-06", amount: 2000 }];
    const res = await run();
    const advertising = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(advertising.monthly[1]).toBe(3000);
    expect(advertising.hasOverride[1]).toBe(true);
    expect(advertising.isProjected[1]).toBe(false); // no projected component left
  });

  it("tops a cost account up to its 3-month average, but never invents income", async () => {
    state.bankTxns = [
      // Cost history: 900/month for Mar-May, 300 so far in June
      { type: "SPEND", total: 900, date: "2026-03-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 900 }] },
      { type: "SPEND", total: 900, date: "2026-04-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 900 }] },
      { type: "SPEND", total: 900, date: "2026-05-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 900 }] },
      { type: "SPEND", total: 300, date: "2026-06-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 300 }] },
      // Income history: 2000 in May, nothing yet in June
      { type: "RECEIVE", total: 2000, date: "2026-05-11", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 2000 }] },
    ];
    const res = await run();
    const advertising = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(advertising.monthly[1]).toBe(900); // 300 cash + 600 top-up to average
    expect(advertising.isProjected[1]).toBe(true);
    const sales = res.cashIn.find((a) => a.accountCode === "200")!;
    expect(sales.monthly[1]).toBe(0); // income is never invented
  });

  it("lets invoice data win over an override by presence, even when negative", async () => {
    state.invoices = [
      {
        xero_id: "inv-credit",
        type: "ACCPAY",
        total: -400,
        amount_due: -400,
        due_date: "2026-07-10",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "400", LineAmount: -400 }],
      },
    ];
    state.overrides = [{ account_code: "400", month: "2026-07", amount: 5000 }];
    const res = await run();
    const advertising = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(advertising.monthly[2]).toBe(-400);
    expect(advertising.hasOverride[2]).toBe(false);
  });

  it("ignores stale overrides on past months without creating phantom rows", async () => {
    state.overrides = [{ account_code: "400", month: "2026-05", amount: 5000 }];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "400")).toBeUndefined();
  });
});

describe("balance reconstruction", () => {
  it("reconciles every month and anchors the current month on today's balance", async () => {
    state.bankTxns = [
      // May: spent 1000
      { type: "SPEND", total: 1000, date: "2026-05-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 1000 }] },
      // June so far: received 2000
      { type: "RECEIVE", total: 2000, date: "2026-06-05", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 2000 }] },
    ];
    state.invoices = [
      // Overdue receivable rolled into June as projected
      {
        xero_id: "inv-late",
        type: "ACCREC",
        total: 4000,
        amount_due: 4000,
        due_date: "2026-05-10",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "200", LineAmount: 4000 }],
      },
    ];
    const res = await run();

    // Identity: closing - opening = net for every month
    for (let i = 0; i < res.months.length; i++) {
      expect(res.closingBalance[i] - res.openingBalance[i]).toBeCloseTo(res.netCashMovement[i], 2);
    }
    // Current month opens at today's balance minus cash-to-date (10000 - 2000)
    expect(res.openingBalance[1]).toBe(8000);
    // May holds only cash: no phantom income. It closed where June opened,
    // and opened 1000 higher (the month's spend)
    expect(res.netCashMovement[0]).toBe(-1000);
    expect(res.closingBalance[0]).toBe(8000);
    expect(res.openingBalance[0]).toBe(9000);
    // Current month closes at today's balance plus the projected remainder:
    // +4000 rolled-forward receivable, -333.33 cost forecast (3-month average
    // of May's 1000 spend) still expected this month
    expect(res.closingBalance[1]).toBeCloseTo(13666.67, 2);
    expect(res.currentBalance).toBe(10000);
  });

  it("keeps hidden accounts in the balance maths while hiding their rows", async () => {
    state.bankTxns = [
      { type: "SPEND", total: 1000, date: "2026-05-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 1000 }] },
    ];
    state.hidden = [{ account_code: "400" }];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "400")).toBeUndefined();
    expect(res.netCashMovement[0]).toBe(-1000);
    expect(res.openingBalance[0]).toBe(11000);
  });

  it("reports falling below zero this month when the projected month-end is negative", async () => {
    state.bankAccounts = [{ current_balance: 100 }];
    state.invoices = [
      {
        xero_id: "inv-bill",
        type: "ACCPAY",
        total: 500,
        amount_due: 500,
        due_date: "2026-06-25",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "400", LineAmount: 500 }],
      },
    ];
    const res = await run();
    expect(res.closingBalance[1]).toBe(-400);
    expect(res.fallsBelowZeroIn).toBe("This month");
  });

  it("survives a window with no history months", async () => {
    const res = (await GET({
      url: "http://localhost/api/cashflow?back=0&forward=1",
    } as Parameters<typeof GET>[0])) as unknown as CashflowResponse;
    expect(res.months).toEqual(["2026-06"]);
    expect(res.currentMonthIndex).toBe(0);
    expect(res.closingBalance[0]).toBe(10000);
    expect(res.openingBalance[0]).toBe(10000);
  });

  it("rejects invalid windows", async () => {
    const bad = (await GET({
      url: "http://localhost/api/cashflow?back=1&forward=0",
    } as Parameters<typeof GET>[0])) as unknown as { error: string };
    expect(bad.error).toBeDefined();

    const nonsense = (await GET({
      url: "http://localhost/api/cashflow?back=abc&forward=12",
    } as Parameters<typeof GET>[0])) as unknown as { error: string };
    expect(nonsense.error).toBeDefined();
  });
});
