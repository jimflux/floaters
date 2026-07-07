import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factories below can reference them.
const upsertMock = vi.hoisted(() => vi.fn());
const xeroRequestMock = vi.hoisted(() => vi.fn());
const xeroRequestPaginatedMock = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  // Rows returned by select queries on xero_invoices
  invoiceRows: [] as Record<string, unknown>[],
  // Result of the head-count query on xero_payments
  paymentCount: 0,
}));

vi.mock("./client", () => ({
  xeroRequest: xeroRequestMock,
  xeroRequestPaginated: xeroRequestPaginatedMock,
}));

// Chainable thenable query builder (the same pattern as the cashflow route
// tests): filters accumulate, then() resolves them against the hoisted state.
// upsert stays a plain recorded mock so the chunkedUpsert tests keep working.
vi.mock("@/lib/supabase", () => {
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let head = false;
    const builder: Record<string, unknown> = {
      upsert: upsertMock,
      select: (_cols?: string, opts?: { head?: boolean }) => ((head = Boolean(opts?.head)), builder),
      eq: (c: string, v: unknown) => ((filters[c] = v), builder),
      in: (c: string, v: unknown) => ((filters[`in_${c}`] = v), builder),
      then: (onF: (r: unknown) => unknown, onR?: (e: unknown) => unknown) => {
        if (head) {
          const count = table === "xero_payments" ? state.paymentCount : 0;
          return Promise.resolve({ count, error: null }).then(onF, onR);
        }
        let rows: Record<string, unknown>[] = [];
        if (table === "xero_invoices") {
          rows = state.invoiceRows;
          const inStatus = filters.in_status as string[] | undefined;
          if (inStatus) rows = rows.filter((r) => inStatus.includes(r.status as string));
          const inIds = filters.in_xero_id as string[] | undefined;
          if (inIds) rows = rows.filter((r) => inIds.includes(r.xero_id as string));
        }
        return Promise.resolve({ data: rows, error: null }).then(onF, onR);
      },
    };
    return builder;
  }
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import {
  parseXeroDate,
  parseXeroDateTime,
  chunkedUpsert,
  mapInvoice,
  mapPayment,
  invoiceWhere,
  fetchInvoicesByIds,
  healInvoiceStatuses,
  syncPayments,
} from "./sync";
import type { XeroInvoice, XeroPayment } from "@/types/xero";

describe("parseXeroDate", () => {
  it("parses Xero's /Date(ms+offset)/ format to a UTC yyyy-MM-dd", () => {
    expect(parseXeroDate("/Date(0+0000)/")).toBe("1970-01-01");
    // 1700000000000ms = 2023-11-14T22:13:20Z
    expect(parseXeroDate("/Date(1700000000000)/")).toBe("2023-11-14");
  });

  it("parses a date-only ISO string", () => {
    expect(parseXeroDate("2024-01-15")).toBe("2024-01-15");
  });

  it("returns null for empty / invalid input", () => {
    expect(parseXeroDate(null)).toBeNull();
    expect(parseXeroDate(undefined)).toBeNull();
    expect(parseXeroDate("")).toBeNull();
    expect(parseXeroDate("not a date")).toBeNull();
  });
});

describe("parseXeroDateTime", () => {
  it("parses /Date(ms)/ to a full ISO timestamp", () => {
    expect(parseXeroDateTime("/Date(0)/")).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns null for invalid input", () => {
    expect(parseXeroDateTime(null)).toBeNull();
    expect(parseXeroDateTime("garbage")).toBeNull();
  });
});

describe("invoiceWhere", () => {
  it("initial sync excludes PAID/VOIDED/DELETED to bound volume", () => {
    expect(invoiceWhere()).toBe('Status!="PAID"&&Status!="VOIDED"&&Status!="DELETED"');
  });

  it("incremental sync has no status exclusions, only the UpdatedDateUTC bound", () => {
    const where = invoiceWhere("2026-06-15T10:00:00.000Z");
    expect(where).toMatch(/^UpdatedDateUTC>=DateTime\(2026,6,1[45]\)$/);
    expect(where).not.toContain("Status");
  });
});

describe("mapInvoice", () => {
  const invoice: XeroInvoice = {
    InvoiceID: "inv-1",
    Type: "ACCREC",
    Contact: { ContactID: "c-1", Name: "Acme" },
    Status: "AUTHORISED",
    CurrencyCode: "GBP",
    Total: 1200,
    TotalTax: 200,
    AmountDue: 600,
    AmountPaid: 600,
    Date: "2026-05-01",
    DueDate: "2026-06-01",
    UpdatedDateUTC: "/Date(1750000000000)/",
    LineItems: [
      { Description: "Work", Quantity: 1, UnitAmount: 1000, AccountCode: "200", TaxType: "OUTPUT2", LineAmount: 1000 },
    ],
  };

  it("maps core fields", () => {
    const row = mapInvoice("conn", invoice)!;
    expect(row.xero_id).toBe("inv-1");
    expect(row.status).toBe("AUTHORISED");
    expect(row.total).toBe(1200);
    expect(row.amount_due).toBe(600);
    expect(row.amount_paid).toBe(600);
    expect(row.due_date).toBe("2026-06-01");
  });

  it("never writes expected_payment_date (locally owned column)", () => {
    const row = mapInvoice("conn", invoice)!;
    expect(Object.keys(row)).not.toContain("expected_payment_date");
  });

  it("maps TotalTax, preserving a genuine zero and NULLing an absent value", () => {
    expect(mapInvoice("conn", invoice)!.total_tax).toBe(200);
    expect(mapInvoice("conn", { ...invoice, TotalTax: 0 })!.total_tax).toBe(0);
    const { TotalTax: _omit, ...noTax } = invoice;
    expect(mapInvoice("conn", noTax as XeroInvoice)!.total_tax).toBeNull();
  });

  it("returns null on unparseable dates", () => {
    expect(mapInvoice("conn", { ...invoice, DueDate: "garbage" })).toBeNull();
  });
});

describe("mapPayment", () => {
  const payment: XeroPayment = {
    PaymentID: "pay-1",
    PaymentType: "ACCRECPAYMENT",
    Status: "AUTHORISED",
    Amount: 600,
    Date: "2026-05-15",
    UpdatedDateUTC: "/Date(1750000000000)/",
    Invoice: { InvoiceID: "inv-1", Type: "ACCREC" },
  };

  it("maps an invoice payment to a row", () => {
    const row = mapPayment("conn", payment)!;
    expect(row).toMatchObject({
      connection_id: "conn",
      xero_id: "pay-1",
      invoice_xero_id: "inv-1",
      payment_type: "ACCRECPAYMENT",
      status: "AUTHORISED",
      amount: 600,
      date: "2026-05-15",
    });
  });

  it("skips payments with no linked invoice (credit note refunds etc.)", () => {
    expect(mapPayment("conn", { ...payment, Invoice: undefined })).toBeNull();
  });

  it("skips payments with unparseable dates", () => {
    expect(mapPayment("conn", { ...payment, Date: "garbage" })).toBeNull();
  });
});

describe("chunkedUpsert", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({ error: null });
  });

  it("splits rows into chunks of 500 and preserves total count", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: i }));
    await chunkedUpsert("xero_invoices", rows, "connection_id,xero_id");

    expect(upsertMock).toHaveBeenCalledTimes(3);
    const sizes = upsertMock.mock.calls.map((c) => (c[0] as unknown[]).length);
    expect(sizes).toEqual([500, 500, 200]);
    // onConflict is forwarded
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: "connection_id,xero_id" });
  });

  it("does nothing for an empty array", async () => {
    await chunkedUpsert("xero_invoices", [], "connection_id,xero_id");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("throws when a chunk fails", async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(
      chunkedUpsert("xero_invoices", [{ id: 1 }], "connection_id,xero_id")
    ).rejects.toThrow(/boom/);
  });
});

