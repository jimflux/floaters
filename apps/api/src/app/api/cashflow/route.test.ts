import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CashflowResponse, IncomeClient } from "@floaters/types";

const state = vi.hoisted(() => ({
  bankAccounts: [] as Record<string, unknown>[],
  chartAccounts: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
  bankTxns: [] as Record<string, unknown>[],
  payments: [] as Record<string, unknown>[],
  hidden: [] as Record<string, unknown>[],
  overrides: [] as Record<string, unknown>[],
  projections: [] as Record<string, unknown>[],
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
      not: (c: string, op: string) => ((filters[`not_${c}_${op}`] = true), builder),
      is: (c: string, v: unknown) => ((filters[`is_${c}`] = v), builder),
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
              if (filters["not_projection_id_is"]) {
                rows = rows.filter((r) => r.projection_id != null);
              }
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
            case "income_projections":
              return state.projections;
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

function client(res: CashflowResponse, key: string): IncomeClient | undefined {
  return res.income.clients.find((c) => c.clientKey === key);
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
    { code: "300", name: "Interest", type: "OTHERINCOME", status: "ACTIVE" },
    { code: "090", name: "Business Account", type: "BANK", status: "ACTIVE" },
  ];
  state.invoices = [];
  state.bankTxns = [];
  state.payments = [];
  state.hidden = [];
  state.overrides = [];
  state.projections = [];
});

afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// Invariant helpers (the regression net for the section split — R13/R18)
// ---------------------------------------------------------------------------

// Committed identity + history reconciliation: closing − opening = net, both
// series identical over history, and optimistic − committed equals the
// cumulative projected remainders from the current month on.
function assertInvariants(res: CashflowResponse) {
  for (let i = 0; i < res.months.length; i++) {
    expect(res.committedClosing[i] - res.committedOpening[i]).toBeCloseTo(
      res.committedNet[i],
      2
    );
    if (i < res.currentMonthIndex) {
      expect(res.optimisticClosing[i]).toBeCloseTo(res.committedClosing[i], 2);
    }
  }
  let cumulative = 0;
  for (let i = res.currentMonthIndex; i < res.months.length; i++) {
    cumulative += res.income.totals.projected[i];
    expect(res.optimisticClosing[i] - res.committedClosing[i]).toBeCloseTo(
      cumulative,
      2
    );
  }
}

describe("cashflow route: window and shape", () => {
  it("builds May/Jun/Jul with Jun as the current month", async () => {
    const res = await run();
    expect(res.months).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(res.currentMonthIndex).toBe(1);
    expect(res.currentBalance).toBe(10000);
    expect(res.income.totals.paid).toHaveLength(3);
    expect(res.income.totals.invoiced).toHaveLength(3);
    expect(res.income.totals.projected).toHaveLength(3);
  });

  it("with no projections the two balance series are identical", async () => {
    state.bankTxns = [
      { type: "RECEIVE", total: 2000, date: "2026-06-05", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 2000 }] },
    ];
    const res = await run();
    for (let i = 0; i < res.months.length; i++) {
      expect(res.optimisticClosing[i]).toBe(res.committedClosing[i]);
    }
    expect(res.optimisticFallsBelowZeroIn).toBe(res.fallsBelowZeroIn);
    assertInvariants(res);
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

  it("survives a window with no history months", async () => {
    const res = (await GET({
      url: "http://localhost/api/cashflow?back=0&forward=1",
    } as Parameters<typeof GET>[0])) as unknown as CashflowResponse;
    expect(res.months).toEqual(["2026-06"]);
    expect(res.currentMonthIndex).toBe(0);
    expect(res.committedClosing[0]).toBe(10000);
    expect(res.committedOpening[0]).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// Income layers (the pipeline model)
// ---------------------------------------------------------------------------

describe("income: paid layer", () => {
  it("lands an ACCREC payment whole under its client at the payment month (R13)", async () => {
    state.invoices = [
      {
        xero_id: "inv-paid",
        type: "ACCREC",
        contact_id: "c-ikea",
        contact_name: "IKEA",
        total: 1000,
        amount_due: 0,
        due_date: "2026-04-10",
        status: "PAID",
        line_items: [
          { AccountCode: "200", LineAmount: 800 },
          { AccountCode: "400", LineAmount: 200 }, // expense recharge line
        ],
      },
    ];
    state.payments = [
      { payment_type: "ACCRECPAYMENT", amount: 1000, date: "2026-05-12", status: "AUTHORISED", invoice_xero_id: "inv-paid" },
    ];
    const res = await run();
    const ikea = client(res, "contact:c-ikea")!;
    expect(ikea.clientName).toBe("IKEA");
    expect(ikea.paid[0]).toBe(1000); // whole document, not the 800 revenue share
    // The recharge line no longer reduces costs (R13)
    expect(res.cashOut.find((a) => a.accountCode === "400")).toBeUndefined();
    // Month still reconciles: net is the real bank movement
    expect(res.committedNet[0]).toBe(1000);
    assertInvariants(res);
  });

  it("splits a partially-paid invoice across paid and invoiced layers (AE4)", async () => {
    state.invoices = [
      {
        xero_id: "inv-part",
        type: "ACCREC",
        contact_id: "c-acme",
        contact_name: "Acme",
        total: 12000,
        amount_due: 7000,
        due_date: "2026-07-20",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "200", LineAmount: 12000 }],
      },
    ];
    state.payments = [
      { payment_type: "ACCRECPAYMENT", amount: 5000, date: "2026-05-12", status: "AUTHORISED", invoice_xero_id: "inv-part" },
    ];
    const res = await run();
    const acme = client(res, "contact:c-acme")!;
    expect(acme.paid[0]).toBe(5000); // payment month
    expect(acme.invoiced[2]).toBe(7000); // remaining, due month
    assertInvariants(res);
  });

  it("routes non-invoice income to the UNASSIGNED paid layer, including OTHERINCOME (R7)", async () => {
    state.bankTxns = [
      { type: "RECEIVE", total: 500, date: "2026-05-20", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 500 }] },
      { type: "RECEIVE", total: 42, date: "2026-05-21", status: "AUTHORISED", line_items: [{ AccountCode: "300", LineAmount: 42 }] },
    ];
    const res = await run();
    const unassigned = client(res, "UNASSIGNED")!;
    expect(unassigned.paid[0]).toBe(542);
    // Interest is income, not a negative cost
    expect(res.cashOut.find((a) => a.accountCode === "300")).toBeUndefined();
    assertInvariants(res);
  });

  it("treats a SPEND transaction on a revenue account as negative paid income", async () => {
    state.bankTxns = [
      { type: "SPEND", total: 250, date: "2026-05-20", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 250 }] },
    ];
    const res = await run();
    expect(client(res, "UNASSIGNED")!.paid[0]).toBe(-250);
    expect(res.committedNet[0]).toBe(-250);
  });
});

describe("income: invoiced layer", () => {
  it("buckets an unpaid invoice at expected date over due date", async () => {
    state.invoices = [
      {
        xero_id: "inv-exp",
        type: "ACCREC",
        contact_id: "c-acme",
        contact_name: "Acme",
        total: 1000,
        amount_due: 1000,
        due_date: "2026-06-20",
        expected_payment_date: "2026-07-05",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "200", LineAmount: 1000 }],
      },
    ];
    const res = await run();
    const acme = client(res, "contact:c-acme")!;
    expect(acme.invoiced[1]).toBe(0);
    expect(acme.invoiced[2]).toBe(1000);
    expect(acme.overdue[2]).toBe(false);
  });

  it("floors an overdue invoice to the current month and flags it (R11)", async () => {
    state.invoices = [
      {
        xero_id: "inv-late",
        type: "ACCREC",
        contact_id: "c-slow",
        contact_name: "Slow Ltd",
        total: 4000,
        amount_due: 4000,
        due_date: "2026-03-10",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "200", LineAmount: 4000 }],
      },
    ];
    const res = await run();
    const slow = client(res, "contact:c-slow")!;
    expect(slow.invoiced[0]).toBe(0); // no phantom income in the past
    expect(slow.invoiced[1]).toBe(4000); // rolled into June
    expect(slow.overdue[1]).toBe(true);
    assertInvariants(res);
  });

  it("keeps DRAFT and VOIDED invoices out of every layer", async () => {
    state.invoices = [
      { xero_id: "d", type: "ACCREC", contact_id: "c1", contact_name: "X", total: 900, amount_due: 900, due_date: "2026-07-10", status: "DRAFT", line_items: [] },
      { xero_id: "v", type: "ACCREC", contact_id: "c1", contact_name: "X", total: 900, amount_due: 900, due_date: "2026-07-10", status: "VOIDED", line_items: [] },
    ];
    const res = await run();
    expect(res.income.clients).toHaveLength(0);
  });

  it("holds a post-dated ACCREC payment in the invoiced layer until its date passes (R18)", async () => {
    state.invoices = [
      {
        xero_id: "inv-post",
        type: "ACCREC",
        contact_id: "c-fut",
        contact_name: "Futura",
        total: 300,
        amount_due: 0,
        due_date: "2026-06-01",
        status: "PAID",
        line_items: [{ AccountCode: "200", LineAmount: 300 }],
      },
    ];
    state.payments = [
      { payment_type: "ACCRECPAYMENT", amount: 300, date: "2026-07-10", status: "AUTHORISED", invoice_xero_id: "inv-post" },
    ];
    const res = await run();
    const futura = client(res, "contact:c-fut")!;
    expect(futura.invoiced[2]).toBe(300); // expected, not banked
    expect(futura.paid[2]).toBe(0);
    expect(res.committedNet[2]).toBe(300);
    assertInvariants(res);

    // Clock passes the payment date → it becomes cash in the paid layer.
    vi.setSystemTime(new Date("2026-07-20T12:00:00.000Z"));
    const later = await run();
    const futuraLater = client(later, "contact:c-fut")!;
    expect(futuraLater.paid[1]).toBe(300); // July is now index 1 (back=1)
    expect(futuraLater.invoiced[1]).toBe(0);
  });
});