// Minimal valid invoice payload for the by-IDs fetch tests.
function xeroInvoice(id: string, overrides: Partial<XeroInvoice> = {}): XeroInvoice {
  return {
    InvoiceID: id,
    Type: "ACCREC",
    Contact: { ContactID: "c-1", Name: "Acme" },
    Status: "PAID",
    CurrencyCode: "GBP",
    Total: 100,
    AmountDue: 0,
    AmountPaid: 100,
    Date: "2026-05-01",
    DueDate: "2026-06-01",
    UpdatedDateUTC: "/Date(1750000000000)/",
    ...overrides,
  };
}

describe("fetchInvoicesByIds", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({ error: null });
    xeroRequestMock.mockReset();
  });

  it("fetches in batches of 40, upserts the mapped rows and returns the count", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `inv-${i}`);
    xeroRequestMock.mockImplementation(async (opts: { params: { IDs: string } }) => ({
      Invoices: opts.params.IDs.split(",").map((id) => xeroInvoice(id)),
    }));

    const count = await fetchInvoicesByIds("conn", ids);

    expect(count).toBe(45);
    expect(xeroRequestMock).toHaveBeenCalledTimes(2);
    const batches = xeroRequestMock.mock.calls.map(
      (c) => (c[0] as { params: { IDs: string } }).params.IDs.split(",")
    );
    expect(batches[0]).toHaveLength(40);
    expect(batches[1]).toHaveLength(5);
    expect(batches.flat()).toEqual(ids);
    // The mapped rows reach the upsert with the same ids
    const upserted = upsertMock.mock.calls.flatMap(
      (c) => (c[0] as { xero_id: string }[]).map((r) => r.xero_id)
    );
    expect(upserted).toEqual(ids);
  });

  it("skips invoices with unparseable dates", async () => {
    xeroRequestMock.mockResolvedValue({
      Invoices: [xeroInvoice("inv-bad", { DueDate: "garbage" })],
    });
    const count = await fetchInvoicesByIds("conn", ["inv-bad"]);
    expect(count).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("healInvoiceStatuses", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({ error: null });
    xeroRequestMock.mockReset();
    state.invoiceRows = [];
  });

  it("re-fetches every locally-open invoice by id", async () => {
    state.invoiceRows = [
      { xero_id: "inv-open", status: "AUTHORISED" },
      { xero_id: "inv-sub", status: "SUBMITTED" },
      { xero_id: "inv-done", status: "PAID" }, // excluded by the status filter
    ];
    xeroRequestMock.mockImplementation(async (opts: { params: { IDs: string } }) => ({
      Invoices: opts.params.IDs.split(",").map((id) => xeroInvoice(id)),
    }));

    const count = await healInvoiceStatuses("conn");

    expect(count).toBe(2);
    expect(xeroRequestMock).toHaveBeenCalledTimes(1);
    const call = xeroRequestMock.mock.calls[0][0] as { params: { IDs: string } };
    expect(call.params.IDs).toBe("inv-open,inv-sub");
  });

  it("returns 0 without any Xero call when nothing is open", async () => {
    state.invoiceRows = [{ xero_id: "inv-done", status: "PAID" }];
    const count = await healInvoiceStatuses("conn");
    expect(count).toBe(0);
    expect(xeroRequestMock).not.toHaveBeenCalled();
  });
});

describe("syncPayments where-clause selection", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({ error: null });
    xeroRequestPaginatedMock.mockReset();
    xeroRequestPaginatedMock.mockResolvedValue([]);
    state.paymentCount = 0;
  });

  it("syncs incrementally when payment history already exists", async () => {
    state.paymentCount = 5;
    await syncPayments("conn", "2026-06-15T10:00:00.000Z");
    const params = xeroRequestPaginatedMock.mock.calls[0][3] as { where: string };
    expect(params.where).toMatch(/^UpdatedDateUTC>=DateTime\(2026,6,1[45]\)$/);
  });

  it("backfills the full window on the first incremental sync after deploy", async () => {
    state.paymentCount = 0;
    await syncPayments("conn", "2026-06-15T10:00:00.000Z");
    const params = xeroRequestPaginatedMock.mock.calls[0][3] as { where: string };
    expect(params.where).toMatch(/^Date>=DateTime\(\d{4},\d{1,2},\d{1,2}\)$/);
  });
});