describe("income: projected layer and lapse", () => {
  const baseProjection = {
    id: "p1",
    client_label: "IKEA",
    contact_id: "c-ikea",
    amount: 45000,
    expected_month: "2026-07",
    created_at: "",
    updated_at: "",
  };

  it("nets an assigned invoice against the projection remainder across months (AE3)", async () => {
    state.projections = [{ ...baseProjection }];
    state.invoices = [
      {
        xero_id: "inv-a",
        type: "ACCREC",
        contact_id: "c-ikea",
        contact_name: "IKEA",
        projection_id: "p1",
        total: 20000,
        amount_due: 20000,
        due_date: "2026-06-25",
        status: "AUTHORISED",
        line_items: [{ AccountCode: "200", LineAmount: 20000 }],
      },
    ];
    const res = await run();
    const ikea = client(res, "contact:c-ikea")!;
    expect(ikea.invoiced[1]).toBe(20000); // due month (June)
    expect(ikea.projected[2]).toBe(25000); // remainder at expected month (July)
    expect(res.income.totals.projected[2]).toBe(25000);
    assertInvariants(res);
  });

  it("excludes VOIDED invoices from remainder consumption (R14)", async () => {
    state.projections = [{ ...baseProjection }];
    state.invoices = [
      { xero_id: "inv-v", type: "ACCREC", contact_id: "c-ikea", contact_name: "IKEA", projection_id: "p1", total: 20000, amount_due: 0, due_date: "2026-06-25", status: "VOIDED", line_items: [] },
    ];
    const res = await run();
    expect(client(res, "contact:c-ikea")!.projected[2]).toBe(45000);
  });

  it("keeps a projection in the optimistic layer in its expected month, drops it once lapsed (AE1)", async () => {
    state.projections = [{ ...baseProjection, expected_month: "2026-06" }];
    const res = await run();
    expect(client(res, "contact:c-ikea")!.projected[1]).toBe(45000);
    assertInvariants(res);

    // A month later it has lapsed: out of the optimistic line entirely.
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    const later = await run();
    expect(client(later, "contact:c-ikea")).toBeUndefined();
    expect(later.income.totals.projected.every((v) => v === 0)).toBe(true);
  });

  it("groups a contact-less projection under its normalised label (R15)", async () => {
    state.projections = [
      { id: "p2", client_label: "  New   Client ", contact_id: null, amount: 5000, expected_month: "2026-07", created_at: "", updated_at: "" },
    ];
    const res = await run();
    const row = client(res, "label:new client")!;
    expect(row.clientName).toBe("New Client");
    expect(row.projected[2]).toBe(5000);
  });

  it("separates committed and optimistic across cash, invoices, and projections (AE5)", async () => {
    state.bankTxns = [
      { type: "RECEIVE", total: 10000, date: "2026-05-05", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 10000 }] },
    ];
    state.invoices = [
      { xero_id: "inv-o", type: "ACCREC", contact_id: "c1", contact_name: "C1", total: 8000, amount_due: 8000, due_date: "2026-07-10", status: "AUTHORISED", line_items: [] },
    ];
    state.projections = [
      { id: "p3", client_label: "Hope", contact_id: null, amount: 30000, expected_month: "2026-07", created_at: "", updated_at: "" },
    ];
    const res = await run();
    expect(res.committedClosing[2]).toBe(18000); // 10000 today + 8000 invoiced
    expect(res.optimisticClosing[2]).toBe(48000); // + 30000 hope
    expect(res.fallsBelowZeroIn).toBeNull();
    assertInvariants(res);
  });

  it("headline drops-below reads committed; the optimistic date is separate", async () => {
    state.bankAccounts = [{ current_balance: 100 }];
    state.invoices = [
      { xero_id: "bill", type: "ACCPAY", total: 500, amount_due: 500, due_date: "2026-06-25", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 500 }] },
    ];
    state.projections = [
      { id: "p4", client_label: "Hope", contact_id: null, amount: 2000, expected_month: "2026-06", created_at: "", updated_at: "" },
    ];
    const res = await run();
    expect(res.committedClosing[1]).toBe(-400);
    expect(res.fallsBelowZeroIn).toBe("This month");
    expect(res.optimisticClosing[1]).toBe(1600);
    expect(res.optimisticFallsBelowZeroIn).toBeNull();
    assertInvariants(res);
  });

  it("ignores income projection overrides entirely (R12 cutover)", async () => {
    state.overrides = [{ account_code: "200", month: "2026-07", amount: 21000 }];
    const res = await run();
    expect(res.income.clients).toHaveLength(0);
    expect(res.income.totals.projected[2]).toBe(0);
    expect(res.committedClosing[2]).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// Costs: the account model is unchanged
// ---------------------------------------------------------------------------

describe("costs: unchanged account model", () => {
  it("applies a manual override when there is no invoice for that future month", async () => {
    state.overrides = [{ account_code: "400", month: "2026-07", amount: 5000 }];
    const res = await run();
    const acct = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(acct.monthly[2]).toBe(5000);
    expect(acct.hasOverride[2]).toBe(true);
  });

  it("lets a real bill win over a manual override by presence", async () => {
    state.overrides = [{ account_code: "400", month: "2026-07", amount: 5000 }];
    state.invoices = [
      { xero_id: "b1", type: "ACCPAY", total: 3000, amount_due: 3000, due_date: "2026-07-20", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 3000 }] },
    ];
    const res = await run();
    const acct = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(acct.monthly[2]).toBe(3000);
    expect(acct.hasOverride[2]).toBe(false);
  });

  it("projects only the remaining amount of a partially-paid bill, pro rata", async () => {
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
    expect(res.cashOut.find((a) => a.accountCode === "400")!.monthly[2]).toBe(360);
    expect(res.cashOut.find((a) => a.accountCode === "500")!.monthly[2]).toBe(240);
  });

  it("attributes ACCPAY payments via the bill's line items, direction from invoice type", async () => {
    state.invoices = [
      { xero_id: "bill-paid", type: "ACCPAY", total: 200, amount_due: 0, due_date: "2026-05-01", status: "PAID", line_items: [{ AccountCode: "400", LineAmount: 200 }] },
    ];
    state.payments = [
      { payment_type: null, amount: 200, date: "2026-05-12", status: "AUTHORISED", invoice_xero_id: "bill-paid" },
    ];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "400")!.monthly[0]).toBe(200);
    expect(res.committedNet[0]).toBe(-200);
    assertInvariants(res);
  });

  it("skips a payment whose direction is unknowable", async () => {
    state.payments = [
      { payment_type: null, amount: 200, date: "2026-05-12", status: "AUTHORISED", invoice_xero_id: "inv-ghost" },
    ];
    const res = await run();
    expect(res.income.clients).toHaveLength(0);
    expect(res.cashOut).toHaveLength(0);
    expect(res.committedNet[0]).toBe(0);
  });

  it("excludes DELETED payments from every bucket", async () => {
    state.payments = [
      { payment_type: "ACCRECPAYMENT", amount: 500, date: "2026-05-12", status: "DELETED", invoice_xero_id: "inv-x" },
    ];
    const res = await run();
    expect(res.income.clients).toHaveLength(0);
    expect(res.committedNet[0]).toBe(0);
  });

  it("tops a cost account up to its 3-month average, but never invents income", async () => {
    state.bankTxns = [
      { type: "SPEND", total: 900, date: "2026-03-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 900 }] },
      { type: "SPEND", total: 900, date: "2026-04-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 900 }] },
      { type: "SPEND", total: 900, date: "2026-05-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 900 }] },
      { type: "SPEND", total: 300, date: "2026-06-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 300 }] },
      { type: "RECEIVE", total: 2000, date: "2026-05-11", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 2000 }] },
    ];
    const res = await run();
    const advertising = res.cashOut.find((a) => a.accountCode === "400")!;
    expect(advertising.monthly[1]).toBe(900); // 300 cash + 600 top-up
    // No cost-average or override machinery invents income
    expect(res.income.totals.paid[1]).toBe(0);
    expect(res.income.totals.invoiced[1]).toBe(0);
  });

  it("scales line items to the tax-inclusive document total", async () => {
    state.bankTxns = [
      { type: "SPEND", total: 1200, date: "2026-05-20", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 1000 }] },
    ];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "400")!.monthly[0]).toBe(1200);
  });

  it("falls back to UNCATEGORISED when line amounts cancel to float noise", async () => {
    state.bankTxns = [
      {
        type: "SPEND",
        total: 300,
        date: "2026-05-20",
        status: "AUTHORISED",
        line_items: [
          { AccountCode: "400", LineAmount: 10.1 },
          { AccountCode: "400", LineAmount: 20.2 },
          { AccountCode: "400", LineAmount: 30.3 },
          { AccountCode: "400", LineAmount: -60.6 },
        ],
      },
    ];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "UNCATEGORISED")!.monthly[0]).toBe(300);
    expect(res.cashOut.find((a) => a.accountCode === "400")).toBeUndefined();
  });

  it("excludes transfers and DELETED bank transactions from every bucket", async () => {
    state.bankTxns = [
      { type: "RECEIVE-TRANSFER", total: 900, date: "2026-05-05", status: "AUTHORISED", line_items: [] },
      { type: "SPEND-TRANSFER", total: 900, date: "2026-05-05", status: "AUTHORISED", line_items: [] },
      { type: "SPEND", total: 100, date: "2026-05-06", status: "DELETED", line_items: [{ AccountCode: "400", LineAmount: 100 }] },
    ];
    const res = await run();
    expect(res.income.clients).toHaveLength(0);
    expect(res.cashOut).toHaveLength(0);
    expect(res.committedNet[0]).toBe(0);
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
    expect(res.cashOut.find((a) => a.accountCode === "UNCATEGORISED")!.monthly[0]).toBe(200);
  });

  it("filters hidden cost accounts from rows but keeps them in the balances", async () => {
    state.bankTxns = [
      { type: "SPEND", total: 1000, date: "2026-05-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 1000 }] },
    ];
    state.hidden = [{ account_code: "400" }];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "400")).toBeUndefined();
    expect(res.accounts.find((a) => a.code === "400")?.hidden).toBe(true);
    expect(res.committedNet[0]).toBe(-1000);
    expect(res.committedOpening[0]).toBe(11000);
  });

  it("ignores stale cost overrides on past months without creating phantom rows", async () => {
    state.overrides = [{ account_code: "400", month: "2026-05", amount: 5000 }];
    const res = await run();
    expect(res.cashOut.find((a) => a.accountCode === "400")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Balance walks
// ---------------------------------------------------------------------------

describe("balance walks", () => {
  it("anchors on today's balance with ACCREC payment cash in the month-to-date net (A1)", async () => {
    state.invoices = [
      { xero_id: "inv-mtd", type: "ACCREC", contact_id: "c1", contact_name: "C1", total: 2000, amount_due: 0, due_date: "2026-06-01", status: "PAID", line_items: [{ AccountCode: "200", LineAmount: 2000 }] },
    ];
    state.payments = [
      { payment_type: "ACCRECPAYMENT", amount: 2000, date: "2026-06-05", status: "AUTHORISED", invoice_xero_id: "inv-mtd" },
    ];
    const res = await run();
    // The payment is cash-to-date: previous month closes at today − MTD net.
    expect(res.committedClosing[0]).toBe(8000);
    expect(res.committedOpening[1]).toBe(8000);
    expect(res.committedClosing[1]).toBe(10000);
    assertInvariants(res);
  });

  it("reconciles history and anchors the current month across mixed flows", async () => {
    state.bankTxns = [
      { type: "SPEND", total: 1000, date: "2026-05-10", status: "AUTHORISED", line_items: [{ AccountCode: "400", LineAmount: 1000 }] },
      { type: "RECEIVE", total: 2000, date: "2026-06-05", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 2000 }] },
    ];
    state.invoices = [
      { xero_id: "inv-late", type: "ACCREC", contact_id: "c1", contact_name: "C1", total: 4000, amount_due: 4000, due_date: "2026-05-10", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 4000 }] },
    ];
    const res = await run();
    expect(res.committedOpening[1]).toBe(8000); // 10000 − 2000 MTD
    expect(res.committedNet[0]).toBe(-1000);
    expect(res.committedClosing[0]).toBe(8000);
    expect(res.committedOpening[0]).toBe(9000);
    // June closes at today + 4000 rolled-forward receivable − 333.33 cost
    // forecast (3-month average of May's 1000 spend)
    expect(res.committedClosing[1]).toBeCloseTo(13666.67, 2);
    assertInvariants(res);
  });

  it("treats a post-dated bank receipt as expected income, not banked cash", async () => {
    state.bankTxns = [
      { type: "RECEIVE", total: 500, date: "2026-06-20", status: "AUTHORISED", line_items: [{ AccountCode: "200", LineAmount: 500 }] },
    ];
    const res = await run();
    const unassigned = client(res, "UNASSIGNED")!;
    expect(unassigned.invoiced[1]).toBe(500); // expected, not paid
    expect(unassigned.paid[1]).toBe(0);
    expect(res.committedOpening[1]).toBe(10000); // anchor excludes it
    expect(res.committedClosing[1]).toBe(10500);
    assertInvariants(res);
  });
});
